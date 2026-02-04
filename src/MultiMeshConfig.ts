import process from "node:process";
import fs from "fs";
import path from "path";

export type ChannelRegexRuleConfig = {
  pattern: string;
  discordChannelId: string;
  flags?: string;
};

export type MeshRoutingConfig = {
  channelRegex: ChannelRegexRuleConfig[];
};

export type MeshMqttConfig = {
  brokerUrl: string;
  topics: string[];
  username?: string;
  password?: string;
};

export type MeshDiscordConfig = {
  token?: string;
  clientId: string;
  guildId: string;
};

export type MeshConfig = {
  id: string;
  name?: string;
  meshViewBaseUrl?: string;
  mqtt: MeshMqttConfig;
  discord: MeshDiscordConfig;
  routing: MeshRoutingConfig;
  nodeInfoUpdates?: boolean;
};

export type MultiMeshConfig = {
  environment?: string;
  redisUrl: string;
  meshViewBaseUrl?: string;
  nodeInfoUpdates?: boolean;
  meshes: MeshConfig[];
};

export type MeshSecretsEntry = {
  id: string;
  discordToken?: string;
};

export type SecretsConfig = {
  meshes: MeshSecretsEntry[];
};

export type CompiledChannelRegexRule = {
  regex: RegExp;
  discordChannelId: string;
};

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "config.json");
const DEFAULT_SECRETS_PATH = path.resolve(process.cwd(), "secrets.json");

const expandEnvPlaceholders = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
      return process.env[name] ?? "";
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandEnvPlaceholders(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, val]) => [key, expandEnvPlaceholders(val)],
    );
    return Object.fromEntries(entries);
  }
  return value;
};

const assertString = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid or missing ${field}`);
  }
  return value;
};

const assertStringArray = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid or missing ${field}`);
  }
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`Invalid ${field}[${index}]`);
    }
  });
  return value as string[];
};

const validateChannelRegexRules = (
  rules: unknown,
  field: string,
): ChannelRegexRuleConfig[] => {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error(`Invalid or missing ${field}`);
  }
  return rules.map((rule, index) => {
    if (!rule || typeof rule !== "object") {
      throw new Error(`Invalid ${field}[${index}]`);
    }
    const pattern = assertString(
      (rule as ChannelRegexRuleConfig).pattern,
      `${field}[${index}].pattern`,
    );
    const discordChannelId = assertString(
      (rule as ChannelRegexRuleConfig).discordChannelId,
      `${field}[${index}].discordChannelId`,
    );
    const flags = (rule as ChannelRegexRuleConfig).flags;
    if (flags !== undefined && typeof flags !== "string") {
      throw new Error(`Invalid ${field}[${index}].flags`);
    }
    return { pattern, discordChannelId, flags };
  });
};

const validateMeshConfig = (mesh: unknown, index: number): MeshConfig => {
  if (!mesh || typeof mesh !== "object") {
    throw new Error(`Invalid mesh at index ${index}`);
  }

  const meshObj = mesh as MeshConfig;
  const id = assertString(meshObj.id, `meshes[${index}].id`);
  const name = meshObj.name;
  const mqtt = meshObj.mqtt as MeshMqttConfig;
  const discord = meshObj.discord as MeshDiscordConfig;
  const routing = meshObj.routing as MeshRoutingConfig;
  const meshViewBaseUrl = meshObj.meshViewBaseUrl;
  if (meshViewBaseUrl !== undefined && typeof meshViewBaseUrl !== "string") {
    throw new Error(`Invalid meshes[${index}].meshViewBaseUrl`);
  }

  if (!mqtt || typeof mqtt !== "object") {
    throw new Error(`Invalid or missing meshes[${index}].mqtt`);
  }
  if (!discord || typeof discord !== "object") {
    throw new Error(`Invalid or missing meshes[${index}].discord`);
  }
  if (!routing || typeof routing !== "object") {
    throw new Error(`Invalid or missing meshes[${index}].routing`);
  }

  const brokerUrl = assertString(mqtt.brokerUrl, `meshes[${index}].mqtt.brokerUrl`);
  const topics = assertStringArray(mqtt.topics, `meshes[${index}].mqtt.topics`);
  const username = mqtt.username;
  const password = mqtt.password;

  const token = discord.token;
  if (token !== undefined && typeof token !== "string") {
    throw new Error(`Invalid meshes[${index}].discord.token`);
  }
  const clientId = assertString(
    discord.clientId,
    `meshes[${index}].discord.clientId`,
  );
  const guildId = assertString(
    discord.guildId,
    `meshes[${index}].discord.guildId`,
  );

  const channelRegex = validateChannelRegexRules(
    routing.channelRegex,
    `meshes[${index}].routing.channelRegex`,
  );

  return {
    id,
    name,
    meshViewBaseUrl,
    mqtt: {
      brokerUrl,
      topics,
      username,
      password,
    },
    discord: {
      token,
      clientId,
      guildId,
    },
    routing: {
      channelRegex,
    },
    nodeInfoUpdates: meshObj.nodeInfoUpdates,
  };
};

