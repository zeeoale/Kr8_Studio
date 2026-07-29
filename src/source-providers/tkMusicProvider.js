import { access, readdir, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { SOURCE_CAPABILITIES, assertResolvedSource } from './sourceProvider.js';

const AUDIO_CANDIDATES = ['audio.mp3', 'audio.m4a', 'audio.wav', 'audio.flac', 'audio.ogg'];
const COVER_CANDIDATES = ['cover.jpeg', 'cover.jpg', 'cover.png', 'cover.webp'];
const LYRIC_CANDIDATES = [
  ['postprod', 'subtitles', 'suno_aligned.json'],
  ['postprod', 'subtitles', 'suno_aligned.srt'],
  ['postprod', 'subtitles', 'suno_aligned.lrc'],
  ['postprod', 'transcript', 'official_lyrics.txt']
];
const SUBTITLE_CANDIDATES = [
  ['postprod', 'subtitles', 'suno_aligned.srt'],
  ['postprod', 'subtitles', 'suno_aligned.lrc'],
  ['postprod', 'subtitles', 'suno_aligned_16.9.ass'],
  ['postprod', 'subtitles', 'suno_aligned_9.16.ass']
];
const DEFAULT_TKMUSIC_LIBRARY_ROOT = 'C:\\NodeApp\\TKMusic\\data\\library\\suno';
const LIBRARY_CACHE_TTL_MS = 15_000;
const libraryCache = new Map();

export const TK_MUSIC_PROVIDER = {
  id: 'tkmusic',
  name: 'TKMusic',
  capabilities: [
    SOURCE_CAPABILITIES.audio,
    SOURCE_CAPABILITIES.cover,
    SOURCE_CAPABILITIES.lyrics,
    SOURCE_CAPABILITIES.timedLyrics,
    SOURCE_CAPABILITIES.sections,
    SOURCE_CAPABILITIES.metadata
  ],
  async list(options = {}) {
    return listTkMusicLibrary(options);
  },
  async resolve(options = {}) {
    const trackDir = options.trackDir
      ? path.resolve(options.trackDir)
      : await findTkMusicTrackDirById(options.trackId, options.libraryRoot);

    if (!trackDir) {
      throw new Error('TKMusicProvider requires trackDir or trackId.');
    }

    const metadataPath = path.join(trackDir, 'metadata.json');
    if (!(await exists(metadataPath))) {
      throw new Error(`metadata.json not found: ${metadataPath}`);
    }

    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const lyricsPath = await firstExistingParts(trackDir, LYRIC_CANDIDATES);
    const subtitlesPath = await firstExistingParts(trackDir, SUBTITLE_CANDIDATES);
    const audioPath = await firstExisting(trackDir, AUDIO_CANDIDATES);
    const coverPath = await firstExisting(trackDir, COVER_CANDIDATES);

    const warnings = [];
    if (!audioPath) warnings.push('Audio asset not found.');
    if (!coverPath) warnings.push('Cover asset not found.');
    if (!lyricsPath) warnings.push('Lyrics asset not found.');
    if (!subtitlesPath) warnings.push('Subtitle asset not found.');

    return assertResolvedSource({
      providerId: TK_MUSIC_PROVIDER.id,
      providerName: TK_MUSIC_PROVIDER.name,
      sourceId: metadata.id || '',
      title: metadata.title || path.basename(trackDir),
      artist: metadata.artist || 'TKMusic',
      duration: Number(options.duration || metadata.duration || await estimateDurationFromLyrics(lyricsPath) || 180),
      sourceRoot: trackDir,
      metadata,
      assets: {
        metadata: metadataPath,
        audio: audioPath,
        cover: coverPath,
        lyrics: lyricsPath,
        subtitles: subtitlesPath
      },
      providerMetadata: {
        trackDir,
        metadataPath,
        tkMusicSourceProvider: metadata.source?.provider || '',
        tkMusicSourceProfile: metadata.source?.profile || ''
      },
      warnings
    });
  }
};

export async function listTkMusicLibrary(options = {}) {
  const catalog = await loadTkMusicCatalog(options);
  return {
    tracks: catalog.tracks.map(toPublicTrack),
    total: catalog.tracks.length,
    skipped: catalog.skipped,
    refreshedAt: catalog.refreshedAt
  };
}

export async function getTkMusicLibraryCoverPath(trackId, options = {}) {
  const targetId = String(trackId || '').trim();
  if (!targetId) throw new Error('trackId is required.');
  const catalog = await loadTkMusicCatalog(options);
  const track = catalog.tracks.find((item) => item.id === targetId || item.rawId === targetId);
  if (!track) throw new Error(`TKMusic track not found: ${targetId}`);
  return track.coverPath || '';
}

export function clearTkMusicLibraryCache(libraryRoot = '') {
  if (!libraryRoot) {
    libraryCache.clear();
    return;
  }
  libraryCache.delete(path.resolve(libraryRoot));
}

export async function findTkMusicTrackDirById(trackId, libraryRoot = DEFAULT_TKMUSIC_LIBRARY_ROOT) {
  const targetId = String(trackId || '').trim();
  if (!targetId) {
    throw new Error('trackId is required.');
  }

  const root = path.resolve(libraryRoot);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidateDir = path.join(root, entry.name);
    const metadataPath = path.join(candidateDir, 'metadata.json');
    if (!(await exists(metadataPath))) continue;
    try {
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      if (metadata.id === targetId || metadata.source?.rawId === targetId) {
        return candidateDir;
      }
    } catch {
      // Ignore malformed library entries; provider discovery should keep scanning.
    }
  }
  throw new Error(`TKMusic track not found: ${targetId}`);
}

