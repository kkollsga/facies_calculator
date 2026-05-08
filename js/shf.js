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
  // Brooks-Corey overlay: { swirr, he, lambda, r2, n }. null = no curve drawn.
  fit: null,
};

let _shfCategoryFp = null;
// Tracks the last set of categories detected per axis. Used to distinguish
// "brand-new category (default include)" from "previously-known category
// the user explicitly excluded". Cleared on project switch.
let _shfPrevDetected = { wells: [], zones: [], facies: [] };

function resetShfCategoryCache() {
  _shfCategoryFp = null;
  _shfPrevDetected = { wells: [], zones: [], facies: [] };
}

// Reconcile a filter Set against an old vs new detected category list. New
// categories get added (default include). Vanished categories get dropped.
// Categories present in both old and new are left alone — preserving the
// user's include/exclude state.
function _reconcileShfFilter(set, prevDetected, newDetected) {
  const newDet = new Set(newDetected);
  const prevDet = new Set(prevDetected);
  for (const v of [...set]) if (!newDet.has(v)) set.delete(v);
  for (const v of newDetected) if (!prevDet.has(v)) set.add(v);
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
  Projects.saveDebounced();
}

function hideShfPanel() {
  document.getElementById('shf-section').style.display = 'none';
  shfState.visible = false;
  _updateShfToggleUI();
  Projects.saveDebounced();
}

// Sync DOM section display to user intent (shfState.visible) AND data
// availability (lastHasShf). Called after init so persisted "visible=true"
// actually restores the section on reload.
function syncShfPanelDisplay() {
  const section = document.getElementById('shf-section');
  if (!section) return;
  if (shfState.visible && lastHasShf) {
    section.style.display = '';
  } else {
    section.style.display = 'none';
  }
  _updateShfToggleUI();
}

function initShfPanel() {
  // Toggle visibility tracks data availability — if any of por/perm/hafwl/sw
  // is missing the SHF panel makes no sense.
  const toggleBtn = document.getElementById('shf-toggle-btn');
  if (toggleBtn) toggleBtn.style.display = lastHasShf ? '' : 'none';
  if (!lastHasShf) {
    document.getElementById('shf-section').style.display = 'none';
    // Don't touch shfState.visible — that's user intent, not derived state.
    _updateShfToggleUI();
    // Don't touch _shfCategoryFp here. SHF availability flickers as the user
    // edits the porosity log (perm column briefly missing, FWL cleared, etc.)
    // and we want filter selections to survive those flickers — not reset.
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
  // Reconcile against the previous detection so user exclusions persist.
  // First time around, _shfPrevDetected is empty → every detected category
  // counts as "brand new" and gets default-included.
  _reconcileShfFilter(shfState.filters.wells,  _shfPrevDetected.wells,  wells);
  _reconcileShfFilter(shfState.filters.zones,  _shfPrevDetected.zones,  zones);
  _reconcileShfFilter(shfState.filters.facies, _shfPrevDetected.facies, facies);
  _shfPrevDetected = { wells, zones, facies };
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
      Projects.saveDebounced();
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
    // HAFWL < 0 means "below the free water level" — those points sit in the
    // water leg, not the SHF transition zone, so they're noise for this plot.
    // Sw == 1 (and Sw > 1 from rounding/error) is also water-leg.
    return p.por != null && isFinite(p.por) && p.por > 0
        && p.perm != null && isFinite(p.perm) && p.perm > 0
        && p.hafwl != null && isFinite(p.hafwl) && p.hafwl >= 0
        && p.sw != null && isFinite(p.sw) && p.sw < 1;
  });
}

