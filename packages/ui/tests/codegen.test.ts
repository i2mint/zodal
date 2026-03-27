import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toCode, writeIfChanged, generateAndWrite } from '../src/codegen.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ============================================================================
// Test Schemas
// ============================================================================

const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['customer', 'partner', 'lead']),
  isActive: z.boolean().default(true),
  notes: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const SimpleSchema = z.object({
  id: z.string(),
  title: z.string(),
  count: z.number(),
});

// ============================================================================
// toCode — Basic structure
// ============================================================================

describe('toCode', () => {
  const collection = defineCollection(ContactSchema);

  it('generates a string containing TypeScript export', () => {
    const code = toCode(collection);
    expect(code).toContain('export const config: CollectionConfig');
  });

  it('includes import statement by default', () => {
    const code = toCode(collection);
    expect(code).toContain("import type { CollectionConfig } from '@zodal/core';");
  });

  it('includes header comment by default', () => {
    const code = toCode(collection);
    expect(code).toContain('Auto-generated collection configuration.');
    expect(code).toContain('inference engine');
  });

  it('includes field names in the header', () => {
    const code = toCode(collection);
    expect(code).toContain('id, name, email');
  });

  it('includes idField and labelField', () => {
    const code = toCode(collection);
    expect(code).toContain("idField: 'id'");
    expect(code).toContain("labelField: 'name'");
  });

  it('includes collection affordances', () => {
    const code = toCode(collection);
    expect(code).toContain('affordances:');
    expect(code).toContain('create: true');
    expect(code).toContain('pagination:');
  });

  it('includes field affordances for all fields', () => {
    const code = toCode(collection);
    // All schema fields should appear
    expect(code).toContain('id:');
    expect(code).toContain('name:');
    expect(code).toContain('email:');
    expect(code).toContain('role:');
    expect(code).toContain('isActive:');
    expect(code).toContain('createdAt:');
    expect(code).toContain('updatedAt:');
  });

  it('includes inferred field properties', () => {
    const code = toCode(collection);
    // The 'name' field should have summaryField: true (from name heuristic)
    expect(code).toContain('summaryField: true');
    // The 'id' field should have visible: false (from ID heuristic)
    expect(code).toContain('visible: false');
  });

  it('produces deterministic output (no timestamps)', () => {
    const code1 = toCode(collection);
    const code2 = toCode(collection);
    expect(code1).toBe(code2);
  });
});

// ============================================================================
// toCode — Options
// ============================================================================

describe('toCode options', () => {
  const collection = defineCollection(SimpleSchema);

  it('respects header: false', () => {
    const code = toCode(collection, { header: false });
    expect(code).not.toContain('Auto-generated');
    expect(code).not.toContain('/**');
    // Should still have the import and export
    expect(code).toContain('import type');
    expect(code).toContain('export const');
  });

  it('respects imports: false', () => {
    const code = toCode(collection, { imports: false });
    expect(code).not.toContain('import type');
    expect(code).toContain('export const');
  });

  it('respects custom exportName', () => {
    const code = toCode(collection, { exportName: 'contactsConfig' });
    expect(code).toContain('export const contactsConfig: CollectionConfig');
    expect(code).toContain("import { contactsConfig } from './this-file'");
  });

  it('respects custom importFrom', () => {
    const code = toCode(collection, { importFrom: '../src/index.js' });
    expect(code).toContain("import type { CollectionConfig } from '../src/index.js';");
  });

  it('respects indent option', () => {
    const code2 = toCode(collection, { indent: 2, header: false, imports: false });
    const code4 = toCode(collection, { indent: 4, header: false, imports: false });
    // With indent: 4, properties are indented with 4 spaces
    expect(code4).toContain('    idField:');
    // With indent: 2, properties are indented with 2 spaces
    expect(code2).toContain('  idField:');
  });
});

// ============================================================================
// toCode — With operations
// ============================================================================

