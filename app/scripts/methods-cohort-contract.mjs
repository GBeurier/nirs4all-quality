import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertMethodsRuntime } from '../src/engine/methodsCohort.ts';

test('admit the fixed owner release and additive compatible ABI', () => {
  assert.doesNotThrow(() => assertMethodsRuntime('1.3.9+abi.2.20.0', [2, 20, 0]));
  assert.doesNotThrow(() => assertMethodsRuntime('1.4.0', [2, 21, 0]));
});
test('refuse the cached public 1.3.4 / ABI17 cohort', () => {
  assert.throws(() => assertMethodsRuntime('1.3.4+abi.2.17.0', [2, 17, 0]), /requires Methods >=1\.3\.9/);
});
test('a relabeled package cannot hide an older binary ABI', () => {
  assert.throws(() => assertMethodsRuntime('1.3.9', [2, 17, 0]), /ABI/);
});
test('future major versions and unknown identities need explicit qualification', () => {
  for (const [version, abi] of [['2.0.0', [2,20,0]], ['1.3.9', [3,0,0]], ['unknown', [2,20,0]], ['1.3.9', []]]) {
    assert.throws(() => assertMethodsRuntime(version, abi));
  }
});
