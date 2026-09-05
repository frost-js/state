import assert from 'node:assert/strict';
import { StateStore } from '../../src/index.js';

const store = StateStore.wrap({ count: 1 });

assert.ok(store instanceof StateStore);
assert.ok(store instanceof Function);
assert.strictEqual(store('count')(), 1);
assert.strictEqual(store(), store);
