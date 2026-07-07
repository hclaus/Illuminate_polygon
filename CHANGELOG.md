# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Conventional Commits](https://www.conventionalcommits.org/) —
run `scripts/changelog.sh` to generate entries from git history.

## [Unreleased]

### Added
- Shared custom file pool: uploaded IES and spectrum files persist in IndexedDB and are available across all lamps via dropdown menus
- File management modal (Edit > Manage Custom Files) for uploading, renaming, and deleting custom photometric and spectrum files
- Custom IES files appear in the 222nm preset dropdown alongside built-in presets, with "Upload new file..." option
- IES and spectrum file dropdowns for lp_254/other lamp types (replaces raw file input when files exist in the pool)
- Custom files automatically re-upload to backend on session timeout recovery
- Beforeunload warning when project has unsaved changes
- Point-and-click position and aim point picking for lamps (matches calcpoint interface)
- App version displayed in status bar (`illuminate v0.1.x | guv-calcs 0.7.0`)
- Dynamic "How To Cite" citation with guv-calcs version
- Playwright e2e test suite (smoke, room, lamps, zones, calculate, save/load, mobile)
- Version-tagged Docker deployments with rollback support (`bash deploy.sh rollback <version>`)
- Auto-patch-bump on deploy when no release tag exists on HEAD
- **Polygon rooms:** rooms can now be defined as an arbitrary 2D polygon footprint instead of only a rectangle, with the 3D view extruding the footprint into walls/floor/ceiling
- **Polygon Builder:** standalone visual editor (Room > Polygon room > Details) for drawing/editing the room footprint, with zoom/pan and an editable coordinates table; syncs bidirectionally with the main app and persists across save/load
- **Contour plots:** new "Contours" display mode for 2D calculation planes, with configurable levels, labels, colors, fill/line style, grid, equal-aspect, flip-Y, and sigma smoothing, all persisted per zone
- ZIP export "Include plots" renders each contour zone's PNG using the exact same client-side chart shown in the live app, so exported images match the on-screen plot pixel-for-pixel (falls back to a server-rendered plot if the client-rendered image isn't available)
- Image/data overlays on contour and heatmap plots, positionable and scalable over the floor plan
- **Ceiling Designer:** standalone 2D layout tool (Tools > Ceiling Designer) for placing smoke detectors, vents, room sensors, light fixtures, and pillars, plus keep-out areas, with automatic 2x2/4x2 ft tile paneling and configurable start-corner alignment
- Ceiling layout (tiles, components, keep-out areas) now renders on the extruded 3D room ceiling, matching the 2D designer, and persists in the .guv project file
- "Save as SVG" export of the ceiling layout for external documentation

### Fixed
- Fix infinite reactive loop in ContourPlot settings synchronization by untracking store updates in effect block
- Custom IES files now correctly survive save/load cycles — dropdown and upload UI properly restored for custom lamps loaded from .guv files
- IES file validation now accepts older LM-63-1986 format files, files with BOM, and leading blank lines
- Loading .guv files now correctly restores directional/point zones (calc_mode, position, aim point, view_direction, etc. were silently dropped by incomplete Zod validation schema)
- Calc zone editor no longer closes when switching between zone types (plane/volume/point)
- Value Display label now correctly shows "Fluence Rate" only for actual fluence calculations
- Zone update race condition from mutating `calc_zones` dict during iteration
- Zone update crashes, height tracking, and point calc_mode bugs
- `view_direction` / `view_target` mutual exclusivity conflict
- Point-and-click placement/aiming no longer opens scene objects underneath the click target
- CalcPoint3D marker uses sqrt-based scaling instead of linear, preventing oversized markers in large rooms
- Add missing `aim_x`/`aim_y`/`aim_z` fields to `SessionZoneState` and `LoadedZone` backend schemas
- Zone spacing/num_points display now always shows fresh backend values when toggling modes
- IES fixture test path now derived from installed guv_calcs package (portable across environments)
- Remove redundant `tuple()` wrapping for `view_direction`/`view_target` (guv_calcs handles conversion internally)
- Multiple custom zones of the same type (e.g. two CalcPlanes) now all survive session init — previously only the first was kept due to an ID collision bug
- `ref_surface` (xy/xz/yz) no longer reset to 'xy' when standard zones are refreshed after room changes
- Output schemas now use `tuple` for `view_direction`/`view_target` to match guv_calcs types
- 2D heatmap and contour plots now mask/exclude coordinates outside the room's actual polygon footprint (previously showed data outside the walls for non-rectangular rooms)
- CalcPlane3D correctly masks values outside the polygon footprint in the 3D view
- Polygon room geometry no longer lost on project save/load
- Reflectance calculation issues for polygon rooms resolved
- Startup safety-zones warning and room max-dimension auto-update fixed for polygon rooms
- Prevented default browser drag behavior from interfering with overlay/handle dragging on the room canvases
- 3D ceiling tile grid now correctly follows non-rectangular (concave) room footprints instead of overhanging walls or dropping tiles near notches/corners
- Editing a ceiling component's width, height, position, or name in the sidebar now updates the 2D canvas immediately (previously saved silently without repainting)
- Newly placed or edited ceiling components could fail to appear in the main app after closing the Ceiling Designer window, due to a cross-window sync race
- Dragging a ceiling component's resize handle no longer deselects the component mid-drag
- Fixed "Failed to export ZIP" crash for polygon rooms containing a rectangular Plane calc zone
- ZIP export now correctly renders zones with "Contours" display mode as contour plots instead of plain heatmaps, with proper room-polygon masking and a labeled legend matching the live view

### Changed
- CI uses `--locked` for reproducible API dependency installs
- File upload tests re-enabled in CI
- Added `scripts/sync-to-server.sh` (+ Windows `.bat` wrapper): merges the deploy branch into the current branch, runs the full backend/frontend test suites, and only pushes if everything passes

## [0.1.0] - 2026-03-24

Initial versioned release. Retroactive summary of features present at tagging.

### Added
- Room geometry editor with 2D polygon drawing
- Lamp placement with corner, edge, horizontal, and downlight modes
- Mass lamp operations: batch placement, aiming, and height adjustment
- Calculation volume (CalcVol) 3D visualization with isosurface rendering
- Zone statistics panel with fluence rate plots
- Session persistence via sessionStorage with auto-recovery
- Docker single-image production build
- Security headers middleware (CSP, X-Frame-Options, etc.)

### Dependencies
- guv_calcs == 0.6.5
