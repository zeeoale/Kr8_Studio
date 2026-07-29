import { spawn } from 'node:child_process';

export function openDefaultBrowser(url, options = {}) {
  const target = new URL(url).toString();
  const spawnProcess = options.spawnProcess || spawn;
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', target];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [target];
  } else {
    command = 'xdg-open';
    args = [target];
  }
  const child = spawnProcess(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref?.();
  return { command, args };
}
