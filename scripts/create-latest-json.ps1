Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return $text | ConvertFrom-Json
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,
        [Parameter(Mandatory = $true)]
        [string] $Content
    )

    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-CargoVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    if ($text -notmatch '(?m)^version\s*=\s*"([^"]+)"') {
        throw "未能从 src-tauri/Cargo.toml 读取版本号。"
    }
    return $Matches[1]
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJsonPath = Join-Path $repoRoot "package.json"
$cargoTomlPath = Join-Path $repoRoot "src-tauri\Cargo.toml"
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$nsisBundleDir = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
$releaseDir = Join-Path $repoRoot "src-tauri\target\release\github-release"

$packageJson = Read-JsonFile -Path $packageJsonPath
$tauriConfig = Read-JsonFile -Path $tauriConfigPath
$version = [string] $packageJson.version
$cargoVersion = Get-CargoVersion -Path $cargoTomlPath
$tauriVersion = [string] $tauriConfig.version

# 三处版本必须一致，否则 latest.json 会指向错误的 GitHub Release 标签。
if ($version -ne $cargoVersion -or $version -ne $tauriVersion) {
    throw "版本号不一致：package.json=$version，Cargo.toml=$cargoVersion，tauri.conf.json=$tauriVersion。"
}

if (-not (Test-Path -LiteralPath $nsisBundleDir)) {
    throw "未找到 NSIS 输出目录：$nsisBundleDir。请先运行 npm run tauri:build:nsis:updater。"
}

$installer = Get-ChildItem -LiteralPath $nsisBundleDir -Filter "*.exe" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if (-not $installer) {
    throw "未找到 NSIS 安装包。请先运行 npm run tauri:build:nsis:updater。"
}

$signaturePath = "$($installer.FullName).sig"
if (-not (Test-Path -LiteralPath $signaturePath)) {
    throw "未找到安装包签名文件：$signaturePath。请设置 TAURI_SIGNING_PRIVATE_KEY 后重新构建。"
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$asciiInstallerName = "codex-widget_${version}_windows_x64-setup.exe"
$asciiSignatureName = "$asciiInstallerName.sig"
$targetInstallerPath = Join-Path $releaseDir $asciiInstallerName
$targetSignaturePath = Join-Path $releaseDir $asciiSignatureName
$manifestPath = Join-Path $releaseDir "latest.json"

Copy-Item -LiteralPath $installer.FullName -Destination $targetInstallerPath -Force
Copy-Item -LiteralPath $signaturePath -Destination $targetSignaturePath -Force

$signature = ([System.IO.File]::ReadAllText($targetSignaturePath, [System.Text.Encoding]::UTF8)).Trim()
$pubDate = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", [System.Globalization.CultureInfo]::InvariantCulture)
$downloadUrl = "https://github.com/359956085/codex-widget/releases/download/v$version/$asciiInstallerName"

$manifest = [ordered] @{
    version = $version
    notes = "Codex 额度小组件 $version"
    pub_date = $pubDate
    platforms = [ordered] @{
        "windows-x86_64" = [ordered] @{
            signature = $signature
            url = $downloadUrl
        }
    }
}

$manifestJson = ($manifest | ConvertTo-Json -Depth 5)
Write-Utf8NoBom -Path $manifestPath -Content ($manifestJson + [Environment]::NewLine)

Write-Host "GitHub Release 产物已生成：$releaseDir"
Write-Host "请上传以下文件到 v$version Release："
Write-Host " - $asciiInstallerName"
Write-Host " - $asciiSignatureName"
Write-Host " - latest.json"
