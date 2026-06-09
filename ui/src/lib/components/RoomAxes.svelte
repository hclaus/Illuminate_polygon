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

<T.Group position={origin} scale={[1, 1, -1]}>
	<T.AxesHelper args={[axisLength]} />
	<BillboardGroup>
		<!-- X Label (Red Axis) -->
		<Text
			text="x"
			fontSize={axisLength * 0.25}
			color="#ef4444"
			{outlineColor}
			{outlineWidth}
			position={[axisLength + axisLength * 0.08, 0, 0]}
			anchorX="left"
			anchorY="middle"
		/>
		<!-- Y Label (Blue Axis in local scale flipped Z) -->
		<Text
			text="y"
			fontSize={axisLength * 0.25}
			color="#3b82f6"
			{outlineColor}
			{outlineWidth}
			position={[0, 0, axisLength + axisLength * 0.08]}
			anchorX="center"
			anchorY="middle"
		/>
		<!-- Z Label (Green Axis - Vertical) -->
		<Text
			text="z"
			fontSize={axisLength * 0.25}
			color="#22c55e"
			{outlineColor}
			{outlineWidth}
			position={[0, axisLength + axisLength * 0.08, 0]}
			anchorX="center"
			anchorY="bottom"
		/>
	</BillboardGroup>
</T.Group>
