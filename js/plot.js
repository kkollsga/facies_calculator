"use strict";

// ============================================================
// Plot panel: histogram + cross-plot (raw SVG)
// ============================================================

const PLOT_COLORS = [
  '#c0723a', '#3d6e74', '#8b6da7', '#5d8c4a', '#b8546d',
  '#7a8a3e', '#a85a3a', '#56789a', '#9c7d3a', '#6f5582',
];

function svgEl(name, attrs, parent) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  if (attrs) for (const k in attrs) {
    if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  }
  if (parent) parent.appendChild(el);
  return el;
}

function makeShape(idx, x, y, color, opacity) {
  const s = idx % 6;
  const fill = color, op = opacity == null ? 0.7 : opacity;
  if (s === 0) return svgEl('circle',  { cx: x, cy: y, r: 3.5, fill, 'fill-opacity': op, stroke: color, 'stroke-width': 0.7, 'stroke-opacity': Math.min(1, op + 0.3) });
  if (s === 1) return svgEl('rect',    { x: x - 3.2, y: y - 3.2, width: 6.4, height: 6.4, fill, 'fill-opacity': op, stroke: color, 'stroke-width': 0.7, 'stroke-opacity': Math.min(1, op + 0.3) });
  if (s === 2) return svgEl('polygon', { points: (x) + ',' + (y - 4) + ' ' + (x + 3.7) + ',' + (y + 3) + ' ' + (x - 3.7) + ',' + (y + 3), fill, 'fill-opacity': op, stroke: color, 'stroke-width': 0.7, 'stroke-opacity': Math.min(1, op + 0.3) });
  if (s === 3) return svgEl('polygon', { points: (x) + ',' + (y - 4.5) + ' ' + (x + 4) + ',' + y + ' ' + (x) + ',' + (y + 4.5) + ' ' + (x - 4) + ',' + y, fill, 'fill-opacity': op, stroke: color, 'stroke-width': 0.7, 'stroke-opacity': Math.min(1, op + 0.3) });
  if (s === 4) return svgEl('path',    { d: 'M ' + (x - 1) + ' ' + (y - 4) + ' h 2 v 3 h 3 v 2 h -3 v 3 h -2 v -3 h -3 v -2 h 3 z', fill, 'fill-opacity': op, stroke: color, 'stroke-width': 0.7, 'stroke-opacity': Math.min(1, op + 0.3) });
  // x mark
  return svgEl('path', {
    d: 'M ' + (x - 3) + ' ' + (y - 4) + ' L ' + x + ' ' + (y - 1) + ' L ' + (x + 3) + ' ' + (y - 4) + ' L ' + (x + 4) + ' ' + (y - 3) + ' L ' + (x + 1) + ' ' + y + ' L ' + (x + 4) + ' ' + (y + 3) + ' L ' + (x + 3) + ' ' + (y + 4) + ' L ' + x + ' ' + (y + 1) + ' L ' + (x - 3) + ' ' + (y + 4) + ' L ' + (x - 4) + ' ' + (y + 3) + ' L ' + (x - 1) + ' ' + y + ' L ' + (x - 4) + ' ' + (y - 3) + ' Z',
    fill, 'fill-opacity': op, stroke: color, 'stroke-width': 0.7, 'stroke-opacity': Math.min(1, op + 0.3),
  });
}