// Stratified-by-cell sample over the (Sw, HAFWL, √(k/φ)) space so the plot
// shows the *full solution space*, not just the densest blob.
//
// Strategy:
//   1. Bucket points into a 3D grid. Total cells ≈ n/2. The vertical (RQI)
//      axis is capped at 3 strata so the Sw/HAFWL cells stay narrow enough
//      to resolve features there — XY is sized as sqrt(n / (6)) (so
//      bx · by · 3 ≈ n/2).
//   2. Phase 1 — pick one random point from each occupied cell. Cell order is
//      shuffled so when occupied cells > n we drop random cells (not the
//      ones at the corner of axis-min).
//   3. Phase 2 — fill the remaining budget by uniform random sample over the
//      points NOT yet picked. Uniform sampling from the leftover pool is
//      naturally density-weighted: denser cells contribute more leftovers.
function _stratifiedSample(arr, n) {
  if (arr.length <= n) return arr.slice();

  const xVals = arr.map(p => p.sw);
  const yVals = arr.map(p => p.hafwl);
  const zVals = arr.map(p => Math.sqrt(p.perm / Math.max(1e-12, p.por)));
  const xMin = Math.min.apply(null, xVals), xMax = Math.max.apply(null, xVals);
  const yMin = Math.min.apply(null, yVals), yMax = Math.max.apply(null, yVals);
  const zMin = Math.min.apply(null, zVals), zMax = Math.max.apply(null, zVals);
  const binsXY = Math.max(2, Math.round(Math.sqrt(n / 6)));
  const binsZ = Math.min(3, binsXY);
  const xR = (xMax - xMin) || 1;
  const yR = (yMax - yMin) || 1;
  const zR = (zMax - zMin) || 1;
  const cells = new Map();
  for (let idx = 0; idx < arr.length; idx++) {
    const i = Math.min(binsXY - 1, Math.floor((xVals[idx] - xMin) / xR * binsXY));
    const j = Math.min(binsXY - 1, Math.floor((yVals[idx] - yMin) / yR * binsXY));
    const k = Math.min(binsZ  - 1, Math.floor((zVals[idx] - zMin) / zR * binsZ));
    const key = i + '|' + j + '|' + k;
    let bucket = cells.get(key);
    if (!bucket) { bucket = []; cells.set(key, bucket); }
    bucket.push(arr[idx]);
  }

  const cellKeys = [...cells.keys()];
  for (let i = cellKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cellKeys[i]; cellKeys[i] = cellKeys[j]; cellKeys[j] = tmp;
  }
  const out = [];
  const leftover = [];
  for (const key of cellKeys) {
    const bucket = cells.get(key);
    if (out.length < n) {
      const r = Math.floor(Math.random() * bucket.length);
      out.push(bucket[r]);
      for (let i = 0; i < bucket.length; i++) if (i !== r) leftover.push(bucket[i]);
    } else {
      for (const p of bucket) leftover.push(p);
    }
  }

  const need = n - out.length;
  if (need > 0 && leftover.length > 0) {
    const k = Math.min(need, leftover.length);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (leftover.length - i));
      const tmp = leftover[i]; leftover[i] = leftover[j]; leftover[j] = tmp;
    }
    for (let i = 0; i < k; i++) out.push(leftover[i]);
  }
  return out;
}

// ============================================================
// Brooks-Corey saturation-height fit
// ============================================================
//   Sw(h) = Swirr + (1 - Swirr) * (he / h)^λ      for h ≥ he
//   Sw(h) = 1                                      for h < he   (water leg)
//
// Auto-fit uses log-log linearisation (linear in λ and log(he) for a fixed
// Swirr) plus a 1-D grid search over Swirr to bypass the nonlinearity in
// Swirr. Manual edits drive the curve directly; r² is recomputed on the
// currently-filtered point set so the user gets a fresh quality readout
// after either flow.

function _shfBcSwAt(h, swirr, he, lambda) {
  if (!(h > 0)) return 1;
  if (h <= he) return 1;
  const sw = swirr + (1 - swirr) * Math.pow(he / h, lambda);
  return Math.max(0, Math.min(1, sw));
}

