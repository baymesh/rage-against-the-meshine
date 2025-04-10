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
      const nodeIdHex = nodeId2hex(parseInt(nodeId));
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

const fetchNodeId = (interaction: any): string | null => {
  let nodeId = interaction.options
    .getString("nodeid")
    .replace("https://meshview.bayme.sh/packet_list/", "")
    .replace("!", "")
    .trim();

  return validateNodeId(nodeId);
};

export { nodeId2hex, nodeHex2id, validateNodeId, fetchNodeId };
