"use strict";

// ============================================================
// Saturation-Height Function (SHF) plot panel
// ============================================================
// Becomes available when the porosity log carries all four of:
//   Por.Eff. + Perm + HAFWL + Sw
// Renders Sw on the x-axis vs HAFWL on the y-axis, points colored on a
// rainbow scale by either √(perm/φ) (rock-quality index, default) or φ.
// At most `Max points` samples are drawn — points beyond that are picked at
// random so the plot stays legible on dense logs.
//
// Independent of the cross/histogram panel: it has its own visibility,
// filter chips, and refresh debounce. SE-equation overlay (J/Brooks-Corey)
// is wired as a placeholder for a future session.

const shfState = {
  visible: false,
  filters: { wells: new Set(), zones: new Set(), facies: new Set() },
};

let _shfCategoryFp = null;

function resetShfCategoryCache() {
  _shfCategoryFp = null;
}

function _shfCategoryFingerprint() {
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

function _updateShfToggleUI() {
  const btn = document.getElementById('shf-toggle-btn');
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(shfState.visible));
  const lbl = btn.querySelector('.collapse-label');
  if (lbl) lbl.textContent = shfState.visible ? 'Hide saturation-height' : 'Show saturation-height';
}

function showShfPanel() {
  document.getElementById('shf-section').style.display = '';
  shfState.visible = true;
  _updateShfToggleUI();
  refreshShfPanel();
}

function hideShfPanel() {
  document.getElementById('shf-section').style.display = 'none';
  shfState.visible = false;
  _updateShfToggleUI();
}

function initShfPanel() {
  // Toggle visibility tracks data availability — if any of por/perm/hafwl/sw
  // is missing the SHF panel makes no sense.
  const toggleBtn = document.getElementById('shf-toggle-btn');
  if (toggleBtn) toggleBtn.style.display = lastHasShf ? '' : 'none';
  if (!lastHasShf) {
    document.getElementById('shf-section').style.display = 'none';
    shfState.visible = false;
    _updateShfToggleUI();
    _shfCategoryFp = '';
    return;
  }

  // Smart skip: same categorical structure → leave the user's filter
  // selections alone. Mirrors the pattern in initPlotPanel.
  const newFp = _shfCategoryFingerprint();
  if (newFp === _shfCategoryFp) return;
  _shfCategoryFp = newFp;

  const wells  = uniqueValues(lastPorPoints, 'well');
  const zones  = uniqueValues(lastPorPoints, 'zone');
  const facies = uniqueValues(lastPorPoints, 'facies');
  shfState.filters.wells.clear();  for (const v of wells)  shfState.filters.wells.add(v);
  shfState.filters.zones.clear();  for (const v of zones)  shfState.filters.zones.add(v);
  shfState.filters.facies.clear(); for (const v of facies) shfState.filters.facies.add(v);
  _buildShfFilterChips('shf-filter-wells', wells, shfState.filters.wells);
  _buildShfFilterChips('shf-filter-zones', zones, shfState.filters.zones);
  _buildShfFilterChips('shf-filter-facies', facies, shfState.filters.facies, f => {
    const lab = lastLabels && lastLabels.get(f);
    return lab ? (lab + ' (' + f + ')') : ('F' + f);
  });
}

function _buildShfFilterChips(containerId, items, set, labelFn) {
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
      refreshShfPanel();
    });
    c.appendChild(chip);
  }
}

// All four fields required for an SHF point.
function shfFilteredPoints() {
  return lastPorPoints.filter(p => {
    if (!shfState.filters.wells.has(p.well)) return false;
    if (!shfState.filters.zones.has(p.zone)) return false;
    if (p.facies != null && !shfState.filters.facies.has(p.facies)) return false;
    return p.por != null && isFinite(p.por) && p.por > 0
        && p.perm != null && isFinite(p.perm) && p.perm > 0
        && p.hafwl != null && isFinite(p.hafwl)
        && p.sw != null && isFinite(p.sw);
  });
}

// Reservoir-style random sample: shuffle the first n via partial Fisher-Yates,
// take prefix. Stable enough for one render but reshuffles on each refresh.
function _randomSample(arr, n) {
  if (arr.length <= n) return arr.slice();
  const a = arr.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a.slice(0, n);
}

// Rainbow ramp: t ∈ [0,1] mapped to HSL hue from blue (240°) → red (0°).
function _rainbowColor(t) {
  if (!isFinite(t)) t = 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const hue = 240 * (1 - t);
  return 'hsl(' + hue.toFixed(1) + ', 75%, 50%)';
}

let _shfRefreshHandle = null;
function refreshShfPanel() {
  if (_shfRefreshHandle != null) return;
  _shfRefreshHandle = (typeof requestAnimationFrame !== 'undefined')
    ? requestAnimationFrame(_runShfRefresh)
    : setTimeout(_runShfRefresh, 16);
}
function _runShfRefresh() {
  _shfRefreshHandle = null;
  _refreshShfPanelImpl();
}

function _refreshShfPanelImpl() {
  if (!shfState.visible) return;
  const sec = document.getElementById('shf-section');
  if (sec.style.display === 'none') return;

  const pts = shfFilteredPoints();
  const maxInput = document.getElementById('shf-max');
  const maxPts = Math.max(10, parseInt(maxInput.value) || 100);
  const sampled = _randomSample(pts, maxPts);

  const meta = document.getElementById('shf-meta');
  meta.textContent = sampled.length + ' / ' + pts.length + ' samples'
    + (pts.length > maxPts ? ' (random subset)' : '');

  const canvas = document.getElementById('shf-canvas');
  const legend = document.getElementById('shf-legend');
  canvas.innerHTML = '';
  legend.innerHTML = '';

  if (sampled.length === 0) {
    canvas.textContent = pts.length === 0
      ? 'No samples have all of por, perm, HAFWL, and Sw.'
      : 'No samples match current filters.';
    return;
  }
  _renderShfPlot(sampled);
}

