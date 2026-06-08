/* presets.js — built-in + user threshold presets (localStorage). */
(function () {
  'use strict';
  const KEY = 'contourPlotter.presets.v1';

  const BUILT_IN = [
    {
      name: 'Eye limits irradiance',
      builtin: true,
      levels: '0.7, 1.06, 2.13, 3.2, 5.33, 10.6',
      labels: 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
      colors: '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
      floorColor: '#00A24A'
    },
    {
      name: 'Sequential (5 levels)',
      builtin: true,
      levels: '0.2, 0.4, 0.6, 0.8, 1.0',
      labels: 'L1, L2, L3, L4, L5',
      colors: '#fee5d9, #fcae91, #fb6a4a, #de2d26, #a50f15',
      floorColor: '#ffffff'
    }
  ];

  function loadUser() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function saveUser(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }
  function all() { return BUILT_IN.concat(loadUser()); }
  function get(name) { return all().find(p => p.name === name) || null; }

  function save(preset) {
    const list = loadUser();
    const i = list.findIndex(p => p.name === preset.name);
    const clean = {
      name: preset.name, levels: preset.levels, labels: preset.labels,
      colors: preset.colors, floorColor: preset.floorColor
    };
    if (i >= 0) list[i] = clean; else list.push(clean);
    saveUser(list);
  }
  function remove(name) {
    saveUser(loadUser().filter(p => p.name !== name));
  }
  function isBuiltin(name) {
    return BUILT_IN.some(p => p.name === name);
  }

  // ---- JSON import / export (custom presets) ----
  function exportData() {
    return { app: 'contour-plotter', kind: 'presets', version: 1, presets: loadUser() };
  }
  function importData(obj, replace) {
    let incoming = Array.isArray(obj) ? obj : (obj && obj.presets) || [];
    if (!Array.isArray(incoming)) return 0;
    const list = replace ? [] : loadUser();
    let added = 0;
    incoming.forEach(p => {
      if (!p || !p.name || isBuiltin(p.name)) return;
      const clean = {
        name: String(p.name),
        levels: String(p.levels != null ? p.levels : ''),
        labels: String(p.labels != null ? p.labels : ''),
        colors: String(p.colors != null ? p.colors : ''),
        floorColor: p.floorColor || '#000000'
      };
      const i = list.findIndex(x => x.name === clean.name);
      if (i >= 0) list[i] = clean; else list.push(clean);
      added++;
    });
    saveUser(list);
    return added;
  }

  window.Presets = { all, get, save, remove, isBuiltin, exportData, importData, BUILT_IN };
})();
