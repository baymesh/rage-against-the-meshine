const nodeId2hex = (nodeId: string | number) => {
  return typeof nodeId === "number"
    ? nodeId.toString(16).padStart(8, "0")
    : nodeId;
};

const nodeHex2id = (nodeHex: string) => {
  return parseInt(nodeHex, 16);
};

export { nodeId2hex, nodeHex2id };