function _colorMetric(p, mode) {
  if (mode === 'por') return p.por;
  // RQI: √(perm/φ) — common rock quality proxy.
  return Math.sqrt(p.perm / p.por);
}

function _colorMetricLabel(mode) {
  return mode === 'por' ? 'Porosity (φ)' : '√(perm/por)';
}

function _renderShfPlot(points) {
  const colorBy = document.getElementById('shf-color').value;
  const cvals = points.map(p => _colorMetric(p, colorBy));
  const cMin = Math.min.apply(null, cvals);
  const cMax = Math.max.apply(null, cvals);
  const cRange = (cMax - cMin) || 1;

  // X = Sw (clipped to [0, max(1, observed)]); Y = HAFWL (linear, low at bottom).
  const xs = points.map(p => p.sw);
  const ys = points.map(p => p.hafwl);
  let xLo = 0;
  let xHi = Math.max(1, Math.max.apply(null, xs));
  let yLo = Math.min(0, Math.min.apply(null, ys));
  let yHi = Math.max.apply(null, ys);
  if (yHi <= yLo) yHi = yLo + 1;
  // Headroom on top so points don't kiss the axis.
  yHi = yHi + (yHi - yLo) * 0.05;

  const W = 700, H = 460;
  const M = { top: 14, right: 14, bottom: 46, left: 60 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const canvas = document.getElementById('shf-canvas');
  canvas.innerHTML = '';
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' }, canvas);

  const xScale = v => M.left + (v - xLo) / (xHi - xLo) * iw;
  const yScale = v => M.top + ih - (v - yLo) / (yHi - yLo) * ih;

  // Y gridlines + labels
  const yTicks = niceLinearTicks(yLo, yHi, 6);
  for (const t of yTicks) {
    if (t < yLo || t > yHi) continue;
    const y = yScale(t);
    svgEl('line', { x1: M.left, x2: M.left + iw, y1: y, y2: y, stroke: '#e8dec8', 'stroke-width': 1 }, svg);
    const lbl = svgEl('text', { x: M.left - 6, y: y + 3.5, 'text-anchor': 'end', 'font-size': '10', 'font-family': 'IBM Plex Mono, monospace', fill: '#7c7461' }, svg);
    lbl.textContent = fmtTick(t);
  }
  // X gridlines + labels
  const xTicks = niceLinearTicks(xLo, xHi, 5);
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
  // Axis labels
  const xLab = svgEl('text', { x: M.left + iw / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': '11', 'font-family': 'IBM Plex Sans, sans-serif', fill: '#3a3528', 'font-weight': '500' }, svg);
  xLab.textContent = 'Water saturation (Sw)';
  const yLab = svgEl('text', { x: 16, y: M.top + ih / 2, 'text-anchor': 'middle', transform: 'rotate(-90 16 ' + (M.top + ih / 2) + ')', 'font-size': '11', 'font-family': 'IBM Plex Sans, sans-serif', fill: '#3a3528', 'font-weight': '500' }, svg);
  yLab.textContent = 'HAFWL';

  // Points
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = xScale(p.sw);
    const y = yScale(p.hafwl);
    const t = (cvals[i] - cMin) / cRange;
    const color = _rainbowColor(t);
    svgEl('circle', {
      cx: x, cy: y, r: 3.4,
      fill: color, 'fill-opacity': 0.78,
      stroke: color, 'stroke-opacity': 0.95, 'stroke-width': 0.6,
    }, svg);
  }

  // J-function overlay (see js/jfn.js). When an equation is active, draws
  // 10 Sw vs HAFWL curves at log-spaced sqrt(k/φ) values from the data
  // range. Curves render on top of points so the model is visible against
  // the data cloud.
  if (typeof jfnRenderCurves === 'function') {
    jfnRenderCurves({ svg, xScale, yScale, xLo, xHi, yLo, yHi, points });
  }

  _renderShfColorBar(_colorMetricLabel(colorBy), cMin, cMax);
}

function _renderShfColorBar(label, vMin, vMax) {
  const legend = document.getElementById('shf-legend');
  const wrap = document.createElement('div');
  wrap.className = 'shf-legend-wrap';

  const titleEl = document.createElement('span');
  titleEl.className = 'shf-legend-title';
  titleEl.textContent = label;
  wrap.appendChild(titleEl);

  const minEl = document.createElement('span');
  minEl.className = 'shf-legend-num';
  minEl.textContent = fmtTick(vMin);
  wrap.appendChild(minEl);

  const swatches = document.createElement('span');
  swatches.className = 'shf-legend-bar';
  const N = 32;
  for (let i = 0; i < N; i++) {
    const s = document.createElement('span');
    s.style.background = _rainbowColor(i / (N - 1));
    swatches.appendChild(s);
  }
  wrap.appendChild(swatches);

  const maxEl = document.createElement('span');
  maxEl.className = 'shf-legend-num';
  maxEl.textContent = fmtTick(vMax);
  wrap.appendChild(maxEl);

  legend.appendChild(wrap);
}
