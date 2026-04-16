import type { LoggerLike } from "./Logger";

const mqttStreamsWithErrorHandler = new WeakSet<object>();
type MqttTransportStreamLike = {
  on?: (event: string, listener: (err: unknown) => void) => void;
};
type MqttClientWithOptionalStream = {
  stream?: MqttTransportStreamLike;
};

export const attachMqttTransportErrorHandler = (
  mqttClient: MqttClientWithOptionalStream,
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
    const errorText = err instanceof Error ? (err.stack ?? err.message) : String(err);
    meshLogger.error(`MQTT transport error: ${errorText}`);
  });
};
