import process from "node:process";
import crypto from "crypto";

import logger from "./src/Logger";
import { loadMultiMeshConfig } from "./src/config";
import { startMeshRuntime } from "./src/MeshRuntime";
import { Data, ServiceEnvelope, Position, User } from "./src/Protobufs";

// generate a pseduo uuid kinda thing to use as an instance id
const INSTANCE_ID = (() => {
  return crypto.randomBytes(4).toString("hex");
})();
logger.init(INSTANCE_ID);

logger.info("Starting Mesh Logger");

const config = loadMultiMeshConfig();
if (config.environment) {
  process.env.ENVIRONMENT = config.environment;
}

export { Data, ServiceEnvelope, Position, User };

const results = await Promise.allSettled(
  config.meshes.map((mesh) => startMeshRuntime(mesh, config)),
);

results.forEach((result, index) => {
  if (result.status === "rejected") {
    const meshId = config.meshes[index]?.id || "unknown";
    logger.error(`[mesh:${meshId}] Failed to start runtime: ${String(result.reason)}`);
  }
});
