<script lang="ts">
	import { onMount } from 'svelte';
	import { contours as d3Contours } from 'd3-contour';
	import { ticks as d3Ticks } from 'd3';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import { formatValue as appFormatValue } from '$lib/utils/formatting';
	import { theme } from '$lib/stores/theme';
	import { lamps, project } from '$lib/stores/project';
	import { getLampInfo, getSessionLampInfo } from '$lib/api/client';

	interface Props {
		values: number[][];
		zone: CalcZone;
		room: RoomConfig;
		valueFactor?: number;
		units: string;
		valueUnits: string;
		displayDims: { width: number; height: number };
		bounds: {
			u1: number;
			u2: number;
			v1: number;
			v2: number;
			fixed: number;
			uLabel: string;
			vLabel: string;
			fixedLabel: string;
		};
		shouldFlipV: boolean;
	}

	let {
		values,
		zone,
		room,
		valueFactor = 1,
		units,
		valueUnits,
		displayDims,
		bounds,
		shouldFlipV
	}: Props = $props();

	// --- Component State ---
	let levelsStr = $state('0.7, 1.06, 2.13, 3.2, 5.33, 10.6');
	let labelsStr = $state('ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs');
	let colorsStr = $state('#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0');
	let floorColor = $state('#00A24A');
	let sigma = $state(1);
	let filled = $state(true);
	let grid = $state(true);
	let contourLabels = $state(true);
	let equalAspect = $state(true);
	const flipY = $derived(!shouldFlipV);
	let useLampLimits = $state(false);
	let exportScale = $state(2);
	const isSkin = $derived((zone.name || zone.id || '').toLowerCase().includes('skin'));
	const isDose = $derived(zone.dose === true || valueUnits.toLowerCase().includes('mj'));

	const lampSpecificLimitsName = $derived.by(() => {
		const target = isSkin ? 'Skin' : 'Eye';
		const metric = isDose ? 'dose' : 'irradiance';
		return `${target} level ${metric} LSL`;
	});

	let activePreset = $state(getDefaultPresetName());
	let plotTitle = $state(zone.contour_settings?.title ?? zone.name ?? zone.id ?? '');

	let lampTlvAcgihSkin = $state(479);
	let lampTlvAcgihEye = $state(161);
	let lampTlvIcnirpSkin = $state(23);
	let lampTlvIcnirpEye = $state(23);

	async function fetchLampLimits() {
		const firstLamp = $lamps.find(l => l.enabled) || $lamps[0];
		if (!firstLamp) return;

		try {
			let info;
			const isPreset = firstLamp.preset_id && firstLamp.preset_id !== 'custom' && firstLamp.preset_id !== '';
			if (isPreset) {
				info = await getLampInfo(firstLamp.preset_id!, 'log', $theme);
			} else {
				info = await getSessionLampInfo(firstLamp.id);
			}
			if (info && info.tlv_acgih && info.tlv_icnirp) {
				lampTlvAcgihSkin = info.tlv_acgih.skin;
				lampTlvAcgihEye = info.tlv_acgih.eye;
				lampTlvIcnirpSkin = info.tlv_icnirp.skin;
				lampTlvIcnirpEye = info.tlv_icnirp.eye;
			}
		} catch (e) {
			console.warn('Failed to fetch lamp limits for contour plot:', e);
		}
	}

	$effect(() => {
		const _ = $lamps;
		const __ = $theme;
		fetchLampLimits();
	});

	$effect(() => {
		if (useLampLimits) {
			const acgih = isSkin ? lampTlvAcgihSkin : lampTlvAcgihEye;
			const icnirp = isSkin ? lampTlvIcnirpSkin : lampTlvIcnirpEye;

			// Dose limits: ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, 200% ACGIH (ACGIH 4hrs)
			const l1 = icnirp;
			const l2 = 0.2 * acgih;
			const l3 = 0.4 * acgih;
			const l4 = 0.6 * acgih;
			const l5 = acgih;
			const l6 = 2.0 * acgih;

			let derivedLevels: number[];
			if (isDose) {
				derivedLevels = [l1, l2, l3, l4, l5, l6];
			} else {
				derivedLevels = [l1 / 30, l2 / 30, l3 / 30, l4 / 30, l5 / 30, l6 / 30];
			}

			levelsStr = derivedLevels.map(v => {
				if (Number.isInteger(v)) return v.toString();
				return parseFloat(v.toFixed(2)).toString();
			}).join(', ');

			labelsStr = 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs';
			activePreset = lampSpecificLimitsName;
		}
	});

	// Parsed configuration
	let parsedLevels = $derived(levelsStr.split(',').map(s => parseFloat(s.trim())).filter(Number.isFinite));
	let parsedLabels = $derived(labelsStr.split(',').map(s => s.trim()));
	let parsedColors = $derived(colorsStr.split(',').map(s => s.trim()).filter(s => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)));

	// Custom Presets List
	let customPresets = $state<any[]>([]);
	const BUILT_IN_PRESETS = [
		{
			name: 'Eye limits irradiance',
			levels: '0.7, 1.06, 2.13, 3.2, 5.33, 10.6',
			labels: 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
			colors: '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
			floorColor: '#00A24A'
		},
		{
			name: 'Skin limits irradiance',
			levels: '0.7, 3.2, 6.4, 9.6, 15.9, 32',
			labels: 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
			colors: '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
			floorColor: '#00A24A'
		},
		{
			name: 'Eye limits Dose',
			levels: '23, 32, 64, 96, 161, 322',
			labels: 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
			colors: '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
			floorColor: '#00A24A'
		},
		{
			name: 'Skin limits dose',
			levels: '23, 96, 192, 287, 479, 958',
			labels: 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
			colors: '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
			floorColor: '#00A24A'
		},
		{
			name: 'Sequential (5 levels)',
			levels: '0.2, 0.4, 0.6, 0.8, 1.0',
			labels: 'L1, L2, L3, L4, L5',
			colors: '#fee5d9, #fcae91, #fb6a4a, #de2d26, #a50f15',
			floorColor: '#ffffff'
		}
	];

	function getDefaultPresetName(): string {
		const name = (zone.name || zone.id || '').toLowerCase();
		const isDose = name.includes('dose') || zone.dose === true || valueUnits.toLowerCase().includes('mj');
		const isSkin = name.includes('skin');
		const isEye = name.includes('eye');

		if (isDose) {
			if (isSkin) return 'Skin limits dose';
			if (isEye) return 'Eye limits Dose';
			return 'Eye limits Dose';
		} else {
			if (isSkin) return 'Skin limits irradiance';
			if (isEye) return 'Eye limits irradiance';
			return 'Eye limits irradiance';
		}
	}

	// Overlays State
	interface Overlay {
		id: string;
		src: string;
		kind: 'data' | 'asset';
		relX: number;
		relY: number;
		relW: number;
		relH: number;
		rot: number;
		opacity: number;
		computer_path?: string | null;
		img: HTMLImageElement;
	}

	let overlays = $state<Overlay[]>([]);

	function syncToStore() {
		const settings = {
			levels: levelsStr,
			labels: labelsStr,
			colors: colorsStr,
			floorColor,
			sigma,
			filled,
			grid,
			contourLabels,
			equalAspect,
			flipY,
			useLampLimits,
			exportScale,
			activePreset,
			title: plotTitle,
			overlays: overlays.map(o => ({
				id: o.id,
				src: o.src,
				kind: o.kind,
				relX: o.relX,
				relY: o.relY,
				relW: o.relW,
				relH: o.relH,
				rot: o.rot,
				opacity: o.opacity,
				computer_path: o.computer_path || null
			}))
		};
		project.updateZone(zone.id, { contour_settings: settings });
	}

	let isSyncInitialized = false;
	$effect(() => {
		// Track primitive settings to trigger reactive updates
		const _ = {
			levelsStr,
			labelsStr,
			colorsStr,
			floorColor,
			sigma,
			filled,
			grid,
			contourLabels,
			equalAspect,
			useLampLimits,
			exportScale,
			activePreset,
			plotTitle
		};

		if (!isSyncInitialized) {
			isSyncInitialized = true;
			return;
		}

		syncToStore();
	});
	let selectedOverlayId = $state<string | null>(null);
	let selectedOverlay = $derived(overlays.find(o => o.id === selectedOverlayId) || null);
	let labelTargets = $state<Record<number, { gx: number; gy: number }>>({});

	// DOM Elements
	let canvasElement: HTMLCanvasElement;
	let overlayLayer: HTMLDivElement;
	let presetsFileInput: HTMLInputElement;
	let overlayFileInput: HTMLInputElement;

	// Grid calculations
	const numU = $derived(values.length);
	const numV = $derived(values[0]?.length || 0);

	const flatValues = $derived.by(() => {
		const arr = new Float64Array(numU * numV);
		for (let j = 0; j < numV; j++) {
			for (let i = 0; i < numU; i++) {
				arr[j * numU + i] = values[i][j] * valueFactor;
			}
		}
		return arr;
	});

	// Grid Min/Max
	const flatValArray = $derived(Array.from(flatValues));
	const valMin = $derived(flatValArray.length > 0 ? Math.min(...flatValArray) : 0);
	const valMax = $derived(flatValArray.length > 0 ? Math.max(...flatValArray) : 0);

	// Load and Save Presets
	function loadPresets() {
		try {
			const saved = localStorage.getItem('contourPlotter.presets.v1');
			customPresets = saved ? JSON.parse(saved) : [];
		} catch (e) {
			customPresets = [];
		}
	}

	function savePresets(list: any[]) {
		try {
			localStorage.setItem('contourPlotter.presets.v1', JSON.stringify(list));
		} catch (e) {}
	}

	function applyPreset(name: string) {
		const p = BUILT_IN_PRESETS.find(x => x.name === name) || customPresets.find(x => x.name === name);
		if (p) {
			levelsStr = p.levels;
			labelsStr = p.labels;
			colorsStr = p.colors;
			floorColor = p.floorColor;
			activePreset = name;
		}
	}

	function handlePresetChange(e: Event) {
		const val = (e.target as HTMLSelectElement).value;
		if (val === lampSpecificLimitsName) {
			useLampLimits = true;
			activePreset = lampSpecificLimitsName;
		} else if (val !== '__custom__') {
			useLampLimits = false;
			applyPreset(val);
		}
	}

	function saveCurrentPreset() {
		const name = prompt('Preset name:', 'My preset');
		if (!name) return;
		if (BUILT_IN_PRESETS.some(p => p.name === name)) {
			alert('That name is reserved.');
			return;
		}
		const newPreset = {
			name,
			levels: levelsStr,
			labels: labelsStr,
			colors: colorsStr,
			floorColor
		};
		const idx = customPresets.findIndex(p => p.name === name);
		if (idx >= 0) {
			customPresets[idx] = newPreset;
		} else {
			customPresets.push(newPreset);
		}
		savePresets(customPresets);
		activePreset = name;
	}

	function deletePreset() {
		if (BUILT_IN_PRESETS.some(p => p.name === activePreset)) {
			alert('Built-in presets cannot be deleted.');
			return;
		}
		customPresets = customPresets.filter(p => p.name !== activePreset);
		savePresets(customPresets);
		activePreset = '__custom__';
	}

	// Preset Export/Import
	function exportPresets() {
		const data = { app: 'contour-plotter', kind: 'presets', version: 1, presets: customPresets };
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'contour-presets.json';
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	function handleImportPresets(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const obj = JSON.parse(reader.result as string);
				const incoming = Array.isArray(obj) ? obj : obj?.presets || [];
				let added = 0;
				incoming.forEach((p: any) => {
					if (!p?.name || BUILT_IN_PRESETS.some(x => x.name === p.name)) return;
					const clean = {
						name: String(p.name),
						levels: String(p.levels ?? ''),
						labels: String(p.labels ?? ''),
						colors: String(p.colors ?? ''),
						floorColor: p.floorColor || '#000000'
					};
					const idx = customPresets.findIndex(x => x.name === clean.name);
					if (idx >= 0) customPresets[idx] = clean;
					else customPresets.push(clean);
					added++;
				});
				savePresets(customPresets);
				alert(`Imported ${added} preset(s) successfully!`);
			} catch (err) {
				alert('Import failed: invalid JSON file.');
			}
		};
		reader.readAsText(file);
	}

	// Layout and Dimensions
	const margin = { top: 76, bottom: 72, left: 84, right: 244 };
	const cbConfig = { gap: 30, width: 32, labelGap: 14 };
	const maxDataW = 460;
	const maxDataH = 460;

	const layout = $derived.by(() => {
		const extentX = bounds.u2 - bounds.u1 || 1;
		const extentY = bounds.v2 - bounds.v1 || 1;

		let dataW = maxDataW;
		let dataH = maxDataH;

		if (equalAspect) {
			const s = Math.min(maxDataW / extentX, maxDataH / extentY);
			dataW = extentX * s;
			dataH = extentY * s;
		}

		const dataX0 = margin.left;
		const dataY0 = margin.top;
		const figW = margin.left + dataW + margin.right;
		const figH = margin.top + dataH + margin.bottom;

		const mapX = (c: number) => dataX0 + ((c - 0.5) / (numU - 1)) * dataW;
		const mapY = (c: number) => {
			return flipY
				? dataY0 + ((c - 0.5) / (numV - 1)) * dataH
				: dataY0 + dataH - ((c - 0.5) / (numV - 1)) * dataH;
		};

		const invX = (px: number) => ((px - dataX0) / dataW) * (numU - 1) + 0.5;
		const invY = (py: number) => {
			return flipY
				? ((py - dataY0) / dataH) * (numV - 1) + 0.5
				: ((dataY0 + dataH - py) / dataH) * (numV - 1) + 0.5;
		};

		const valToX = (v: number) => dataX0 + ((v - bounds.u1) / extentX) * dataW;
		const valToY = (v: number) => dataY0 + dataH - ((v - bounds.v1) / extentY) * dataH;

		return {
			figW,
			figH,
			dataX0,
			dataY0,
			dataW,
			dataH,
			mapX,
			mapY,
			invX,
			invY,
			valToX,
			valToY,
			cbX: dataX0 + dataW + cbConfig.gap,
			cbW: cbConfig.width,
			cbY0: dataY0,
			cbH: dataH
		};
	});

	// --- 1D Gaussian smoothing of values ---
	function gaussianBlur(values: Float64Array, nx: number, ny: number, sigmaVal: number) {
		if (!sigmaVal || sigmaVal <= 0) return values;
		const radius = Math.max(1, Math.ceil(sigmaVal * 3));
		const kernel = new Float64Array(radius * 2 + 1);
		let sum = 0;
		for (let k = -radius; k <= radius; k++) {
			const w = Math.exp(-(k * k) / (2 * sigmaVal * sigmaVal));
			kernel[k + radius] = w;
			sum += w;
		}
		for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;

		const tmp = new Float64Array(nx * ny);
		const out = new Float64Array(nx * ny);

		// Horizontal pass
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				let acc = 0;
				for (let k = -radius; k <= radius; k++) {
					let ii = i + k;
					if (ii < 0) ii = 0;
					else if (ii >= nx) ii = nx - 1;
					acc += values[j * nx + ii] * kernel[k + radius];
				}
				tmp[j * nx + i] = acc;
			}
		}

		// Vertical pass
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				let acc = 0;
				for (let k = -radius; k <= radius; k++) {
					let jj = j + k;
					if (jj < 0) jj = 0;
					else if (jj >= ny) jj = ny - 1;
					acc += tmp[jj * nx + i] * kernel[k + radius];
				}
				out[j * nx + i] = acc;
			}
		}
		return out;
	}

	// --- Contour Generation ---
	const smoothedValues = $derived(flatValues);

	const contoursRaw = $derived.by(() => {
		const sorted = parsedLevels.slice().sort((a, b) => a - b);
		const gen = d3Contours().size([numU, numV]).smooth(true);
		return sorted.map(lv => gen.contour(Array.from(smoothedValues), lv));
	});

	// Smooth vertices on ring paths
	function smoothRing(ring: [number, number][], s: number): [number, number][] {
		if (s <= 0 || ring.length < 6) return ring;
		const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
		const pts = closed ? ring.slice(0, -1) : ring.slice();
		const n = pts.length;
		if (n < 5) return ring;
		const radius = Math.max(1, Math.ceil(s * 3));
		const kernel: number[] = [];
		let sum = 0;
		for (let k = -radius; k <= radius; k++) {
			const w = Math.exp(-(k * k) / (2 * s * s));
			kernel.push(w);
			sum += w;
		}
		for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;

		const out: [number, number][] = new Array(n);
		for (let i = 0; i < n; i++) {
			let ax = 0, ay = 0;
			for (let k = -radius; k <= radius; k++) {
				const idx = ((i + k) % n + n) % n;
				const w = kernel[k + radius];
				ax += pts[idx][0] * w;
				ay += pts[idx][1] * w;
			}
			out[i] = [ax, ay];
		}
		out.push(out[0].slice() as [number, number]);
		return out;
	}

	const contours = $derived.by(() => {
		if (sigma <= 0) return contoursRaw;
		return contoursRaw.map(mp => ({
			type: mp.type,
			value: mp.value,
			coordinates: mp.coordinates.map(poly => poly.map(ring => smoothRing(ring as [number, number][], sigma)))
		}));
	});

	// Trace path in 2D Canvas context
	function tracePath(ctx: CanvasRenderingContext2D, multipoly: any, mapX: (c: number) => number, mapY: (c: number) => number) {
		ctx.beginPath();
		const coords = multipoly.coordinates;
		for (let p = 0; p < coords.length; p++) {
			const poly = coords[p];
			for (let r = 0; r < poly.length; r++) {
				const ring = poly[r];
				for (let k = 0; k < ring.length; k++) {
					const X = mapX(ring[k][0]);
					const Y = mapY(ring[k][1]);
					if (k === 0) ctx.moveTo(X, Y);
					else ctx.lineTo(X, Y);
				}
				ctx.closePath();
			}
		}
	}

	// Placement of labels
	function labelAnchor(multipoly: any, mapX: (c: number) => number, mapY: (c: number) => number, dataRect: any) {
		const coords = multipoly.coordinates;
		let best: [number, number][] | null = null;
		let bestLen = -1;
		for (let p = 0; p < coords.length; p++) {
			const ring = coords[p][0];
			if (!ring || ring.length < 6) continue;
			let len = 0;
			for (let k = 1; k < ring.length; k++) {
				const dx = ring[k][0] - ring[k - 1][0];
				const dy = ring[k][1] - ring[k - 1][1];
				len += Math.hypot(dx, dy);
			}
			if (len > bestLen) {
				bestLen = len;
				best = ring;
			}
		}
		if (!best) return null;

		let bestPt: any = null;
		let bestScore = -Infinity;
		for (let k = 2; k < best.length - 2; k++) {
			const X = mapX(best[k][0]);
			const Y = mapY(best[k][1]);
			const inset = Math.min(
				X - dataRect.x,
				dataRect.x + dataRect.w - X,
				Y - dataRect.y,
				dataRect.y + dataRect.h - Y
			);
			if (inset < 14) continue;
			const score = (dataRect.y + dataRect.h - Y) + inset * 0.4;
			if (score > bestScore) {
				const a = best[k - 2];
				const b = best[k + 2];
				let ang = Math.atan2(mapY(b[1]) - mapY(a[1]), mapX(b[0]) - mapX(a[0]));
				if (ang > Math.PI / 2) ang -= Math.PI;
				if (ang < -Math.PI / 2) ang += Math.PI;
				bestScore = score;
				bestPt = { x: X, y: Y, angle: ang };
			}
		}
		return bestPt;
	}

	function closestOnContour(multipoly: any, target: { gx: number; gy: number }, L: any) {
		const coords = multipoly.coordinates;
		let best: [number, number] | null = null;
		let bestRing: [number, number][] | null = null;
		let bestK = 0;
		let bestD = Infinity;

		for (let p = 0; p < coords.length; p++) {
			for (let r = 0; r < coords[p].length; r++) {
				const ring = coords[p][r];
				for (let k = 0; k < ring.length; k++) {
					const dx = ring[k][0] - target.gx;
					const dy = ring[k][1] - target.gy;
					const d = dx * dx + dy * dy;
					if (d < bestD) {
						bestD = d;
						best = ring[k] as [number, number];
						bestRing = ring as [number, number][];
						bestK = k;
					}
				}
			}
		}
		if (!best || !bestRing) return null;
		const n = bestRing.length;
		const a = bestRing[(bestK - 2 + n) % n];
		const b = bestRing[(bestK + 2) % n];
		let ang = Math.atan2(L.mapY(b[1]) - L.mapY(a[1]), L.mapX(b[0]) - L.mapX(a[0]));
		if (ang > Math.PI / 2) ang -= Math.PI;
		if (ang < -Math.PI / 2) ang += Math.PI;
		return { x: L.mapX(best[0]), y: L.mapY(best[1]), angle: ang };
	}

	const computedLabels = $derived.by(() => {
		if (!contourLabels) return [];
		const sorted = parsedLevels.slice().sort((a, b) => a - b);
		const out = [];
		const dataRect = { x: layout.dataX0, y: layout.dataY0, w: layout.dataW, h: layout.dataH };

		for (let i = 0; i < sorted.length; i++) {
			const label = parsedLabels[i] ?? `≥ ${appFormatValue(sorted[i], 2)}`;
			const mp = contours[i];
			if (!mp?.coordinates?.length) continue;
			let pt = null;
			if (labelTargets[i]) {
				pt = closestOnContour(mp, labelTargets[i], layout);
			}
			if (!pt) {
				pt = labelAnchor(mp, layout.mapX, layout.mapY, dataRect);
			}
			if (!pt) continue;
			out.push({ i, x: pt.x, y: pt.y, angle: pt.angle, text: label });
		}
		return out;
	});

	// --- Overlay Handlers ---
	function addOverlayImage() {
		overlayFileInput.click();
	}

	function handleOverlayFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			const img = new Image();
			img.onload = () => {
				const ratio = img.naturalWidth / img.naturalHeight || 1;
				const w = Math.min(layout.dataW * 0.22, 240);
				const h = w / ratio;
				const newOverlay: Overlay = {
					id: 'ov_' + Date.now(),
					src: reader.result as string,
					kind: 'data',
					relX: 0.5,
					relY: 0.5,
					relW: w / layout.dataW,
					relH: h / layout.dataH,
					rot: 0,
					opacity: 1,
					computer_path: file.name || '',
					img
				};
				overlays.push(newOverlay);
				selectedOverlayId = newOverlay.id;
				syncToStore();
			};
			img.src = reader.result as string;
		};
		reader.readAsDataURL(file);
	}

	function addHeadOverlay() {
		const img = new Image();
		img.onload = () => {
			const w = layout.dataW * 0.26;
			const h = w;
			const newOverlay: Overlay = {
				id: 'ov_head_' + Date.now(),
				src: '/head-top-view.png',
				kind: 'asset',
				relX: 0.66,
				relY: 0.24,
				relW: w / layout.dataW,
				relH: h / layout.dataH,
				rot: 0,
				opacity: 0.9,
				computer_path: '',
				img
			};
			overlays.push(newOverlay);
			selectedOverlayId = newOverlay.id;
			syncToStore();
		};
		img.src = '/head-top-view.png';
	}

	function removeOverlay(id: string) {
		overlays = overlays.filter(o => o.id !== id);
		if (selectedOverlayId === id) selectedOverlayId = null;
		syncToStore();
	}

	function bringOverlayToFront(id: string) {
		const idx = overlays.findIndex(o => o.id === id);
		if (idx >= 0) {
			const [o] = overlays.splice(idx, 1);
			overlays.push(o);
			syncToStore();
		}
	}

	// --- Overlay Pointer Drag/Resize/Rotate ---
	let isInteracting = false;

	let activeInteraction: {
		type: 'drag' | 'resize' | 'rotate';
		overlayId: string;
		startX: number;
		startY: number;
		startW?: number;
		startH?: number;
		startRot?: number;
		startClientX: number;
		startClientY: number;
	} | null = null;

	function pointerToStageCoords(clientX: number, clientY: number) {
		const rect = overlayLayer.getBoundingClientRect();
		return {
			x: clientX - rect.left,
			y: clientY - rect.top
		};
	}

	function startOverlayDrag(e: PointerEvent, o: Overlay) {
		e.stopPropagation();
		isInteracting = true;
		selectedOverlayId = o.id;
		const stagePt = pointerToStageCoords(e.clientX, e.clientY);
		activeInteraction = {
			type: 'drag',
			overlayId: o.id,
			startX: o.relX * layout.dataW + layout.dataX0,
			startY: o.relY * layout.dataH + layout.dataY0,
			startClientX: stagePt.x,
			startClientY: stagePt.y
		};
		overlayLayer.setPointerCapture(e.pointerId);
	}

	function startOverlayResize(e: PointerEvent, o: Overlay) {
		e.stopPropagation();
		isInteracting = true;
		selectedOverlayId = o.id;
		const stagePt = pointerToStageCoords(e.clientX, e.clientY);
		activeInteraction = {
			type: 'resize',
			overlayId: o.id,
			startX: o.relX * layout.dataW + layout.dataX0,
			startY: o.relY * layout.dataH + layout.dataY0,
			startW: o.relW * layout.dataW,
			startH: o.relH * layout.dataH,
			startClientX: stagePt.x,
			startClientY: stagePt.y
		};
		overlayLayer.setPointerCapture(e.pointerId);
	}

	function startOverlayRotate(e: PointerEvent, o: Overlay) {
		e.stopPropagation();
		isInteracting = true;
		selectedOverlayId = o.id;
		const stagePt = pointerToStageCoords(e.clientX, e.clientY);
		activeInteraction = {
			type: 'rotate',
			overlayId: o.id,
			startX: o.relX * layout.dataW + layout.dataX0,
			startY: o.relY * layout.dataH + layout.dataY0,
			startRot: o.rot,
			startClientX: stagePt.x,
			startClientY: stagePt.y
		};
		overlayLayer.setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!activeInteraction) return;
		const o = overlays.find(x => x.id === activeInteraction?.overlayId);
		if (!o) return;

		const stagePt = pointerToStageCoords(e.clientX, e.clientY);

		if (activeInteraction.type === 'drag') {
			const dx = stagePt.x - activeInteraction.startClientX;
			const dy = stagePt.y - activeInteraction.startClientY;
			const pixelX = activeInteraction.startX + dx;
			const pixelY = activeInteraction.startY + dy;
			o.relX = (pixelX - layout.dataX0) / layout.dataW;
			o.relY = (pixelY - layout.dataY0) / layout.dataH;
		} else if (activeInteraction.type === 'resize') {
			const baseDiag = Math.hypot((activeInteraction.startW ?? 0) / 2, (activeInteraction.startH ?? 0) / 2);
			const currentPixelX = o.relX * layout.dataW + layout.dataX0;
			const currentPixelY = o.relY * layout.dataH + layout.dataY0;
			const dx = stagePt.x - currentPixelX;
			const dy = stagePt.y - currentPixelY;
			const d = Math.hypot(dx, dy);
			const scaleFactor = Math.max(0.1, d / (baseDiag || 1));
			const w = Math.max(20, (activeInteraction.startW ?? 0) * scaleFactor);
			const h = Math.max(20, (activeInteraction.startH ?? 0) * scaleFactor);
			o.relW = w / layout.dataW;
			o.relH = h / layout.dataH;
		} else if (activeInteraction.type === 'rotate') {
			const currentPixelX = o.relX * layout.dataW + layout.dataX0;
			const currentPixelY = o.relY * layout.dataH + layout.dataY0;
			const dy = stagePt.y - currentPixelY;
			const dx = stagePt.x - currentPixelX;
			let ang = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
			if (e.shiftKey) {
				ang = Math.round(ang / 15) * 15;
			}
			o.rot = ang;
		}
	}

	function handlePointerUp(e: PointerEvent) {
		if (activeInteraction) {
			try {
				overlayLayer.releasePointerCapture(e.pointerId);
			} catch (err) {}
			activeInteraction = null;
			syncToStore();
			setTimeout(() => {
				isInteracting = false;
			}, 50);
		}
	}

	// Label Dragging State
	let activeLabelDrag: {
		levelIndex: number;
		el: HTMLDivElement;
	} | null = null;

	function startLabelDrag(e: PointerEvent, levelIndex: number, el: HTMLDivElement) {
		e.preventDefault();
		e.stopPropagation();
		isInteracting = true;
		activeLabelDrag = { levelIndex, el };
		el.setPointerCapture(e.pointerId);
	}

	function handleLabelPointerMove(e: PointerEvent) {
		if (!activeLabelDrag) return;
		const rect = overlayLayer.getBoundingClientRect();
		const fx = e.clientX - rect.left;
		const fy = e.clientY - rect.top;
		const target = { gx: layout.invX(fx), gy: layout.invY(fy) };
		labelTargets[activeLabelDrag.levelIndex] = target;
	}

	function handleLabelPointerUp(e: PointerEvent) {
		if (activeLabelDrag) {
			try {
				activeLabelDrag.el.releasePointerCapture(e.pointerId);
			} catch (err) {}
			activeLabelDrag = null;
			setTimeout(() => {
				isInteracting = false;
			}, 50);
		}
	}

	function handleStageClick(e: MouseEvent) {
		if (isInteracting) return;
		const target = e.target as HTMLElement;
		if (!target.closest('.contour-ov-box')) {
			selectedOverlayId = null;
		}
	}

	// --- Render loop on Canvas ---
	function draw() {
		if (!canvasElement) return;
		const ctx = canvasElement.getContext('2d');
		if (!ctx) return;

		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvasElement.width = Math.round(layout.figW * dpr);
		canvasElement.height = Math.round(layout.figH * dpr);
		canvasElement.style.width = layout.figW + 'px';
		canvasElement.style.height = layout.figH + 'px';

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, layout.figW, layout.figH);

		const dataRect = { x: layout.dataX0, y: layout.dataY0, w: layout.dataW, h: layout.dataH };

		// Band Fills
		ctx.save();
		ctx.beginPath();
		ctx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
		ctx.clip();

		if (filled) {
			// Floor
			ctx.fillStyle = floorColor;
			ctx.fillRect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);

			// Fills ascending
			const sorted = parsedLevels.slice().sort((a, b) => a - b);
			for (let i = 0; i < sorted.length; i++) {
				ctx.fillStyle = parsedColors[i] ?? '#cccccc';
				tracePath(ctx, contours[i], layout.mapX, layout.mapY);
				ctx.fill('evenodd');
			}
		} else {
			ctx.fillStyle = $theme === 'dark' ? '#1a1a2e' : '#ffffff';
			ctx.fillRect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
		}
		ctx.restore();

		// Grid lines
		if (grid) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
			ctx.clip();
			ctx.strokeStyle = $theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);

			const xticks = d3Ticks(bounds.u1, bounds.u2, 7);
			const yticks = d3Ticks(bounds.v1, bounds.v2, 9);

			xticks.forEach(t => {
				const X = layout.valToX(t);
				ctx.beginPath();
				ctx.moveTo(X, dataRect.y);
				ctx.lineTo(X, dataRect.y + dataRect.h);
				ctx.stroke();
			});

			yticks.forEach(t => {
				const Y = layout.valToY(t);
				ctx.beginPath();
				ctx.moveTo(dataRect.x, Y);
				ctx.lineTo(dataRect.x + dataRect.w, Y);
				ctx.stroke();
			});
			ctx.restore();
		}

		// Contour curves
		ctx.save();
		ctx.beginPath();
		ctx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
		ctx.clip();
		ctx.lineJoin = 'round';
		for (let i = 0; i < contours.length; i++) {
			ctx.strokeStyle = $theme === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(20,22,28,0.75)';
			ctx.lineWidth = 1.4;
			tracePath(ctx, contours[i], layout.mapX, layout.mapY);
			ctx.stroke();
		}
		ctx.restore();

		// Data area border
		ctx.strokeStyle = $theme === 'dark' ? '#555555' : '#3a3f4a';
		ctx.lineWidth = 1.25;
		ctx.strokeRect(dataRect.x + 0.5, dataRect.y + 0.5, dataRect.w, dataRect.h);

		// Axes ticks and labels
		ctx.fillStyle = $theme === 'dark' ? '#dddddd' : '#2a2e37';
		ctx.strokeStyle = $theme === 'dark' ? '#555555' : '#3a3f4a';
		ctx.lineWidth = 1;
		ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';

		const xticks = d3Ticks(bounds.u1, bounds.u2, 7);
		const yticks = d3Ticks(bounds.v1, bounds.v2, 9);

		xticks.forEach(t => {
			const X = layout.valToX(t);
			if (X < dataRect.x - 0.5 || X > dataRect.x + dataRect.w + 0.5) return;
			ctx.beginPath();
			ctx.moveTo(X, dataRect.y + dataRect.h);
			ctx.lineTo(X, dataRect.y + dataRect.h + 6);
			ctx.stroke();
			ctx.fillText(t.toFixed(2), X, dataRect.y + dataRect.h + 10);
		});

		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		yticks.forEach(t => {
			const Y = layout.valToY(t);
			if (Y < dataRect.y - 0.5 || Y > dataRect.y + dataRect.h + 0.5) return;
			ctx.beginPath();
			ctx.moveTo(dataRect.x, Y);
			ctx.lineTo(dataRect.x - 6, Y);
			ctx.stroke();
			ctx.fillText(t.toFixed(2), dataRect.x - 10, Y);
		});

		// Axis labels
		ctx.fillStyle = $theme === 'dark' ? '#aaaaaa' : '#4a505c';
		ctx.font = '13px "IBM Plex Sans", sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'alphabetic';
		ctx.fillText(`${bounds.uLabel} (${units})`, dataRect.x + dataRect.w / 2, layout.figH - 20);

		ctx.save();
		ctx.translate(24, dataRect.y + dataRect.h / 2);
		ctx.rotate(-Math.PI / 2);
		ctx.textBaseline = 'alphabetic';
		ctx.fillText(`${bounds.vLabel} (${units})`, 0, 0);
		ctx.restore();

		// Color bar legend
		drawColorbar(ctx);

		// Draw Title
		ctx.fillStyle = $theme === 'dark' ? '#ffffff' : '#15171c';
		ctx.font = '600 20px "IBM Plex Sans", system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(plotTitle, dataRect.x + dataRect.w / 2, margin.top / 2 + 4);
	}

	function drawColorbar(ctx: CanvasRenderingContext2D) {
		const sorted = parsedLevels.slice().sort((a, b) => a - b);
		const n = sorted.length;
		const segs = n + 1;
		const segH = layout.cbH / segs;
		const x = layout.cbX;
		const w = layout.cbW;
		const yTop = layout.cbY0;
		const segColors = [floorColor].concat(parsedColors.slice(0, n));

		for (let s = 0; s < segs; s++) {
			const yy = yTop + layout.cbH - (s + 1) * segH;
			ctx.fillStyle = segColors[s] ?? '#cccccc';
			ctx.fillRect(x, yy, w, segH);
		}

		ctx.strokeStyle = $theme === 'dark' ? '#555555' : '#3a3f4a';
		ctx.lineWidth = 1;
		ctx.strokeRect(x + 0.5, yTop + 0.5, w, layout.cbH);

		// Separators
		ctx.strokeStyle = $theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(58,63,74,0.6)';
		for (let s = 1; s < segs; s++) {
			const yy = yTop + layout.cbH - s * segH;
			ctx.beginPath();
			ctx.moveTo(x, yy);
			ctx.lineTo(x + w, yy);
			ctx.stroke();
		}

		// Labels next to colorbar
		ctx.fillStyle = $theme === 'dark' ? '#dddddd' : '#1f2229';
		ctx.font = '13px "IBM Plex Sans", sans-serif';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		for (let i = 0; i < n; i++) {
			const lab = parsedLabels[i] || `≥ ${sorted[i].toFixed(2)}`;
			const cy = yTop + layout.cbH - (i + 1) * segH;
			ctx.beginPath();
			ctx.strokeStyle = $theme === 'dark' ? '#777777' : '#9aa1ad';
			ctx.moveTo(x + w, cy);
			ctx.lineTo(x + w + 8, cy);
			ctx.stroke();
			ctx.fillText(lab, x + w + 12, cy);
		}
	}

	// Trigger draw on state change
	$effect(() => {
		draw();
	});

	// --- Save PNG (export including overlays) ---
	function savePNG() {
		if (!canvasElement) return;

		const scale = exportScale;
		const exportCanvas = document.createElement('canvas');
		exportCanvas.width = Math.round(layout.figW * scale);
		exportCanvas.height = Math.round(layout.figH * scale);
		const octx = exportCanvas.getContext('2d');
		if (!octx) return;

		octx.setTransform(scale, 0, 0, scale, 0, 0);

		// Render the figures
		const sorted = parsedLevels.slice().sort((a, b) => a - b);
		const outContours = contours;

		const dataRect = { x: layout.dataX0, y: layout.dataY0, w: layout.dataW, h: layout.dataH };

		// Band fills (forced white bg for file save)
		octx.fillStyle = '#ffffff';
		octx.fillRect(0, 0, layout.figW, layout.figH);

		octx.save();
		octx.beginPath();
		octx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
		octx.clip();

		if (filled) {
			octx.fillStyle = floorColor;
			octx.fillRect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
			for (let i = 0; i < sorted.length; i++) {
				octx.fillStyle = parsedColors[i] ?? '#cccccc';
				tracePath(octx, outContours[i], layout.mapX, layout.mapY);
				octx.fill('evenodd');
			}
		}
		octx.restore();

		// Grid lines
		if (grid) {
			octx.save();
			octx.beginPath();
			octx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
			octx.clip();
			octx.strokeStyle = 'rgba(0,0,0,0.15)';
			octx.lineWidth = 1;
			octx.setLineDash([4, 4]);

			const xticks = d3Ticks(bounds.u1, bounds.u2, 7);
			const yticks = d3Ticks(bounds.v1, bounds.v2, 9);

			xticks.forEach(t => {
				const X = layout.valToX(t);
				octx.beginPath();
				octx.moveTo(X, dataRect.y);
				octx.lineTo(X, dataRect.y + dataRect.h);
				octx.stroke();
			});

			yticks.forEach(t => {
				const Y = layout.valToY(t);
				octx.beginPath();
				octx.moveTo(dataRect.x, Y);
				octx.lineTo(dataRect.x + dataRect.w, Y);
				octx.stroke();
			});
			octx.restore();
		}

		// Contour curves
		octx.save();
		octx.beginPath();
		octx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
		octx.clip();
		octx.lineJoin = 'round';
		for (let i = 0; i < outContours.length; i++) {
			octx.strokeStyle = 'rgba(20,22,28,0.75)';
			octx.lineWidth = 1.4;
			tracePath(octx, outContours[i], layout.mapX, layout.mapY);
			octx.stroke();
		}
		octx.restore();

		// Draw contour labels directly on canvas for export
		if (contourLabels) {
			octx.save();
			octx.font = '600 13px "IBM Plex Mono", monospace';
			octx.textAlign = 'center';
			octx.textBaseline = 'middle';
			for (const pl of computedLabels) {
				octx.save();
				octx.translate(pl.x, pl.y);
				octx.rotate(pl.angle);
				octx.lineWidth = 3.5;
				octx.strokeStyle = 'rgba(255,255,255,0.92)';
				octx.strokeText(pl.text, 0, 0);
				octx.fillStyle = '#15171c';
				octx.fillText(pl.text, 0, 0);
				octx.restore();
			}
			octx.restore();
		}

		// Draw overlays onto export context
		for (const o of overlays) {
			const px = o.relX * layout.dataW + layout.dataX0;
			const py = o.relY * layout.dataH + layout.dataY0;
			const pw = o.relW * layout.dataW;
			const ph = o.relH * layout.dataH;
			octx.save();
			octx.globalAlpha = o.opacity;
			octx.translate(px, py);
			octx.rotate(o.rot * Math.PI / 180);
			try {
				octx.drawImage(o.img, -pw / 2, -ph / 2, pw, ph);
			} catch (e) {
				console.error('Failed to draw overlay:', e);
			}
			octx.restore();
		}

		// Border, ticks & titles
		octx.strokeStyle = '#3a3f4a';
		octx.lineWidth = 1.25;
		octx.strokeRect(dataRect.x + 0.5, dataRect.y + 0.5, dataRect.w, dataRect.h);

		octx.fillStyle = '#2a2e37';
		octx.strokeStyle = '#3a3f4a';
		octx.lineWidth = 1;
		octx.font = '12px "IBM Plex Sans", sans-serif';
		octx.textAlign = 'center';
		octx.textBaseline = 'top';

		const xticks = d3Ticks(bounds.u1, bounds.u2, 7);
		const yticks = d3Ticks(bounds.v1, bounds.v2, 9);

		xticks.forEach(t => {
			const X = layout.valToX(t);
			if (X < dataRect.x - 0.5 || X > dataRect.x + dataRect.w + 0.5) return;
			octx.beginPath();
			octx.moveTo(X, dataRect.y + dataRect.h);
			octx.lineTo(X, dataRect.y + dataRect.h + 6);
			octx.stroke();
			octx.fillText(t.toFixed(2), X, dataRect.y + dataRect.h + 10);
		});

		octx.textAlign = 'right';
		octx.textBaseline = 'middle';
		yticks.forEach(t => {
			const Y = layout.valToY(t);
			if (Y < dataRect.y - 0.5 || Y > dataRect.y + dataRect.h + 0.5) return;
			octx.beginPath();
			octx.moveTo(dataRect.x, Y);
			octx.lineTo(dataRect.x - 6, Y);
			octx.stroke();
			octx.fillText(t.toFixed(2), dataRect.x - 10, Y);
		});

		octx.fillStyle = '#4a505c';
		octx.font = '13px "IBM Plex Sans", sans-serif';
		octx.textAlign = 'center';
		octx.textBaseline = 'alphabetic';
		octx.fillText(`${bounds.uLabel} (${units})`, dataRect.x + dataRect.w / 2, layout.figH - 20);

		octx.save();
		octx.translate(24, dataRect.y + dataRect.h / 2);
		octx.rotate(-Math.PI / 2);
		octx.textBaseline = 'alphabetic';
		octx.fillText(`${bounds.vLabel} (${units})`, 0, 0);
		octx.restore();

		// Title
		octx.fillStyle = '#15171c';
		octx.font = '600 20px "IBM Plex Sans", sans-serif';
		octx.textAlign = 'center';
		octx.textBaseline = 'middle';
		octx.fillText(plotTitle, dataRect.x + dataRect.w / 2, margin.top / 2 + 4);

		drawColorbar(octx);

		// Save the PNG blob
		exportCanvas.toBlob(blob => {
			if (!blob) return;
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			const filename = (plotTitle || zone.name || 'contours').trim().replace(/\s+/g, '_');
			a.download = `${filename}.png`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		}, 'image/png');
	}

	onMount(() => {
		loadPresets();

		if (zone.contour_settings) {
			const s = zone.contour_settings;
			levelsStr = s.levels;
			labelsStr = s.labels;
			colorsStr = s.colors;
			floorColor = s.floorColor;
			sigma = s.sigma;
			filled = s.filled;
			grid = s.grid;
			contourLabels = s.contourLabels;
			equalAspect = s.equalAspect;
			useLampLimits = s.useLampLimits ?? false;
			exportScale = s.exportScale;
			activePreset = s.activePreset === 'Lamp specific limits' ? lampSpecificLimitsName : s.activePreset;
			plotTitle = s.title ?? zone.name ?? zone.id ?? '';

			if (s.overlays) {
				overlays = s.overlays.map(o => {
					const img = new Image();
					img.onload = () => {
						// Trigger redraw on image load
						draw();
					};
					img.src = o.src;
					return {
						id: o.id,
						src: o.src,
						kind: o.kind,
						relX: o.relX,
						relY: o.relY,
						relW: o.relW,
						relH: o.relH,
						rot: o.rot,
						opacity: o.opacity,
						computer_path: o.computer_path,
						img
					};
				});
			}
		} else {
			const defaultPreset = getDefaultPresetName();
			applyPreset(defaultPreset);

			// Automatically add 2 heads for eye_directional zones if none exist
			if (zone.calc_mode === 'eye_directional') {
				const hasAutoHeads = overlays.some(o => o.id.startsWith('ov_auto_head_'));
				if (!hasAutoHeads) {
					const img = new Image();
					img.onload = () => {
						const headSize = Math.min(layout.dataW, layout.dataH) * 0.20;
						
						// Determine direction vector
						let vu = 0, vv = 0;
						const ref = zone.ref_surface || 'xy';
						const dir = zone.view_direction || [0, 1, 0];
						if (ref === 'xz') {
							vu = dir[0];
							vv = dir[2];
						} else if (ref === 'yz') {
							vu = dir[1];
							vv = dir[2];
						} else {
							vu = dir[0];
							vv = dir[1];
						}

						// Calculate rotation angle (0 is right, -90 is up, 90 is down, 180 is left)
						const rot = -Math.atan2(vv, vu) * (180 / Math.PI);

						// Determine grid coordinates for the 2 heads (opposite side of view direction)
						let g1u = 0, g1v = 0;
						let g2u = 0, g2v = 0;

						if (Math.abs(vv) >= Math.abs(vu)) {
							// Vertical is dominant
							if (vv > 0) {
								// Looking UP (positive v) -> place on BOTTOM edge
								g1u = numU * (1 / 3);
								g1v = 0.5;
								g2u = numU * (2 / 3);
								g2v = 0.5;
							} else {
								// Looking DOWN (negative v) -> place on TOP edge
								g1u = numU * (1 / 3);
								g1v = numV - 0.5;
								g2u = numU * (2 / 3);
								g2v = numV - 0.5;
							}
						} else {
							// Horizontal is dominant
							if (vu > 0) {
								// Looking RIGHT (positive u) -> place on LEFT edge
								g1u = 0.5;
								g1v = numV * (1 / 3);
								g2u = 0.5;
								g2v = numV * (2 / 3);
							} else {
								// Looking LEFT (negative u) -> place on RIGHT edge
								g1u = numU - 0.5;
								g1v = numV * (1 / 3);
								g2u = numU - 0.5;
								g2v = numV * (2 / 3);
							}
						}

						// Map grid to stage coordinates
						const x1 = layout.mapX(g1u);
						const y1 = layout.mapY(g1v);
						const x2 = layout.mapX(g2u);
						const y2 = layout.mapY(g2v);

						const head1: Overlay = {
							id: 'ov_auto_head_1_' + Date.now(),
							src: '/head-top-view.png',
							kind: 'asset',
							relX: (x1 - layout.dataX0) / layout.dataW,
							relY: (y1 - layout.dataY0) / layout.dataH,
							relW: headSize / layout.dataW,
							relH: headSize / layout.dataH,
							rot,
							opacity: 0.9,
							computer_path: '',
							img
						};

						const head2: Overlay = {
							id: 'ov_auto_head_2_' + Date.now(),
							src: '/head-top-view.png',
							kind: 'asset',
							relX: (x2 - layout.dataX0) / layout.dataW,
							relY: (y2 - layout.dataY0) / layout.dataH,
							relW: headSize / layout.dataW,
							relH: headSize / layout.dataH,
							rot,
							opacity: 0.9,
							computer_path: '',
							img
						};

						overlays.push(head1, head2);
						syncToStore();
					};
					img.src = '/head-top-view.png';
				}
			}
		}
	});
