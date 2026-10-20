/**
 * Every published package carries the repo's licence text (zodal#10).
 *
 * npm packs a LICENSE/NOTICE that sits in the package directory even when
 * `files` lists only `dist`, so each package keeps a copy of the root files;
 * this test keeps the copies from drifting.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');
const packages = readdirSync(path.join(root, 'packages'));
const rootLicense = JSON.parse(read('package.json')).license;

describe.each(packages)('packages/%s', (pkg) => {
  it('declares the root licence', () => {
    expect(JSON.parse(read('packages', pkg, 'package.json')).license).toBe(rootLicense);
  });
  it.each(['LICENSE', 'NOTICE'])('ships a %s identical to the root one', (file) => {
    expect(read('packages', pkg, file)).toBe(read(file));
  });
});
