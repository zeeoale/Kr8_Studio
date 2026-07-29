import { execFile } from 'node:child_process';
import path from 'node:path';

const PROJECT_FILENAME = 'project.json';

export async function selectKr8ProjectFile(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { supported: false, path: '' };
  const initialDirectory = path.resolve(options.initialDirectory || process.cwd());
  const run = options.execFileImpl || execFileText;
  const script = buildWindowsProjectPickerScript(initialDirectory);
  const output = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  return { supported: true, path: normalizeSelectedProjectPath(output) };
}

export function normalizeSelectedProjectPath(value) {
  const selected = String(value || '').replace(/^\uFEFF/, '').trim();
  if (!selected) return '';
  if (path.basename(selected).toLowerCase() !== PROJECT_FILENAME) {
    throw new Error('Select the project.json file inside a .kr8 project folder.');
  }
  return path.resolve(selected);
}

export function buildWindowsProjectPickerScript(initialDirectory) {
  const escapedDirectory = String(initialDirectory || '').replaceAll("'", "''");
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    "$dialog.Title = 'Open Kr8 Project'",
    "$dialog.Filter = 'Kr8 Project (project.json)|project.json'",
    `$dialog.InitialDirectory = '${escapedDirectory}'`,
    "$dialog.FileName = 'project.json'",
    '$dialog.CheckFileExists = $true',
    '$dialog.CheckPathExists = $true',
    '$dialog.Multiselect = $false',
    '$result = $dialog.ShowDialog()',
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.FileName }"
  ].join('; ');
}

function execFileText(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      windowsHide: true,
      timeout: 15 * 60_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8'
    }, (error, stdout) => {
      if (error) {
        reject(new Error('The native project picker could not be opened.'));
        return;
      }
      resolve(stdout);
    });
  });
}
