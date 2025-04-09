import { createClient, RedisClientType } from "redis";
import { nodeId2hex } from "./NodeUtils";
import logger from "./Logger";

class MeshRedis {
  redisClient: RedisClientType;

  async init(redisUrl: string) {
    this.redisClient = createClient({
      url: redisUrl,
    });
    await this.redisClient.connect();
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
  ) {
    try {
      this.redisClient.set(`baymesh:node:${node}`, longName);
      const nodeInfoGenericObj = JSON.parse(JSON.stringify(nodeInfo));
      // remove leading "!" from id
      nodeInfoGenericObj.id = nodeInfoGenericObj.id.replace("!", "");
      // add hopStart to nodeInfo
      nodeInfoGenericObj.hopStart = hopStart;
      nodeInfoGenericObj.updatedAt = new Date().getTime();
      this.redisClient.json
        .set(`baymesh:nodeinfo:${node}`, "$", nodeInfoGenericObj)
        .then(() => {})
        .catch((err) => {
          this.redisClient.type(`baymesh:nodeinfo:${node}`).then((result) => {
            logger.info(result);
            if (result === "string") {
              this.redisClient.del(`baymesh:nodeinfo:${node}`).then(() => {
                this.redisClient.json
                  .set(`baymesh:nodeinfo:${node}`, "$", nodeInfoGenericObj)
                  .then(() => {
                    logger.info("deleted and re-added node info for: " + node);
                  })
                  .catch((err) => {
                    logger.error(err);
                  });
              });
            }
          });
          logger.error(`redis key: baymesh:nodeinfo:${node} ${err}`);
        });
      logger.info(`updated node info for: ${node}`);
    } catch (err) {
      logger.error(err.message);
      // Sentry.captureException(err);
    }
  }

  async getNodeInfos(nodeIds: string[], debug: boolean) {
    try {
      // const foo = nodeIds.slice(0, nodeIds.length - 1);
      nodeIds = Array.from(new Set(nodeIds));
      const nodeInfos = await this.redisClient.json.mGet(
        nodeIds.map((nodeId) => `baymesh:nodeinfo:${nodeId2hex(nodeId)}`),
        "$",
      );
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
        `baymesh:nodelink:${hexNodeId}`,
      );
      if (linkedDiscordId && discordId !== linkedDiscordId) {
        logger.info(
          `Node ${hexNodeId} is already linked to discord ${discordId}`,
        );
        return `Node ${hexNodeId} is already linked to another account.`;
      }
      await this.redisClient.set(`baymesh:nodelink:${hexNodeId}`, discordId);
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
        `baymesh:nodelink:${hexNodeId}`,
      );
      if (discordId !== linkedDiscordId) {
        logger.info(`Node ${hexNodeId} is not linked to discord ${discordId}`);
        return `Node ${hexNodeId} is not linked to your account.`;
      }
      await this.redisClient.del(`baymesh:nodelink:${hexNodeId}`);
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
        `baymesh:tracker:${hexNodeId}`,
      );
      if (trackerNode) {
        logger.info(`Node ${hexNodeId} is already a tracker node`);
        return `Node ${hexNodeId} is already a tracker node`;
      }
      await this.redisClient.set(`baymesh:tracker:${hexNodeId}`, "1");
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
        `baymesh:tracker:${hexNodeId}`,
      );
      if (!trackerNode) {
        logger.info(`Node ${hexNodeId} is not a tracker node`);
        return `Node ${hexNodeId} is not a tracker node`;
      }
      await this.redisClient.del(`baymesh:tracker:${hexNodeId}`);
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
        `baymesh:tracker:${hexNodeId}`,
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
        `baymesh:balloon:${hexNodeId}`,
      );
      if (balloonNode) {
        logger.info(`Node ${hexNodeId} is already a balloon node`);
        return `Node ${hexNodeId} is already a balloon node`;
      }
      await this.redisClient.set(`baymesh:balloon:${hexNodeId}`, "1");
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
        `baymesh:balloon:${hexNodeId}`,
      );
      if (!balloonNode) {
        logger.info(`Node ${hexNodeId} is not a balloon node`);
        return `Node ${hexNodeId} is not a balloon node`;
      }
      await this.redisClient.del(`baymesh:balloon:${hexNodeId}`);
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
        `baymesh:balloon:${hexNodeId}`,
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
        `baymesh:nodelink:${hexNodeId}`,
      );
      if (discordId) {
        return discordId;
      }
    } catch (err) {
      logger.error(err.message);
    }
    return null;
  }
}

const meshRedis = new MeshRedis();
export default meshRedis;
