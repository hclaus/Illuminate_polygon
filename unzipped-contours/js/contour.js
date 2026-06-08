/* contour.js — CSV parsing, Gaussian smoothing, layout + canvas figure drawing.
   Depends on global d3 (d3.contours, d3.ticks). */
(function () {
  'use strict';

  // ---- CSV parsing -------------------------------------------------------
  // Format: row0 = ["", x0, x1, ...]; each next row = [y, v0, v1, ...].
  // Grid terminates at the first blank line OR a line whose first cell is empty.
  function parseCSV(text) {
    const lines = String(text).split(/\r?\n/);
    if (!lines.length) throw new Error('Empty file');
    const header = lines[0].split(',');
    const xs = [];
    for (let i = 1; i < header.length; i++) {
      const v = parseFloat(header[i]);
      if (Number.isFinite(v)) xs.push(v);
    }
    if (xs.length < 2) throw new Error('Could not read X values from first row.');
    const nx = xs.length;

    const rows = []; // {y, vals[]}
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.trim() === '') break;
      const cells = ln.split(',');
      const first = cells[0].trim();
      if (first === '') break; // empty first cell = terminator
      const y = parseFloat(first);
      if (!Number.isFinite(y)) break;
      const vals = new Array(nx);
      for (let k = 0; k < nx; k++) {
        const v = parseFloat(cells[k + 1]);
        vals[k] = Number.isFinite(v) ? v : 0;
      }
      rows.push({ y: y, vals: vals });
    }
    if (rows.length < 2) throw new Error('Could not read grid rows.');

    // Sort rows ascending in y so index 0 = yMin (bottom).
    rows.sort((a, b) => a.y - b.y);
    const ny = rows.length;
    const ys = rows.map(r => r.y);

    const values = new Float64Array(nx * ny);
    let zMin = Infinity, zMax = -Infinity;
    for (let j = 0; j < ny; j++) {
      const vals = rows[j].vals;
      for (let i = 0; i < nx; i++) {
        const v = vals[i];
        values[j * nx + i] = v;
        if (v < zMin) zMin = v;
        if (v > zMax) zMax = v;
      }
    }
    return {
      xs: xs, ys: ys, nx: nx, ny: ny, values: values,
      xMin: xs[0], xMax: xs[nx - 1],
      yMin: ys[0], yMax: ys[ny - 1],
      zMin: zMin, zMax: zMax
    };
  }

  // ---- Gaussian smoothing (separable) -----------------------------------
  function gaussianBlur(values, nx, ny, sigma) {
    if (!sigma || sigma <= 0) return values;
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernel = new Float64Array(radius * 2 + 1);
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      kernel[k + radius] = w; sum += w;
    }
    for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;

    const tmp = new Float64Array(nx * ny);
    const out = new Float64Array(nx * ny);
    // Horizontal pass (clamp edges)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          let ii = i + k; if (ii < 0) ii = 0; else if (ii >= nx) ii = nx - 1;
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
          let jj = j + k; if (jj < 0) jj = 0; else if (jj >= ny) jj = ny - 1;
          acc += tmp[jj * nx + i] * kernel[k + radius];
        }
        out[j * nx + i] = acc;
      }
    }
    return out;
  }

  // ---- Layout ------------------------------------------------------------
  const M = { top: 76, bottom: 72, left: 84, right: 244 };
  const CB = { gap: 30, width: 32, labelGap: 14 };
  const MAX_DATA_W = 520, MAX_DATA_H = 760;

  function computeLayout(data, equalAspect, flipY) {
    const nx = data.nx, ny = data.ny;
    const stepX = (data.xMax - data.xMin) / (nx - 1);
    const stepY = (data.yMax - data.yMin) / (ny - 1);
    // data area spans EXACTLY [xMin,xMax] x [yMin,yMax] — origin sits in the corner
    const extentX = data.xMax - data.xMin;
    const extentY = data.yMax - data.yMin;

    let dataW, dataH;
    if (equalAspect) {
      const s = Math.min(MAX_DATA_W / extentX, MAX_DATA_H / extentY);
      dataW = extentX * s; dataH = extentY * s;
    } else {
      dataW = MAX_DATA_W; dataH = MAX_DATA_H;
    }
    const dataX0 = M.left, dataY0 = M.top;
    const figW = M.left + dataW + M.right;
    const figH = M.top + dataH + M.bottom;

    // d3 contour coord c in [0,nx]; sample i (= data value i) sits at c=i+0.5.
    // Map so sample 0 -> left edge and sample nx-1 -> right edge (no half-cell padding).
    const mapX = c => dataX0 + ((c - 0.5) / (nx - 1)) * dataW;
    // flipY mirrors the rendered image vertically (sample 0 at top instead of
    // bottom). Axis ticks/labels (valToY) are unaffected, so coordinates still
    // increase going upwards — only the data picture is flipped.
    const mapY = flipY
      ? c => dataY0 + ((c - 0.5) / (ny - 1)) * dataH
      : c => dataY0 + dataH - ((c - 0.5) / (ny - 1)) * dataH;
    const invX = px => ((px - dataX0) / dataW) * (nx - 1) + 0.5;   // pixel -> contour coord
    const invY = flipY
      ? py => ((py - dataY0) / dataH) * (ny - 1) + 0.5
      : py => ((dataY0 + dataH - py) / dataH) * (ny - 1) + 0.5;
    const valToX = v => dataX0 + ((v - data.xMin) / extentX) * dataW;
    const valToY = v => dataY0 + dataH - ((v - data.yMin) / extentY) * dataH;

    return {
      nx, ny, stepX, stepY, figW, figH,
      dataX0, dataY0, dataW, dataH,
      mapX, mapY, invX, invY, valToX, valToY,
      cbX: dataX0 + dataW + CB.gap, cbW: CB.width,
      cbY0: dataY0, cbH: dataH
    };
  }

  // ---- Contour geometry --------------------------------------------------
  function buildContours(values, nx, ny, levels) {
    const gen = d3.contours().size([nx, ny]).smooth(true);
    return levels.map(lv => gen.contour(values, lv));
  }

  // Smooth a single closed ring with a circular Gaussian over its vertices.
  function smoothRing(ring, sigma) {
    if (sigma <= 0 || ring.length < 6) return ring;
    const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    const pts = closed ? ring.slice(0, -1) : ring.slice();
    const n = pts.length;
    if (n < 5) return ring;
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernel = []; let sum = 0;
    for (let k = -radius; k <= radius; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); kernel.push(w); sum += w; }
    for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let ax = 0, ay = 0;
      for (let k = -radius; k <= radius; k++) {
        const idx = ((i + k) % n + n) % n;
        const w = kernel[k + radius];
        ax += pts[idx][0] * w; ay += pts[idx][1] * w;
      }
      out[i] = [ax, ay];
    }
    out.push(out[0].slice()); // re-close
    return out;
  }

  // Smooth every ring of every contour (returns new geometry; sigma in vertex units).
  function smoothContours(contours, sigma) {
    if (!sigma || sigma <= 0) return contours;
    return contours.map(mp => ({
      type: mp.type, value: mp.value,
      coordinates: mp.coordinates.map(poly => poly.map(ring => smoothRing(ring, sigma)))
    }));
  }

  function tracePath(ctx, multipoly, mapX, mapY) {
    ctx.beginPath();
    const coords = multipoly.coordinates;
    for (let p = 0; p < coords.length; p++) {
      const poly = coords[p];
      for (let r = 0; r < poly.length; r++) {
        const ring = poly[r];
        for (let k = 0; k < ring.length; k++) {
          const X = mapX(ring[k][0]); const Y = mapY(ring[k][1]);
          if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.closePath();
      }
    }
  }

  // Pick a label anchor on the longest outer ring of a contour.
  function labelAnchor(multipoly, mapX, mapY, dataRect) {
    const coords = multipoly.coordinates;
    let best = null, bestLen = -1;
    for (let p = 0; p < coords.length; p++) {
      const ring = coords[p][0];
      if (!ring || ring.length < 6) continue;
      let len = 0;
      for (let k = 1; k < ring.length; k++) {
        const dx = ring[k][0] - ring[k - 1][0], dy = ring[k][1] - ring[k - 1][1];
        len += Math.hypot(dx, dy);
      }
      if (len > bestLen) { bestLen = len; best = ring; }
    }
    if (!best) return null;
    // walk to ~ a target fraction, prefer a point near the top of the data area
    let bestPt = null, bestScore = -Infinity;
    for (let k = 2; k < best.length - 2; k += 1) {
      const X = mapX(best[k][0]); const Y = mapY(best[k][1]);
      // prefer interior (not hugging edges) and upper region
      const inset = Math.min(X - dataRect.x, dataRect.x + dataRect.w - X,
                             Y - dataRect.y, dataRect.y + dataRect.h - Y);
      if (inset < 14) continue;
      const score = (dataRect.y + dataRect.h - Y) + inset * 0.4;
      if (score > bestScore) {
        const a = best[k - 2], b = best[k + 2];
        let ang = Math.atan2(mapY(b[1]) - mapY(a[1]), mapX(b[0]) - mapX(a[0]));
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        bestScore = score; bestPt = { x: X, y: Y, angle: ang };
      }
    }
    return bestPt;
  }

  // Closest point on a contour to a target (target in contour-grid coords),
  // returning pixel {x,y} and tangent angle (radians, clamped to readable range).
  function closestOnContour(multipoly, target, L) {
    const coords = multipoly.coordinates;
    let best = null, bestRing = null, bestK = 0, bestD = Infinity;
    for (let p = 0; p < coords.length; p++) {
      for (let r = 0; r < coords[p].length; r++) {
        const ring = coords[p][r];
        for (let k = 0; k < ring.length; k++) {
          const dx = ring[k][0] - target.gx, dy = ring[k][1] - target.gy;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = ring[k]; bestRing = ring; bestK = k; }
        }
      }
    }
    if (!best) return null;
    const n = bestRing.length;
    const a = bestRing[(bestK - 2 + n) % n], b = bestRing[(bestK + 2) % n];
    let ang = Math.atan2(L.mapY(b[1]) - L.mapY(a[1]), L.mapX(b[0]) - L.mapX(a[0]));
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    return { x: L.mapX(best[0]), y: L.mapY(best[1]), angle: ang };
  }

  // Compute placement {i, x, y, angle, text} for every labelled level.
  // targets: optional map {i: {gx,gy}} of user-dragged anchors (contour-grid coords).
  function labelPlacements(contours, levels, labels, L, targets, dataRect) {
    const out = [];
    for (let i = 0; i < levels.length; i++) {
      const text = (labels[i] || '').trim();
      if (!text) continue;
      const mp = contours[i];
      if (!mp || !mp.coordinates || !mp.coordinates.length) continue;
      let pt = null;
      if (targets && targets[i]) pt = closestOnContour(mp, targets[i], L);
      if (!pt) pt = labelAnchor(mp, L.mapX, L.mapY, dataRect);
      if (!pt) continue;
      out.push({ i: i, x: pt.x, y: pt.y, angle: pt.angle, text: text });
    }
    return out;
  }

  // ---- Drawing -----------------------------------------------------------
  function drawFigure(ctx, data, L, state) {
    const {
      levels, colors, labels, floorColor, title,
      filled, grid, contourLabels, xLabel, yLabel, transparent
    } = state;

    ctx.clearRect(0, 0, L.figW, L.figH);
    // page background (skipped for transparent PNG export)
    if (!transparent) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, L.figW, L.figH);
    }

    const dataRect = { x: L.dataX0, y: L.dataY0, w: L.dataW, h: L.dataH };

    // --- contour fills ---
    const contours = state.contours || buildContours(state.smoothedValues, L.nx, L.ny, levels);
    ctx.save();
    ctx.beginPath();
    ctx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
    ctx.clip();
    if (filled) {
      // floor (below lowest level)
      ctx.fillStyle = floorColor;
      ctx.fillRect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
      // bands: paint area>=level ascending so higher bands cover lower
      for (let i = 0; i < levels.length; i++) {
        ctx.fillStyle = colors[i] || '#cccccc';
        tracePath(ctx, contours[i], L.mapX, L.mapY);
        ctx.fill('evenodd');
      }
    } else {
      if (!transparent) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
      }
    }
    ctx.restore();

    // --- grid lines ---
    const xticks = d3.ticks(data.xMin, data.xMax, 7);
    const yticks = d3.ticks(data.yMin, data.yMax, 9);
    if (grid) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      xticks.forEach(t => {
        const X = L.valToX(t);
        ctx.beginPath(); ctx.moveTo(X, dataRect.y); ctx.lineTo(X, dataRect.y + dataRect.h); ctx.stroke();
      });
      yticks.forEach(t => {
        const Y = L.valToY(t);
        ctx.beginPath(); ctx.moveTo(dataRect.x, Y); ctx.lineTo(dataRect.x + dataRect.w, Y); ctx.stroke();
      });
      ctx.restore();
    }

    // --- contour lines ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(dataRect.x, dataRect.y, dataRect.w, dataRect.h);
    ctx.clip();
    ctx.lineJoin = 'round';
    for (let i = 0; i < levels.length; i++) {
      ctx.strokeStyle = 'rgba(20,22,28,0.75)';
      ctx.lineWidth = 1.4;
      tracePath(ctx, contours[i], L.mapX, L.mapY);
      ctx.stroke();
    }
    ctx.restore();

    // --- inline contour labels (canvas: export only; on-screen uses DOM) ---
    if (contourLabels && state.drawLabelsOnCanvas) {
      const placements = state.labelPlacements ||
        labelPlacements(contours, levels, labels, L, state.labelTargets, dataRect);
      ctx.save();
      ctx.font = '600 13px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const pl of placements) {
        ctx.save();
        ctx.translate(pl.x, pl.y);
        ctx.rotate(pl.angle);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeText(pl.text, 0, 0);
        ctx.fillStyle = '#15171c';
        ctx.fillText(pl.text, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    // --- data-area border ---
    ctx.strokeStyle = '#3a3f4a';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(dataRect.x + 0.5, dataRect.y + 0.5, dataRect.w, dataRect.h);

    // --- axes ticks + labels ---
    ctx.fillStyle = '#2a2e37';
    ctx.strokeStyle = '#3a3f4a';
    ctx.lineWidth = 1;
    ctx.font = '13px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    xticks.forEach(t => {
      const X = L.valToX(t);
      if (X < dataRect.x - 0.5 || X > dataRect.x + dataRect.w + 0.5) return;
      ctx.beginPath(); ctx.moveTo(X, dataRect.y + dataRect.h); ctx.lineTo(X, dataRect.y + dataRect.h + 6); ctx.stroke();
      ctx.fillText(fmt(t), X, dataRect.y + dataRect.h + 10);
    });
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yticks.forEach(t => {
      const Y = L.valToY(t);
      if (Y < dataRect.y - 0.5 || Y > dataRect.y + dataRect.h + 0.5) return;
      ctx.beginPath(); ctx.moveTo(dataRect.x, Y); ctx.lineTo(dataRect.x - 6, Y); ctx.stroke();
      ctx.fillText(fmt(t), dataRect.x - 10, Y);
    });

    // axis titles
    ctx.fillStyle = '#4a505c';
    ctx.font = '14px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(xLabel || 'X', dataRect.x + dataRect.w / 2, L.figH - 20);
    ctx.save();
    ctx.translate(24, dataRect.y + dataRect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(yLabel || 'Y', 0, 0);
    ctx.restore();

    // --- title ---
    if (title) {
      ctx.fillStyle = '#15171c';
      ctx.font = '600 22px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(title, dataRect.x + dataRect.w / 2, M.top / 2 + 4);
    }

    // --- colorbar ---
    drawColorbar(ctx, L, state);
  }

  function drawColorbar(ctx, L, state) {
    const { levels, colors, labels, floorColor } = state;
    const n = levels.length;
    const segs = n + 1; // floor + n bands
    const segH = L.cbH / segs;
    const x = L.cbX, w = L.cbW, yTop = L.cbY0;
    // bottom = floor, then colors upward
    const segColors = [floorColor].concat(colors.slice(0, n));
    for (let s = 0; s < segs; s++) {
      // s=0 is bottom (floor)
      const yy = yTop + L.cbH - (s + 1) * segH;
      ctx.fillStyle = segColors[s] || '#ccc';
      ctx.fillRect(x, yy, w, segH);
    }
    ctx.strokeStyle = '#3a3f4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, yTop + 0.5, w, L.cbH);
    // separators
    ctx.strokeStyle = 'rgba(58,63,74,0.6)';
    for (let s = 1; s < segs; s++) {
      const yy = yTop + L.cbH - s * segH;
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    }
    // labels at the BOTTOM edge of each color band — marks the contour level
    // (band i opens at level[i], i.e. the boundary below segment i+1)
    ctx.fillStyle = '#1f2229';
    ctx.font = '14px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const lab = (labels[i] || '').trim() || ('≥ ' + fmt(levels[i]));
      const segIndexFromBottom = i + 1;
      const cy = yTop + L.cbH - segIndexFromBottom * segH;
      ctx.beginPath();
      ctx.strokeStyle = '#9aa1ad';
      ctx.moveTo(x + w, cy); ctx.lineTo(x + w + 8, cy); ctx.stroke();
      ctx.fillText(lab, x + w + 13, cy);
    }
  }

  function fmt(v) {
    if (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01)) return v.toExponential(1);
    const r = Math.round(v * 100) / 100;
    return String(r);
  }

  window.Contour = {
    parseCSV, gaussianBlur, computeLayout, drawFigure, buildContours,
    smoothContours, labelPlacements, closestOnContour
  };
})();
