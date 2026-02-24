import { spawnSync } from "node:child_process";
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");
const tauriConfigPath = resolve(projectRoot, "src-tauri", "tauri.conf.json");
const tauriCliPath = resolve(
  projectRoot,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const distRoot = resolve(projectRoot, "dist");
const WINDOWS_AMD64_TRIPLE = "x86_64-pc-windows-msvc";
const WINDOWS_ARM64_TRIPLE = "aarch64-pc-windows-msvc";
const MACOS_UNIVERSAL_TRIPLE = "universal-apple-darwin";
const LINUX_AMD64_TRIPLE = "x86_64-unknown-linux-gnu";
const LINUX_ARM64_TRIPLE = "aarch64-unknown-linux-gnu";
const ANDROID_ABI_TARGETS = ["aarch64", "armv7", "x86_64", "i686"];
let packageIdentityCache = null;

const TARGETS = {
  "windows-amd64": {
    label: "windows-amd64",
    hostPlatform: "win32",
    tauriArgs: ["build", "--target", WINDOWS_AMD64_TRIPLE],
  },
  "windows-arm64": {
    label: "windows-arm64",
    hostPlatform: "win32",
    tauriArgs: ["build", "--target", WINDOWS_ARM64_TRIPLE],
  },
  "windows-all": {
    label: "windows-all",
    hostPlatform: "win32",
    composedTargets: ["windows-amd64", "windows-arm64"],
  },
  macos: {
    label: "macos",
    hostPlatform: "darwin",
    tauriArgs: ["build", "--target", MACOS_UNIVERSAL_TRIPLE],
  },
  "linux-amd64": {
    label: "linux-amd64",
    hostPlatform: "linux",
    tauriArgs: ["build", "--target", LINUX_AMD64_TRIPLE],
  },
  "linux-arm64": {
    label: "linux-arm64",
    hostPlatform: "linux",
    tauriArgs: ["build", "--target", LINUX_ARM64_TRIPLE],
  },
  "linux-all": {
    label: "linux-all",
    hostPlatform: "linux",
    composedTargets: ["linux-amd64", "linux-arm64"],
  },
  "android-apk": {
    label: "android-apk",
    envVars: ["ANDROID_HOME", "NDK_HOME"],
    tauriArgs: ["android", "build", "--ci", "--apk", "--target", ...ANDROID_ABI_TARGETS],
  },
  "android-aab": {
    label: "android-aab",
    envVars: ["ANDROID_HOME", "NDK_HOME"],
    tauriArgs: ["android", "build", "--ci", "--aab", "--target", ...ANDROID_ABI_TARGETS],
  },
  "android-all": {
    label: "android-all",
    envVars: ["ANDROID_HOME", "NDK_HOME"],
    composedTargets: ["android-apk", "android-aab"],
  },
  ios: {
    label: "ios",
    hostPlatform: "darwin",
    tauriArgs: ["ios", "build", "--ci"],
  },
};

const ALIASES = {
  windows: "windows-amd64",
  win: "windows-amd64",
  amd64: "windows-amd64",
  x64: "windows-amd64",
  "windows:all": "windows-all",
  arm64: "windows-arm64",
  "windows-arm": "windows-arm64",
  "windows-aarch64": "windows-arm64",
  linux: "linux-amd64",
  "linux-x64": "linux-amd64",
  "linux-amd64": "linux-amd64",
  "linux-arm": "linux-arm64",
  "linux-aarch64": "linux-arm64",
  "linux:all": "linux-all",
  mac: "macos",
  "macos-universal": "macos",
  android: "android-all",
  "android:all": "android-all",
  "android:apk": "android-apk",
  "android:aab": "android-aab",
  apk: "android-apk",
  aab: "android-aab",
  iphone: "ios",
  ipad: "ios",
};

const ARTIFACT_RULES = {
  "windows-amd64": {
    roots: [resolve(projectRoot, "src-tauri", "target")],
    suffixes: [".msi", "-setup.exe"],
    mustInclude: [`/${WINDOWS_AMD64_TRIPLE}/`, "/bundle/"],
    fallbackCount: 4,
  },
  "windows-arm64": {
    roots: [resolve(projectRoot, "src-tauri", "target")],
    suffixes: [".msi", "-setup.exe"],
    mustInclude: [`/${WINDOWS_ARM64_TRIPLE}/`, "/bundle/"],
    fallbackCount: 4,
  },
  macos: {
    roots: [resolve(projectRoot, "src-tauri", "target")],
    suffixes: [".dmg", ".app.tar.gz", ".pkg"],
    mustInclude: [`/${MACOS_UNIVERSAL_TRIPLE}/`, "/bundle/"],
    fallbackCount: 4,
  },
  "linux-amd64": {
    roots: [resolve(projectRoot, "src-tauri", "target")],
    suffixes: [".appimage", ".deb", ".rpm", ".tar.gz"],
    mustInclude: [`/${LINUX_AMD64_TRIPLE}/`, "/bundle/"],
    fallbackCount: 6,
  },
  "linux-arm64": {
    roots: [resolve(projectRoot, "src-tauri", "target")],
    suffixes: [".appimage", ".deb", ".rpm", ".tar.gz"],
    mustInclude: [`/${LINUX_ARM64_TRIPLE}/`, "/bundle/"],
    fallbackCount: 6,
  },
  "android-apk": {
    roots: [resolve(projectRoot, "src-tauri", "gen", "android", "app", "build", "outputs", "apk")],
    suffixes: [".apk"],
    mustInclude: ["release"],
    fallbackCount: 10,
  },
  "android-aab": {
    roots: [resolve(projectRoot, "src-tauri", "gen", "android", "app", "build", "outputs", "bundle")],
    suffixes: [".aab"],
    mustInclude: ["release"],
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
  windows-amd64 (alias: windows, win, amd64, x64)
  windows-arm64 (alias: arm64, windows-arm, windows-aarch64)
  windows-all (alias: windows:all)
  macos
  linux-amd64 (alias: linux, linux-x64)
  linux-arm64 (alias: linux-arm, linux-aarch64)
  linux-all (alias: linux:all)
  android-apk (alias: android:apk, apk)
  android-aab (alias: android:aab, aab)
  android-all (alias: android, android:all)
  ios (alias: iphone, ipad)

Examples:
  npm run package:target -- windows-amd64 --ci
  npm run package:target -- windows-arm64 --ci
  npm run package:target -- windows-all --ci
  npm run package:target -- linux-all --ci
  npm run package:target -- android-all --ci
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

function slugifyFilePart(value, fallback = "app") {
  const raw = String(value ?? "").trim();
  const normalized = raw
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function loadPackageIdentity() {
  if (packageIdentityCache) {
    return packageIdentityCache;
  }

  const fallback = {
    productSlug: "app",
    versionSlug: "0.0.0",
  };

  if (!existsSync(tauriConfigPath)) {
    packageIdentityCache = fallback;
    return packageIdentityCache;
  }

  try {
    const parsed = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
    packageIdentityCache = {
      productSlug: slugifyFilePart(parsed.productName, fallback.productSlug),
      versionSlug: slugifyFilePart(parsed.version, fallback.versionSlug),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[package] Failed to parse ${tauriConfigPath}: ${reason}`);
    packageIdentityCache = fallback;
  }

  return packageIdentityCache;
}

function makeUniqueName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }

  const extension = extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  let index = 2;
  while (true) {
    const candidate = `${stem}-${index}${extension}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    index += 1;
  }
}

function getArtifactDestinationName(targetKey, artifactPath, usedNames) {
  const sourceName = basename(artifactPath);
  if (targetKey !== "android-apk" && targetKey !== "android-aab") {
    return makeUniqueName(sourceName, usedNames);
  }

  const extension = extname(sourceName).toLowerCase();
  if (extension !== ".apk" && extension !== ".aab") {
    return makeUniqueName(sourceName, usedNames);
  }

  const { productSlug, versionSlug } = loadPackageIdentity();
  const sourceStem = basename(sourceName, extension);
  const variant = slugifyFilePart(sourceStem.replace(/^app-/i, ""), targetKey);
  const packageKind = targetKey === "android-apk" ? "android-apk" : "android-aab";
  const renamed = `${productSlug}-${versionSlug}-${packageKind}-${variant}${extension}`;
  return makeUniqueName(renamed, usedNames);
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
  const usedNames = new Set();
  const copiedArtifacts = [];

  for (const artifact of artifacts) {
    const destinationName = getArtifactDestinationName(targetKey, artifact.artifactPath, usedNames);
    const destinationPath = resolve(targetDistDir, destinationName);
    rmSync(destinationPath, { recursive: true, force: true });
    if (artifact.isDirectory) {
      cpSync(artifact.artifactPath, destinationPath, { recursive: true, force: true });
    } else {
      copyFileSync(artifact.artifactPath, destinationPath);
    }
    copiedArtifacts.push({
      sourcePath: artifact.artifactPath,
      destinationPath,
      isDirectory: artifact.isDirectory,
    });
  }

  console.log(`[package:${label}] Copied ${artifacts.length} artifact(s) to ${targetDistDir}`);
  for (const copied of copiedArtifacts) {
    console.log(`  - ${copied.sourcePath} -> ${copied.destinationPath}`);
  }

  if (targetKey === "android-apk") {
    const unsignedApks = copiedArtifacts.filter((copied) => {
      const normalized = copied.destinationPath.replace(/\\/g, "/").toLowerCase();
      return !copied.isDirectory && normalized.endsWith(".apk") && normalized.includes("-unsigned.");
    });
    if (unsignedApks.length > 0) {
      console.warn(
        `[package:${label}] ${unsignedApks.length} APK artifact(s) appear unsigned. Sign them before installation/distribution.`,
      );
    }
  }
}

function ensureTargetReady(target) {
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
}

function runSingleTargetBuild(targetKey, target, passthroughArgs) {
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
}

function runTargetBuild(targetKey, passthroughArgs, visiting = new Set()) {
  const target = TARGETS[targetKey];
  if (!target) {
    fail(`Unknown target: ${targetKey}`);
  }

  ensureTargetReady(target);
  if (!target.composedTargets) {
    runSingleTargetBuild(targetKey, target, passthroughArgs);
    return;
  }

  if (visiting.has(targetKey)) {
    fail(`[package:${target.label}] Circular composed target reference detected.`);
  }

  visiting.add(targetKey);
  console.log(
    `[package:${target.label}] Running composed target: ${target.composedTargets.join(", ")}`,
  );
  for (const childKey of target.composedTargets) {
    runTargetBuild(childKey, passthroughArgs, visiting);
  }
  visiting.delete(targetKey);
}

function parseCliArgs(rawArgs) {
  const args = [...rawArgs];
  while (args[0] === "--") {
    args.shift();
  }

  if (args.length === 0) {
    return {
      requestedTarget: "",
      passthroughArgs: [],
    };
  }

  return {
    requestedTarget: args[0],
    passthroughArgs: args.slice(1),
  };
}

const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
  printUsage();
  process.exit(rawArgs.length === 0 ? 1 : 0);
}

const { requestedTarget: rawTarget, passthroughArgs } = parseCliArgs(rawArgs);
if (!rawTarget) {
  printUsage();
  fail("Missing target.");
}

const requestedTarget = rawTarget.toLowerCase();
const targetKey = ALIASES[requestedTarget] ?? requestedTarget;

if (!TARGETS[targetKey]) {
  printUsage();
  fail(`Unknown target: ${requestedTarget}`);
}

runTargetBuild(targetKey, passthroughArgs);