function snapshotFilters() {
  return {
    wells: new Set(plotState.filters.wells),
    zones: new Set(plotState.filters.zones),
    facies: new Set(plotState.filters.facies),
  };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function uniqueValues(points, key) {
  const set = new Set();
  for (const p of points) if (p[key] != null) set.add(p[key]);
  return [...set].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (isFinite(na) && isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

function buildFilterChips(containerId, items, set, labelFn) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:11px;color:var(--ink-soft);font-style:italic;';
    empty.textContent = 'no data';
    c.appendChild(empty);
    return;
  }
  for (const item of items) {
    const chip = document.createElement('span');
    chip.className = 'plot-chip' + (set.has(item) ? ' active' : '');
    chip.textContent = labelFn ? labelFn(item) : String(item);
    chip.dataset.value = String(item);
    chip.addEventListener('click', () => {
      if (set.has(item)) set.delete(item); else set.add(item);
      chip.classList.toggle('active');
      // Filters and the active-regression selection are independent now: changing
      // a filter just affects what the cross-plot draws and what the next-Add
      // captures. The active regression's locked filters are unchanged either way.
      refreshPlotPanel();
      Projects.saveDebounced();
    });
    c.appendChild(chip);
  }
}

// Fingerprint of the current plot's categorical structure (well/zone/facies
// sets). Used to skip the heavy reset in initPlotPanel when an autoRefresh
// runs but the structure hasn't actually changed — preserves the user's
// filter selections and regression list across minor edits.
let _plotCategoryFp = null;
// Tracks the last detected category lists so reconcile (in initPlotPanel)
// can distinguish "brand-new category → default include" from "previously
// known category that the user explicitly excluded → keep excluded".
let _plotPrevDetected = { wells: [], zones: [], facies: [] };

function resetPlotCategoryCache() {
  _plotCategoryFp = null;
  _plotPrevDetected = { wells: [], zones: [], facies: [] };
}

function _reconcilePlotFilter(set, prevDetected, newDetected) {
  const newDet = new Set(newDetected);
  const prevDet = new Set(prevDetected);
  for (const v of [...set]) if (!newDet.has(v)) set.delete(v);
  for (const v of newDetected) if (!prevDet.has(v)) set.add(v);
}

function _categoryFingerprint() {
  if (!lastPorPoints || lastPorPoints.length === 0) return '';
  const w = new Set(), z = new Set(), f = new Set();
  for (const p of lastPorPoints) {
    if (p.well != null) w.add(p.well);
    if (p.zone != null) z.add(p.zone);
    if (p.facies != null) f.add(p.facies);
  }
  return [...w].sort().join('|') + '\x00'
       + [...z].sort().join('|') + '\x00'
       + [...f].sort().join('|');
}

function _updatePermDependentControls() {
  // Cross-plot needs permeability; histogram's perm variable too.
  const crossEl = document.getElementById('pt-cross');
  crossEl.disabled = !lastHasPermeability;
  if (!lastHasPermeability && plotState.type === 'cross') {
    plotState.type = 'hist';
    document.getElementById('pt-hist').checked = true;
  }
  const varEl = document.getElementById('hist-var');
  varEl.querySelector('option[value="perm"]').disabled = !lastHasPermeability;
  if (!lastHasPermeability && varEl.value === 'perm') varEl.value = 'por';
}

function initPlotPanel() {
  // The toggle button (below the pivot output) is only meaningful when
  // there's porosity data to plot. Hide it otherwise.
  const toggleBtn = document.getElementById('plot-toggle-btn');
  if (toggleBtn) toggleBtn.style.display = lastPorPoints.length > 0 ? '' : 'none';
  if (lastPorPoints.length === 0) {
    document.getElementById('plot-section').style.display = 'none';
    // Don't touch plotState.visible — that's the user's intent, not a derived
    // state. When data returns, syncPlotPanelDisplay restores the section.
    _updatePlotToggleUI();
    // Don't reset _plotCategoryFp here — survives short data-edit flickers
    // so the user's filter selections aren't wiped on every transient parse.
    return;
  }

  // Compare the new categorical fingerprint against the last init's. If the
  // wells/zones/facies sets are unchanged, keep filters + regressions intact
  // and just re-evaluate the perm-dependent control disables.
  const newFp = _categoryFingerprint();
  if (newFp === _plotCategoryFp) {
    _updatePermDependentControls();
    return;
  }
  _plotCategoryFp = newFp;

  // Categories changed — reconcile so user exclusions survive. Brand-new
  // categories (never seen before) get default-included; vanished ones
  // are dropped.
  const wells = uniqueValues(lastPorPoints, 'well');
  const zones = uniqueValues(lastPorPoints, 'zone');
  const facies = uniqueValues(lastPorPoints, 'facies');
  _reconcilePlotFilter(plotState.filters.wells,  _plotPrevDetected.wells,  wells);
  _reconcilePlotFilter(plotState.filters.zones,  _plotPrevDetected.zones,  zones);
  _reconcilePlotFilter(plotState.filters.facies, _plotPrevDetected.facies, facies);
  _plotPrevDetected = { wells, zones, facies };
  buildFilterChips('filter-wells', wells, plotState.filters.wells);
  buildFilterChips('filter-zones', zones, plotState.filters.zones);
  buildFilterChips('filter-facies', facies, plotState.filters.facies, f => {
    const lab = lastLabels && lastLabels.get(f);
    return lab ? (lab + ' (' + f + ')') : ('F' + f);
  });
  // Don't wipe regState here — regressions are owned by Projects.applyToUI
  // and persist across data edits within a project. A regression with stale
  // filters (e.g., referencing a renamed zone) just becomes a no-op until
  // the user prunes it, which is preferable to silently losing fits.
  rebuildRegList();
  _updatePermDependentControls();
}

function _updatePlotToggleUI() {
  const btn = document.getElementById('plot-toggle-btn');
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(plotState.visible));
  const lbl = btn.querySelector('.collapse-label');
  if (lbl) lbl.textContent = plotState.visible ? 'Hide plot' : 'Show plot';
}

function hidePlotPanel() {
  document.getElementById('plot-section').style.display = 'none';
  plotState.visible = false;
  _updatePlotToggleUI();
  Projects.saveDebounced();
}

function showPlotPanel() {
  document.getElementById('plot-section').style.display = '';
  plotState.visible = true;
  _updatePlotToggleUI();
  // First-open fix: previously the canvas stayed blank until the user wiggled
  // a control because showPlotPanel didn't kick off a render itself.
  refreshPlotPanel();
  Projects.saveDebounced();
}

// Sync plot section DOM visibility to plotState.visible (the user's
// preference) when data is available. Called by autoRefresh after init so
// reload/visit-with-persisted-state actually restores the section.
function syncPlotPanelDisplay() {
  const section = document.getElementById('plot-section');
  if (!section) return;
  const dataAvailable = lastPorPoints.length > 0;
  if (plotState.visible && dataAvailable) {
    section.style.display = '';
  } else {
    section.style.display = 'none';
  }
  _updatePlotToggleUI();
}

