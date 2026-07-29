import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { AUDIO_EXTENSIONS } from '../assets/audioImport.js';
import { SOURCE_CAPABILITIES, assertResolvedSource } from './sourceProvider.js';

const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const LYRIC_EXTENSIONS = new Set(['.txt', '.lrc', '.json', '.srt']);

export const LOCAL_FILES_PROVIDER = {
  id: 'local-files',
  name: 'Local Files',
  capabilities: [
    SOURCE_CAPABILITIES.audio,
    SOURCE_CAPABILITIES.cover,
    SOURCE_CAPABILITIES.lyrics,
    SOURCE_CAPABILITIES.timedLyrics,
    SOURCE_CAPABILITIES.metadata
  ],
  async resolve(options = {}) {
    if (!options.audioPath) {
      throw new Error('LocalFilesProvider requires audioPath.');
    }

    const audioPath = path.resolve(options.audioPath);
    await assertFile(audioPath, 'audioPath');
    assertExtension(audioPath, AUDIO_EXTENSIONS, 'audioPath');

    const coverPath = options.coverPath ? path.resolve(options.coverPath) : '';
    const lyricsPath = options.lyricsPath ? path.resolve(options.lyricsPath) : '';
    if (coverPath) {
      await assertFile(coverPath, 'coverPath');
      assertExtension(coverPath, COVER_EXTENSIONS, 'coverPath');
    }
    if (lyricsPath) {
      await assertFile(lyricsPath, 'lyricsPath');
      assertExtension(lyricsPath, LYRIC_EXTENSIONS, 'lyricsPath');
    }

    const title = options.title || path.basename(audioPath, path.extname(audioPath));
    const artist = options.artist || 'Local Artist';

    return assertResolvedSource({
      providerId: LOCAL_FILES_PROVIDER.id,
      providerName: LOCAL_FILES_PROVIDER.name,
      sourceId: options.sourceId || audioPath,
      title,
      artist,
      duration: Number(options.duration || 180),
      sourceRoot: path.dirname(audioPath),
      metadata: {
        title,
        artist
      },
      assets: {
        metadata: '',
        audio: audioPath,
        cover: coverPath,
        lyrics: lyricsPath,
        subtitles: ''
      },
      providerMetadata: {
        audioPath,
        coverPath,
        lyricsPath
      },
      warnings: [
        ...(!coverPath ? ['Cover asset not provided.'] : []),
        ...(!lyricsPath ? ['Lyrics asset not provided.'] : [])
      ]
    });
  }
};

async function assertFile(filePath, label) {
  try {
    await access(filePath, fsConstants.F_OK);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function assertExtension(filePath, allowed, label) {
  const extension = path.extname(filePath).toLowerCase();
  if (!allowed.has(extension)) {
    throw new Error(`${label} has unsupported extension: ${extension || '(none)'}`);
  }
}
