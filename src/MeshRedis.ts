import { createClient, RedisClientType } from "redis";
import { nodeId2hex } from "./NodeUtils";
import logger from "./Logger";

let sharedClient: RedisClientType | null = null;
let sharedClientPromise: Promise<RedisClientType> | null = null;

const getSharedClient = async (
  redisUrl: string,
): Promise<RedisClientType> => {
  if (sharedClient && sharedClient.isOpen) {
    return sharedClient;
  }
  if (sharedClientPromise) {
    return sharedClientPromise;
  }
  sharedClientPromise = (async () => {
    const client = createClient({ url: redisUrl });
    await client.connect();
    sharedClient = client;
    return client;
  })();
  return sharedClientPromise;
};

export class MeshRedis {
  redisClient: RedisClientType;
  keyPrefix: string;

  constructor(redisClient: RedisClientType, keyPrefix: string) {
    this.redisClient = redisClient;
    this.keyPrefix = keyPrefix;
  }

  private key(key: string) {
    return `${this.keyPrefix}:${key}`;
  }

  async disconnect() {
    return await this.redisClient.disconnect();
  }

  isConnected(): boolean {
    return this.redisClient.isOpen;
  }

  async updateNodeDB(
    node: string,
    longName: string,
    nodeInfo: any,
    hopStart: number,
    packetId?: number,
  ) {
    try {
      this.redisClient.set(this.key(`node:${node}`), longName);
      const nodeInfoGenericObj = JSON.parse(JSON.stringify(nodeInfo));
      // remove leading "!" from id
      nodeInfoGenericObj.id = nodeInfoGenericObj.id.replace("!", "");
      // add hopStart to nodeInfo
      nodeInfoGenericObj.hopStart = hopStart;
      nodeInfoGenericObj.updatedAt = new Date().getTime();
      this.redisClient.json
        .set(this.key(`nodeinfo:${node}`), "$", nodeInfoGenericObj)
        .then(() => {})
        .catch((err) => {
          this.redisClient.type(this.key(`nodeinfo:${node}`)).then((result) => {
            logger.info(result);
            if (result === "string") {
              this.redisClient.del(this.key(`nodeinfo:${node}`)).then(() => {
                this.redisClient.json
                  .set(this.key(`nodeinfo:${node}`), "$", nodeInfoGenericObj)
                  .then(() => {
                    logger.info("deleted and re-added node info for: " + node);
                  })
                  .catch((innerErr) => {
                    logger.error(innerErr);
                  });
              });
            }
          });
          logger.error(`redis key: ${this.key(`nodeinfo:${node}`)} ${err}`);
          // Fallback for Redis without RedisJSON
          this.redisClient
            .set(this.key(`nodeinfo:${node}`), JSON.stringify(nodeInfoGenericObj))
            .catch((fallbackErr) => {
              logger.error(fallbackErr);
            });
        });
      const packetSuffix =
        typeof packetId === "number" ? ` (packetId: ${packetId})` : "";
      const shortName = nodeInfoGenericObj?.shortName ?? "";
      const longNameSafe = nodeInfoGenericObj?.longName ?? longName ?? "";
      const nameSuffix =
        shortName || longNameSafe
          ? ` (short: ${shortName || "-"}, long: ${longNameSafe || "-"})`
          : "";
      logger.info(`updated node info for: ${node}${packetSuffix}${nameSuffix}`);
    } catch (err) {
      logger.error(err.message);
      // Sentry.captureException(err);
    }
  }