function filteredPoints() {
  return lastPorPoints.filter(p => {
    if (!plotState.filters.wells.has(p.well)) return false;
    if (!plotState.filters.zones.has(p.zone)) return false;
    if (p.facies != null && !plotState.filters.facies.has(p.facies)) return false;
    return true;
  });
}

// rAF-coalesced refresh: rapid filter toggles produce one render per frame
// instead of N synchronous SVG rebuilds. Cuts DOM churn (and the GC pressure
// that looks like a memory leak in DevTools) when the user clicks chips fast.
let _refreshHandle = null;
function refreshPlotPanel() {
  if (_refreshHandle != null) return;
  _refreshHandle = (typeof requestAnimationFrame !== 'undefined')
    ? requestAnimationFrame(_runRefresh)
    : setTimeout(_runRefresh, 16);
}
function _runRefresh() {
  _refreshHandle = null;
  _refreshPlotPanelImpl();
}

function _refreshPlotPanelImpl() {
  if (!plotState.visible) return;
  const sec = document.getElementById('plot-section');
  if (sec.style.display === 'none') return;
  // Set type from current radio
  if (document.getElementById('pt-cross').checked) plotState.type = 'cross';
  else plotState.type = 'hist';
  // Show/hide options blocks
  document.getElementById('plot-options-hist').style.display = plotState.type === 'hist' ? '' : 'none';
  document.getElementById('plot-options-cross').style.display = plotState.type === 'cross' ? '' : 'none';
  // The active-regression detail strip lives below the plot canvas. It only
  // belongs to cross-plot mode, so toggle visibility on type change.
  const regBox = document.getElementById('reg-active-detail');
  if (regBox) {
    const showDetail = plotState.type === 'cross'
      && regState.activeId !== null
      && regState.list.some(r => r.id === regState.activeId);
    regBox.style.display = showDetail ? '' : 'none';
  }

  const pts = filteredPoints();
  const meta = document.getElementById('plot-meta');
  meta.textContent = pts.length + ' samples after filters';

  const canvas = document.getElementById('plot-canvas');
  const legend = document.getElementById('plot-legend');
  canvas.innerHTML = ''; legend.innerHTML = '';

  if (pts.length === 0) {
    canvas.textContent = 'No samples match current filters.';
    return;
  }
  if (plotState.type === 'hist') renderHistogram(pts);
  else renderCrossPlot(pts);
}

function colorFor(category, idx) { return PLOT_COLORS[idx % PLOT_COLORS.length]; }

function niceLinearTicks(min, max, target) {
  const range = max - min;
  if (range <= 0) return [min];
  const rough = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map(m => m * mag);
  let step = candidates[0];
  for (const c of candidates) if (Math.abs(range / c - target) < Math.abs(range / step - target)) step = c;
  const out = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function logTicks(min, max) {
  const out = [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  for (let p = lo; p <= hi; p++) out.push(Math.pow(10, p));
  return out;
}

function fmtTick(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 1) return (Math.round(v * 1000) / 1000).toString();
  if (a >= 0.001) return v.toFixed(3);
  return v.toExponential(0);
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10]) {
    if (m * mag >= v) return m * mag;
  }
  return 10 * mag;
}

