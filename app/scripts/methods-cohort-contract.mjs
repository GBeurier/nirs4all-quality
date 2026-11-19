import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertMethodsRuntime } from '../src/engine/methodsCohort.ts';

test('admit the selected owner series and compatible patches', () => {
  assert.doesNotThrow(() => assertMethodsRuntime('1.5.0+abi.2.24.0', [2, 24, 0]));
  assert.doesNotThrow(() => assertMethodsRuntime('1.5.1', [2, 24, 0]));
});
test('refuse earlier public cohorts outside the qualified delivery floor', () => {
  assert.throws(() => assertMethodsRuntime('1.3.15+abi.2.22.0', [2, 22, 0]), /requires Methods >=1\.5\.0/);
  assert.throws(() => assertMethodsRuntime('1.4.1+abi.2.24.0', [2, 24, 0]), /requires Methods >=1\.5\.0/);
});
test('a relabeled package cannot hide an older binary ABI', () => {
  assert.throws(() => assertMethodsRuntime('1.5.0', [2, 22, 0]), /ABI/);
  assert.throws(() => assertMethodsRuntime('1.5.0', [2, 23, 0]), /ABI/);
});
test('unqualified minor or major series and unknown identities are refused', () => {
  for (const [version, abi] of [['1.6.0', [2,24,0]], ['2.0.0', [2,24,0]], ['1.5.0', [3,0,0]], ['unknown', [2,24,0]], ['1.5.0', []]]) {
    assert.throws(() => assertMethodsRuntime(version, abi));
  }
});
