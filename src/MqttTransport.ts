import type { LoggerLike } from "./Logger";

const mqttStreamsWithErrorHandler = new WeakSet<object>();

export const attachMqttTransportErrorHandler = (
  mqttClient: any,
  meshLogger: LoggerLike,
) => {
  const stream = mqttClient?.stream;
  if (!stream || typeof stream.on !== "function") {
    return;
  }
  if (mqttStreamsWithErrorHandler.has(stream)) {
    return;
  }
  mqttStreamsWithErrorHandler.add(stream);
  stream.on("error", (err: unknown) => {
    meshLogger.error(`MQTT transport error: ${String(err)}`);
  });
};
