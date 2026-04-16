const meshRedisMock = {
  isTrackerNode: jest.fn(async () => true),
  isBalloonNode: jest.fn(async () => true),
  updateNodeDB: jest.fn(),
};

const meshPacketCacheMock = {
  exists: jest.fn(() => false),
  add: jest.fn(),
};

const nodeInfoPacketCacheMock = {
  exists: jest.fn(() => false),
  set: jest.fn(),
};

const decryptMock = jest.fn(() => ({ portnum: 1 }));
const serviceEnvelopeDecodeMock = jest.fn(() => ({
  packet: { id: 1, encrypted: Buffer.from("x"), decoded: { portnum: 1 } },
}));

jest.mock("../src/decrypt", () => ({
  __esModule: true,
  decrypt: decryptMock,
}));

jest.mock("../src/Protobufs", () => ({
  __esModule: true,
  ServiceEnvelope: { decode: serviceEnvelopeDecodeMock },
  Position: { decode: jest.fn(() => ({ latitudeI: 1, longitudeI: 1 })) },
  User: { decode: jest.fn(() => ({ longName: "test" })) },
}));

import { handleMqttMessage } from "../src/MqttUtils";

describe("handleMqttMessage", () => {
  beforeEach(() => {
    meshPacketCacheMock.add.mockClear();
    meshPacketCacheMock.exists.mockClear();
    nodeInfoPacketCacheMock.exists.mockClear();
    nodeInfoPacketCacheMock.set.mockClear();
    meshRedisMock.isTrackerNode.mockClear();
    meshRedisMock.isBalloonNode.mockClear();
    meshRedisMock.updateNodeDB.mockClear();
    decryptMock.mockClear();
    serviceEnvelopeDecodeMock.mockClear();
  });

  it("ignores non-mesh topics", async () => {
    await handleMqttMessage(
      "foo/bar",
      Buffer.from("payload"),
      ["msh/US/#"],
      meshPacketCacheMock as any,
      nodeInfoPacketCacheMock as any,
      false,
      "broker",
      meshRedisMock as any,
    );

    expect(meshPacketCacheMock.add).not.toHaveBeenCalled();
  });

  it("adds decoded packets when topic matches", async () => {
    serviceEnvelopeDecodeMock.mockReturnValueOnce({
      packet: { id: 1, encrypted: Buffer.from("x"), decoded: { portnum: 1 } },
    });

    await handleMqttMessage(
      "msh/US/1",
      Buffer.from("payload"),
      ["msh/US/"],
      meshPacketCacheMock as any,
      nodeInfoPacketCacheMock as any,
      false,
      "broker",
      meshRedisMock as any,
    );

    expect(meshPacketCacheMock.add).toHaveBeenCalled();
  });

  it("matches MQTT wildcard topics", async () => {
    serviceEnvelopeDecodeMock.mockReturnValueOnce({
      packet: { id: 5, encrypted: Buffer.from("x"), decoded: { portnum: 1 } },
    });

    await handleMqttMessage(
      "msh/US/bayarea/2",
      Buffer.from("payload"),
      ["msh/US/#"],
      meshPacketCacheMock as any,
      nodeInfoPacketCacheMock as any,
      false,
      "broker",
      meshRedisMock as any,
    );

    expect(meshPacketCacheMock.add).toHaveBeenCalled();
  });

  it("skips position packets for non-tracked nodes", async () => {
    meshRedisMock.isTrackerNode.mockResolvedValueOnce(false);
    meshRedisMock.isBalloonNode.mockResolvedValueOnce(false);
    serviceEnvelopeDecodeMock.mockReturnValueOnce({
      packet: {
        id: 2,
        encrypted: Buffer.from(""),
        decoded: { portnum: 3, payload: Buffer.from("x") },
        from: 1,
      },
    });

    await handleMqttMessage(
      "msh/US/1",
      Buffer.from("payload"),
      ["msh/US/"],
      meshPacketCacheMock as any,
      nodeInfoPacketCacheMock as any,
      true,
      "broker",
      meshRedisMock as any,
    );

    expect(meshPacketCacheMock.add).not.toHaveBeenCalled();
  });

  it("updates node info when enabled", async () => {
    serviceEnvelopeDecodeMock.mockReturnValueOnce({
      packet: {
        id: 3,
        encrypted: Buffer.from(""),
        decoded: { portnum: 4, payload: Buffer.from("x") },
        from: 1,
        hopStart: 1,
      },
    });

    await handleMqttMessage(
      "msh/US/1",
      Buffer.from("payload"),
      ["msh/US/"],
      meshPacketCacheMock as any,
      nodeInfoPacketCacheMock as any,
      true,
      "broker",
      meshRedisMock as any,
    );

    expect(meshRedisMock.updateNodeDB).toHaveBeenCalled();
  });

  it("dedupes node info updates by packet id", async () => {
    serviceEnvelopeDecodeMock.mockReturnValueOnce({
      packet: {
        id: 9,
        encrypted: Buffer.from(""),
        decoded: { portnum: 4, payload: Buffer.from("x") },
        from: 1,
        hopStart: 1,
      },
    });

    nodeInfoPacketCacheMock.exists.mockReturnValueOnce(true);

    await handleMqttMessage(
      "msh/US/1",
      Buffer.from("payload"),
      ["msh/US/"],
      meshPacketCacheMock as any,
      nodeInfoPacketCacheMock as any,
      true,
      "broker",
      meshRedisMock as any,
    );

    expect(meshRedisMock.updateNodeDB).not.toHaveBeenCalled();
  });
});
