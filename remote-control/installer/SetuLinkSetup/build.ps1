param(
  [string]$GoExe = "go",
  [string]$InnoSetupCompiler = "",
  [string]$DefaultBackendURL = "https://setuapi.shivomsangha.com",
  [string]$Version = "0.1.0",
  [switch]$Clean,
  [switch]$SkipAgentBuild,
  [switch]$SkipBootstrapBuild,
  [switch]$SkipUpdaterBuild
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Resolve-InnoCompiler {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath)) {
      throw "Inno Setup compiler was not found at '$ExplicitPath'."
    }
    return (Resolve-Path $ExplicitPath).Path
  }

  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }

  $fromPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  throw "Unable to find ISCC.exe. Install Inno Setup 6 or pass -InnoSetupCompiler."
}

function Require-Command {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Required command '$Name' was not found on PATH."
  }
  return $cmd.Source
}

function Get-FileHashText {
  param([string]$Path)
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Get-FileSizeBytes {
  param([string]$Path)
  return (Get-Item -LiteralPath $Path).Length
}

function Write-PackagedAssetReport {
  param(
    [string]$Label,
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required packaged asset missing: $Label at $Path"
  }

  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  Write-Host "  $Label"
  Write-Host "    path:   $resolvedPath"
  Write-Host "    sha256: $(Get-FileHashText $resolvedPath)"
  Write-Host "    size:   $(Get-FileSizeBytes $resolvedPath) bytes"
}

function Copy-And-Verify {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path $Source)) {
    throw "Expected build output missing: $Source"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -Force -Path $Source -Destination $Destination

  $sourceHash = Get-FileHashText $Source
  $destHash = Get-FileHashText $Destination
  if ($sourceHash -ne $destHash) {
    throw "Stale asset prevention failed: '$Destination' does not match '$Source'."
  }

  Write-PackagedAssetReport -Label "copied asset" -Path $Destination
}

