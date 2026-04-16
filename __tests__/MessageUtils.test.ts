type LoggerMock = {
  info: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
};

const loggerMock: LoggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const createDiscordMessageMock = jest.fn(async () => ({ content: "ok" }));

jest.mock("../src/Logger", () => ({
  __esModule: true,
  default: loggerMock,
}));

jest.mock("../src/DiscordMessageUtils", () => ({
  __esModule: true,
  createDiscordMessage: createDiscordMessageMock,
}));

import { processTextMessage } from "../src/MessageUtils";

const buildPacketGroup = (overrides: any = {}) => {
  const packet = {
    id: 123,
    to: "ffffffff",
    from: "abcd1234",
    decoded: {
      portnum: 1,
      payload: Buffer.from("hello"),
      replyId: undefined,
    },
    ...overrides.packet,
  };

  return {
    id: 123,
    serviceEnvelopes: [
      {
        packet,
        channelId: "LongFast",
        topic: "msh/US/1",
      },
    ],
    ...overrides,
  };
};

describe("processTextMessage", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ENVIRONMENT: "development" };
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.debug.mockClear();
    loggerMock.error.mockClear();
    createDiscordMessageMock.mockClear();
  });

  it("skips banned nodes", async () => {
    const packetGroup = buildPacketGroup();
    const meshRedis = {
      isBannedNode: jest.fn(async () => true),
    } as any;

    await processTextMessage(packetGroup, {
      client: {},
      guild: {},
      discordMessageIdCache: { exists: jest.fn(), get: jest.fn(), set: jest.fn() },
      channelRegexRules: [{ regex: /LongFast/, discordChannelId: "123" }],
      resolveChannelById: jest.fn(),
      meshRedis,
      meshViewBaseUrl: "",
      meshId: "test",
    });

    expect(meshRedis.isBannedNode).toHaveBeenCalled();
    expect(createDiscordMessageMock).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalled();
  });

  it("warns when no regex matches", async () => {
    const packetGroup = buildPacketGroup();
    const meshRedis = {
      isBannedNode: jest.fn(async () => false),
    } as any;

    await processTextMessage(packetGroup, {
      client: {},
      guild: {},
      discordMessageIdCache: { exists: jest.fn(), get: jest.fn(), set: jest.fn() },
      channelRegexRules: [{ regex: /MediumFast/, discordChannelId: "123" }],
      resolveChannelById: jest.fn(),
      meshRedis,
      meshViewBaseUrl: "",
      meshId: "test",
    });

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("No regex match"),
    );
  });

  it("updates existing Discord messages when cached", async () => {
    const packetGroup = buildPacketGroup();
    const meshRedis = {
      isBannedNode: jest.fn(async () => false),
    } as any;

    const editMock = jest.fn();
    const fetchMock = jest.fn(async () => ({ edit: editMock }));
    const discordChannel = {
      messages: { fetch: fetchMock },
    } as any;

    await processTextMessage(packetGroup, {
      client: {},
      guild: {},
      discordMessageIdCache: {
        exists: jest.fn(() => true),
        get: jest.fn(() => "discord-id"),
        set: jest.fn(),
      },
      channelRegexRules: [{ regex: /LongFast/, discordChannelId: "123" }],
      resolveChannelById: jest.fn(() => discordChannel),
      meshRedis,
      meshViewBaseUrl: "",
      meshId: "test",
    });

    expect(fetchMock).toHaveBeenCalledWith("discord-id");
    expect(editMock).toHaveBeenCalled();
  });

  it("replies to existing messages when replyId is cached", async () => {
    const packetGroup = buildPacketGroup({
      packet: { decoded: { portnum: 1, payload: Buffer.from("hello"), replyId: 999 } },
    });
    const meshRedis = {
      isBannedNode: jest.fn(async () => false),
    } as any;

    const replyMock = jest.fn(async () => ({ id: "new" }));
    const fetchMock = jest.fn(async () => ({ reply: replyMock }));
    const discordChannel = {
      messages: { fetch: fetchMock },
      send: jest.fn(),
    } as any;

    await processTextMessage(packetGroup, {
      client: {},
      guild: {},
      discordMessageIdCache: {
        exists: jest.fn((id: string) => id === "999"),
        get: jest.fn(() => "discord-id"),
        set: jest.fn(),
      },
      channelRegexRules: [{ regex: /LongFast/, discordChannelId: "123" }],
      resolveChannelById: jest.fn(() => discordChannel),
      meshRedis,
      meshViewBaseUrl: "",
      meshId: "test",
    });

    expect(fetchMock).toHaveBeenCalledWith("discord-id");
    expect(replyMock).toHaveBeenCalled();
  });

  it("drops sequence-only messages", async () => {
    const packetGroup = buildPacketGroup({
      packet: { decoded: { portnum: 1, payload: Buffer.from("seq 6034") } },
    });
    const meshRedis = {
      isBannedNode: jest.fn(async () => false),
    } as any;

    await processTextMessage(packetGroup, {
      client: {},
      guild: {},
      discordMessageIdCache: { exists: jest.fn(), get: jest.fn(), set: jest.fn() },
      channelRegexRules: [{ regex: /LongFast/, discordChannelId: "123" }],
      resolveChannelById: jest.fn(),
      meshRedis,
      meshViewBaseUrl: "",
      meshId: "test",
    });

    expect(createDiscordMessageMock).not.toHaveBeenCalled();
  });

  it("skips non-public messages in production", async () => {
    process.env.ENVIRONMENT = "production";
    const packetGroup = buildPacketGroup({
      packet: { to: "abcd1234" },
    });
    const meshRedis = {
      isBannedNode: jest.fn(async () => false),
    } as any;

    await processTextMessage(packetGroup, {
      client: {},
      guild: {},
      discordMessageIdCache: { exists: jest.fn(), get: jest.fn(), set: jest.fn() },
      channelRegexRules: [{ regex: /LongFast/, discordChannelId: "123" }],
      resolveChannelById: jest.fn(),
      meshRedis,
      meshViewBaseUrl: "",
      meshId: "test",
    });

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("Not to public channel"),
    );
    expect(createDiscordMessageMock).not.toHaveBeenCalled();
  });

  it("warns when matched channel is not found", async () => {
    const packetGroup = buildPacketGroup();
    const meshRedis = {
      isBannedNode: jest.fn(async () => false),
    } as any;

    await processTextMessage(packetGroup, {
      client: {},
      guild: {},
      discordMessageIdCache: { exists: jest.fn(), get: jest.fn(), set: jest.fn() },
      channelRegexRules: [{ regex: /LongFast/, discordChannelId: "123" }],
      resolveChannelById: jest.fn(() => null),
      meshRedis,
      meshViewBaseUrl: "",
      meshId: "test",
    });

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("No discord channel found"),
    );
  });

  it("sends new message when no cache hit and no replyId", async () => {
    const packetGroup = buildPacketGroup();
    const meshRedis = {
      isBannedNode: jest.fn(async () => false),
    } as any;

    const sendMock = jest.fn(async () => ({ id: "new" }));
    const discordChannel = {
      send: sendMock,
      messages: { fetch: jest.fn() },
    } as any;

    const cache = {
      exists: jest.fn(() => false),
      get: jest.fn(),
      set: jest.fn(),
    };

    await processTextMessage(packetGroup, {
      client: {},
      guild: {},
      discordMessageIdCache: cache,
      channelRegexRules: [{ regex: /LongFast/, discordChannelId: "123" }],
      resolveChannelById: jest.fn(() => discordChannel),
      meshRedis,
      meshViewBaseUrl: "",
      meshId: "test",
    });

    expect(sendMock).toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalledWith("123", "new");
  });
});
