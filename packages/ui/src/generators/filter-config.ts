/**
 * Filter Configuration Generator.
 *
 * Produces filter field configs for filter panels.
 * Headless — produces data, not React components.
 */

import { z } from 'zod';
import type { CollectionDefinition, FilterType } from '@zodal/core';
import { getVocabularyEntries, getNumericBounds } from '@zodal/core';
import { toOption, type VocabularyOption } from './form-config.js';

export interface FilterFieldConfig {
  /** Field key. */
  name: string;
  /** Display label. */
  label: string;
  /** Filter UI type. */
  filterType: FilterType;
  /** Options for select/multiselect filters (and `contains` on a collection field with a closed vocabulary). */
  options?: VocabularyOption[];
  /** Numeric bounds for range filters. */
  bounds?: { min?: number; max?: number };
  /**
   * For a range filter: the data's quantiles, non-decreasing and finite. `quantiles[i]` is the
   * value at percentile `100 * i / (quantiles.length - 1)` (101 values: whole percentiles), so a
   * slider can lay its track out by the data. Filled by `toFilterConfig(c, { data })`, or by the app.
   */
  quantiles?: number[];
  /** Zod type. */
  zodType: string;
}

/** Options of {@link toFilterConfig}. */
export interface FilterConfigOptions {
  /** Rows in memory: each range filter gets the `quantiles` of its field's numeric values. */
  data?: Iterable<Record<string, unknown>>;
  /** How many intervals the quantiles split the data into (`quantileCount + 1` values). Default 100: whole percentiles. */
  quantileCount?: number;
}

/**
 * `count + 1` quantiles of `values` (linear interpolation between order statistics; NaN and
 * infinities ignored), non-decreasing: `result[i]` is the value at percentile `100 * i / count`.
 * Empty when no value is finite. Throws when `count` is not a whole number >= 1.
 */
export function quantilesOf(values: Iterable<number>, count = 100): number[] {
  if (!(Number.isInteger(count) && count >= 1)) throw new Error('quantilesOf needs a whole count >= 1');
  const sorted = Array.from(values).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!sorted.length) return [];
  return Array.from({ length: count + 1 }, (_, i) => {
    const x = (i / count) * (sorted.length - 1);
    const j = Math.floor(x);
    return j + 1 < sorted.length ? sorted[j] + (x - j) * (sorted[j + 1] - sorted[j]) : sorted[j];
  });
}

/**
 * Generate filter field configurations for the filter panel.
 * With `data`, range filters also carry the data's `quantiles` (for a percentile-scaled slider).
 */
export function toFilterConfig<T extends z.ZodObject<any>>(
  collection: CollectionDefinition<T>,
  { data, quantileCount = 100 }: FilterConfigOptions = {},
): FilterFieldConfig[] {
  const filters: FilterFieldConfig[] = [];
  const rows = data ? Array.from(data) : undefined;
  const quantilesFor = (key: string): number[] | undefined => {
    if (!rows) return undefined;
    const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number');
    const q = quantilesOf(values, quantileCount);
    return q.length ? q : undefined;
  };
  const shape = collection.schema.shape as Record<string, z.ZodType>;

  const filterableFields = collection.getFilterableFields();

  for (const { key, affordance } of filterableFields) {
    const fieldSchema = shape[key];
    if (!fieldSchema) continue;

    const filterType = typeof affordance.filterable === 'string'
      ? affordance.filterable
      : 'search';

    // A closed vocabulary gives the filter its choices. For `contains`, only on a
    // collection field (array/set: element membership); on a string, `contains`
    // is a substring match and exact-value choices would mislead.
    let options: VocabularyOption[] | undefined;
    const vocabulary = getVocabularyEntries(fieldSchema);
    const isCollection = affordance.zodType === 'array' || affordance.zodType === 'set';
    if (vocabulary && (filterType === 'select' || filterType === 'multiSelect' || ((filterType === 'contains' || filterType === 'containsAll') && isCollection))) {
      options = vocabulary.map(toOption);
    }

    let bounds: { min?: number; max?: number } | undefined;
    let quantiles: number[] | undefined;
    if (filterType === 'range') {
      bounds = getNumericBounds(fieldSchema);
      quantiles = quantilesFor(key);
    }

    filters.push({
      name: key,
      label: affordance.title ?? key,
      filterType,
      options,
      bounds,
      ...(quantiles ? { quantiles } : {}),
      zodType: collection.fieldAffordances[key].zodType,
    });
  }

  return filters;
}
