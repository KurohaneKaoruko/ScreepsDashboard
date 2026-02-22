import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");
const packageScript = resolve(scriptDir, "package.mjs");

function printUsage() {
  console.log(`Usage:
  npm run package:all
  node scripts/build/package-all-host.mjs [package_args...]

Behavior:
  - Builds all supported targets for the current host OS.
  - Adds Android multi-ABI build when ANDROID_HOME and NDK_HOME are set.
  - Passes extra args through to package.mjs (example: --debug).`);
}

function runPackageTarget(target, passthroughArgs) {
  console.log(`[package:all] Building target: ${target}`);
  const result = spawnSync(process.execPath, [packageScript, target, ...passthroughArgs], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (!existsSync(packageScript)) {
  console.error(`Missing script: ${packageScript}`);
  process.exit(1);
}

const passthroughArgs = args.length > 0 ? args : ["--ci"];
const targetsByHost = {
  win32: ["windows-all"],
  linux: ["linux-all"],
  darwin: ["macos", "ios"],
};

const hostTargets = targetsByHost[process.platform];
if (!hostTargets) {
  console.error(`[package:all] Unsupported host platform: ${process.platform}`);
  process.exit(1);
}

for (const target of hostTargets) {
  runPackageTarget(target, passthroughArgs);
}

if (process.env.ANDROID_HOME && process.env.NDK_HOME) {
  runPackageTarget("android-all", passthroughArgs);
} else {
  console.log(
    "[package:all] Skipping Android build (requires ANDROID_HOME and NDK_HOME).",
  );
}

console.log("[package:all] Completed.");
