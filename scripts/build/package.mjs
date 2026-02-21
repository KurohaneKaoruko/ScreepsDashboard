import { spawnSync } from "node:child_process";
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");
const tauriCliPath = resolve(
  projectRoot,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const distRoot = resolve(projectRoot, "dist");

const TARGETS = {
  windows: {
    label: "windows",
    hostPlatform: "win32",
    tauriArgs: ["build", "--target", "x86_64-pc-windows-msvc"],
  },
  macos: {
    label: "macos",
    hostPlatform: "darwin",
    tauriArgs: ["build", "--target", "universal-apple-darwin"],
  },
  linux: {
    label: "linux",
    hostPlatform: "linux",
    tauriArgs: ["build", "--target", "x86_64-unknown-linux-gnu"],
  },
  "android-apk": {
    label: "android-apk",
    envVars: ["ANDROID_HOME", "NDK_HOME"],
    tauriArgs: ["android", "build", "--ci", "--apk", "--target", "aarch64", "armv7"],
  },
  "android-aab": {
    label: "android-aab",
    envVars: ["ANDROID_HOME", "NDK_HOME"],
    tauriArgs: ["android", "build", "--ci", "--aab", "--target", "aarch64", "armv7"],
  },
  ios: {
    label: "ios",
    hostPlatform: "darwin",
    tauriArgs: ["ios", "build", "--ci"],
  },
};

const ALIASES = {
  "android:apk": "android-apk",
  "android:aab": "android-aab",
  apk: "android-apk",
  aab: "android-aab",
  iphone: "ios",
  ipad: "ios",
};

const ARTIFACT_RULES = {
  windows: {
    roots: [resolve(projectRoot, "src-tauri", "target")],
    suffixes: [".msi", "-setup.exe"],
    mustInclude: ["/bundle/"],
    fallbackCount: 4,
  },
  macos: {
    roots: [resolve(projectRoot, "src-tauri", "target")],
    suffixes: [".dmg", ".app.tar.gz", ".pkg"],
    mustInclude: ["/bundle/"],
    fallbackCount: 4,
  },
  linux: {
    roots: [resolve(projectRoot, "src-tauri", "target")],
    suffixes: [".appimage", ".deb", ".rpm", ".tar.gz"],
    mustInclude: ["/bundle/"],
    fallbackCount: 6,
  },
  "android-apk": {
    roots: [resolve(projectRoot, "src-tauri", "gen", "android", "app", "build", "outputs", "apk")],
    suffixes: [".apk"],
    mustInclude: ["/release/"],
    fallbackCount: 3,
  },
  "android-aab": {
    roots: [resolve(projectRoot, "src-tauri", "gen", "android", "app", "build", "outputs", "bundle")],
    suffixes: [".aab"],
    mustInclude: ["/release/"],
    fallbackCount: 3,
  },
  ios: {
    roots: [resolve(projectRoot, "src-tauri", "gen", "apple", "build")],
    suffixes: [".ipa", ".app", ".xcarchive"],
    mustInclude: [],
    allowDirectories: true,
    fallbackCount: 4,
  },
};

function printUsage() {
  console.log(`Usage:
  npm run package:target -- <target> [tauri_args...]
  ./scripts/build/package.sh <target> [tauri_args...]
  scripts\\build\\package.bat <target> [tauri_args...]

Targets:
  windows
  macos
  linux
  android-apk (alias: android:apk, apk)
  android-aab (alias: android:aab, aab)
  ios (alias: iphone, ipad)

Examples:
  npm run package:target -- windows --ci
  npm run package:target -- android-apk --debug
  npm run package:target -- ios --export-method app-store-connect

Output:
  Key artifacts will be copied to dist/<target>/`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizePathForMatch(filePath) {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

function matchesRule(pathName, rule) {
  const normalized = normalizePathForMatch(pathName);
  const hasSuffix = rule.suffixes.some((suffix) => normalized.endsWith(suffix.toLowerCase()));
  if (!hasSuffix) {
    return false;
  }

  const mustInclude = rule.mustInclude ?? [];
  return mustInclude.every((part) => normalized.includes(part.toLowerCase()));
}

function walkArtifacts(dirPath, rule, matched = []) {
  if (!existsSync(dirPath)) {
    return matched;
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (rule.allowDirectories && matchesRule(fullPath, rule)) {
        const stat = statSync(fullPath);
        matched.push({
          artifactPath: fullPath,
          mtimeMs: stat.mtimeMs,
          isDirectory: true,
        });
        continue;
      }
      walkArtifacts(fullPath, rule, matched);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    if (matchesRule(fullPath, rule)) {
      const stat = statSync(fullPath);
      matched.push({
        artifactPath: fullPath,
        mtimeMs: stat.mtimeMs,
        isDirectory: false,
      });
    }
  }

  return matched;
}

function findArtifacts(targetKey, buildStartedAtMs) {
  const rule = ARTIFACT_RULES[targetKey];
  if (!rule) {
    return [];
  }

  const matched = [];
  for (const root of rule.roots) {
    walkArtifacts(root, rule, matched);
  }

  matched.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const freshArtifacts = matched.filter((item) => item.mtimeMs >= buildStartedAtMs - 2000);
  const selected = (freshArtifacts.length > 0 ? freshArtifacts : matched).slice(
    0,
    rule.fallbackCount,
  );

  const seen = new Set();
  return selected.filter((item) => {
    const key = basename(item.artifactPath).toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function copyArtifactsToDist(targetKey, label, buildStartedAtMs) {
  const artifacts = findArtifacts(targetKey, buildStartedAtMs);
  if (artifacts.length === 0) {
    console.warn(`[package:${label}] Build succeeded, but no key artifacts were found to copy.`);
    return;
  }

  const targetDistDir = resolve(distRoot, targetKey);
  rmSync(targetDistDir, { recursive: true, force: true });
  mkdirSync(targetDistDir, { recursive: true });

  for (const artifact of artifacts) {
    const destinationPath = resolve(targetDistDir, basename(artifact.artifactPath));
    rmSync(destinationPath, { recursive: true, force: true });
    if (artifact.isDirectory) {
      cpSync(artifact.artifactPath, destinationPath, { recursive: true, force: true });
    } else {
      copyFileSync(artifact.artifactPath, destinationPath);
    }
  }

  console.log(`[package:${label}] Copied ${artifacts.length} artifact(s) to ${targetDistDir}`);
  for (const artifact of artifacts) {
    console.log(`  - ${artifact.artifactPath}`);
  }
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

const requestedTarget = args[0].toLowerCase();
const targetKey = ALIASES[requestedTarget] ?? requestedTarget;
const target = TARGETS[targetKey];
const passthroughArgs = args.slice(1);

if (!target) {
  printUsage();
  fail(`Unknown target: ${requestedTarget}`);
}

if (target.hostPlatform && process.platform !== target.hostPlatform) {
  fail(
    `[package:${target.label}] This target must run on ${target.hostPlatform}. Current: ${process.platform}.`,
  );
}

if (target.envVars) {
  const missingVars = target.envVars.filter((name) => !process.env[name]);
  if (missingVars.length > 0) {
    fail(
      `[package:${target.label}] Missing required environment variables: ${missingVars.join(", ")}`,
    );
  }
}

if (!existsSync(tauriCliPath)) {
  fail(`[package:${target.label}] Tauri CLI not found: ${tauriCliPath}. Run npm install first.`);
}

const buildStartedAtMs = Date.now();
const result = spawnSync(
  process.execPath,
  [tauriCliPath, ...target.tauriArgs, ...passthroughArgs],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  fail(`[package:${target.label}] Failed to start build: ${result.error.message}`);
}

const status = result.status ?? 1;
if (status !== 0) {
  process.exit(status);
}

copyArtifactsToDist(targetKey, target.label, buildStartedAtMs);
