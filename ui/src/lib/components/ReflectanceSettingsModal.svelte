<script lang="ts">
	import { onMount } from 'svelte';
	import { Canvas } from '@threlte/core';
	import { project, room } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { theme } from '$lib/stores/theme';
	import type { SurfaceReflectances, SurfaceSpacings, SurfaceNumPointsAll, ReflectanceResolutionMode } from '$lib/types/project';
	import { formatFloat } from '$lib/utils/formatting';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';
	import { unitAbbrev as getUnitAbbrev } from '$lib/utils/unitConversion';
	import { getReflectanceSurfaces } from '$lib/api/client';
	import ReflectancePreview3D from './ReflectancePreview3D.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Local draft state cloned from room store, fallback values for safety
	let draftReflectances = $state<Record<string, number>>({ ...$room.reflectances });
	let draftSpacings = $state<Record<string, { x: number; y: number }>>(
		JSON.parse(JSON.stringify($room.reflectance_spacings || {}))
	);
	let draftNumPoints = $state<Record<string, { x: number; y: number }>>(
		JSON.parse(JSON.stringify($room.reflectance_num_points || {}))
	);
	let draftResolutionMode = $state<ReflectanceResolutionMode>($room.reflectance_resolution_mode || 'num_points');
	let draftMaxPasses = $state<number>($room.reflectance_max_num_passes ?? 100);
	let draftThreshold = $state<number>($room.reflectance_threshold ?? 0.02);

	// On mount, fetch actual surface info from the backend to populate the modal
	onMount(async () => {
		try {
			const resp = await getReflectanceSurfaces();
			const surfaces = resp.surfaces;
			const newNumPoints: Record<string, { x: number; y: number }> = {};
			const newSpacings: Record<string, { x: number; y: number }> = {};
			for (const [name, info] of Object.entries(surfaces)) {
				newNumPoints[name] = { x: info.num_x, y: info.num_y };
				newSpacings[name] = { x: round3(info.x_spacing), y: round3(info.y_spacing) };
			}
			project.updateRoom({
				reflectance_num_points: newNumPoints as unknown as SurfaceNumPointsAll,
				reflectance_spacings: newSpacings as unknown as SurfaceSpacings,
			});
			// Populate draft state from store (after updating store with backend values)
			draftReflectances = { ...$room.reflectances };
			draftNumPoints = JSON.parse(JSON.stringify($room.reflectance_num_points || {}));
			draftSpacings = JSON.parse(JSON.stringify($room.reflectance_spacings || {}));
			draftResolutionMode = $room.reflectance_resolution_mode || 'num_points';
			draftMaxPasses = $room.reflectance_max_num_passes ?? 100;
			draftThreshold = $room.reflectance_threshold ?? 0.02;
		} catch (e) {
			// If backend fetch fails, keep using current store values to populate draft state
			console.warn('[ReflectanceSettingsModal] Failed to fetch surfaces from backend:', e);
			draftReflectances = { ...$room.reflectances };
			draftNumPoints = JSON.parse(JSON.stringify($room.reflectance_num_points || {}));
			draftSpacings = JSON.parse(JSON.stringify($room.reflectance_spacings || {}));
			draftResolutionMode = $room.reflectance_resolution_mode || 'num_points';
			draftMaxPasses = $room.reflectance_max_num_passes ?? 100;
			draftThreshold = $room.reflectance_threshold ?? 0.02;
		}
	});

	// Surface list
	const isPolygon = $derived(!!$room.polygon && $room.polygon.length > 0);
	const initialSurfaces = $derived(
		isPolygon && $room.polygon
			? ['floor', 'ceiling', ...$room.polygon.map((_, i) => `wall_${i}`)]
			: ['floor', 'ceiling', 'south', 'north', 'east', 'west']
	);

	let allSurfaces = $state<string[]>(['floor', 'ceiling', 'south', 'north', 'east', 'west']);

	$effect(() => {
		allSurfaces = initialSurfaces;
	});

	// Hover/focus tracking for 3D highlight
	let selectedSurface = $state<string | null>(null);

	// Room dims (always in meters)
	const roomDims = $derived({ x: $room.x, y: $room.y, z: $room.z });

	function round3(v: number): number {
		return Math.round(v * 1000) / 1000;
	}

	/** Get the physical span dimensions for a reflective surface based on room geometry */
	function getSurfaceSpans(surface: string): { x: number; y: number } {
		const r = $room;
		if (surface === 'floor' || surface === 'ceiling') {
			return { x: r.x, y: r.y };
		}
		if (surface.startsWith('wall_')) {
			const index = parseInt(surface.split('_')[1], 10);
			if (r.polygon && r.polygon.length > 0 && !isNaN(index)) {
				const p1 = r.polygon[index];
				const p2 = r.polygon[(index + 1) % r.polygon.length];
				if (p1 && p2) {
					const dx = p2[0] - p1[0];
					const dy = p2[1] - p1[1];
					const length = Math.sqrt(dx * dx + dy * dy);
					return { x: length, y: r.z };
				}
			}
		}
		switch (surface) {
			case 'north':
			case 'south':
				return { x: r.x, y: r.z };
			case 'east':
			case 'west':
				return { x: r.y, y: r.z };
		}
		return { x: r.x, y: r.z };
	}

	const unitAbbrev = $derived(getUnitAbbrev($userSettings.units));

	function handleReflectanceChange(surface: string, value: number) {
		draftReflectances = { ...draftReflectances, [surface]: value };
	}

	function setAllReflectances(value: number) {
		const newReflectances: Record<string, number> = {};
		for (const surface of allSurfaces) {
			newReflectances[surface] = value;
		}
		draftReflectances = newReflectances;
	}

	function getDefaultNumPoints(surface: string): number {
		return (surface === 'floor' || surface === 'ceiling') ? 10 : 20;
	}

	function handleSpacingChange(surface: string, axis: 'x' | 'y', value: number) {
		const spans = getSurfaceSpans(surface);
		const defaultNum = getDefaultNumPoints(surface);
		draftSpacings = {
			...draftSpacings,
			[surface]: {
				...(draftSpacings[surface] || { x: 0.5, y: 0.5 }),
				[axis]: value
			}
		};
		draftNumPoints = {
			...draftNumPoints,
			[surface]: {
				...(draftNumPoints[surface] || { x: defaultNum, y: defaultNum }),
				[axis]: numPointsFromSpacing(spans[axis], value)
			}
		};
	}

	function handleNumPointsChange(surface: string, axis: 'x' | 'y', value: number) {
		const spans = getSurfaceSpans(surface);
		const defaultNum = getDefaultNumPoints(surface);
		draftNumPoints = {
			...draftNumPoints,
			[surface]: {
				...(draftNumPoints[surface] || { x: defaultNum, y: defaultNum }),
				[axis]: value
			}
		};
		draftSpacings = {
			...draftSpacings,
			[surface]: {
				...(draftSpacings[surface] || { x: 0.5, y: 0.5 }),
				[axis]: round3(spacingFromNumPoints(spans[axis], value))
			}
		};
	}

	function toggleResolutionMode() {
		draftResolutionMode = draftResolutionMode === 'spacing' ? 'num_points' : 'spacing';
	}

	function handleMaxPassesChange(value: number) {
		draftMaxPasses = value;
	}

	function handleThresholdChange(value: number) {
		draftThreshold = value;
	}

	function handleApply() {
		project.updateRoom({
			reflectances: draftReflectances as any,
			reflectance_spacings: draftSpacings as any,
			reflectance_num_points: draftNumPoints as any,
			reflectance_resolution_mode: draftResolutionMode,
			reflectance_max_num_passes: draftMaxPasses,
			reflectance_threshold: draftThreshold,
		});
		onClose();
	}
