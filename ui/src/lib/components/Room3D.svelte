<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { useTask } from '@threlte/core';
	import { Text } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import { userSettings } from '$lib/stores/settings';
	import type { RoomConfig } from '$lib/types/project';

	interface Props {
		dims: { x: number; y: number; z: number };
		room: RoomConfig;
	}

	let { dims, room }: Props = $props();

	// Billboard: make all tick labels face the camera
	const { camera } = useThrelte();
	let labelsGroup = $state<THREE.Group | undefined>(undefined);

	useTask(() => {
		if (!labelsGroup || !camera.current) return;
		labelsGroup.traverse((child) => {
			if ((child as any).isMesh) {
				child.quaternion.copy(camera.current.quaternion);
			}
		});
	});

	// Theme-based colors
	const colors = $derived($theme === 'light' ? {
		wireframe: '#4a7fcf',
		floor: '#a0a8b0',
		ceiling: '#b8c0c8',
		walls: '#a0a8b0',
		axisLine: '#666666',
		tickText: '#333333'
	} : {
		wireframe: '#6a9fff',
		floor: '#2a2a4a',
		ceiling: '#1a1a3a',
		walls: '#2a2a4a',
		axisLine: '#888888',
		tickText: '#cccccc'
	});

	// Check if the room is a polygon room
	const isPolygon = $derived(!!room.polygon && room.polygon.length > 0);

	// Shape for polygon mode
	const polyShape = $derived.by(() => {
		if (!isPolygon || !room.polygon) return null;
		const shape = new THREE.Shape();
		const pts = room.polygon;
		if (pts.length > 0) {
			shape.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) {
				shape.lineTo(pts[i][0], pts[i][1]);
			}
			shape.closePath();
		}
		return shape;
	});

	// Geometries for rectangular mode
	const rectGeometry = $derived(isPolygon ? null : new THREE.BoxGeometry(dims.x, dims.z, dims.y));
	const rectEdges = $derived(rectGeometry ? new THREE.EdgesGeometry(rectGeometry) : null);

	// Geometries for polygon mode
	const polyGeometry = $derived.by(() => {
		if (!polyShape) return null;
		return new THREE.ExtrudeGeometry(polyShape, {
			depth: dims.z,
			bevelEnabled: false
		});
	});
	const polyEdges = $derived(polyGeometry ? new THREE.EdgesGeometry(polyGeometry) : null);
	const floorCeilGeometry = $derived(polyShape ? new THREE.ShapeGeometry(polyShape) : null);

	// Materials for polygon mode (caps hidden, walls visible)
	const wallMaterial = $derived(new THREE.MeshStandardMaterial({
		color: colors.walls,
		transparent: true,
		opacity: 0.1,
		side: THREE.DoubleSide,
		depthWrite: false
	}));
	const capMaterial = $derived(new THREE.MeshBasicMaterial({ visible: false }));
	const polyMaterials = $derived([capMaterial, wallMaterial]);

	// Dispose geometries and materials on unmount/reassign
	$effect(() => {
		const geo = rectGeometry;
		return () => { if (geo) geo.dispose(); };
	});
	$effect(() => {
		const geo = rectEdges;
		return () => { if (geo) geo.dispose(); };
	});
	$effect(() => {
		const geo = polyGeometry;
		return () => { if (geo) geo.dispose(); };
	});
	$effect(() => {
		const geo = polyEdges;
		return () => { if (geo) geo.dispose(); };
	});
	$effect(() => {
		const geo = floorCeilGeometry;
		return () => { if (geo) geo.dispose(); };
	});
	$effect(() => {
		const mat = wallMaterial;
		return () => { mat.dispose(); };
	});
	$effect(() => {
		const mat = capMaterial;
		return () => { mat.dispose(); };
	});

	// Room center position (used for rectangle center)
	const position = $derived<[number, number, number]>([dims.x / 2, dims.z / 2, -dims.y / 2]);

	const units = $derived($userSettings.units);

	// Sizing derived from max dimension
	const maxDim = $derived(Math.max(dims.x, dims.y, dims.z));
	const fontSize = $derived(Math.min(maxDim * 0.04, 0.5));
	const tickSize = $derived(Math.min(maxDim * 0.015, 0.2));

	// Generate "nice" tick values for an axis (in original user units)
	function generateTicks(max: number): number[] {
		const niceSteps = [1, 2, 2.5, 5, 10];
		const rawStep = max / 5;
		const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
		const normalized = rawStep / magnitude;
		const niceNorm = niceSteps.find(s => s >= normalized) ?? 10;
		const step = niceNorm * magnitude;

		const ticks: number[] = [];
		for (let v = 0; v <= max + step * 0.01; v += step) {
			ticks.push(Math.round(v * 1e6) / 1e6);
		}
		return ticks;
	}

	// Format tick value to match room's configured precision
	function formatTick(value: number): string {
		return value.toFixed(room.precision);
	}

	// Tick arrays in display units (show 0 only on X axis to mark the origin once)
	const xTicks = $derived(generateTicks(room.x ?? dims.x));
	const yTicks = $derived(generateTicks(room.y ?? dims.y).filter(t => t > 0));
	const zTicks = $derived(generateTicks(room.z).filter(t => t > 0));

	import { project } from '$lib/stores/project';

	const layout = $derived($project.ceilingLayout);
	const METERS_PER_FOOT = 0.3048;

	// Tile dimension in room units
	const tileDims = $derived.by(() => {
		if (!layout) return { w: 0, h: 0 };
		const size = layout.tileSize;
		const dir = layout.tileDirection;
		let w_ft = 2;
		let h_ft = 2;
		if (size === '4x2') {
			if (dir === 'x') {
				w_ft = 4;
				h_ft = 2;
			} else {
				w_ft = 2;
				h_ft = 4;
			}
		}
		const factor = units === 'meters' ? METERS_PER_FOOT : 1;
		return {
			w: w_ft * factor,
			h: h_ft * factor
		};
	});

	function isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
		if (!vs || vs.length < 3) return false;
		const x = Number(point[0]), y = Number(point[1]);
		let inside = false;
		for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
			if (!vs[i] || !vs[j]) continue;
			const xi = Number(vs[i][0]), yi = Number(vs[i][1]);
			const xj = Number(vs[j][0]), yj = Number(vs[j][1]);
			const intersect = ((yi > y) !== (yj > y))
				&& (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
			if (intersect) inside = !inside;
		}
		return inside;
	}

	// Generate ceiling tiles grid
	const tiles = $derived.by(() => {
		if (!layout || layout.tileSize === 'none' || !room) return [];
		const tw = tileDims.w;
		const th = tileDims.h;
		if (tw <= 0 || th <= 0) return [];

		// Determine bounding box of room polygon to generate layout grid
		const pts = room.polygon || [[0, 0], [room.x, 0], [room.x, room.y], [0, room.y]];
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		const minX = Math.min(...xs, 0);
		const maxX = Math.max(...xs, room.x);
		const minY = Math.min(...ys, 0);
		const maxY = Math.max(...ys, room.y);

		const roomWidth = maxX - minX;
		const roomHeight = maxY - minY;

		const cols = Math.ceil(roomWidth / tw) + 1;
		const rows = Math.ceil(roomHeight / th) + 1;

		let startX = minX;
		let startY = minY;

		if (layout.startCorner === 'top-right' || layout.startCorner === 'bottom-right') {
			const totalWidth = cols * tw;
			startX = maxX - totalWidth;
		}
		if (layout.startCorner === 'top-left' || layout.startCorner === 'top-right') {
			const totalHeight = rows * th;
			startY = maxY - totalHeight;
		}

		const list = [];
		for (let c = 0; c < cols; c++) {
			for (let r = 0; r < rows; r++) {
				list.push({
					x: startX + c * tw,
					y: startY + r * th,
					w: tw,
					h: th
				});
			}
		}

		const polyPts = room.polygon;
		if (polyPts && polyPts.length > 0) {
			return list.filter(tile => isPointInPolygon([tile.x + tile.w / 2, tile.y + tile.h / 2], polyPts));
		}
		return list;
	});
