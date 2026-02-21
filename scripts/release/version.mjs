#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  normalizeVersion,
  readProjectVersions,
  setProjectVersion,
  validateVersion,
} from "./version-sync.mjs";

function printUsage() {
  console.log(`Usage:
  npm run version
  npm run version -- 1.2.3
  node scripts/release/version.mjs 1.2.3

Rules:
  - Version must follow SemVer, e.g. 1.2.3 or 1.2.3-beta.1
  - Leading "v" is allowed and will be stripped
`);
}

function parseVersionArg(argv) {
  const helpArg = argv.find((arg) => arg === "--help" || arg === "-h");
  if (helpArg) {
    return { help: true, version: "" };
  }
  const versionArg = argv.find((arg) => !arg.startsWith("-")) ?? "";
  return { help: false, version: versionArg };
}

async function askVersion(defaultVersion) {
  if (!stdin.isTTY) {
    throw new Error("No interactive terminal detected. Please pass version as an argument.");
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`New version (current: ${defaultVersion}): `);
  rl.close();
  const nextVersion = normalizeVersion(answer || defaultVersion);
  return nextVersion;
}

async function main() {
  const { help, version: versionArg } = parseVersionArg(process.argv.slice(2));
  if (help) {
    printUsage();
    return;
  }

  const current = readProjectVersions();
  const nextVersion = versionArg ? normalizeVersion(versionArg) : await askVersion(current.packageJson);

  if (!validateVersion(nextVersion)) {
    throw new Error(`Invalid version "${nextVersion}". Expected SemVer like 1.2.3`);
  }

  const result = setProjectVersion(nextVersion);
  const anyChanged = result.changed.some((item) => item.from !== item.to);

  if (!anyChanged) {
    console.log(`Version unchanged: ${nextVersion}`);
    return;
  }

  console.log(`Updated version to ${nextVersion}:`);
  for (const item of result.changed) {
    console.log(`  ${item.file}: ${item.from} -> ${item.to}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
