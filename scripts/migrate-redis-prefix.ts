import process from "node:process";
import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

const stripPrefix = (key: string) => {
  if (key.startsWith("mesh:")) {
    return key.slice("mesh:".length);
  }
  return key;
};

const main = async () => {
  const client = createClient({ url: REDIS_URL });
  await client.connect();

  let scanned = 0;
  let renamed = 0;
  let skippedExisting = 0;

  try {
    for await (const key of client.scanIterator({ MATCH: "mesh:*", COUNT: 100 })) {
      scanned += 1;
      const newKey = stripPrefix(key);
      if (newKey === key) {
        continue;
      }

      const targetExists = await client.exists(newKey);
      if (targetExists) {
        skippedExisting += 1;
        console.warn(`Skipping ${key} -> ${newKey} (target exists)`);
        continue;
      }

      const success = await client.renameNX(key, newKey);
      if (success) {
        renamed += 1;
        console.info(`Renamed ${key} -> ${newKey}`);
      } else {
        console.warn(`Failed to rename ${key} -> ${newKey} (race or missing key)`);
      }
    }
  } finally {
    await client.quit();
  }

  console.info(`Scan complete. scanned=${scanned} renamed=${renamed} skipped_existing=${skippedExisting}`);
};

main().catch((err) => {
  console.error(`Migration failed: ${String(err)}`);
  process.exit(1);
});
