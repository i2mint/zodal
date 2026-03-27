/**
 * AI Prompt Generator: Produce machine-readable descriptions of collections.
 *
 * Follows the json-render `generateCatalogPrompt()` pattern:
 * given a collection definition, produce a structured text that an LLM can
 * consume to understand what UI components to generate, what operations
 * are available, and what constraints exist.
 */

import type { CollectionDefinition, FieldAffordance } from '@zodal/core';

/**
 * Generate an AI-consumable prompt describing a collection's affordances.
 */
export function toPrompt(collection: CollectionDefinition<any>): string {
  const sections: string[] = [];

  // Header
  sections.push('# Collection Definition');
  sections.push('');

  // Identity
  sections.push(`- **ID field**: \`${collection.idField}\``);
  sections.push(`- **Label field**: \`${collection.labelField}\``);
  sections.push(`- **Total fields**: ${Object.keys(collection.fieldAffordances).length}`);
  sections.push('');

  // Data Shape
  sections.push('## Data Shape');
  sections.push('');
  sections.push('| Field | Type | Sortable | Filterable | Searchable | Editable | Notes |');
  sections.push('|-------|------|----------|------------|------------|----------|-------|');

  for (const [key, fa] of Object.entries(collection.fieldAffordances)) {
    const notes = buildFieldNotes(key, fa, collection);
    sections.push(
      `| \`${key}\` | ${fa.zodType} | ${formatBool(fa.sortable)} | ${formatFilter(fa.filterable)} | ${formatBool(fa.searchable)} | ${formatBool(fa.editable)} | ${notes} |`,
    );
  }
  sections.push('');

  // Collection Capabilities
  sections.push('## Collection Capabilities');
  sections.push('');

  const aff = collection.affordances;
  const capabilities: string[] = [];

  if (aff.create) capabilities.push('Create new items');
  if (aff.read !== false) capabilities.push('Read/view items');
  if (aff.update !== false) capabilities.push('Update existing items');
  if (aff.delete) capabilities.push('Delete items');
  if (aff.bulkDelete) capabilities.push('Bulk delete selected items');
  if (aff.bulkEdit) capabilities.push('Bulk edit selected items');
  if (aff.search) capabilities.push('Full-text search across searchable fields');
  if (aff.pagination) capabilities.push(`Pagination (${describePagination(aff.pagination)})`);
  if (aff.multiSort) capabilities.push('Multi-column sorting');
  if (aff.filterPanel) capabilities.push('Filter panel');
  if (aff.groupBy) capabilities.push('Group by field');
  if (aff.export) capabilities.push(`Export (${Array.isArray(aff.export) ? aff.export.join(', ') : 'all formats'})`);
  if (aff.selectable) capabilities.push(`Row selection (${aff.selectable === true ? 'multi' : aff.selectable})`);
  if (aff.columnVisibility) capabilities.push('Toggle column visibility');
  if (aff.columnOrder) capabilities.push('Reorder columns');
  if (aff.refresh) capabilities.push('Manual refresh');

  for (const cap of capabilities) {
    sections.push(`- ${cap}`);
  }
  sections.push('');

  // Default sort
  if ((aff as any).defaultSort) {
    const ds = (aff as any).defaultSort;
    sections.push(`**Default sort**: \`${ds.field}\` ${ds.direction}`);
    sections.push('');
  }

  // Search fields
  const searchable = collection.getSearchableFields();
  if (searchable.length > 0) {
    sections.push(`**Searchable fields**: ${searchable.map(f => `\`${f}\``).join(', ')}`);
    sections.push('');
  }

  // Filterable fields detail
  const filterable = collection.getFilterableFields();
  if (filterable.length > 0) {
    sections.push('## Filter Configuration');
    sections.push('');
    for (const { key, affordance } of filterable) {
      const filterType = typeof affordance.filterable === 'string' ? affordance.filterable : 'text';
      let detail = `- \`${key}\` (${filterType})`;
      if (filterType === 'select' || filterType === 'multiSelect') {
        const fa = collection.fieldAffordances[key];
        if (fa.zodType === 'enum') {
          detail += ` — enum field`;
        }
      }
      if (filterType === 'range') {
        detail += ` — numeric/date range`;
      }
      sections.push(detail);
    }
    sections.push('');
  }

  // Custom operations
  if (collection.operations.length > 0) {
    sections.push('## Custom Operations');
    sections.push('');
    sections.push('| Name | Label | Scope | Confirm | Variant |');
    sections.push('|------|-------|-------|---------|---------|');

    for (const op of collection.operations) {
      sections.push(
        `| \`${op.name}\` | ${op.label} | ${op.scope} | ${op.confirm ? 'yes' : 'no'} | ${op.variant ?? 'default'} |`,
      );
    }
    sections.push('');
  }

  // Views
  if ((aff as any).views && (aff as any).views.length > 1) {
    sections.push(`**Available views**: ${(aff as any).views.join(', ')}`);
    sections.push(`**Default view**: ${aff.defaultView ?? 'table'}`);
    sections.push('');
  }

  // UI Generation hints
  sections.push('## UI Generation Hints');
  sections.push('');
  sections.push('When generating a UI for this collection:');

  const hints: string[] = [];

  const visibleFields = collection.getVisibleFields();
  hints.push(`Show these fields in the table: ${visibleFields.map(f => `\`${f}\``).join(', ')}`);

  const groupable = collection.getGroupableFields();
  if (groupable.length > 0) {
    hints.push(`Fields suitable for grouping: ${groupable.map(f => `\`${f.key}\``).join(', ')}`);
  }

  // Fields with badges
  const badgeFields = Object.entries(collection.fieldAffordances)
    .filter(([_, fa]) => fa.badge)
    .map(([key]) => key);
  if (badgeFields.length > 0) {
    hints.push(`Render as badges: ${badgeFields.map(f => `\`${f}\``).join(', ')}`);
  }

  // Inline editable fields
  const inlineEditable = Object.entries(collection.fieldAffordances)
    .filter(([_, fa]) => fa.inlineEditable)
    .map(([key]) => key);
  if (inlineEditable.length > 0) {
    hints.push(`Inline-editable in table view: ${inlineEditable.map(f => `\`${f}\``).join(', ')}`);
  }

  // Summary fields
  const summaryFields = Object.entries(collection.fieldAffordances)
    .filter(([_, fa]) => fa.summaryField)
    .map(([key]) => key);
  if (summaryFields.length > 0) {
    hints.push(`Summary/title fields: ${summaryFields.map(f => `\`${f}\``).join(', ')}`);
  }

  // Detail-only fields
  const detailOnly = Object.entries(collection.fieldAffordances)
    .filter(([_, fa]) => fa.detailOnly)
    .map(([key]) => key);
  if (detailOnly.length > 0) {
    hints.push(`Show only in detail view: ${detailOnly.map(f => `\`${f}\``).join(', ')}`);
  }

  for (const hint of hints) {
    sections.push(`- ${hint}`);
  }

  return sections.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

function formatBool(value: unknown): string {
  if (value === true || value === 'both' || value === 'asc' || value === 'desc') return 'yes';
  if (value === false || value === 'none') return 'no';
  return String(value ?? 'no');
}

function formatFilter(value: unknown): string {
  if (value === false) return 'no';
  if (value === true) return 'yes';
  if (typeof value === 'string') return value;
  return 'no';
}

function buildFieldNotes(
  key: string,
  fa: FieldAffordance & { title: string; zodType: string },
  collection: CollectionDefinition<any>,
): string {
  const notes: string[] = [];
  if (key === collection.idField) notes.push('ID');
  if (key === collection.labelField) notes.push('Label');
  if (fa.summaryField) notes.push('Summary');
  if (fa.hidden) notes.push('Hidden');
  if (fa.visible === false) notes.push('Not visible');
  if (fa.detailOnly) notes.push('Detail only');
  if (fa.groupable) notes.push('Groupable');
  if (fa.inlineEditable) notes.push('Inline edit');
  if (fa.badge) notes.push('Badge');
  if (fa.copyable) notes.push('Copyable');
  if (fa.truncate) notes.push(`Truncate@${fa.truncate}`);
  if (fa.editWidget && fa.editWidget !== 'text') notes.push(`Widget: ${fa.editWidget}`);
  return notes.join(', ');
}

function describePagination(pagination: unknown): string {
  if (typeof pagination === 'boolean') return 'enabled';
  if (typeof pagination === 'object' && pagination !== null) {
    const p = pagination as any;
    const parts: string[] = [];
    if (p.defaultPageSize) parts.push(`${p.defaultPageSize}/page`);
    if (p.style) parts.push(p.style);
    if (p.serverSide) parts.push('server-side');
    return parts.join(', ') || 'enabled';
  }
  return 'enabled';
}
