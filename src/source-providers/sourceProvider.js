export const SOURCE_CAPABILITIES = Object.freeze({
  audio: 'audio',
  cover: 'cover',
  lyrics: 'lyrics',
  timedLyrics: 'timedLyrics',
  sections: 'sections',
  metadata: 'metadata',
  stems: 'stems'
});

export function createProviderDescriptor(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('SourceProvider must be an object.');
  }
  if (typeof provider.id !== 'string' || !provider.id) {
    throw new Error('SourceProvider.id must be a non-empty string.');
  }
  if (!Array.isArray(provider.capabilities)) {
    throw new Error(`SourceProvider(${provider.id}).capabilities must be an array.`);
  }
  if (typeof provider.resolve !== 'function') {
    throw new Error(`SourceProvider(${provider.id}).resolve must be a function.`);
  }
  return {
    id: provider.id,
    name: provider.name || provider.id,
    capabilities: [...provider.capabilities],
    status: provider.status || 'available'
  };
}

export function assertResolvedSource(source) {
  if (!source || typeof source !== 'object') {
    throw new Error('Resolved source must be an object.');
  }
  if (!source.providerId) {
    throw new Error('Resolved source requires providerId.');
  }
  if (!source.title) {
    throw new Error('Resolved source requires title.');
  }
  return source;
}