  async getNodeInfos(nodeIds: string[], debug: boolean) {
    try {
      // const foo = nodeIds.slice(0, nodeIds.length - 1);
      nodeIds = Array.from(new Set(nodeIds));
      let nodeInfos: any[] = [];
      try {
        nodeInfos = await this.redisClient.json.mGet(
          nodeIds.map((nodeId) => this.key(`nodeinfo:${nodeId2hex(nodeId)}`)),
          "$",
        );
      } catch (err) {
        const values = await this.redisClient.mGet(
          nodeIds.map((nodeId) => this.key(`nodeinfo:${nodeId2hex(nodeId)}`)),
        );
        nodeInfos = values.map((value) => {
          if (!value) return null;
          try {
            return JSON.parse(value);
          } catch (parseErr) {
            logger.error(parseErr);
            return null;
          }
        });
      }

      if (debug) {
        logger.debug(JSON.stringify(nodeInfos));
      }

      const formattedNodeInfos = nodeInfos.flat().reduce((acc, item) => {
        if (item && item.id) {
          acc[item.id] = item;
        }
        return acc;
      }, {});
      if (Object.keys(formattedNodeInfos).length !== nodeIds.length) {
        const missingNodes = nodeIds.filter((nodeId) => {
          return formattedNodeInfos[nodeId] === undefined;
        });
        logger.info("Missing nodeInfo for nodes: " + missingNodes.join(","));
      }
      // console.log("Feep", nodeInfos);
      return formattedNodeInfos;
    } catch (err) {
      logger.error(err.message);
    }
    return {};
  }

