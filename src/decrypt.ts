import crypto from "crypto";
import { Data } from "../index.ts";
import logger from "./Logger.ts";

const decryptionKeys = [
  "1PG7OiApB1nwvP+rz05pAQ==", // add default "AQ==" decryption key

  "1PG7OiApB1nwvP+rz05pCQ==", // Ham | CQ== (0x09)
  "1PG7OiApB1nwvP+rz05pEQ==", // MeshQuake | EQ== (0x11)
  "1PG7OiApB1nwvP+rz05p5g==", // BayMeshNews | 5g== (0xE6)
  "1PG7OiApB1nwvP+rz05pSA==", // SF | SA== (0x48)
  "1PG7OiApB1nwvP+rz05pTQ==", // Test | TQ== (0x4D)
  "1PG7OiApB1nwvP+rz05pNA==", // CRUZ | NA== (0x34)
  "1PG7OiApB1nwvP+rz05pew==", // Boozin' | ew== (0x7B)
  "1PG7OiApB1nwvP+rz05p1A==", // First | 1A== (0xD4)
  "1PG7OiApB1nwvP+rz05peQ==", // Retro | eQ== (0x79)
];

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
      // logger.info(`using decryption key: ${decryptionKey}`);
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

      if (decryptionKeys.indexOf(decryptionKey) > 0) {
        // logger.info(`decryption key: ${decryptionKey}`);
      }

      // parse as data message
      return Data.decode(decryptedBuffer);
    } catch (e) {
      // logger.info(e);
    }
  }

  // couldn't decrypt
  return null;
}

export { decrypt };
