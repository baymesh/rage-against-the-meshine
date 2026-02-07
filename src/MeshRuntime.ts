import process from "node:process";
import mqtt from "mqtt";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
} from "discord.js";

import FifoCache from "./FifoCache";
import MeshPacketCache from "./MeshPacketCache";
import logger from "./Logger";
import Commands from "./Commands";
import { fetchNodeId } from "./NodeUtils";
import { fetchUserRoles, fetchDiscordChannel } from "./DiscordUtils";
import { processTextMessage } from "./MessageUtils";
import { handleMqttMessage } from "./MqttUtils";
import {
  compileChannelRegexRules,
  type MeshConfig,
  type MultiMeshConfig,
} from "./MultiMeshConfig";
import { createMeshRedis } from "./MeshRedis";

const DEFAULT_MQTT_USERNAME = process.env.MQTT_USERNAME || "meshdev";
const DEFAULT_MQTT_PASSWORD = process.env.MQTT_PASSWORD || "large4cats";

export const startMeshRuntime = async (
  meshConfig: MeshConfig,
  globalConfig: MultiMeshConfig,
) => {
  const meshId = meshConfig.id;
  const meshLogger = logger.withTag(`mesh:${meshId}`);
  let discordReady = false;
  const meshViewBaseUrl =
    meshConfig.meshViewBaseUrl ||
    globalConfig.meshViewBaseUrl ||
    process.env.MESHVIEW_BASE_URL ||
    "";

  const meshRedis = await createMeshRedis(
    globalConfig.redisUrl,
    meshId,
    meshLogger,
  );
  const discordMessageIdCache = new FifoCache<string, string>();
  const meshPacketCache = new MeshPacketCache();
  const nodeInfoPacketCache = new FifoCache<string, string>();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  const rest = new REST({ version: "10" }).setToken(
    meshConfig.discord.token,
  );

  const mqttClient = mqtt.connect(meshConfig.mqtt.brokerUrl, {
    username: meshConfig.mqtt.username || DEFAULT_MQTT_USERNAME,
    password: meshConfig.mqtt.password || DEFAULT_MQTT_PASSWORD,
  });

  mqttClient.on("error", (err: any) => {
    meshLogger.error(`MQTT Client Error: ${String(err)}`);
  });

  mqttClient.on("connect", () => {
    meshLogger.info("Connected to MQTT broker");
    meshConfig.mqtt.topics.forEach((topic) => {
      mqttClient.subscribe(topic, (err: any) => {
        if (err) {
          meshLogger.error(`Error subscribing to MQTT topic ${topic}: ${err}`);
        } else {
          meshLogger.info(`Subscribed to MQTT topic ${topic}`);
        }
      });
    });
  });

  mqttClient.on("message", async (topic: string, message: any) => {
    if (!discordReady) {
      meshLogger.warn("Discord is not ready; dropping MQTT message.");
      return;
    }
    await handleMqttMessage(
      topic,
      message,
      meshConfig.mqtt.topics,
      meshPacketCache,
      nodeInfoPacketCache,
      meshConfig.nodeInfoUpdates ?? globalConfig.nodeInfoUpdates ?? false,
      meshConfig.mqtt.brokerUrl,
      meshRedis,
      meshLogger,
    );
  });

  try {
    meshLogger.info("Refreshing application (/) commands.");
    await rest.put(
      Routes.applicationGuildCommands(
        meshConfig.discord.clientId,
        meshConfig.discord.guildId,
      ),
      { body: Commands },
    );
    meshLogger.info("Successfully reloaded application (/) commands.");
  } catch (error) {
    meshLogger.error(`Error registering commands: ${String(error)}`);
  }

  client.once("ready", () => {
    meshLogger.info(`Logged in as ${client.user.tag}!`);
    discordReady = true;

    const guild = client.guilds.cache.find(
      (g: any) => g.id === meshConfig.discord.guildId,
    );
    if (!guild) {
      meshLogger.error("No guild available for the bot");
      return;
    }

    const channelRegexRules = compileChannelRegexRules(
      meshConfig.routing.channelRegex,
    );

    const channelCache = new Map<string, any>();
    const resolveChannelById = (channelId: string) => {
      if (channelCache.has(channelId)) {
        return channelCache.get(channelId);
      }
      const channel = fetchDiscordChannel(guild, channelId);
      channelCache.set(channelId, channel);
      return channel;
    };

    client.on("interactionCreate", async (interaction: any) => {
      if (interaction.guildId !== meshConfig.discord.guildId) {
        meshLogger.warn("Received interaction from non-guild");
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === "linknode") {
        let nodeId = fetchNodeId(interaction, meshViewBaseUrl);

        if (!nodeId) {
          meshLogger.warn("Received /linknode command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        const profileImageUrl = interaction.user.displayAvatarURL({
          dynamic: true,
          size: 1024,
        });

        meshLogger.info(`node: ${nodeId}, profile_image_url: ${profileImageUrl}`);

        const result = await meshRedis.linkNode(nodeId, interaction.user.id);

        await interaction.reply({
          content: result,
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.commandName === "unlinknode") {
        let nodeId = fetchNodeId(interaction, meshViewBaseUrl);

        if (!nodeId) {
          meshLogger.warn("Received /unlinknode command with no nodeid");
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
        const roles = await fetchUserRoles(guild, interaction.user.id);
        if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
          let nodeId = fetchNodeId(interaction, meshViewBaseUrl);

          if (!nodeId) {
            meshLogger.warn("Received /addtracker command with no nodeid");
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
        }
      } else if (interaction.commandName === "removetracker") {
        const roles = await fetchUserRoles(guild, interaction.user.id);
        if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
          let nodeId = fetchNodeId(interaction, meshViewBaseUrl);

          if (!nodeId) {
            meshLogger.warn("Received /removetracker command with no nodeid");
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
        }
      } else if (interaction.commandName === "addballoon") {
        const roles = await fetchUserRoles(guild, interaction.user.id);
        if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
          let nodeId = fetchNodeId(interaction, meshViewBaseUrl);

          if (!nodeId) {
            meshLogger.warn("Received /addballoon command with no nodeid");
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
        }
      } else if (interaction.commandName === "removeballoon") {
        const roles = await fetchUserRoles(guild, interaction.user.id);
        if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
          let nodeId = fetchNodeId(interaction, meshViewBaseUrl);

          if (!nodeId) {
            meshLogger.warn("Received /removeballoon command with no nodeid");
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
          let nodeId = fetchNodeId(interaction, meshViewBaseUrl);

          if (!nodeId) {
            meshLogger.warn("Received /bannode command with no nodeid");
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
        }
      } else if (interaction.commandName === "mylinkednodes") {
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
          let nodeId = fetchNodeId(interaction, meshViewBaseUrl);

          if (!nodeId) {
            meshLogger.warn("Received /unbannode command with no nodeid");
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
        }
      }
    });

    setInterval(() => {
      const packetGroups = meshPacketCache.getDirtyPacketGroups();
      packetGroups.forEach((packetGroup) => {
        processTextMessage(packetGroup, {
          client,
          guild,
          discordMessageIdCache,
          channelRegexRules,
          resolveChannelById,
          meshRedis,
          meshViewBaseUrl,
          meshId,
        });
      });
    }, 5000);

  });

  await client.login(meshConfig.discord.token);

  return {
    client,
    mqttClient,
    meshRedis,
  };
};
