# Public-repo sync readiness for `PerryLink/dsh-famling` (MB-004)

> Companion to [`INDEPENDENT-REBUILD-2026-11-20.md`](./INDEPENDENT-REBUILD-2026-11-20.md).
> This document is the staging plan for moving the plugin source from the
> private workspace (`plugins/dsh-famling`) into its public repository. It
> records what is ready, what CI should run, and what was deliberately **not**
> executed here (no `git init`/commit/push in this task).

## 1. Target and current metadata

| Item | Value | Enforced by |
|---|---|---|
| Target repository | `https://github.com/PerryLink/dsh-famling` | `scripts/check-package.mjs` `CANONICAL` |
| `repository` | `git+https://github.com/PerryLink/dsh-famling.git` | `metadataProblems` |
| `homepage` | `https://github.com/PerryLink/dsh-famling#readme` | `metadataProblems` |
| `bugs` | `https://github.com/PerryLink/dsh-famling/issues` | `metadataProblems` |
| License | PolyForm-Noncommercial-1.0.0 (`LICENSE`), art CC BY-NC-SA 4.0 (`LICENSE-ART`) | `metadataProblems` / docs |
| npm package | `dsh-famling` @ `0.10.12`, `private: false`, real release metadata | `check-package` |
| Install LOCK | `package-lock.json` (lockfileVersion 3, zero dependencies) | `check-package` + clean checkout |
| Art lock | `scripts/spec/anim-spec.json` (SHA-256 manifest, no art bytes) | `embed-anims --check` |

The plugin directory is **not** a git repository in this workspace, and this
task does not create one. The public-repo export is staged into a directory;
the first commit/push is an external step for the repo owner.

## 2. What is ready

- [x] `package-lock.json` committed + validated by the release gate.
- [x] `scripts/spec/anim-spec.json` vendored semantic spec + SHA-256 LOCK, so
      `embed-anims --check` / `verify-anims` work with no private checkout.
- [x] `scripts/clean-checkout.mjs` proves the plugin-only checkout rebuilds
      (install LOCK, 0 test failures, all release gates green).
- [x] `test/clean-checkout.test.js` + `test/anim-spec.test.js` make that proof
      part of `npm test`.
- [x] `scripts/clean-checkout.mjs --export DIR` stages the exact tree to push
      (skips `node_modules`, `.git`, caches, tarballs) and runs the static
      package + spec checks on the exported tree.
- [x] No private art bytes, no credentials, no private absolute paths as build
      inputs. The spec lists SHA-256 of private source frames only.
- [ ] First commit / remote / CI first run / branch protection / npm publish:
      **external** (not performed by this workspace task).

## 3. Stage the public tree

```bash
cd plugins/dsh-famling
node scripts/clean-checkout.mjs --export /tmp/dsh-famling-public --json
# optional full proof in the staged tree (slower, runs a private-checkout copy):
node scripts/clean-checkout.mjs --export /tmp/dsh-famling-public --verify --json
```

The export includes the package runtime, `test/`, `scripts/` (including the
vendored spec), `docs/`, `locale/`, license/NOTICE files, `README.md` and the
LOCK. It excludes development artifacts listed in the script's `COPY_SKIP_NAMES`.

Recommended `.gitignore` for the new repository (not added to this package's
root because this directory is not the git repository yet):

```gitignore
node_modules/
*.tgz
npm-debug.log*
.DS_Store
.cache/
scripts/qa/*.png
```

## 4. First-push checklist (external, not executed here)

1. Create the empty `PerryLink/dsh-famling` repository (owner action).
2. Stage the tree with `--export` (section 3) and inspect:
   - `git init -b main` inside the staged directory;
   - `git add .`;
   - `git status --short` must not list `node_modules/`, `*.tgz`, `.git/`;
   - confirm the public tree has no secret/token file (`发布令牌.md`, `.env`,
     `*.pem`, `*.key` are not part of the plugin package).
3. Run the gates in the staged tree:
   ```bash
   npm ci --offline && npm test
   node scripts/embed-anims.mjs --check
   node scripts/verify-anims.mjs
   npm run check && npm run verify:package && npm run lint
   ```
4. `git commit -m "chore: standalone plugin checkout (MB-004)"`,
   `git remote add origin https://github.com/PerryLink/dsh-famling.git`,
   `git push -u origin main`.
5. Enable branch protection (required checks below) before accepting PRs.

## 5. Suggested CI workflow

The plugin has no runtime dependencies, so CI does not need a private
checkout. A first workflow (add as `.github/workflows/ci.yml` in the public
repo) could be:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    strategy:
      matrix:
        node: [22, 24]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm test
      - run: node scripts/embed-anims.mjs --check
      - run: node scripts/verify-anims.mjs
      - run: npm run check
      - run: npm run verify:package
      - run: npm run lint
      - run: node scripts/clean-checkout.mjs
      - name: optional real checkJs
        run: npm i --no-save typescript @types/node && FAMLING_TSC=$(node -p "require.resolve('typescript/bin/tsc')") node scripts/typecheck.mjs
```

Notes:

- `clean-checkout.mjs` runs `npm ci --offline` inside the temp copy; because
  the package has zero dependencies, the npm cache is not needed and this is
  green on a clean runner.
- `npm run verify:package` exercises the real `npm pack --dry-run` inventory.
- The real `checkJs` step is optional because the package deliberately has no
  devDependencies; installing TypeScript with `--no-save` keeps the published
  package dependency-free while producing real evidence.
- Required status checks for branch protection: at least `test` (both node
  versions) and `npm run verify:package`.

## 6. npm publish prerequisites (not done)

- npm scope/ownership for `dsh-famling` (currently a placeholder version on the
  registry; see `docs/RELEASE-HYGIENE.md`).
- npm provenance requires a public repository and a CI OIDC token; enable after
  the first public push.
- Never publish from the private workspace; publish from the public repository
  CI after the evidence above is green.
- `prepack` runs the static package/lock gate automatically, so a broken
  metadata/lock/files edit cannot be packed.

## 7. Verification evidence for the export

`node scripts/clean-checkout.mjs --export DIR --json` reports `ok: true` when:

- the exported tree has no `node_modules`/`.git`/caches/tarballs;
- required files (`package-lock.json`, `scripts/spec/anim-spec.json`,
  `scripts/clean-checkout.mjs`, `test/clean-checkout.test.js`, this doc) exist;
- `check-package` is green on the exported tree (metadata, `files` allowlist,
  LOCK);
- `embed-anims --check` runs in standalone spec mode on the exported tree.

The real first-push/CI evidence is external; this document intentionally does
not claim it.