</script>

<div class="contour-app">
	<!-- Sidebar Controls -->
	<aside class="contour-sidebar">
		<div class="contour-sidebar-scroll">
			<!-- Plot Title Card -->
			<div class="contour-card">
				<h3 class="contour-card-title">Plot Title</h3>
				<div class="contour-field" style="margin-bottom: 0;">
					<input
						type="text"
						class="contour-text"
						bind:value={plotTitle}
						placeholder="Enter plot title..."
					/>
				</div>
			</div>

			<!-- Presets Card -->
			<div class="contour-card">
				<h3 class="contour-card-title">Presets</h3>
				<div class="contour-field">
					<div class="contour-row gap">
						<select class="contour-select grow" value={useLampLimits ? lampSpecificLimitsName : activePreset} onchange={handlePresetChange}>
							{#if useLampLimits}
								<option value={lampSpecificLimitsName}>{lampSpecificLimitsName}</option>
							{/if}
							<option value="__custom__">Custom</option>
							{#each BUILT_IN_PRESETS as p}
								<option value={p.name}>{p.name}</option>
							{/each}
							{#each customPresets as p}
								<option value={p.name}>{p.name} ★</option>
							{/each}
						</select>
						<button class="contour-btn" onclick={saveCurrentPreset} title="Save preset" disabled={useLampLimits}>Save</button>
						<button class="contour-btn" onclick={deletePreset} title="Delete preset" disabled={useLampLimits}>Del</button>
					</div>
					<div class="contour-row gap" style="margin-top:8px;">
						<button class="contour-linkbtn" onclick={exportPresets}>Export presets</button>
						<span style="color: var(--color-text-muted);">·</span>
						<button class="contour-linkbtn" onclick={() => presetsFileInput.click()}>Import</button>
						<input type="file" bind:this={presetsFileInput} accept=".json" onchange={handleImportPresets} hidden />
					</div>
				</div>
			</div>

			<!-- Thresholds Card -->
			<div class="contour-card">
				<h3 class="contour-card-title">Thresholds</h3>
				<div class="contour-field">
					<label for="levels">Levels <span class="contour-hint">comma-separated</span></label>
					<input id="levels" type="text" class="contour-text mono" bind:value={levelsStr} oninput={() => { activePreset = '__custom__'; useLampLimits = false; }} disabled={useLampLimits} />
				</div>
				<div class="contour-field">
					<label for="labels">Labels</label>
					<input id="labels" type="text" class="contour-text" bind:value={labelsStr} oninput={() => { activePreset = '__custom__'; useLampLimits = false; }} disabled={useLampLimits} />
				</div>
				<div class="contour-field">
					<label for="colors">Band colors</label>
					<input id="colors" type="text" class="contour-text mono" bind:value={colorsStr} oninput={() => activePreset = '__custom__'} />
					<div class="contour-swatch-row">
						{#each parsedColors as c, i}
							<button
								class="contour-swatch"
								style="background: {c};"
								title="{c} - click to change"
								onclick={() => {
									const input = document.createElement('input');
									input.type = 'color';
									input.value = c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
									input.oninput = () => {
										const arr = parsedColors.slice();
										arr[i] = input.value;
										colorsStr = arr.join(', ');
										activePreset = '__custom__';
									};
									input.click();
								}}
							></button>
						{/each}
					</div>
				</div>
				<div class="contour-field">
					<label>Floor color <span class="contour-hint">below lowest level</span></label>
					<div class="contour-row gap center">
						<button
							class="contour-swatch big"
							style="background: {floorColor};"
							onclick={() => {
								const input = document.createElement('input');
								input.type = 'color';
								input.value = floorColor;
								input.oninput = () => {
									floorColor = input.value;
									activePreset = '__custom__';
								};
								input.click();
							}}
						></button>
						<span class="mono muted small">{floorColor}</span>
					</div>
				</div>
			</div>

			<!-- Smoothing Card -->
			<div class="contour-card">
				<h3 class="contour-card-title">Smoothing</h3>
				<div class="contour-field">
					<label for="sigma-range">Sigma: <span class="mono muted">{sigma.toFixed(1)}</span></label>
					<input id="sigma-range" type="range" min="0" max="3" step="0.1" bind:value={sigma} />
				</div>
			</div>

			<!-- Display Config Card -->
			<div class="contour-card">
				<h3 class="contour-card-title">Display</h3>
				<label class="contour-switch">
					<input type="checkbox" bind:checked={filled} />
					<span class="contour-track"></span>
					<span class="contour-switch-label">Filled bands</span>
				</label>
				<label class="contour-switch">
					<input type="checkbox" bind:checked={contourLabels} />
					<span class="contour-track"></span>
					<span class="contour-switch-label">Contour labels</span>
				</label>
				<label class="contour-switch">
					<input type="checkbox" bind:checked={grid} />
					<span class="contour-track"></span>
					<span class="contour-switch-label">Grid lines</span>
				</label>
				<label class="contour-switch">
					<input type="checkbox" bind:checked={equalAspect} />
					<span class="contour-track"></span>
					<span class="contour-switch-label">Equal aspect ratio</span>
				</label>
				<label class="contour-switch">
					<input type="checkbox" bind:checked={useLampLimits} />
					<span class="contour-track"></span>
					<span class="contour-switch-label">Use {lampSpecificLimitsName}</span>
				</label>
			</div>

			<!-- Overlays Card -->
			<div class="contour-card">
				<h3 class="contour-card-title">Overlays</h3>
				<div class="contour-row gap">
					<button class="contour-btn grow" onclick={addOverlayImage}>Add Image...</button>
					<button class="contour-btn grow" onclick={addHeadOverlay}>Add Head</button>
					<input type="file" bind:this={overlayFileInput} accept="image/*" onchange={handleOverlayFile} hidden />
				</div>

				{#if overlays.length > 0}
					<div class="contour-overlay-list">
						{#each overlays as o, idx}
							<div class="contour-ov-item" class:active={o.id === selectedOverlayId}>
								<div class="contour-ov-thumb" style="background-image: url('{o.src}')"></div>
								<div class="contour-ov-meta">
									<div class="contour-ov-row">
										<span class="contour-ov-mini">Overlay {idx + 1}</span>
									</div>
									<div class="contour-ov-row">
										<span class="contour-ov-mini">Opacity</span>
										<input type="range" min="0.1" max="1" step="0.05" bind:value={o.opacity} oninput={syncToStore} />
									</div>
									<div class="contour-ov-row" style="margin-top: 4px;">
										<span class="contour-ov-mini">Path</span>
										<input
											type="text"
											class="contour-text small"
											style="padding: 2px 4px; font-size: 0.65rem;"
											placeholder="Computer Path..."
											bind:value={o.computer_path}
											oninput={syncToStore}
										/>
									</div>
								</div>
								<div class="contour-ov-buttons">
									<button class="contour-ov-btn" title="Bring to front" onclick={() => bringOverlayToFront(o.id)}>▲</button>
									<button class="contour-ov-btn del" title="Delete overlay" onclick={() => removeOverlay(o.id)}>✕</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<footer class="contour-sidebar-foot">
			<div class="contour-row gap center">
				<span class="contour-foot-label">Export Scale:</span>
				<select class="contour-select small" bind:value={exportScale}>
					<option value={1}>1×</option>
					<option value={2}>2×</option>
					<option value={3}>3×</option>
				</select>
				<button class="contour-btn grow contour-btn-primary" onclick={savePNG}>Save PNG</button>
			</div>
		</footer>
	</aside>

	<!-- Stage Viewport -->
	<main class="contour-stage" onclick={handleStageClick}>
		<div class="contour-title-container">
			<input
				type="text"
				class="contour-title-input"
				bind:value={plotTitle}
				placeholder="Enter plot title..."
			/>
		</div>
		<div class="contour-stage-area">
			<div class="contour-figure-wrap" style="width: {layout.figW}px; height: {layout.figH}px;">
				<!-- Drawing Canvas -->
				<canvas bind:this={canvasElement}></canvas>

				<!-- Overlay Interaction Layer -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					bind:this={overlayLayer}
					class="contour-overlay-layer"
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
				>
					{#each overlays as o}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="contour-ov-box"
							class:selected={o.id === selectedOverlayId}
							style="left: {o.relX * layout.dataW + layout.dataX0}px; top: {o.relY * layout.dataH + layout.dataY0}px; width: {o.relW * layout.dataW}px; height: {o.relH * layout.dataH}px; transform: translate(-50%, -50%) rotate({o.rot}deg);"
							onpointerdown={(e) => startOverlayDrag(e, o)}
						>
							<img src={o.src} alt="overlay" draggable="false" style="opacity: {o.opacity};" />
							{#if o.id === selectedOverlayId}
								<div class="contour-ov-frame"></div>
								<!-- Resize corner handles -->
								<div class="contour-ov-handle contour-ov-nw" style="left: 0; top: 0;" onpointerdown={(e) => startOverlayResize(e, o)}></div>
								<div class="contour-ov-handle contour-ov-ne" style="left: 100%; top: 0;" onpointerdown={(e) => startOverlayResize(e, o)}></div>
								<div class="contour-ov-handle contour-ov-se" style="left: 100%; top: 100%;" onpointerdown={(e) => startOverlayResize(e, o)}></div>
								<div class="contour-ov-handle contour-ov-sw" style="left: 0; top: 100%;" onpointerdown={(e) => startOverlayResize(e, o)}></div>
								<!-- Rotation stem & handle -->
								<div class="contour-ov-rotstem"></div>
								<div class="contour-ov-rothandle" onpointerdown={(e) => startOverlayRotate(e, o)}></div>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Draggable Contour Labels Layer -->
				<div class="contour-label-layer">
					{#each computedLabels as pl}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="contour-c-label"
							style="left: {pl.x}px; top: {pl.y}px; transform: translate(-50%, -50%) rotate({(pl.angle * 180) / Math.PI}deg);"
							onpointerdown={(e) => startLabelDrag(e, pl.i, e.currentTarget as HTMLDivElement)}
							onpointermove={handleLabelPointerMove}
							onpointerup={handleLabelPointerUp}
						>
							{pl.text}
						</div>
					{/each}
				</div>
			</div>
		</div>
	</main>
</div>

<style>
	:global(.contour-app) {
		--contour-bg: var(--color-bg-secondary, #e9ecf1);
		--contour-panel: var(--color-bg-primary, #ffffff);
		--contour-panel-2: var(--color-bg-tertiary, #f6f7f9);
		--contour-ink: var(--color-text, #15171c);
		--contour-ink-2: var(--color-text-muted, #3c424d);
		--contour-muted: var(--color-text-muted, #79808d);
		--contour-line: var(--color-border, #e3e6ec);
		--contour-line-2: var(--color-border, #d4d9e1);
		--contour-accent: var(--color-primary, #3656d8);
		--contour-accent-soft: var(--color-primary-soft, #eef1fd);
		--contour-danger: #c2453a;
		--contour-radius: var(--radius-md, 8px);
	}

	.contour-app {
		display: grid;
		grid-template-columns: 290px 1fr;
		height: 580px;
		width: 100%;
		overflow: hidden;
		background: var(--contour-bg);
		border-radius: var(--contour-radius);
	}

	.contour-sidebar {
		display: flex;
		flex-direction: column;
		background: var(--contour-panel);
		border-right: 1px solid var(--contour-line);
		min-height: 0;
	}

	.contour-sidebar-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 10px;
	}

	.contour-sidebar-scroll::-webkit-scrollbar {
		width: 6px;
	}

	.contour-sidebar-scroll::-webkit-scrollbar-thumb {
		background: var(--contour-line-2);
		border-radius: 4px;
	}

	.contour-card {
		background: var(--contour-panel);
		border: 1px solid var(--contour-line);
		border-radius: var(--contour-radius);
		padding: 10px;
		margin-bottom: 8px;
	}

	.contour-card-title {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--contour-muted);
		margin: 0 0 8px 0;
	}

	.contour-field {
		margin-bottom: 8px;
	}

	.contour-field:last-child {
		margin-bottom: 0;
	}

	.contour-field > label {
		display: block;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--contour-ink-2);
		margin-bottom: 4px;
	}

	.contour-hint {
		font-weight: 400;
		color: var(--contour-muted);
		font-size: 0.65rem;
	}

	.contour-text,
	.contour-select {
		width: 100%;
		padding: 4px 8px;
		font-size: 0.75rem;
		border: 1px solid var(--contour-line-2);
		border-radius: 4px;
		background: var(--contour-panel);
		color: var(--contour-ink);
		font-family: inherit;
	}

	.contour-text:focus,
	.contour-select:focus {
		outline: none;
		border-color: var(--contour-accent);
		box-shadow: 0 0 0 2px var(--contour-accent-soft);
	}

	.contour-text.mono,
	.mono {
		font-family: var(--font-mono, monospace);
	}

	.small {
		font-size: 0.7rem;
	}

	.muted {
		color: var(--contour-muted);
	}

	.contour-row {
		display: flex;
		align-items: stretch;
	}

	.contour-row.gap {
		gap: 6px;
	}

	.contour-row.center {
		align-items: center;
	}

	.grow {
		flex: 1;
	}

	.contour-btn {
		border: 1px solid var(--contour-line-2);
		background: var(--contour-panel);
		color: var(--contour-ink);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.1s, border-color 0.1s;
		white-space: nowrap;
	}

	.contour-btn:hover {
		background: var(--contour-panel-2);
	}

	.contour-btn-primary {
		background: var(--contour-accent);
		border-color: var(--contour-accent);
		color: #fff;
		font-weight: 600;
	}

	.contour-btn-primary:hover {
		background: var(--contour-accent);
		opacity: 0.9;
	}

	.contour-linkbtn {
		background: none;
		border: none;
		color: var(--contour-accent);
		font-size: 0.7rem;
		cursor: pointer;
		padding: 2px 0 0;
		font-family: inherit;
		font-weight: 500;
	}

	.contour-linkbtn:hover {
		text-decoration: underline;
	}

	/* Swatches */
	.contour-swatch-row {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}

	.contour-swatch {
		width: 20px;
		height: 16px;
		border-radius: 3px;
		cursor: pointer;
		border: 1px solid rgba(0, 0, 0, 0.15);
		padding: 0;
		position: relative;
	}

	.contour-swatch.big {
		width: 28px;
		height: 20px;
	}

	.contour-swatch::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
	}

	/* Range inputs */
	input[type='range'] {
		width: 100%;
		accent-color: var(--contour-accent);
		margin: 4px 0;
	}

	/* Switch component */
	.contour-switch {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		cursor: pointer;
	}

	.contour-switch input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.contour-track {
		width: 28px;
		height: 16px;
		border-radius: 8px;
		background: #cdd2db;
		position: relative;
		transition: background 0.12s;
		flex: none;
	}

	.contour-track::after {
		content: '';
		position: absolute;
		top: 1px;
		left: 1px;
		width: 14px;
		height: 14px;
		background: #fff;
		border-radius: 50%;
		transition: transform 0.12s;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
	}

	.contour-switch input:checked + .contour-track {
		background: var(--contour-accent);
	}

	.contour-switch input:checked + .contour-track::after {
		transform: translateX(12px);
	}

	.contour-switch-label {
		font-size: 0.75rem;
		color: var(--contour-ink-2);
	}

	/* Overlay list in sidebar */
	.contour-overlay-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}

	.contour-ov-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px;
		border: 1px solid var(--contour-line);
		border-radius: 4px;
		background: var(--contour-panel-2);
	}

	.contour-ov-item.active {
		border-color: var(--contour-accent);
		background: var(--contour-panel);
	}

	.contour-ov-thumb {
		width: 32px;
		height: 32px;
		flex: none;
		border-radius: 4px;
		background: #fff center/contain no-repeat;
		border: 1px solid var(--contour-line-2);
	}

	.contour-ov-item .contour-ov-meta {
		flex: 1;
		min-width: 0;
	}

	.contour-ov-item .contour-ov-meta .contour-ov-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.contour-ov-mini {
		font-size: 0.65rem;
		color: var(--contour-muted);
	}

	.contour-ov-buttons {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.contour-ov-btn {
		border: none;
		background: none;
		cursor: pointer;
		color: var(--contour-muted);
		padding: 2px 4px;
		border-radius: 3px;
		font-size: 9px;
	}

	.contour-ov-btn:hover {
		background: #e7eaf0;
		color: var(--contour-ink);
	}

	.contour-ov-btn.del:hover {
		color: var(--contour-danger);
	}

	.contour-sidebar-foot {
		padding: 8px 10px;
		border-top: 1px solid var(--contour-line);
		background: var(--contour-panel);
	}

	.contour-foot-label {
		font-size: 0.7rem;
		color: var(--contour-muted);
	}

	.contour-select.small {
		width: auto;
		padding: 2px 4px;
		font-size: 0.7rem;
	}

	/* --- Stage --- */
	.contour-stage {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--contour-bg);
		overflow: auto;
	}

	.contour-title-container {
		display: flex;
		justify-content: center;
		padding: 16px 16px 4px 16px;
		background: var(--contour-bg);
	}

	.contour-title-input {
		background: transparent;
		border: 1px solid transparent;
		border-bottom: 1px dashed var(--contour-line-2);
		border-radius: 0;
		font-family: 'IBM Plex Sans', system-ui, sans-serif;
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--contour-ink);
		text-align: center;
		padding: 6px 12px;
		width: 100%;
		max-width: 400px;
		transition: all 0.2s ease;
	}

	.contour-title-input:hover {
		background: var(--contour-panel-2);
		border-color: var(--contour-line);
	}

	.contour-title-input:focus {
		background: var(--contour-panel);
		border-color: var(--contour-accent);
		outline: none;
		box-shadow: 0 0 0 3px var(--contour-accent-soft);
	}

	.contour-stage-area {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 12px;
		min-height: 0;
	}

	.contour-figure-wrap {
		position: relative;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
		background: var(--color-bg-primary, #ffffff);
		border-radius: 4px;
		overflow: hidden;
	}

	.contour-figure-wrap canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.contour-overlay-layer {
		position: absolute;
		inset: 0;
	}

	/* Draggable Contour Labels */
	.contour-label-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.contour-c-label {
		position: absolute;
		pointer-events: auto;
		cursor: grab;
		white-space: nowrap;
		font: 600 11px 'IBM Plex Mono', monospace;
		color: #15171c;
		transform-origin: center center;
		user-select: none;
		padding: 2px 3px;
		text-shadow:
			-1px -1px 0 #fff,
			1px -1px 0 #fff,
			-1px 1px 0 #fff,
			1px 1px 0 #fff,
			0 0 2px #fff,
			0 0 2px #fff;
	}

	.contour-c-label:hover {
		color: var(--contour-accent);
	}

	.contour-c-label:active {
		cursor: grabbing;
	}

	/* Overlay interaction items */
	.contour-ov-box {
		position: absolute;
		touch-action: none;
		cursor: grab;
	}

	.contour-ov-box img {
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
		user-select: none;
	}

	.contour-ov-box:active {
		cursor: grabbing;
	}

	.contour-ov-frame {
		position: absolute;
		inset: 0;
		border: 1px solid var(--contour-accent);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8);
		pointer-events: none;
	}

	.contour-ov-handle {
		position: absolute;
		width: 10px;
		height: 10px;
		background: #fff;
		border: 1px solid var(--contour-accent);
		border-radius: 2px;
		transform: translate(-50%, -50%);
		cursor: nwse-resize;
		touch-action: none;
	}

	.contour-ov-ne,
	.contour-ov-sw {
		cursor: nesw-resize;
	}

	.contour-ov-rotstem {
		position: absolute;
		left: 50%;
		top: 0;
		width: 1px;
		height: 18px;
		background: var(--contour-accent);
		transform: translate(-50%, -100%);
		pointer-events: none;
	}

	.contour-ov-rothandle {
		position: absolute;
		left: 50%;
		top: -18px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #fff;
		border: 1px solid var(--contour-accent);
		transform: translate(-50%, -50%);
		cursor: grab;
		touch-action: none;
	}
</style>
