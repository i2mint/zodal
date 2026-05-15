# Skill: Publish zodal

Bump versions, commit `[publish]`, push, and link to the CI run.

## 1. Read current versions

```bash
node -e "
const pkgs = ['core','store','ui'];
pkgs.forEach(p => {
  const v = require(\`./packages/\${p}/package.json\`).version;
  console.log(\`@zodal/\${p}: \${v}\`);
});
"
```

## 2. Determine the new version(s)

If the user passed an argument to `/publish` (e.g. `/publish minor` or `/publish 0.2.0`), use that directly.

Otherwise ask: **"What version bump?"** with options:
- `patch` (default) — e.g. 0.1.1 → 0.1.2
- `minor` — e.g. 0.1.1 → 0.2.0
- `major` — e.g. 0.1.1 → 1.0.0
- explicit version — same version applied to all packages
- per-package — ask for each package individually

Compute the new version using node arithmetic:

```bash
node -e "
const v = '0.1.1'.split('.').map(Number);
// patch: v[2]++; minor: v[1]++; v[2]=0; major: v[0]++; v[1]=0; v[2]=0;
console.log(v.join('.'));
"
```

All three packages get the same new version unless the user chose per-package.

## 3. Update package.json files

Use the Edit tool to replace the `"version"` value in:
- `packages/core/package.json`
- `packages/store/package.json`
- `packages/ui/package.json`

Show the user a summary of what changed before committing.

## 4. Commit and push

Stage only the three package.json files, then commit:

```bash
git add packages/core/package.json packages/store/package.json packages/ui/package.json
git commit -m "Release v<NEW_VERSION> [publish]"
git push
```

The `[publish]` suffix triggers the CI publish job (see `.github/workflows/ci.yml`).

## 5. Share the Actions run URL

Wait a moment for GitHub to register the push, then get the run:

```bash
sleep 4
gh run list --branch main --limit 1 --json url,status,name -q '.[0] | "\(.name) — \(.url)"'
```

Print the URL so the user can follow the publish job live.

## Notes

- The CI tags the release using `@zodal/core`'s version — keep all packages in sync unless there's a specific reason not to.
- Use `[force publish]` in the commit message to skip npm's already-published guard (only needed when re-publishing an existing version).
- If `git push` is rejected (not on `main` or branch protection), warn the user and do not force-push.
