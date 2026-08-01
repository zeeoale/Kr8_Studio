import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Windows SYSTEM task is advanced opt-in and uses protected code and data locations', async () => {
  const script = await read('install-kr8-service.ps1');
  assert.match(script, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(script, /-UserId 'SYSTEM' -LogonType ServiceAccount/);
  assert.match(script, /-RestartCount 999/);
  assert.match(script, /-MultipleInstances IgnoreNew/);
  assert.match(script, /-ServiceMode/);
  assert.match(script, /AcknowledgeSystemServiceRisk/);
  assert.match(script, /ProgramFiles/);
  assert.match(script, /ProgramData/);
  assert.match(script, /Could not secure the Kr8 executable directory/);
  assert.match(script, /External binding requires the explicit -AllowExternalBinding switch/);
  assert.equal(/taskkill|Stop-Process\s+-Name|node\.exe\s+\/F/i.test(script), false);
});

test('Windows service launcher defaults to loopback and requires opt-in for external binding', async () => {
  const script = await read('start-kr8-server.ps1');
  assert.match(script, /KR8_PUBLISH_DATA_DIR/);
  assert.match(script, /KR8_FFMPEG_PATH/);
  assert.match(script, /KR8_BROWSER_PATH/);
  assert.match(script, /Set-Content -LiteralPath \$pidPath -Value \$child\.Id/);
  assert.match(script, /'127\.0\.0\.1'/);
  assert.match(script, /--host', \$ListenHost/);
  assert.match(script, /AllowExternalBinding/);
  assert.match(script, /trusted VPN/);
  assert.doesNotMatch(script, /--host', '0\.0\.0\.0'/);
  assert.equal(/taskkill|Stop-Process\s+-Name/i.test(script), false);
});

test('Windows stop and uninstall scripts target only the recorded Kr8 PID', async () => {
  const stop = await read('stop-kr8-server.ps1');
  const restart = await read('restart-kr8-service.ps1');
  const uninstall = await read('uninstall-kr8-service.ps1');
  assert.match(stop, /Get-CimInstance Win32_Process/);
  assert.match(stop, /src\[\/\\\\\]editor\[\/\\\\\]server/);
  assert.match(stop, /--port\\s\+\\d\+/);
  assert.match(stop, /Stop-Process -Id \$recordedPid/);
  assert.match(restart, /Start-ScheduledTask -TaskName \$TaskName/);
  assert.match(restart, /stop-kr8-server\.ps1/);
  assert.equal(/taskkill|Stop-Process\s+-Name/i.test(`${stop}\n${restart}\n${uninstall}`), false);
  assert.match(uninstall, /RemovePublisherData/);
  assert.match(uninstall, /Refusing to remove Publisher data outside ProgramData/);
});

test('Publisher credential migration is opt-in and copies only known token-store files', async () => {
  const script = await read('install-kr8-service.ps1');
  assert.match(script, /if \(\$MigratePublisherCredentials\)/);
  for (const filename of ['tiktok-token.json', 'youtube-token.json', 'instagram-token.json', 'settings.json']) {
    assert.match(script, new RegExp(filename.replace('.', '\\.')));
  }
  assert.equal(script.includes('Get-Content -LiteralPath $source'), false);
  assert.match(script, /if \(\$EnvironmentFile\)/);
  assert.match(script, /Kr8 Studio\\config\\\.env\.local/);
});

async function read(name) {
  return readFile(path.join(root, 'deploy', 'windows', name), 'utf8');
}
