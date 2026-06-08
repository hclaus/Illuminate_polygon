/* overlays.js — interactive overlay layer (drag, corner-resize, rotate, opacity).
   All overlay geometry is stored in FIGURE base pixels (same space as the canvas).
   The layer element is rendered inside the scaled figure wrapper. */
(function () {
  'use strict';

  let layerEl = null;
  let getScale = () => 1;
  let onChange = () => {};
  let onSelect = () => {};
  let items = [];
  let selectedId = null;
  let figW = 800, figH = 800;
  let uid = 1;

  function init(opts) {
    layerEl = opts.layerEl;
    getScale = opts.getScale || getScale;
    onChange = opts.onChange || onChange;
    onSelect = opts.onSelect || onSelect;
    layerEl.addEventListener('pointerdown', e => {
      if (e.target === layerEl) { select(null); }
    });
  }

  function setLayerSize(w, h) {
    figW = w; figH = h;
    layerEl.style.width = w + 'px';
    layerEl.style.height = h + 'px';
  }

  function pointerToFigure(e) {
    const rect = layerEl.getBoundingClientRect();
    const s = getScale() || 1;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
  }

  function add(opts) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    return new Promise((resolve, reject) => {
      img.onload = () => {
        const ratio = img.naturalWidth / img.naturalHeight || 1;
        const w = opts.w != null ? opts.w : Math.min(figW * 0.22, 240);
        const h = opts.h != null ? opts.h : w / ratio;
        const o = {
          id: 'ov' + (uid++),
          src: opts.src, kind: opts.kind || 'data',
          img: img, ratio: ratio,
          x: opts.x != null ? opts.x : figW * 0.5,
          y: opts.y != null ? opts.y : figH * 0.42,
          w: w,
          h: h,
          rot: opts.rot || 0,
          opacity: opts.opacity != null ? opts.opacity : 1
        };
        items.push(o);
        render();
        select(o.id);
        onChange();
        resolve(o);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = opts.src;
    });
  }

  function remove(id) {
    items = items.filter(o => o.id !== id);
    if (selectedId === id) selectedId = null;
    render(); onChange(); onSelect(getSelected());
  }

  function clear() { items = []; selectedId = null; render(); }

  function setOpacity(id, v) {
    const o = items.find(o => o.id === id); if (!o) return;
    o.opacity = v; render(); onChange();
  }
  function bringToFront(id) {
    const i = items.findIndex(o => o.id === id); if (i < 0) return;
    const [o] = items.splice(i, 1); items.push(o); render(); onChange();
  }
  function select(id) {
    selectedId = id; render(); onSelect(getSelected());
  }
  function getSelected() { return items.find(o => o.id === selectedId) || null; }
  function getAll() { return items; }

  function serialize() {
    return items.map(o => ({
      src: o.src, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h,
      rot: o.rot, opacity: o.opacity
    }));
  }
  async function load(arr) {
    clear();
    for (const d of (arr || [])) {
      try { await add(d); } catch (e) { /* skip broken */ }
    }
    select(null);
  }

  // ---- interaction ----
  function startDrag(e, o) {
    e.stopPropagation(); e.preventDefault();
    select(o.id);
    const p = pointerToFigure(e);
    const offX = p.x - o.x, offY = p.y - o.y;
    const move = ev => {
      const q = pointerToFigure(ev);
      o.x = q.x - offX; o.y = q.y - offY;
      render();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startResize(e, o) {
    e.stopPropagation(); e.preventDefault();
    select(o.id);
    const baseDiag = Math.hypot(o.w / 2, o.h / 2);
    const w0 = o.w, h0 = o.h;
    const move = ev => {
      const q = pointerToFigure(ev);
      const d = Math.hypot(q.x - o.x, q.y - o.y);
      const f = Math.max(0.05, d / baseDiag);
      o.w = Math.max(16, w0 * f); o.h = Math.max(16, h0 * f);
      render();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startRotate(e, o) {
    e.stopPropagation(); e.preventDefault();
    select(o.id);
    const move = ev => {
      const q = pointerToFigure(ev);
      let ang = Math.atan2(q.y - o.y, q.x - o.x) * 180 / Math.PI + 90;
      if (ev.shiftKey) ang = Math.round(ang / 15) * 15;
      o.rot = ang;
      render();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function render() {
    if (!layerEl) return;
    layerEl.innerHTML = '';
    for (const o of items) {
      const box = document.createElement('div');
      box.className = 'ov-box' + (o.id === selectedId ? ' selected' : '');
      box.style.left = o.x + 'px';
      box.style.top = o.y + 'px';
      box.style.width = o.w + 'px';
      box.style.height = o.h + 'px';
      box.style.transform = 'translate(-50%,-50%) rotate(' + o.rot + 'deg)';

      const im = document.createElement('img');
      im.src = o.src; im.draggable = false;
      im.style.opacity = o.opacity;
      box.appendChild(im);

      box.addEventListener('pointerdown', e => startDrag(e, o));

      if (o.id === selectedId) {
        const frame = document.createElement('div');
        frame.className = 'ov-frame';
        box.appendChild(frame);
        // corner handles
        [['nw', 0, 0], ['ne', 1, 0], ['se', 1, 1], ['sw', 0, 1]].forEach(([cls, hx, hy]) => {
          const hdl = document.createElement('div');
          hdl.className = 'ov-handle ov-' + cls;
          hdl.style.left = (hx * 100) + '%';
          hdl.style.top = (hy * 100) + '%';
          hdl.addEventListener('pointerdown', e => startResize(e, o));
          box.appendChild(hdl);
        });
        // rotate handle
        const rstem = document.createElement('div');
        rstem.className = 'ov-rotstem';
        box.appendChild(rstem);
        const rot = document.createElement('div');
        rot.className = 'ov-rothandle';
        rot.addEventListener('pointerdown', e => startRotate(e, o));
        box.appendChild(rot);
      }
      layerEl.appendChild(box);
    }
  }

  // draw all overlays onto an export canvas context (already scaled by dpr)
  function drawTo(ctx) {
    for (const o of items) {
      ctx.save();
      ctx.globalAlpha = o.opacity;
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot * Math.PI / 180);
      try { ctx.drawImage(o.img, -o.w / 2, -o.h / 2, o.w, o.h); } catch (e) {}
      ctx.restore();
    }
  }

  window.Overlays = {
    init, setLayerSize, add, remove, clear, setOpacity, bringToFront,
    select, getSelected, getAll, serialize, load, render, drawTo
  };
})();
