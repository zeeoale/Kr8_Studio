param(
  [string]$TaskName = 'Kr8 Studio',
  [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
  [string]$ProjectPath = '',
  [string]$FfmpegPath = '',
  [string]$BrowserPath = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
  [string]$PublishDataDirectory = '',
  [int]$StartupDelaySeconds = 15,
  [switch]$MigratePublisherCredentials,
  [switch]$ReplaceRunningInstance,
  [switch]$StartAfterInstall
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer from an elevated PowerShell window.'
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$launcherPath = Join-Path $PSScriptRoot 'start-kr8-server.ps1'
$stopPath = Join-Path $PSScriptRoot 'stop-kr8-server.ps1'
if (-not $ProjectPath) { $ProjectPath = Join-Path $repoRoot 'examples\blank.kr8\project.json' }
if (-not $PublishDataDirectory) { $PublishDataDirectory = Join-Path $env:ProgramData 'Kr8 Studio\publish' }
if (-not $FfmpegPath) {
  $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($ffmpegCommand) { $FfmpegPath = $ffmpegCommand.Source }
}

foreach ($requiredFile in @($NodePath, $ProjectPath, $launcherPath, $stopPath)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Required file was not found: $requiredFile"
  }
}
if (-not $FfmpegPath -or -not (Test-Path -LiteralPath $FfmpegPath -PathType Leaf)) {
  throw 'FFmpeg was not found. Pass its absolute path with -FfmpegPath.'
}
if (-not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) {
  throw 'Chrome was not found. Pass a supported browser with -BrowserPath.'
}

New-Item -ItemType Directory -Path $PublishDataDirectory -Force | Out-Null
$currentUserSid = $identity.User.Value
& icacls.exe $PublishDataDirectory '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*$currentUserSid`:(OI)(CI)M" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not secure the Kr8 Publisher service data directory.' }

if ($MigratePublisherCredentials) {
  $sourceDirectory = Join-Path $env:APPDATA 'Kr8 Studio\publish'
  if (Test-Path -LiteralPath $sourceDirectory -PathType Container) {
    foreach ($name in @('tiktok-token.json', 'youtube-token.json', 'instagram-token.json', 'settings.json')) {
      $source = Join-Path $sourceDirectory $name
      if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $PublishDataDirectory $name) -Force
      }
    }
  }
}

function Quote-TaskArgument([string]$value) {
  return '"' + $value.Replace('"', '""') + '"'
}

$powerShellArguments = @(
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy', 'Bypass',
  '-File', (Quote-TaskArgument $launcherPath),
  '-ServiceMode',
  '-NodePath', (Quote-TaskArgument $NodePath),
  '-ProjectPath', (Quote-TaskArgument $ProjectPath),
  '-PublishDataDirectory', (Quote-TaskArgument $PublishDataDirectory),
  '-FfmpegPath', (Quote-TaskArgument $FfmpegPath),
  '-BrowserPath', (Quote-TaskArgument $BrowserPath)
) -join ' '

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $powerShellArguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT$([Math]::Max(0, $StartupDelaySeconds))S"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$servicePrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $servicePrincipal `
  -Description 'Starts Kr8 Studio at Windows boot without requiring an interactive user logon.'
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

if ($ReplaceRunningInstance) {
  & $stopPath
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
if ($StartAfterInstall) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Output "Kr8 Studio boot task installed: $TaskName"
Write-Output "Service account: SYSTEM"
Write-Output "Publisher credentials migrated: $($MigratePublisherCredentials.IsPresent)"
Write-Output "Publisher data: $PublishDataDirectory"
Write-Output "Default project: $ProjectPath"
