import { GuildMember, User as DiscordUser, userMention } from "discord.js";
import { nodeHex2id, nodeId2hex } from "./NodeUtils";
import meshRedis from "./MeshRedis";
import logger from "./Logger";
import { DecodedPosition, decodedPositionToString } from "./MeshPacketCache";

const MESHVIEW_BASE_URL = process.env.MESHVIEW_BASE_URL;

export const createDiscordMessage = async (packetGroup, text, balloonNode, client, guild) => {
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

    const maxHopStart = packetGroup.serviceEnvelopes.reduce((acc, se) => {
      const hopStart = se.packet.hopStart;
      return hopStart > acc ? hopStart : acc;
    }, 0);

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
      const position = Position.decode(
        packetGroup.serviceEnvelopes[0].packet.decoded.payload,
      ) as DecodedPosition;

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

      logger.info(position);

      try {
        msgText = decodedPositionToString(position);
      } catch (e) {
        logger.error(e);
      }
      mapUrl = `https://api.smerty.org/api/v1/maps/static?lat=${position.latitudeI / 10000000}&lon=${position.longitudeI / 10000000}&width=400&height=400&zoom=12`;
    }

    logger.info(mapUrl);

    if (ownerField) {
      infoFields.push({
        name: ownerField.name,
        value: ownerField.value,
        inline: ownerField.inline,
      });
    }

    infoFields.push({
      name: "Packet",
      value: `[${packetGroup.id.toString(16)}](${MESHVIEW_BASE_URL}/packet/${packetGroup.id})`,
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
          }
          if (envelope.mqttServer === "public") {
          }
        } else {
          hopText = "Unknown";
        }

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

        const gatewayFieldText =
          `[${gatewayDisplayName} ${hopText}` +
          `](${MESHVIEW_BASE_URL}/packet_list/${nodeHex2id(envelope.gatewayId.replace("!", ""))})`;

        if (!gatewayGroups[hopGroup]) {
          gatewayGroups[hopGroup] = [];
        }
        gatewayGroups[hopGroup].push(gatewayFieldText);
      });

    const gatewayFields2: any = [];
    Object.keys(gatewayGroups)
      .sort((a, b) => {
        if (a === "Unknown Hops") return 1;
        if (b === "Unknown Hops") return -1;
        return a - b;
      })
      .forEach((hop) => {
        const baseName =
          hop === "Unknown Hops"
            ? "Unknown Hops"
            : hop === "0"
              ? "Direct"
              : `${hop} hops`;

        const lines = gatewayGroups[hop];
        let currentChunk = "";
        let fieldIndex = 0;

        lines.forEach((line) => {
          if (
            currentChunk.length +
              line.length +
              (currentChunk.length > 0 ? 1 : 0) >
            1024
          ) {
            gatewayFields2.push({
              name: fieldIndex === 0 ? baseName : `${baseName} continued`,
              value: currentChunk,
              inline: false,
            });
            fieldIndex++;
            currentChunk = line;
          } else {
            currentChunk =
              currentChunk.length > 0
                ? currentChunk + (hop === "0" ? "\n" : " | ") + line
                : line;
          }
        });

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
          url: `${MESHVIEW_BASE_URL}/packet_list/${packet.from}`,
          color: 6810260,
          timestamp: new Date(packet.rxTime * 1000).toISOString(),

          author: {
            name: `${nodeInfos[nodeIdHex] ? nodeInfos[nodeIdHex].longName : "Unknown"}`,
            url: `${MESHVIEW_BASE_URL}/packet_list/${packet.from}`,
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

    return content;
  } catch (err) {
    logger.error("Error: " + String(err));
  }
};
