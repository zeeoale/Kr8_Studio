import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyCoverAssetToProject } from '../src/cover-lab/applyCover.js';
import {
  extractComfyResults,
  fetchComfyImage,
  generateComfyCover
} from '../src/cover-lab/comfyClient.js';
import {
  TAKARA_IDENTITY_PRESET,
  TAKARA_LORA_FILENAME,
  applyIdentityLora,
  applyIdentityNegativePrompt,
  buildIdentityPrompt,
  getIdentityPreset,
  insertIdentityIntoPrompt
} from '../src/cover-lab/identities.js';
import { readImageDimensions } from '../src/cover-lab/imageDimensions.js';
import {
  createDefaultCoverLabSettings,
  createRandomSeed,
  normalizeCoverLabSettings,
  validateCoverLabSettings
} from '../src/cover-lab/schema.js';
import { createOllamaCoverPrompt, listOllamaModels } from '../src/cover-lab/ollamaClient.js';
import {
  extractWorkflowLoras,
  loadCoverWorkflowTemplate,
  patchCoverWorkflow,
  validateCoverWorkflow
} from '../src/cover-lab/workflow.js';
import { deserializeProject, serializeProject } from '../src/project/io.js';
import { validateProject } from '../src/project/schema.js';
import { createTkNoirPulsePreset } from '../src/presets/tk-noir-pulse.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, 'tests', 'fixtures', 'cover-workflow.json');

test('Cover Lab defaults are versioned, bounded and project-schema compatible', () => {
  const settings = createDefaultCoverLabSettings({
    generation: { ratio: 'vertical', width: 99999, batchSize: 20 },
    context: { title: 'Track' }
  });
  assert.equal(settings.version, 1);
  assert.equal(settings.generation.ratio, 'vertical');
  assert.equal(settings.generation.width, 4096);
  assert.equal(settings.generation.height, 1280);
  assert.equal(settings.generation.batchSize, 8);
  assert.deepEqual(validateCoverLabSettings(settings), []);

  const project = createProject();
  project.metadata.coverLab = settings;
  assert.equal(validateProject(project).valid, true);
  const serialized = serializeProject(project);
  assert.deepEqual(deserializeProject(serialized), JSON.parse(serialized));
});

test('Cover Lab endpoint and seed normalization reject unsafe input', () => {
  assert.throws(
    () => normalizeCoverLabSettings({ ollama: { endpoint: 'file:///tmp/model' } }),
    /HTTP or HTTPS/
  );
  assert.throws(
    () => normalizeCoverLabSettings({ comfy: { endpoint: 'http://user:pass@127.0.0.1:8188' } }),
    /credentials/
  );
  assert.equal(createRandomSeed(() => 0.5), 500_000_000_000_000);
});

test('Takara identity preset is canonical and used by default', () => {
  const settings = createDefaultCoverLabSettings();
  const preset = getIdentityPreset('takara');
  assert.equal(preset, TAKARA_IDENTITY_PRESET);
  assert.equal(settings.identity.presetId, 'takara');
  assert.equal(settings.identity.preserve, true);
  assert.equal(settings.identity.useLora, true);
  assert.equal(settings.identity.loraStrength, 1.2);
  assert.equal(preset.loraFilename, TAKARA_LORA_FILENAME);
});

test('legacy Cover Lab settings without identity remain compatible', () => {
  const legacy = createDefaultCoverLabSettings();
  delete legacy.identity;
  assert.deepEqual(validateCoverLabSettings(legacy), []);
  const normalized = normalizeCoverLabSettings(legacy);
  assert.equal(normalized.identity.presetId, 'takara');
  assert.equal(normalized.identity.useLora, true);
});

