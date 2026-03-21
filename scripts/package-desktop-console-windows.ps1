param()

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$SourceDir = Join-Path $RootDir "apps\desktop_console\build\windows\x64\runner\Release"
$DistRoot = Join-Path $RootDir "dist"
$AppLabel = if ($env:APP_LABEL) { $env:APP_LABEL } else { "ClawMark" }
$StageDir = Join-Path $DistRoot "$AppLabel-win-x64"
$SkipJsBuild = $env:SKIP_JS_BUILD -eq "1"
$SkipFlutterBuild = $env:SKIP_FLUTTER_BUILD -eq "1"
$ShouldSign = -not [string]::IsNullOrWhiteSpace($env:WINDOWS_SIGNTOOL_CERT_PATH)
$BundleDesktopCore = $env:BUNDLE_DESKTOP_CORE -eq "1"

function Get-DesktopConsoleVersion {
  $pubspecPath = Join-Path $RootDir "apps\desktop_console\pubspec.yaml"
  if (-not (Test-Path $pubspecPath)) {
    return "0.0.0"
  }
  $match = Select-String -Path $pubspecPath -Pattern '^version:\s*([^\s]+)' | Select-Object -First 1
  if ($null -eq $match) {
    return "0.0.0"
  }
  $rawVersion = $match.Matches[0].Groups[1].Value.Trim()
  if ($rawVersion.Contains("+")) {
    return $rawVersion.Split("+")[0]
  }
  return $rawVersion
}

Write-Host "Packaging Desktop Console for Windows"
New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null

if (-not $SkipJsBuild) {
  Write-Host "Building runtime TypeScript payload"
  Push-Location $RootDir
  try {
    pnpm build
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Skipping runtime TypeScript build (SKIP_JS_BUILD=1)"
}

if (-not $SkipFlutterBuild) {
  Write-Host "Building Flutter desktop release bundle"
  Push-Location $RootDir
  try {
    node --import tsx scripts/run-desktop-console.ts build windows
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Skipping Flutter build (SKIP_FLUTTER_BUILD=1)"
}

if ($BundleDesktopCore) {
  Write-Host "Staging bundled DesktopRuntime payload"
  Push-Location $RootDir
  try {
    node --import tsx scripts/run-desktop-console.ts stage windows
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Packaging bootstrap-only desktop app (set BUNDLE_DESKTOP_CORE=1 to embed a fallback core payload)"
}

if (-not (Test-Path $SourceDir)) {
  throw "Desktop Console release directory not found at $SourceDir"
}

Write-Host "Copying release directory to dist"
if (Test-Path $StageDir) {
  Remove-Item -Recurse -Force $StageDir
}
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $SourceDir '*') $StageDir
if (-not $BundleDesktopCore) {
  Remove-Item -Recurse -Force (Join-Path $StageDir 'data\DesktopRuntime') -ErrorAction SilentlyContinue
}

$ExePath = Join-Path $StageDir "ClawMark.exe"
if ($ShouldSign -and (Test-Path $ExePath)) {
  $signtool = if ($env:WINDOWS_SIGNTOOL_PATH) { $env:WINDOWS_SIGNTOOL_PATH } else { "signtool.exe" }
  $timestampUrl = if ($env:WINDOWS_SIGNTOOL_TIMESTAMP_URL) {
    $env:WINDOWS_SIGNTOOL_TIMESTAMP_URL
  } else {
    "http://timestamp.digicert.com"
  }
  $signtoolArgs = @(
    "sign",
    "/f", $env:WINDOWS_SIGNTOOL_CERT_PATH,
    "/tr", $timestampUrl,
    "/td", "sha256",
    "/fd", "sha256"
  )
  if (-not [string]::IsNullOrWhiteSpace($env:WINDOWS_SIGNTOOL_PASSWORD)) {
    $signtoolArgs += @("/p", $env:WINDOWS_SIGNTOOL_PASSWORD)
  }
  $signtoolArgs += $ExePath
  Write-Host "Signing ClawMark.exe"
  & $signtool @signtoolArgs
} else {
  Write-Host "Skipping Windows signing (set WINDOWS_SIGNTOOL_CERT_PATH to enable)"
}

$Version = Get-DesktopConsoleVersion
$ZipPath = Join-Path $DistRoot "$AppLabel-$Version-windows-x64.zip"
if (Test-Path $ZipPath) {
  Remove-Item -Force $ZipPath
}

Write-Host "Creating zip archive: $ZipPath"
Compress-Archive -Path (Join-Path $StageDir '*') -DestinationPath $ZipPath -Force

Write-Host ""
Write-Host "ClawMark Windows packaging complete:"
Write-Host "  Directory: $StageDir"
Write-Host "  Zip: $ZipPath"
