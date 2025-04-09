import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  GuildMember,
  User as DiscordUser,
  userMention,
} from "discord.js";
import crypto from "crypto";
import { fileURLToPath } from "url";
import path, { dirname } from "path";
import protobufjs from "protobufjs";
import mqtt from "mqtt";

import FifoCache from "./src/FifoCache";
import MeshPacketCache, {
  PacketGroup,
  DecodedPosition,
  decodedPositionToString,
} from "./src/MeshPacketCache";
import meshRedis from "./src/MeshRedis";
import logger from "./src/Logger";
import Commands from "./src/Commands";
import { nodeHex2id, nodeId2hex } from "./src/NodeUtils";

// generate a pseduo uuid kinda thing to use as an instance id
const INSTANCE_ID = (() => {
  return crypto.randomBytes(4).toString("hex");
})();
logger.init(INSTANCE_ID);

logger.info("Starting Mesh Logger");

const DISCORD_CLIENT_ID = process.env["DISCORD_CLIENT_ID"];
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const DISCORD_GUILD = process.env["DISCORD_GUILD"];
const DISCORD_CHANNEL_LF = process.env["DISCORD_CHANNEL_LF"];
const DISCORD_CHANNEL_MS = process.env["DISCORD_CHANNEL_MS"];
const DISCORD_CHANNEL_HAB = process.env["DISCORD_CHANNEL_HAB"];
const REDIS_URL = process.env["REDIS_URL"];
const NODE_INFO_UPDATES = process.env["NODE_INFO_UPDATES"] === "1";
const MQTT_BROKER_URL = process.env["MQTT_BROKER_URL"];
const MQTT_TOPICS = JSON.parse(process.env["MQTT_TOPICS"] || "[]");

console.log(process.env);

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

const decryptionKeys = [
  "1PG7OiApB1nwvP+rz05pAQ==", // add default "AQ==" decryption key
];

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
    console.log("Started refreshing application (/) commands.");

    // Register the command for a specific guild (for development, guild commands update faster).
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD),
      {
        body: Commands,
      },
    );

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();