function Invoke-GoBuild {
  param(
    [string]$SourceDir,
    [string]$OutputPath,
    [string]$Description
  )

  if (-not (Test-Path (Join-Path $SourceDir "go.mod"))) {
    throw "$Description source is missing go.mod: $SourceDir"
  }

  Push-Location $SourceDir
  try {
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    & $GoExe test ./...
    if ($LASTEXITCODE -ne 0) {
      throw "$Description tests failed with exit code $LASTEXITCODE."
    }

    & $GoExe build -trimpath -o $OutputPath .
    if ($LASTEXITCODE -ne 0) {
      throw "$Description build failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $OutputPath)) {
    throw "$Description build did not produce '$OutputPath'."
  }
}

function Find-RepoRoot {
  param([string]$StartDir)

  $current = (Resolve-Path $StartDir).Path
  while ($current) {
    if (Test-Path (Join-Path $current "agent\go.mod")) {
      return $current
    }

    $parent = Split-Path -Parent $current
    if (-not $parent -or $parent -eq $current) {
      break
    }
    $current = $parent
  }

  throw "Unable to find repository root containing agent\go.mod. Keep SetuLinkSetup inside the repo or next to the agent source."
}

function Stage-ExistingAsset {
  param(
    [string]$AssetPath,
    [string]$BuildPath,
    [string]$Description
  )

  if (-not (Test-Path $AssetPath)) {
    throw "$Description asset is missing: $AssetPath. Rebuild from the full repo or place the prebuilt asset there before using the skip flag."
  }

  Write-Host "  Using existing asset: $AssetPath"
  Copy-And-Verify -Source $AssetPath -Destination $BuildPath
}

function Assert-FfmpegAssets {
  param([string]$FfmpegDir)

  $ffmpegExe = Join-Path $FfmpegDir "ffmpeg.exe"
  if (-not (Test-Path $ffmpegExe)) {
    throw "Bundled ffmpeg is required but missing: $ffmpegExe. Place a Windows static ffmpeg build under assets\ffmpeg before building the installer."
  }

  $files = Get-ChildItem -Path $FfmpegDir -File -Recurse
  if (-not $files -or $files.Count -eq 0) {
    throw "Bundled ffmpeg directory is empty: $FfmpegDir"
  }

  Write-Host "  ffmpeg asset dir:    $((Resolve-Path -LiteralPath $FfmpegDir).Path)"
  Write-PackagedAssetReport -Label "assets\ffmpeg\ffmpeg.exe" -Path $ffmpegExe
  Write-Host "  ffmpeg files:        $($files.Count)"
}

if ([string]::IsNullOrWhiteSpace($DefaultBackendURL)) {
  throw "DefaultBackendURL cannot be empty."
}

$normalizedDefaultBackendURL = $DefaultBackendURL.Trim().TrimEnd("/").ToLowerInvariant()
if ($normalizedDefaultBackendURL -eq "https://setulink.shivomsangha.com" -or $normalizedDefaultBackendURL -eq "http://setulink.shivomsangha.com") {
  throw "DefaultBackendURL must point to the API host, e.g. https://setuapi.shivomsangha.com"
}

$setupRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir = Join-Path $setupRoot "src"
$buildDir = Join-Path $setupRoot "build"
$distDir = Join-Path $setupRoot "dist"
$assetsDir = Join-Path $setupRoot "assets"
$agentBinary = Join-Path $buildDir "setulink-agent.exe"
$bootstrapBinary = Join-Path $buildDir "SetuLinkInstallerBootstrap.exe"
$updaterBinary = Join-Path $buildDir "setulink-updater.exe"
$assetAgentBinary = Join-Path $assetsDir "setulink-agent.exe"
$assetBootstrapBinary = Join-Path $assetsDir "SetuLinkInstallerBootstrap.exe"
$assetUpdaterBinary = Join-Path $assetsDir "setulink-updater.exe"
$assetFfmpegDir = Join-Path $assetsDir "ffmpeg"
$assetFfmpegBinary = Join-Path $assetFfmpegDir "ffmpeg.exe"
$issPath = Join-Path $setupRoot "SetuLinkSetup.iss"
$finalInstaller = Join-Path $distDir "SetuLinkSetup.exe"

Write-Host "SetuLink installer build"
Write-Host "  Setup root:          $setupRoot"
Write-Host "  Default backend URL: $DefaultBackendURL"
Write-Host "  Version:             $Version"
Write-Host "  Skip agent build:    $SkipAgentBuild"
Write-Host "  Skip bootstrap build:$SkipBootstrapBuild"
Write-Host "  Skip updater build:  $SkipUpdaterBuild"
Write-Host "  ffmpeg asset dir:    $assetFfmpegDir"
if ($SkipAgentBuild -and $SkipBootstrapBuild -and $SkipUpdaterBuild) {
  Write-Host "  Build mode:          packaging-only; source rebuilds are skipped and all packaged assets must already exist"
} elseif ($SkipAgentBuild -or $SkipBootstrapBuild -or $SkipUpdaterBuild) {
  Write-Host "  Build mode:          partial rebuild; skipped packaged assets must already exist"
} else {
  Write-Host "  Build mode:          full source rebuild"
}

$iscc = Resolve-InnoCompiler -ExplicitPath $InnoSetupCompiler
if (-not $SkipAgentBuild -or -not $SkipBootstrapBuild -or -not $SkipUpdaterBuild) {
  Require-Command $GoExe | Out-Null
  Write-Host "  Go:                  $(Get-Command $GoExe | Select-Object -ExpandProperty Source)"
} else {
  Write-Host "  Go:                  not required because all Go builds are skipped"
}
Write-Host "  Inno Setup:          $iscc"
Assert-FfmpegAssets -FfmpegDir $assetFfmpegDir

if ($Clean) {
  Write-Step "Cleaning previous build outputs"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $buildDir
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $distDir
  if (-not $SkipAgentBuild) {
    Remove-Item -Force -ErrorAction SilentlyContinue $assetAgentBinary
  }
  if (-not $SkipBootstrapBuild) {
    Remove-Item -Force -ErrorAction SilentlyContinue $assetBootstrapBinary
  }
  if (-not $SkipUpdaterBuild) {
    Remove-Item -Force -ErrorAction SilentlyContinue $assetUpdaterBinary
  }
}

New-Item -ItemType Directory -Force -Path $buildDir, $distDir, $assetsDir | Out-Null

if ($SkipAgentBuild) {
  Write-Step "Staging existing agent asset"
  Stage-ExistingAsset -AssetPath $assetAgentBinary -BuildPath $agentBinary -Description "setulink-agent.exe"
} else {
  $repoRoot = Find-RepoRoot -StartDir $setupRoot
  $agentDir = Join-Path $repoRoot "agent"
  Write-Step "Building Windows agent"
  Invoke-GoBuild -SourceDir $agentDir -OutputPath $agentBinary -Description "setulink-agent.exe"

  Write-Step "Copying fresh agent asset"
  Copy-And-Verify -Source $agentBinary -Destination $assetAgentBinary
}

if ($SkipBootstrapBuild) {
  Write-Step "Staging existing bootstrap asset"
  Stage-ExistingAsset -AssetPath $assetBootstrapBinary -BuildPath $bootstrapBinary -Description "SetuLinkInstallerBootstrap.exe"
} else {
  Write-Step "Building installer bootstrap"
  Invoke-GoBuild -SourceDir $srcDir -OutputPath $bootstrapBinary -Description "SetuLinkInstallerBootstrap.exe"

  Write-Step "Copying fresh bootstrap asset"
  Copy-And-Verify -Source $bootstrapBinary -Destination $assetBootstrapBinary
}

if ($SkipUpdaterBuild) {
  Write-Step "Staging existing updater asset"
  Stage-ExistingAsset -AssetPath $assetUpdaterBinary -BuildPath $updaterBinary -Description "setulink-updater.exe"
} else {
  $repoRoot = Find-RepoRoot -StartDir $setupRoot
  $updaterDir = Join-Path $setupRoot "updater"
  Write-Step "Building updater helper"
  Invoke-GoBuild -SourceDir $updaterDir -OutputPath $updaterBinary -Description "setulink-updater.exe"

  Write-Step "Copying fresh updater asset"
  Copy-And-Verify -Source $updaterBinary -Destination $assetUpdaterBinary
}

Write-Step "Verifying packaged installer assets"
Write-PackagedAssetReport -Label "assets\setulink-agent.exe" -Path $assetAgentBinary
Write-PackagedAssetReport -Label "assets\SetuLinkInstallerBootstrap.exe" -Path $assetBootstrapBinary
Write-PackagedAssetReport -Label "assets\setulink-updater.exe" -Path $assetUpdaterBinary
Write-PackagedAssetReport -Label "assets\ffmpeg\ffmpeg.exe" -Path $assetFfmpegBinary

Write-Step "Compiling final installer"
Push-Location $setupRoot
try {
  & $iscc `
    "/DDefaultBackendUrl=`"$DefaultBackendURL`"" `
    "/DMyAppVersion=`"$Version`"" `
    $issPath
  if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup compiler failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $finalInstaller)) {
  throw "Final installer was not produced: $finalInstaller"
}

Write-Step "Build complete"
Write-Host "  Final installer:     $finalInstaller"
Write-Host "  Installer sha256:    $(Get-FileHashText $finalInstaller)"
Write-Host "  Installer size:      $(Get-FileSizeBytes $finalInstaller) bytes"
Write-Host "  Agent sha256:        $(Get-FileHashText $agentBinary)"
Write-Host "  Bootstrap sha256:    $(Get-FileHashText $bootstrapBinary)"
Write-Host "  Updater sha256:      $(Get-FileHashText $updaterBinary)"
Write-Host "  ffmpeg sha256:       $(Get-FileHashText $assetFfmpegBinary)"
Write-Host ""
Write-Host "Ship only dist\SetuLinkSetup.exe to end users."
