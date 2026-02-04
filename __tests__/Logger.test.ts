import logger from "../src/Logger";

describe("Logger", () => {
  const originalEnv = { ...process.env };
  const originalLog = console.log;

  beforeEach(() => {
    console.log = jest.fn();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    console.log = originalLog;
  });

  it("logs at or above the configured level", () => {
    logger.init("test");
    logger.setLogLevel("INFO");

    logger.debug("debug");
    logger.info("info");
    logger.error("error");

    expect((console.log as jest.Mock).mock.calls.length).toBe(2);
  });

  it("omits timestamp in production", () => {
    process.env.ENVIRONMENT = "production";
    logger.init("prod");
    logger.setLogLevel("INFO");

    logger.info("hello");

    const firstCall = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(firstCall.startsWith("[prod] [INFO] hello")).toBe(true);
  });
});
