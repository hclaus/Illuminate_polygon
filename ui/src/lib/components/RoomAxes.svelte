<script lang="ts">
	import { T } from '@threlte/core';
	import { Text } from '@threlte/extras';
	import { theme } from '$lib/stores/theme';
	import BillboardGroup from './BillboardGroup.svelte';

	interface Props {
		axisLength?: number;
		offset?: number;
	}

	let { axisLength = 1, offset = 0.5 }: Props = $props();

	const origin: [number, number, number] = $derived([-offset, 0, offset]);

	const outlineColor = $derived($theme === 'dark' ? '#1a1a2e' : '#ffffff');
	const outlineWidth = $derived(axisLength * 0.02);
</script>

<!-- Axes Helper (Flipped Z to match room coordinates) -->
<T.Group position={origin} scale={[1, 1, -1]}>
	<T.AxesHelper args={[axisLength]} />
</T.Group>

<!-- Labels (Unflipped scale to prevent mirroring of text) -->
<T.Group position={origin}>
	<!-- X Label (Red Axis - flows along X, flat on horizontal floor plane) -->
	<T.Group position={[axisLength + axisLength * 0.08, 0, 0]}>
		<Text
			text="x"
			fontSize={axisLength * 0.22}
			color="#ef4444"
			{outlineColor}
			{outlineWidth}
			rotation={[-Math.PI / 2, 0, 0]}
			anchorX="left"
			anchorY="middle"
		/>
	</T.Group>

	<!-- Y Label (Blue Axis - flows along -Z, flat on horizontal floor plane) -->
	<T.Group position={[0, 0, -axisLength - axisLength * 0.08]}>
		<Text
			text="y"
			fontSize={axisLength * 0.22}
			color="#3b82f6"
			{outlineColor}
			{outlineWidth}
			rotation={[-Math.PI / 2, 0, 0]}
			anchorX="center"
			anchorY="middle"
		/>
	</T.Group>

	<!-- Z Label (Green Axis - Vertical, billboarded so it's always readable) -->
	<BillboardGroup>
		<Text
			text="z"
			fontSize={axisLength * 0.22}
			color="#22c55e"
			{outlineColor}
			{outlineWidth}
			position={[0, axisLength + axisLength * 0.08, 0]}
			anchorX="center"
			anchorY="bottom"
		/>
	</BillboardGroup>
</T.Group>