describe('toCode with operations', () => {
  const collection = defineCollection(SimpleSchema, {
    operations: [
      { name: 'archive', label: 'Archive', scope: 'item', variant: 'destructive', confirm: true },
      { name: 'export', label: 'Export All', scope: 'collection' },
    ],
  });

  it('includes operations array', () => {
    const code = toCode(collection);
    expect(code).toContain('operations:');
    expect(code).toContain("name: 'archive'");
    expect(code).toContain("label: 'Archive'");
    expect(code).toContain("scope: 'item'");
    expect(code).toContain("variant: 'destructive'");
    expect(code).toContain('confirm: true');
  });

  it('includes all operations', () => {
    const code = toCode(collection);
    expect(code).toContain("name: 'export'");
    expect(code).toContain("label: 'Export All'");
    expect(code).toContain("scope: 'collection'");
  });
});

// ============================================================================
// toCode — With config overrides
// ============================================================================

describe('toCode with config overrides', () => {
  const collection = defineCollection(ContactSchema, {
    affordances: { bulkDelete: true, export: ['csv', 'json'] },
    fields: {
      name: { inlineEditable: true, columnWidth: 300 },
      role: { filterable: 'multiSelect' },
    },
  });

  it('includes overridden affordances', () => {
    const code = toCode(collection);
    expect(code).toContain('bulkDelete: true');
  });

  it('includes field overrides merged with inference', () => {
    const code = toCode(collection);
    expect(code).toContain('inlineEditable: true');
    expect(code).toContain('columnWidth: 300');
  });

  it('reflects filterable override for role', () => {
    const code = toCode(collection);
    // role's filterable should be 'multiSelect' (overridden from 'select')
    expect(code).toContain("filterable: 'multiSelect'");
  });
});

// ============================================================================
// toCode — diffOnly mode
// ============================================================================

describe('toCode diffOnly mode', () => {
  it('produces empty fields when no overrides exist', () => {
    const collection = defineCollection(SimpleSchema);
    const code = toCode(collection, { diffOnly: true, header: false, imports: false });
    // With zero config, inference and resolved are identical — no diff
    expect(code).not.toContain('fields:');
  });

  it('includes only overridden field properties', () => {
    const collection = defineCollection(ContactSchema, {
      fields: {
        name: { inlineEditable: true, columnWidth: 300 },
      },
    });
    const code = toCode(collection, { diffOnly: true, header: false, imports: false });
    // Should include the override
    expect(code).toContain('inlineEditable: true');
    expect(code).toContain('columnWidth: 300');
    // Should NOT include properties that match inference (like sortable, searchable)
    // The name field's sortable is 'both' from inference — should be excluded in diff
  });

  it('still includes collection affordances and operations in diffOnly', () => {
    const collection = defineCollection(SimpleSchema, {
      affordances: { bulkDelete: true },
      operations: [{ name: 'test', label: 'Test', scope: 'item' }],
    });
    const code = toCode(collection, { diffOnly: true });
    expect(code).toContain('affordances:');
    expect(code).toContain('operations:');
  });
});

// ============================================================================
// writeIfChanged — File I/O
// ============================================================================

