import { nodeId2hex } from "./NodeUtils";
import { createDiscordMessage } from "./DiscordMessageUtils";
import meshRedis from "./MeshRedis";
import logger from "./Logger";

const processTextMessage = async (
  packetGroup,
  client,
  guild,
  discordMessageIdCache,
  habChannel,
  msChannel,
  lfChannel,
  mfChannel,
  mfTestChannel,
) => {
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

  const nodeId = nodeId2hex(packet.from);

  // Check if the node is banned
  const isBannedNode = await meshRedis.isBannedNode(nodeId);
  if (isBannedNode) {
    logger.info(`Node ${nodeId} is banned. Ignoring message.`);
    return;
  }

  const balloonNode = await meshRedis.isBalloonNode(nodeId);

  const content = await createDiscordMessage(
    packetGroup,
    text,
    balloonNode,
    client,
    guild,
  );

  const getDiscordChannel = async (balloonNode, channelId, topic) => {
    // if (topic.startsWith("msh/ US/ham")) {
    //   return hamventionChannel;
    // }
    if (balloonNode) {
      return habChannel;
    }
    if (channelId === "MediumSlow") {
      return msChannel;
    } else if (channelId === "MediumFast") {
      return mfChannel;
    } else if (channelId === "LongFast") {
      return lfChannel;
    } else if (channelId === "HAB") {
      return habChannel;
    } else if (channelId.trim() === "Test") {
      return mfTestChannel;
    } else {
      logger.warn(
        "Unknown channelId: '" +
          channelId +
          "', packetId: " +
          packet.id.toString() +
          " , message: " +
          text,
      );
      return null;
    }
  };

  let discordChannel = await getDiscordChannel(
    balloonNode,
    packetGroup.serviceEnvelopes[0].channelId,
    packetGroup.serviceEnvelopes[0].topic,
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

export { processTextMessage };