function renderHistogram(points) {
  const variable = document.getElementById('hist-var').value;
  const split = document.getElementById('hist-split').value;
  const layout = document.getElementById('hist-layout').value;
  const nBins = Math.max(5, Math.min(100, parseInt(document.getElementById('hist-bins').value) || 25));
  const useLog = variable === 'perm';

  const valid = points.filter(p => {
    const v = p[variable];
    if (v == null || !isFinite(v)) return false;
    if (useLog && v <= 0) return false;
    return true;
  });
  if (valid.length === 0) {
    document.getElementById('plot-canvas').textContent = 'No valid ' + variable + ' samples in selection.';
    return;
  }

  const values = valid.map(p => p[variable]);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (useLog) {
    lo = Math.max(lo, 1e-4);
    const logLo = Math.log10(lo), logHi = Math.log10(hi);
    const pad = (logHi - logLo) * 0.02 || 0.1;
    lo = Math.pow(10, logLo - pad); hi = Math.pow(10, logHi + pad);
  } else {
    lo = Math.min(0, lo);
    hi = hi * 1.05;
  }

  // Series
  let series;
  if (!split) {
    series = [{ key: '__all__', label: 'All samples', vals: values, color: '#8b3a1e' }];
  } else {
    const groups = new Map();
    for (const p of valid) {
      const key = p[split];
      if (key == null) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p[variable]);
    }
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      const na = Number(a), nb = Number(b);
      if (isFinite(na) && isFinite(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });
    series = sortedKeys.map((k, i) => {
      let label = String(k);
      if (split === 'facies' && lastLabels && lastLabels.get(k)) label = lastLabels.get(k) + ' (F' + k + ')';
      return { key: k, label, vals: groups.get(k), color: colorFor(k, i) };
    });
  }

  // Bin edges
  const edges = [];
  if (useLog) {
    const logLo = Math.log10(lo), logHi = Math.log10(hi);
    for (let i = 0; i <= nBins; i++) edges.push(Math.pow(10, logLo + (logHi - logLo) * i / nBins));
  } else {
    for (let i = 0; i <= nBins; i++) edges.push(lo + (hi - lo) * i / nBins);
  }
  // Bin counts and per-series percent (each series normalized to 100%)
  for (const s of series) {
    s.counts = new Array(nBins).fill(0);
    for (const v of s.vals) {
      let bin;
      if (useLog) {
        const lv = Math.log10(v);
        const logLo = Math.log10(lo), logHi = Math.log10(hi);
        bin = Math.floor((lv - logLo) / (logHi - logLo) * nBins);
      } else {
        bin = Math.floor((v - lo) / (hi - lo) * nBins);
      }
      if (bin < 0) bin = 0;
      if (bin >= nBins) bin = nBins - 1;
      s.counts[bin]++;
    }
    const total = s.vals.length || 1;
    s.percents = s.counts.map(c => c / total * 100);
  }

  // Y axis max depends on layout: stacked sums per bin, side-by-side is max single bar
  const isStacked = split && layout === 'stacked';
  let maxPct;
  if (isStacked) {
    let stackedMax = 0;
    for (let i = 0; i < nBins; i++) {
      let sum = 0;
      for (const s of series) sum += s.percents[i];
      if (sum > stackedMax) stackedMax = sum;
    }
    maxPct = stackedMax;
  } else {
    maxPct = Math.max(...series.flatMap(s => s.percents), 1);
  }
  // Round up to a nice number for axis
  const niceMax = niceCeil(maxPct);

  // Layout
  const W = 700, H = 380;
  const M = { top: 14, right: 14, bottom: 46, left: 56 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;

  const canvas = document.getElementById('plot-canvas');
  canvas.innerHTML = '';
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' }, canvas);

  const xScale = (v) => {
    if (useLog) {
      return M.left + (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * iw;
    }
    return M.left + (v - lo) / (hi - lo) * iw;
  };
  const yScale = (v) => M.top + ih - (v / niceMax) * ih;

  // Y gridlines
  const yTicks = niceLinearTicks(0, niceMax, 6);
  for (const t of yTicks) {
    const y = yScale(t);
    svgEl('line', { x1: M.left, x2: M.left + iw, y1: y, y2: y, stroke: '#e8dec8', 'stroke-width': 1 }, svg);
    const lbl = svgEl('text', { x: M.left - 6, y: y + 3.5, 'text-anchor': 'end', 'font-size': '10', 'font-family': 'IBM Plex Mono, monospace', fill: '#7c7461' }, svg);
    lbl.textContent = (Math.round(t * 100) / 100) + '%';
  }
  // X axis ticks
  const xTicks = useLog ? logTicks(lo, hi) : niceLinearTicks(lo, hi, 6);
  for (const t of xTicks) {
    if (t < lo || t > hi) continue;
    const x = xScale(t);
    svgEl('line', { x1: x, x2: x, y1: M.top + ih, y2: M.top + ih + 3, stroke: '#7c7461', 'stroke-width': 1 }, svg);
    const lbl = svgEl('text', { x: x, y: M.top + ih + 14, 'text-anchor': 'middle', 'font-size': '10', 'font-family': 'IBM Plex Mono, monospace', fill: '#7c7461' }, svg);
    lbl.textContent = fmtTick(t);
  }
  // Axis lines
  svgEl('line', { x1: M.left, x2: M.left + iw, y1: M.top + ih, y2: M.top + ih, stroke: '#5a5142', 'stroke-width': 1 }, svg);
  svgEl('line', { x1: M.left, x2: M.left, y1: M.top, y2: M.top + ih, stroke: '#5a5142', 'stroke-width': 1 }, svg);

  // Axis labels
  const xLab = svgEl('text', { x: M.left + iw / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': '11', 'font-family': 'IBM Plex Sans, sans-serif', fill: '#3a3528', 'font-weight': '500' }, svg);
  xLab.textContent = (variable === 'por' ? 'Porosity' : 'Permeability (mD)') + (useLog ? ' (log)' : '');
  const yLabText = split ? '% per series' : '% of samples';
  const yLab = svgEl('text', { x: 14, y: M.top + ih / 2, 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (M.top + ih / 2) + ')', 'font-size': '11', 'font-family': 'IBM Plex Sans, sans-serif', fill: '#3a3528', 'font-weight': '500' }, svg);
  yLab.textContent = yLabText;

  // Bars
  const barAlpha = series.length === 1 ? 0.6 : (isStacked ? 0.78 : 0.55);
  if (isStacked) {
    // Cumulative offset per bin so series stack on top of each other
    const cumPct = new Array(nBins).fill(0);
    for (let s = 0; s < series.length; s++) {
      const ser = series[s];
      for (let i = 0; i < nBins; i++) {
        const p = ser.percents[i];
        if (p === 0) continue;
        const x0 = xScale(edges[i]);
        const x1 = xScale(edges[i + 1]);
        const yTop = yScale(cumPct[i] + p);
        const yBot = yScale(cumPct[i]);
        const w = Math.max(1, x1 - x0 - 0.5);
        svgEl('rect', {
          x: x0 + 0.25, y: yTop, width: w, height: yBot - yTop,
          fill: ser.color, 'fill-opacity': barAlpha,
          stroke: ser.color, 'stroke-opacity': 0.95, 'stroke-width': 0.6,
        }, svg);
        cumPct[i] += p;
      }
    }
  } else if (split) {
    // Side-by-side: divide each bin's pixel width among the series
    const N = series.length;
    for (let i = 0; i < nBins; i++) {
      const x0 = xScale(edges[i]);
      const x1 = xScale(edges[i + 1]);
      const binW = x1 - x0;
      const subW = Math.max(0.6, binW / N - 0.4);
      for (let s = 0; s < N; s++) {
        const p = series[s].percents[i];
        if (p === 0) continue;
        const sx = x0 + s * (binW / N) + 0.2;
        const y = yScale(p);
        svgEl('rect', {
          x: sx, y: y, width: subW, height: M.top + ih - y,
          fill: series[s].color, 'fill-opacity': barAlpha,
          stroke: series[s].color, 'stroke-opacity': 0.95, 'stroke-width': 0.6,
        }, svg);
      }
    }
  } else {
    // Single series, full bin width
    const ser = series[0];
    for (let i = 0; i < nBins; i++) {
      const p = ser.percents[i];
      if (p === 0) continue;
      const x0 = xScale(edges[i]);
      const x1 = xScale(edges[i + 1]);
      const y = yScale(p);
      const w = Math.max(1, x1 - x0 - 0.5);
      svgEl('rect', {
        x: x0 + 0.25, y: y, width: w, height: M.top + ih - y,
        fill: ser.color, 'fill-opacity': barAlpha,
        stroke: ser.color, 'stroke-opacity': 0.95, 'stroke-width': 0.6,
      }, svg);
    }
  }

  // Legend
  if (split) {
    const legend = document.getElementById('plot-legend');
    for (const ser of series) {
      const item = document.createElement('span');
      item.className = 'plot-legend-item';
      const sw = document.createElement('span');
      sw.className = 'plot-legend-swatch';
      sw.style.background = ser.color;
      const txt = document.createElement('span');
      txt.textContent = ser.label + ' (n=' + ser.vals.length + ')';
      item.appendChild(sw); item.appendChild(txt);
      legend.appendChild(item);
    }
  }
}

// ============================================================
// Color / shape picker popovers (legend customization)
// ============================================================
const CUSTOM_PRESET_COLORS = [
  '#fb877a', '#ffa571', '#f7cb66', '#feea66', '#dbe666', '#aed879', '#7ce2b0',
  '#66d9e5', '#66c3eb', '#66aae1', '#a49cdd', '#bca1e1', '#dd7bd0', '#ee6690',
];

let _activePicker = null;
function _dismissPicker() {
  if (!_activePicker) return;
  _activePicker.remove();
  document.removeEventListener('mousedown', _onPickerOutside, true);
  document.removeEventListener('keydown', _onPickerKey, true);
  _activePicker = null;
}
function _onPickerOutside(e) {
  if (_activePicker && !_activePicker.contains(e.target)) _dismissPicker();
}
function _onPickerKey(e) {
  if (e.key === 'Escape') _dismissPicker();
}
function _positionAndShowPicker(pop, anchor) {
  pop.style.position = 'fixed';
  pop.style.visibility = 'hidden';
  pop.style.zIndex = '9999';
  document.body.appendChild(pop);
  const a = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let top = a.bottom + 4;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, a.top - ph - 4);
  let left = a.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (left < 8) left = 8;
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
  pop.style.visibility = '';
  _activePicker = pop;
  // Defer outside-click listener so the opening click doesn't dismiss us
  setTimeout(() => {
    document.addEventListener('mousedown', _onPickerOutside, true);
    document.addEventListener('keydown', _onPickerKey, true);
  }, 0);
}

function showColorPicker(anchor, currentColor, onPick, onReset) {
  _dismissPicker();
  const pop = document.createElement('div');
  pop.className = 'style-picker style-picker-color';
  const grid = document.createElement('div');
  grid.className = 'style-picker-grid style-picker-grid-color';
  for (const hex of CUSTOM_PRESET_COLORS) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'style-picker-color-cell';
    cell.style.background = hex;
    cell.title = hex;
    if (currentColor && String(currentColor).toLowerCase() === hex.toLowerCase()) cell.classList.add('active');
    cell.addEventListener('click', () => { onPick(hex); _dismissPicker(); });
    grid.appendChild(cell);
  }
  pop.appendChild(grid);
  if (onReset) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'style-picker-reset';
    reset.textContent = 'Reset to default';
    reset.addEventListener('click', () => { onReset(); _dismissPicker(); });
    pop.appendChild(reset);
  }
  _positionAndShowPicker(pop, anchor);
}

