import test from 'node:test';
import assert from 'node:assert/strict';
import {HOLD_MINUTES} from '../spendHold.ts';

test('a hold expires rather than standing forever', () => {
  // A guardian who is asleep must not leave someone unable to pay for
  // anything. A hold that never resolves is how people learn to switch
  // protection off, which costs more than the payment it stopped.
  assert.ok(HOLD_MINUTES > 0, 'must have a bound');
  assert.ok(HOLD_MINUTES <= 60, 'an hour is already a long time to be stuck');
});

test('the hold window is long enough for a person to actually respond', () => {
  // Short enough to be usable, long enough that a guardian who is not staring
  // at their phone can still answer.
  assert.ok(HOLD_MINUTES >= 15, 'a guardian needs time to see and decide');
});
