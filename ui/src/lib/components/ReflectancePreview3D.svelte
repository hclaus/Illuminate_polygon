<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import type { SurfaceReflectances, SurfaceNumPointsAll } from '$lib/types/project';
	import RoomAxes from './RoomAxes.svelte';

	interface Props {
		roomDims: { x: number; y: number; z: number };
		numPoints: SurfaceNumPointsAll;
		selectedSurface: string | null;
	}

	let { roomDims, numPoints, selectedSurface }: Props = $props();

	// Room dims in Three.js coords: room X→X, room Y→Z, room Z→Y
	const rx = $derived(roomDims.x);
	const ry = $derived(roomDims.y);
	const rz = $derived(roomDims.z);
	const maxDim = $derived(Math.max(rx, ry, rz));

	// Camera
	const cameraDistance = $derived(maxDim * 1.8);
	const center = $derived<[number, number, number]>([rx / 2, rz / 2, -ry / 2]);

	// Scene background
	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color($theme === 'light' ? '#d0d7de' : '#1a1a2e');
	});

	// Check if the room is a polygon room
	import { room } from '$lib/stores/project';
	const isPolygon = $derived(!!$room.polygon && $room.polygon.length > 0);

	// Shape for polygon mode
	const polyShape = $derived.by(() => {
		if (!isPolygon || !$room.polygon) return null;
		const shape = new THREE.Shape();
		const pts = $room.polygon;
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
	const boxGeometry = $derived(new THREE.BoxGeometry(rx, rz, ry));
	const edgesGeometry = $derived(new THREE.EdgesGeometry(boxGeometry));
	const wireColor = $derived($theme === 'light' ? '#4a7fcf' : '#6a9fff');

	// Geometries for polygon mode
	const polyGeometry = $derived.by(() => {
		if (!polyShape) return null;
		return new THREE.ExtrudeGeometry(polyShape, {
			depth: rz,
			bevelEnabled: false
		});
	});
	const polyEdges = $derived(polyGeometry ? new THREE.EdgesGeometry(polyGeometry) : null);
	const floorCeilGeometry = $derived(polyShape ? new THREE.ShapeGeometry(polyShape) : null);

	// Dispose GPU geometry when reassigned or on unmount
	$effect(() => {
		const geo = boxGeometry;
		return () => { geo.dispose(); };
	});
	$effect(() => {
		const geo = edgesGeometry;
		return () => { geo.dispose(); };
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

	// Surface definitions
	interface SurfaceDef {
		key: string;
		position: [number, number, number];
		rotation: [number, number, number];
		size?: [number, number];
		isPolygonShape?: boolean;
	}

	const surfaces = $derived.by<SurfaceDef[]>(() => {
		if (isPolygon && $room.polygon) {
			const pts = $room.polygon;
			const list: SurfaceDef[] = [
				{ key: 'floor',   position: [0, 0.001, 0],        rotation: [-Math.PI / 2, 0, 0], isPolygonShape: true },
				{ key: 'ceiling', position: [0, rz - 0.001, 0],   rotation: [-Math.PI / 2, 0, 0], isPolygonShape: true }
			];
			for (let i = 0; i < pts.length; i++) {
				const p1 = pts[i];
				const p2 = pts[(i + 1) % pts.length];
				const dx = p2[0] - p1[0];
				const dy = p2[1] - p1[1];
				const width = Math.sqrt(dx * dx + dy * dy);
				const angle = -Math.atan2(dy, dx);
				list.push({
					key: `wall_${i}`,
					position: [(p1[0] + p2[0]) / 2, rz / 2, -(p1[1] + p2[1]) / 2],
					rotation: [0, angle, 0],
					size: [width, rz]
				});
			}
			return list;
		} else {
			return [
				{ key: 'floor',   position: [rx / 2, 0.001, -ry / 2],        rotation: [-Math.PI / 2, 0, 0], size: [rx, ry] },
				{ key: 'ceiling', position: [rx / 2, rz - 0.001, -ry / 2],   rotation: [-Math.PI / 2, 0, 0], size: [rx, ry] },
				{ key: 'south',   position: [rx / 2, rz / 2, -0.001],        rotation: [0, 0, 0],             size: [rx, rz] },
				{ key: 'north',   position: [rx / 2, rz / 2, -ry + 0.001],   rotation: [0, 0, 0],             size: [rx, rz] },
				{ key: 'west',    position: [0.001, rz / 2, -ry / 2],        rotation: [0, Math.PI / 2, 0],   size: [ry, rz] },
				{ key: 'east',    position: [rx - 0.001, rz / 2, -ry / 2],   rotation: [0, Math.PI / 2, 0],   size: [ry, rz] },
			];
		}
	});

	// Colors for surfaces
	const highlightColor = '#22d3ee';
	const baseColor = $derived($theme === 'light' ? '#a0a8b0' : '#4a5568');

	// Point size
	const pointSize = $derived(Math.max(0.02, maxDim * 0.012));

	function isPointInPolygon(p: [number, number], vs: [number, number][]): boolean {
		const x = p[0], y = p[1];
		let inside = false;
		for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
			const xi = vs[i][0], yi = vs[i][1];
			const xj = vs[j][0], yj = vs[j][1];
			const intersect = ((yi > y) !== (yj > y))
				&& (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
			if (intersect) inside = !inside;
		}
		return inside;
	}

	// Generate grid points for a surface
	function generateGridPoints(surface: string): Float32Array {
		const np = numPoints[surface];
		if (!np) return new Float32Array([]);
		const npx = Math.min(np.x, 30);
		const npy = Math.min(np.y, 30);

		const positions: number[] = [];

		if (isPolygon && $room.polygon) {
			const pts = $room.polygon;
			if (surface === 'floor' || surface === 'ceiling') {
				const heightVal = surface === 'floor' ? 0 : rz;
				for (let i = 0; i < npx; i++) {
					for (let j = 0; j < npy; j++) {
						const u = (i + 0.5) / npx;
						const v = (j + 0.5) / npy;
						const pX = u * rx;
						const pY = v * ry;
						if (isPointInPolygon([pX, pY], pts)) {
							positions.push(pX, heightVal, -pY);
						}
					}
				}
			} else if (surface.startsWith('wall_')) {
				const idx = parseInt(surface.split('_')[1], 10);
				if (!isNaN(idx) && idx >= 0 && idx < pts.length) {
					const p1 = pts[idx];
					const p2 = pts[(idx + 1) % pts.length];
					for (let i = 0; i < npx; i++) {
						for (let j = 0; j < npy; j++) {
							const u_frac = (i + 0.5) / npx;
							const v_frac = (j + 0.5) / npy;
							const pX = p1[0] + u_frac * (p2[0] - p1[0]);
							const pY = p1[1] + u_frac * (p2[1] - p1[1]);
							const pZ = v_frac * rz;
							positions.push(pX, pZ, -pY);
						}
					}
				}
			}
		} else {
			// Non-polygon rectangular mode
			for (let i = 0; i < npx; i++) {
				for (let j = 0; j < npy; j++) {
					const u = (i + 0.5) / npx;
					const v = (j + 0.5) / npy;
					switch (surface) {
						case 'floor':
							positions.push(u * rx, 0, -v * ry);
							break;
						case 'ceiling':
							positions.push(u * rx, rz, -v * ry);
							break;
						case 'south':
							positions.push(u * rx, v * rz, 0);
							break;
						case 'north':
							positions.push(u * rx, v * rz, -ry);
							break;
						case 'west':
							positions.push(0, v * rz, -u * ry);
							break;
						case 'east':
							positions.push(rx, v * rz, -u * ry);
							break;
					}
				}
			}
		}
		return new Float32Array(positions);
	}

	// Build point geometries reactively
	const pointGeometries = $derived.by(() => {
		const geos: Record<string, THREE.BufferGeometry> = {};
		for (const s of surfaces) {
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.BufferAttribute(generateGridPoints(s.key), 3));
			geos[s.key] = geo;
		}
		return geos;
	});

	// Dispose old geometries when they change
	let prevGeos: Record<string, THREE.BufferGeometry> | null = null;
	$effect(() => {
		const current = pointGeometries;
		if (prevGeos && prevGeos !== current) {
			for (const geo of Object.values(prevGeos)) {
				geo.dispose();
			}
		}
		prevGeos = current;
		return () => {
			if (prevGeos) {
				for (const geo of Object.values(prevGeos)) {
					geo.dispose();
				}
			}
		};
	});
</script>

<!-- Camera + controls -->
<T.PerspectiveCamera
	makeDefault
	position={[center[0] + cameraDistance * 0.7, center[1] + cameraDistance * 0.5, center[2] + cameraDistance * 0.7]}
	fov={50}
>
	<OrbitControls
		enableDamping
		dampingFactor={0.1}
		target={center}
	/>
</T.PerspectiveCamera>

<!-- Lighting -->
<T.AmbientLight intensity={0.5} />
<T.DirectionalLight position={[10, 20, 10]} intensity={0.7} />
<T.DirectionalLight position={[-10, 10, -10]} intensity={0.3} />

<!-- Axes helper (uses RoomAxes for correct room-coordinate orientation) -->
<RoomAxes axisLength={maxDim * 0.15} />

<!-- Room wireframe -->
{#if isPolygon}
	{#if polyEdges}
		<T.LineSegments position={[0, 0, 0]} rotation.x={-Math.PI / 2}>
			<T is={polyEdges} />
			<T.LineBasicMaterial color={wireColor} linewidth={2} />
		</T.LineSegments>
	{/if}
{:else}
	<T.LineSegments position={center}>
		<T is={edgesGeometry} />
		<T.LineBasicMaterial color={wireColor} linewidth={2} />
	</T.LineSegments>
{/if}

<!-- Surface planes -->
{#each surfaces as surf (surf.key)}
	{#if surf.isPolygonShape}
		{#if floorCeilGeometry}
			<T.Mesh
				geometry={floorCeilGeometry}
				position={surf.position}
				rotation={surf.rotation}
			>
				<T.MeshStandardMaterial
					color={selectedSurface === surf.key ? highlightColor : baseColor}
					transparent
					opacity={selectedSurface === surf.key ? 0.45 : 0.15}
					side={THREE.DoubleSide}
					depthWrite={false}
				/>
			</T.Mesh>
		{/if}
	{:else}
		<T.Mesh
			position={surf.position}
			rotation={surf.rotation}
		>
			{#if surf.size}
				<T.PlaneGeometry args={surf.size} />
			{/if}
			<T.MeshStandardMaterial
				color={selectedSurface === surf.key ? highlightColor : baseColor}
				transparent
				opacity={selectedSurface === surf.key ? 0.45 : 0.15}
				side={THREE.DoubleSide}
				depthWrite={false}
			/>
		</T.Mesh>
	{/if}
{/each}

<!-- Grid points on each surface -->
{#each surfaces as surf (surf.key)}
	{#if pointGeometries[surf.key]}
		<T.Points geometry={pointGeometries[surf.key]}>
			<T.PointsMaterial
				color={selectedSurface === surf.key ? highlightColor : '#888888'}
				size={pointSize}
				transparent
				opacity={selectedSurface === surf.key ? 0.9 : 0.4}
				sizeAttenuation={true}
			/>
		</T.Points>
	{/if}
{/each}