function _shfBcQuality(points, swirr, he, lambda) {
  // Quality computed against the points the user is currently looking at.
  // Sw=1 / hafwl<=0 are excluded upstream by shfFilteredPoints.
  if (!points || points.length < 3) return null;
  let sum = 0;
  for (const p of points) sum += p.sw;
  const mean = sum / points.length;
  let sse = 0, sst = 0;
  for (const p of points) {
    const pred = _shfBcSwAt(p.hafwl, swirr, he, lambda);
    sse += (p.sw - pred) * (p.sw - pred);
    sst += (p.sw - mean) * (p.sw - mean);
  }
  return {
    r2: sst > 0 ? Math.max(0, 1 - sse / sst) : 0,
    n: points.length,
    sse,
  };
}

function _fitBrooksCoreyShf(points) {
  if (!points || points.length < 3) return null;
  const swArr = points.map(p => p.sw);
  const hArr  = points.map(p => p.hafwl);

  // Search Swirr across a wide physical range. The log-linearisation only
  // uses observations where (Sw − Swirr) > 0, so a high Swirr candidate
  // simply uses fewer points; that's fine as long as 3+ remain.
  const swirrHi = 0.5;
  const grid = 100;

  let best = null;
  for (let i = 0; i <= grid; i++) {
    const swirr = swirrHi * (i / grid);
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let j = 0; j < points.length; j++) {
      const num = swArr[j] - swirr;
      if (num <= 0) continue;
      const x = Math.log(hArr[j]);
      const y = Math.log(num / (1 - swirr));
      n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    if (n < 3) continue;
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const slope = (n * sxy - sx * sy) / denom;     // = -λ
    const intercept = (sy - slope * sx) / n;       // = λ * log(he)
    const lambda = -slope;
    if (!(lambda > 0)) continue;
    const he = Math.exp(intercept / lambda);
    if (!isFinite(he) || he <= 0) continue;
    const q = _shfBcQuality(points, swirr, he, lambda);
    if (!q) continue;
    if (!best || q.sse < best.sse) {
      best = { swirr, he, lambda, r2: q.r2, n: q.n, sse: q.sse };
    }
  }
  return best;
}

function _shfFitInputs() {
  return {
    swirr: document.getElementById('shf-swirr'),
    he:    document.getElementById('shf-he'),
    lambda:document.getElementById('shf-lambda'),
    stats: document.getElementById('shf-fit-stats'),
    clear: document.getElementById('shf-fit-clear-btn'),
  };
}

function _readShfFitInputs() {
  const i = _shfFitInputs();
  const swirr = Number(i.swirr.value);
  const he = Number(i.he.value);
  const lambda = Number(i.lambda.value);
  if (!Number.isFinite(swirr) || swirr < 0 || swirr >= 1) return null;
  if (!Number.isFinite(he) || he < 0) return null;
  if (!Number.isFinite(lambda) || lambda <= 0) return null;
  return { swirr, he, lambda };
}

function _writeShfFitInputs(fit) {
  const i = _shfFitInputs();
  i.swirr.value = Number(fit.swirr).toFixed(3);
  i.he.value = Number(fit.he).toFixed(3);
  i.lambda.value = Number(fit.lambda).toFixed(3);
}

function _updateShfFitStats() {
  const i = _shfFitInputs();
  if (!shfState.fit || shfState.fit.r2 == null) {
    i.stats.style.display = 'none';
    i.stats.textContent = '';
    i.clear.style.display = 'none';
    return;
  }
  i.stats.style.display = '';
  i.stats.textContent = 'R² = ' + shfState.fit.r2.toFixed(3)
    + '   ·   n = ' + shfState.fit.n;
  i.clear.style.display = '';
}

