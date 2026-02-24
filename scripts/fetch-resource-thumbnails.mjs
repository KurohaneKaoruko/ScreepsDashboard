#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const RESOURCE_META_PATH = path.resolve(
  process.cwd(),
  "src-next/lib/screeps/resource-meta.ts"
);
const OUTPUT_DIR = path.resolve(
  process.cwd(),
  "src-next/public/screeps-resource-thumbs"
);
const SOURCE_BASE_URL =
  "https://s3.amazonaws.com/static.screeps.com/upload/mineral-icons";

const SPECIAL_CANONICAL_CODES = {
  accesskey: "accessKey",
  cpuunlock: "cpuUnlock",
};

const EXTRA_RESOURCE_CODES = ["token", "pixel", "accessKey", "cpuUnlock"];
const ALWAYS_LOWERCASE_ICON_CODES = new Set([
  "token",
  "pixel",
  "accesskey",
  "cpuunlock",
]);
const OPTIONAL_MISSING_ICONS = new Set(["pixel", "accesskey", "cpuunlock"]);

function parseCliArgs(argv) {
  const options = {
    force: false,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
  }

  return options;
}

function canonicalResourceCode(resourceType) {
  const trimmed = String(resourceType ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  const special = SPECIAL_CANONICAL_CODES[lower];
  if (special) {
    return special;
  }

  if (/^[a-z0-9]+$/.test(lower) && /\d/.test(lower)) {
    return lower.toUpperCase();
  }
  if (/^[a-z]{1,2}$/.test(lower)) {
    return lower.toUpperCase();
  }

  return trimmed;
}

function extractKnownResourceTypes(resourceMetaText) {
  const resources = new Set();
  const resourceArrayPattern = /resources:\s*\[([\s\S]*?)\]/g;
  let groupMatch = resourceArrayPattern.exec(resourceMetaText);

  while (groupMatch) {
    const block = groupMatch[1];
    const valuePattern = /"([^"]+)"/g;
    let valueMatch = valuePattern.exec(block);
    while (valueMatch) {
      resources.add(valueMatch[1]);
      valueMatch = valuePattern.exec(block);
    }

    groupMatch = resourceArrayPattern.exec(resourceMetaText);
  }

  for (const extra of EXTRA_RESOURCE_CODES) {
    resources.add(extra);
  }

  return [...resources];
}

function buildIconFileNames(resourceTypes) {
  const normalizedCodes = resourceTypes
    .map((resourceType) => canonicalResourceCode(resourceType))
    .filter((code) => code.length > 0);

  const lowercaseIconCodes = new Set(
    normalizedCodes
      .filter((code) => code.toLowerCase() === code)
      .map((code) => code.toLowerCase())
  );
  for (const lowerCode of ALWAYS_LOWERCASE_ICON_CODES) {
    lowercaseIconCodes.add(lowerCode);
  }

  const iconNames = new Set();
  for (const code of normalizedCodes) {
    const lower = code.toLowerCase();
    if (lowercaseIconCodes.has(lower)) {
      iconNames.add(lower);
    } else {
      iconNames.add(code);
    }
  }

  return [...iconNames].sort((left, right) => left.localeCompare(right));
}

async function downloadIcon(iconName, options) {
  const filePath = path.join(OUTPUT_DIR, `${iconName}.png`);
  const url = `${SOURCE_BASE_URL}/${encodeURIComponent(iconName)}.png`;

  if (!options.force) {
    try {
      await fs.access(filePath);
      return { status: "skipped", iconName };
    } catch {
      // file does not exist, continue download.
    }
  }

  if (options.dryRun) {
    return { status: "dry-run", iconName, url };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const optionalMissing =
        (response.status === 403 || response.status === 404) &&
        OPTIONAL_MISSING_ICONS.has(iconName.toLowerCase());
      if (optionalMissing) {
        return {
          status: "optional-missing",
          iconName,
          message: `HTTP ${response.status}`,
        };
      }
      return {
        status: "failed",
        iconName,
        message: `HTTP ${response.status}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
    return { status: "downloaded", iconName };
  } catch (error) {
    return {
      status: "failed",
      iconName,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runWithConcurrency(items, limit, worker) {
  const outputs = [];
  let cursor = 0;

  async function consume() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      const result = await worker(items[current]);
      outputs[current] = result;
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    () => consume()
  );
  await Promise.all(workers);
  return outputs;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  const resourceMetaText = await fs.readFile(RESOURCE_META_PATH, "utf8");
  const resourceTypes = extractKnownResourceTypes(resourceMetaText);
  const iconFileNames = buildIconFileNames(resourceTypes);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log(
    `Preparing ${iconFileNames.length} resource thumbnail icons from ${SOURCE_BASE_URL}`
  );

  const results = await runWithConcurrency(iconFileNames, 8, (iconName) =>
    downloadIcon(iconName, options)
  );

  const downloaded = results.filter((item) => item.status === "downloaded");
  const skipped = results.filter((item) => item.status === "skipped");
  const dryRun = results.filter((item) => item.status === "dry-run");
  const optionalMissing = results.filter((item) => item.status === "optional-missing");
  const failed = results.filter((item) => item.status === "failed");

  console.log(
    `Done. downloaded=${downloaded.length} skipped=${skipped.length} dryRun=${dryRun.length} optionalMissing=${optionalMissing.length} failed=${failed.length}`
  );

  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`- ${failure.iconName}: ${failure.message}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