function showShapePicker(anchor, currentShape, onPick, onReset) {
  _dismissPicker();
  const pop = document.createElement('div');
  pop.className = 'style-picker style-picker-shape';
  const grid = document.createElement('div');
  grid.className = 'style-picker-grid style-picker-grid-shape';
  for (let i = 0; i < 6; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'style-picker-shape-cell';
    if (currentShape === i) cell.classList.add('active');
    const mini = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mini.setAttribute('viewBox', '-7 -7 14 14');
    mini.setAttribute('width', '18'); mini.setAttribute('height', '18');
    mini.appendChild(makeShape(i, 0, 0, '#3a3528', 0.85));
    cell.appendChild(mini);
    cell.addEventListener('click', () => { onPick(i); _dismissPicker(); });
    grid.appendChild(cell);
  }
  pop.appendChild(grid);
  if (onReset) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'style-picker-reset';
    reset.textContent = 'Reset to default';
    reset.addEventListener('click', () => { onReset(); _dismissPicker(); });
    pop.appendChild(reset);
  }
  _positionAndShowPicker(pop, anchor);
}

// Maps a "color by"/"shape by" select value to the matching plotState.filters key.
function filterDimFor(by) {
  if (by === 'well') return 'wells';
  if (by === 'zone') return 'zones';
  if (by === 'facies') return 'facies';
  return null;
}

