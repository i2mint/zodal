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
import { quantilesOf } from '../stats.js';

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
  /**
   * Rows in memory: each range filter gets the `quantiles` of its field's values that are
   * numbers (dates, bigints and strings are skipped, so such a field gets none; rows that
   * are not objects are skipped). Read once, so a one-shot iterable works.
   */
  data?: Iterable<object | null | undefined>;
  /** How many intervals the quantiles split the data into (`quantileCount + 1` values). Default 100: whole percentiles. */
  quantileCount?: number;
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
    const values = rows.map((r) => (r as Record<string, unknown> | null)?.[key]).filter((v): v is number => typeof v === 'number');
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
