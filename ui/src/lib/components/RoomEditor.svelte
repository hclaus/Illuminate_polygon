<script lang="ts">
	import { project, room } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { enterToggle } from '$lib/actions/enterToggle';
	import { displayDimension } from '$lib/utils/formatting';

	interface Props {
		onShowReflectanceSettings: () => void;
	}

	let { onShowReflectanceSettings }: Props = $props();

	const units = $derived($userSettings.units);

	function handleDimensionChange(dim: 'x' | 'y' | 'z', event: Event) {
		const target = event.target as HTMLInputElement;
		const parsed = parseFloat(target.value);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			target.value = displayDimension($room[dim], $room.precision);
			return;
		}
		project.updateRoom({ [dim]: parsed });
	}

	function handleUnitChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		project.changeUnits(target.value as 'meters' | 'feet');
	}

	function handleReflectanceToggle(event: Event) {
		const target = event.target as HTMLInputElement;
		project.updateRoom({ enable_reflectance: target.checked });
	}

	const isPolygon = $derived(!!$room.polygon && $room.polygon.length > 0);

	function handlePolygonToggle(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.checked) {
			const xVal = $room.x ?? 4;
			const yVal = $room.y ?? 6;
			project.updateRoom({
				polygon: [
					[0, 0],
					[xVal, 0],
					[xVal, yVal],
					[0, yVal]
				]
			});
		} else {
			const xVal = $room.x ?? 4;
			const yVal = $room.y ?? 6;
			project.updateRoom({
				polygon: undefined,
				x: xVal,
				y: yVal
			});
		}
	}

	function openPolygonBuilder() {
		window.open('/polygon_builder.html', '_blank');
	}
</script>

<div class="room-editor">
	<!-- Dimensions with Units -->
	<div class="form-group">
		<span class="room-label">{isPolygon ? 'Maximum dimensions' : 'Dimensions'}</span>
		<div class="dimensions-row">
			<div class="dim-inputs">
				<div class="input-with-label">
					<span class="input-label">X</span>
					<input
						type="text"
						inputmode="decimal"
						value={displayDimension($room.x ?? 0, $room.precision)}
						onchange={(e) => handleDimensionChange('x', e)}
						disabled={isPolygon}
					/>
				</div>
				<div class="input-with-label">
					<span class="input-label">Y</span>
					<input
						type="text"
						inputmode="decimal"
						value={displayDimension($room.y ?? 0, $room.precision)}
						onchange={(e) => handleDimensionChange('y', e)}
						disabled={isPolygon}
					/>
				</div>
				<div class="input-with-label">
					<span class="input-label">Z</span>
					<input
						type="text"
						inputmode="decimal"
						value={displayDimension($room.z, $room.precision)}
						onchange={(e) => handleDimensionChange('z', e)}
					/>
				</div>
			</div>
			<select class="units-select" value={units} onchange={handleUnitChange}>
				<option value="meters">m</option>
				<option value="feet">ft</option>
			</select>
		</div>
	</div>

	<!-- Polygon Room Toggle and Details Button -->
	<div class="form-group">
		<div class="polygon-toggle-row">
			<label class="checkbox-label">
				<input
					type="checkbox"
					checked={isPolygon}
					onchange={handlePolygonToggle}
					use:enterToggle
				/>
				<span>Polygon room</span>
			</label>
			{#if isPolygon}
				<button type="button" class="secondary details-btn" onclick={openPolygonBuilder}>
					Details
				</button>
			{/if}
		</div>
	</div>

	<!-- Reflectance Toggle -->
	<div class="form-group tight-after">
		<label class="checkbox-label">
			<input
				type="checkbox"
				checked={$room.enable_reflectance}
				onchange={handleReflectanceToggle}
				use:enterToggle
			/>
			<span>Enable reflections</span>
		</label>
	</div>

	<!-- Reflectance Settings Button -->
	<button type="button" class="secondary reflectance-btn"
		onclick={onShowReflectanceSettings}>
		Set Reflectance
	</button>
</div>

<style>
	.room-editor {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group.tight-after {
		margin-bottom: calc(-1 * var(--spacing-xs));
	}

	/* Dimensions row with units dropdown */
	.dimensions-row {
		display: flex;
		gap: var(--spacing-sm);
		align-items: flex-end;
	}

	.dim-inputs {
		display: flex;
		gap: var(--spacing-xs);
		flex: 1;
	}

	.dim-inputs > * {
		flex: 1;
	}

	.units-select {
		width: 60px;
		flex-shrink: 0;
	}

	.input-with-label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.input-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		font-size: var(--font-size-base);
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	.reflectance-btn {
		width: 100%;
	}

	label, .room-label {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
	}

	input, select {
		width: 100%;
	}

	.polygon-toggle-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		gap: var(--spacing-xs);
	}

	.details-btn {
		padding: 4px 8px;
		font-size: var(--font-size-sm);
		height: auto;
		width: auto;
	}
</style>