async function loadTkMusicCatalog(options = {}) {
  const root = path.resolve(options.libraryRoot || DEFAULT_TKMUSIC_LIBRARY_ROOT);
  const cached = libraryCache.get(root);
  const now = Date.now();
  if (!options.refresh && cached && now - cached.cachedAt < LIBRARY_CACHE_TTL_MS) {
    return cached;
  }

  const entries = await readdir(root, { withFileTypes: true });
  const results = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readTkMusicCatalogEntry(path.join(root, entry.name))));
  const tracks = results
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
        || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
  const catalog = {
    root,
    tracks,
    skipped: results.filter((entry) => !entry).length,
    refreshedAt: new Date().toISOString(),
    cachedAt: now
  };
  libraryCache.set(root, catalog);
  return catalog;
}

async function readTkMusicCatalogEntry(trackDir) {
  const metadataPath = path.join(trackDir, 'metadata.json');
  if (!(await exists(metadataPath))) return null;

  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const id = String(metadata.id || metadata.source?.rawId || '').trim();
    if (!id) return null;
    const lyricsPath = await firstExistingParts(trackDir, LYRIC_CANDIDATES);
    const subtitlesPath = await firstExistingParts(trackDir, SUBTITLE_CANDIDATES);
    const audioPath = await firstExisting(trackDir, AUDIO_CANDIDATES);
    const coverPath = await firstExisting(trackDir, COVER_CANDIDATES);
    return {
      id,
      rawId: String(metadata.source?.rawId || ''),
      title: String(metadata.title || path.basename(trackDir)),
      artist: String(metadata.artist || 'TKMusic'),
      tags: normalizeCatalogText(metadata.tags, 2_000),
      mood: normalizeCatalogText(metadata.mood, 240),
      model: normalizeCatalogText(metadata.model, 120),
      isPinned: Boolean(metadata.isPinned),
      createdAt: normalizeDate(metadata.createdAt),
      duration: Number(metadata.duration || await estimateDurationFromLyrics(lyricsPath) || 0),
      availability: {
        audio: Boolean(audioPath),
        cover: Boolean(coverPath),
        lyrics: Boolean(lyricsPath),
        timedLyrics: Boolean(subtitlesPath || (lyricsPath && path.extname(lyricsPath).toLowerCase() !== '.txt'))
      },
      trackDir,
      coverPath
    };
  } catch {
    return null;
  }
}

function toPublicTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    tags: track.tags,
    mood: track.mood,
    model: track.model,
    isPinned: track.isPinned,
    createdAt: track.createdAt,
    duration: track.duration,
    availability: { ...track.availability }
  };
}

function normalizeCatalogText(value, maxLength) {
  const text = Array.isArray(value) ? value.join(', ') : String(value || '');
  return text.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeDate(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

async function firstExisting(baseDir, names) {
  for (const name of names) {
    const candidate = path.join(baseDir, name);
    if (await exists(candidate)) return candidate;
  }
  return '';
}

async function firstExistingParts(baseDir, groups) {
  for (const parts of groups) {
    const candidate = path.join(baseDir, ...parts);
    if (await exists(candidate)) return candidate;
  }
  return '';
}

async function estimateDurationFromLyrics(lyricsPath) {
  if (!lyricsPath || path.extname(lyricsPath).toLowerCase() !== '.json') return 0;

  try {
    const payload = JSON.parse(await readFile(lyricsPath, 'utf8'));
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    return lines.reduce((max, line) => Math.max(max, Number(line.endSeconds || line.end || 0)), 0);
  } catch {
    return 0;
  }
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
