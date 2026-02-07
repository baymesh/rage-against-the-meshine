function loggerDateString() {
  return process.env.ENVIRONMENT === "production"
    ? ""
    : new Date().toISOString() + " ";
}

class Logger {
  instanceId: string;
  logLevel: string;
  tag?: string;

  constructor(tag?: string) {
    this.tag = tag;
  }

  init(instanceId: string) {
    this.instanceId = instanceId;
  }

  setLogLevel(level: string) {
    this.logLevel = level;
  }

  log(level: string, message: string) {
    const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
    if (levels.indexOf(level) >= levels.indexOf(this.logLevel)) {
      const tagPart = this.tag ? ` [${this.tag}]` : "";
      console.log(`${loggerDateString()}[${this.instanceId}] [${level}]${tagPart} ${message}`);
    }
  }

  withTag(tag: string) {
    const taggedLogger = new Logger(tag);
    taggedLogger.instanceId = this.instanceId;
    taggedLogger.logLevel = this.logLevel;
    return taggedLogger;
  }

  debug(message: string) {
    this.log("DEBUG", message);
  }

  info(message: string) {
    this.log("INFO", message);
  }

  warn(message: string) {
    this.log("WARN", message);
  }

  error(message: string) {
    this.log("ERROR", message);
  }
}

export type LoggerLike = Pick<Logger, "debug" | "info" | "warn" | "error">;

const logger = new Logger();
export default logger;