// Called by the auto-fit button.
function shfAutoFit() {
  const pts = shfFilteredPoints();
  const fit = _fitBrooksCoreyShf(pts);
  if (!fit) {
    const stats = document.getElementById('shf-fit-stats');
    stats.style.display = '';
    stats.textContent = 'Not enough usable samples to fit (need 3+ with Sw < 1).';
    return;
  }
  shfState.fit = fit;
  _writeShfFitInputs(fit);
  _updateShfFitStats();
  refreshShfPanel();
  Projects.saveDebounced();
}

// Called by the clear button.
function shfClearFit() {
  shfState.fit = null;
  _updateShfFitStats();
  refreshShfPanel();
  Projects.saveDebounced();
}

// Called when the user types in any of the three fit inputs.
function shfFitInputChanged() {
  const params = _readShfFitInputs();
  if (!params) return;  // invalid mid-typing, ignore
  const q = _shfBcQuality(shfFilteredPoints(), params.swirr, params.he, params.lambda);
  shfState.fit = {
    swirr: params.swirr, he: params.he, lambda: params.lambda,
    r2: q ? q.r2 : null, n: q ? q.n : 0,
  };
  _updateShfFitStats();
  refreshShfPanel();
  Projects.saveDebounced();
}

// Re-sync inputs to a possibly-loaded shfState.fit (after applyToUI).
function syncShfFitInputs() {
  if (shfState.fit) {
    _writeShfFitInputs(shfState.fit);
    // Recompute r² against current filtered points so reload doesn't show
    // stale stats from the previous session.
    const q = _shfBcQuality(shfFilteredPoints(), shfState.fit.swirr, shfState.fit.he, shfState.fit.lambda);
    if (q) { shfState.fit.r2 = q.r2; shfState.fit.n = q.n; }
  }
  _updateShfFitStats();
}