test('Takara identity prompt starts with stable canonical DNA', () => {
  const prompt = buildIdentityPrompt(TAKARA_IDENTITY_PRESET);
  assert.match(prompt, /^Takara, an East Asian woman in her mid twenties/);
  assert.match(prompt, /heart-shaped face, high cheekbones, narrow jaw/);
  assert.match(prompt, /icy gray almond eyes/);
  assert.match(prompt, /blackened burgundy smoky eye/);
  assert.match(prompt, /long perfectly straight soft-black hair with a sharp center part/);
  assert.match(prompt, /no waves or curls/);
  assert.match(prompt, /very fair porcelain-like skin/);
  assert.match(prompt, /Japanese\/Korean facial features/);
  assert.match(prompt, /calm observational gaze/);
});

test('identity negative prompt adds drift terms without duplicates', () => {
  const negative = applyIdentityNegativePrompt(
    'logo, brown eyes, blurry',
    TAKARA_IDENTITY_PRESET,
    { preserve: true }
  );
  assert.equal(negative.match(/\bbrown eyes\b/gi)?.length, 1);
  assert.match(negative, /different woman/);
  assert.match(negative, /curly hair/);
  assert.match(negative, /inconsistent character/);
  assert.equal(
    applyIdentityNegativePrompt('logo', TAKARA_IDENTITY_PRESET, { preserve: false }),
    'logo'
  );
});

test('identity insertion updates the canonical prefix without duplicating Takara', () => {
  const first = insertIdentityIntoPrompt(
    'rainy neon city, cinematic portrait',
    TAKARA_IDENTITY_PRESET,
    { notes: 'silver ear cuff' }
  );
  const second = insertIdentityIntoPrompt(first, TAKARA_IDENTITY_PRESET, { notes: 'silver ear cuff' });
  assert.equal(second.match(/\bTakara\b/g)?.length, 1);
  assert.match(second, /Concept: rainy neon city/);
  assert.match(second, /identity notes: silver ear cuff/);
});

test('synthetic ComfyUI workflow validates and exposes six immutable LoRA slots', async () => {
  const workflow = await loadCoverWorkflowTemplate(workflowPath);
  assert.equal(validateCoverWorkflow(workflow), workflow);
  const loras = extractWorkflowLoras(workflow);
  assert.equal(loras.length, 6);
  assert.equal(loras[0].slot, 'lora_1');
  assert.equal(loras[5].slot, 'lora_6');
  assert.match(loras[0].filename, /\.safetensors$/);
});

test('Takara LoRA is found by filename, enabled and disabled without a fixed slot', async () => {
  const workflow = await loadCoverWorkflowTemplate(workflowPath);
  const inputs = workflow['70'].inputs;
  const sourceEntry = Object.entries(inputs).find(([, value]) => value?.lora === TAKARA_LORA_FILENAME);
  assert.ok(sourceEntry);
  const [sourceSlot, sourceValue] = sourceEntry;
  const targetSlot = sourceSlot === 'lora_1' ? 'lora_2' : 'lora_1';
  const displaced = inputs[targetSlot];
  inputs[targetSlot] = sourceValue;
  inputs[sourceSlot] = displaced;

  applyIdentityLora(workflow, TAKARA_IDENTITY_PRESET, { useLora: true, loraStrength: 1.2 });
  assert.equal(inputs[targetSlot].on, true);
  assert.equal(inputs[targetSlot].strength, 1.2);

  applyIdentityLora(workflow, TAKARA_IDENTITY_PRESET, { useLora: false, loraStrength: 0.4 });
  assert.equal(inputs[targetSlot].on, false);
  assert.equal(inputs[targetSlot].strength, 0.4);
});

test('Takara identity reports a clear error when its workflow LoRA is missing', async () => {
  const workflow = await loadCoverWorkflowTemplate(workflowPath);
  for (const value of Object.values(workflow['70'].inputs)) {
    if (value?.lora === TAKARA_LORA_FILENAME) value.lora = 'Other.safetensors';
  }
  assert.throws(
    () => applyIdentityLora(workflow, TAKARA_IDENTITY_PRESET, { useLora: true, loraStrength: 1.2 }),
    /Takara_LoRa_800_Step\.safetensors.*not present/
  );
});

