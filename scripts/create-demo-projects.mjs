import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importAudioAsset } from '../src/assets/audioImport.js';
import { importCoverAsset } from '../src/assets/coverImport.js';
import { createLyricsOverlayLayer } from '../src/lyrics/layer.js';
import { importSrt } from '../src/lyrics-editor/importExport.js';
import { applyLyricsDocument } from '../src/lyrics-editor/storage.js';
import { saveProject } from '../src/project/io.js';
import { createProjectFoundationFromAudio } from '../src/project/createFromAudio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = path.join(root, 'demo');
const examplesRoot = path.join(root, 'examples');

const blankDirectory = path.join(examplesRoot, 'blank.kr8');
assertInsideExamples(blankDirectory);
await rm(blankDirectory, { recursive: true, force: true });
const blankProject = createProjectFoundationFromAudio({
  title: 'Blank Kr8 Project',
  artist: '',
  duration: 180,
  seed: 'public-blank-project',
  formatId: 'landscape-1080p'
});
blankProject.name = 'Blank Kr8 Project';
blankProject.metadata = {
  ...blankProject.metadata,
  title: '',
  artist: '',
  blank: true,
  warnings: ['Import local audio, a cover, and optional lyrics to begin.']
};
await saveProject(blankDirectory, blankProject);
console.log(`Prepared ${path.relative(root, blankDirectory)}`);

const demos = [
  {
    directory: 'kr8-demo-landscape.kr8',
    formatId: 'landscape-1080p',
    cover: '16_9_Demo_Cover.png',
    title: 'Signal Bloom'
  },
  {
    directory: 'kr8-demo-vertical.kr8',
    formatId: 'vertical-1080p',
    cover: '9_16_Demo_Cover.png',
    title: 'Signal Bloom Vertical'
  }
];

for (const demo of demos) {
  const projectDirectory = path.join(examplesRoot, demo.directory);
  assertInsideExamples(projectDirectory);
  await rm(projectDirectory, { recursive: true, force: true });
  await mkdir(projectDirectory, { recursive: true });

  let project = createProjectFoundationFromAudio({
    title: demo.title,
    artist: 'Kr8 Studio Demo',
    duration: 30,
    seed: `public-demo:${demo.formatId}`,
    formatId: demo.formatId
  });

  const audioResult = await importAudioAsset(project, projectDirectory, {
    sourcePath: path.join(demoRoot, 'Demo_Sample_Audio.flac'),
    originalFilename: 'Demo_Sample_Audio.flac',
    title: demo.title,
    artist: 'Kr8 Studio Demo',
    updateProjectMetadata: true
  });
  project = audioResult.project;

  const coverResult = await importCoverAsset(project, projectDirectory, {
    filename: demo.cover,
    data: await readFile(path.join(demoRoot, demo.cover))
  });
  project = bindCoverAsset(coverResult.project, coverResult.asset.id);

  const importedCues = importSrt(await readFile(path.join(demoRoot, 'demo_lyrics.srt'), 'utf8'));
  const lyricsResult = await applyLyricsDocument(project, projectDirectory, {
    kr8LyricsVersion: 1,
    lines: importedCues.map((cue, index) => ({
      id: cue.id,
      index: index + 1,
      startSeconds: cue.start,
      endSeconds: cue.end,
      text: cue.text
    }))
  });
  project = lyricsResult.project;

  const highestOrder = Math.max(0, ...project.layers.map((layer) => Number(layer.order || 0)));
  project.layers = [
    ...project.layers,
    createLyricsOverlayLayer({
      composition: project.composition,
      end: project.composition.duration,
      order: highestOrder + 1
    })
  ];
  project.name = `${demo.title} - Kr8 Demo`;
  project.metadata = {
    ...project.metadata,
    title: demo.title,
    artist: 'Kr8 Studio Demo',
    demo: true,
    assetTerms: 'See ASSET-LICENSE.md in the repository root.',
    warnings: []
  };
  project.updatedAt = new Date().toISOString();
  await saveProject(projectDirectory, project);
  console.log(`Prepared ${path.relative(root, projectDirectory)}`);
}

function bindCoverAsset(project, assetId) {
  const width = Number(project.composition?.width) || 1920;
  const height = Number(project.composition?.height) || 1080;

  return {
    ...project,
    assets: project.assets.filter((asset) =>
      !(asset.type === 'image' && asset.role === 'cover' && asset.missing)
    ),
    layers: project.layers.map((layer) => {
      if (layer.type !== 'image' || !/cover/i.test(String(layer.name || ''))) return layer;
      return {
        ...layer,
        transform: {
          ...(layer.transform || {}),
          x: width / 2,
          y: height / 2,
          width,
          height,
          scaleX: 1,
          scaleY: 1
        },
        properties: {
          ...(layer.properties || {}),
          assetId,
          fit: 'cover'
        }
      };
    })
  };
}

function assertInsideExamples(candidate) {
  const relative = path.relative(examplesRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe demo path: ${candidate}`);
  }
}
