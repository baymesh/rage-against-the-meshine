import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
} from "discord.js";
import { fileURLToPath } from "url";
import path, { dirname } from "path";
import protobufjs from "protobufjs";
import crypto from "crypto";
import mqtt from "mqtt";

import FifoCache from "./src/FifoCache";
import MeshPacketCache from "./src/MeshPacketCache";
import meshRedis from "./src/MeshRedis";
import logger from "./src/Logger";
import Commands from "./src/Commands";
import { fetchNodeId } from "./src/NodeUtils";
import { fetchUserRoles, fetchDiscordChannel } from "./src/DiscordUtils";
import { processTextMessage } from "./src/MessageUtils";
import { handleMqttMessage } from "./src/MqttUtils";
import {
  MQTT_BROKER_URL,
  REDIS_URL,
  NODE_INFO_UPDATES,
  DISCORD_CLIENT_ID,
  DISCORD_TOKEN,
  DISCORD_GUILD,
  DISCORD_CHANNEL_LF,
  DISCORD_CHANNEL_MS,
  DISCORD_CHANNEL_MF,
  DISCORD_CHANNEL_MF_TEST,
  DISCORD_CHANNEL_HAB,
  MQTT_TOPICS,
} from "./src/config";

// generate a pseduo uuid kinda thing to use as an instance id
const INSTANCE_ID = (() => {
  return crypto.randomBytes(4).toString("hex");
})();
logger.init(INSTANCE_ID);

logger.info("Starting Mesh Logger");

if (MQTT_BROKER_URL === undefined || MQTT_BROKER_URL.length === 0) {
  throw new Error("MQTT_BROKER_URL is not set");
}

if (REDIS_URL === undefined || REDIS_URL.length === 0) {
  throw new Error("REDIS_URL is not set");
}

if (DISCORD_CLIENT_ID === undefined || DISCORD_CLIENT_ID.length === 0) {
  throw new Error("DISCORD_CLIENT_ID is not set");
}

if (DISCORD_TOKEN === undefined || DISCORD_TOKEN.length === 0) {
  throw new Error("DISCORD_TOKEN is not set");
}

if (DISCORD_GUILD === undefined || DISCORD_GUILD.length === 0) {
  throw new Error("DISCORD_GUILD is not set");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// load protobufs
const root = new protobufjs.Root();
root.resolvePath = (origin, target) =>
  path.join(__dirname, "src/protobufs", target);
root.loadSync("meshtastic/mqtt.proto");
const Data = root.lookupType("Data");
const ServiceEnvelope = root.lookupType("ServiceEnvelope");
const Position = root.lookupType("Position");
const User = root.lookupType("User");

export { Data, ServiceEnvelope, Position, User };

const discordMessageIdCache = new FifoCache<string, string>();
const meshPacketCache = new MeshPacketCache();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

await meshRedis.init(REDIS_URL);

// Register the slash command with Discord using the REST API.
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    logger.info("Started refreshing application (/) commands.");

    // Register the command for a specific guild (for development, guild commands update faster).
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD),
      {
        body: Commands,
      },
    );

    logger.info("Successfully reloaded application (/) commands.");
  } catch (error) {
    logger.error(error);
  }
})();