function renderCrossPlot(points) {
  const colorBy = document.getElementById('cross-color').value;
  const shapeBy = document.getElementById('cross-shape').value;

  const valid = points.filter(p => p.por != null && isFinite(p.por) && p.perm != null && isFinite(p.perm) && p.perm > 0);
  if (valid.length === 0) {
    document.getElementById('plot-canvas').textContent = 'No samples have both porosity and permeability.';
    return;
  }
  const xs = valid.map(p => p.por);
  const ys = valid.map(p => p.perm);
  let xLo = Math.min(0, Math.min(...xs)), xHi = Math.max(...xs) * 1.05;
  let yLo = Math.min(...ys), yHi = Math.max(...ys);
  yLo = Math.pow(10, Math.log10(yLo) - 0.15);
  yHi = Math.pow(10, Math.log10(yHi) + 0.15);

  // Categorical color/shape mappings.
  //
  // Compute keys from the *unfiltered* well/zone/facies universe (lastPorPoints)
  // so the legend can show every category that exists in the data — including
  // ones currently filtered out. That keeps the title-toggle behavior
  // bidirectional: clicking a hidden entry in the legend can re-show it.
  // Custom colors/shapes from state.customStyles override the rotation defaults.
  const colorDim = filterDimFor(colorBy);
  const shapeDim = filterDimFor(shapeBy);
  const allValid = lastPorPoints.filter(p => p.por != null && isFinite(p.por) && p.perm != null && isFinite(p.perm) && p.perm > 0);
  const colorKeys = uniqueValues(allValid, colorBy);
  const colorMap = new Map(colorKeys.map((k, i) => {
    const custom = colorDim ? customColorFor(colorDim, k) : null;
    return [k, custom || PLOT_COLORS[i % PLOT_COLORS.length]];
  }));
  let shapeKeys = [];
  let shapeMap = new Map();
  if (shapeBy) {
    shapeKeys = uniqueValues(allValid, shapeBy);
    shapeMap = new Map(shapeKeys.map((k, i) => {
      const custom = shapeDim ? customShapeFor(shapeDim, k) : null;
      return [k, custom != null ? custom : (i % 6)];
    }));
  }

  // Layout
  const W = 700, H = 460;
  const M = { top: 14, right: 14, bottom: 46, left: 60 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;

  const canvas = document.getElementById('plot-canvas');
  canvas.innerHTML = '';
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' }, canvas);

  const xScale = (v) => M.left + (v - xLo) / (xHi - xLo) * iw;
  const yScale = (v) => M.top + ih - (Math.log10(v) - Math.log10(yLo)) / (Math.log10(yHi) - Math.log10(yLo)) * ih;

  // Y log gridlines (decades) + minor lines
  const yTicks = logTicks(yLo, yHi);
  for (const t of yTicks) {
    if (t < yLo || t > yHi) continue;
    const y = yScale(t);
    svgEl('line', { x1: M.left, x2: M.left + iw, y1: y, y2: y, stroke: '#e8dec8', 'stroke-width': 1 }, svg);
    const lbl = svgEl('text', { x: M.left - 6, y: y + 3.5, 'text-anchor': 'end', 'font-size': '10', 'font-family': 'IBM Plex Mono, monospace', fill: '#7c7461' }, svg);
    lbl.textContent = fmtTick(t);
  }
  // Minor log gridlines (2,3,...,9)
  for (const t of yTicks) {
    for (let m = 2; m < 10; m++) {
      const v = t * m;
      if (v < yLo || v > yHi) continue;
      const y = yScale(v);
      svgEl('line', { x1: M.left, x2: M.left + iw, y1: y, y2: y, stroke: '#f1eadb', 'stroke-width': 0.5 }, svg);
    }
  }
  // X gridlines
  const xTicks = niceLinearTicks(xLo, xHi, 6);
  for (const t of xTicks) {
    if (t < xLo || t > xHi) continue;
    const x = xScale(t);
    svgEl('line', { x1: x, x2: x, y1: M.top, y2: M.top + ih, stroke: '#e8dec8', 'stroke-width': 1 }, svg);
    const lbl = svgEl('text', { x: x, y: M.top + ih + 14, 'text-anchor': 'middle', 'font-size': '10', 'font-family': 'IBM Plex Mono, monospace', fill: '#7c7461' }, svg);
    lbl.textContent = fmtTick(t);
  }
  // Axes
  svgEl('line', { x1: M.left, x2: M.left + iw, y1: M.top + ih, y2: M.top + ih, stroke: '#5a5142', 'stroke-width': 1 }, svg);
  svgEl('line', { x1: M.left, x2: M.left, y1: M.top, y2: M.top + ih, stroke: '#5a5142', 'stroke-width': 1 }, svg);

  const xLab = svgEl('text', { x: M.left + iw / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': '11', 'font-family': 'IBM Plex Sans, sans-serif', fill: '#3a3528', 'font-weight': '500' }, svg);
  xLab.textContent = 'Porosity';
  const yLab = svgEl('text', { x: 16, y: M.top + ih / 2, 'text-anchor': 'middle', transform: 'rotate(-90 16 ' + (M.top + ih / 2) + ')', 'font-size': '11', 'font-family': 'IBM Plex Sans, sans-serif', fill: '#3a3528', 'font-weight': '500' }, svg);
  yLab.textContent = 'Permeability (mD, log)';

  // Points
  for (const p of valid) {
    const x = xScale(p.por), y = yScale(p.perm);
    const color = colorMap.get(p[colorBy]) || '#999';
    const shapeIdx = shapeBy ? (shapeMap.get(p[shapeBy]) || 0) : 0;
    svg.appendChild(makeShape(shapeIdx, x, y, color, 0.55));
  }

  // Regression curves -- one polyline per visible regression, sampled across the plot's X range.
  // Curves are drawn over the full visible porosity range (not just the data range used for the
  // fit), so out-of-sample extrapolation is honest -- no hidden trim.
  const visibleRegs = regState.list.filter(r => r.visible);
  for (const reg of visibleRegs) {
    const segments = [];   // arrays of [px, py] - split when value falls off the y-axis
    let cur = [];
    const N = 240;
    for (let i = 0; i <= N; i++) {
      const phi = xLo + (xHi - xLo) * (i / N);
      const logK = polyEval(reg.coeffs, phi);
      const k = Math.pow(10, logK);
      // Stop if curve goes outside the plot's Y range
      if (!isFinite(k) || k <= 0 || k < yLo || k > yHi) {
        if (cur.length >= 2) segments.push(cur);
        cur = [];
        continue;
      }
      cur.push([xScale(phi), yScale(k)]);
    }
    if (cur.length >= 2) segments.push(cur);
    for (const seg of segments) {
      const d = 'M ' + seg.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L ');
      svgEl('path', {
        d, fill: 'none', stroke: reg.color, 'stroke-width': 2,
        'stroke-opacity': reg.id === regState.activeId ? 0.95 : 0.75,
      }, svg);
    }
    // Subtle marker showing the data range used for the fit, drawn as ticks at the fit endpoints
    const px1 = xScale(reg.range.phiLo), px2 = xScale(reg.range.phiHi);
    const yMid = polyEval(reg.coeffs, (reg.range.phiLo + reg.range.phiHi) / 2);
    const py = yScale(Math.pow(10, yMid));
    if (isFinite(py) && py >= M.top && py <= M.top + ih) {
      // Tiny end-caps inside the data range -- visual cue for "fit was based on this stretch"
      for (const px of [px1, px2]) {
        if (px >= M.left && px <= M.left + iw) {
          svgEl('line', { x1: px, x2: px, y1: M.top + ih - 4, y2: M.top + ih, stroke: reg.color, 'stroke-width': 1.3 }, svg);
        }
      }
    }
  }

  // Legend: color first, then shape (if used).
  //
  // Interaction model:
  //  - Click swatch / shape icon  → opens a color or shape picker popover.
  //    Custom selections are persisted globally (state.customStyles) so they
  //    follow the same value across projects (like facies labels).
  //  - Click label                 → toggles the underlying filter chip for
  //    that value. Hidden entries stay in the legend (dimmed) so the toggle
  //    can be reversed without leaving the legend.
  const legend = document.getElementById('plot-legend');
  function colorLabel(k) {
    if (colorBy === 'facies' && lastLabels && lastLabels.get(k)) return lastLabels.get(k) + ' (F' + k + ')';
    return String(k);
  }
  function isHidden(dim, key) {
    return dim ? !plotState.filters[dim].has(key) : false;
  }
  function toggleVisibility(dim, key) {
    if (!dim) return;
    const set = plotState.filters[dim];
    if (set.has(key)) set.delete(key); else set.add(key);
    syncFilterChipsToState();
    refreshPlotPanel();
    Projects.saveDebounced();
  }
  for (const k of colorKeys) {
    const item = document.createElement('span');
    item.className = 'plot-legend-item' + (isHidden(colorDim, k) ? ' hidden' : '');
    const sw = document.createElement('span');
    sw.className = 'plot-legend-swatch plot-legend-swatch-clickable';
    sw.style.background = colorMap.get(k);
    sw.title = 'Pick color';
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!colorDim) return;
      showColorPicker(sw, colorMap.get(k),
        (hex) => { setCustomColor(colorDim, k, hex); refreshPlotPanel(); },
        () => { clearCustomColor(colorDim, k); refreshPlotPanel(); }
      );
    });
    const txt = document.createElement('span');
    txt.className = 'plot-legend-label';
    txt.title = 'Toggle visibility';
    txt.textContent = colorLabel(k);
    txt.addEventListener('click', () => toggleVisibility(colorDim, k));
    item.appendChild(sw); item.appendChild(txt);
    legend.appendChild(item);
  }
  if (shapeBy) {
    // small separator
    const sep = document.createElement('span');
    sep.style.cssText = 'color:var(--ink-soft);';
    sep.textContent = '|';
    legend.appendChild(sep);
    function shapeLabel(k) {
      if (shapeBy === 'facies' && lastLabels && lastLabels.get(k)) return lastLabels.get(k) + ' (F' + k + ')';
      return String(k);
    }
    for (const k of shapeKeys) {
      const item = document.createElement('span');
      item.className = 'plot-legend-item plot-legend-shape' + (isHidden(shapeDim, k) ? ' hidden' : '');
      const wrap = document.createElement('span');
      wrap.className = 'plot-legend-shape-icon';
      wrap.title = 'Pick shape';
      const mini = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      mini.setAttribute('viewBox', '-7 -7 14 14');
      mini.setAttribute('width', '14'); mini.setAttribute('height', '14');
      mini.appendChild(makeShape(shapeMap.get(k) || 0, 0, 0, '#3a3528', 0.85));
      wrap.appendChild(mini);
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!shapeDim) return;
        showShapePicker(wrap, shapeMap.get(k),
          (idx) => { setCustomShape(shapeDim, k, idx); refreshPlotPanel(); },
          () => { clearCustomShape(shapeDim, k); refreshPlotPanel(); }
        );
      });
      const txt = document.createElement('span');
      txt.className = 'plot-legend-label';
      txt.title = 'Toggle visibility';
      txt.textContent = shapeLabel(k);
      txt.addEventListener('click', () => toggleVisibility(shapeDim, k));
      item.appendChild(wrap); item.appendChild(txt);
      legend.appendChild(item);
    }
  }

  // Regression legend entries: name on top, equation below (monospaced).
  // Show every regression (hidden ones dimmed) so the title-toggle stays
  // bidirectional. Clicking the line stripe opens the color picker; clicking
  // the title toggles plot visibility. Activation lives on the sidebar pills.
  if (regState.list.length > 0) {
    if (colorKeys.length > 0 || shapeBy) {
      const sep = document.createElement('div');
      sep.style.cssText = 'flex-basis:100%;height:0;';
      legend.appendChild(sep);
    }
    for (const reg of regState.list) {
      const item = document.createElement('div');
      item.className = 'plot-legend-reg' + (reg.visible ? '' : ' hidden');

      const head = document.createElement('div');
      head.className = 'plot-legend-reg-head';
      const sw = document.createElement('span');
      sw.className = 'plot-legend-reg-swatch';
      sw.style.background = reg.color;
      sw.title = 'Pick color';
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        showColorPicker(sw, reg.color,
          (hex) => {
            reg.color = hex;
            rebuildRegList();
            refreshPlotPanel();
            Projects.saveDebounced();
          },
          () => {
            // Reset to next available REG_COLORS slot
            const used = new Set(regState.list.filter(r => r.id !== reg.id).map(r => r.color));
            let next = REG_COLORS[0];
            for (const c of REG_COLORS) if (!used.has(c)) { next = c; break; }
            reg.color = next;
            rebuildRegList();
            refreshPlotPanel();
            Projects.saveDebounced();
          }
        );
      });
      head.appendChild(sw);
      const name = document.createElement('span');
      name.className = 'plot-legend-reg-name';
      if (reg.id === regState.activeId) name.classList.add('active');
      name.title = 'Toggle visibility on plot';
      name.textContent = reg.name + '  (n=' + reg.n + ', R²=' + reg.r2.toFixed(3) + ')';
      name.addEventListener('click', () => regToggleVisibility(reg.id));
      head.appendChild(name);
      item.appendChild(head);

      const eq = document.createElement('div');
      eq.className = 'plot-legend-reg-eq';
      eq.title = 'Toggle visibility on plot';
      eq.textContent = petrelFormula(reg.coeffs);
      eq.addEventListener('click', () => regToggleVisibility(reg.id));
      item.appendChild(eq);

      legend.appendChild(item);
    }
  }
}