describe('writeIfChanged', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codegen-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a new file when it does not exist', async () => {
    const filePath = path.join(tmpDir, 'new-file.ts');
    const result = await writeIfChanged(filePath, 'const x = 1;');

    expect(result.written).toBe(true);
    expect(result.reason).toBe('created');
    expect(result.filePath).toBe(filePath);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('const x = 1;');
  });

  it('creates parent directories if needed', async () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'dir', 'file.ts');
    const result = await writeIfChanged(filePath, 'hello');

    expect(result.written).toBe(true);
    expect(result.reason).toBe('created');

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('hello');
  });

  it('skips writing when content is unchanged', async () => {
    const filePath = path.join(tmpDir, 'existing.ts');
    const content = 'const x = 42;';
    await fs.writeFile(filePath, content, 'utf-8');

    // Get the mtime before
    const statBefore = await fs.stat(filePath);

    // Small delay to ensure mtime would change if file were written
    await new Promise(r => setTimeout(r, 50));

    const result = await writeIfChanged(filePath, content);

    expect(result.written).toBe(false);
    expect(result.reason).toBe('unchanged');

    // mtime should be unchanged
    const statAfter = await fs.stat(filePath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it('updates the file when content has changed', async () => {
    const filePath = path.join(tmpDir, 'changing.ts');
    await fs.writeFile(filePath, 'old content', 'utf-8');

    const result = await writeIfChanged(filePath, 'new content');

    expect(result.written).toBe(true);
    expect(result.reason).toBe('updated');

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('new content');
  });
});

// ============================================================================
// generateAndWrite — Integration
// ============================================================================

describe('generateAndWrite', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codegen-integration-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates code and writes a new file', async () => {
    const collection = defineCollection(SimpleSchema);
    const filePath = path.join(tmpDir, 'simple.config.ts');

    const result = await generateAndWrite(collection, filePath);

    expect(result.written).toBe(true);
    expect(result.reason).toBe('created');

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('export const config: CollectionConfig');
    expect(content).toContain("idField: 'id'");
  });

  it('skips writing when re-generated code is identical', async () => {
    const collection = defineCollection(SimpleSchema);
    const filePath = path.join(tmpDir, 'stable.config.ts');

    // First write
    const result1 = await generateAndWrite(collection, filePath);
    expect(result1.reason).toBe('created');

    // Second write — same collection, same options → unchanged
    const result2 = await generateAndWrite(collection, filePath);
    expect(result2.written).toBe(false);
    expect(result2.reason).toBe('unchanged');
  });

  it('updates file when collection config changes', async () => {
    const filePath = path.join(tmpDir, 'evolving.config.ts');

    // Write initial version
    const v1 = defineCollection(SimpleSchema);
    await generateAndWrite(v1, filePath);

    // Write updated version with overrides
    const v2 = defineCollection(SimpleSchema, {
      fields: { title: { inlineEditable: true } },
    });
    const result = await generateAndWrite(v2, filePath);

    expect(result.written).toBe(true);
    expect(result.reason).toBe('updated');

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('inlineEditable: true');
  });

  it('passes codegen options through', async () => {
    const collection = defineCollection(SimpleSchema);
    const filePath = path.join(tmpDir, 'custom.config.ts');

    await generateAndWrite(collection, filePath, {
      exportName: 'myConfig',
      header: false,
    });

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('export const myConfig: CollectionConfig');
    expect(content).not.toContain('Auto-generated');
  });
});

// ============================================================================
// Serialization edge cases
// ============================================================================

describe('toCode serialization', () => {
  it('handles string values with special characters', () => {
    const collection = defineCollection(SimpleSchema, {
      fields: { title: { editPlaceholder: "Enter a title (e.g., 'My Project')" } },
    });
    const code = toCode(collection, { header: false, imports: false });
    // The single quote in the placeholder should be escaped
    expect(code).toContain("editPlaceholder: 'Enter a title (e.g., \\'My Project\\')'");
  });

  it('handles array values (aggregatable, pageSizeOptions)', () => {
    const collection = defineCollection(SimpleSchema);
    const code = toCode(collection, { header: false, imports: false });
    // pageSizeOptions should be serialized as an array
    expect(code).toContain('[10, 25, 50, 100]');
  });

  it('handles nested objects (pagination, search config)', () => {
    const collection = defineCollection(SimpleSchema);
    const code = toCode(collection, { header: false, imports: false });
    expect(code).toContain('pagination:');
    expect(code).toContain('defaultPageSize: 25');
  });

  it('handles badge objects (Record<string, string>)', () => {
    const collection = defineCollection(
      z.object({
        id: z.string(),
        status: z.enum(['active', 'inactive']),
      }),
      {
        fields: {
          status: {
            badge: { active: 'success', inactive: 'secondary' },
          },
        },
      },
    );
    const code = toCode(collection, { header: false, imports: false });
    expect(code).toContain("badge: { active: 'success', inactive: 'secondary' }");
  });

  it('handles boolean confirm on operations', () => {
    const collection = defineCollection(SimpleSchema, {
      operations: [{ name: 'delete', label: 'Delete', scope: 'item', confirm: true }],
    });
    const code = toCode(collection, { header: false, imports: false });
    expect(code).toContain('confirm: true');
  });

  it('handles object confirm on operations', () => {
    const collection = defineCollection(SimpleSchema, {
      operations: [{
        name: 'delete',
        label: 'Delete',
        scope: 'item',
        confirm: { title: 'Confirm', message: 'Are you sure?' },
      }],
    });
    const code = toCode(collection, { header: false, imports: false });
    expect(code).toContain("title: 'Confirm'");
    expect(code).toContain("message: 'Are you sure?'");
  });
});
