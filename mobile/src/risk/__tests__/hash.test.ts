import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { hashPayee, sha256Hex } from '../hash.ts';

describe('sha256', () => {
  test('matches the published FIPS 180-4 test vectors', () => {
    assert.equal(sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  test('agrees with node:crypto across lengths, including block boundaries', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 5000]) {
      const input = 'x'.repeat(n);
      assert.equal(sha256Hex(input), createHash('sha256').update(input).digest('hex'),
        `mismatch at length ${n}`);
    }
  });

  test('agrees with node:crypto on multi-byte UTF-8', () => {
    for (const s of ['नमस्ते', 'ravi@okaxis', '₹48,000', 'emoji 🚨 test', 'हिन्दी mixed text']) {
      assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'),
        `mismatch for ${s}`);
    }
  });
});

describe('payee hashing', () => {
  const SALT = 'device-salt-0123456789';

  test('normalises case and whitespace to one identity', () => {
    assert.equal(hashPayee('Ravi@OkAxis', SALT), hashPayee('  ravi@okaxis  ', SALT));
  });

  test('different payees hash differently', () => {
    assert.notEqual(hashPayee('ravi@okaxis', SALT), hashPayee('rav1@okaxis', SALT));
  });

  test('the same payee hashes differently on a different device', () => {
    assert.notEqual(hashPayee('ravi@okaxis', SALT), hashPayee('ravi@okaxis', 'another-salt-98765'));
  });

  test('is 128 bits of hex', () => {
    assert.match(hashPayee('ravi@okaxis', SALT), /^[0-9a-f]{32}$/);
  });

  test('rejects an empty identifier and a weak salt', () => {
    assert.throws(() => hashPayee('   ', SALT), /empty identifier/);
    assert.throws(() => hashPayee('ravi@okaxis', 'short'), /at least 16/);
  });
});
