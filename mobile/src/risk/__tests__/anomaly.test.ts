import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  amountAnomalyFromRatio, frequencyAnomaly, mean, median, percentile, stdev, timeAnomaly,
} from '../anomaly.ts';
import { ANOMALY_RATIO_CEILING, ANOMALY_RATIO_FLOOR } from '../weights.ts';

describe('descriptive statistics', () => {
  test('median handles odd, even and empty samples', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 3); // rounded midpoint of 2 and 3
    assert.equal(median([]), null);
    assert.equal(median([7]), 7);
  });

  test('percentile matches the type-7 definition used by NumPy', () => {
    // numpy.percentile([1,2,3,4], 50) == 2.5 -> rounded to 3
    assert.equal(percentile([1, 2, 3, 4], 0.5), 3);
    assert.equal(percentile([10, 20, 30, 40, 50], 0), 10);
    assert.equal(percentile([10, 20, 30, 40, 50], 1), 50);
    assert.equal(percentile([], 0.95), null);
    assert.equal(percentile([42], 0.95), 42);
  });

  test('mean and stdev', () => {
    assert.equal(mean([2, 4, 6]), 4);
    assert.equal(mean([]), null);
    assert.equal(stdev([1]), null, 'a single point has no sample deviation');
    assert.equal(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
  });
});

describe('amount anomaly curve', () => {
  test('is zero at and below the documented floor', () => {
    assert.equal(amountAnomalyFromRatio(0.2), 0);
    assert.equal(amountAnomalyFromRatio(1), 0);
    assert.equal(amountAnomalyFromRatio(ANOMALY_RATIO_FLOOR), 0);
  });

  test('saturates at and above the documented ceiling', () => {
    assert.equal(amountAnomalyFromRatio(ANOMALY_RATIO_CEILING), 1);
    assert.equal(amountAnomalyFromRatio(500), 1);
  });

  test('is monotonically increasing in between', () => {
    let prev = -1;
    for (let r = 1.5; r <= 10; r += 0.25) {
      const v = amountAnomalyFromRatio(r);
      assert.ok(v >= prev, `not monotonic at ratio ${r}`);
      prev = v;
    }
  });

  test('is log-shaped: early growth outpaces late growth', () => {
    const early = amountAnomalyFromRatio(3) - amountAnomalyFromRatio(2);
    const late = amountAnomalyFromRatio(9) - amountAnomalyFromRatio(8);
    assert.ok(early > late, 'the 2x->3x step must matter more than 8x->9x');
  });

  test('refuses to claim anything for null or non-finite input', () => {
    assert.equal(amountAnomalyFromRatio(null), 0);
    assert.equal(amountAnomalyFromRatio(Number.NaN), 0);
    // An infinite ratio means the reference amount was zero -- a data problem,
    // not a real 100% anomaly. The engine declines to score it rather than
    // reporting maximum risk from a division by zero.
    assert.equal(amountAnomalyFromRatio(Number.POSITIVE_INFINITY), 0);
  });
});

describe('frequency anomaly', () => {
  test('a quiet user making three payments in an hour is not flagged', () => {
    assert.equal(frequencyAnomaly(3, 0.05), 0);
  });
  test('a burst well beyond the personal baseline is flagged', () => {
    assert.ok(frequencyAnomaly(12, 0.05) > 0);
  });
  test('a genuinely busy user tolerates more', () => {
    assert.ok(frequencyAnomaly(8, 0.05) > frequencyAnomaly(8, 3));
  });
});

describe('time anomaly', () => {
  const daytime = (() => {
    const h = new Array(24).fill(0);
    for (const hour of [9, 10, 11, 12, 13, 18, 19, 20]) h[hour] = 5;
    return h;
  })();

  test('an unheard-of hour is anomalous', () => {
    assert.ok(timeAnomaly(daytime, 3) > 0.5);
  });
  test('a normal hour is not', () => {
    assert.equal(timeAnomaly(daytime, 19), 0);
  });
  test('an under-sampled histogram claims nothing', () => {
    const sparse = new Array(24).fill(0);
    sparse[10] = 3;
    assert.equal(timeAnomaly(sparse, 3), 0);
  });
  test('a malformed histogram claims nothing', () => {
    assert.equal(timeAnomaly([1, 2, 3], 3), 0);
  });
  test('hours wrap around midnight', () => {
    const night = new Array(24).fill(0);
    night[23] = 20; night[0] = 20; night[1] = 20;
    assert.equal(timeAnomaly(night, 0), 0);
  });
});
