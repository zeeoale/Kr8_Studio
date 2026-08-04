import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Reel Mode exposes a real Publish command', async () => {
  const html = await readFile(path.join(root, 'src', 'editor', 'public', 'reel', 'index.html'), 'utf8');
  const js = await readFile(path.join(root, 'src', 'editor', 'public', 'reel', 'reel.js'), 'utf8');
  assert.match(html, /id="publishButton"/);
  assert.match(js, /window\.open\('\/publish\/index\.html'/);
  assert.match(js, /\/api\/publish\/context/);
});

test('Reel Mode exposes a render-history source selector', async () => {
  const html = await readFile(path.join(root, 'src', 'editor', 'public', 'reel', 'index.html'), 'utf8');
  const js = await readFile(path.join(root, 'src', 'editor', 'public', 'reel', 'reel.js'), 'utf8');
  assert.match(html, /id="sourceSelect"/);
  assert.match(js, /sourceVideo: state\.context\.source\.relativePath/);
  assert.match(js, /\/api\/reel\/context\$\{query\}/);
});

test('Publish window contains required account, draft warning, confirmation and progress controls', async () => {
  const html = await readFile(path.join(root, 'src', 'editor', 'public', 'publish', 'index.html'), 'utf8');
  assert.match(html, /Connect TikTok/);
  assert.match(html, /Reconnect TikTok/);
  assert.match(html, /Disconnect TikTok/);
  assert.match(html, /This video will be uploaded to TikTok as a draft/);
  assert.match(html, /id="confirmationInput"/);
  assert.match(html, /id="progressFill"/);
  assert.match(html, /Upload Draft/);
  assert.match(html, /YouTube - Upload Video/);
  assert.match(html, /id="syntheticInput"/);
  assert.match(html, /id="youtubeShortsWarning"/);
  assert.match(html, /AI-generated or meaningfully altered realistic content/);
  assert.match(html, /id="copyCaptionButton"/);
  assert.match(html, /TikTok Draft API transfers the video only/);
  assert.match(html, /Instagram - Publish Reel or Story/);
  assert.match(html, /id="instagramDestination"/);
  assert.match(html, /id="shareToFeedInput"/);
  assert.match(html, /id="publishAnywayInput"/);
  assert.match(html, /id="refreshTokenButton"/);
});

test('Publish frontend never stores tokens or requests Direct Post scope', async () => {
  const directory = path.join(root, 'src', 'editor', 'public', 'publish');
  const source = `${await readFile(path.join(directory, 'index.html'), 'utf8')}\n${await readFile(path.join(directory, 'publish.js'), 'utf8')}`;
  assert.doesNotMatch(source, /localStorage|access_token|refresh_token|client_secret|video\.publish/);
  assert.doesNotMatch(source, /Duet|Stitch|privacy setting/i);
});

test('YouTube fields include a non-blocking long 9:16 video warning', async () => {
  const directory = path.join(root, 'src', 'editor', 'public', 'publish');
  const html = await readFile(path.join(directory, 'index.html'), 'utf8');
  const helper = await readFile(path.join(directory, 'youtube-shorts.js'), 'utf8');
  assert.match(html, /role="status"/);
  assert.match(helper, /longer than 3 minutes/);
  assert.match(helper, /regular video/);
  assert.doesNotMatch(helper, /throw|invalid|blocked/i);
});

test('TikTok draft caption uses clipboard handoff instead of unsupported upload metadata', async () => {
  const js = await readFile(path.join(root, 'src', 'editor', 'public', 'publish', 'publish.js'), 'utf8');
  assert.match(js, /copyTikTokCaption/);
  assert.match(js, /state\.provider === 'youtube' \? await youtubePayload\(\) : state\.provider === 'instagram' \? instagramPayload\(\) : \{\}/);
  assert.doesNotMatch(js, /caption:\s*elements\.captionInput\.value/);
});