test('workflow patcher changes only documented generation inputs and output names', async () => {
  const template = await loadCoverWorkflowTemplate(workflowPath);
  const original = structuredClone(template);
  const patched = patchCoverWorkflow(template, {
    jobId: '../job-42',
    songTitle: '내 안의 괴물 / Monster',
    positivePrompt: 'cinematic portrait',
    negativePrompt: 'text, logo',
    width: 720,
    height: 1280,
    batchSize: 2,
    seed: 12345,
    generateUpscaled: true,
    loras: [{ slot: 'lora_1', enabled: true, strength: 0.8 }]
  });
  assert.deepEqual(template, original);
  assert.equal(patched.workflow['8'].inputs.text, 'cinematic portrait');
  assert.equal(patched.workflow['3'].inputs.text, 'text, logo');
  assert.equal(patched.workflow['5'].inputs.width, 720);
  assert.equal(patched.workflow['5'].inputs.height, 1280);
  assert.equal(patched.workflow['5'].inputs.batch_size, 2);
  assert.equal(patched.workflow['58'].inputs.seed, 12345);
  assert.deepEqual(patched.workflow['10'].inputs.seed, ['58', 0]);
  assert.equal(patched.workflow['70'].inputs.lora_1.on, true);
  assert.equal(patched.workflow['70'].inputs.lora_1.strength, 0.8);
  assert.equal(patched.workflow['70'].inputs.lora_1.lora, original['70'].inputs.lora_1.lora);
  assert.match(patched.workflow['38'].inputs.path, /^Kr8_CoverLab\//);
  assert.doesNotMatch(patched.workflow['38'].inputs.path, /\.\.|^[A-Za-z]:/);
  assert.match(patched.workflow['38'].inputs.filename, /job-42_native$/);
  assert.match(patched.workflow['67'].inputs.filename, /job-42_upscaled$/);
});

test('workflow patch applies the default Takara LoRA strength 1.20', async () => {
  const template = await loadCoverWorkflowTemplate(workflowPath);
  const identity = createDefaultCoverLabSettings().identity;
  const patched = patchCoverWorkflow(template, {
    jobId: 'takara-job',
    songTitle: 'Takara',
    positivePrompt: 'Takara portrait',
    negativePrompt: 'identity drift',
    identity
  });
  const takara = Object.values(patched.workflow['70'].inputs)
    .find((value) => value?.lora === TAKARA_LORA_FILENAME);
  assert.equal(takara.on, true);
  assert.equal(takara.strength, 1.2);
});

test('workflow patcher can omit only the upscaled output saver', async () => {
  const template = await loadCoverWorkflowTemplate(workflowPath);
  const patched = patchCoverWorkflow(template, {
    positivePrompt: 'cover',
    generateUpscaled: false
  });
  assert.ok(patched.workflow['38']);
  assert.equal(patched.workflow['67'], undefined);
  assert.ok(patched.workflow['66']);
});

test('Ollama model menu uses installed model names from api tags', async () => {
  const models = await listOllamaModels({
    endpoint: 'http://127.0.0.1:11434',
    fetchImpl: async (url) => {
      assert.match(String(url), /\/api\/tags$/);
      return jsonResponse({
        models: [{ name: 'qwen3:8b' }, { model: 'llama3.2:latest' }, { name: 'qwen3:8b' }]
      });
    }
  });
  assert.deepEqual(models, ['llama3.2:latest', 'qwen3:8b']);
});

test('Ollama prompt request includes music context and returns editable plain text', async () => {
  let requestBody;
  const prompt = await createOllamaCoverPrompt({
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen3:8b',
    context: {
      title: 'The Distance Between Us',
      artist: 'TKMusic',
      lyrics: 'Whispered verse',
      mood: 'melancholic'
    },
    ratio: { name: 'Vertical 9:16', width: 720, height: 1280 },
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/api\/chat$/);
      requestBody = JSON.parse(init.body);
      return jsonResponse({ message: { content: '```text\nA cinematic portrait with negative space\n```' } });
    }
  });
  assert.equal(requestBody.model, 'qwen3:8b');
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.think, false);
  assert.equal(requestBody.keep_alive, 0);
  assert.equal(requestBody.options.num_predict, 450);
  assert.match(requestBody.messages[0].content, /Do not mention or request any text/);
  assert.match(requestBody.messages[1].content, /The Distance Between Us/);
  assert.match(requestBody.messages[1].content, /720x1280/);
  assert.equal(prompt, 'A cinematic portrait with negative space');
});

