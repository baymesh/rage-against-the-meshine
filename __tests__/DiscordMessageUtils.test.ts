const meshRedisMock = {
  getNodeInfos: jest.fn(async () => ({ abcd1234: { longName: "Node", shortName: "N" } })),
  getDiscordUserId: jest.fn(async () => null),
};

const positionDecodeMock = jest.fn(() => ({
  latitudeI: 123456789,
  longitudeI: 987654321,
  altitude: 100,
  time: 1000,
  locationSource: 1,
  altitudeSource: 1,
  timestamp: 0,
  timestampMillisAdjust: 0,
  PDOP: 0,
  HDOP: 0,
  VDOP: 0,
  gpsAccuracy: 0,
  fixQuality: 0,
  fixType: 0,
  satsInView: 0,
  precisionBits: 0,
}));

jest.mock("../src/Protobufs", () => ({
  __esModule: true,
  Position: { decode: positionDecodeMock },
}));

jest.mock("../src/Logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { createDiscordMessage } from "../src/DiscordMessageUtils";

describe("createDiscordMessage", () => {
  it("builds a message payload with node info", async () => {
    const packetGroup: any = {
      id: 1,
      time: new Date(),
      serviceEnvelopes: [
        {
          packet: {
            id: 1,
            from: parseInt("abcd1234", 16),
            rxTime: 100,
            decoded: { portnum: 1, payload: Buffer.from("hello") },
          },
          gatewayId: "!abcd1234",
          mqttTime: new Date(),
        },
      ],
    };

    const content = await createDiscordMessage(
      packetGroup,
      "hello",
      { users: { fetch: jest.fn() } },
      { members: { fetch: jest.fn() } },
      meshRedisMock as any,
      "https://meshview.test",
    );

    expect(content?.embeds?.[0]?.title).toBe("N");
  });

  it("renders position details for portnum 3", async () => {
    const packetGroup: any = {
      id: 1,
      time: new Date(),
      serviceEnvelopes: [
        {
          packet: {
            id: 1,
            from: parseInt("abcd1234", 16),
            rxTime: 100,
            decoded: { portnum: 3, payload: Buffer.from("x") },
          },
          gatewayId: "!abcd1234",
          mqttTime: new Date(),
        },
      ],
    };

    const content = await createDiscordMessage(
      packetGroup,
      "Position Packet",
      { users: { fetch: jest.fn() } },
      { members: { fetch: jest.fn() } },
      meshRedisMock as any,
      "https://meshview.test",
    );

    expect(positionDecodeMock).toHaveBeenCalled();
    expect(content?.embeds?.[0]?.image?.url).toContain("api.smerty.org");
  });
});