</script>

<Modal
	title="Reflectance Settings"
	{onClose}
	maxWidth="min(920px, 95vw)"
	titleFontSize="1rem"
>
	{#snippet body()}
		<div class="modal-body">
			<!-- Left: 3D Preview -->
			<div class="preview-column">
				<div class="canvas-container" class:dark={$theme === 'dark'}>
					<Canvas>
						<ReflectancePreview3D {roomDims} numPoints={draftNumPoints as unknown as SurfaceNumPointsAll} {selectedSurface} />
					</Canvas>
				</div>
				<p class="hint canvas-hint">Drag to rotate, scroll to zoom</p>
			</div>

			<!-- Right: Settings -->
			<div class="settings-column">
				<!-- Quick-set and mode toggle -->
				<div class="controls-bar">
					<div class="reflectance-quick">
						<span class="hint">Quick set:</span>
						<div class="quick-buttons">
							<button type="button" class="mini" onclick={() => setAllReflectances(0.078)}>0.078 (222nm)</button>
							<button type="button" class="mini" onclick={() => setAllReflectances(0.05)}>0.05 (254nm)</button>
						</div>
					</div>
					<button type="button" class="mode-switch-btn" onclick={toggleResolutionMode}>
						{draftResolutionMode === 'num_points' ? 'Set Spacing' : 'Set Num Points'}
					</button>
				</div>

				<!-- Merged surface table -->
				<div class="surface-table">
					<div class="table-header">
						<span class="col-surface">Surface</span>
						<span class="col-value col-refl">Reflectance</span>
						<span class="col-sep"></span>
						{#if draftResolutionMode === 'spacing'}
							<span class="col-value">X Spacing</span>
							<span class="col-value">Y Spacing</span>
						{:else}
							<span class="col-value">X Points</span>
							<span class="col-value">Y Points</span>
						{/if}
					</div>
					{#each allSurfaces as surface}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="surface-row"
							class:highlighted={selectedSurface === surface}
							onmouseenter={() => selectedSurface = surface}
							onmouseleave={() => selectedSurface = null}
							onfocusin={() => selectedSurface = surface}
						>
							<span class="surface-name">{surface}</span>
							<ValidatedNumberInput
								value={draftReflectances[surface] ?? 0.078}
								oncommit={(v) => handleReflectanceChange(surface, v)}
								min={0}
								max={1}
								step={0.01}
							/>
							<span class="col-sep"></span>
							{#if draftResolutionMode === 'spacing'}
								<ValidatedNumberInput
									value={draftSpacings[surface]?.x ?? 0.5} precision={$room.precision}
									oncommit={(v) => handleSpacingChange(surface, 'x', v)}
									step={0.1}
									validate={(v) => v > 0 && v < getSurfaceSpans(surface).x}
								/>
								<ValidatedNumberInput
									value={draftSpacings[surface]?.y ?? 0.5} precision={$room.precision}
									oncommit={(v) => handleSpacingChange(surface, 'y', v)}
									step={0.1}
									validate={(v) => v > 0 && v < getSurfaceSpans(surface).y}
								/>
							{:else}
								<ValidatedNumberInput
									value={draftNumPoints[surface]?.x ?? getDefaultNumPoints(surface)}
									oncommit={(v) => handleNumPointsChange(surface, 'x', v)}
									integer
									min={1}
									step={1}
								/>
								<ValidatedNumberInput
									value={draftNumPoints[surface]?.y ?? getDefaultNumPoints(surface)}
									oncommit={(v) => handleNumPointsChange(surface, 'y', v)}
									integer
									min={1}
									step={1}
								/>
							{/if}
						</div>
						<div class="computed-value-row">
							<span></span>
							<span></span>
							<span></span>
							{#if draftResolutionMode === 'spacing'}
								<span class="computed-value">{(draftNumPoints[surface]?.x ?? getDefaultNumPoints(surface))} x {(draftNumPoints[surface]?.y ?? getDefaultNumPoints(surface))} pts</span>
							{:else}
								<span class="computed-value">{formatFloat(spacingFromNumPoints(getSurfaceSpans(surface).x, draftNumPoints[surface]?.x ?? getDefaultNumPoints(surface)), $room.precision)} x {formatFloat(spacingFromNumPoints(getSurfaceSpans(surface).y, draftNumPoints[surface]?.y ?? getDefaultNumPoints(surface)), $room.precision)} {unitAbbrev}</span>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Interreflection -->
				<section class="settings-section">
					<h3>Interreflection</h3>
					<p class="section-description">Calculation stops when contributions fall below threshold &times; initial value, or max iterations is reached, whichever comes first.</p>
					<div class="section-content">
						<div class="form-row halves">
							<div class="form-group compact">
								<label for="max_passes">Max iterations</label>
								<ValidatedNumberInput
									id="max_passes"
									value={draftMaxPasses}
									oncommit={handleMaxPassesChange}
									integer
									min={1}
									step={1}
								/>
								<span class="field-hint">Maximum reflection passes</span>
							</div>
							<div class="form-group compact">
								<label for="threshold">Threshold</label>
								<ValidatedNumberInput
									id="threshold"
									value={draftThreshold}
									oncommit={handleThresholdChange}
									min={0}
									max={1}
									step={0.01}
								/>
								<span class="field-hint">Fraction of initial value</span>
							</div>
						</div>
					</div>
				</section>
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="modal-footer">
			<div></div>
			<div class="footer-right">
				<button type="button" class="secondary" onclick={onClose}>Cancel</button>
				<button type="button" class="primary" onclick={handleApply}>Apply Reflectance Settings</button>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: row;
		gap: var(--spacing-md);
		overflow-y: auto;
	}

	/* Left: 3D preview */
	.preview-column {
		flex: 0 0 380px;
		display: flex;
		flex-direction: column;
	}

	.canvas-container {
		width: 100%;
		height: 380px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #d0d7de;
	}

	.canvas-container.dark {
		background: #1a1a2e;
	}

	.canvas-hint {
		text-align: center;
		margin-top: var(--spacing-xs);
	}

	/* Right: settings */
	.settings-column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-width: 0;
	}

	/* Controls bar: quick-set + mode toggle */
	.controls-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.reflectance-quick {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.hint {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.quick-buttons {
		display: flex;
		gap: var(--spacing-xs);
	}

	button.mini {
		padding: 2px 8px;
		font-size: var(--font-size-xs);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
		transition: all 0.15s;
	}

	button.mini:hover {
		background: var(--color-border);
	}

	.mode-switch-btn {
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-xs);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.mode-switch-btn:hover {
		background: var(--color-border);
		border-color: var(--color-text-muted);
	}

	/* Merged surface table */
	.surface-table {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
	}

	.table-header {
		display: grid;
		grid-template-columns: 90px 2fr 1px 1fr 1fr;
		gap: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		padding-bottom: var(--spacing-xs);
		border-bottom: 1px solid var(--color-border);
	}

	.table-header .col-surface {
		text-align: left;
	}

	.table-header .col-value {
		text-align: center;
	}

	.col-sep {
		background: var(--color-border);
		align-self: stretch;
	}

	.surface-row {
		display: grid;
		grid-template-columns: 90px 2fr 1px 1fr 1fr;
		gap: var(--spacing-xs);
		align-items: center;
		padding: 3px var(--spacing-xs);
		margin: 0 calc(-1 * var(--spacing-xs));
		border-radius: var(--radius-sm);
		transition: background 0.1s;
	}

	.surface-row.highlighted {
		background: rgba(34, 211, 238, 0.08);
	}

	.surface-name {
		font-size: var(--font-size-sm);
		text-transform: capitalize;
		color: var(--color-text-muted);
	}

	.surface-row :global(input) {
		padding: 4px 6px;
		font-size: var(--font-size-base);
		width: 100%;
	}

	.computed-value-row {
		display: grid;
		grid-template-columns: 90px 2fr 1px 1fr 1fr;
		gap: var(--spacing-xs);
		margin-top: -2px;
		margin-bottom: var(--spacing-xs);
		padding-left: var(--spacing-xs);
	}

	.computed-value-row .computed-value {
		grid-column: span 2;
	}

	.computed-value {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		opacity: 0.7;
	}

	/* Interreflection section */
	.settings-section {
		display: flex;
		flex-direction: column;
	}

	.settings-section h3 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.section-description {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0 0 var(--spacing-xs) 0;
		opacity: 0.8;
	}

	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.section-content {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.form-row {
		display: flex;
		gap: var(--spacing-sm);
	}

	.form-row.halves > * {
		flex: 1;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group.compact {
		gap: 2px;
	}

	.form-group.compact label {
		font-size: var(--font-size-xs);
		text-transform: capitalize;
	}

	.form-group.compact :global(input) {
		padding: 4px 6px;
		font-size: var(--font-size-base);
	}

	label {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
	}

	:global(input) {
		width: 100%;
	}

	.modal-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.footer-right {
		display: flex;
		gap: var(--spacing-sm);
	}

	.modal-footer button.primary {
		background: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
		padding: 6px var(--spacing-md);
		font-size: var(--font-size-sm);
		font-weight: 500;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.modal-footer button.primary:hover {
		background: var(--color-accent-hover);
	}

	.modal-footer button.secondary {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		padding: 6px var(--spacing-md);
		font-size: var(--font-size-sm);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.modal-footer button.secondary:hover {
		background: var(--color-border);
	}

	/* Responsive: stack vertically on narrow viewports */
	@media (max-width: 700px) {
		.modal-body {
			flex-direction: column;
		}

		.preview-column {
			flex: none;
		}

		.canvas-container {
			height: 250px;
		}
	}
</style>
