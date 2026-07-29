param(
  [string]$TaskName = 'Kr8 Studio',
  [switch]$RemovePublisherData
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this uninstaller from an elevated PowerShell window.'
}

$stopPath = Join-Path $PSScriptRoot 'stop-kr8-server.ps1'
if (Test-Path -LiteralPath $stopPath) { & $stopPath }
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

if ($RemovePublisherData) {
  $dataPath = Join-Path $env:ProgramData 'Kr8 Studio\publish'
  $programDataRoot = [System.IO.Path]::GetFullPath($env:ProgramData)
  $resolved = [System.IO.Path]::GetFullPath($dataPath)
  if (-not $resolved.StartsWith($programDataRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw 'Refusing to remove Publisher data outside ProgramData.'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "Kr8 Studio boot task removed: $TaskName"
Write-Output "Publisher data removed: $($RemovePublisherData.IsPresent)"
