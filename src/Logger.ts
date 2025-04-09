function loggerDateString() {
  return process.env.ENVIRONMENT === "production"
    ? ""
    : new Date().toISOString() + " ";
}

class Logger {
  instanceId: string;

  init(instanceId: string) {
    this.instanceId = instanceId;
  }

  debug(message: string) {
    console.log(`${loggerDateString()}[${this.instanceId}] [DEBUG] ${message}`);
  }

  info(message: string) {
    console.log(`${loggerDateString()}[${this.instanceId}] [INFO] ${message}`);
  }

  warn(message: string) {
    console.log(`${loggerDateString()}[${this.instanceId}] [WARN] ${message}`);
  }

  error(message: string) {
    console.log(`${loggerDateString()}[${this.instanceId}] [ERROR] ${message}`);
  }
}

const logger = new Logger();
export default logger;
