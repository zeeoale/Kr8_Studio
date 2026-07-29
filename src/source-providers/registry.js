import { ACE_STEP_PROVIDER } from './aceStepProvider.js';
import { LOCAL_FILES_PROVIDER } from './localFilesProvider.js';
import { TK_MUSIC_PROVIDER } from './tkMusicProvider.js';
import { YOUTUBE_PROVIDER } from './youtubeProvider.js';
import { createProviderDescriptor } from './sourceProvider.js';

export const SOURCE_PROVIDERS = [
  TK_MUSIC_PROVIDER,
  LOCAL_FILES_PROVIDER,
  ACE_STEP_PROVIDER,
  YOUTUBE_PROVIDER
];

export function listSourceProviders() {
  return SOURCE_PROVIDERS.map(createProviderDescriptor);
}

export function getSourceProvider(providerId) {
  const provider = SOURCE_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`Unknown source provider: ${providerId}`);
  }
  return provider;
}
