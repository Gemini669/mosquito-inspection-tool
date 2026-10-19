import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createObservationKey } from '../src/observation-id.js';

test('native record UUID uses the crypto receiver and does not request fallback entropy', () => {
  const api = {
    randomUUID() {
      assert.equal(this, api);
      return 'f1da641a-ccdc-47a0-b14c-a7f4a00d8ea4';
    },
    getRandomValues() {
      assert.fail('Native UUID must not use the fallback');
    },
  };
  assert.equal(createObservationKey(api), 'f1da641a-ccdc-47a0-b14c-a7f4a00d8ea4');
});

test('fallback keeps random bytes while setting UUID v4 version and RFC variant bits', () => {
  const cases = [
    [new Uint8Array(16), '00000000-0000-4000-8000-000000000000'],
    [new Uint8Array(16).fill(255), 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
    [Uint8Array.from({ length: 16 }, (_, i) => i), '00010203-0405-4607-8809-0a0b0c0d0e0f'],
  ];
  for (const [entropy, expected] of cases) {
    let calls = 0;
    const api = {
      getRandomValues(bytes) {
        assert.equal(this, api);
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(bytes.length, 16);
        calls++;
        bytes.set(entropy);
        return bytes;
      },
    };
    assert.equal(createObservationKey(api), expected);
    assert.equal(calls, 1);
  }
});

test('fallback produces independent UUIDs for many observation records', () => {
  const api = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const ids = Array.from({ length: 1000 }, () => createObservationKey(api));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});
