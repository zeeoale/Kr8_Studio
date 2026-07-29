import { SOURCE_CAPABILITIES } from './sourceProvider.js';

export const YOUTUBE_PROVIDER = {
  id: 'youtube',
  name: 'YouTube',
  status: 'planned-authorized-only',
  capabilities: [
    SOURCE_CAPABILITIES.audio,
    SOURCE_CAPABILITIES.cover,
    SOURCE_CAPABILITIES.metadata
  ],
  async resolve() {
    throw new Error('YouTubeProvider is a documented placeholder for authorized user-provided flows only.');
  }
};
