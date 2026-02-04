import { ServiceEnvelope, Position, User } from "./Protobufs";
import MeshPacketCache from "./MeshPacketCache";
import { decrypt } from "./decrypt";
import type { MeshRedis } from "./MeshRedis";
import { nodeId2hex } from "./NodeUtils";
import logger from "./Logger";

const handleMqttMessage = async (
  topic,
  message,
  mqttTopics: string[],
  meshPacketCache: MeshPacketCache,
  nodeInfoUpdates: boolean,
  mqttBrokerUrl: string,
  meshRedis: MeshRedis,
) => {
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
            String(envDecodeErr).indexOf("invalid wire type 7 at offset 1") ===
            -1
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
          mqttTopics.some((t) => {
            return topic.startsWith(t);
          }) ||
          meshPacketCache.exists(envelope.packet.id)
        ) {
          const isEncrypted = envelope.packet.encrypted?.length > 0;
          if (isEncrypted) {
            const decoded = decrypt(envelope.packet);
            if (decoded) {
              envelope.packet.decoded = decoded;
            }
          }
          const portnum = envelope.packet?.decoded?.portnum;
          if (portnum === 1) {
            meshPacketCache.add(envelope, topic, mqttBrokerUrl);
          } else if (portnum === 3) {
            const from = envelope.packet.from.toString(16);
            const isTrackerNode = await meshRedis.isTrackerNode(from);
            const isBalloonNode = await meshRedis.isBalloonNode(from);
            if (!isTrackerNode && !isBalloonNode) {
              return;
            }
            const position = Position.decode(envelope.packet.decoded.payload);
            if (!position.latitudeI && !position.longitudeI) {
              return;
            }
            meshPacketCache.add(envelope, topic, mqttBrokerUrl);
          } else if (portnum === 4) {
            if (!nodeInfoUpdates) {
              // logger.debug("Node info updates disabled");
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
};

export { handleMqttMessage };
