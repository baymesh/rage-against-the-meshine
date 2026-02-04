import { fileURLToPath } from "url";
import path, { dirname } from "path";
import protobufjs from "protobufjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = new protobufjs.Root();
root.resolvePath = (origin: string, target: string) =>
  path.join(__dirname, "protobufs", target);
root.loadSync("meshtastic/mqtt.proto");

const Data = root.lookupType("Data");
const ServiceEnvelope = root.lookupType("ServiceEnvelope");
const Position = root.lookupType("Position");
const User = root.lookupType("User");

export { Data, ServiceEnvelope, Position, User };
