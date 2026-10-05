#!/usr/bin/env node
/**
 * Would releasing this repo's @zodal/core, /store and /ui orphan a published
 * satellite?
 *
 * Every other @zodal package (store adapters, renderers, dials, groups, ...)
 * declares these three as peer dependencies. When a release moves them to a
 * version a satellite's peer range excludes (a caret on 0.x: `^0.1.0` means
 * `<0.2.0`), every app that installs both hits ERESOLVE. Nothing in this repo's
 * own tests can see that, because the satellites live in other repositories.
 *
 * For every published @zodal package, this compares each core-package peer range
 * against two versions: the one npm serves now, and the one in this checkout.
 *
 *   newly excluded    the published version satisfies the range, this one does not
 *                     -> ERROR: releasing would break that satellite
 *   already excluded  neither satisfies it (the satellite is already broken)
 *                     -> warning; an error with --strict
 *
 * Exit code 1 on any error. Network: the npm registry (search + one GET per package).
 *
 * Usage: node scripts/check-satellite-peers.mjs [--strict] [--json]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import semver from 'semver';

const REGISTRY = 'https://registry.npmjs.org';
const CORE = ['core', 'store', 'ui'];
const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const asJson = args.has('--json');

const localVersion = (pkg) =>
  JSON.parse(readFileSync(join(here, '..', 'packages', pkg, 'package.json'), 'utf8')).version;

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`GET ${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Registry search (`text=@zodal`) lists the scope. Its index can lag a brand-new
// package by a while; such a package has no satellites depending on it yet.
async function publishedZodalPackages() {
  const found = await getJson(`${REGISTRY}/-/v1/search?text=${encodeURIComponent('@zodal')}&size=250`);
  return (found?.objects ?? [])
    .map((o) => o.package.name)
    .filter((name) => name.startsWith('@zodal/') && !CORE.includes(name.slice('@zodal/'.length)));
}

async function main() {
  const local = Object.fromEntries(CORE.map((p) => [`@zodal/${p}`, localVersion(p)]));
  const published = {};
  for (const name of Object.keys(local)) {
    published[name] = (await getJson(`${REGISTRY}/${name}/latest`))?.version ?? null;
  }

  const rows = [];
  for (const name of await publishedZodalPackages()) {
    const latest = await getJson(`${REGISTRY}/${name.replace('/', '%2f')}/latest`);
    if (!latest) continue;
    for (const [peer, range] of Object.entries(latest.peerDependencies ?? {})) {
      if (!(peer in local)) continue;
      const okLocal = semver.satisfies(local[peer], range, { includePrerelease: true });
      const okPublished =
        published[peer] != null && semver.satisfies(published[peer], range, { includePrerelease: true });
      const status = okLocal ? 'ok' : okPublished ? 'newly-excluded' : 'already-excluded';
      rows.push({ satellite: `${name}@${latest.version}`, peer, range, local: local[peer], published: published[peer], status });
    }
  }

  const errors = rows.filter((r) => r.status === 'newly-excluded' || (strict && r.status === 'already-excluded'));
  if (asJson) {
    console.log(JSON.stringify({ local, published, rows, errors: errors.length }, null, 2));
  } else {
    console.log(`this checkout: ${CORE.map((p) => `@zodal/${p}@${local[`@zodal/${p}`]}`).join(', ')}`);
    for (const r of rows.filter((x) => x.status !== 'ok')) {
      const tag = r.status === 'newly-excluded' || strict ? 'ERROR' : 'warning';
      console.log(`${tag}: ${r.satellite} peers ${r.peer}@"${r.range}" — excludes ${r.local}` +
        (r.status === 'newly-excluded' ? ` (accepts the published ${r.published}: this release would break it)` : ' (already excluded the published version too)'));
    }
    console.log(`${rows.filter((x) => x.status === 'ok').length}/${rows.length} satellite peer ranges accept this checkout's versions`);
  }
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`check-satellite-peers: ${err.message}`);
  process.exit(2);
});
