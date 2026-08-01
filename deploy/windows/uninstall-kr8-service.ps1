param(
  [string]$TaskName = 'Kr8 Studio',
  [switch]$RemovePublisherData,
  [switch]$RemoveAllServiceData
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

if ($RemoveAllServiceData) {
  $serviceDataPath = Join-Path $env:ProgramData 'Kr8 Studio'
  $programDataRoot = [System.IO.Path]::GetFullPath($env:ProgramData)
  $resolvedServiceData = [System.IO.Path]::GetFullPath($serviceDataPath)
  if (-not $resolvedServiceData.StartsWith($programDataRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw 'Refusing to remove Kr8 service data outside ProgramData.'
  }
  Remove-Item -LiteralPath $resolvedServiceData -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "Kr8 Studio boot task removed: $TaskName"
Write-Output "Publisher data removed: $($RemovePublisherData.IsPresent)"
Write-Output "All service data removed: $($RemoveAllServiceData.IsPresent)"
