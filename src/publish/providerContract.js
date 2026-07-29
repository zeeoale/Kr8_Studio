export const PUBLISH_PROVIDER_METHODS = Object.freeze([
  'getConnectionStatus',
  'connect',
  'disconnect',
  'validateMedia',
  'startUpload',
  'cancel',
  'getProgress'
]);

export function assertPublishProvider(name, provider) {
  for (const method of PUBLISH_PROVIDER_METHODS) {
    if (typeof provider?.[method] !== 'function') {
      throw new Error(`Publish provider ${name} is missing ${method}().`);
    }
  }
  return provider;
}
