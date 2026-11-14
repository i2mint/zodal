#!/usr/bin/env node
/**
 * Every publishable package in this workspace declares a licence and ships it.
 *
 * npm shows a package's licence from the `license` field of its package.json, and
 * downstream apps record it from there (zodal#119: 0.2.0 went out without one).
 * This fails when a non-private `packages/*` package has no `license`, or has no
 * LICENSE file that `npm pack` would include (npm always includes a LICENSE file
 * in the package directory, whatever `files` says).
 *
 * Usage: node scripts/check-licences.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgsDir = join(root, 'packages');
const problems = [];
for (const name of readdirSync(pkgsDir)) {
  const pj = join(pkgsDir, name, 'package.json');
  if (!existsSync(pj)) continue;
  const pkg = JSON.parse(readFileSync(pj, 'utf8'));
  if (pkg.private) continue;
  if (!pkg.license) problems.push(`${pkg.name}: no "license" field in package.json`);
  const files = readdirSync(join(pkgsDir, name));
  if (!files.some((f) => /^licen[cs]e(\.|$)/i.test(f))) problems.push(`${pkg.name}: no LICENSE file in ${join('packages', name)}`);
}
if (problems.length) {
  console.error(`Licence check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Licence check: every publishable package declares and ships its licence.');
