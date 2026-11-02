/**
 * Filter Configuration Generator.
 *
 * Produces filter field configs for filter panels.
 * Headless — produces data, not React components.
 */

import { z } from 'zod';
import type { CollectionDefinition, FilterType } from '@zodal/core';
import { getNumericBounds } from '@zodal/core';
import { fieldOptions, NUMERIC_TYPES, type VocabularyOption } from './form-config.js';
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
   * slider can lay its track out by the data. A date field's quantiles are epoch milliseconds:
   * `new Date(q)` is the date at that percentile, and a renderer must write a date filter's
   * value back as `new Date(ms)`, not as the number.
   * Filled by `toFilterConfig(c, { data })`, or by the app.
   */
  quantiles?: number[];
  /** Zod type. */
  zodType: string;
}

/** Options of {@link toFilterConfig}. */
export interface FilterConfigOptions {
  /**
   * Rows in memory, decoded (as the schema's output: dates as `Date`s): each range filter on a
   * number field gets the `quantiles` of its numbers, and on a date field of its dates (epoch
   * milliseconds). Other types (bigints, strings) get none, and a value of another type than
   * its field's (an encoded ISO string) is skipped, as are rows that are not objects. Read once,
   * so a one-shot iterable works.
   */
  data?: Iterable<object | null | undefined>;
  /** How many intervals the quantiles split the data into (`quantileCount + 1` values). Default 100: whole percentiles. */
  quantileCount?: number;
}

/**
 * How a range filter of this Zod type reads a value onto its scale: a number field's numbers
 * as themselves, a date field's dates as epoch milliseconds (an invalid one is NaN, which
 * `quantilesOf` ignores); `undefined` for any other type. Decided by the field's type, not the
 * value's, so one field's quantiles are always in one unit.
 */
function rangeScaleOf(zodType: string): ((value: unknown) => number | undefined) | undefined {
  if (NUMERIC_TYPES.has(zodType)) return (v) => (typeof v === 'number' ? v : undefined);
  if (zodType === 'date') return (v) => (isDate(v) ? v.getTime() : undefined);
  return undefined;
}

/** A Date, including one made in another realm (an iframe, a vm context), where `instanceof` fails. */
function isDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
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
  const quantilesFor = (key: string, zodType: string): number[] | undefined => {
    const scale = rangeScaleOf(zodType);
    if (!rows || !scale) return undefined;
    const values = rows.map((r) => scale((r as Record<string, unknown> | null)?.[key])).filter((v): v is number => v !== undefined);
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
    const isCollection = affordance.zodType === 'array' || affordance.zodType === 'set';
    if (filterType === 'select' || filterType === 'multiSelect' || ((filterType === 'contains' || filterType === 'containsAll') && isCollection)) {
      options = fieldOptions(fieldSchema, affordance);
    }

    let bounds: { min?: number; max?: number } | undefined;
    let quantiles: number[] | undefined;
    if (filterType === 'range') {
      bounds = getNumericBounds(fieldSchema);
      quantiles = quantilesFor(key, affordance.zodType);
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
