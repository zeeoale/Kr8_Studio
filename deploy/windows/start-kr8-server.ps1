param(
  [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
  [string]$ProjectPath = '',
  [string]$PublishDataDirectory = '',
  [string]$ProjectsRoot = '',
  [string]$RuntimeDirectory = '',
  [string]$EnvPath = '',
  [string]$FfmpegPath = '',
  [string]$BrowserPath = '',
  [string]$ListenHost = '',
  [int]$Port = 5174,
  [switch]$AllowExternalBinding,
  [switch]$ServiceMode
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $ListenHost) { $ListenHost = if ($env:KR8_HOST) { $env:KR8_HOST } else { '127.0.0.1' } }
$externalBinding = $ListenHost -notin @('127.0.0.1', 'localhost', '::1', '[::1]')
if ($externalBinding -and -not $AllowExternalBinding) {
  throw 'External binding requires the explicit -AllowExternalBinding switch.'
}
if ($externalBinding) {
  Write-Warning 'Kr8 is binding outside loopback. Use only a trusted VPN, restrictive firewall rules, authentication, and KR8_TRUSTED_ORIGINS.'
}
if (-not $ProjectsRoot) { $ProjectsRoot = Join-Path $repoRoot 'examples' }
if (-not $RuntimeDirectory) {
  $RuntimeDirectory = if ($ServiceMode) { Join-Path $env:ProgramData 'Kr8 Studio\runtime' } else { Join-Path $repoRoot 'runtime' }
}
$ProjectsRoot = [System.IO.Path]::GetFullPath($ProjectsRoot)
$RuntimeDirectory = [System.IO.Path]::GetFullPath($RuntimeDirectory)
New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null
$pidPath = Join-Path $RuntimeDirectory 'kr8-editor.pid'
if (-not $ProjectPath) {
  $ProjectPath = Join-Path $ProjectsRoot 'blank.kr8\project.json'
}
$ProjectPath = [System.IO.Path]::GetFullPath($ProjectPath)

if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw 'Node.js was not found at the configured path.'
}
if (-not (Test-Path -LiteralPath $ProjectPath -PathType Leaf)) {
  throw 'The configured Kr8 project was not found.'
}
if ($FfmpegPath -and -not (Test-Path -LiteralPath $FfmpegPath -PathType Leaf)) {
  throw 'FFmpeg was not found at the configured path.'
}
if ($BrowserPath -and -not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) {
  throw 'The headless browser was not found at the configured path.'
}

if ($ServiceMode) {
  if (-not $PublishDataDirectory) {
    $PublishDataDirectory = Join-Path $env:ProgramData 'Kr8 Studio\publish'
  }
  New-Item -ItemType Directory -Path $PublishDataDirectory -Force | Out-Null
  $env:KR8_PUBLISH_DATA_DIR = [System.IO.Path]::GetFullPath($PublishDataDirectory)
}
$env:KR8_HOST = $ListenHost
$env:KR8_PROJECTS_ROOT = $ProjectsRoot
if ($FfmpegPath) { $env:KR8_FFMPEG_PATH = [System.IO.Path]::GetFullPath($FfmpegPath) }
if ($BrowserPath) { $env:KR8_BROWSER_PATH = [System.IO.Path]::GetFullPath($BrowserPath) }

$portCheck = New-Object System.Net.Sockets.TcpClient
$portInUse = $false
try {
  $connectTask = $portCheck.ConnectAsync('127.0.0.1', $Port)
  $portInUse = $connectTask.Wait(750) -and $portCheck.Connected
} catch {
  $portInUse = $false
} finally {
  $portCheck.Dispose()
}

if ($portInUse) {
  Write-Output 'Kr8 Studio is already listening on port 5174. No second instance was started.'
  exit 0
}

$logDirectory = Join-Path $RuntimeDirectory 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$runtimeStatusPath = Join-Path $logDirectory 'kr8-service-runtime.json'
if ($ServiceMode) {
  [pscustomobject]@{
    serviceMode = $true
    account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    publishDataDirectory = $env:KR8_PUBLISH_DATA_DIR
    ffmpegPath = $env:KR8_FFMPEG_PATH
    browserPath = $env:KR8_BROWSER_PATH
    projectPath = $ProjectPath
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $runtimeStatusPath -Encoding utf8
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutLog = Join-Path $logDirectory "kr8-server-$stamp.out.log"
$stderrLog = Join-Path $logDirectory "kr8-server-$stamp.err.log"
$arguments = @(
  '--dns-result-order=ipv4first',
  'src/editor/server.js',
  '--server',
  '--host', $ListenHost,
  '--port', [string]$Port,
  '--env', $(if ($EnvPath) { [System.IO.Path]::GetFullPath($EnvPath) } else { Join-Path $repoRoot '.env.local' }),
  '--projects-root', $ProjectsRoot,
  '--project', $ProjectPath
)

Set-Location -LiteralPath $repoRoot
$child = $null
try {
  $child = Start-Process -FilePath $NodePath `
    -ArgumentList $arguments `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
  Set-Content -LiteralPath $pidPath -Value $child.Id -Encoding ascii
  $child.WaitForExit()
  exit $child.ExitCode
} finally {
  if ($child -and (Test-Path -LiteralPath $pidPath)) {
    $recordedPid = (Get-Content -LiteralPath $pidPath -Raw).Trim()
    if ($recordedPid -eq [string]$child.Id) {
      Remove-Item -LiteralPath $pidPath -Force
    }
  }
}
