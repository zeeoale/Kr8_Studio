param(
  [int]$WaitSeconds = 10,
  [string]$RuntimeDirectory = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $RuntimeDirectory) { $RuntimeDirectory = Join-Path $env:ProgramData 'Kr8 Studio\runtime' }
$pidPath = Join-Path ([System.IO.Path]::GetFullPath($RuntimeDirectory)) 'kr8-editor.pid'

if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) {
  Write-Output 'Kr8 Studio PID file is absent; no process was stopped.'
  exit 0
}

$recordedPid = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$recordedPid)) {
  throw 'Kr8 Studio PID file is invalid.'
}

$process = Get-CimInstance Win32_Process -Filter "ProcessId=$recordedPid" -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidPath -Force
  Write-Output 'The recorded Kr8 Studio process is no longer running.'
  exit 0
}

$commandLine = [string]$process.CommandLine
if ($process.Name -ne 'node.exe' -or $commandLine -notmatch 'src[/\\]editor[/\\]server\.js' -or $commandLine -notmatch '--port\s+\d+') {
  throw "PID $recordedPid does not match the expected Kr8 Studio server command. Nothing was stopped."
}

Stop-Process -Id $recordedPid
$deadline = (Get-Date).AddSeconds([Math]::Max(1, $WaitSeconds))
while ((Get-Process -Id $recordedPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 200
}
if (Get-Process -Id $recordedPid -ErrorAction SilentlyContinue) {
  throw "Kr8 Studio PID $recordedPid did not stop within $WaitSeconds seconds."
}
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Write-Output "Kr8 Studio PID $recordedPid stopped."
