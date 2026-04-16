import process from "node:process";
import { createClient } from "redis";

const SOURCE_REDIS_URL = process.env.SRC_REDIS_URL || process.env.SOURCE_REDIS_URL;
const DEST_REDIS_URL = process.env.DEST_REDIS_URL || process.env.TARGET_REDIS_URL;
const PATTERN = process.env.MIGRATE_PATTERN || "*";
const OVERWRITE = process.env.MIGRATE_OVERWRITE === "1";
const DRY_RUN = process.env.DRY_RUN === "1";

if (!SOURCE_REDIS_URL || !DEST_REDIS_URL) {
  console.error("SRC_REDIS_URL (or SOURCE_REDIS_URL) and DEST_REDIS_URL (or TARGET_REDIS_URL) are required.");
  process.exit(1);
}

const main = async () => {
  const source = createClient({ url: SOURCE_REDIS_URL });
  const dest = createClient({ url: DEST_REDIS_URL });

  await Promise.all([source.connect(), dest.connect()]);

  let scanned = 0;
  let copied = 0;
  let skippedExisting = 0;
  let missingDump = 0;
  let errors = 0;
  let fallbackCopied = 0;
  let fallbackErrors = 0;

  try {
    for await (const key of source.scanIterator({ MATCH: PATTERN, COUNT: 500 })) {
      scanned += 1;

      if (!OVERWRITE) {
        const exists = await dest.exists(key);
        if (exists) {
          skippedExisting += 1;
          console.warn(`Skipping existing key: ${key}`);
          continue;
        }
      }

      const dump = await source.dump(key);
      if (!dump) {
        missingDump += 1;
        console.warn(`No dump returned for key: ${key} (it may have been deleted during scan)`);
        continue;
      }

      const ttl = await source.pTTL(key);
      const ttlMs = ttl > 0 ? ttl : 0;

      if (DRY_RUN) {
        console.info(`[dry-run] Would copy key: ${key} (ttlMs=${ttlMs})`);
        continue;
      }

      try {
        await dest.restore(key, ttlMs, dump, { replace: OVERWRITE });
        copied += 1;
        console.info(`Copied key: ${key}`);
      } catch (err) {
        const errText = String(err);
        console.warn(`Failed to restore key ${key}: ${errText}`);

        // Fallback for older/newer dump formats: copy simple string values via GET/SET
        try {
          const type = await source.type(key);
          if (type === "string") {
            const val = await source.get(key);
            if (val === null) {
              console.warn(`Skipping fallback for ${key}: value disappeared`);
            } else {
              if (DRY_RUN) {
                console.info(`[dry-run] Fallback SET key: ${key} (ttlMs=${ttlMs})`);
              } else {
                const setOpts: Record<string, any> = {};
                if (ttlMs > 0) {
                  setOpts.PX = ttlMs;
                }
                if (!OVERWRITE) {
                  setOpts.NX = true;
                }
                const setRes = await dest.set(key, val, setOpts);
                if (setRes) {
                  fallbackCopied += 1;
                  console.info(`Fallback copied key (string): ${key}`);
                } else {
                  console.warn(`Fallback skipped key ${key}: already exists`);
                }
              }
            }
          } else {
            errors += 1;
            console.error(`No fallback available for key ${key} of type ${type}`);
          }
        } catch (fallbackErr) {
          fallbackErrors += 1;
          console.error(`Fallback failed for key ${key}: ${String(fallbackErr)}`);
        }
      }
    }
  } finally {
    await Promise.all([source.quit(), dest.quit()]);
  }

  console.info(
    `Done. scanned=${scanned} copied=${copied} fallback_copied=${fallbackCopied} skipped_existing=${skippedExisting} missing_dump=${missingDump} errors=${errors} fallback_errors=${fallbackErrors}`,
  );
};

main().catch((err) => {
  console.error(`Migration failed: ${String(err)}`);
  process.exit(1);
});