// When Discord client is ready, start the MQTT connection.
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);

  const guild = client.guilds.cache.find((g) => g.id === DISCORD_GUILD);
  if (!guild) {
    console.error("No guild available for the bot");
    return;
  } else {
    console.log(guild);
  }

  const lfChannel = guild.channels.cache.find(
    (ch) => ch.id === DISCORD_CHANNEL_LF && ch.isTextBased(),
  );
  if (!lfChannel) {
    console.error(`Channel Id "${DISCORD_CHANNEL_LF}" not found`);
    // return;
  } else {
    // console.log(lfChannel);
    console.log(`Channel ${lfChannel.name} found`);
    // lfChanelId = lfChannel.id;
  }

  const msChannel = guild.channels.cache.find(
    (ch) => ch.id === DISCORD_CHANNEL_MS && ch.isTextBased(),
  );
  if (!msChannel) {
    console.error(`Channel Id "${DISCORD_CHANNEL_MS}" not found`);
    // return;
  } else {
    // console.log(msChannel);
    console.log(`Channel ${msChannel.name} found`);
    // msChannelId = msChannel.id;
  }

  const habChannel = guild.channels.cache.find(
    (ch) => ch.id === DISCORD_CHANNEL_HAB && ch.isTextBased(),
  );
  if (!habChannel)
    console.error(`Channel Id "${DISCORD_CHANNEL_HAB}" not found`);
  else console.log(`Channel ${habChannel.name} found`);

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
      // Get the nodeid argument.
      let nodeId = interaction.options
        .getString("nodeid")
        .replace("https://meshview.bayme.sh/packet_list/", "")
        .replace("!", "")
        .trim();

      if (
        nodeId === undefined ||
        nodeId === null ||
        nodeId.trim().length === 0
      ) {
        logger.warn("Received /linknode command with no nodeid");
        await interaction.reply({
          content: "Please provide a nodeid",
          ephemeral: true,
        });
        return;
      }

      if (nodeId.length !== 8) {
        // attempt to convert to hex
        let nodeIdHex;
        try {
          nodeIdHex = nodeId2hex(parseInt(nodeId));
        } catch (e) {
          logger.warn(`Couldn't parse node id: ${nodeId}`);
        }
        if (
          nodeIdHex === undefined ||
          nodeIdHex === null ||
          nodeIdHex.length !== 8
        ) {
          logger.warn(
            `Received /linknode command with invalid nodeid "${nodeId}"`,
          );
          await interaction.reply({
            content: "Please provide a valid nodeid",
            ephemeral: true,
          });
          return;
        }
        nodeId = nodeIdHex;
      }

      // Get the invoking user's profile image URL.
      const profileImageUrl = interaction.user.displayAvatarURL({
        dynamic: true,
        size: 1024,
      });

      // Log the desired output to the console.
      console.log(`node: ${nodeId}, profile_image_url: ${profileImageUrl}`);

      const result = await meshRedis.linkNode(nodeId, interaction.user.id);

      logger.info(result);

      // Respond to the command to acknowledge receipt (ephemeral response).
      await interaction.reply({
        content: result,
        flags: MessageFlags.Ephemeral,
      });
    } else if (interaction.commandName === "unlinknode") {
      let nodeId = interaction.options
        .getString("nodeid")
        .replace("https://meshview.bayme.sh/packet_list/", "")
        .replace("!", "")
        .trim();

      if (
        nodeId === undefined ||
        nodeId === null ||
        nodeId.trim().length === 0
      ) {
        logger.warn("Received /unlinknode command with no nodeid");
        await interaction.reply({
          content: "Please provide a nodeid",
          ephemeral: true,
        });
        return;
      }

      if (nodeId.length !== 8) {
        // attempt to convert to hex
        let nodeIdHex;
        try {
          nodeIdHex = nodeId2hex(parseInt(nodeId));
        } catch (e) {
          logger.warn(`Couldn't parse node id: ${nodeId}`);
        }
        if (
          nodeIdHex === undefined ||
          nodeIdHex === null ||
          nodeIdHex.length !== 8
        ) {
          logger.warn(
            `Received /unlinknode command with invalid nodeid "${nodeId}"`,
          );
          await interaction.reply({
            content: "Please provide a valid nodeid",
            ephemeral: true,
          });
          return;
        }
        nodeId = nodeIdHex;
      }

      const result = await meshRedis.unlinkNode(nodeId, interaction.user.id);
      await interaction.reply({
        content: result,
        flags: MessageFlags.Ephemeral,
      });
    } else if (interaction.commandName === "addtracker") {
      console.log(interaction.user);
      const roles = await guild.members
        .fetch(interaction.user.id)
        .then((member) => {
          const roles = member.roles.cache.map((role) => role.name);
          // console.log(roles);
          return roles;
        })
        .catch(console.error);
      console.log(roles);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = interaction.options
          .getString("nodeid")
          .replace("https://meshview.bayme.sh/packet_list/", "")
          .replace("!", "")
          .trim();

        if (
          nodeId === undefined ||
          nodeId === null ||
          nodeId.trim().length === 0
        ) {
          logger.warn("Received /addtracker command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        if (nodeId.length !== 8) {
          // attempt to convert to hex
          let nodeIdHex;
          try {
            nodeIdHex = nodeId2hex(parseInt(nodeId));
          } catch (e) {
            logger.warn(`Couldn't parse node id: ${nodeId}`);
          }
          if (
            nodeIdHex === undefined ||
            nodeIdHex === null ||
            nodeIdHex.length !== 8
          ) {
            logger.warn(
              `Received /addtracker command with invalid nodeid "${nodeId}"`,
            );
            await interaction.reply({
              content: "Please provide a valid nodeid",
              ephemeral: true,
            });
            return;
          }
          nodeId = nodeIdHex;
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
      console.log(interaction.user);
      const roles = await guild.members
        .fetch(interaction.user.id)
        .then((member) => {
          const roles = member.roles.cache.map((role) => role.name);
          // console.log(roles);
          return roles;
        })
        .catch(console.error);
      console.log(roles);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = interaction.options
          .getString("nodeid")
          .replace("https://meshview.bayme.sh/packet_list/", "")
          .replace("!", "")
          .trim();

        if (
          nodeId === undefined ||
          nodeId === null ||
          nodeId.trim().length === 0
        ) {
          logger.warn("Received /removetracker command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        if (nodeId.length !== 8) {
          // attempt to convert to hex
          let nodeIdHex;
          try {
            nodeIdHex = nodeId2hex(parseInt(nodeId));
          } catch (e) {
            logger.warn(`Couldn't parse node id: ${nodeId}`);
          }
          if (
            nodeIdHex === undefined ||
            nodeIdHex === null ||
            nodeIdHex.length !== 8
          ) {
            logger.warn(
              `Received /removetracker command with invalid nodeid "${nodeId}"`,
            );
            await interaction.reply({
              content: "Please provide a valid nodeid",
              ephemeral: true,
            });
            return;
          }
          nodeId = nodeIdHex;
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
      console.log(interaction.user);
      const roles = await guild.members
        .fetch(interaction.user.id)
        .then((member) => {
          const roles = member.roles.cache.map((role) => role.name);
          // console.log(roles);
          return roles;
        })
        .catch(console.error);
      console.log(roles);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = interaction.options
          .getString("nodeid")
          .replace("https://meshview.bayme.sh/packet_list/", "")
          .replace("!", "")
          .trim();

        if (
          nodeId === undefined ||
          nodeId === null ||
          nodeId.trim().length === 0
        ) {
          logger.warn("Received /addballoon command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        if (nodeId.length !== 8) {
          // attempt to convert to hex
          let nodeIdHex;
          try {
            nodeIdHex = nodeId2hex(parseInt(nodeId));
          } catch (e) {
            logger.warn(`Couldn't parse node id: ${nodeId}`);
          }
          if (
            nodeIdHex === undefined ||
            nodeIdHex === null ||
            nodeIdHex.length !== 8
          ) {
            logger.warn(
              `Received /addballoon command with invalid nodeid "${nodeId}"`,
            );
            await interaction.reply({
              content: "Please provide a valid nodeid",
              ephemeral: true,
            });
            return;
          }
          nodeId = nodeIdHex;
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
      console.log(interaction.user);
      const roles = await guild.members
        .fetch(interaction.user.id)
        .then((member) => {
          const roles = member.roles.cache.map((role) => role.name);
          // console.log(roles);
          return roles;
        })
        .catch(console.error);
      console.log(roles);
      if (roles && (roles.includes("Moderator") || roles.includes("Admin"))) {
        let nodeId = interaction.options
          .getString("nodeid")
          .replace("https://meshview.bayme.sh/packet_list/", "")
          .replace("!", "")
          .trim();

        if (
          nodeId === undefined ||
          nodeId === null ||
          nodeId.trim().length === 0
        ) {
          logger.warn("Received /removeballoon command with no nodeid");
          await interaction.reply({
            content: "Please provide a nodeid",
            ephemeral: true,
          });
          return;
        }

        if (nodeId.length !== 8) {
          // attempt to convert to hex
          let nodeIdHex;
          try {
            nodeIdHex = nodeId2hex(parseInt(nodeId));
          } catch (e) {
            logger.warn(`Couldn't parse node id: ${nodeId}`);
          }
          if (
            nodeIdHex === undefined ||
            nodeIdHex === null ||
            nodeIdHex.length !== 8
          ) {
            logger.warn(
              `Received /removeballoon command with invalid nodeid "${nodeId}"`,
            );
            await interaction.reply({
              content: "Please provide a valid nodeid",
              ephemeral: true,
            });
            return;
          }
          nodeId = nodeIdHex;
        }

        meshRedis.removeBalloonNode(nodeId);

        await interaction.reply({
          content: "Node removed from balloon list",
          flags: MessageFlags.Ephemeral,
        });
      }
    } else if (interaction.commandName === "bannode") {
      // Get the nodeid argument.
      const nodeId = interaction.options.getString("nodeid");

      // add node to the banned list

      // Respond to the command to acknowledge receipt (ephemeral response).
      await interaction.reply({
        content: "Ban Command received!",
        flags: MessageFlags.Ephemeral,
      });
    }
  });

  const processTextMessage = async (packetGroup: PacketGroup) => {
    const packet = packetGroup.serviceEnvelopes[0].packet;
    let text = packet.decoded.payload.toString();
    const to = nodeId2hex(packet.to);
    const portNum = packet?.decoded?.portnum;

    if (portNum === 3) {
      text = "Position Packet";
    }

    // discard text messages in the form of "seq 6034" "seq 6025"
    if (text.match(/^seq \d+$/)) {
      return;
    }

    if (process.env.ENVIRONMENT === "production" && to !== "ffffffff") {
      logger.info(
        `MessageId: ${packetGroup.id} Not to public channel: ${packetGroup.serviceEnvelopes.map((envelope) => envelope.topic)}`,
      );
      return;
    }

    logger.debug("createDiscordMessage: " + text);
    logger.debug("reply_id: " + packet.decoded.replyId?.toString());

    // const discordChannel =
    //   packetGroup.serviceEnvelopes[0].channelId === "MediumSlow"
    //     ? msChannel
    //     : lfChannel;

    const nodeId = nodeId2hex(packet.from);

    const balloonNode = await meshRedis.isBalloonNode(nodeId);
    // const trackerNode = await meshRedis.isTrackerNode(nodeId);

    const content = await createDiscordMessage(packetGroup, text, balloonNode);

    const getDiscordChannel = async (balloonNode, channelId) => {
      if (balloonNode) {
        return habChannel;
      }
      if (channelId === "MediumSlow") {
        return msChannel;
      } else if (channelId === "LongFast") {
        return lfChannel;
      } else if (channelId === "HAB") {
        return habChannel;
      } else {
        return null;
      }
    };

    let discordChannel = await getDiscordChannel(
      balloonNode,
      packetGroup.serviceEnvelopes[0].channelId,
    );

    if (discordChannel === null) {
      logger.warn(
        "No discord channel found for channelId: " +
          packetGroup.serviceEnvelopes[0].channelId,
      );
      return;
    }

    if (discordMessageIdCache.exists(packet.id.toString())) {
      // update original message
      logger.info("Updating message: " + packet.id.toString());
      const discordMessageId = discordMessageIdCache.get(packet.id.toString());
      const originalMessage =
        await discordChannel.messages.fetch(discordMessageId);
      originalMessage.edit(content);
      // discordChannel.messages.edit(discordMessageId, content);
    } else {
      // send new message
      logger.info("Sending message: " + packet.id.toString());
      let discordMessage;
      if (
        packet.decoded.replyId &&
        packet.decoded.replyId > 0 &&
        discordMessageIdCache.exists(packet.decoded.replyId.toString())
      ) {
        const discordMessageId = discordMessageIdCache.get(
          packet.decoded.replyId.toString(),
        );
        const existingMessage =
          await discordChannel.messages.fetch(discordMessageId);
        discordMessage = await existingMessage.reply(content);
      } else {
        discordMessage = await discordChannel.send(content);
      }
      // store message id in cache
      discordMessageIdCache.set(packet.id.toString(), discordMessage.id);
    }
  };

  const createDiscordMessage = async (packetGroup, text, balloonNode) => {
    try {
      const packet = packetGroup.serviceEnvelopes[0].packet;
      const from = nodeId2hex(packet.from);
      const nodeIdHex = nodeId2hex(from);
      const portNum = packet?.decoded?.portnum;
      let msgText = text;

      let nodeInfos = await meshRedis.getNodeInfos(
        packetGroup.serviceEnvelopes
          .map((se) => se.gatewayId.replace("!", ""))
          .concat(from),
        false,
      );

      let avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
      // const discordPfpUrl = await meshRedis.getPfpUrl(nodeIdHex);
      // if (discordPfpUrl) {
      //   avatarUrl = discordPfpUrl;
      // }

      const maxHopStart = packetGroup.serviceEnvelopes.reduce((acc, se) => {
        const hopStart = se.packet.hopStart;
        return hopStart > acc ? hopStart : acc;
      }, 0);

      // console.log("maxHopStart", maxHopStart);

      const discordUserId = await meshRedis.getDiscordUserId(nodeIdHex);
      logger.info(`nodeIdHex: ${nodeIdHex}, discordUserId: ${discordUserId}`);
      let ownerField;
      if (discordUserId) {
        let guildUser: GuildMember | DiscordUser | undefined;
        const user: DiscordUser = await client.users.fetch(discordUserId);
        try {
          guildUser = await guild.members.fetch(discordUserId);
        } catch (e) {
          logger.error(e);
        }
        if (!guildUser) {
          logger.error(
            `User ${discordUserId} not found in guild, using global user.`,
          );
          guildUser = user;
        }
        const userAvatarUrl = guildUser.displayAvatarURL();
        if (userAvatarUrl && userAvatarUrl.length > 0) {
          avatarUrl = userAvatarUrl;
        }
        // if (user.username === user.displayName) {
        //   ownerField = {
        //     name: "Owner",
        //     value: `<@${user.id}>`,
        //     inline: false,
        //   };
        // } else {
        //   ownerField = {
        //     name: "Owner*",
        //     value: `<@!${user.id}>`,
        //     inline: false,
        //   };
        // }
        ownerField = {
          name: "Owner",
          value: userMention(user.id),
          inline: false,
        };
      }

      const gatewayCount = packetGroup.serviceEnvelopes.filter(
        (value, index, self) =>
          self.findIndex((t) => t.gatewayId === value.gatewayId) === index,
      ).length;

      logger.info(`gatewayCount: ${gatewayCount}`);

      const infoFields: any = [];

      let mapUrl = "";

      if (portNum === 3) {
        // https://api.bortle.org/api/maps/static?lat=32&lon=-122.0&width=800&height=600&zoom=6

        const position = Position.decode(
          packetGroup.serviceEnvelopes[0].packet.decoded.payload,
        ) as DecodedPosition;
        // console.log(position);
        // Position {
        //   latitudeI: 379260350,
        //   longitudeI: -1225297610,
        //   altitude: 25,
        //   time: 1743031998,
        //   locationSource: 1,
        //   groundSpeed: 0,
        //   groundTrack: 0,
        //   precisionBits: 32
        // }
        // envelope.packet.decoded.payload = `Latitude: ${position.latitudeI / 10000000} Longitude: ${position.longitudeI / 10000000} ${position.altitude ? ` Altitude: ${position.altitude}m` : ""}`;
        // console.log(from, envelope.packet.decoded.payload);

        infoFields.push({
          name: "Latitude",
          value: `${position.latitudeI / 10000000}`,
          inline: true,
        });
        infoFields.push({
          name: "Longitude",
          value: `${position.longitudeI / 10000000}`,
          inline: true,
        });
        if (position.altitude) {
          infoFields.push({
            name: "Altitude",
            value: `${position.altitude}m`,
            inline: true,
          });
        }
        // if (position.groundSpeed) {
        //   infoFields.push({
        //     name: "Altitude",
        //     value: `${position.altitude}m`,
        //     inline: true,
        //   });
        // }
        // if (position.groundSpeed) {
        //   infoFields.push({
        //     name: "Altitude",
        //     value: `${position.altitude}m`,
        //     inline: true,
        //   });
        // }
        // if (position.groundSpeed) {
        //   infoFields.push({
        //     name: "Altitude",
        //     value: `${position.altitude}m`,
        //     inline: true,
        //   });
        // }

        console.log(position);

        try {
          msgText = decodedPositionToString(position);
        } catch (e) {
          logger.error(e);
        }
        mapUrl = `https://api.smerty.org/api/v1/maps/static?lat=${position.latitudeI / 10000000}&lon=${position.longitudeI / 10000000}&width=400&height=400&zoom=12`;
      }

      console.log(mapUrl);

      if (ownerField) {
        infoFields.push({
          name: ownerField.name,
          value: ownerField.value,
          inline: ownerField.inline,
        });
      }

      infoFields.push({
        name: "Packet",
        value: `[${packetGroup.id.toString(16)}](https://meshview.bayme.sh/packet/${packetGroup.id})`,
        inline: true,
      });

      if (balloonNode) {
        infoFields.push({
          name: "Channel",
          value: `${packetGroup.serviceEnvelopes[0].channelId}`,
          inline: true,
        });
      }

      infoFields.push({
        name: "Hop Limit",
        value: `${maxHopStart}`,
        inline: true,
      });
      infoFields.push({
        name: "Gateway Count",
        value: `${gatewayCount}`,
        inline: true,
      });

      // const gatewayFields = packetGroup.serviceEnvelopes
      //   .filter(
      //     (value, index, self) =>
      //       self.findIndex((t) => t.gatewayId === value.gatewayId) === index,
      //   )
      //   .map((envelope) => {
      //     const gatewayDelay =
      //       envelope.mqttTime.getTime() - packetGroup.time.getTime();

      //     let gatewayDisplaName = envelope.gatewayId.replace("!", "");
      //     if (nodeInfos[envelope.gatewayId.replace("!", "")]) {
      //       gatewayDisplaName =
      //         nodeInfos[envelope.gatewayId.replace("!", "")].shortName;
      //     }

      //     let hopText = `${envelope.packet.hopStart - envelope.packet.hopLimit}/${envelope.packet.hopStart} hops`;

      //     if (
      //       envelope.packet.hopStart === 0 &&
      //       envelope.packet.hopLimit === 0
      //     ) {
      //       hopText = `${envelope.packet.rxSnr} / ${envelope.packet.rxRssi} dBm`;
      //     } else if (
      //       envelope.packet.hopStart - envelope.packet.hopLimit ===
      //       0
      //     ) {
      //       hopText = `${envelope.packet.rxSnr} / ${envelope.packet.rxRssi} dBm ${envelope.packet.hopStart - envelope.packet.hopLimit}/${envelope.packet.hopStart} hops`;
      //     }

      //     if (envelope.gatewayId.replace("!", "") === nodeIdHex) {
      //       hopText = `Self Gated ${envelope.packet.hopStart} hopper`;
      //     }

      //     if (maxHopStart !== envelope.packet.hopStart) {
      //       hopText = `:older_man: ${envelope.packet.hopStart - envelope.packet.hopLimit}/${envelope.packet.hopStart} hops`;
      //     }

      //     if (envelope.mqttServer === "public") {
      //       hopText = `:poop: ${envelope.packet.hopStart - envelope.packet.hopLimit}/${envelope.packet.hopStart} hops`;
      //     }

      //     return {
      //       name: `Gateway`,
      //       value: `[${gatewayDisplaName} (${hopText})](https://meshview.bayme.sh/packet_list/${nodeHex2id(envelope.gatewayId.replace("!", ""))})${gatewayDelay > 0 ? " (" + gatewayDelay + "ms)" : ""}`,
      //       inline: true,
      //     };
      //   });

      // First, group gateways by hop count.
      const gatewayGroups = {};

      packetGroup.serviceEnvelopes
        .filter(
          (value, index, self) =>
            self.findIndex((t) => t.gatewayId === value.gatewayId) === index,
        )
        .forEach((envelope) => {
          const gatewayDelay =
            envelope.mqttTime.getTime() - packetGroup.time.getTime();
          let gatewayDisplayName = envelope.gatewayId.replace("!", "");
          if (nodeInfos[gatewayDisplayName]) {
            gatewayDisplayName = nodeInfos[gatewayDisplayName].shortName;
          }

          // Calculate the hop text based on several conditions.
          let hopText;
          if (
            typeof envelope.packet.hopStart === "number" &&
            typeof envelope.packet.hopLimit === "number"
          ) {
            hopText = ``;
            if (
              envelope.packet.hopStart === 0 &&
              envelope.packet.hopLimit === 0
            ) {
              hopText = `(${envelope.packet.rxSnr} / ${envelope.packet.rxRssi} dBm)`;
            } else if (
              envelope.packet.hopStart - envelope.packet.hopLimit ===
              0
            ) {
              hopText = `(${envelope.packet.rxSnr} / ${envelope.packet.rxRssi} dBm)`;
            }
            if (envelope.gatewayId.replace("!", "") === nodeIdHex) {
              hopText = `(Self Gated)`;
            }
            if (maxHopStart !== envelope.packet.hopStart) {
              // hopText = `(:older_man: ${envelope.packet.hopStart - envelope.packet.hopLimit}/${envelope.packet.hopStart} hops)`;
            }
            if (envelope.mqttServer === "public") {
              // hopText = `(:poop: ${envelope.packet.hopStart - envelope.packet.hopLimit}/${envelope.packet.hopStart} hops)`;
            }
          } else {
            hopText = "Unknown";
          }

          // Determine the grouping key.
          // Here we use (hopStart - hopLimit) if available, otherwise "Unknown Hops".
          let hopGroup;
          if (
            typeof envelope.packet.hopStart === "number" &&
            typeof envelope.packet.hopLimit === "number" &&
            maxHopStart === envelope.packet.hopStart
          ) {
            hopGroup = envelope.packet.hopStart - envelope.packet.hopLimit;
          } else {
            hopGroup = "Unknown Hops";
          }

          // Create the gateway field text.
          // const gatewayFieldText =
          //   `[${gatewayDisplayName} ${hopText}` +
          //   (gatewayDelay > 0 ? `  - ${gatewayDelay}ms` : "") +
          //   `](https://meshview.bayme.sh/packet_list/${nodeHex2id(envelope.gatewayId.replace("!", ""))})`;
          const gatewayFieldText =
            `[${gatewayDisplayName} ${hopText}` +
            `](https://meshview.bayme.sh/packet_list/${nodeHex2id(envelope.gatewayId.replace("!", ""))})`;

          // Group the text.
          if (!gatewayGroups[hopGroup]) {
            gatewayGroups[hopGroup] = [];
          }
          gatewayGroups[hopGroup].push(gatewayFieldText);
        });

      // Now, create one field per hop group. Unknown hops are placed last.
      // const gatewayFields2 = Object.keys(gatewayGroups)
      //   .sort((a, b) => {
      //     if (a === "Unknown Hops") return 1;
      //     if (b === "Unknown Hops") return -1;
      //     return a - b;
      //   })
      //   .map((hop) => ({
      //     name:
      //       hop === "Unknown Hops"
      //         ? "Unknown Hops"
      //         : hop === "0"
      //           ? "Direct"
      //           : `${hop} hops`,
      //     value: gatewayGroups[hop].join("\n"),
      //     inline: false,
      //   }));

      // Now, create one field per hop group, splitting if a field's value exceeds 1024 characters.
      const gatewayFields2: any = [];
      Object.keys(gatewayGroups)
        .sort((a, b) => {
          if (a === "Unknown Hops") return 1;
          if (b === "Unknown Hops") return -1;
          return a - b;
        })
        .forEach((hop) => {
          // Set a base name for the field
          const baseName =
            hop === "Unknown Hops"
              ? "Unknown Hops"
              : hop === "0"
                ? "Direct"
                : `${hop} hops`;

          // Prepare to build the field text by iterating over each line (gatewayFieldText) in the group.
          const lines = gatewayGroups[hop];
          let currentChunk = "";
          let fieldIndex = 0;

          lines.forEach((line) => {
            // +1 accounts for the newline if currentChunk isn't empty.
            if (
              currentChunk.length +
                line.length +
                (currentChunk.length > 0 ? 1 : 0) >
              1024
            ) {
              // Push the current chunk as a field.
              gatewayFields2.push({
                name: fieldIndex === 0 ? baseName : `${baseName} continued`,
                value: currentChunk,
                inline: false,
              });
              fieldIndex++;
              // Start a new chunk with the current line.
              currentChunk = line;
            } else {
              // Append the line, adding a newline if needed.
              currentChunk =
                currentChunk.length > 0
                  ? currentChunk + (hop === "0" ? "\n" : " | ") + line
                  : line;
            }
          });

          // Push any remaining text in the current chunk.
          if (currentChunk.length > 0) {
            gatewayFields2.push({
              name: fieldIndex === 0 ? baseName : `${baseName} (continued)`,
              value: currentChunk,
              inline: false,
            });
          }
        });

      const content = {
        username: "Mesh Bot",
        avatar_url:
          "https://cdn.discordapp.com/app-icons/1240017058046152845/295e77bec5f9a44f7311cf8723e9c332.png",
        embeds: [
          {
            url: `https://meshview.bayme.sh/packet_list/${packet.from}`,
            color: 6810260,
            timestamp: new Date(packet.rxTime * 1000).toISOString(),

            author: {
              name: `${nodeInfos[nodeIdHex] ? nodeInfos[nodeIdHex].longName : "Unknown"}`,
              url: `https://meshview.bayme.sh/packet_list/${packet.from}`,
              icon_url: avatarUrl,
            },
            title: `${nodeInfos[nodeIdHex] ? nodeInfos[nodeIdHex].shortName : "UNK"}`,
            description: msgText,
            fields: [...infoFields, ...gatewayFields2].slice(0, 25),
          },
        ],
      };

      if (mapUrl) {
        content.embeds[0].image = {
          url: mapUrl,
        };
      }
      // console.log(content);

      return content;
    } catch (err) {
      logger.error("Error: " + String(err));
      // Sentry.captureException(err);
    }
  };

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
      processTextMessage(packetGroup);
    });
  }, 5000);

  mqttClient.on("error", (err) => {
    console.error("MQTT Client Error:", err);
  });

  mqttClient.on("connect", () => {
    logger.info("Connected to MQTT broker");
    // Subscribe to the topic where your packets are published.
    mqttClient.subscribe("msh/US/#", (err) => {
      if (err) {
        console.error("Error subscribing to MQTT topic:", err);
      } else {
        logger.info("Subscribed to MQTT topic");
      }
    });
  });

  mqttClient.on("message", async (topic, message) => {
    try {
      if (topic.includes("msh")) {
        if (!topic.includes("/json")) {
          if (topic.includes("/stat/")) {
            return;
          }
          let envelope;
          try {
            envelope = ServiceEnvelope.decode(message);
          } catch (envDecodeErr) {
            if (
              String(envDecodeErr).indexOf(
                "invalid wire type 7 at offset 1",
              ) === -1
            ) {
              logger.error(
                `MessageId: Error decoding service envelope: ${envDecodeErr}`,
              );
            }
            return;
          }
          if (!envelope || !envelope.packet) {
            return;
          }

          if (
            MQTT_TOPICS.some((t) => {
              return topic.startsWith(t);
            }) ||
            meshPacketCache.exists(envelope.packet.id)
          ) {
            // attempt to decrypt encrypted packets
            const isEncrypted = envelope.packet.encrypted?.length > 0;
            if (isEncrypted) {
              const decoded = decrypt(envelope.packet);
              if (decoded) {
                envelope.packet.decoded = decoded;
              }
            }
            const portnum = envelope.packet?.decoded?.portnum;
            if (portnum === 1) {
              meshPacketCache.add(envelope, topic, MQTT_BROKER_URL);
            } else if (portnum === 3) {
              const from = envelope.packet.from.toString(16);
              // logger.info(`Received position packet from ${from}`);
              const isTrackerNode = await meshRedis.isTrackerNode(from);
              const isBalloonNode = await meshRedis.isBalloonNode(from);
              if (!isTrackerNode && !isBalloonNode) {
                return;
              }
              const position = Position.decode(envelope.packet.decoded.payload);
              if (!position.latitudeI && !position.longitudeI) {
                return;
              }
              meshPacketCache.add(envelope, topic, MQTT_BROKER_URL);
            } else if (portnum === 4) {
              if (!NODE_INFO_UPDATES) {
                logger.info("Node info updates disabled");
                return;
              }
              const user = User.decode(envelope.packet.decoded.payload);
              const from = nodeId2hex(envelope.packet.from);
              meshRedis.updateNodeDB(
                from,
                user.longName,
                user,
                envelope.packet.hopStart,
              );
            }
          }
        }
      }
    } catch (err) {
      logger.error("Error: " + String(err));
    }
  });
});

