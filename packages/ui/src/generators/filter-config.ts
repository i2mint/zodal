/**
 * Filter Configuration Generator.
 *
 * Produces filter field configs for filter panels.
 * Headless — produces data, not React components.
 */

import { z } from 'zod';
import type { CollectionDefinition, FilterType } from '@zodal/core';
import { getEnumValues, getNumericBounds } from '@zodal/core';

export interface FilterFieldConfig {
  /** Field key. */
  name: string;
  /** Display label. */
  label: string;
  /** Filter UI type. */
  filterType: FilterType;
  /** Options for select/multiselect filters. */
  options?: { label: string; value: string }[];
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

    let options: { label: string; value: string }[] | undefined;
    const enumValues = getEnumValues(fieldSchema);
    if (enumValues && (filterType === 'select' || filterType === 'multiSelect')) {
      options = enumValues.map(v => ({
        label: v.charAt(0).toUpperCase() + v.slice(1),
        value: v,
      }));
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
