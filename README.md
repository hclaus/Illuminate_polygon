# Illuminate v2

An interactive environment for the [GUV-Calcs](https://github.com/jvbelenky/guv-calcs/) library, v2 - faster and sexier, now with REAL webslop!

## Features

- **Room geometry**: rectangular or arbitrary polygon footprints, edited via the Polygon Builder (zoom/pan, editable coordinates table), extruded into a full 3D room view
- **Lamp placement**: corner/edge/horizontal/downlight modes, point-and-click position and aim-point picking, mass placement/aiming/height operations
- **Calculation zones**: Plane, Volume, and Point zones with standard (whole-room, eye dose, skin dose) and custom zones; 2D heatmap and contour plot display modes (configurable levels, labels, colors, smoothing), 3D isosurface rendering for volumes
- **Ceiling Designer**: standalone 2D layout tool for tiles, smoke detectors, vents, light fixtures, pillars, and keep-out areas, synced to the 3D ceiling
- **Export**: ZIP export (data, reports, and plot images matching the live on-screen rendering), CSV zone export, citation generator
- **Session persistence**: autosave to sessionStorage with reload recovery, save/load `.guv` project files

## Project Structure

```
illuminate-v2/
├── api/          # FastAPI backend
│   ├── api/v1/   # API routes
│   ├── app/      # FastAPI app
│   └── ...
├── ui/           # SvelteKit frontend
│   ├── src/
│   └── ...
└── README.md
```

## Prerequisites

- Python 3.11+
- Node.js 22+
- pnpm
- [uv](https://docs.astral.sh/uv/)

## Quick Start

```bash
make setup-hooks    # one-time: install pre-commit hook
make frontend       # start UI dev server (localhost:5173)
make backend        # start API dev server (localhost:8000)
```

API docs: http://localhost:8000/api/v1/docs

## Testing

```bash
make test           # run all tests (UI + API + e2e)
make test-ui        # UI unit tests (Vitest)
make test-api       # API tests (pytest)
make test-e2e       # end-to-end tests (Playwright)
```

## Deployment

There are two independent deploy paths. Pick whichever matches your target — they don't interact.

### Docker-based installation (current production server)

A Docker-based hosting setup polls the `publish-to-server` branch of a *separate* repo (`illuminate-v2`, not this one) plus its Dockerfile, and rebuilds when that branch changes. Auto-rebuild is disabled there, so a manual rebuild trigger in its dashboard is required after pushing.

```bash
bash scripts/sync-to-server.sh   # merge publish-to-server, run full test suites, push only if clean
```

Run it with Git Bash directly (not the `.bat` wrapper) from non-interactive contexts — the wrapper's trailing `pause` hangs when there's no terminal to respond to it. Pass `--continue` to resume after manually resolving a merge conflict.

### Standalone Docker (`scripts/deploy.sh` / `make deploy`)

A separate, self-contained workflow for running a versioned Docker image directly on a machine (no hosting dashboard involved): builds and deploys an `illuminate-v2` container, keeps the last 20 images, and supports instant rollback. Requires a clean working tree on `main`.

```bash
make deploy                    # build and deploy current version
make rollback VERSION=0.1.3    # revert to a previous version (instant, no rebuild)
make versions                  # list available versions
make pin VERSION=0.1.3         # pin a version (never pruned)
make unpin VERSION=0.1.3       # unpin a version
```

**How versioning works:**

- `make deploy` auto-bumps the patch version (e.g., `0.1.3` -> `0.1.4`), tags, and deploys
- Docker images are tagged with the version and the last 20 are kept
- Pinned versions are kept indefinitely
- Rollback swaps the running container to an older image — no rebuild needed

**Named releases** (for milestones):

```bash
make release VERSION=minor   # bumps version, updates CHANGELOG, tags, pushes
make deploy                  # deploys the release (no auto-bump since tag exists)
```

## Local Development with guv-calcs

This app depends on [hclaus/guv-calcHC](https://github.com/hclaus/guv-calcHC), a fork of upstream `guv-calcs` carrying fixes not yet merged upstream. `api/pyproject.toml` pins a specific commit in `dependencies`, and `[tool.uv.sources]` overrides that to an editable local checkout at `../../guv-calcHC` (i.e. a sibling of this repo's parent directory) so you can iterate on the library and the API together without publishing new versions.

If you don't have that repo cloned locally, remove or comment out the `[tool.uv.sources]` section and uv will pull the pinned fork commit from GitHub instead. `api/uv.lock` is gitignored so this won't cause conflicts. A pre-commit hook (installed via `make setup-hooks`) normalizes `api/uv.lock` to `--no-sources` state before each commit, so the editable-path override never leaks into a committed lockfile.

`photompy` is a transitive dependency of `guv-calcs` (pulled from PyPI, currently `0.3.0`) — there's no local-checkout override for it here.

## Related Repositories

- [guv-calcHC](https://github.com/hclaus/guv-calcHC) - fork of guv-calcs this app actually depends on
- [guv-calcs](https://github.com/jvbelenky/guv-calcs) - upstream Python library for GUV calculations
- [photompy](https://github.com/jvbelenky/photompy/) - Python library for interacting with .ies files (transitive dependency)
