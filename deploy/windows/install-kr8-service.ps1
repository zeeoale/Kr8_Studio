param(
  [string]$TaskName = 'Kr8 Studio',
  [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
  [string]$ProjectPath = '',
  [string]$FfmpegPath = '',
  [string]$BrowserPath = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
  [string]$PublishDataDirectory = '',
  [string]$ProjectsRoot = '',
  [string]$RuntimeDirectory = '',
  [string]$EnvironmentFile = '',
  [string]$ListenHost = '127.0.0.1',
  [int]$Port = 5174,
  [int]$StartupDelaySeconds = 15,
  [switch]$AcknowledgeSystemServiceRisk,
  [switch]$AllowExternalBinding,
  [switch]$MigratePublisherCredentials,
  [switch]$ReplaceRunningInstance,
  [switch]$StartAfterInstall
)

$ErrorActionPreference = 'Stop'
if (-not $AcknowledgeSystemServiceRisk) {
  throw 'This is an advanced SYSTEM deployment. Re-run only after reviewing docs/windows-service.md and pass -AcknowledgeSystemServiceRisk.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer from an elevated PowerShell window.'
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$programFilesRoot = [System.IO.Path]::GetFullPath($env:ProgramFiles)
if (-not $repoRoot.StartsWith($programFilesRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'SYSTEM service code must be installed below Program Files. A user-writable source checkout is not accepted.'
}
$externalBinding = $ListenHost -notin @('127.0.0.1', 'localhost', '::1', '[::1]')
if ($externalBinding -and -not $AllowExternalBinding) {
  throw 'External binding requires the explicit -AllowExternalBinding switch.'
}
if ($externalBinding) {
  Write-Warning 'External Kr8 binding is enabled. Restrict it to a trusted VPN with firewall rules and configured trusted origins.'
}
$launcherPath = Join-Path $PSScriptRoot 'start-kr8-server.ps1'
$stopPath = Join-Path $PSScriptRoot 'stop-kr8-server.ps1'
if (-not $PublishDataDirectory) { $PublishDataDirectory = Join-Path $env:ProgramData 'Kr8 Studio\publish' }
if (-not $ProjectsRoot) { $ProjectsRoot = Join-Path $env:ProgramData 'Kr8 Studio\projects' }
if (-not $RuntimeDirectory) { $RuntimeDirectory = Join-Path $env:ProgramData 'Kr8 Studio\runtime' }
$ProjectsRoot = [System.IO.Path]::GetFullPath($ProjectsRoot)
$RuntimeDirectory = [System.IO.Path]::GetFullPath($RuntimeDirectory)
New-Item -ItemType Directory -Path $ProjectsRoot,$RuntimeDirectory -Force | Out-Null
if (-not $ProjectPath) {
  $blankDirectory = Join-Path $ProjectsRoot 'blank.kr8'
  New-Item -ItemType Directory -Path $blankDirectory -Force | Out-Null
  $ProjectPath = Join-Path $blankDirectory 'project.json'
  if (-not (Test-Path -LiteralPath $ProjectPath -PathType Leaf)) {
    Copy-Item -LiteralPath (Join-Path $repoRoot 'examples\blank.kr8\project.json') -Destination $ProjectPath
  }
}
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
foreach ($dataDirectory in @($PublishDataDirectory, $ProjectsRoot, $RuntimeDirectory)) {
  & icacls.exe $dataDirectory '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*$currentUserSid`:(OI)(CI)M" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not secure service data directory: $dataDirectory" }
}
& icacls.exe $repoRoot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)RX' '*S-1-5-32-544:(OI)(CI)F' "*$currentUserSid`:(OI)(CI)RX" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not secure the Kr8 executable directory.' }

$serviceEnvPath = Join-Path $env:ProgramData 'Kr8 Studio\config\.env.local'
if ($EnvironmentFile) {
  $serviceEnvDirectory = Split-Path -Parent $serviceEnvPath
  New-Item -ItemType Directory -Path $serviceEnvDirectory -Force | Out-Null
  Copy-Item -LiteralPath ([System.IO.Path]::GetFullPath($EnvironmentFile)) -Destination $serviceEnvPath -Force
  & icacls.exe $serviceEnvDirectory '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*$currentUserSid`:(OI)(CI)R" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not secure the Kr8 service environment directory.' }
}

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
  '-ProjectsRoot', (Quote-TaskArgument $ProjectsRoot),
  '-RuntimeDirectory', (Quote-TaskArgument $RuntimeDirectory),
  '-EnvPath', (Quote-TaskArgument $serviceEnvPath),
  '-ListenHost', (Quote-TaskArgument $ListenHost),
  '-Port', [string]$Port,
  '-FfmpegPath', (Quote-TaskArgument $FfmpegPath),
  '-BrowserPath', (Quote-TaskArgument $BrowserPath)
) -join ' '
if ($AllowExternalBinding) { $powerShellArguments += ' -AllowExternalBinding' }

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
