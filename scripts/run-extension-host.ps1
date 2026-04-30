param(
  [string]$CodeCommand = ""
)

$ErrorActionPreference = "Stop"

$extensionRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workspaceRoot = Join-Path $extensionRoot ".vscode\dev-host\workspace"
$userDataDir = Join-Path $extensionRoot ".vscode\dev-host\user-data"
$extensionsDir = Join-Path $extensionRoot ".vscode\dev-host\extensions"

if ([string]::IsNullOrWhiteSpace($CodeCommand)) {
  $cmd = Get-Command code.cmd -ErrorAction SilentlyContinue
  if ($cmd) {
    $CodeCommand = $cmd.Source
  } elseif (Test-Path "D:\Microsoft VS Code\bin\code.cmd") {
    $CodeCommand = "D:\Microsoft VS Code\bin\code.cmd"
  } else {
    $command = Get-Command code -ErrorAction Stop
    $CodeCommand = $command.Source
  }
}

New-Item -ItemType Directory -Force -Path $workspaceRoot, $userDataDir, $extensionsDir | Out-Null

Push-Location $extensionRoot
try {
  npm run compile
} finally {
  Pop-Location
}

$args = @(
  "--new-window",
  "--extensionDevelopmentPath=$extensionRoot",
  "--user-data-dir=$userDataDir",
  "--extensions-dir=$extensionsDir",
  $workspaceRoot
)

Write-Host "Launching dogcode extension host:"
Write-Host "  Command: $CodeCommand"
Write-Host "  Extension: $extensionRoot"
Write-Host "  User data: $userDataDir"
Write-Host "  Workspace: $workspaceRoot"

& $CodeCommand @args
