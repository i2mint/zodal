# zodal workspace router

These files are the agent guide for the **workspace folder that holds zodal and its sibling repos side by side** (`zodal/`, `zodal-store-*/`, `zodal-ui-*/`, `zodal-groups/`, `zodal-dials/`, `zodal-graphs/`, `polytag/`). That folder is not itself a repository, so the guide is versioned here and linked into place.

| File here | Linked as (in the workspace folder) | Loaded when |
|---|---|---|
| `CLAUDE.md` | `.claude/CLAUDE.md` | an agent session starts anywhere under the workspace folder |
| `rules/cross-package.md` | `.claude/rules/cross-package.md` | same |
| `skills/zodal-ecosystem/` | `.claude/skills/zodal-ecosystem` (and optionally `~/.claude/skills/zodal-ecosystem`) | the skill is listed by name |

Install, from the workspace folder (the parent of this repo):

```bash
mkdir -p .claude/rules .claude/skills
ln -sfn ../zodal/workspace/CLAUDE.md .claude/CLAUDE.md
ln -sfn ../../zodal/workspace/rules/cross-package.md .claude/rules/cross-package.md
ln -sfn ../../zodal/workspace/skills/zodal-ecosystem .claude/skills/zodal-ecosystem
```

Edit the files here, not through the links' targets elsewhere, and land the change like any other.
