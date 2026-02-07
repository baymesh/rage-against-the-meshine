import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compileChannelRegexRules,
  loadMultiMeshConfig,
} from "../src/MultiMeshConfig";

describe("compileChannelRegexRules", () => {
  it("compiles regex rules and preserves case sensitivity by default", () => {
    const rules = compileChannelRegexRules([
      { pattern: "LongFast", discordChannelId: "123" },
    ]);

    expect(rules).toHaveLength(1);
    expect(rules[0].regex.test("LongFast")).toBe(true);
    expect(rules[0].regex.test("longfast")).toBe(false);
  });

  it("throws on invalid regex patterns", () => {
    expect(() =>
      compileChannelRegexRules([{ pattern: "[", discordChannelId: "123" }]),
    ).toThrow("Invalid channel regex pattern");
  });

  it("supports explicit regex flags", () => {
    const rules = compileChannelRegexRules([
      { pattern: "longfast", flags: "i", discordChannelId: "123" },
    ]);

    expect(rules[0].regex.test("LongFast")).toBe(true);
  });
});

describe("loadMultiMeshConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads config.json and expands env placeholders", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");

    process.env.CONFIG_PATH = configPath;
    process.env.DISCORD_TOKEN_TEST = "token-value";
    process.env.DISCORD_CLIENT_TEST = "client-value";
    process.env.DISCORD_GUILD_TEST = "guild-value";
    process.env.REDIS_URL = "redis://localhost:6379";

    const config = {
      meshes: [
        {
          id: "test",
          mqtt: {
            brokerUrl: "mqtt://localhost:1883",
            topics: ["msh/US/#"],
          },
          discord: {
            token: "${DISCORD_TOKEN_TEST}",
            clientId: "${DISCORD_CLIENT_TEST}",
            guildId: "${DISCORD_GUILD_TEST}",
          },
          routing: {
            channelRegex: [
              { pattern: "LongFast", discordChannelId: "123" },
            ],
          },
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");

    const loaded = loadMultiMeshConfig();

    expect(loaded.redisUrl).toBe("redis://localhost:6379");
    expect(loaded.meshes[0].discord.token).toBe("token-value");
    expect(loaded.meshes[0].discord.clientId).toBe("client-value");
    expect(loaded.meshes[0].discord.guildId).toBe("guild-value");
  });

  it("throws when required fields are missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");

    process.env.CONFIG_PATH = configPath;

    fs.writeFileSync(configPath, JSON.stringify({ meshes: [] }), "utf-8");

    expect(() => loadMultiMeshConfig()).toThrow("Invalid or missing REDIS_URL");
  });

  it("validates mesh config and channel regex rules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");

    process.env.CONFIG_PATH = configPath;

    process.env.REDIS_URL = "redis://localhost:6379";
    const config = {
      meshes: [
        {
          id: "test",
          mqtt: {
            brokerUrl: "mqtt://localhost:1883",
            topics: ["msh/US/#"],
          },
          discord: {
            token: "token",
            clientId: "client",
            guildId: "guild",
          },
          routing: {
            channelRegex: [
              { pattern: "", discordChannelId: "123" },
            ],
          },
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");

    expect(() => loadMultiMeshConfig()).toThrow(
      "Invalid or missing meshes[0].routing.channelRegex[0].pattern",
    );
  });

  it("falls back to legacy env config when config.json is missing", () => {
    process.env.CONFIG_PATH = path.join(os.tmpdir(), "missing-config.json");
    process.env.SECRETS_PATH = path.join(os.tmpdir(), "missing-secrets.json");

    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.MQTT_BROKER_URL = "mqtt://localhost:1883";
    process.env.MQTT_TOPICS = JSON.stringify(["msh/US/#"]);
    process.env.DISCORD_TOKEN = "token";
    process.env.DISCORD_CLIENT_ID = "client";
    process.env.DISCORD_GUILD = "guild";
    process.env.DISCORD_CHANNEL_LF = "123";

    const loaded = loadMultiMeshConfig();

    expect(loaded.meshes).toHaveLength(1);
    expect(loaded.meshes[0].discord.token).toBe("token");
    expect(loaded.meshes[0].routing.channelRegex[0].discordChannelId).toBe("123");
  });

  it("throws on malformed MQTT_TOPICS in legacy env config", () => {
    process.env.CONFIG_PATH = path.join(os.tmpdir(), "missing-config.json");
    process.env.SECRETS_PATH = path.join(os.tmpdir(), "missing-secrets.json");

    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.MQTT_BROKER_URL = "mqtt://localhost:1883";
    process.env.MQTT_TOPICS = "not-json";
    process.env.DISCORD_TOKEN = "token";
    process.env.DISCORD_CLIENT_ID = "client";
    process.env.DISCORD_GUILD = "guild";
    process.env.DISCORD_CHANNEL_LF = "123";

    expect(() => loadMultiMeshConfig()).toThrow("Malformed MQTT_TOPICS");
  });

  it("throws when legacy env config lacks channel mappings", () => {
    process.env.CONFIG_PATH = path.join(os.tmpdir(), "missing-config.json");
    process.env.SECRETS_PATH = path.join(os.tmpdir(), "missing-secrets.json");

    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.MQTT_BROKER_URL = "mqtt://localhost:1883";
    process.env.MQTT_TOPICS = JSON.stringify(["msh/US/#"]);
    process.env.DISCORD_TOKEN = "token";
    process.env.DISCORD_CLIENT_ID = "client";
    process.env.DISCORD_GUILD = "guild";

    expect(() => loadMultiMeshConfig()).toThrow(
      "No Discord channel mappings found in environment",
    );
  });

  it("expands placeholders within arrays and nested objects", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");

    process.env.CONFIG_PATH = configPath;
    process.env.BROKER_HOST = "localhost";
    process.env.TOPIC = "msh/US/#";

    process.env.REDIS_URL = "redis://localhost:6379";
    const config = {
      meshes: [
        {
          id: "test",
          mqtt: {
            brokerUrl: "mqtt://${BROKER_HOST}:1883",
            topics: ["${TOPIC}", "msh/US/2/#"],
          },
          discord: {
            token: "token",
            clientId: "client",
            guildId: "guild",
          },
          routing: {
            channelRegex: [
              { pattern: "LongFast", discordChannelId: "123" },
            ],
          },
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");

    const loaded = loadMultiMeshConfig();
    expect(loaded.meshes[0].mqtt.brokerUrl).toBe("mqtt://localhost:1883");
    expect(loaded.meshes[0].mqtt.topics[0]).toBe("msh/US/#");
  });

  it("throws when required mesh fields are missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");

    process.env.CONFIG_PATH = configPath;

    process.env.REDIS_URL = "redis://localhost:6379";
    const config = {
      meshes: [
        {
          id: "test",
          mqtt: {
            brokerUrl: "",
            topics: [],
          },
          discord: {
            token: "token",
            clientId: "",
            guildId: "guild",
          },
          routing: {
            channelRegex: [],
          },
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");

    expect(() => loadMultiMeshConfig()).toThrow(
      "Invalid or missing meshes[0].mqtt.brokerUrl",
    );
  });

  it("rejects invalid channelRegex flags", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");

    process.env.CONFIG_PATH = configPath;

    process.env.REDIS_URL = "redis://localhost:6379";
    const config = {
      meshes: [
        {
          id: "test",
          mqtt: {
            brokerUrl: "mqtt://localhost:1883",
            topics: ["msh/US/#"],
          },
          discord: {
            token: "token",
            clientId: "client",
            guildId: "guild",
          },
          routing: {
            channelRegex: [
              { pattern: "LongFast", discordChannelId: "123", flags: 123 },
            ],
          },
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");

    expect(() => loadMultiMeshConfig()).toThrow(
      "Invalid meshes[0].routing.channelRegex[0].flags",
    );
  });

  it("fails when placeholders resolve to empty strings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");

    process.env.CONFIG_PATH = configPath;

    process.env.REDIS_URL = "redis://localhost:6379";
    const config = {
      meshes: [
        {
          id: "test",
          mqtt: {
            brokerUrl: "mqtt://localhost:1883",
            topics: ["msh/US/#"],
          },
          discord: {
            token: "${MISSING_TOKEN}",
            clientId: "client",
            guildId: "guild",
          },
          routing: {
            channelRegex: [
              { pattern: "LongFast", discordChannelId: "123" },
            ],
          },
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");

    expect(() => loadMultiMeshConfig()).toThrow(
      "Invalid or missing meshes[0].discord.token",
    );
  });

  it("loads discord tokens from secrets.json by mesh id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");
    const secretsPath = path.join(dir, "secrets.json");

    process.env.CONFIG_PATH = configPath;
    process.env.SECRETS_PATH = secretsPath;
    process.env.REDIS_URL = "redis://localhost:6379";

    const config = {
      redisUrl: "redis://localhost:6379",
      meshes: [
        {
          id: "pnw",
          mqtt: {
            brokerUrl: "mqtt://localhost:1883",
            topics: ["msh/US/#"],
          },
          discord: {
            clientId: "client",
            guildId: "guild",
          },
          routing: {
            channelRegex: [
              { pattern: "LongFast", discordChannelId: "123" },
            ],
          },
        },
      ],
    };

    const secrets = {
      meshes: [
        {
          id: "pnw",
          discordToken: "secret-token",
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");
    fs.writeFileSync(secretsPath, JSON.stringify(secrets), "utf-8");

    const loaded = loadMultiMeshConfig();
    expect(loaded.meshes[0].discord.token).toBe("secret-token");
  });

  it("rejects missing discord tokens when secrets do not provide them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-config-"));
    const configPath = path.join(dir, "config.json");
    const secretsPath = path.join(dir, "secrets.json");

    process.env.CONFIG_PATH = configPath;
    process.env.SECRETS_PATH = secretsPath;
    process.env.REDIS_URL = "redis://localhost:6379";

    const config = {
      redisUrl: "redis://localhost:6379",
      meshes: [
        {
          id: "pnw",
          mqtt: {
            brokerUrl: "mqtt://localhost:1883",
            topics: ["msh/US/#"],
          },
          discord: {
            clientId: "client",
            guildId: "guild",
          },
          routing: {
            channelRegex: [
              { pattern: "LongFast", discordChannelId: "123" },
            ],
          },
        },
      ],
    };

    const secrets = {
      meshes: [
        {
          id: "other",
          discordToken: "secret-token",
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");
    fs.writeFileSync(secretsPath, JSON.stringify(secrets), "utf-8");

    expect(() => loadMultiMeshConfig()).toThrow(
      "Invalid or missing meshes[0].discord.token",
    );
  });
});