test('Ollama Create Prompt preserves Takara identity before the song concept', async () => {
  let requestBody;
  const identity = createDefaultCoverLabSettings().identity;
  const prompt = await createOllamaCoverPrompt({
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen3:4b',
    context: { title: 'Night Signal', mood: 'dark synthwave' },
    identityPreset: TAKARA_IDENTITY_PRESET,
    identity,
    ratio: { name: 'Vertical 9:16', width: 720, height: 1280 },
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse({ message: { content: 'standing under neon rain, cinematic lighting' } });
    }
  });
  assert.match(requestBody.messages[0].content, /canonical protagonist is Takara/);
  assert.match(requestBody.messages[0].content, /icy gray almond eyes/);
  assert.match(requestBody.messages[0].content, /Never replace the character with a generic woman/);
  assert.match(requestBody.messages[1].content, /Canonical character DNA: Takara/);
  assert.match(prompt, /^Takara,/);
  assert.match(prompt, /Concept: standing under neon rain/);
});

test('Ollama and ComfyUI offline errors are explicit', async () => {
  await assert.rejects(
    listOllamaModels({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }),
    /Ollama is not reachable/
  );
  await assert.rejects(
    generateComfyCover({
      workflow: {},
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); }
    }),
    /ComfyUI is not reachable/
  );
});

test('ComfyUI client queues, polls and maps confirmed native and upscaled outputs', async () => {
  let historyReads = 0;
  const generated = await generateComfyCover({
    endpoint: 'http://127.0.0.1:8188',
    workflow: { '8': { class_type: 'CLIPTextEncode', inputs: {} } },
    manifest: { seed: 77, width: 720, height: 1280 },
    pollMs: 1,
    timeoutMs: 1_000,
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith('/prompt')) {
        assert.equal(init.method, 'POST');
        return jsonResponse({ prompt_id: 'prompt-1' });
      }
      historyReads += 1;
      if (historyReads === 1) return jsonResponse({ 'prompt-1': { outputs: {} } });
      return jsonResponse({
        'prompt-1': {
          status: { status_str: 'success', completed: true },
          outputs: {
            38: { images: [{ filename: 'native.webp', subfolder: 'Kr8', type: 'output' }] },
            67: { images: [{ filename: 'upscaled.webp', subfolder: 'Kr8', type: 'output' }] }
          }
        }
      });
    }
  });
  assert.equal(generated.promptId, 'prompt-1');
  assert.deepEqual(generated.results.map((item) => item.variant), ['native', 'upscaled']);
  assert.equal(generated.results[0].seed, 77);
});

test('ComfyUI output extraction rejects a completed job with no images', () => {
  assert.throws(() => extractComfyResults({ 38: { images: [] } }), /no Cover Lab images/);
});

test('ComfyUI image retrieval keeps the generated bytes intact', async () => {
  const bytes = Buffer.from('RIFF-cover-webp');
  const image = await fetchComfyImage({
    endpoint: 'http://127.0.0.1:8188',
    result: { filename: 'cover.webp', subfolder: 'Kr8', type: 'output' },
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, '/view');
      assert.equal(parsed.searchParams.get('filename'), 'cover.webp');
      return new Response(bytes, { headers: { 'content-type': 'image/webp' } });
    }
  });
  assert.deepEqual(image.data, bytes);
  assert.equal(image.contentType, 'image/webp');
});

