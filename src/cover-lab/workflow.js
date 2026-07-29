import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { applyIdentityLora, resolveIdentity } from './identities.js';
import { sanitizeOutputSegment } from './schema.js';

export const COVER_WORKFLOW_NODE_MAP = Object.freeze({
  negative: '3',
  latent: '5',
  positive: '8',
  sampler: '10',
  nativeOutput: '38',
  seed: '58',
  upscaledOutput: '67',
  loras: '70'
});

export async function loadCoverWorkflowTemplate(workflowPath) {
  const resolved = path.resolve(workflowPath);
  let workflow;
  try {
    workflow = JSON.parse(await readFile(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`Cover Lab workflow could not be loaded: ${error.message || error}`);
  }
  validateCoverWorkflow(workflow);
  return workflow;
}

export function validateCoverWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error('Cover Lab workflow must be a ComfyUI API object.');
  }
  const required = [
    ['negative', 'CLIPTextEncode', ['text']],
    ['latent', 'EmptySD3LatentImage', ['width', 'height', 'batch_size']],
    ['positive', 'CLIPTextEncode', ['text']],
    ['sampler', 'KSampler', ['seed']],
    ['nativeOutput', 'Image Saver Simple', ['filename', 'path']],
    ['seed', 'SeedNode', ['seed']],
    ['upscaledOutput', 'Image Saver Simple', ['filename', 'path']],
    ['loras', 'Power Lora Loader (rgthree)', []]
  ];
  for (const [name, classType, inputs] of required) {
    const id = COVER_WORKFLOW_NODE_MAP[name];
    const node = workflow[id];
    if (!node || typeof node !== 'object') throw new Error(`Cover Lab workflow node ${id} (${name}) is missing.`);
    if (node.class_type !== classType) {
      throw new Error(`Cover Lab workflow node ${id} must be ${classType}, found ${node.class_type || 'unknown'}.`);
    }
    for (const input of inputs) {
      if (!(input in (node.inputs || {}))) throw new Error(`Cover Lab workflow node ${id} is missing input ${input}.`);
    }
  }
  const samplerSeed = workflow[COVER_WORKFLOW_NODE_MAP.sampler].inputs.seed;
  if (!Array.isArray(samplerSeed) || String(samplerSeed[0]) !== COVER_WORKFLOW_NODE_MAP.seed) {
    throw new Error('Cover Lab sampler must receive its seed from node 58.');
  }
  return workflow;
}

export function extractWorkflowLoras(workflow) {
  validateCoverWorkflow(workflow);
  const inputs = workflow[COVER_WORKFLOW_NODE_MAP.loras].inputs || {};
  return Object.keys(inputs)
    .filter((key) => /^lora_[1-6]$/.test(key))
    .sort((left, right) => Number(left.slice(5)) - Number(right.slice(5)))
    .map((slot) => ({
      slot,
      enabled: inputs[slot]?.on === true,
      filename: String(inputs[slot]?.lora || ''),
      strength: Number(inputs[slot]?.strength ?? 1)
    }));
}

export function patchCoverWorkflow(template, options = {}) {
  validateCoverWorkflow(template);
  const workflow = structuredClone(template);
  const width = boundedInteger(options.width, 1024, 64, 4096);
  const height = boundedInteger(options.height, 1024, 64, 4096);
  const batchSize = boundedInteger(options.batchSize, 1, 1, 8);
  const seed = boundedInteger(options.seed, 1, 0, Number.MAX_SAFE_INTEGER);
  const songSlug = sanitizeOutputSegment(options.songTitle, 'untitled');
  const jobId = sanitizeOutputSegment(options.jobId, 'job');
  const outputPath = `Kr8_CoverLab/${songSlug}`;

  workflow[COVER_WORKFLOW_NODE_MAP.positive].inputs.text = String(options.positivePrompt || '').trim();
  workflow[COVER_WORKFLOW_NODE_MAP.negative].inputs.text = String(options.negativePrompt || '').trim();
  workflow[COVER_WORKFLOW_NODE_MAP.latent].inputs.width = width;
  workflow[COVER_WORKFLOW_NODE_MAP.latent].inputs.height = height;
  workflow[COVER_WORKFLOW_NODE_MAP.latent].inputs.batch_size = batchSize;
  workflow[COVER_WORKFLOW_NODE_MAP.seed].inputs.seed = seed;

  const loraInputs = workflow[COVER_WORKFLOW_NODE_MAP.loras].inputs;
  for (const patch of Array.isArray(options.loras) ? options.loras : []) {
    const slot = String(patch?.slot || '');
    if (!/^lora_[1-6]$/.test(slot) || !loraInputs[slot]) continue;
    loraInputs[slot].on = patch.enabled === true || patch.on === true;
    loraInputs[slot].strength = boundedNumber(patch.strength, loraInputs[slot].strength, -4, 4);
  }
  if (options.identity) {
    applyIdentityLora(
      workflow,
      options.identityPreset || resolveIdentity(options.identity),
      options.identity,
      { loraNodeId: COVER_WORKFLOW_NODE_MAP.loras }
    );
  }

  patchSaver(workflow[COVER_WORKFLOW_NODE_MAP.nativeOutput], outputPath, `${jobId}_native`);
  if (options.generateUpscaled === false) {
    delete workflow[COVER_WORKFLOW_NODE_MAP.upscaledOutput];
  } else {
    patchSaver(workflow[COVER_WORKFLOW_NODE_MAP.upscaledOutput], outputPath, `${jobId}_upscaled`);
  }

  return {
    workflow,
    manifest: {
      jobId,
      songSlug,
      seed,
      width,
      height,
      batchSize,
      outputPath,
      generateUpscaled: options.generateUpscaled !== false
    }
  };
}

function patchSaver(node, outputPath, filename) {
  node.inputs.path = outputPath;
  node.inputs.filename = filename;
  node.inputs.counter = 0;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Number(fallback ?? 1);
  return Math.min(max, Math.max(min, number));
}
