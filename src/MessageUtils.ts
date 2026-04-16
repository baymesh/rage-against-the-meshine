import process from "node:process";
import { nodeId2hex } from "./NodeUtils";
import { createDiscordMessage } from "./DiscordMessageUtils";
import logger from "./Logger";
import type { CompiledChannelRegexRule } from "./MultiMeshConfig";
import type { MeshRedis } from "./MeshRedis";

type MessageRoutingContext = {
  client: any;
  guild: any;
  discordMessageIdCache: any;
  channelRegexRules: CompiledChannelRegexRule[];
  resolveChannelById: (channelId: string) => any | null;
  meshRedis: MeshRedis;
  meshViewBaseUrl: string;
  meshId: string;
  crossMeshPeers: string[];
  meshRedisMap: Map<string, MeshRedis>;
};

const processTextMessage = async (packetGroup: any, context: MessageRoutingContext) => {
  const {
    client,
    guild,
    discordMessageIdCache,
    channelRegexRules,
    resolveChannelById,
    meshRedis,
    meshViewBaseUrl,
    meshId,
    crossMeshPeers,
    meshRedisMap,
  } = context;
  const meshLogger = logger.withTag(`mesh:${meshId}`);
  const allowedMeshes = new Set([meshId, ...crossMeshPeers]);
  const filteredEnvelopes = packetGroup.serviceEnvelopes.filter(
    (envelope: any) => allowedMeshes.has(envelope.meshId ?? meshId),
  );
  if (
    !filteredEnvelopes.some(
      (envelope: any) => (envelope.meshId ?? meshId) === meshId,
    )
  ) {
    return;
  }

  const filteredPacketGroup = {
    ...packetGroup,
    serviceEnvelopes: filteredEnvelopes,
  };

  const packet = filteredPacketGroup.serviceEnvelopes[0].packet;
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
    meshLogger.info(
      `MessageId: ${packetGroup.id} Not to public channel: ${filteredPacketGroup.serviceEnvelopes.map((envelope: any) => envelope.topic)}`,
    );
    return;
  }

  const gatewayCount = filteredPacketGroup.serviceEnvelopes.filter(
    (value: any, index: number, self: any[]) =>
      self.findIndex(
        (t) =>
          t.gatewayId === value.gatewayId &&
          (t.gatewayMeshId ?? t.meshId ?? meshId) ===
            (value.gatewayMeshId ?? value.meshId ?? meshId),
      ) === index,
  ).length;

  const existsInDiscordCache = discordMessageIdCache.exists(packet.id.toString());

  const replyId = packet.decoded.replyId ?? 0;
  meshLogger.info(
    `${ existsInDiscordCache ? 'update' : 'create'}DiscordMessage:( text: ${text} | gatewayCount: ${gatewayCount}${replyId > 0 ? ` | reply_id: ${replyId}` : ""} )`,
  );

  const nodeId = nodeId2hex(packet.from);

  // Check if the node is banned
  const isBannedNode = await meshRedis.isBannedNode(nodeId);
  if (isBannedNode) {
    meshLogger.info(`Node ${nodeId} is banned. Ignoring message.`);
    return;
  }

  const content = await createDiscordMessage(
    filteredPacketGroup,
    text,
    client,
    guild,
    meshRedis,
    meshViewBaseUrl,
    meshLogger,
    meshId,
    meshRedisMap,
  );

  const channelId = filteredPacketGroup.serviceEnvelopes[0].channelId;
  const matchedRule = channelRegexRules.find((rule) => {
    const matched = rule.regex.test(channelId);
    if (rule.regex.global) {
      rule.regex.lastIndex = 0;
    }
    return matched;
  });

  if (!matchedRule) {
    meshLogger.warn(
      `No regex match for channelId '${channelId}', packetId: ${packet.id.toString()}`,
    );
    return;
  }

  const discordChannel = resolveChannelById(matchedRule.discordChannelId);

  if (!discordChannel) {
    meshLogger.warn(
      `No discord channel found for id: ${matchedRule.discordChannelId}`,
    );
    return;
  }

  if (existsInDiscordCache) {
    // update original message
    // logger.info("Updating message: " + packet.id.toString());
    const discordMessageId = discordMessageIdCache.get(packet.id.toString());
    try {
      const originalMessage =
        await discordChannel.messages.fetch(discordMessageId);
      await originalMessage.edit(content);
    } catch (err) {
      meshLogger.error(
        `Discord update failed( packetId: ${packet.id.toString()}, error: ${String(err)} )`,
      );
      if (String(err).includes("MAX_EMBED_SIZE_EXCEEDED")) {
        try {
          const fallbackContent = await createDiscordMessage(
            filteredPacketGroup,
            text,
            client,
            guild,
            meshRedis,
            meshViewBaseUrl,
            meshLogger,
            meshId,
            meshRedisMap,
            { stripLinks: true },
          );
          await originalMessage.edit(fallbackContent);
        } catch (fallbackErr) {
          meshLogger.error(
            `Discord update fallback failed( packetId: ${packet.id.toString()}, error: ${String(fallbackErr)} )`,
          );
        }
      }
    }
  } else {
    // send new message
    // logger.info("Sending message: " + packet.id.toString());
    try {
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
    } catch (err) {
      meshLogger.error(
        `Discord send failed( packetId: ${packet.id.toString()}, error: ${String(err)} )`,
      );
      const failedText =
        content?.embeds?.[0]?.description ?? text;
      meshLogger.error(
        `Discord send payload (packetId: ${packet.id.toString()}): ${failedText}`,
      );
      if (String(err).includes("MAX_EMBED_SIZE_EXCEEDED")) {
        try {
          const fallbackContent = await createDiscordMessage(
            filteredPacketGroup,
            text,
            client,
            guild,
            meshRedis,
            meshViewBaseUrl,
            meshLogger,
            meshId,
            meshRedisMap,
            { stripLinks: true },
          );
          const retryMessage = await discordChannel.send(fallbackContent);
          discordMessageIdCache.set(packet.id.toString(), retryMessage.id);
        } catch (fallbackErr) {
          meshLogger.error(
            `Discord send fallback failed( packetId: ${packet.id.toString()}, error: ${String(fallbackErr)} )`,
          );
        }
      }
    }
  }
};

export { processTextMessage };
