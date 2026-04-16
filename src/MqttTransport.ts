import type { LoggerLike } from "./Logger";

const MQTT_STREAM_ERROR_HANDLER_ATTACHED = "__meshRuntimeErrorHandlerAttached";

export const attachMqttTransportErrorHandler = (
  mqttClient: any,
  meshLogger: LoggerLike,
) => {
  const stream = mqttClient?.stream;
  if (!stream || typeof stream.on !== "function") {
    return;
  }
  if (stream[MQTT_STREAM_ERROR_HANDLER_ATTACHED]) {
    return;
  }
  stream[MQTT_STREAM_ERROR_HANDLER_ATTACHED] = true;
  stream.on("error", (err: unknown) => {
    meshLogger.error(`MQTT transport error: ${String(err)}`);
  });
};
