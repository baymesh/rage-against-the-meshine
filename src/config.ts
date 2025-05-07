export const DISCORD_CLIENT_ID = process.env["DISCORD_CLIENT_ID"];
export const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
export const DISCORD_GUILD = process.env["DISCORD_GUILD"];
export const DISCORD_CHANNEL_LF = process.env["DISCORD_CHANNEL_LF"];
export const DISCORD_CHANNEL_MS = process.env["DISCORD_CHANNEL_MS"];
export const DISCORD_CHANNEL_HAB = process.env["DISCORD_CHANNEL_HAB"];

export const REDIS_URL = process.env["REDIS_URL"];
export const NODE_INFO_UPDATES = process.env["NODE_INFO_UPDATES"] === "1";

export const MQTT_BROKER_URL = process.env["MQTT_BROKER_URL"];
export const MQTT_TOPICS = JSON.parse(process.env["MQTT_TOPICS"] || "[]");

export const MESHVIEW_BASE_URL = process.env["MESHVIEW_BASE_URL"];
