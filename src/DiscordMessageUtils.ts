import { userMention } from "discord.js";
import { nodeHex2id, nodeId2hex } from "./NodeUtils";
import { Position } from "./Protobufs";
import type { LoggerLike } from "./Logger";
import { DecodedPosition, decodedPositionToString } from "./MeshPacketCache";
import type { MeshRedis } from "./MeshRedis";

export const createDiscordMessage = async (
  packetGroup: any,
  text: string,
  client: any,
  guild: any,
  meshRedis: MeshRedis,
  meshViewBaseUrl: string,
  meshLogger: LoggerLike,
  meshId: string,
  meshRedisMap: Map<string, MeshRedis>,
  options?: { stripLinks?: boolean },
) => {
  try {
    const packet = packetGroup.serviceEnvelopes[0].packet;
    const from = nodeId2hex(packet.from);
    const nodeIdHex = nodeId2hex(from);
    const portNum = packet?.decoded?.portnum;
    let msgText = text;

    const gatewayIdsByMesh = new Map<string, Set<string>>();
    packetGroup.serviceEnvelopes.forEach((envelope: any) => {
      const gatewayId = envelope.gatewayId.replace("!", "");
      const gatewayMeshId = envelope.gatewayMeshId || envelope.meshId || meshId;
      if (!gatewayIdsByMesh.has(gatewayMeshId)) {
        gatewayIdsByMesh.set(gatewayMeshId, new Set());
      }
      gatewayIdsByMesh.get(gatewayMeshId)?.add(gatewayId);
    });

    if (!gatewayIdsByMesh.has(meshId)) {
      gatewayIdsByMesh.set(meshId, new Set());
    }
    gatewayIdsByMesh.get(meshId)?.add(from);

    const nodeInfosByMesh = new Map<string, Record<string, any>>();
    for (const [gatewayMeshId, gatewayIds] of gatewayIdsByMesh.entries()) {
      const redisForMesh = meshRedisMap.get(gatewayMeshId) ?? meshRedis;
      const infos = await redisForMesh.getNodeInfos(
        Array.from(gatewayIds),
        false,
      );
      nodeInfosByMesh.set(gatewayMeshId, infos);
    }

    const getNodeInfo = (nodeId: string, primaryMeshId: string) => {
      const primary = nodeInfosByMesh.get(primaryMeshId);
      if (primary && primary[nodeId]) {
        return primary[nodeId];
      }
      for (const infos of nodeInfosByMesh.values()) {
        if (infos && infos[nodeId]) {
          return infos[nodeId];
        }
      }
      return null;
    };

    let avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";

    const maxHopStart = packetGroup.serviceEnvelopes.reduce((acc: number, se: any) => {
      const hopStart = se.packet.hopStart;
      return hopStart > acc ? hopStart : acc;
    }, 0);

    const discordUserId = await meshRedis.getDiscordUserId(nodeIdHex);
    // logger.info(`nodeIdHex: ${nodeIdHex}, discordUserId: ${discordUserId}`);
    let ownerField;
    if (discordUserId) {
      let guildUser: any;
      const user: any = await client.users.fetch(discordUserId);
      try {
        guildUser = await guild.members.fetch(discordUserId);
      } catch (e) {
        meshLogger.error(String(e));
      }
      if (!guildUser) {
        meshLogger.error(
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
      (value: any, index: number, self: any[]) =>
        self.findIndex(
          (t) =>
            t.gatewayId === value.gatewayId &&
            (t.gatewayMeshId ?? t.meshId ?? meshId) ===
              (value.gatewayMeshId ?? value.meshId ?? meshId),
        ) === index,
    ).length;

    const infoFields: any = [];

    let mapUrl = "";

    if (portNum === 3) {
      const position = Position.decode(
        packetGroup.serviceEnvelopes[0].packet.decoded.payload,
      ) as DecodedPosition;

      infoFields.push({
        name: "Latitude",
        value: `${(position.latitudeI ?? 0) / 10000000}`,
        inline: true,
      });
      infoFields.push({
        name: "Longitude",
        value: `${(position.longitudeI ?? 0) / 10000000}`,
        inline: true,
      });
      if (position.altitude) {
        infoFields.push({
          name: "Altitude",
          value: `${position.altitude}m`,
          inline: true,
        });
      }

      meshLogger.info(`Position: ${JSON.stringify(position)}`);

      try {
        msgText = decodedPositionToString(position);
      } catch (e) {
        meshLogger.error(`Error decoding position: ${String(e)}`);
      }
      mapUrl = `https://api.smerty.org/api/v1/maps/static?lat=${(position.latitudeI ?? 0) / 10000000}&lon=${(position.longitudeI ?? 0) / 10000000}&width=400&height=400&zoom=12`;
      meshLogger.info(`Map URL: ${mapUrl}`);
    }

    if (ownerField) {
      infoFields.push({
        name: ownerField.name,
        value: ownerField.value,
        inline: ownerField.inline,
      });
    }

    infoFields.push({
      name: "Packet",
      value: `[${packetGroup.id.toString(16)}](${meshViewBaseUrl}/packet/${packetGroup.id})`,
      inline: true,
    });

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

    const gatewayGroups: Record<string, string[]> = {};
    const gatewayGroupsPlain: Record<string, string[]> = {};

    packetGroup.serviceEnvelopes
      .filter(
        (value: any, index: number, self: any[]) =>
          self.findIndex(
            (t) =>
              t.gatewayId === value.gatewayId &&
              (t.gatewayMeshId ?? t.meshId ?? meshId) ===
                (value.gatewayMeshId ?? value.meshId ?? meshId),
          ) === index,
      )
        .forEach((envelope: any) => {
        const gatewayDelay =
          envelope.mqttTime.getTime() - packetGroup.time.getTime();
        const gatewayMeshId = envelope.gatewayMeshId || envelope.meshId || meshId;
        let gatewayDisplayName = envelope.gatewayId.replace("!", "");
        const gatewayInfos = nodeInfosByMesh.get(gatewayMeshId);
        if (gatewayInfos && gatewayInfos[gatewayDisplayName]) {
          gatewayDisplayName = gatewayInfos[gatewayDisplayName].shortName;
        } else {
          const fallbackInfo = getNodeInfo(gatewayDisplayName, meshId);
          if (fallbackInfo?.shortName) {
            gatewayDisplayName = fallbackInfo.shortName;
          }
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
          `](${meshViewBaseUrl}/packet_list/${nodeHex2id(envelope.gatewayId.replace("!", ""))})`;
        const gatewayFieldTextPlain = `${gatewayDisplayName} ${hopText}`.trim();

        if (!gatewayGroups[hopGroup]) {
          gatewayGroups[hopGroup] = [];
        }
        if (!gatewayGroupsPlain[hopGroup]) {
          gatewayGroupsPlain[hopGroup] = [];
        }
        gatewayGroups[hopGroup].push(gatewayFieldText);
        gatewayGroupsPlain[hopGroup].push(gatewayFieldTextPlain);
      });

    const buildGatewayFields = (groups: Record<string, string[]>) => {
      const gatewayFields: any = [];
      const clampLine = (line: string) => {
        if (line.length <= 1024) return line;
        meshLogger.error(
          `Gateway field line exceeds 1024 chars (len=${line.length}), truncating.`,
        );
        return line.slice(0, 1021) + "...";
      };
      Object.keys(groups)
      .sort((a, b) => {
        if (a === "Unknown Hops") return 1;
        if (b === "Unknown Hops") return -1;
        return Number(a) - Number(b);
      })
      .forEach((hop) => {
        const baseName =
          hop === "Unknown Hops"
            ? "Unknown Hops"
            : hop === "0"
              ? "Direct"
              : `${hop} hops`;

        const lines = groups[hop];
        let currentChunk = "";
        let fieldIndex = 0;

        lines.forEach((line) => {
          const safeLine = clampLine(line);
          if (
            currentChunk.length +
              safeLine.length +
              (currentChunk.length > 0 ? 1 : 0) >
            1024
          ) {
            gatewayFields.push({
              name: fieldIndex === 0 ? baseName : `${baseName} continued`,
              value: currentChunk,
              inline: false,
            });
            fieldIndex++;
            currentChunk = safeLine;
          } else {
            currentChunk =
              currentChunk.length > 0
                ? currentChunk + (hop === "0" ? "\n" : " | ") + safeLine
                : safeLine;
          }
        });

        if (currentChunk.length > 0) {
          gatewayFields.push({
            name: fieldIndex === 0 ? baseName : `${baseName} (continued)`,
            value: currentChunk,
            inline: false,
          });
        }
      });
      return gatewayFields;
    };

    const gatewayFields2: any = buildGatewayFields(gatewayGroups);

    if (msgText.length > 4096) {
      meshLogger.error(
        `Embed description exceeds 4096 chars (len=${msgText.length}): ${msgText}`,
      );
    }

    const computeEmbedSize = (fields: any[], description: string) => {
      let size = 0;
      size += `${getNodeInfo(nodeIdHex, meshId)?.longName ?? "Unknown"}`.length;
      size += `${getNodeInfo(nodeIdHex, meshId)?.shortName ?? "UNK"}`.length;
      size += description.length;
      fields.forEach((field) => {
        size += (field.name?.length || 0) + (field.value?.length || 0);
      });
      return size;
    };

    const safeDescription = msgText.length > 4096 ? msgText.slice(0, 4096) : msgText;
    let finalGatewayFields = gatewayFields2;
    let finalEmbedUrl: string | undefined = `${meshViewBaseUrl}/packet_list/${packet.from}`;
    let finalAuthorUrl: string | undefined = `${meshViewBaseUrl}/packet_list/${packet.from}`;
    let finalMapUrl: string | undefined = mapUrl;

    const sizeWithLinks = computeEmbedSize(finalGatewayFields, safeDescription);
    if (options?.stripLinks || sizeWithLinks > 6000) {
      meshLogger.error(
        options?.stripLinks
          ? "Embed link stripping forced by caller."
          : `Embed size ${sizeWithLinks} exceeds 6000; removing non-packet links.`,
      );
      finalGatewayFields = buildGatewayFields(gatewayGroupsPlain);
      finalEmbedUrl = undefined;
      finalAuthorUrl = undefined;
      finalMapUrl = undefined;
    }

    const content: any = {
      username: "Mesh Bot",
      avatar_url:
        "https://cdn.discordapp.com/app-icons/1240017058046152845/295e77bec5f9a44f7311cf8723e9c332.png",
      embeds: [
        {
          url: finalEmbedUrl,
          color: 6810260,
          timestamp: new Date(packet.rxTime * 1000).toISOString(),

          author: {
            name: `${getNodeInfo(nodeIdHex, meshId)?.longName ?? "Unknown"}`,
            url: finalAuthorUrl,
            icon_url: avatarUrl,
          },
          title: `${getNodeInfo(nodeIdHex, meshId)?.shortName ?? "UNK"}`,
          description: safeDescription,
          fields: [...infoFields, ...finalGatewayFields].slice(0, 25),
        },
      ],
    };

    if (finalMapUrl) {
      content.embeds[0].image = {
        url: finalMapUrl,
      };
    }

    return content;
  } catch (err) {
    meshLogger.error("Error: " + String(err));
  }
};
