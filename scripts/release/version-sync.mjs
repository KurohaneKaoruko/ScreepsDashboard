import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(scriptDir, "..", "..");

export const versionFiles = Object.freeze({
  packageJson: resolve(projectRoot, "package.json"),
  cargoToml: resolve(projectRoot, "src-tauri", "Cargo.toml"),
  tauriConf: resolve(projectRoot, "src-tauri", "tauri.conf.json"),
});

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const cargoVersionPattern = /(\[package\][\s\S]*?^\s*version\s*=\s*")([^"]+)(")/m;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readCargoVersion(fileContent) {
  const match = fileContent.match(cargoVersionPattern);
  if (!match) {
    throw new Error(`Cannot locate [package].version in ${versionFiles.cargoToml}`);
  }
  return match[2];
}

export function normalizeVersion(input) {
  return String(input ?? "").trim().replace(/^v/i, "");
}

export function validateVersion(version) {
  return semverPattern.test(version);
}

export function readProjectVersions() {
  const packageJsonVersion = readJson(versionFiles.packageJson).version;
  const tauriConfVersion = readJson(versionFiles.tauriConf).version;
  const cargoTomlContent = readFileSync(versionFiles.cargoToml, "utf8");
  const cargoTomlVersion = readCargoVersion(cargoTomlContent);

  return {
    packageJson: packageJsonVersion,
    cargoToml: cargoTomlVersion,
    tauriConf: tauriConfVersion,
  };
}

export function setProjectVersion(rawVersion) {
  const version = normalizeVersion(rawVersion);
  if (!validateVersion(version)) {
    throw new Error(`Invalid version "${rawVersion}". Use SemVer format like 1.2.3`);
  }

  const packageJson = readJson(versionFiles.packageJson);
  const tauriConf = readJson(versionFiles.tauriConf);
  const cargoTomlContent = readFileSync(versionFiles.cargoToml, "utf8");

  const previous = {
    packageJson: packageJson.version,
    cargoToml: readCargoVersion(cargoTomlContent),
    tauriConf: tauriConf.version,
  };

  if (previous.packageJson !== version) {
    packageJson.version = version;
    writeJson(versionFiles.packageJson, packageJson);
  }
  if (previous.tauriConf !== version) {
    tauriConf.version = version;
    writeJson(versionFiles.tauriConf, tauriConf);
  }
  if (previous.cargoToml !== version) {
    const nextCargoTomlContent = cargoTomlContent.replace(
      cargoVersionPattern,
      `$1${version}$3`,
    );
    writeFileSync(versionFiles.cargoToml, nextCargoTomlContent, "utf8");
  }

  return {
    version,
    previous,
    changed: [
      {
        file: "package.json",
        from: previous.packageJson,
        to: version,
      },
      {
        file: "src-tauri/Cargo.toml",
        from: previous.cargoToml,
        to: version,
      },
      {
        file: "src-tauri/tauri.conf.json",
        from: previous.tauriConf,
        to: version,
      },
    ],
  };
}

export function ensureVersionsEqualTo(expectedVersion) {
  const version = normalizeVersion(expectedVersion);
  const current = readProjectVersions();
  const mismatches = Object.entries(current)
    .filter(([, value]) => value !== version)
    .map(([key, value]) => ({ key, value, expected: version }));

  return {
    version,
    current,
    mismatches,
    ok: mismatches.length === 0,
  };
}
