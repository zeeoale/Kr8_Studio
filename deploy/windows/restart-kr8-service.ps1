param(
  [string]$TaskName = 'Kr8 Studio'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this restart command from an elevated PowerShell window.'
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { throw "Kr8 Studio boot task is not installed: $TaskName" }

$stopPath = Join-Path $PSScriptRoot 'stop-kr8-server.ps1'
if (Test-Path -LiteralPath $stopPath) { & $stopPath }
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-ScheduledTask -TaskName $TaskName
Write-Output "Kr8 Studio service restarted through Task Scheduler: $TaskName"