</script>

{#if isPolygon}
	<!-- Room wireframe (polygon mode) -->
	{#if polyEdges}
		<T.LineSegments position={[0, 0, 0]} rotation.x={-Math.PI / 2}>
			<T is={polyEdges} />
			<T.LineBasicMaterial color={colors.wireframe} linewidth={2} />
		</T.LineSegments>
	{/if}

	<!-- Semi-transparent floor (polygon mode) -->
	{#if floorCeilGeometry}
		<T.Mesh geometry={floorCeilGeometry} position={[0, 0.001, 0]} rotation.x={-Math.PI / 2}>
			<T.MeshStandardMaterial color={colors.floor} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
		</T.Mesh>
	{/if}

	<!-- Semi-transparent ceiling (polygon mode) -->
	{#if floorCeilGeometry}
		<T.Mesh geometry={floorCeilGeometry} position={[0, dims.z - 0.001, 0]} rotation.x={-Math.PI / 2}>
			<T.MeshStandardMaterial color={colors.ceiling} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
		</T.Mesh>
	{/if}

	<!-- Wall indicators (polygon mode walls) -->
	{#if polyGeometry}
		<T.Mesh geometry={polyGeometry} material={polyMaterials} position={[0, 0, 0]} rotation.x={-Math.PI / 2} />
	{/if}
{:else}
	<!-- Room wireframe box -->
	{#if rectEdges}
		<T.LineSegments {position}>
			<T is={rectEdges} />
			<T.LineBasicMaterial color={colors.wireframe} linewidth={2} />
		</T.LineSegments>
	{/if}

	<!-- Semi-transparent floor -->
	<T.Mesh position={[dims.x / 2, 0.001, -dims.y / 2]} rotation.x={-Math.PI / 2}>
		<T.PlaneGeometry args={[dims.x, dims.y]} />
		<T.MeshStandardMaterial color={colors.floor} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
	</T.Mesh>

	<!-- Semi-transparent ceiling -->
	<T.Mesh position={[dims.x / 2, dims.z - 0.001, -dims.y / 2]} rotation.x={-Math.PI / 2}>
		<T.PlaneGeometry args={[dims.x, dims.y]} />
		<T.MeshStandardMaterial color={colors.ceiling} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
	</T.Mesh>

	<!-- Wall indicators (subtle) -->
	<T.Mesh position={[0.001, dims.z / 2, -dims.y / 2]} rotation.y={Math.PI / 2}>
		<T.PlaneGeometry args={[dims.y, dims.z]} />
		<T.MeshStandardMaterial color={colors.walls} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
	</T.Mesh>

	<T.Mesh position={[dims.x / 2, dims.z / 2, 0.001]}>
		<T.PlaneGeometry args={[dims.x, dims.z]} />
		<T.MeshStandardMaterial color={colors.walls} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
	</T.Mesh>
{/if}

{#if room.showDimensions ?? true}
<!-- Axis lines and tick marks -->

<!-- X axis: bottom-front edge (y≈0, z≈0), runs along x -->
<T.Line>
	<T.BufferGeometry>
		<T.BufferAttribute
			attach="attributes-position"
			args={[new Float32Array([
				0, -tickSize, 0,
				dims.x, -tickSize, 0
			]), 3]}
		/>
	</T.BufferGeometry>
	<T.LineBasicMaterial color={colors.axisLine} />
</T.Line>
{#each xTicks as tick}
	{@const xPos = tick}
	<T.Line>
		<T.BufferGeometry>
			<T.BufferAttribute
				attach="attributes-position"
				args={[new Float32Array([
					xPos, -tickSize, 0,
					xPos, -tickSize * 2, 0
				]), 3]}
			/>
		</T.BufferGeometry>
		<T.LineBasicMaterial color={colors.axisLine} />
	</T.Line>
{/each}

<!-- Y axis: bottom-left edge (y≈0, x≈0), runs along Three.js z (room Y) -->
<T.Line>
	<T.BufferGeometry>
		<T.BufferAttribute
			attach="attributes-position"
			args={[new Float32Array([
				-tickSize, -tickSize, 0,
				-tickSize, -tickSize, -dims.y
			]), 3]}
		/>
	</T.BufferGeometry>
	<T.LineBasicMaterial color={colors.axisLine} />
</T.Line>
{#each yTicks as tick}
	{@const zPos = tick}
	<T.Line>
		<T.BufferGeometry>
			<T.BufferAttribute
				attach="attributes-position"
				args={[new Float32Array([
					-tickSize, -tickSize, -zPos,
					-tickSize * 2, -tickSize, -zPos
				]), 3]}
			/>
		</T.BufferGeometry>
		<T.LineBasicMaterial color={colors.axisLine} />
	</T.Line>
{/each}

<!-- Z axis: front-left vertical edge (x≈0, z≈0), runs along Three.js y (room Z / height) -->
<T.Line>
	<T.BufferGeometry>
		<T.BufferAttribute
			attach="attributes-position"
			args={[new Float32Array([
				-tickSize, 0, -tickSize,
				-tickSize, dims.z, -tickSize
			]), 3]}
		/>
	</T.BufferGeometry>
	<T.LineBasicMaterial color={colors.axisLine} />
</T.Line>
{#each zTicks as tick}
	{@const yPos = tick}
	<T.Line>
		<T.BufferGeometry>
			<T.BufferAttribute
				attach="attributes-position"
				args={[new Float32Array([
					-tickSize, yPos, -tickSize,
					-tickSize * 2, yPos, -tickSize
				]), 3]}
			/>
		</T.BufferGeometry>
		<T.LineBasicMaterial color={colors.axisLine} />
	</T.Line>
{/each}

<!-- Tick labels (billboarded - always face camera) -->
<T.Group bind:ref={labelsGroup}>
	{#each xTicks as tick}
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[tick, -tickSize * 3, 0]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}
	{#each yTicks as tick}
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[-tickSize * 3, -tickSize, -tick]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}
	{#each zTicks as tick}
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[-tickSize * 3, tick, -tickSize]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}

</T.Group>
{/if}

{#if room.showCeilingLayout ?? true}
	<!-- Ceiling grid and custom components in 3D -->
	<!-- Tiles Grid -->
	{#each tiles as tile}
		<T.Line position={[tile.x, dims.z - 0.004, -tile.y]}>
			<T.BufferGeometry>
				<T.BufferAttribute
					attach="attributes-position"
					args={[new Float32Array([
						0, 0, 0,
						tile.w, 0, 0,
						tile.w, 0, -tile.h,
						0, 0, -tile.h,
						0, 0, 0
					]), 3]}
				/>
			</T.BufferGeometry>
			<T.LineBasicMaterial color={colors.axisLine} linewidth={2} />
		</T.Line>
	{/each}

	<!-- Custom Placed Components -->
	{#if layout}
		{#each layout.components as comp}
			{#if comp.type === 'smoke_detector'}
				<T.Mesh position={[comp.x, dims.z - 0.01, -comp.y]}>
					<T.CylinderGeometry args={[0.15, 0.15, 0.02, 16]} />
					<T.MeshBasicMaterial color="#ef4444" />
				</T.Mesh>
			{:else if comp.type === 'ventilation'}
				<T.Mesh position={[comp.x, dims.z - 0.005, -comp.y]}>
					<T.BoxGeometry args={[0.28, 0.01, 0.28]} />
					<T.MeshBasicMaterial color="#cbd5e1" />
				</T.Mesh>
			{:else if comp.type === 'sensor'}
				<T.Mesh position={[comp.x, dims.z - 0.04, -comp.y]} rotation.x={Math.PI}>
					<T.ConeGeometry args={[0.06, 0.08, 8]} />
					<T.MeshBasicMaterial color="#10b981" />
				</T.Mesh>
			{:else if comp.type === 'light_fixture'}
				<T.Mesh position={[comp.x + (comp.w || 0.6) / 2, dims.z - 0.002, -(comp.y + (comp.h || 0.6) / 2)]}>
					<T.BoxGeometry args={[comp.w || 0.6, 0.004, comp.h || 0.6]} />
					<T.MeshBasicMaterial color="#fef08a" transparent opacity={0.7} />
				</T.Mesh>
			{:else if comp.type === 'pillar'}
				<!-- Vertical Column -->
				<T.Mesh position={[comp.x + (comp.w || 0.3) / 2, dims.z / 2, -(comp.y + (comp.h || 0.3) / 2)]}>
					<T.BoxGeometry args={[comp.w || 0.3, dims.z, comp.h || 0.3]} />
					<T.MeshStandardMaterial color="#94a3b8" transparent opacity={0.8} roughness={0.7} />
				</T.Mesh>
			{/if}
		{/each}

		<!-- Keep-Out Areas -->
		{#each layout.keepOutAreas as ko}
			<!-- Filled translucent plane -->
			<T.Mesh position={[ko.x + ko.w / 2, dims.z - 0.002, -(ko.y + ko.h / 2)]}>
				<T.BoxGeometry args={[ko.w, 0.002, ko.h]} />
				<T.MeshBasicMaterial color="#ef4444" transparent opacity={0.1} />
			</T.Mesh>
			<!-- Outline -->
			<T.Line position={[ko.x, dims.z - 0.001, -ko.y]}>
				<T.BufferGeometry>
					<T.BufferAttribute
						attach="attributes-position"
						args={[new Float32Array([
							0, 0, 0,
							ko.w, 0, 0,
							ko.w, 0, -ko.h,
							0, 0, -ko.h,
							0, 0, 0
						]), 3]}
					/>
				</T.BufferGeometry>
				<T.LineBasicMaterial color="#ef4444" linewidth={1.5} />
			</T.Line>
		{/each}
	{/if}
{/if}
