/**
 * Small statistics over plain numbers, shared by the generators and by renderers (a slider
 * laid out by percentiles reads {@link quantilesOf}'s output).
 */

/**
 * `count + 1` quantiles of `values` (linear interpolation between order statistics; NaN and
 * infinities ignored), non-decreasing and finite: `result[i]` is the value at percentile
 * `100 * i / count`. Empty when no value is finite. Throws when `count` is not a whole number >= 1.
 */
export function quantilesOf(values: Iterable<number>, count = 100): number[] {
  if (!(Number.isInteger(count) && count >= 1)) throw new Error('quantilesOf needs a whole count >= 1');
  const sorted = Array.from(values).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!sorted.length) return [];
  return Array.from({ length: count + 1 }, (_, i) => {
    const x = (i / count) * (sorted.length - 1);
    const j = Math.floor(x);
    const t = x - j;
    if (t === 0 || j + 1 >= sorted.length) return sorted[j];
    const a = sorted[j];
    const b = sorted[j + 1];
    // a + t * (b - a) is monotone in t; b - a overflows when the data spans more than
    // Number.MAX_VALUE, and then (1 - t) * a + t * b does not. Clamped, so rounding cannot leave [a, b].
    const v = Number.isFinite(b - a) ? a + t * (b - a) : (1 - t) * a + t * b;
    return Math.min(Math.max(v, a), b);
  });
}
