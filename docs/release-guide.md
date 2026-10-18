---
title: Release guide
description: "End-to-end release workflow: npm version commands, preversion/version/postversion lifecycle, GitHub Action build, wiki publishing, and rollback procedures."
author: 🤖 Generated with Claude Code
updated: 2026-10-18
---
# Release guide

> **Warning**
>
> Source of truth: `plugins/local/release-guide.md`. Copied to each plugin's `docs/` during `npm version` via `version-bump.mjs`. Edit the source, not the copy.

## Commands

Stage all source changes:

```bash
git add -A && git commit -m "new release"
```

Bump the version and push everything — source commit, version bump commit, and tag — to GitHub in one go:

```shell
npm version patch
```

```shell
npm version minor
```

```shell
npm version major
```

## What happens under the hood

### Step 1: `preversion` script validates

```json
"preversion": "node version-bump.mjs --preflight"
```

Runs eslint (including `no-console` check for ungated `console.debug`) and auto-updates `eslint-plugin-obsidianmd` if outdated. If anything fails, npm aborts **before touching `package.json`** — no dirty state to clean up.

### Step 2: npm bumps `package.json`

npm updates the `version` field in `package.json` (only runs if preversion succeeded).

### Step 3: `version` script runs

```json
"version": "node version-bump.mjs"
```

`version-bump.mjs` (without `--preflight`) re-validates, then:
- **Pulls latest README** from `origin/main` (so the release ships the GitHub-edited version).
- **Syncs version to `manifest.json`** to match `package.json`.

Then `manifest.json` is staged alongside `package.json`. The `git checkout` also auto-stages `README.md`, so the version commit includes all three files.

### Step 4: npm auto-commits and tags

npm creates a commit and a matching git tag (e.g. `0.8.1`). No `v` prefix — `.npmrc` sets `tag-version-prefix=""`.

### Step 5: `postversion` script pushes

```json
"postversion": "git push origin main --follow-tags"
```

Pushes the commit and tag to GitHub in one go.

### Step 6: GitHub Action builds the release

The tag push triggers `.github/workflows/release.yml`:

1. **Checkout** (full history) → **install** (`npm install`: `npm ci` requires a lockfile, and lockfiles are gitignored).
2. **Gates**, in TS plugins only: **compile CSS** (`npm run css`, so the lint reads the compiled `styles.css`) → **lint** (`npm run lint`) → **typecheck** (`npx tsc --noEmit`) → **test** (`npm test`, in plugins that have tests). A failure stops the release before anything is built. Plugins with a Tests workflow (`test.yml`) run the same checks there, but only on pull requests, so a tag push never triggers it.
3. **Build** (`npm run build`).
4. **Commits anything the build changed** back to `main`, rebased onto the latest `origin/main`. Usually there is nothing to commit: build outputs are gitignored.
5. **Generates release notes** from merged PRs and closed issues since the previous tag.
6. **Attests build provenance** for `main.js`, `manifest.json` and, when the plugin has one, `styles.css`.
7. **Creates a GitHub Release** with `main.js`, `manifest.json` and `styles.css` attached.

## Updating wiki pages

Wiki pages live in a separate Git repo (`{plugin-name}.wiki.git`), not in the main source repo. The local clone is at `wiki/`.

```bash
cd wiki/
git add -A && git commit -m "Update wiki" && git push
```

Wiki changes are independent from releases — push them anytime.

## If something goes wrong

Delete the local tag, undo the version bump commit, and restore the files it changed:

```bash
git tag -d 0.9.0
git reset --soft HEAD~1
git restore --staged --worktree -- $(git diff --cached --name-only)
```

`--soft` leaves the version bump commit's changes staged, and nothing else, since `npm version` refuses to run on a dirty working tree. The `restore` command reverts exactly those files, whichever the bump touched (`package.json`, `manifest.json`, `README.md`, `docs/release-guide.md`, and `versions.json` when it changed), and removes a `versions.json` the bump created. Uncommitted edits to other files survive. Name no files by hand: a listed file a plugin does not track makes `git restore` fail and restore nothing.

If already pushed, also revert the remote changes:

```bash
git push origin :refs/tags/0.9.0        # deletes the remote tag (stops the GitHub Action if not yet triggered)
git push origin main --force             # reverts the version bump commit on main
```

If the GitHub Action already ran, delete the Release manually on GitHub, then force-push again to remove the build commit.
