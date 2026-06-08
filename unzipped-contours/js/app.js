/* app.js — controller: state, inputs, rendering, persistence, presets, export. */
/* contour plotter main */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const STATE_KEY = 'contourPlotter.state.v1';

  // ---- DOM refs ----
  const canvas = $('figure');
  const ctx = canvas.getContext('2d');
  const wrap = $('figureWrap');
  const scaler = $('figureScaler');
  const stageArea = $('stageArea');
  const overlayLayer = $('overlayLayer');
  const labelLayer = $('labelLayer');

  // ---- state ----
  const state = {
    data: null, smoothedValues: null, rawCsv: '', csvName: '',
    title: 'bed sitting eye 1.4m', xLabel: 'X axis', yLabel: 'Y axis',
    levels: [], colors: [], labels: [], floorColor: '#00A24A',
    sigma: 1, filled: true, grid: true, contourLabels: true, equalAspect: true,
    flipY: true,
    exportScale: 2, labelTargets: {}
  };
  let layout = null;
  let fitScale = 1;
  let lastContours = null;
  let lastLevelsMeta = { levels: [], labels: [] };

  // ================= parsing helpers =================
  function parseLevels(str) {
    return String(str).split(',').map(s => parseFloat(s.trim())).filter(Number.isFinite);
  }
  function parseLabels(str) { return String(str).split(',').map(s => s.trim()); }
  function parseColors(str) {
    return String(str).split(',').map(s => s.trim()).filter(s => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s));
  }

  // ================= rendering =================
  let rafPending = false;
  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }

  function render() {
    if (!state.data) return;
    // sort levels ascending (band logic assumes ascending) keeping label/color pairing
    const lv = state.levels.map((v, i) => ({ v, c: state.colors[i] || '#cccccc', l: state.labels[i] || '' }));
    lv.sort((a, b) => a.v - b.v);
    const levels = lv.map(o => o.v), colors = lv.map(o => o.c), labels = lv.map(o => o.l);

    // contour on the RAW field, then smooth the contour curves themselves
    state.smoothedValues = state.data.values;
    layout = window.Contour.computeLayout(state.data, state.equalAspect, state.flipY);

    // build contours once; reuse for canvas + label placement + export
    const rawContours = window.Contour.buildContours(state.smoothedValues, state.data.nx, state.data.ny, levels);
    const contours = window.Contour.smoothContours(rawContours, state.sigma);
    const dataRect = { x: layout.dataX0, y: layout.dataY0, w: layout.dataW, h: layout.dataH };
    const placements = state.contourLabels
      ? window.Contour.labelPlacements(contours, levels, labels, layout, state.labelTargets, dataRect)
      : [];
    // cache for live label dragging
    lastContours = contours; lastLevelsMeta = { levels, labels };

    // size canvas at devicePixelRatio
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(layout.figW * dpr);
    canvas.height = Math.round(layout.figH * dpr);
    canvas.style.width = layout.figW + 'px';
    canvas.style.height = layout.figH + 'px';
    wrap.style.width = layout.figW + 'px';
    wrap.style.height = layout.figH + 'px';
    window.Overlays.setLayerSize(layout.figW, layout.figH);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    window.Contour.drawFigure(ctx, state.data, layout, {
      levels, colors, labels, floorColor: state.floorColor,
      smoothedValues: state.smoothedValues, contours: contours,
      title: state.title, xLabel: state.xLabel, yLabel: state.yLabel,
      filled: state.filled, grid: state.grid,
      contourLabels: state.contourLabels, drawLabelsOnCanvas: false
    });

    renderContourLabels(placements);
    applyFit();
    persist();
  }

  function applyFit() {
    if (!layout) return;
    const availW = stageArea.clientWidth - 56;
    const availH = stageArea.clientHeight - 56;
    fitScale = Math.min(availW / layout.figW, availH / layout.figH, 1.4);
    if (!Number.isFinite(fitScale) || fitScale <= 0) fitScale = 1;
    wrap.style.transform = 'scale(' + fitScale + ')';
    scaler.style.width = (layout.figW * fitScale) + 'px';
    scaler.style.height = (layout.figH * fitScale) + 'px';
    $('zoomLabel').textContent = Math.round(fitScale * 100) + '%';
  }

  // ---- draggable contour labels (DOM; canvas redraws them only for export) ----
  function renderContourLabels(placements) {
    labelLayer.innerHTML = '';
    if (!state.contourLabels) return;
    placements.forEach(pl => {
      const el = document.createElement('div');
      el.className = 'c-label';
      el.textContent = pl.text;
      el.title = 'Drag along the contour to reposition';
      positionLabel(el, pl);
      el.addEventListener('pointerdown', e => startLabelDrag(e, pl.i, el));
      labelLayer.appendChild(el);
    });
  }
  function positionLabel(el, pl) {
    el.style.left = pl.x + 'px';
    el.style.top = pl.y + 'px';
    el.style.transform = 'translate(-50%,-50%) rotate(' + (pl.angle * 180 / Math.PI) + 'deg)';
  }
  function startLabelDrag(e, levelIndex, el) {
    e.preventDefault(); e.stopPropagation();
    if (!lastContours || !lastContours[levelIndex]) return;
    el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    const move = ev => {
      const rect = labelLayer.getBoundingClientRect();
      const s = fitScale || 1;
      const fx = (ev.clientX - rect.left) / s, fy = (ev.clientY - rect.top) / s;
      const target = { gx: layout.invX(fx), gy: layout.invY(fy) };
      const pl = window.Contour.closestOnContour(lastContours[levelIndex], target, layout);
      if (!pl) return;
      state.labelTargets[levelIndex] = target;
      positionLabel(el, { x: pl.x, y: pl.y, angle: pl.angle });
    };
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      persist();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  // ================= data loading =================
  function loadCsvText(text, name, setTitle) {
    let data;
    try { data = window.Contour.parseCSV(text); }
    catch (e) { setStatus('Error: ' + e.message, true); return false; }
    state.data = data; state.rawCsv = text; state.csvName = name || '';
    $('csvName').textContent = name || 'Loaded data';
    if (setTitle && name) {
      state.title = name.replace(/\.csv$/i, '');
      $('titleInput').value = state.title;
    }
    setStatus(data.nx + ' × ' + data.ny + ' grid · z ∈ [' +
      fmtNum(data.zMin) + ', ' + fmtNum(data.zMax) + ']');
    requestRender();
    return true;
  }
  function fmtNum(v) {
    if (v === 0) return '0';
    if (Math.abs(v) < 0.01 || Math.abs(v) >= 1000) return v.toExponential(2);
    return (Math.round(v * 1000) / 1000).toString();
  }

  function setStatus(msg, isErr) {
    const el = $('statusMsg'); el.textContent = msg;
    el.style.color = isErr ? 'var(--danger)' : 'var(--muted)';
  }

  // resolves to an inlined blob URL when bundled standalone, else the asset path
  function headSrc() {
    return (window.__resources && window.__resources.headImg)
      ? window.__resources.headImg : 'assets/head-top-view.png';
  }

  // ================= presets =================
  function refreshPresetSelect(selectName) {
    const sel = $('presetSelect');
    sel.innerHTML = '';
    const optCustom = document.createElement('option');
    optCustom.value = '__custom__'; optCustom.textContent = 'Custom';
    sel.appendChild(optCustom);
    window.Presets.all().forEach(p => {
      const o = document.createElement('option');
      o.value = p.name; o.textContent = p.name + (window.Presets.isBuiltin(p.name) ? '' : ' ★');
      sel.appendChild(o);
    });
    if (selectName) sel.value = selectName;
  }
  function applyPreset(p) {
    $('levelsInput').value = p.levels;
    $('labelsInput').value = p.labels;
    $('colorsInput').value = p.colors;
    if (p.floorColor) state.floorColor = p.floorColor;
    syncFromThresholdInputs();
    updateFloorSwatch();
    updateSwatches();
  }

  function syncFromThresholdInputs() {
    state.levels = parseLevels($('levelsInput').value);
    state.labels = parseLabels($('labelsInput').value);
    state.colors = parseColors($('colorsInput').value);
    requestRender();
  }

  function updateSwatches() {
    const row = $('swatchRow'); row.innerHTML = '';
    state.colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch'; b.style.background = c; b.title = c + ' — click to edit';
      b.addEventListener('click', () => {
        const inp = document.createElement('input'); inp.type = 'color'; inp.value = toHex6(c);
        inp.addEventListener('input', () => {
          const arr = parseColors($('colorsInput').value);
          arr[i] = inp.value;
          $('colorsInput').value = arr.join(', ');
          syncFromThresholdInputs(); updateSwatches(); markCustom();
        });
        inp.click();
      });
      row.appendChild(b);
    });
  }
  function toHex6(c) {
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('');
    return /^#[0-9a-f]{6}$/i.test(c) ? c : '#cccccc';
  }
  function updateFloorSwatch() {
    $('floorSwatch').style.background = state.floorColor;
    $('floorHex').textContent = state.floorColor;
    $('floorColor').value = toHex6(state.floorColor);
  }
  function markCustom() { $('presetSelect').value = '__custom__'; }

  // ================= overlays UI =================
  function renderOverlayList() {
    const list = $('overlayList');
    list.innerHTML = '';
    const all = window.Overlays.getAll();
    const sel = window.Overlays.getSelected();
    if (!all.length) {
      list.innerHTML = '<p class="ov-mini">No overlays yet.</p>';
      return;
    }
    all.slice().reverse().forEach((o, idx) => {
      const realIndex = all.length - idx;
      const item = document.createElement('div');
      item.className = 'ov-item' + (sel && sel.id === o.id ? ' active' : '');
      item.innerHTML =
        '<div class="ov-thumb"></div>' +
        '<div class="ov-meta">' +
          '<div class="ov-row"><span class="ov-mini">Overlay ' + realIndex + '</span></div>' +
          '<div class="ov-row"><span class="ov-mini">Opacity</span>' +
          '<input type="range" min="0.1" max="1" step="0.05" value="' + o.opacity + '"></div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:2px">' +
          '<button class="ov-btn front" title="Bring to front">▲</button>' +
          '<button class="ov-btn del" title="Delete">✕</button>' +
        '</div>';
      item.querySelector('.ov-thumb').style.backgroundImage = "url('" + o.src + "')";
      item.addEventListener('pointerdown', e => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        window.Overlays.select(o.id);
      });
      item.querySelector('input').addEventListener('input', e => window.Overlays.setOpacity(o.id, parseFloat(e.target.value)));
      item.querySelector('.front').addEventListener('click', () => window.Overlays.bringToFront(o.id));
      item.querySelector('.del').addEventListener('click', () => window.Overlays.remove(o.id));
      list.appendChild(item);
    });
  }

  // ================= persistence =================
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const payload = {
        rawCsv: state.rawCsv, csvName: state.csvName,
        title: state.title, xLabel: state.xLabel, yLabel: state.yLabel,
        levelsText: $('levelsInput').value, labelsText: $('labelsInput').value,
        colorsText: $('colorsInput').value, floorColor: state.floorColor,
        sigma: state.sigma, filled: state.filled, grid: state.grid,
        contourLabels: state.contourLabels, equalAspect: state.equalAspect,
        flipY: state.flipY,
        exportScale: state.exportScale, overlays: window.Overlays.serialize(),
        preset: $('presetSelect').value, labelTargets: state.labelTargets
      };
      try { localStorage.setItem(STATE_KEY, JSON.stringify(payload)); } catch (e) {}
    }, 300);
  }
  function restore() {
    let s; try { s = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) {}
    if (!s || !s.rawCsv) return false;
    // migrate older default palettes to the current bright safe→hazard ramp
    const legacyPalettes = [
      '#97ff5f,#d1ff52,#52ffb7,#52d7ff,#fc0000,#f152ff',
      '#6fc368,#bcd64a,#f2c53d,#ee8e3a,#e04430,#7e2a8e'
    ];
    const legacyFloors = ['#3a9b4e', '#159a52'];
    const newRamp = '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0';
    if (s.colorsText && legacyPalettes.indexOf(s.colorsText.replace(/\s/g, '').toLowerCase()) !== -1) {
      s.colorsText = newRamp;
      if (legacyFloors.indexOf((s.floorColor || '').toLowerCase()) !== -1) s.floorColor = '#00A24A';
    }
    state.title = s.title || ''; state.xLabel = s.xLabel || 'X'; state.yLabel = s.yLabel || 'Y';
    state.floorColor = s.floorColor || '#00A24A';
    state.sigma = s.sigma != null ? s.sigma : 1;
    state.filled = s.filled !== false; state.grid = s.grid !== false;
    state.contourLabels = s.contourLabels !== false; state.equalAspect = s.equalAspect !== false;
    state.flipY = s.flipY !== false;
    state.exportScale = s.exportScale || 2;
    state.labelTargets = s.labelTargets || {};
    $('titleInput').value = state.title;
    $('xLabelInput').value = state.xLabel; $('yLabelInput').value = state.yLabel;
    $('levelsInput').value = s.levelsText || '';
    $('labelsInput').value = s.labelsText || '';
    $('colorsInput').value = s.colorsText || '';
    $('sigma').value = state.sigma; $('sigmaVal').textContent = state.sigma.toFixed(1);
    $('filled').checked = state.filled; $('grid').checked = state.grid;
    $('contourLabels').checked = state.contourLabels; $('equalAspect').checked = state.equalAspect;
    $('flipY').checked = state.flipY;
    $('exportScale').value = String(state.exportScale);
    refreshPresetSelect(s.preset && s.preset !== '__custom__' ? s.preset : null);
    if (s.preset) $('presetSelect').value = s.preset;
    state.levels = parseLevels($('levelsInput').value);
    state.labels = parseLabels($('labelsInput').value);
    state.colors = parseColors($('colorsInput').value);
    updateFloorSwatch(); updateSwatches();
    loadCsvText(s.rawCsv, s.csvName);
    if (s.overlays && s.overlays.length) {
      // re-resolve bundled asset overlays to the inlined resource (blob URLs don't survive reload)
      const ovs = s.overlays.map(d => d.kind === 'asset' ? Object.assign({}, d, { src: headSrc() }) : d);
      window.Overlays.load(ovs).then(renderOverlayList);
    }
    return true;
  }

  // ================= export =================
  function buildExportCanvas() {
    if (!layout) return null;
    const scale = state.exportScale;
    const out = document.createElement('canvas');
    out.width = Math.round(layout.figW * scale);
    out.height = Math.round(layout.figH * scale);
    const octx = out.getContext('2d');
    octx.setTransform(scale, 0, 0, scale, 0, 0);
    const lv = state.levels.map((v, i) => ({ v, c: state.colors[i] || '#ccc', l: state.labels[i] || '' }));
    lv.sort((a, b) => a.v - b.v);
    const levels = lv.map(o => o.v), colors = lv.map(o => o.c), labels = lv.map(o => o.l);
    const contours = window.Contour.smoothContours(
      window.Contour.buildContours(state.smoothedValues, state.data.nx, state.data.ny, levels),
      state.sigma);
    const dataRect = { x: layout.dataX0, y: layout.dataY0, w: layout.dataW, h: layout.dataH };
    const placements = state.contourLabels
      ? window.Contour.labelPlacements(contours, levels, labels, layout, state.labelTargets, dataRect)
      : [];
    window.Contour.drawFigure(octx, state.data, layout, {
      levels: levels, colors: colors, labels: labels,
      floorColor: state.floorColor, smoothedValues: state.smoothedValues, contours: contours,
      title: state.title, xLabel: state.xLabel, yLabel: state.yLabel,
      filled: state.filled, grid: state.grid, contourLabels: state.contourLabels,
      labelPlacements: placements, drawLabelsOnCanvas: true,
      transparent: true
    });
    window.Overlays.drawTo(octx);
    return out;
  }

  function exportPng() {
    const out = buildExportCanvas();
    if (!out) return;
    out.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = (state.csvName || state.title || 'contour').replace(/\.csv$/i, '').replace(/[^\w\-]+/g, '_');
      a.href = url; a.download = base + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Exported ' + a.download);
    }, 'image/png');
  }
  window.cpBuildExport = buildExportCanvas;

  // ================= wiring =================
  function wire() {
    $('loadCsvBtn').addEventListener('click', () => $('csvInput').click());
    $('csvInput').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => loadCsvText(r.result, f.name, true);
      r.readAsText(f);
    });
    $('sampleBtn').addEventListener('click', () => {
      loadCsvText(window.SAMPLE_CSV, 'bed sitting eye 1.4m -x.csv', true);
    });

    $('titleInput').addEventListener('input', e => { state.title = e.target.value; requestRender(); });
    $('xLabelInput').addEventListener('input', e => { state.xLabel = e.target.value; requestRender(); });
    $('yLabelInput').addEventListener('input', e => { state.yLabel = e.target.value; requestRender(); });

    ['levelsInput', 'labelsInput', 'colorsInput'].forEach(id => {
      $(id).addEventListener('input', () => { syncFromThresholdInputs(); updateSwatches(); markCustom(); });
    });

    $('presetSelect').addEventListener('change', e => {
      const v = e.target.value;
      if (v === '__custom__') return;
      const p = window.Presets.get(v); if (p) applyPreset(p);
    });
    $('savePresetBtn').addEventListener('click', () => {
      const name = prompt('Preset name:', 'My preset'); if (!name) return;
      if (window.Presets.isBuiltin(name)) { alert('That name is reserved.'); return; }
      window.Presets.save({
        name, levels: $('levelsInput').value, labels: $('labelsInput').value,
        colors: $('colorsInput').value, floorColor: state.floorColor
      });
      refreshPresetSelect(name);
      setStatus('Saved preset “' + name + '”');
    });
    $('delPresetBtn').addEventListener('click', () => {
      const v = $('presetSelect').value;
      if (v === '__custom__') return;
      if (window.Presets.isBuiltin(v)) { alert('Built-in presets cannot be deleted.'); return; }
      window.Presets.remove(v); refreshPresetSelect(); $('presetSelect').value = '__custom__';
    });

    $('exportPresetsBtn').addEventListener('click', () => {
      const data = window.Presets.exportData();
      if (!data.presets.length) {
        setStatus('No custom presets yet — use “Save” to create one first.', true);
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'contour-presets.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Exported ' + data.presets.length + ' preset' + (data.presets.length > 1 ? 's' : ''));
    });
    $('importPresetsBtn').addEventListener('click', () => $('presetsFile').click());
    $('presetsFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        let obj;
        try { obj = JSON.parse(r.result); }
        catch (err) { setStatus('Import failed: invalid JSON file.', true); return; }
        const n = window.Presets.importData(obj, false);
        if (n > 0) {
          refreshPresetSelect();
          setStatus('Imported ' + n + ' preset' + (n > 1 ? 's' : ''));
        } else {
          setStatus('No presets found in that file.', true);
        }
      };
      r.readAsText(f);
      e.target.value = '';
    });

    $('floorSwatch').addEventListener('click', () => $('floorColor').click());
    $('floorColor').addEventListener('input', e => {
      state.floorColor = e.target.value; updateFloorSwatch(); requestRender(); markCustom();
    });

    $('sigma').addEventListener('input', e => {
      state.sigma = parseFloat(e.target.value);
      $('sigmaVal').textContent = state.sigma.toFixed(1);
      requestRender();
    });

    [['filled', 'filled'], ['grid', 'grid'], ['contourLabels', 'contourLabels'], ['equalAspect', 'equalAspect'], ['flipY', 'flipY']]
      .forEach(([id, key]) => {
        $(id).addEventListener('change', e => { state[key] = e.target.checked; requestRender(); });
      });

    $('addOverlayBtn').addEventListener('click', () => $('overlayInput').click());
    $('overlayInput').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => window.Overlays.add({ src: r.result, kind: 'data' }).then(renderOverlayList);
      r.readAsDataURL(f);
      e.target.value = '';
    });
    $('addHeadBtn').addEventListener('click', () => {
      window.Overlays.add({ src: headSrc(), kind: 'asset', rot: 90 }).then(renderOverlayList);
    });

    $('exportScale').addEventListener('change', e => { state.exportScale = parseInt(e.target.value, 10); persist(); });
    $('savePngBtn').addEventListener('click', exportPng);
    $('fitBtn').addEventListener('click', applyFit);

    window.addEventListener('resize', applyFit);
    window.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace')) {
        const sel = window.Overlays.getSelected();
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (sel && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          window.Overlays.remove(sel.id); e.preventDefault();
        }
      }
    });
  }

  // ================= init =================
  function init() {
    window.Overlays.init({
      layerEl: overlayLayer,
      getScale: () => fitScale,
      onChange: () => { persist(); },
      onSelect: () => { renderOverlayList(); }
    });
    wire();

    if (restore()) { renderOverlayList(); return; }

    // first-run defaults
    refreshPresetSelect('Eye limits irradiance');
    const p = window.Presets.get('Eye limits irradiance');
    $('titleInput').value = state.title;
    $('xLabelInput').value = state.xLabel; $('yLabelInput').value = state.yLabel;
    $('sigma').value = state.sigma; $('sigmaVal').textContent = state.sigma.toFixed(1);
    applyPreset(p);
    loadCsvText(window.SAMPLE_CSV, 'bed sitting eye 1.4m -x.csv', true);
    // add head overlay near top-right like the reference
    setTimeout(() => {
      if (!layout) return;
      window.Overlays.add({
        src: headSrc(), kind: 'asset',
        x: layout.dataX0 + layout.dataW * 0.66, y: layout.dataY0 + layout.dataH * 0.24,
        w: layout.dataW * 0.26, rot: 95
      }).then(o => { window.Overlays.select(null); renderOverlayList(); });
    }, 120);
    renderOverlayList();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