// When Discord client is ready, start the MQTT connection.
client.once("ready", () => {
  logger.info(`Logged in as ${client.user.tag}!`);

  const guild = client.guilds.cache.find((g) => g.id === DISCORD_GUILD);
  if (!guild) {
    logger.error("No guild available for the bot");
    return;
  } else {
    logger.info(JSON.stringify(guild));
  }

  const lfChannel = fetchDiscordChannel(guild, DISCORD_CHANNEL_LF);
  const msChannel = fetchDiscordChannel(guild, DISCORD_CHANNEL_MS);
  const mfChannel = fetchDiscordChannel(guild, DISCORD_CHANNEL_MF);
  const mfTestChannel = fetchDiscordChannel(guild, DISCORD_CHANNEL_MF_TEST);
  const habChannel = fetchDiscordChannel(guild, DISCORD_CHANNEL_HAB);

  // Connect to the MQTT broker.
  const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: "meshdev",
    password: "large4cats",
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.guildId !== DISCORD_GUILD) {
      logger.warn("Received interaction from non-guild");
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // Handle the /linknode command.
    if (interaction.commandName === "linknode") {
      let nodeId = fetchNodeId(interaction);

      if (!nodeId) {
        logger.warn("Received /linknode command with no nodeid");
        await interaction.reply({
          content: "Please provide a nodeid",
          ephemeral: true,
        });
        return;
      }

      // Get the invoking user's profile image URL.
      const profileImageUrl = interaction.user.displayAvatarURL({
        dynamic: true,
        size: 1024,
      });

      // Log the desired output to the console.
      logger.info(`node: ${nodeId}, profile_image_url: ${profileImageUrl}`);

      const result = await meshRedis.linkNode(nodeId, interaction.user.id);

      logger.info(result);

      // Respond to the command to acknowledge receipt (ephemeral response).
      await interaction.reply({
        content: result,
        flags: MessageFlags.Ephemeral,
      });
    } else if (interaction.commandName === "unlinknode") {
      let nodeId = fetchNodeId(interaction);

      if (!nodeId) {
        logger.warn("Received /unlinknode command with no nodeid");
        await interaction.reply({
          content: "Please provide a nodeid",
          ephemeral: true,
        });
        return;
      }

      const result = await meshRedis.unlinkNode(nodeId, interaction.user.id);
      await interaction.reply({
        content: result,
        flags: MessageFlags.Ephemeral,
      });
    } else if (interaction.commandName === "addtracker") {
      logger.info(interaction.user);
      const roles = await fetchUserRoles(guild, interaction.user.id);
      logger.info(roles);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = fetchNodeId(interaction);

        if (!nodeId) {
          logger.warn("Received /addtracker command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        meshRedis.addTrackerNode(nodeId);

        await interaction.reply({
          content: "Node added to tracking list.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "You do not have permission to use this command",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } else if (interaction.commandName === "removetracker") {
      logger.info(interaction.user);
      const roles = await fetchUserRoles(guild, interaction.user.id);
      logger.info(roles);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = fetchNodeId(interaction);

        if (!nodeId) {
          logger.warn("Received /removetracker command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        meshRedis.removeTrackerNode(nodeId);

        await interaction.reply({
          content: "Node removed from tracking list",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "You do not have permission to use this command",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } else if (interaction.commandName === "addballoon") {
      logger.info(interaction.user);
      const roles = await fetchUserRoles(guild, interaction.user.id);
      logger.info(roles);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = fetchNodeId(interaction);

        if (!nodeId) {
          logger.warn("Received /addballoon command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        meshRedis.addBalloonNode(nodeId);

        await interaction.reply({
          content: "Node added to balloon list.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "You do not have permission to use this command",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } else if (interaction.commandName === "removeballoon") {
      logger.info(interaction.user);
      const roles = await fetchUserRoles(guild, interaction.user.id);
      logger.info(roles);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = fetchNodeId(interaction);

        if (!nodeId) {
          logger.warn("Received /removeballoon command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        meshRedis.removeBalloonNode(nodeId);

        await interaction.reply({
          content: "Node removed from balloon list",
          flags: MessageFlags.Ephemeral,
        });
      }
    } else if (interaction.commandName === "bannode") {
      const roles = await fetchUserRoles(guild, interaction.user.id);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = fetchNodeId(interaction);

        if (!nodeId) {
          logger.warn("Received /bannode command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        await meshRedis.addBannedNode(nodeId);

        await interaction.reply({
          content: "Node banned.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "You do not have permission to use this command",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } else if (interaction.commandName === "mylinkednodes") {
      // fetch all nodes linked to this user
      logger.info(interaction.guild?.id);

      const nodes = await meshRedis.getNodesByDiscordId(interaction.user.id);

      if (nodes.length === 0) {
        await interaction.reply({
          content: "You have no linked nodes.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: `Your linked nodes: ${nodes.join(", ")}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else if (interaction.commandName === "unbannode") {
      const roles = await fetchUserRoles(guild, interaction.user.id);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = fetchNodeId(interaction);

        if (!nodeId) {
          logger.warn("Received /unbannode command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        await meshRedis.removeBannedNode(nodeId);

        await interaction.reply({
          content: "Node unbanned.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "You do not have permission to use this command",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
  });

  const processing_timer = setInterval(() => {
    const packetGroups = meshPacketCache.getDirtyPacketGroups();
    // logger.info("Processing " + packetGroups.length + " packet groups");
    packetGroups.forEach((packetGroup) => {
      // processPacketGroup(packetGroup);
      if (packetGroup.serviceEnvelopes[0].packet?.decoded?.portnum === 3) {
        logger.info("Processing packet group: " + packetGroup.id + " POSITION");
      } else {
        logger.info(
          "Processing packet group: " +
            packetGroup.id +
            " with text: " +
            packetGroup.serviceEnvelopes[0].packet.decoded.payload.toString(),
        );
      }
      processTextMessage(
        packetGroup,
        client,
        guild,
        discordMessageIdCache,
        habChannel,
        msChannel,
        lfChannel,
        mfChannel,
        mfTestChannel,
      );
    });
  }, 5000);

  mqttClient.on("error", (err) => {
    logger.error("MQTT Client Error:", err);
  });

  mqttClient.on("connect", () => {
    logger.info("Connected to MQTT broker");
    // Subscribe to the topic where your packets are published.
    mqttClient.subscribe("msh/US/#", (err) => {
      if (err) {
        logger.error("Error subscribing to MQTT topic:", err);
      } else {
        logger.info("Subscribed to MQTT topic");
      }
    });
  });

  mqttClient.on("message", async (topic, message) => {
    await handleMqttMessage(
      topic,
      message,
      MQTT_TOPICS,
      meshPacketCache,
      NODE_INFO_UPDATES,
      MQTT_BROKER_URL,
    );
  });
});

// Log in to Discord.
client.login(DISCORD_TOKEN);
