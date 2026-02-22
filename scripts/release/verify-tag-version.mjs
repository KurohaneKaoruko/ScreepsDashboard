#!/usr/bin/env node
import {
  ensureVersionsEqualTo,
  normalizeVersion,
  validateVersion,
} from "./version-sync.mjs";

function printUsage() {
  console.log(`Usage:
  npm run version:verify-tag -- v1.2.3
  npm run version:verify-tag -- v1.2.3-alpha
  node scripts/release/verify-tag-version.mjs v1.2.3`);
}

const tag = process.argv[2];
if (!tag || tag === "--help" || tag === "-h") {
  printUsage();
  process.exit(tag ? 0 : 1);
}

const expectedVersion = normalizeVersion(tag);
if (!validateVersion(expectedVersion)) {
  console.error(`Invalid tag "${tag}". Expected format v1.2.3 / v1.2.3-alpha (or without v).`);
  process.exit(1);
}

const result = ensureVersionsEqualTo(expectedVersion);
if (!result.ok) {
  console.error(`Version mismatch for tag ${tag}:`);
  for (const mismatch of result.mismatches) {
    console.error(`  ${mismatch.key}: ${mismatch.value} (expected ${mismatch.expected})`);
  }
  process.exit(1);
}

console.log(`Version check passed: ${tag} matches all version files.`);
