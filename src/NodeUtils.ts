const nodeId2hex = (nodeId: string | number) => {
  return typeof nodeId === "number"
    ? nodeId.toString(16).padStart(8, "0")
    : nodeId;
};

const nodeHex2id = (nodeHex: string) => {
  return parseInt(nodeHex, 16);
};

const validateNodeId = (nodeId: string): string | null => {
  if (!nodeId || nodeId.trim().length === 0) {
    return null;
  }

  if (nodeId.length !== 8) {
    try {
      const parsed = parseInt(nodeId, 10);
      if (Number.isNaN(parsed)) {
        return null;
      }
      const nodeIdHex = nodeId2hex(parsed);
      if (nodeIdHex.length === 8) {
        return nodeIdHex;
      }
    } catch (e) {
      return null;
    }
  } else {
    return nodeId;
  }

  return null;
};

/**
 * Meshtastic firmware limits User.long_name to 39 chars and User.short_name to
 * 4 chars, but the protobuf has no limit, so anyone on MQTT can publish a
 * NodeInfo with a multi-kilobyte name. Discord rejects embeds whose author
 * name or title exceeds 256 chars, so an oversized name for node X makes every
 * later message from X fail to post. Clamp names before they are stored.
 * Limits are counted in code points (emoji short names are one or a few code
 * points but several bytes) with a little headroom over the firmware values.
 */
const MAX_LONG_NAME_CHARS = 40;
const MAX_SHORT_NAME_CHARS = 8;

const clampNodeName = (value: unknown, maxChars: number): string => {
  if (typeof value !== "string") {
    return "";
  }
  const chars = Array.from(value);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("") : value;
};

const clampLongName = (value: unknown) =>
  clampNodeName(value, MAX_LONG_NAME_CHARS);
const clampShortName = (value: unknown) =>
  clampNodeName(value, MAX_SHORT_NAME_CHARS);

const fetchNodeId = (interaction: any, meshViewBaseUrl = ""): string | null => {
  let nodeId = interaction.options
    .getString("nodeid")
    .replace(`${meshViewBaseUrl}/packet_list/`, "")
    .replace("!", "")
    .trim();

  return validateNodeId(nodeId);
};

export {
  nodeId2hex,
  nodeHex2id,
  validateNodeId,
  fetchNodeId,
  clampNodeName,
  clampLongName,
  clampShortName,
  MAX_LONG_NAME_CHARS,
  MAX_SHORT_NAME_CHARS,
};