  async linkNode(hexNodeId: string, discordId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const linkedDiscordId = await this.redisClient.get(
        this.key(`nodelink:${hexNodeId}`),
      );
      if (linkedDiscordId && discordId !== linkedDiscordId) {
        logger.info(
          `Node ${hexNodeId} is already linked to discord ${discordId}`,
        );
        return `Node ${hexNodeId} is already linked to another account.`;
      }
      await this.redisClient.set(this.key(`nodelink:${hexNodeId}`), discordId);
      return `Node ${hexNodeId} linked`;
    } catch (err) {
      logger.error(err.message);
      return "Error";
    }
  }

  async unlinkNode(hexNodeId: string, discordId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const linkedDiscordId = await this.redisClient.get(
        this.key(`nodelink:${hexNodeId}`),
      );
      if (discordId !== linkedDiscordId) {
        logger.info(`Node ${hexNodeId} is not linked to discord ${discordId}`);
        return `Node ${hexNodeId} is not linked to your account.`;
      }
      await this.redisClient.del(this.key(`nodelink:${hexNodeId}`));
      return `Node ${hexNodeId} unlinked`;
    } catch (err) {
      logger.error(err.message);
      return "Error";
    }
  }

  async addTrackerNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const trackerNode = await this.redisClient.get(
        this.key(`tracker:${hexNodeId}`),
      );
      if (trackerNode) {
        logger.info(`Node ${hexNodeId} is already a tracker node`);
        return `Node ${hexNodeId} is already a tracker node`;
      }
      await this.redisClient.set(this.key(`tracker:${hexNodeId}`), "1");
      return `Node ${hexNodeId} added as a tracker node`;
    } catch (err) {
      logger.error(err.message);
      return "Error";
    }
  }

  async removeTrackerNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const trackerNode = await this.redisClient.get(
        this.key(`tracker:${hexNodeId}`),
      );
      if (!trackerNode) {
        logger.info(`Node ${hexNodeId} is not a tracker node`);
        return `Node ${hexNodeId} is not a tracker node`;
      }
      await this.redisClient.del(this.key(`tracker:${hexNodeId}`));
      return `Node ${hexNodeId} removed as a tracker node`;
    } catch (err) {
      logger.error(err.message);
      return "Error";
    }
  }

  async isTrackerNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return false;
      }
      const trackerNode = await this.redisClient.get(
        this.key(`tracker:${hexNodeId}`),
      );
      if (trackerNode) {
        return true;
      }
      return false;
    } catch (err) {
      logger.error(err.message);
      return false;
    }
  }

  async addBalloonNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const balloonNode = await this.redisClient.get(
        this.key(`balloon:${hexNodeId}`),
      );
      if (balloonNode) {
        logger.info(`Node ${hexNodeId} is already a balloon node`);
        return `Node ${hexNodeId} is already a balloon node`;
      }
      await this.redisClient.set(this.key(`balloon:${hexNodeId}`), "1");
      return `Node ${hexNodeId} added as a balloon node`;
    } catch (err) {
      logger.error(err.message);
      return "Error";
    }
  }

  async removeBalloonNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const balloonNode = await this.redisClient.get(
        this.key(`balloon:${hexNodeId}`),
      );
      if (!balloonNode) {
        logger.info(`Node ${hexNodeId} is not a balloon node`);
        return `Node ${hexNodeId} is not a balloon node`;
      }
      await this.redisClient.del(this.key(`balloon:${hexNodeId}`));
      return `Node ${hexNodeId} removed as a balloon node`;
    } catch (err) {
      logger.error(err.message);
      return "Error";
    }
  }

  async isBalloonNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return false;
      }
      const balloonNode = await this.redisClient.get(
        this.key(`balloon:${hexNodeId}`),
      );
      if (balloonNode) {
        return true;
      }
      return false;
    } catch (err) {
      logger.error(err.message);
      return false;
    }
  }

  async getDiscordUserId(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const discordId = await this.redisClient.get(
        this.key(`nodelink:${hexNodeId}`),
      );
      if (discordId) {
        return discordId;
      }
    } catch (err) {
      logger.error(err.message);
    }
    return null;
  }

  /**
   * Return all hex-node-IDs linked to the given Discord user.
   */
  async getNodesByDiscordId(discordId: string): Promise<string[]> {
    const nodeIds: string[] = [];
    try {
      // iterate over all baymesh:nodelink:* keys without blocking Redis
      for await (const key of this.redisClient.scanIterator({
        MATCH: this.key("nodelink:*") as string,
        COUNT: 100,
      })) {
        const linked = await this.redisClient.get(key);
        if (linked === discordId) {
          // key === "<prefix>:nodelink:<hexNodeId>"
          const parts = key.split(":");
          const hexNodeId = parts[parts.length - 1];
          nodeIds.push(hexNodeId);
        }
      }
    } catch (err) {
      logger.error("getNodesByDiscordId:", err);
    }
    return nodeIds;
  }

  async addBannedNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const bannedNode = await this.redisClient.get(
        this.key(`banned:${hexNodeId}`),
      );
      if (bannedNode) {
        logger.info(`Node ${hexNodeId} is already banned`);
        return `Node ${hexNodeId} is already banned`;
      }
      await this.redisClient.set(this.key(`banned:${hexNodeId}`), "1");
      return `Node ${hexNodeId} banned`;
    } catch (err) {
      logger.error(err.message);
      return "Error";
    }
  }

  async removeBannedNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return "Invalid Node Id";
      }
      const bannedNode = await this.redisClient.get(
        this.key(`banned:${hexNodeId}`),
      );
      if (!bannedNode) {
        logger.info(`Node ${hexNodeId} is not banned`);
        return `Node ${hexNodeId} is not banned`;
      }
      await this.redisClient.del(this.key(`banned:${hexNodeId}`));
      return `Node ${hexNodeId} unbanned`;
    } catch (err) {
      logger.error(err.message);
      return "Error";
    }
  }

  async isBannedNode(hexNodeId: string) {
    try {
      if (!hexNodeId || hexNodeId.length != "dd0b9347".length) {
        return false;
      }
      const bannedNode = await this.redisClient.get(
        this.key(`banned:${hexNodeId}`),
      );
      if (bannedNode) {
        return true;
      }
      return false;
    } catch (err) {
      logger.error(err.message);
      return false;
    }
  }
}

const buildRedisKeyPrefix = (meshId: string) => {
  const cleaned = meshId.trim() || "default";
  return `mesh:${cleaned}`;
};

export const createMeshRedis = async (redisUrl: string, meshId: string) => {
  const client = await getSharedClient(redisUrl);
  return new MeshRedis(client, buildRedisKeyPrefix(meshId));
};