// Linear-interpolation percentile (NumPy-default style). Input must be sorted
// ascending. Used to clip color scales to p05/p95 so a handful of error /
// bad-quality samples can't compress the rainbow ramp.
function _percentile(sortedAsc, q) {
  const m = sortedAsc.length;
  if (m === 0) return 0;
  if (m === 1) return sortedAsc[0];
  const pos = q * (m - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] * (hi - pos) + sortedAsc[hi] * (pos - lo);
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
  // Keep the BC fit r² in sync with the currently-filtered point set so the
  // stats readout reflects what's on screen, not a snapshot from auto-fit.
  if (shfState.fit) {
    const q = _shfBcQuality(pts, shfState.fit.swirr, shfState.fit.he, shfState.fit.lambda);
    if (q) { shfState.fit.r2 = q.r2; shfState.fit.n = q.n; _updateShfFitStats(); }
  }
  const maxInput = document.getElementById('shf-max');
  const maxPts = Math.max(10, parseInt(maxInput.value) || 100);
  const sampled = _stratifiedSample(pts, maxPts);

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

// Lazily create a single hover-tooltip element pinned to the SHF canvas
// wrap. Reused across renders — we only flip display + textContent.
let _shfTooltipEl = null;
function _ensureShfTooltipEl() {
  if (_shfTooltipEl && _shfTooltipEl.isConnected) return _shfTooltipEl;
  const canvas = document.getElementById('shf-canvas');
  const wrap = canvas && canvas.parentElement;
  if (!wrap) return null;
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  _shfTooltipEl = document.createElement('div');
  _shfTooltipEl.className = 'shf-tooltip';
  wrap.appendChild(_shfTooltipEl);
  return _shfTooltipEl;
}

// HTML tooltip body. Two label/value pairs per row in a 4-column grid; the
// well name spans both columns at the top. Values fall back to '—' when
// the source row didn't carry the column.
function _shfTooltipHtml(p) {
  const num = (v, d) => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const rqi = (p.por != null && p.perm != null && p.por > 0)
    ? Math.sqrt(p.perm / p.por) : null;
  const pairs = [
    ['MD',     num(p.md, 3)],
    ['TVDSS',  num(p.tvdss, 2)],
    ['HAFWL',  num(p.hafwl, 2)],
    ['Sw',     num(p.sw, 4)],
    ['φ',      num(p.por, 4)],
    ['k',      num(p.perm, 3)],
    ['√(k/φ)', num(rqi, 3)],
  ];
  let body = '';
  for (const [k, v] of pairs) {
    body += '<span class="tt-k">' + esc(k) + '</span><span class="tt-v">' + esc(v) + '</span>';
  }
  return '<div class="tt-name">' + esc(p.well) + '</div>'
       + '<div class="tt-grid">' + body + '</div>';
}

function _colorMetricLabel(mode) {
  return mode === 'por' ? 'Porosity (φ)' : '√(k/φ)';
}

function _renderShfPlot(points) {
  const colorBy = document.getElementById('shf-color').value;
  const cvals = points.map(p => _colorMetric(p, colorBy));
  // Color scale clipped to p05–p95 of the metric so a handful of bad/error
  // samples can't compress the rainbow into a thin band. Points beyond the
  // bounds saturate at the ends of the ramp.
  const sortedC = cvals.slice().sort((a, b) => a - b);
  const cLo = _percentile(sortedC, 0.05);
  const cHi = _percentile(sortedC, 0.95);
  const cRange = (cHi - cLo) || 1;

  // X = Sw (clipped to [0, max(1, observed)]); Y = HAFWL (linear, low at bottom).
  const xs = points.map(p => p.sw);
  const ys = points.map(p => p.hafwl);
  let xLo = 0;
  let xHi = Math.max(1, Math.max.apply(null, xs));
  // Y-axis pinned at HAFWL = 0 (FWL); below-FWL points are filtered upstream.
  let yLo = 0;
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
  // Stale tooltip from a previous render won't get a mouseleave when its
  // circle is removed — hide eagerly so it doesn't hang over the new plot.
  if (_shfTooltipEl) _shfTooltipEl.style.display = 'none';
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

  // Points. Hover tooltip is a custom HTML overlay (not native SVG <title>)
  // because native tooltips collapse newlines in Chrome/Safari, are slow to
  // appear, and look like OS chrome. The overlay is created once per render
  // alongside the canvas and positioned by mousemove.
  const tip = _ensureShfTooltipEl();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = xScale(p.sw);
    const y = yScale(p.hafwl);
    const t = (cvals[i] - cLo) / cRange;
    const color = _rainbowColor(t);
    const c = svgEl('circle', {
      cx: x, cy: y, r: 3.4,
      fill: color, 'fill-opacity': 0.78,
      stroke: color, 'stroke-opacity': 0.95, 'stroke-width': 0.6,
    }, svg);
    c.addEventListener('mouseenter', () => {
      tip.innerHTML = _shfTooltipHtml(p);
      tip.style.display = 'block';
    });
    c.addEventListener('mousemove', (ev) => {
      const wrap = tip.parentElement;
      const r = wrap.getBoundingClientRect();
      tip.style.left = (ev.clientX - r.left) + 'px';
      tip.style.top  = (ev.clientY - r.top) + 'px';
    });
    c.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  // Brooks-Corey overlay. Sample h across the visible y range and connect
  // the (Sw(h), h) points; the curve has a kink at h = he where it switches
  // from the water leg (Sw=1) into the BC tail.
  if (shfState.fit) {
    const f = shfState.fit;
    const N = 160;
    let d = '';
    for (let i = 0; i <= N; i++) {
      const h = yLo + (yHi - yLo) * (i / N);
      const sw = _shfBcSwAt(h, f.swirr, f.he, f.lambda);
      const x = xScale(Math.max(xLo, Math.min(xHi, sw)));
      const y = yScale(h);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
    }
    svgEl('path', {
      d, fill: 'none',
      stroke: '#1f1d18', 'stroke-width': 1.8,
      'stroke-dasharray': '6,4', 'stroke-linecap': 'round',
    }, svg);
  }

  _renderShfColorBar(_colorMetricLabel(colorBy), cLo, cHi);
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
