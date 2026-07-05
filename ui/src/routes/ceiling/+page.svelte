<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { project, room, lamps } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { theme } from '$lib/stores/theme';
	import { unitAbbrev } from '$lib/utils/unitConversion';
	import type { CeilingLayout, CeilingComponent, KeepOutArea, Project } from '$lib/types/project';

	// Page State
	let selectedTool = $state<'select' | 'smoke_detector' | 'ventilation' | 'sensor' | 'light_fixture' | 'pillar' | 'keep_out'>('select');
	let selectedComponentId = $state<string | null>(null);
	let selectedKeepOutId = $state<string | null>(null);

	// Dragging State
	let dragTarget = $state<{ type: 'component' | 'component_resize' | 'keep_out' | 'keep_out_resize'; id: string; startX: number; startY: number } | null>(null);
	let isDrawingKeepOut = $state(false);
	let keepOutStart = $state<{ x: number; y: number } | null>(null);
	let tempKeepOut = $state<KeepOutArea | null>(null);

	// Active units abbreviation
	const uAbbrev = $derived(unitAbbrev($userSettings.units));

	// Conversion factors
	const METERS_PER_FOOT = 0.3048;

	// Viewport & Scale State
	let scale = $state(40); // pixels per room unit
	let offsetX = $state(40); // padding/offset in screen coordinates
	let offsetY = $state(40);

	let svgWidth = $state(800);
	let svgHeight = $state(600);

	// Safe limits & Room dimensions
	const rx_max = $derived($room.x);
	const ry_max = $derived($room.y);

	// Convert polygon coordinates to screenspace points
	const polygonPoints = $derived.by(() => {
		if ($room.polygon && $room.polygon.length > 0) {
			return $room.polygon;
		}
		// Fallback to bounding box rectangle
		return [
			[0, 0],
			[rx_max, 0],
			[rx_max, ry_max],
			[0, ry_max]
		] as [number, number][];
	});

	// Responsive Scaling logic
	$effect(() => {
		// Calculate boundaries of the room polygon
		let minX = 0;
		let maxX = rx_max;
		let minY = 0;
		let maxY = ry_max;

		if (polygonPoints.length > 0) {
			const xs = polygonPoints.map((p: [number, number]) => p[0]);
			const ys = polygonPoints.map((p: [number, number]) => p[1]);
			minX = Math.min(...xs);
			maxX = Math.max(...xs);
			minY = Math.min(...ys);
			maxY = Math.max(...ys);
		}

		const roomW = maxX - minX;
		const roomH = maxY - minY;

		const padding = 40;
		const screenW = Math.max(600, window.innerWidth - 345); // Subtract sidebar
		const screenH = Math.max(500, window.innerHeight - 130); // Subtract header/toolbar

		// Scale fits room within viewport
		const scaleX = (screenW - padding) / (roomW || 1);
		const scaleY = (screenH - padding) / (roomH || 1);
		scale = Math.min(scaleX, scaleY, 120); // Cap max scale

		svgWidth = Math.round(roomW * scale + padding);
		svgHeight = Math.round(roomH * scale + padding);

		// Center the rendering inside SVG boundaries
		offsetX = Math.round((svgWidth - roomW * scale) / 2);
		// Note Y coordinate mapping flip correction
		offsetY = Math.round((svgHeight - roomH * scale) / 2) + Math.round(roomH * scale);
	});

	// Coordinate Mapping Helpers
	// Note: Room coordinates have Y going UP, while Screen SVG has Y going DOWN.
	function toScreenX(rx: number): number {
		return offsetX + rx * scale;
	}

	function toScreenY(ry: number): number {
		return offsetY - ry * scale;
	}

	// Layout state (auto-initialized if not in project)
	const layout = $derived.by(() => {
		const defaultLayout: CeilingLayout = {
			tileSize: '4x2',
			startCorner: 'top-left',
			tileDirection: 'y',
			components: [],
			keepOutAreas: []
		};
		return $project.ceilingLayout ?? defaultLayout;
	});

	function toRoomX(screenX: number): number {
		const svgEl = document.querySelector('.ceiling-svg');
		if (!svgEl) return 0;
		const rect = svgEl.getBoundingClientRect();
		const relativeX = screenX - rect.left;
		return (relativeX - offsetX) / scale;
	}

	function toRoomY(screenY: number): number {
		const svgEl = document.querySelector('.ceiling-svg');
		if (!svgEl) return 0;
		const rect = svgEl.getBoundingClientRect();
		const relativeY = screenY - rect.top;
		return (offsetY - relativeY) / scale;
	}

	function handleMessage(event: MessageEvent) {
		if (event.data?.type === 'ceiling_layout_response') {
			project.loadProject(event.data.project);
		}
	}

	onMount(() => {
		window.addEventListener('message', handleMessage);

		// Request initial state from parent window
		if (window.opener) {
			window.opener.postMessage({ type: 'ceiling_layout_request' }, '*');
		}

		if (!$project.ceilingLayout) {
			project.updateCeilingLayout({
				tileSize: '4x2',
				startCorner: 'top-left',
				tileDirection: 'y',
				components: [],
				keepOutAreas: []
			});
		}

		// Watch layout changes and push to opener
		const unsubscribe = project.subscribe((p) => {
			if (window.opener && p.ceilingLayout) {
				window.opener.postMessage({
					type: 'ceiling_layout_update',
					ceilingLayout: p.ceilingLayout
				}, '*');
			}
		});

		return () => {
			window.removeEventListener('message', handleMessage);
			unsubscribe();
		};
	});

	function saveAsSvg() {
		const svgEl = document.querySelector('.ceiling-svg');
		if (!svgEl) return;
		
		const clone = svgEl.cloneNode(true) as SVGElement;
		
		// Inline styling replacements to resolve CSS variables and apply transparent bg
		const tiles = clone.querySelectorAll('.ceiling-tile');
		tiles.forEach(tile => {
			tile.setAttribute('fill', 'none');
			tile.setAttribute('stroke', '#e2e8f0');
			tile.setAttribute('stroke-width', '1');
		});
		
		const boundary = clone.querySelector('.room-boundary');
		if (boundary) {
			boundary.setAttribute('fill', 'none');
			boundary.setAttribute('stroke', '#0f172a');
			boundary.setAttribute('stroke-width', '4');
		}
		
		const bgRect = clone.querySelector('rect[fill="var(--canvas-bg-inner)"]');
		if (bgRect) {
			bgRect.setAttribute('fill', '#ffffff');
		}

		const texts = clone.querySelectorAll('text');
		texts.forEach(txt => {
			if (txt.classList.contains('component-text')) {
				txt.setAttribute('fill', '#475569');
			} else if (txt.classList.contains('lamp-text-label')) {
				txt.setAttribute('fill', '#854d0e');
			} else if (txt.classList.contains('keep-out-label')) {
				txt.setAttribute('fill', '#b91c1c');
			}
		});

		const serializer = new XMLSerializer();
		const svgString = serializer.serializeToString(clone);
		const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		
		const a = document.createElement('a');
		a.href = url;
		a.download = `${$project.name}_ceiling.svg`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// Tile dimension in room units
	const tileDims = $derived.by(() => {
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
		const factor = $userSettings.units === 'meters' ? METERS_PER_FOOT : 1;
		return {
			w: w_ft * factor,
			h: h_ft * factor
		};
	});

	// Generate ceiling tiles grid
	const tiles = $derived.by(() => {
		const tw = tileDims.w;
		const th = tileDims.h;
		if (tw <= 0 || th <= 0) return [];

		// Determine bounding box of room polygon to generate layout grid
		const xs = polygonPoints.map((p: [number, number]) => p[0]);
		const ys = polygonPoints.map((p: [number, number]) => p[1]);
		const minX = Math.min(...xs, 0);
		const maxX = Math.max(...xs, rx_max);
		const minY = Math.min(...ys, 0);
		const maxY = Math.max(...ys, ry_max);

		const roomWidth = maxX - minX;
		const roomHeight = maxY - minY;

		const cols = Math.ceil(roomWidth / tw) + 1;
		const rows = Math.ceil(roomHeight / th) + 1;

		// Calculate offsets depending on the selected corner
		let startX = minX;
		let startY = minY;

		if (layout.startCorner === 'top-right' || layout.startCorner === 'bottom-right') {
			// Offset grid so columns align exactly at the right boundary
			const totalWidth = cols * tw;
			startX = maxX - totalWidth;
		}
		if (layout.startCorner === 'top-left' || layout.startCorner === 'top-right') {
			// Offset grid so rows align exactly at the top boundary
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
		return list;
	});

	// Click on SVG canvas to place or draw components
	function handleSvgClick(event: MouseEvent) {
		if (selectedTool === 'select') return;

		const rx = toRoomX(event.clientX);
		const ry = toRoomY(event.clientY);

		// Limit to clicking inside room boundary if needed, but allow drawing
		if (selectedTool !== 'keep_out') {
			let defaultW = undefined;
			let defaultH = undefined;
			if (selectedTool === 'light_fixture') {
				defaultW = tileDims.w;
				defaultH = tileDims.h;
			} else if (selectedTool === 'pillar') {
				const footFactor = $userSettings.units === 'meters' ? 0.3048 : 1;
				defaultW = 1 * footFactor;
				defaultH = 1 * footFactor;
			}

			const newComponent: CeilingComponent = {
				id: 'comp_' + Math.random().toString(36).substr(2, 9),
				type: selectedTool as any,
				x: Math.round((rx - (defaultW ? defaultW / 2 : 0)) * 100) / 100,
				y: Math.round((ry - (defaultH ? defaultH / 2 : 0)) * 100) / 100,
				w: defaultW,
				h: defaultH,
				name: getComponentName(selectedTool)
			};
			project.updateCeilingLayout({
				components: [...layout.components, newComponent]
			});
			selectedComponentId = newComponent.id;
			selectedTool = 'select'; // Switch back to select tool
		}
	}

	function getComponentName(type: string): string {
		switch (type) {
			case 'smoke_detector': return 'Smoke Detector';
			case 'ventilation': return 'Ventilation Outlet';
			case 'sensor': return 'Room Sensor';
			case 'light_fixture': return 'Light Fixture';
			case 'pillar': return 'Pillar';
			default: return 'Component';
		}
	}

	// Drag & Drop / Move Handlers
	function handleMouseDown(event: MouseEvent, type: 'component' | 'component_resize' | 'keep_out' | 'keep_out_resize', id: string) {
		event.stopPropagation();
		event.preventDefault();
		const rx = toRoomX(event.clientX);
		const ry = toRoomY(event.clientY);
		dragTarget = { type, id, startX: rx, startY: ry };

		if (type === 'component') {
			selectedComponentId = id;
			selectedKeepOutId = null;
		} else {
			selectedKeepOutId = id;
			selectedComponentId = null;
		}
	}

	function handleSvgMouseDown(event: MouseEvent) {
		if (selectedTool === 'keep_out') {
			event.preventDefault();
			const rx = toRoomX(event.clientX);
			const ry = toRoomY(event.clientY);
			isDrawingKeepOut = true;
			keepOutStart = { x: rx, y: ry };
			tempKeepOut = {
				id: 'temp',
				x: rx,
				y: ry,
				w: 0,
				h: 0,
				name: 'Keep Out Area'
			};
		} else {
			// Clear selections if clicking blank SVG canvas
			if ((event.target as SVGElement).classList.contains('ceiling-svg') || (event.target as SVGElement).nodeName === 'svg') {
				selectedComponentId = null;
				selectedKeepOutId = null;
			}
		}
	}

	function handleMouseMove(event: MouseEvent) {
		const rx = toRoomX(event.clientX);
		const ry = toRoomY(event.clientY);

		if (isDrawingKeepOut && keepOutStart) {
			const x = Math.min(keepOutStart.x, rx);
			const y = Math.min(keepOutStart.y, ry);
			const w = Math.abs(rx - keepOutStart.x);
			const h = Math.abs(ry - keepOutStart.y);

			tempKeepOut = {
				id: 'temp',
				x: Math.round(x * 100) / 100,
				y: Math.round(y * 100) / 100,
				w: Math.round(w * 100) / 100,
				h: Math.round(h * 100) / 100,
				name: 'Keep Out Area'
			};
			return;
		}

		if (!dragTarget) return;

		const dx = rx - dragTarget.startX;
		const dy = ry - dragTarget.startY;

		if (dragTarget.type === 'component') {
			project.updateCeilingLayout({
				components: layout.components.map(c => {
					if (c.id === dragTarget!.id) {
						return {
							...c,
							x: Math.round((c.x + dx) * 100) / 100,
							y: Math.round((c.y + dy) * 100) / 100
						};
					}
					return c;
				})
			});
			dragTarget.startX = rx;
			dragTarget.startY = ry;
		} else if (dragTarget.type === 'keep_out') {
			project.updateCeilingLayout({
				keepOutAreas: layout.keepOutAreas.map(ko => {
					if (ko.id === dragTarget!.id) {
						return {
							...ko,
							x: Math.round((ko.x + dx) * 100) / 100,
							y: Math.round((ko.y + dy) * 100) / 100
						};
					}
					return ko;
				})
			});
			dragTarget.startX = rx;
			dragTarget.startY = ry;
		} else if (dragTarget.type === 'keep_out_resize') {
			project.updateCeilingLayout({
				keepOutAreas: layout.keepOutAreas.map(ko => {
					if (ko.id === dragTarget!.id) {
						return {
							...ko,
							w: Math.max(0.1, Math.round((ko.w + dx) * 100) / 100),
							h: Math.max(0.1, Math.round((ko.h - dy) * 100) / 100) // Y coordinate inversion correction
						};
					}
					return ko;
				})
			});
			dragTarget.startX = rx;
			dragTarget.startY = ry;
		} else if (dragTarget.type === 'component_resize') {
			project.updateCeilingLayout({
				components: layout.components.map(c => {
					if (c.id === dragTarget!.id) {
						return {
							...c,
							w: Math.max(0.1, Math.round(((c.w || 0.1) + dx) * 100) / 100),
							h: Math.max(0.1, Math.round(((c.h || 0.1) - dy) * 100) / 100) // Y coordinate inversion correction
						};
					}
					return c;
				})
			});
			dragTarget.startX = rx;
			dragTarget.startY = ry;
		}
	}

	function handleMouseUp() {
		if (isDrawingKeepOut && tempKeepOut && tempKeepOut.w > 0.1 && tempKeepOut.h > 0.1) {
			const newArea: KeepOutArea = {
				...tempKeepOut,
				id: 'ko_' + Math.random().toString(36).substr(2, 9)
			};
			project.updateCeilingLayout({
				keepOutAreas: [...layout.keepOutAreas, newArea]
			});
			selectedKeepOutId = newArea.id;
			selectedTool = 'select';
		}
		dragTarget = null;
		isDrawingKeepOut = false;
		keepOutStart = null;
		tempKeepOut = null;
	}

	// Delete Selected Item
	function deleteSelected() {
		if (selectedComponentId) {
			project.updateCeilingLayout({
				components: layout.components.filter(c => c.id !== selectedComponentId)
			});
			selectedComponentId = null;
		} else if (selectedKeepOutId) {
			project.updateCeilingLayout({
				keepOutAreas: layout.keepOutAreas.filter(ko => ko.id !== selectedKeepOutId)
			});
			selectedKeepOutId = null;
		}
	}

	// Quick Presets
	function setTileSize(size: '4x2' | '2x2' | 'none') {
		project.updateCeilingLayout({ tileSize: size });
	}

	function setStartCorner(corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') {
		project.updateCeilingLayout({ startCorner: corner });
	}

	// Tile direction selection
	function setTileDirection(dir: 'x' | 'y') {
		project.updateCeilingLayout({ tileDirection: dir });
	}

	function clearAll() {
		if (confirm('Are you sure you want to clear all custom placed ceiling components and keep-out areas?')) {
			project.updateCeilingLayout({
				components: [],
				keepOutAreas: []
			});
			selectedComponentId = null;
			selectedKeepOutId = null;
		}
	}
</script>

<svelte:head>
	<title>Ceiling Designer - 2D Layout Editor</title>
</svelte:head>

<div class="ceiling-designer-page" class:dark={$theme === 'dark'}>
	<!-- Header Bar -->
	<header class="app-header">
		<div class="header-left">
			<button onclick={() => window.close()} class="back-link" style="background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 8px;">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M19 12H5M12 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
				Back to Illuminate
			</button>
			<h1 class="page-title">Ceiling Designer</h1>
			<span class="project-indicator">{$project.name}.guv</span>
		</div>
		<div class="header-right" style="display: flex; align-items: center; gap: 12px;">
			<span class="dimension-pill">{$room.x} x {$room.y} {uAbbrev}</span>
			<button class="save-svg-btn" onclick={saveAsSvg}>
				Save as SVG
			</button>
		</div>
	</header>

	<div class="workspace-layout">
		<!-- Sidebar Controls -->
		<aside class="sidebar-controls">
			<!-- Paneling Options -->
			<div class="control-section">
				<h2 class="section-title">Automatic Paneling</h2>
				
				<div class="control-group">
					<label class="group-label">Ceiling Tile Size</label>
					<div class="btn-toggle-row">
						<button 
							class="toggle-btn" 
							class:active={layout.tileSize === '2x2'} 
							onclick={() => setTileSize('2x2')}
						>
							2x2 ft
						</button>
						<button 
							class="toggle-btn" 
							class:active={layout.tileSize === '4x2'} 
							onclick={() => setTileSize('4x2')}
						>
							4x2 ft
						</button>
						<button 
							class="toggle-btn" 
							class:active={layout.tileSize === 'none'} 
							onclick={() => setTileSize('none')}
						>
							None
						</button>
					</div>
				</div>

				{#if layout.tileSize === '4x2'}
					<div class="control-group">
						<label class="group-label">4x2 Tile Direction</label>
						<div class="btn-toggle-row">
							<button 
								class="toggle-btn" 
								class:active={layout.tileDirection === 'x'} 
								onclick={() => setTileDirection('x')}
							>
								Horizontal (X)
							</button>
							<button 
								class="toggle-btn" 
								class:active={layout.tileDirection === 'y'} 
								onclick={() => setTileDirection('y')}
							>
								Vertical (Y)
							</button>
						</div>
					</div>
				{/if}

				{#if layout.tileSize !== 'none'}
					<div class="control-group">
						<label class="group-label">Start Alignment Corner</label>
						<div class="grid-2x2">
							<button 
								class="toggle-btn text-sm" 
								class:active={layout.startCorner === 'top-left'} 
								onclick={() => setStartCorner('top-left')}
							>
								Top Left
							</button>
							<button 
								class="toggle-btn text-sm" 
								class:active={layout.startCorner === 'top-right'} 
								onclick={() => setStartCorner('top-right')}
							>
								Top Right
							</button>
							<button 
								class="toggle-btn text-sm" 
								class:active={layout.startCorner === 'bottom-left'} 
								onclick={() => setStartCorner('bottom-left')}
							>
								Bottom Left
							</button>
							<button 
								class="toggle-btn text-sm" 
								class:active={layout.startCorner === 'bottom-right'} 
								onclick={() => setStartCorner('bottom-right')}
							>
								Bottom Right
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Component Inspector / Properties -->
			{#if selectedComponentId || selectedKeepOutId}
				<div class="control-section inspector-section">
					<h2 class="section-title">Properties</h2>
					{#if selectedComponentId}
						{@const comp = layout.components.find(c => c.id === selectedComponentId)}
						{#if comp}
							<div class="inspector-field">
								<label>Type</label>
								<span>{comp.type.toUpperCase().replace('_', ' ')}</span>
							</div>
							<div class="inspector-field">
								<label for="comp-name">Name</label>
								<input 
									id="comp-name"
									type="text" 
									bind:value={comp.name} 
									oninput={() => project.updateCeilingLayout({ components: [...layout.components] })}
								/>
							</div>
							<div class="inspector-row">
								<div class="inspector-field half">
									<label for="comp-x">X Position</label>
									<input 
										id="comp-x"
										type="number" 
										step="0.05" 
										bind:value={comp.x} 
										oninput={() => project.updateCeilingLayout({ components: [...layout.components] })}
									/>
								</div>
								<div class="inspector-field half">
									<label for="comp-y">Y Position</label>
									<input 
										id="comp-y"
										type="number" 
										step="0.05" 
										bind:value={comp.y} 
										oninput={() => project.updateCeilingLayout({ components: [...layout.components] })}
									/>
								</div>
							</div>
							{#if comp.w !== undefined && comp.h !== undefined}
								<div class="inspector-row">
									<div class="inspector-field half">
										<label for="comp-w">Width</label>
										<input 
											id="comp-w"
											type="number" 
											step="0.05" 
											bind:value={comp.w} 
											oninput={() => project.updateCeilingLayout({ components: [...layout.components] })}
										/>
									</div>
									<div class="inspector-field half">
										<label for="comp-h">Height</label>
										<input 
											id="comp-h"
											type="number" 
											step="0.05" 
											bind:value={comp.h} 
											oninput={() => project.updateCeilingLayout({ components: [...layout.components] })}
										/>
									</div>
								</div>
							{/if}
						{/if}
					{:else if selectedKeepOutId}
						{@const ko = layout.keepOutAreas.find(k => k.id === selectedKeepOutId)}
						{#if ko}
							<div class="inspector-field">
								<label for="ko-name">Name</label>
								<input 
									id="ko-name"
									type="text" 
									bind:value={ko.name} 
									oninput={() => project.updateCeilingLayout({ keepOutAreas: [...layout.keepOutAreas] })}
								/>
							</div>
							<div class="inspector-row">
								<div class="inspector-field half">
									<label for="ko-x">X Position</label>
									<input 
										id="ko-x"
										type="number" 
										step="0.05" 
										bind:value={ko.x} 
										oninput={() => project.updateCeilingLayout({ keepOutAreas: [...layout.keepOutAreas] })}
									/>
								</div>
								<div class="inspector-field half">
									<label for="ko-y">Y Position</label>
									<input 
										id="ko-y"
										type="number" 
										step="0.05" 
										bind:value={ko.y} 
										oninput={() => project.updateCeilingLayout({ keepOutAreas: [...layout.keepOutAreas] })}
									/>
								</div>
							</div>
							<div class="inspector-row">
								<div class="inspector-field half">
									<label for="ko-w">Width</label>
									<input 
										id="ko-w"
										type="number" 
										step="0.05" 
										bind:value={ko.w} 
										oninput={() => project.updateCeilingLayout({ keepOutAreas: [...layout.keepOutAreas] })}
									/>
								</div>
								<div class="inspector-field half">
									<label for="ko-h">Height</label>
									<input 
										id="ko-h"
										type="number" 
										step="0.05" 
										bind:value={ko.h} 
										oninput={() => project.updateCeilingLayout({ keepOutAreas: [...layout.keepOutAreas] })}
									/>
								</div>
							</div>
						{/if}
					{/if}

					<div class="inspector-actions">
						<button class="delete-btn" onclick={deleteSelected}>
							Delete Component
						</button>
					</div>
				</div>
			{/if}

			<div class="sidebar-footer">
				<button class="btn-clear-all" onclick={clearAll}>
					Clear Designer
				</button>
			</div>
		</aside>

		<!-- Main Workspace containing horizontal toolbar and SVG -->
		<div class="main-content-area">
			<!-- Horizontal Toolbar -->
			<div class="horizontal-toolbar">
				<span class="toolbar-label">Ceiling Tools:</span>
				<div class="tool-list-horizontal">
					<button 
						class="tool-btn" 
						class:active={selectedTool === 'select'} 
						onclick={() => selectedTool = 'select'}
					>
						<span class="tool-icon">🔍</span>
						<span>Select & Drag</span>
					</button>

					<button 
						class="tool-btn" 
						class:active={selectedTool === 'smoke_detector'} 
						onclick={() => selectedTool = 'smoke_detector'}
					>
						<span class="tool-icon detector">🔴</span>
						<span>Smoke Detector</span>
					</button>

					<button 
						class="tool-btn" 
						class:active={selectedTool === 'ventilation'} 
						onclick={() => selectedTool = 'ventilation'}
					>
						<span class="tool-icon vent">⬜</span>
						<span>Ventilation Outlet</span>
					</button>

					<button 
						class="tool-btn" 
						class:active={selectedTool === 'sensor'} 
						onclick={() => selectedTool = 'sensor'}
					>
						<span class="tool-icon sensor">🟢</span>
						<span>Room Sensor</span>
					</button>

					<button 
						class="tool-btn" 
						class:active={selectedTool === 'light_fixture'} 
						onclick={() => selectedTool = 'light_fixture'}
					>
						<span class="tool-icon light">💡</span>
						<span>Light Fixture</span>
					</button>

					<button 
						class="tool-btn" 
						class:active={selectedTool === 'pillar'} 
						onclick={() => selectedTool = 'pillar'}
					>
						<span class="tool-icon pillar">🏛️</span>
						<span>Pillar</span>
					</button>

					<button 
						class="tool-btn" 
						class:active={selectedTool === 'keep_out'} 
						onclick={() => selectedTool = 'keep_out'}
					>
						<span class="tool-icon keepout">🚧</span>
						<span>Keep Out Area</span>
					</button>
				</div>
			</div>

			<!-- Visual Area (SVG Canvas) -->
			<main class="canvas-viewport">
				<div class="canvas-card">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<svg
						width={svgWidth}
						height={svgHeight}
						viewBox="0 0 {svgWidth} {svgHeight}"
						onclick={handleSvgClick}
						onmousedown={handleSvgMouseDown}
						onmousemove={handleMouseMove}
						onmouseup={handleMouseUp}
						class="ceiling-svg"
						class:cursor-crosshair={selectedTool !== 'select'}
					>
						<defs>
							<!-- Room boundary clipping path for tiles grid -->
							<clipPath id="room-clip">
								<polygon points={polygonPoints.map((p: [number, number]) => `${toScreenX(p[0])},${toScreenY(p[1])}`).join(' ')} />
							</clipPath>

							<!-- Diagonal hatching pattern for keep-out areas -->
							<pattern id="hatch-pattern" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
								<line x1="0" y1="0" x2="0" y2="10" stroke="rgba(239, 68, 68, 0.4)" stroke-width="2" />
							</pattern>
						</defs>

						<!-- Ambient background grid inside room bounds -->
						<g clip-path="url(#room-clip)">
							<rect x="0" y="0" width={svgWidth} height={svgHeight} fill="var(--canvas-bg-inner)" />
							
							<!-- Ceiling Tiles Grid -->
							{#if layout.tileSize !== 'none'}
								{#each tiles as tile}
									<rect
										x={toScreenX(tile.x)}
										y={toScreenY(tile.y + tile.h)}
										width={tile.w * scale}
										height={tile.h * scale}
										class="ceiling-tile"
									/>
								{/each}
							{/if}
						</g>

						<!-- Room outer boundary wall -->
						<polygon
							points={polygonPoints.map((p: [number, number]) => `${toScreenX(p[0])},${toScreenY(p[1])}`).join(' ')}
							class="room-boundary"
							fill="none"
						/>

						<!-- Keep Out Areas -->
						{#each layout.keepOutAreas as ko}
							<g class="placed-group" class:selected={selectedKeepOutId === ko.id}>
								<rect
									x={toScreenX(ko.x)}
									y={toScreenY(ko.y + ko.h)}
									width={ko.w * scale}
									height={ko.h * scale}
									fill="url(#hatch-pattern)"
									stroke="rgba(239, 68, 68, 0.85)"
									stroke-width="2.5"
									stroke-dasharray="4,4"
									onmousedown={(e) => handleMouseDown(e, 'keep_out', ko.id)}
								/>
								<text
									x={toScreenX(ko.x + ko.w / 2)}
									y={toScreenY(ko.y + ko.h / 2) + 4}
									class="keep-out-label"
								>
									{ko.name || 'KEEP OUT'}
								</text>
								<!-- Resize handle -->
								{#if selectedKeepOutId === ko.id}
									<rect
										x={toScreenX(ko.x + ko.w) - 5}
										y={toScreenY(ko.y + ko.h) - 5}
										width="10"
										height="10"
										class="resize-handle"
										onmousedown={(e) => handleMouseDown(e, 'keep_out_resize', ko.id)}
									/>
								{/if}
							</g>
						{/each}

						<!-- Temporary drawing keep out area -->
						{#if tempKeepOut}
							<rect
								x={toScreenX(tempKeepOut.x)}
								y={toScreenY(tempKeepOut.y + tempKeepOut.h)}
								width={tempKeepOut.w * scale}
								height={tempKeepOut.h * scale}
								fill="url(#hatch-pattern)"
								stroke="rgba(239, 68, 68, 0.6)"
								stroke-width="2"
								stroke-dasharray="4,4"
							/>
						{/if}

						<!-- Placed Custom Ceiling Components -->
						{#each layout.components as comp}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<g
								class="placed-group clickable"
								class:selected={selectedComponentId === comp.id}
								transform="translate({toScreenX(comp.x)}, {toScreenY(comp.y)})"
								onmousedown={(e) => handleMouseDown(e, 'component', comp.id)}
							>
								{#if comp.type === 'smoke_detector'}
									<circle r="14" fill="#ef4444" stroke="#fff" stroke-width="2" class="icon-shadow" />
									<circle r="6" fill="#b91c1c" />
									<circle r="2" fill="#fff" />
									<text y="26" class="component-text">
										{comp.name || getComponentName(comp.type)}
									</text>
								{:else if comp.type === 'ventilation'}
									<rect x="-14" y="-14" width="28" height="28" fill="#e2e8f0" stroke="#475569" stroke-width="2.5" rx="3" class="icon-shadow" />
									<line x1="-10" y1="-10" x2="10" y2="10" stroke="#475569" stroke-width="1.5" />
									<line x1="10" y1="-10" x2="-10" y2="10" stroke="#475569" stroke-width="1.5" />
									<circle r="5" fill="#94a3b8" />
									<text y="26" class="component-text">
										{comp.name || getComponentName(comp.type)}
									</text>
								{:else if comp.type === 'sensor'}
									<polygon points="0,-16 14,8 -14,8" fill="#10b981" stroke="#fff" stroke-width="2" class="icon-shadow" />
									<circle r="4" fill="#065f46" />
									<text y="26" class="component-text">
										{comp.name || getComponentName(comp.type)}
									</text>
								{:else if comp.type === 'light_fixture'}
									<rect
										x="0"
										y={-(comp.h || 0) * scale}
										width={(comp.w || 0) * scale}
										height={(comp.h || 0) * scale}
										fill="#fef08a"
										stroke="#ca8a04"
										stroke-width="2"
										opacity="0.8"
										class="icon-shadow"
									/>
									<line x1="0" y1="0" x2={(comp.w || 0) * scale} y2={-(comp.h || 0) * scale} stroke="#ca8a04" stroke-width="1.5" />
									<line x1="0" y1={-(comp.h || 0) * scale} x2={(comp.w || 0) * scale} y2="0" stroke="#ca8a04" stroke-width="1.5" />
									<text
										x={((comp.w || 0) * scale) / 2}
										y={-((comp.h || 0) * scale) / 2 + 4}
										class="component-text"
									>
										{comp.name || getComponentName(comp.type)}
									</text>
									{#if selectedComponentId === comp.id}
										<rect
											x={(comp.w || 0) * scale - 5}
											y={-(comp.h || 0) * scale - 5}
											width="10"
											height="10"
											class="resize-handle"
											onmousedown={(e) => handleMouseDown(e, 'component_resize', comp.id)}
										/>
									{/if}
								{:else if comp.type === 'pillar'}
									<rect
										x="0"
										y={-(comp.h || 0) * scale}
										width={(comp.w || 0) * scale}
										height={(comp.h || 0) * scale}
										fill="#94a3b8"
										stroke="#475569"
										stroke-width="2.5"
										opacity="0.95"
										class="icon-shadow"
									/>
									<line x1="0" y1="0" x2={(comp.w || 0) * scale} y2={-(comp.h || 0) * scale} stroke="#475569" stroke-width="1" />
									<line x1="0" y1={-(comp.h || 0) * scale} x2={(comp.w || 0) * scale} y2="0" stroke="#475569" stroke-width="1" />
									<text
										x={((comp.w || 0) * scale) / 2}
										y={-((comp.h || 0) * scale) / 2 + 4}
										class="component-text"
										style="fill: #1e293b; font-weight: bold;"
									>
										{comp.name || getComponentName(comp.type)}
									</text>
									{#if selectedComponentId === comp.id}
										<rect
											x={(comp.w || 0) * scale - 5}
											y={-(comp.h || 0) * scale - 5}
											width="10"
											height="10"
											class="resize-handle"
											onmousedown={(e) => handleMouseDown(e, 'component_resize', comp.id)}
										/>
									{/if}
								{/if}
							</g>
						{/each}

						<!-- Currently Placed Project Lamps (Read-Only Positions) -->
						{#each $lamps as lamp}
							<!-- Project lamps are projected from their actual coordinates (x, y) -->
							<g class="lamp-marker" transform="translate({toScreenX(lamp.x)}, {toScreenY(lamp.y)})">
								<!-- Glowing background indicator -->
								<circle r="18" fill="rgba(250, 204, 21, 0.18)" class="glowing-ring" />
								<!-- Lamp central design -->
								<circle r="8" fill="#facc15" stroke="#eab308" stroke-width="2" />
								<line x1="-5" y1="0" x2="5" y2="0" stroke="#854d0e" stroke-width="1.2" />
								<line x1="0" y1="-5" x2="0" y2="5" stroke="#854d0e" stroke-width="1.2" />
								
								<!-- Text label showing Lamp Name and Height -->
								<text y="-14" class="lamp-text-label">
									{lamp.name || 'Lamp'} ({lamp.z} {uAbbrev})
								</text>
							</g>
						{/each}
					</svg>
				</div>
			</main>
		</div>
	</div>
</div>

<style>
	.ceiling-designer-page {
		--bg-color: #f8fafc;
		--panel-bg: #ffffff;
		--border-color: #e2e8f0;
		--text-color: #1e293b;
		--text-muted: #64748b;
		--accent-color: #3b82f6;
		--accent-hover: #2563eb;
		--canvas-bg: #e2e8f0;
		--canvas-bg-inner: #ffffff;
		--tile-border: #cbd5e1;
		--tile-bg: #f8fafc;
		
		background-color: var(--bg-color);
		color: var(--text-color);
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		height: 100vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.ceiling-designer-page.dark {
		--bg-color: #0f172a;
		--panel-bg: #1e293b;
		--border-color: #334155;
		--text-color: #f1f5f9;
		--text-muted: #94a3b8;
		--accent-color: #3b82f6;
		--accent-hover: #2563eb;
		--canvas-bg: #020617;
		--canvas-bg-inner: #0f172a;
		--tile-border: #334155;
		--tile-bg: #1e293b;
	}

	.app-header {
		height: 60px;
		background-color: var(--panel-bg);
		border-bottom: 1px solid var(--border-color);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 24px;
		z-index: 10;
		box-shadow: 0 1px 3px rgba(0,0,0,0.05);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--accent-color);
		text-decoration: none;
		font-weight: 500;
		font-size: 14px;
		padding: 8px 12px;
		border-radius: 6px;
		transition: background-color 0.2s;
	}

	.back-link:hover {
		background-color: rgba(59, 130, 246, 0.08);
	}

	.save-svg-btn {
		background-color: var(--accent-color);
		color: #ffffff;
		border: none;
		padding: 8px 16px;
		font-size: 14px;
		font-weight: 500;
		border-radius: 6px;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.save-svg-btn:hover {
		background-color: var(--accent-hover);
	}

	.page-title {
		font-size: 18px;
		font-weight: 600;
		margin: 0;
	}

	.project-indicator {
		font-size: 13px;
		color: var(--text-muted);
		background-color: rgba(148, 163, 184, 0.12);
		padding: 3px 8px;
		border-radius: 4px;
	}

	.dimension-pill {
		font-size: 14px;
		font-weight: 600;
		color: var(--accent-color);
		background-color: rgba(59, 130, 246, 0.12);
		padding: 4px 10px;
		border-radius: 9999px;
	}

	.workspace-layout {
		flex: 1;
		display: flex;
		overflow: hidden;
	}

	.sidebar-controls {
		width: 320px;
		background-color: var(--panel-bg);
		border-right: 1px solid var(--border-color);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		z-index: 5;
	}

	.main-content-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.horizontal-toolbar {
		height: 52px;
		background-color: var(--panel-bg);
		border-bottom: 1px solid var(--border-color);
		display: flex;
		align-items: center;
		padding: 0 20px;
		gap: 12px;
		z-index: 4;
	}

	.toolbar-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.tool-list-horizontal {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.tool-list-horizontal .tool-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 6px 12px;
		font-size: 13px;
		color: var(--text-color);
		cursor: pointer;
		transition: all 0.2s;
	}

	.tool-list-horizontal .tool-btn:hover {
		background-color: rgba(148, 163, 184, 0.08);
	}

	.tool-list-horizontal .tool-btn.active {
		background-color: rgba(59, 130, 246, 0.1);
		border-color: var(--accent-color);
		color: var(--accent-color);
		font-weight: 500;
	}

	.control-section {
		padding: 20px;
		border-bottom: 1px solid var(--border-color);
	}

	.control-section:last-child {
		border-bottom: none;
	}

	.section-title {
		font-size: 14px;
		font-weight: 600;
		margin: 0 0 16px 0;
		color: var(--text-color);
	}

	.control-group {
		margin-bottom: 16px;
	}

	.control-group:last-child {
		margin-bottom: 0;
	}

	.group-label {
		display: block;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
		margin-bottom: 8px;
	}

	.btn-toggle-row {
		display: flex;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		overflow: hidden;
	}

	.toggle-btn {
		flex: 1;
		background-color: transparent;
		border: none;
		padding: 8px 12px;
		font-size: 13px;
		color: var(--text-color);
		cursor: pointer;
		transition: background-color 0.2s, color 0.2s;
		text-align: center;
	}

	.toggle-btn:not(:last-child) {
		border-right: 1px solid var(--border-color);
	}

	.toggle-btn.active {
		background-color: rgba(59, 130, 246, 0.1);
		color: var(--accent-color);
		font-weight: 500;
	}

	.grid-2x2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.grid-2x2 .toggle-btn {
		border: 1px solid var(--border-color);
		border-radius: 6px;
	}

	.grid-2x2 .toggle-btn.active {
		border-color: var(--accent-color);
	}

	.inspector-field {
		margin-bottom: 12px;
	}

	.inspector-field label {
		display: block;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		margin-bottom: 4px;
	}

	.inspector-field span {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-color);
	}

	.inspector-field input {
		width: 100%;
		background-color: transparent;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 13px;
		color: var(--text-color);
	}

	.inspector-row {
		display: flex;
		gap: 12px;
	}

	.inspector-field.half {
		flex: 1;
	}

	.inspector-actions {
		margin-top: 16px;
	}

	.delete-btn {
		width: 100%;
		background-color: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.delete-btn:hover {
		background-color: #ef4444;
		color: #ffffff;
	}

	.sidebar-footer {
		margin-top: auto;
		padding: 20px;
		border-top: 1px solid var(--border-color);
	}

	.btn-clear-all {
		width: 100%;
		background-color: transparent;
		color: var(--text-muted);
		border: 1px dashed var(--border-color);
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-clear-all:hover {
		border-color: #ef4444;
		color: #ef4444;
		background-color: rgba(239, 68, 68, 0.04);
	}

	.canvas-viewport {
		flex: 1;
		background-color: var(--canvas-bg);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		overflow: auto;
		position: relative;
	}

	.canvas-card {
		background-color: var(--panel-bg);
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0,0,0,0.06);
		padding: 10px;
		display: inline-block;
	}

	.ceiling-svg {
		display: block;
		user-select: none;
	}

	.cursor-crosshair {
		cursor: crosshair;
	}

	.ceiling-tile {
		fill: var(--tile-bg);
		stroke: var(--tile-border);
		stroke-width: 1;
	}

	.room-boundary {
		fill: none;
		stroke: var(--text-color);
		stroke-width: 4;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.placed-group {
		cursor: move;
	}

	.placed-group.selected circle,
	.placed-group.selected rect,
	.placed-group.selected polygon {
		stroke: var(--accent-color) !important;
		stroke-width: 3px !important;
	}

	.icon-shadow {
		filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.08));
	}

	.resize-handle {
		fill: var(--accent-color);
		stroke: #ffffff;
		stroke-width: 1.5;
		cursor: nwse-resize;
	}

	.keep-out-label {
		fill: #b91c1c;
		font-size: 10px;
		font-weight: 700;
		text-anchor: middle;
		pointer-events: none;
		letter-spacing: 0.05em;
	}

	.component-text {
		font-size: 10px;
		font-weight: 600;
		text-anchor: middle;
		fill: var(--text-muted);
		pointer-events: none;
	}

	.lamp-text-label {
		font-size: 11px;
		font-weight: 600;
		text-anchor: middle;
		fill: #854d0e;
		pointer-events: none;
		background: #ffffff;
	}

	.glowing-ring {
		animation: pulse 2.5s infinite ease-in-out;
	}

	@keyframes pulse {
		0% { transform: scale(0.96); opacity: 0.7; }
		50% { transform: scale(1.08); opacity: 1; }
		100% { transform: scale(0.96); opacity: 0.7; }
	}
</style>
