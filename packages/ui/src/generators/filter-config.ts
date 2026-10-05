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
  /** Zod type. */
  zodType: string;
}

/**
 * Generate filter field configurations for the filter panel.
 */
export function toFilterConfig<T extends z.ZodObject<any>>(
  collection: CollectionDefinition<T>,
): FilterFieldConfig[] {
  const filters: FilterFieldConfig[] = [];
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
    if (vocabulary && (filterType === 'select' || filterType === 'multiSelect' || (filterType === 'contains' && isCollection))) {
      options = vocabulary.map(toOption);
    }

    let bounds: { min?: number; max?: number } | undefined;
    if (filterType === 'range') {
      bounds = getNumericBounds(fieldSchema);
    }

    filters.push({
      name: key,
      label: affordance.title ?? key,
      filterType,
      options,
      bounds,
      zodType: collection.fieldAffordances[key].zodType,
    });
  }

  return filters;
}
