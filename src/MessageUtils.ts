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
  } = context;
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
      `MessageId: ${packetGroup.id} Not to public channel: ${packetGroup.serviceEnvelopes.map((envelope: any) => envelope.topic)}`,
    );
    return;
  }

  const gatewayCount = packetGroup.serviceEnvelopes.filter(
    (value: any, index: number, self: any[]) =>
      self.findIndex((t) => t.gatewayId === value.gatewayId) === index,
  ).length;

  const existsInDiscordCache = discordMessageIdCache.exists(packet.id.toString());

  const replyId = packet.decoded.replyId ?? 0;
  logger.info(
    `${ existsInDiscordCache ? 'update' : 'create'}DiscordMessage:( text: ${text} | gatewayCount: ${gatewayCount}${replyId > 0 ? ` | reply_id: ${replyId}` : ""} )`,
  );

  const nodeId = nodeId2hex(packet.from);

  // Check if the node is banned
  const isBannedNode = await meshRedis.isBannedNode(nodeId);
  if (isBannedNode) {
    logger.info(`Node ${nodeId} is banned. Ignoring message.`);
    return;
  }

  const content = await createDiscordMessage(
    packetGroup,
    text,
    client,
    guild,
    meshRedis,
    meshViewBaseUrl,
  );

  const channelId = packetGroup.serviceEnvelopes[0].channelId;
  const matchedRule = channelRegexRules.find((rule) => {
    const matched = rule.regex.test(channelId);
    if (rule.regex.global) {
      rule.regex.lastIndex = 0;
    }
    return matched;
  });

  if (!matchedRule) {
    logger.warn(
      `[mesh:${meshId}] No regex match for channelId '${channelId}', packetId: ${packet.id.toString()}`,
    );
    return;
  }

  const discordChannel = resolveChannelById(matchedRule.discordChannelId);

  if (!discordChannel) {
    logger.warn(
      `[mesh:${meshId}] No discord channel found for id: ${matchedRule.discordChannelId}`,
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
      logger.error(`Discord update failed( packetId: ${packet.id.toString()}, error: ${String(err)} )`);
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
      logger.error(`Discord send failed( packetId: ${packet.id.toString()}, error: ${String(err)} )`);
      const failedText =
        content?.embeds?.[0]?.description ?? text;
      logger.error(
        `Discord send payload (packetId: ${packet.id.toString()}): ${failedText}`,
      );
    }
  }
};

export { processTextMessage };
