import { importResolvedSource } from '../source-providers/importProject.js';
import { TK_MUSIC_PROVIDER } from '../source-providers/tkMusicProvider.js';

export async function importTkMusicTrack(options = {}) {
  return importResolvedSource(TK_MUSIC_PROVIDER, {
    trackDir: options.trackDir,
    outputDir: options.outputDir,
    copyAssets: options.copyAssets,
    duration: options.duration
  });
}
