#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { basename } from "node:path";
import {
  normalizeVersion,
  projectRoot,
  readProjectVersions,
  setProjectVersion,
  validateVersion,
} from "./version-sync.mjs";

function printUsage() {
  console.log(`Usage:
  npm run release
  npm run release -- --version 1.2.3
  npm run release -- --version 1.2.3 --skip-check
  npm run release -- --version 1.2.3 --no-push

Options:
  --version, -v   Release version, e.g. 1.2.3 (or v1.2.3)
  --skip-check    Skip "npm run check"
  --no-push       Do not push commit/tag to remote
  --yes, -y       Skip confirmation prompt
`);
}

function parseArgs(argv) {
  const options = {
    version: "",
    skipCheck: null,
    noPush: null,
    yes: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--skip-check") {
      options.skipCheck = true;
      continue;
    }
    if (arg === "--no-push") {
      options.noPush = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      options.version = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function run(command, args, captureOutput = false) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const fullCommand = `${command} ${args.join(" ")}`.trim();
    throw new Error(`Command failed (${result.status}): ${fullCommand}`);
  }
  return captureOutput ? (result.stdout ?? "").trim() : "";
}

function resolvePackageManagerRunArgs(scriptName) {
  const execPath = process.env.npm_execpath;
  if (execPath) {
    const lowerExec = execPath.toLowerCase();
    const isJsEntry =
      lowerExec.endsWith(".js") || lowerExec.endsWith(".cjs") || lowerExec.endsWith(".mjs");
    if (isJsEntry) {
      return [process.execPath, [execPath, "run", scriptName]];
    }
    return [execPath, ["run", scriptName]];
  }

  const userAgent = (process.env.npm_config_user_agent ?? "").toLowerCase();
  if (userAgent.startsWith("pnpm/")) {
    return ["pnpm", ["run", scriptName]];
  }
  if (userAgent.startsWith("yarn/")) {
    return ["yarn", ["run", scriptName]];
  }
  return ["npm", ["run", scriptName]];
}

function getPackageManagerName() {
  const execPath = (process.env.npm_execpath ?? "").toLowerCase();
  if (execPath.includes("pnpm")) {
    return "pnpm";
  }
  if (execPath.includes("yarn")) {
    return "yarn";
  }
  if (execPath.includes("npm")) {
    return "npm";
  }
  const userAgent = (process.env.npm_config_user_agent ?? "").toLowerCase();
  if (userAgent.startsWith("pnpm/")) {
    return "pnpm";
  }
  if (userAgent.startsWith("yarn/")) {
    return "yarn";
  }
  return "npm";
}

function runPackageScript(scriptName) {
  const [command, args] = resolvePackageManagerRunArgs(scriptName);
  run(command, args);
}

function inGitRepo() {
  try {
    const output = run("git", ["rev-parse", "--is-inside-work-tree"], true);
    return output === "true";
  } catch {
    return false;
  }
}

function requireCleanWorktree() {
  const status = run("git", ["status", "--porcelain"], true);
  if (status) {
    throw new Error(
      "Working tree is not clean. Commit/stash current changes before running release.",
    );
  }
}

function ensureTagDoesNotExist(tag) {
  const result = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
    cwd: projectRoot,
    stdio: "ignore",
  });
  if (result.status === 0) {
    throw new Error(`Tag already exists: ${tag}`);
  }
}

async function askVersion(defaultVersion) {
  if (!stdin.isTTY) {
    throw new Error("No interactive terminal detected. Please pass --version.");
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`Release version (current: ${defaultVersion}): `);
  rl.close();
  return normalizeVersion(answer || defaultVersion);
}

async function askYesNo(question, defaultYes = true) {
  if (!stdin.isTTY) {
    return defaultYes;
  }
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`${question} ${hint}: `)).trim().toLowerCase();
  rl.close();
  if (!answer) {
    return defaultYes;
  }
  return answer === "y" || answer === "yes";
}

async function askConfirmation(version, noPush) {
  if (!stdin.isTTY) {
    return;
  }
  const action = noPush
    ? `commit + tag locally for v${version}`
    : `commit + tag + push for v${version}`;
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`Confirm ${action}? [y/N]: `);
  rl.close();
  if (!/^(y|yes)$/i.test(answer.trim())) {
    throw new Error("Release cancelled by user.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!inGitRepo()) {
    throw new Error("This script must run inside a git repository.");
  }
  requireCleanWorktree();

  const currentVersions = readProjectVersions();
  const nextVersion = options.version
    ? normalizeVersion(options.version)
    : await askVersion(currentVersions.packageJson);

  if (!validateVersion(nextVersion)) {
    throw new Error(`Invalid version "${nextVersion}". Expected SemVer like 1.2.3`);
  }

  const tag = `v${nextVersion}`;
  ensureTagDoesNotExist(tag);

  if (!options.yes) {
    await askConfirmation(nextVersion, options.noPush);
  }

  const result = setProjectVersion(nextVersion);
  const anyVersionFileChanged = result.changed.some((item) => item.from !== item.to);

  if (!anyVersionFileChanged) {
    console.log(`Version already ${nextVersion}, no version files changed. Tagging current commit.`);
  } else {
    console.log(`Updated version to ${nextVersion}`);
    for (const item of result.changed) {
      console.log(`  ${item.file}: ${item.from} -> ${item.to}`);
    }
  }

  const shouldRunCheck =
    options.skipCheck === true
      ? false
      : options.skipCheck === null
        ? await askYesNo(`Run ${getPackageManagerName()} run check before release?`, true)
        : true;

  if (shouldRunCheck) {
    runPackageScript("check");
  }

  if (anyVersionFileChanged) {
    run("git", ["add", "package.json", "src-tauri/Cargo.toml", "src-tauri/tauri.conf.json"]);
    run("git", ["commit", "-m", `release: ${tag}`]);
  }
  run("git", ["tag", tag]);

  const shouldPush =
    options.noPush === true
      ? false
      : options.noPush === null
        ? await askYesNo("Push commit and tag to remote now?", true)
        : true;

  if (shouldPush) {
    run("git", ["push"]);
    run("git", ["push", "origin", tag]);
  }

  console.log("");
  console.log(`Release ready: ${tag}`);
  if (!shouldPush) {
    console.log(`Push manually when ready: git push && git push origin ${tag}`);
  } else {
    console.log(`GitHub Actions will build installers from tag ${tag}.`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
