import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PUBLISH_CONNECT_TIMEOUT_MS, buildPublishConnectOptions } from '../src/publish/network.js';

test('Publisher transport allows slow Windows DNS before timing out', () => {
  assert.deepEqual(buildPublishConnectOptions(), {
    family: 4,
    autoSelectFamily: false,
    timeout: DEFAULT_PUBLISH_CONNECT_TIMEOUT_MS
  });
  assert.equal(buildPublishConnectOptions({ connectTimeoutMs: 5_000 }).timeout, 10_000);
});
