import fs from "node:fs";
import path from "node:path";

const REPO_RELEASE_BASE = "https://github.com/359956085/codex-widget/releases/download";
const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const releaseDir = path.resolve(repoRoot, args.releaseDir ?? "src-tauri/target/release/github-release");
const packageJsonPath = path.join(repoRoot, "package.json");
const cargoTomlPath = path.join(repoRoot, "src-tauri/Cargo.toml");
const tauriConfigPath = path.join(repoRoot, "src-tauri/tauri.conf.json");

const packageJson = readJson(packageJsonPath);
const tauriConfig = readJson(tauriConfigPath);
const version = readJsonVersion(packageJson, "package.json");
const cargoVersion = readCargoVersion(cargoTomlPath);
const tauriVersion = resolveTauriVersion(tauriConfigPath, readJsonVersion(tauriConfig, "tauri.conf.json"));

if (version !== cargoVersion || version !== tauriVersion) {
  throw new Error(
    `版本号不一致：package.json=${version}，Cargo.toml=${cargoVersion}，tauri.conf.json=${tauriVersion}`
  );
}

fs.mkdirSync(releaseDir, { recursive: true });

const platforms = {};
const copiedAssets = [];
for (const platform of platformDefinitions(version)) {
  const collected = collectPlatform(platform);
  if (!collected) continue;
  platforms[platform.key] = {
    signature: fs.readFileSync(collected.signaturePath, "utf8").trim(),
    url: releaseUrl(version, platform.updateAssetName)
  };
  copiedAssets.push(...collected.assetNames);
}

const requiredKeys = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"];
if (args.requireAll) {
  const missing = requiredKeys.filter((key) => !platforms[key]);
  if (missing.length > 0) {
    throw new Error(`缺少 Release 平台产物：${missing.join(", ")}`);
  }
}

if (Object.keys(platforms).length === 0) {
  throw new Error("未找到任何可生成 latest.json 的 Release 产物。");
}

const manifest = {
  version,
  notes: `Codex 额度小组件 ${version}`,
  pub_date: new Date().toISOString(),
  platforms
};

const manifestPath = path.join(releaseDir, "latest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`GitHub Release 产物已生成：${releaseDir}`);
for (const asset of [...new Set(copiedAssets), "latest.json"]) {
  console.log(` - ${asset}`);
}

function parseArgs(values) {
  const parsed = { requireAll: false, releaseDir: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--require-all") {
      parsed.requireAll = true;
    } else if (value === "--release-dir") {
      parsed.releaseDir = values[index + 1];
      index += 1;
    } else if (value.startsWith("--release-dir=")) {
      parsed.releaseDir = value.slice("--release-dir=".length);
    }
  }
  return parsed;
}

function platformDefinitions(appVersion) {
  return [
    {
      key: "windows-x86_64",
      updateAssetName: `codex-widget_${appVersion}_windows_x64-setup.exe`,
      signatureAssetName: `codex-widget_${appVersion}_windows_x64-setup.exe.sig`,
      extraAssetNames: [],
      source: () => {
        const installer = newestFile(path.join(repoRoot, "src-tauri/target/release/bundle/nsis"), (name) => name.endsWith(".exe"));
        return installer ? { update: installer, signature: `${installer}.sig`, extras: [] } : null;
      }
    },
    {
      key: "darwin-aarch64",
      updateAssetName: `codex-widget_${appVersion}_macos_aarch64.app.tar.gz`,
      signatureAssetName: `codex-widget_${appVersion}_macos_aarch64.app.tar.gz.sig`,
      extraAssetNames: [`codex-widget_${appVersion}_macos_aarch64.dmg`],
      source: () => macSource("aarch64-apple-darwin")
    },
    {
      key: "darwin-x86_64",
      updateAssetName: `codex-widget_${appVersion}_macos_x64.app.tar.gz`,
      signatureAssetName: `codex-widget_${appVersion}_macos_x64.app.tar.gz.sig`,
      extraAssetNames: [`codex-widget_${appVersion}_macos_x64.dmg`],
      source: () => macSource("x86_64-apple-darwin")
    }
  ];
}

function macSource(target) {
  const bundleDir = path.join(repoRoot, "src-tauri/target", target, "release/bundle");
  const update = newestFile(path.join(bundleDir, "macos"), (name) => name.endsWith(".app.tar.gz"));
  const dmg = newestFile(path.join(bundleDir, "dmg"), (name) => name.endsWith(".dmg"));
  return update ? { update, signature: `${update}.sig`, extras: dmg ? [dmg] : [] } : null;
}

function collectPlatform(platform) {
  const updatePath = path.join(releaseDir, platform.updateAssetName);
  const signaturePath = path.join(releaseDir, platform.signatureAssetName);
  const assetNames = [];

  if (fs.existsSync(updatePath) && fs.existsSync(signaturePath)) {
    assetNames.push(platform.updateAssetName, platform.signatureAssetName);
    for (const extraName of platform.extraAssetNames) {
      if (fs.existsSync(path.join(releaseDir, extraName))) assetNames.push(extraName);
    }
    return { signaturePath, assetNames };
  }

  const source = platform.source();
  if (!source || !fs.existsSync(source.update)) return null;
  if (!fs.existsSync(source.signature)) {
    throw new Error(`未找到更新包签名文件：${source.signature}`);
  }

  copyFile(source.update, updatePath);
  copyFile(source.signature, signaturePath);
  assetNames.push(platform.updateAssetName, platform.signatureAssetName);

  for (let index = 0; index < platform.extraAssetNames.length; index += 1) {
    const sourceExtra = source.extras[index];
    if (!sourceExtra) continue;
    const extraName = platform.extraAssetNames[index];
    copyFile(sourceExtra, path.join(releaseDir, extraName));
    assetNames.push(extraName);
  }

  return { signaturePath, assetNames };
}

function copyFile(source, target) {
  if (path.resolve(source) === path.resolve(target)) return;
  fs.copyFileSync(source, target);
}

function newestFile(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] ?? null;
}

function releaseUrl(appVersion, assetName) {
  return `${REPO_RELEASE_BASE}/v${appVersion}/${assetName}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonVersion(json, name) {
  const versionValue = String(json.version ?? "").trim();
  if (!versionValue) throw new Error(`${name} 缺少 version 字段。`);
  return versionValue;
}

function readCargoVersion(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("未能从 src-tauri/Cargo.toml 读取版本号。");
  return match[1];
}

function resolveTauriVersion(configPath, rawVersion) {
  if (isSemver(rawVersion)) return rawVersion;
  const versionPath = path.resolve(path.dirname(configPath), rawVersion);
  const json = readJson(versionPath);
  return readJsonVersion(json, "tauri.conf.json version 指向的 JSON");
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
