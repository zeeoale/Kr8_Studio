param(
  [string]$TaskName = 'Kr8 Studio',
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$pidPath = Join-Path $repoRoot 'kr8-editor.pid'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$action = if ($task) { $task.Actions | Select-Object -First 1 } else { $null }
$trigger = if ($task) { $task.Triggers | Select-Object -First 1 } else { $null }
$recordedPid = if (Test-Path -LiteralPath $pidPath) { (Get-Content -LiteralPath $pidPath -Raw).Trim() } else { '' }
$process = if ($recordedPid -match '^\d+$') { Get-CimInstance Win32_Process -Filter "ProcessId=$recordedPid" -ErrorAction SilentlyContinue } else { $null }
$processOwner = if ($process) { (Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction SilentlyContinue).User } else { '' }
$listener = Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$health = $null
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/api/health' -TimeoutSec 3 } catch {}

$status = [pscustomobject]@{
  Installed = [bool]$task
  TaskState = if ($task) { [string]$task.State } else { 'Not installed' }
  TaskUser = if ($task) { [string]$task.Principal.UserId } else { '' }
  TaskLogonType = if ($task) { [string]$task.Principal.LogonType } else { '' }
  Trigger = if ($trigger) { [string]$trigger.CimClass.CimClassName } else { '' }
  UsesServiceMode = [bool]($action -and [string]$action.Arguments -match '(?:^|\s)-ServiceMode(?:\s|$)')
  ActionArguments = if ($action) { [string]$action.Arguments } else { '' }
  LastRunTime = $taskInfo.LastRunTime
  LastTaskResult = $taskInfo.LastTaskResult
  RecordedPid = $recordedPid
  ProcessMatchesKr8 = [bool]($process -and $process.Name -eq 'node.exe' -and [string]$process.CommandLine -match 'src[/\\]editor[/\\]server\.js')
  ProcessOwner = $processOwner
  ListenerPid = $listener.OwningProcess
  Health = if ($health) { $health.status } else { 'unavailable' }
}

if ($OutputPath) {
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  $resolvedRoot = [System.IO.Path]::GetFullPath($repoRoot)
  if (-not $resolvedOutput.StartsWith($resolvedRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw 'Status output must stay inside the Kr8 repository.'
  }
  $status | ConvertTo-Json | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
} else {
  $status | Format-List
}