function createNonce(packetId, fromNode) {
  // Expand packetId to 64 bits
  const packetId64 = BigInt(packetId);

  // Initialize block counter (32-bit, starts at zero)
  const blockCounter = 0;

  // Create a buffer for the nonce
  const buf = Buffer.alloc(16);

  // Write packetId, fromNode, and block counter to the buffer
  buf.writeBigUInt64LE(packetId64, 0);
  buf.writeUInt32LE(fromNode, 8);
  buf.writeUInt32LE(blockCounter, 12);

  return buf;
}

/**
 * References:
 * https://github.com/crypto-smoke/meshtastic-go/blob/develop/radio/aes.go#L42
 * https://github.com/pdxlocations/Meshtastic-MQTT-Connect/blob/main/meshtastic-mqtt-connect.py#L381
 */
function decrypt(packet) {
  // attempt to decrypt with all available decryption keys
  for (const decryptionKey of decryptionKeys) {
    try {
      // console.log(`using decryption key: ${decryptionKey}`);
      // convert encryption key to buffer
      const key = Buffer.from(decryptionKey, "base64");

      // create decryption iv/nonce for this packet
      const nonceBuffer = createNonce(packet.id, packet.from);

      // create aes-128-ctr decipher
      const decipher = crypto.createDecipheriv("aes-128-ctr", key, nonceBuffer);

      // decrypt encrypted packet
      const decryptedBuffer = Buffer.concat([
        decipher.update(packet.encrypted),
        decipher.final(),
      ]);

      // parse as data message
      return Data.decode(decryptedBuffer);
    } catch (e) {
      // console.log(e);
    }
  }

  // couldn't decrypt
  return null;
}

// Log in to Discord.
client.login(DISCORD_TOKEN);
