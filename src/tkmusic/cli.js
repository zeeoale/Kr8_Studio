import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importTkMusicTrack } from './importTrack.js';

const helpText = `Kr8 TKMusic importer

Usage:
  node src/tkmusic/cli.js --track-dir PATH [--out PATH] [--copy-assets] [--json]

Example:
  node src/tkmusic/cli.js --track-dir "../TKMusic/data/library/provider/track-folder" --out "./examples/imported-track.kr8"
`;

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(helpText);
    return;
  }

  const result = await importTkMusicTrack({
    trackDir: options.trackDir,
    outputDir: options.out,
    copyAssets: options.copyAssets
  });

  if (options.json) {
    console.log(JSON.stringify({
      status: result.status,
      projectDir: result.projectDir,
      projectPath: result.projectPath,
      copyAssets: result.copyAssets,
      warnings: result.warnings
    }, null, 2));
    return;
  }

  console.log(`Kr8 project created: ${result.projectPath}`);
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.log(`Warning: ${warning}`);
    }
  }
}

function parseArgs(argv) {
  const options = {
    trackDir: '',
    out: '',
    copyAssets: false,
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--track-dir') {
      options.trackDir = requireValue(argv, i, '--track-dir');
      i += 1;
    } else if (arg === '--out') {
      options.out = path.resolve(requireValue(argv, i, '--out'));
      i += 1;
    } else if (arg === '--copy-assets') {
      options.copyAssets = true;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.trackDir) {
    throw new Error('Missing --track-dir. Run with --help for usage.');
  }

  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
