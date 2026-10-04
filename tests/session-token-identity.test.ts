import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionId, matchesSessionTokenIdentity } from '../lib/server/session-service';

test('requires official USDG on Arbitrum Sepolia and the labeled fixture on Anvil', () => {
  assert.equal(matchesSessionTokenIdentity(421614, 'USDG', 6), true);
  assert.equal(matchesSessionTokenIdentity(421614, 'MockUSDG', 6), false);
  assert.equal(matchesSessionTokenIdentity(31337, 'MockUSDG', 6), true);
  assert.equal(matchesSessionTokenIdentity(31337, 'USDG', 6), false);
  assert.equal(matchesSessionTokenIdentity(31338, 'MockUSDG', 6), false);
  assert.equal(matchesSessionTokenIdentity(31337, 'MockUSDG', 18), false);
});

test('generates unique bytes32 IDs for Router sessions', () => {
  const first = createSessionId();
  const second = createSessionId();
  assert.match(first, /^0x[\da-f]{64}$/i);
  assert.notEqual(first, second);
});
