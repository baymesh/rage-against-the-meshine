import { nodeId2hex, nodeHex2id, validateNodeId, fetchNodeId } from "../src/NodeUtils";

describe("NodeUtils", () => {
  it("converts node id to hex and back", () => {
    expect(nodeId2hex(1)).toBe("00000001");
    expect(nodeHex2id("00000001")).toBe(1);
  });

  it("validates node ids and converts integers to hex", () => {
    expect(validateNodeId("0000000a")).toBe("0000000a");
    expect(validateNodeId("10")).toBe("0000000a");
    expect(validateNodeId("")).toBeNull();
    expect(validateNodeId("not-a-node")).toBeNull();
  });

  it("extracts node id from interaction input", () => {
    const interaction: any = {
      options: {
        getString: () => "https://meshview.test/packet_list/0000000a",
      },
    };

    const nodeId = fetchNodeId(interaction, "https://meshview.test");
    expect(nodeId).toBe("0000000a");
  });
});