test('Cover Lab reads actual PNG, JPEG and WEBP output dimensions', () => {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1440, 16);
  png.writeUInt32BE(2560, 20);

  const jpeg = Buffer.alloc(21);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(jpeg, 0);
  jpeg.writeUInt16BE(2560, 7);
  jpeg.writeUInt16BE(1440, 9);

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8X', 12, 'ascii');
  writeUInt24LE(webp, 24, 1440 - 1);
  writeUInt24LE(webp, 27, 2560 - 1);

  assert.deepEqual(readImageDimensions(png), { width: 1440, height: 2560 });
  assert.deepEqual(readImageDimensions(jpeg), { width: 1440, height: 2560 });
  assert.deepEqual(readImageDimensions(webp), { width: 1440, height: 2560 });
  assert.equal(readImageDimensions(Buffer.from('not-an-image')), null);
});

test('Use as Cover updates the existing layer and preserves project fields', () => {
  const project = createProject();
  project.metadata.privateFutureField = { keep: true };
  const originalCover = project.layers.find((layer) => layer.name === 'Cover');
  const asset = {
    id: 'asset_cover_lab',
    type: 'image',
    role: 'cover',
    path: 'assets/generated.webp',
    missing: false
  };
  project.assets.push(asset);
  const applied = applyCoverAssetToProject(project, asset, createDefaultCoverLabSettings());
  const cover = applied.project.layers.find((layer) => layer.name === 'Cover');
  assert.equal(cover.id, originalCover.id);
  assert.equal(cover.properties.assetId, asset.id);
  assert.deepEqual(applied.project.metadata.privateFutureField, { keep: true });
  assert.equal(applied.project.metadata.coverLab.selectedAssetId, asset.id);
  assert.equal(validateProject(applied.project).valid, true);
});

test('Cover Lab identity persists through project save and reload', () => {
  const project = createProject();
  project.metadata.coverLab = createDefaultCoverLabSettings({
    identity: {
      presetId: 'takara',
      preserve: true,
      useLora: true,
      loraStrength: 1.2,
      notes: 'silver ear cuff'
    }
  });
  const loaded = deserializeProject(serializeProject(project));
  assert.deepEqual(loaded.metadata.coverLab.identity, project.metadata.coverLab.identity);
  assert.equal(validateProject(loaded).valid, true);
});

test('desktop UI exposes Cover Lab and an Ollama model select instead of free text', async () => {
  const html = await readFile(path.join(root, 'src', 'editor', 'public', 'index.html'), 'utf8');
  const client = await readFile(path.join(root, 'src', 'editor', 'public', 'cover-lab', 'cover-lab.js'), 'utf8');
  assert.match(html, /id="createCoverButton"/);
  assert.match(html, /<select id="coverLabOllamaModel">/);
  assert.match(html, /<select id="coverLabIdentityPreset">/);
  assert.match(html, /id="coverLabInsertIdentityButton"/);
  assert.match(client, /\/api\/cover-lab\/ollama\/models/);
  assert.match(client, /\/api\/cover-lab\/identity\/prompt/);
  assert.doesNotMatch(html, /<input[^>]+id="coverLabOllamaModel"/);
});

function writeUInt24LE(buffer, offset, value) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
}

function createProject() {
  const preset = createTkNoirPulsePreset({
    seed: 'cover-lab-tests',
    title: 'Cover Lab',
    artist: 'TKMusic',
    coverAssetId: 'asset_original'
  });
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: 'kr8_cover_lab_test',
    name: 'Cover Lab Test',
    createdAt: now,
    updatedAt: now,
    composition: preset.composition,
    assets: [{
      id: 'asset_original',
      type: 'image',
      role: 'cover',
      path: 'assets/original.jpeg',
      missing: false
    }],
    layers: preset.layers,
    scenes: preset.scenes,
    presets: [preset.id],
    migrations: [],
    metadata: {}
  };
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) }
  });
}
