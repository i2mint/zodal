/**
 * @zodal/ui/node — Node.js-only utilities (file I/O, code generation to disk).
 *
 * Import from '@zodal/ui/node', never from '@zodal/ui', so browser bundles
 * are not polluted with `node:fs/promises`.
 */

import type { CollectionDefinition } from '@zodal/core';
import { toCode } from './codegen.js';
import type { CodegenOptions, WriteResult } from './codegen.js';

export type { CodegenOptions, WriteResult };

/**
 * Write content to a file only if it differs from the existing content.
 */
export async function writeIfChanged(filePath: string, content: string): Promise<WriteResult> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    if (existing === content) {
      return { written: false, reason: 'unchanged', filePath };
    }
    await fs.writeFile(filePath, content, 'utf-8');
    return { written: true, reason: 'updated', filePath };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { written: true, reason: 'created', filePath };
    }
    throw err;
  }
}

/**
 * Generate collection config code and write it only if the content changed.
 */
export async function generateAndWrite(
  collection: CollectionDefinition<any>,
  filePath: string,
  options?: CodegenOptions,
): Promise<WriteResult> {
  const code = toCode(collection, options);
  return writeIfChanged(filePath, code);
}
