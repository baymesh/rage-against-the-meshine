import { MeshRedis } from "../src/MeshRedis";

const makeClient = () => {
  const jsonSet = jest.fn(async () => "OK");
  const client: any = {
    set: jest.fn(async () => "OK"),
    json: { set: jsonSet },
  };
  return { client, jsonSet };
};

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe("MeshRedis.updateNodeDB", () => {
  it("clamps oversized names before storing them", async () => {
    const { client, jsonSet } = makeClient();
    const redis = new MeshRedis(client, "test", logger);
    const longName = "L".repeat(5000);
    const shortName = "S".repeat(300);

    await redis.updateNodeDB(
      "abcd1234",
      longName,
      { id: "!abcd1234", longName, shortName },
      3,
      7,
    );

    expect(client.set).toHaveBeenCalledWith(
      "test:node:abcd1234",
      "L".repeat(40),
    );
    const stored = jsonSet.mock.calls[0][2];
    expect(stored.longName).toBe("L".repeat(40));
    expect(stored.shortName).toBe("S".repeat(8));
    expect(stored.id).toBe("abcd1234");
  });

  it("stores normal names unchanged", async () => {
    const { client, jsonSet } = makeClient();
    const redis = new MeshRedis(client, "test", logger);

    await redis.updateNodeDB(
      "abcd1234",
      "Base Camp",
      { id: "!abcd1234", longName: "Base Camp", shortName: "BC" },
      3,
    );

    expect(jsonSet.mock.calls[0][2].longName).toBe("Base Camp");
    expect(jsonSet.mock.calls[0][2].shortName).toBe("BC");
  });
});
