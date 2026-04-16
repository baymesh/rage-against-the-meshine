import { EventEmitter } from "node:events";
import { attachMqttTransportErrorHandler } from "../src/MqttTransport";

describe("attachMqttTransportErrorHandler", () => {
  it("logs websocket transport errors without throwing", () => {
    const stream = new EventEmitter();
    const mqttClient = { stream };
    const meshLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

    attachMqttTransportErrorHandler(mqttClient, meshLogger);
    stream.emit("error", new Error("Opening handshake has timed out"));

    expect(meshLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Opening handshake has timed out"),
    );
  });

  it("does not attach duplicate error handlers", () => {
    const stream = new EventEmitter();
    const mqttClient = { stream };
    const meshLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

    attachMqttTransportErrorHandler(mqttClient, meshLogger);
    attachMqttTransportErrorHandler(mqttClient, meshLogger);

    expect(stream.listenerCount("error")).toBe(1);
  });
});
