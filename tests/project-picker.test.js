import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  buildWindowsProjectPickerScript,
  normalizeSelectedProjectPath,
  selectKr8ProjectFile
} from '../src/project/selectProjectFile.js';

test('native project picker accepts only project.json and handles cancellation', () => {
  assert.equal(normalizeSelectedProjectPath(''), '');
  assert.equal(path.win32.basename(normalizeSelectedProjectPath('C:\\Kr8\\song.kr8\\project.json')), 'project.json');
  assert.throws(() => normalizeSelectedProjectPath('C:\\Kr8\\song.kr8\\other.json'), /project\.json/);
});

test('native project picker passes a safe Windows dialog script to PowerShell', async () => {
  let call = null;
  const result = await selectKr8ProjectFile({
    platform: 'win32',
    initialDirectory: "C:\\Kr8\\Artist's Song.kr8",
    execFileImpl: async (command, args) => {
      call = { command, args };
      return 'C:\\Kr8\\Song.kr8\\project.json\r\n';
    }
  });
  assert.equal(call.command, 'powershell.exe');
  assert.ok(call.args.includes('-STA'));
  assert.match(call.args.at(-1), /Artist''s Song/);
  assert.equal(path.win32.basename(result.path), 'project.json');
});

test('native project picker reports unsupported hosts without launching a process', async () => {
  const result = await selectKr8ProjectFile({ platform: 'linux', execFileImpl: async () => { throw new Error('must not run'); } });
  assert.deepEqual(result, { supported: false, path: '' });
});

test('Windows project picker script is constrained to Kr8 project.json files', () => {
  const script = buildWindowsProjectPickerScript('C:\\Kr8');
  assert.match(script, /Open Kr8 Project/);
  assert.match(script, /project\.json/);
  assert.match(script, /Multiselect = \$false/);
});