const validateConfig = (config: unknown): MultiMeshConfig => {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid config file");
  }
  const obj = config as MultiMeshConfig;
  const redisUrl = assertString(process.env.REDIS_URL, "REDIS_URL");
  if (!Array.isArray(obj.meshes) || obj.meshes.length === 0) {
    throw new Error("Invalid or missing meshes");
  }
  return {
    environment: obj.environment,
    redisUrl,
    meshViewBaseUrl: obj.meshViewBaseUrl,
    nodeInfoUpdates: obj.nodeInfoUpdates,
    meshes: obj.meshes.map(validateMeshConfig),
  };
};

const applySecrets = (
  config: MultiMeshConfig,
  secrets: SecretsConfig,
): MultiMeshConfig => {
  const secretMap = new Map(
    secrets.meshes.map((entry) => [entry.id, entry.discordToken]),
  );

  return {
    ...config,
    meshes: config.meshes.map((mesh) => {
      const secretToken = secretMap.get(mesh.id);
      return {
        ...mesh,
        discord: {
          ...mesh.discord,
          token: secretToken ?? mesh.discord.token,
        },
      };
    }),
  };
};

const validateSecrets = (secrets: unknown): SecretsConfig => {
  if (!secrets || typeof secrets !== "object") {
    throw new Error("Invalid secrets file");
  }
  const obj = secrets as SecretsConfig;
  if (!Array.isArray(obj.meshes)) {
    throw new Error("Invalid or missing secrets.meshes");
  }
  obj.meshes.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid secrets.meshes[${index}]`);
    }
    assertString((entry as MeshSecretsEntry).id, `secrets.meshes[${index}].id`);
    if (
      (entry as MeshSecretsEntry).discordToken !== undefined &&
      typeof (entry as MeshSecretsEntry).discordToken !== "string"
    ) {
      throw new Error(
        `Invalid secrets.meshes[${index}].discordToken`,
      );
    }
  });
  return obj;
};

const loadSecrets = (): SecretsConfig | null => {
  const secretsPath = process.env.SECRETS_PATH || DEFAULT_SECRETS_PATH;
  if (!fs.existsSync(secretsPath)) {
    return null;
  }
  const raw = fs.readFileSync(secretsPath, "utf-8");
  const parsed = JSON.parse(raw);
  const expanded = expandEnvPlaceholders(parsed);
  return validateSecrets(expanded);
};

const ensureDiscordTokens = (config: MultiMeshConfig) => {
  config.meshes.forEach((mesh, index) => {
    if (!mesh.discord.token || mesh.discord.token.trim().length === 0) {
      throw new Error(`Invalid or missing meshes[${index}].discord.token`);
    }
  });
};

const buildLegacyConfig = (): MultiMeshConfig => {
  let mqttTopics;
  try {
    mqttTopics = JSON.parse(process.env.MQTT_TOPICS || "[]");
  } catch (err) {
    throw new Error(
      `Malformed MQTT_TOPICS environment variable: ${String(err)}`,
    );
  }
  const meshId = process.env.MESH_ID || "default";

  const channelRegex = [
    { pattern: "LongFast", discordChannelId: process.env.DISCORD_CHANNEL_LF },
    { pattern: "MediumFast", discordChannelId: process.env.DISCORD_CHANNEL_MF },
    { pattern: "MediumSlow", discordChannelId: process.env.DISCORD_CHANNEL_MS },
    { pattern: "^Test$", discordChannelId: process.env.DISCORD_CHANNEL_MF_TEST },
    { pattern: "HAB", discordChannelId: process.env.DISCORD_CHANNEL_HAB },
  ].filter((rule) => rule.discordChannelId);

  if (channelRegex.length === 0) {
    throw new Error("No Discord channel mappings found in environment");
  }

  return validateConfig({
    environment: process.env.ENVIRONMENT,
    meshViewBaseUrl: process.env.MESHVIEW_BASE_URL,
    nodeInfoUpdates: process.env.NODE_INFO_UPDATES === "1",
    meshes: [
      {
        id: meshId,
        name: meshId,
        mqtt: {
          brokerUrl: process.env.MQTT_BROKER_URL,
          topics: mqttTopics,
        },
        discord: {
          token: process.env.DISCORD_TOKEN,
          clientId: process.env.DISCORD_CLIENT_ID,
          guildId: process.env.DISCORD_GUILD,
        },
        routing: {
          channelRegex,
        },
      },
    ],
  });
};

export const loadMultiMeshConfig = (): MultiMeshConfig => {
  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    const legacy = buildLegacyConfig();
    const secrets = loadSecrets();
    const merged = secrets ? applySecrets(legacy, secrets) : legacy;
    ensureDiscordTokens(merged);
    return merged;
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  const expanded = expandEnvPlaceholders(parsed);
  const validated = validateConfig(expanded);
  const secrets = loadSecrets();
  const merged = secrets ? applySecrets(validated, secrets) : validated;
  ensureDiscordTokens(merged);
  return merged;
};

export const compileChannelRegexRules = (
  rules: ChannelRegexRuleConfig[],
): CompiledChannelRegexRule[] => {
  return rules.map((rule) => {
    try {
      const regex = new RegExp(rule.pattern, rule.flags || undefined);
      return {
        regex,
        discordChannelId: rule.discordChannelId,
      };
    } catch (err) {
      throw new Error(
        `Invalid channel regex pattern '${rule.pattern}': ${String(err)}`,
      );
    }
  });
};
