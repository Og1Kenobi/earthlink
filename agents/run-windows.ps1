# Earthlink edge agent — Windows (PowerShell)
# Usage:
#   $env:EARTHLINK_HUB = "http://10.11.12.62:8080"
#   $env:EARTHLINK_HOST_ID = "desktop-win"
#   $env:EARTHLINK_AGENT_TOKEN = "change-me"
#   .\agents\run-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not $env:EARTHLINK_HUB) {
  Write-Error "Set EARTHLINK_HUB=http://HUB_IP:8080"
  exit 1
}

if (-not $env:EARTHLINK_HOST_ID) {
  $env:EARTHLINK_HOST_ID = $env:COMPUTERNAME
}
if (-not $env:EARTHLINK_POLL_MS) {
  $env:EARTHLINK_POLL_MS = "2000"
}

Write-Host "[run-windows] hub=$($env:EARTHLINK_HUB) hostId=$($env:EARTHLINK_HOST_ID)"
node "$Root\agents\earthlink-agent.mjs"
