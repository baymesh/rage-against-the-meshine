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

const fetchNodeId = (interaction: any, meshViewBaseUrl = ""): string | null => {
  let nodeId = interaction.options
    .getString("nodeid")
    .replace(`${meshViewBaseUrl}/packet_list/`, "")
    .replace("!", "")
    .trim();

  return validateNodeId(nodeId);
};

export { nodeId2hex, nodeHex2id, validateNodeId, fetchNodeId };
