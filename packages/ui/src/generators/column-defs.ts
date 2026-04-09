/**
 * Column Definition Generator (TanStack Table compatible).
 *
 * Produces configuration objects that TanStack Table consumes directly.
 * Headless — produces data, not React components.
 */

import { z } from 'zod';
import type { CollectionDefinition, FieldAffordance, FilterType } from '@zodal/core';
import { getEnumValues, getNumericBounds } from '@zodal/core';

/**
 * A framework-agnostic column definition.
 * Structurally compatible with TanStack Table's ColumnDef but framework-independent.
 */
export interface ColumnConfig {
  /** Column identifier (matches field key). */
  id: string;
  /** Display header text. */
  header: string;
  /** Field accessor key. */
  accessorKey?: string;

  // Feature flags (TanStack Table compatible)
  enableSorting: boolean;
  enableColumnFilter: boolean;
  enableGlobalFilter: boolean;
  enableGrouping: boolean;
  enableHiding: boolean;
  enableResizing: boolean;

  // Sizing
  size?: number;
  minSize?: number;
  maxSize?: number;

  // Sort configuration
  sortingFn?: string;
  sortDescFirst?: boolean;

  // Filter configuration
  filterFn?: string;

  // Metadata for renderers
  meta: {
    zodType: string;
    filterType: FilterType | boolean;
    editable: boolean;
    inlineEditable: boolean;
    displayFormat?: string;
    badge?: Record<string, string>;
    copyable?: boolean;
    truncate?: number;
    tooltip?: boolean;
    enumValues?: string[];
    numericBounds?: { min?: number; max?: number };
    pinned?: 'left' | 'right' | false;
    /** Storage role for bifurcation-aware renderers. */
    storageRole?: 'metadata' | 'content';
    /** Whether the cell value may be a ContentRef. */
    isContentRef?: boolean;
  };
}

/** Map Zod type to the appropriate TanStack Table sort function name. */
function inferSortFnName(zodType: string, affordance: FieldAffordance): string {
  switch (zodType) {
    case 'string': return 'text';
    case 'number':
    case 'int':
    case 'float':
    case 'bigint': return 'basic';
    case 'date': return 'datetime';
    case 'boolean': return 'basic';
    case 'enum': return 'text';
    default: return 'basic';
  }
}

/** Map filter type + Zod type to the appropriate TanStack Table filter function name. */
function inferFilterFnName(filterType: FilterType | boolean, zodType: string): string {
  if (typeof filterType === 'boolean') return 'includesString';

  switch (filterType) {
    case 'exact': return 'equalsString';
    case 'search': return 'includesString';
    case 'select': return 'arrIncludes';
    case 'multiSelect': return 'arrIncludesSome';
    case 'range': return 'inNumberRange';
    case 'contains': return 'arrIncludesAll';
    case 'boolean': return 'equals';
    case 'fuzzy': return 'includesString';
    default: return 'includesString';
  }
}

/**
 * Generate column definitions from a CollectionDefinition.
 *
 * @returns An array of ColumnConfig objects compatible with TanStack Table.
 */
export function toColumnDefs<T extends z.ZodObject<any>>(
  collection: CollectionDefinition<T>,
): ColumnConfig[] {
  const columns: ColumnConfig[] = [];
  const shape = collection.schema.shape as Record<string, z.ZodType>;

  // Selection column (if selectable)
  if (collection.affordances.selectable) {
    columns.push({
      id: 'select',
      header: '',
      enableSorting: false,
      enableColumnFilter: false,
      enableGlobalFilter: false,
      enableGrouping: false,
      enableHiding: false,
      enableResizing: false,
      size: 40,
      meta: {
        zodType: 'display',
        filterType: false,
        editable: false,
        inlineEditable: false,
      },
    });
  }

  // Data columns from visible fields
  const visibleFields = collection.getVisibleFields();

  for (const key of visibleFields) {
    const fa = collection.fieldAffordances[key];
    const fieldSchema = shape[key];
    if (!fieldSchema) continue;

    const zodType = fa.zodType;

    columns.push({
      id: key,
      header: fa.title,
      accessorKey: key,
      enableSorting: fa.sortable !== false && fa.sortable !== 'none',
      enableColumnFilter: fa.filterable !== false,
      enableGlobalFilter: fa.searchable ?? false,
      enableGrouping: fa.groupable ?? false,
      enableHiding: !fa.hidden,
      enableResizing: fa.resizable ?? true,
      size: fa.columnWidth,
      minSize: fa.minWidth,
      maxSize: fa.maxWidth,
      sortingFn: inferSortFnName(zodType, fa),
      sortDescFirst: fa.sortable === 'desc',
      filterFn: fa.filterable ? inferFilterFnName(fa.filterable, zodType) : undefined,
      meta: {
        zodType,
        filterType: fa.filterable ?? false,
        editable: fa.editable ?? false,
        inlineEditable: fa.inlineEditable ?? false,
        displayFormat: fa.displayFormat,
        badge: fa.badge,
        copyable: fa.copyable,
        truncate: fa.truncate,
        tooltip: fa.tooltip,
        enumValues: fieldSchema ? getEnumValues(fieldSchema) ?? undefined : undefined,
        numericBounds: fieldSchema ? getNumericBounds(fieldSchema) : undefined,
        pinned: fa.pinned,
        storageRole: fa.storageRole === 'content' ? 'content' : undefined,
        isContentRef: fa.storageRole === 'content' ? true : undefined,
      },
    });
  }

  // Actions column (if there are item-level operations)
  const itemOps = collection.getOperations('item');
  if (itemOps.length > 0) {
    columns.push({
      id: 'actions',
      header: '',
      enableSorting: false,
      enableColumnFilter: false,
      enableGlobalFilter: false,
      enableGrouping: false,
      enableHiding: false,
      enableResizing: false,
      size: 60 + (itemOps.length - 1) * 32,
      meta: {
        zodType: 'display',
        filterType: false,
        editable: false,
        inlineEditable: false,
      },
    });
  }

  return columns;
}
