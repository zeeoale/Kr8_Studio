import { Agent, fetch as undiciFetch } from 'undici';

export const DEFAULT_PUBLISH_CONNECT_TIMEOUT_MS = 30_000;

export function createPublishFetch(options = {}) {
  const dispatcher = options.dispatcher || new Agent({
    connect: buildPublishConnectOptions(options)
  });
  const fetchImpl = (url, init = {}) => undiciFetch(url, { ...init, dispatcher });
  fetchImpl.close = () => dispatcher.close();
  return fetchImpl;
}

export function buildPublishConnectOptions(options = {}) {
  return {
    family: Number(options.family || 4),
    autoSelectFamily: false,
    timeout: Math.max(10_000, Number(options.connectTimeoutMs || DEFAULT_PUBLISH_CONNECT_TIMEOUT_MS))
  };
}
