import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMobileProjectContext,
  serializeMobilePublishStatus,
  serializeMobileRenderJob
} from '../src/mobile/context.js';

test('mobile project context exposes render-safe data without source paths or unknown properties', () => {
  const context = buildMobileProjectContext({
    schemaVersion: 3,
    id: 'project_mobile',
    name: 'Mobile Test',
    composition: { width: 1080, height: 1920, fps: 30, duration: 120, backgroundColor: '#050608' },
    metadata: { title: 'The Song', artist: 'The Artist', privateNote: 'do not expose' },
    assets: [
      { id: 'audio_song', type: 'audio', role: 'song', path: 'C:\\Music\\secret.mp3' },
      { id: 'cover_main', type: 'image', role: 'cover', path: '../secret-cover.jpg' },
      { id: 'lyrics_main', type: 'lyrics', role: 'lyrics', path: '../secret-lyrics.json' }
    ],
    layers: [
      { id: 'cover', name: 'Cover', type: 'image', visible: true, locked: true, properties: { assetId: 'cover_main', unknown: 'preserved elsewhere' } },
      { id: 'title', name: 'Song Title', type: 'text', visible: true, properties: { text: 'Fallback title' } }
    ],
    scenes: [{ id: 'intro', name: 'Intro', start: 0, end: 12, privateData: 'hidden' }]
  });

  assert.equal(context.project.title, 'The Song');
  assert.equal(context.project.artist, 'The Artist');
  assert.equal(context.composition.width, 1080);
  assert.equal(context.composition.verticalReady, true);
  assert.equal(context.media.audioUrl, '/api/assets/audio_song');
  assert.equal(context.media.coverUrl, '/api/assets/cover_main');
  assert.equal(context.media.lyricsUrl, '/api/assets/lyrics_main');
  assert.equal(context.layers[0].locked, true);
  assert.equal(context.layers[0].assetUrl, '/api/assets/cover_main');
  assert.equal(context.layers[1].properties.text, 'Fallback title');
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes('C:\\Music'), false);
  assert.equal(serialized.includes('secret-cover'), false);
  assert.equal(serialized.includes('privateNote'), false);
  assert.equal(serialized.includes('unknown'), false);
  assert.equal(serialized.includes('privateData'), false);
});

test('mobile project context handles a blank project', () => {
  const context = buildMobileProjectContext({
    schemaVersion: 1,
    id: 'blank',
    name: 'Blank Kr8 Project',
    composition: { width: 1920, height: 1080, fps: 30, duration: 180 },
    assets: [], layers: [], scenes: [], metadata: {}
  });
  assert.equal(context.project.title, 'Blank Kr8 Project');
  assert.equal(context.media.audioUrl, '');
  assert.equal(context.media.coverUrl, '');
  assert.equal(context.composition.verticalReady, false);
  assert.deepEqual(context.layers, []);
});

test('mobile render and publisher status serializers hide local implementation details', () => {
  const render = serializeMobileRenderJob({
    id: 'job_1', status: 'done', startedAt: '2026-07-22T10:00:00.000Z', completedAt: '2026-07-22T10:01:00.000Z',
    browserPath: 'C:\\Program Files\\Chrome\\chrome.exe', userDataDir: 'C:\\Temp\\secret',
    options: { frameCount: 300 }, progress: { completedFrames: 300, totalFrames: 300, averageFps: 28.4 },
    result: { export: { absolutePath: 'C:\\Projects\\song.kr8\\exports\\song.mp4', metadataRelativePath: 'secret.json' } }
  });
  assert.equal(render.output.filename, 'song.mp4');
  assert.equal(JSON.stringify(render).includes('Program Files'), false);
  assert.equal(JSON.stringify(render).includes('Projects'), false);

  const publish = serializeMobilePublishStatus('youtube', { connected: true, channelTitle: 'TKMusic', accessToken: 'secret' }, {
    jobId: 'upload_1', status: 'uploading', progress: 42, bytesSent: 42, totalBytes: 100, uploadUrl: 'secret'
  });
  assert.equal(publish.account, 'TKMusic');
  assert.equal(publish.upload.progress, 42);
  assert.equal(JSON.stringify(publish).includes('secret'), false);
});
