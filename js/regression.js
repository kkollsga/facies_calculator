"use strict";

// ============================================================
// Regression: polynomial least-squares + R² + Petrel formula
// ============================================================

const REG_COLORS = [
  '#8b3a1e', '#1f5d6e', '#5a4789', '#2f6d3a', '#9c4860',
  '#5a6a26', '#7a3a1e', '#3d6280', '#7d6128', '#56407a',
];

function polyFit(xs, ys, degree) {
  // Solve normal equations (X^T X) a = X^T y via Gaussian elimination with partial pivoting.
  // Returns coefficient array [a0, a1, ..., aDegree] for y ≈ Σ a_i * x^i.
  const n = xs.length;
  if (n < degree + 1) throw new Error('Need at least ' + (degree + 1) + ' points for degree ' + degree);
  const M = degree + 1;
  const XtX = [];
  const Xty = [];
  for (let r = 0; r < M; r++) { XtX.push(new Array(M).fill(0)); Xty.push(0); }
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    const pow = new Array(M);
    pow[0] = 1;
    for (let d = 1; d < M; d++) pow[d] = pow[d - 1] * x;
    for (let r = 0; r < M; r++) {
      for (let c = 0; c < M; c++) XtX[r][c] += pow[r] * pow[c];
      Xty[r] += pow[r] * y;
    }
  }
  // Build augmented matrix
  const aug = [];
  for (let r = 0; r < M; r++) aug.push(XtX[r].concat([Xty[r]]));
  // Gaussian elimination
  for (let col = 0; col < M; col++) {
    let piv = col;
    for (let r = col + 1; r < M; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[piv][col])) piv = r;
    }
    if (piv !== col) { const tmp = aug[col]; aug[col] = aug[piv]; aug[piv] = tmp; }
    if (Math.abs(aug[col][col]) < 1e-14) throw new Error('Singular system (data too collinear for this degree)');
    for (let r = 0; r < M; r++) {
      if (r === col) continue;
      const f = aug[r][col] / aug[col][col];
      for (let c = col; c <= M; c++) aug[r][c] -= f * aug[col][c];
    }
  }
  const result = new Array(M);
  for (let r = 0; r < M; r++) result[r] = aug[r][M] / aug[r][r];
  return result;
}

function polyEval(coeffs, x) {
  // Horner's method
  let v = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) v = v * x + coeffs[i];
  return v;
}

function rSquared(xs, ys, coeffs) {
  const n = ys.length;
  if (n === 0) return 0;
  let yMean = 0;
  for (const y of ys) yMean += y;
  yMean /= n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yi = ys[i];
    ssTot += (yi - yMean) * (yi - yMean);
    const pred = polyEval(coeffs, xs[i]);
    ssRes += (yi - pred) * (yi - pred);
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

function fmtCoef(v, sig) {
  // Format coefficient with sensible precision for Petrel display
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(Math.max(0, sig - 3));
  if (a >= 10) return v.toFixed(Math.max(1, sig - 2));
  if (a >= 1) return v.toFixed(Math.max(2, sig - 1));
  if (a >= 0.001) return v.toFixed(sig);
  return v.toExponential(2);
}

function petrelFormula(coeffs) {
  // PERM = Pow(10, A + B*PHIE + C*Pow(PHIE,2) + ...)
  const sig = 4;
  const parts = [fmtCoef(coeffs[0], sig)];
  for (let i = 1; i < coeffs.length; i++) {
    const c = coeffs[i];
    const sign = c >= 0 ? ' + ' : ' - ';
    const term = fmtCoef(Math.abs(c), sig) + '*' + (i === 1 ? 'PHIE' : 'Pow(PHIE,' + i + ')');
    parts.push(sign + term);
  }
  return 'PERM = Pow(10, ' + parts.join('') + ')';
}

// ============================================================
// Regression management: add / toggle / activate / delete
// ============================================================
function regAddFromCurrentFilters() {
  // Use the current filtered points (the same ones drawn on the cross-plot).
  const pts = filteredPoints().filter(p =>
    p.por != null && isFinite(p.por) &&
    p.perm != null && isFinite(p.perm) && p.perm > 0
  );
  const degree = parseInt(document.getElementById('reg-order').value) || 1;
  const requestedName = document.getElementById('reg-name').value.trim();

  if (pts.length < degree + 1) {
    alert('Need at least ' + (degree + 1) + ' valid (porosity, permeability) samples to fit a degree-' + degree + ' polynomial. Currently have ' + pts.length + ' after filters.');
    return;
  }
  const xs = pts.map(p => p.por);
  const ys = pts.map(p => Math.log10(p.perm));
  let coeffs;
  try {
    coeffs = polyFit(xs, ys, degree);
  } catch (e) {
    alert('Fit failed: ' + e.message);
    return;
  }
  const r2 = rSquared(xs, ys, coeffs);

  const id = regState.nextId++;
  const usedColors = new Set(regState.list.map(r => r.color));
  let color = REG_COLORS[0];
  for (const c of REG_COLORS) if (!usedColors.has(c)) { color = c; break; }

  // If a regression is active and the input name matches its name, the user
  // probably clicked Add intending a copy or a new draft -- not intending a
  // literal duplicate name. Use auto-name instead.
  const activeReg = regState.list.find(r => r.id === regState.activeId);
  let name;
  if (activeReg && requestedName === activeReg.name) {
    name = 'Reg ' + id;
  } else {
    name = requestedName || ('Reg ' + id);
  }

  const reg = {
    id, name, degree, color, coeffs, r2,
    filters: snapshotFilters(),
    n: xs.length,
    range: { phiLo: Math.min.apply(null, xs), phiHi: Math.max.apply(null, xs) },
    visible: true,
  };
  regState.list.push(reg);
  regState.activeId = id;
  // Sync inputs to the new active reg so editing them edits this one
  document.getElementById('reg-order').value = String(degree);
  document.getElementById('reg-name').value = name;
  rebuildRegList();
  refreshPlotPanel();
  Projects.saveDebounced();
}

function regDelete(id) {
  regState.list = regState.list.filter(r => r.id !== id);
  if (regState.activeId === id) {
    regState.activeId = null;
    // Reset Order/Name inputs to draft state
    document.getElementById('reg-name').value = '';
    document.getElementById('reg-order').value = '1';
  }
  rebuildRegList();
  refreshPlotPanel();
  Projects.saveDebounced();
}

function regToggleVisibility(id) {
  const r = regState.list.find(r => r.id === id);
  if (!r) return;
  r.visible = !r.visible;
  rebuildRegList();
  refreshPlotPanel();
  Projects.saveDebounced();
}

function regSetActive(id) {
  // Activation now just selects a regression for editing -- it does NOT touch the
  // live filter chips. Use the "Apply filters" button in the detail panel to
  // restore the captured filters explicitly.
  const r = regState.list.find(r => r.id === id);
  if (!r) return;
  regState.activeId = id;
  // Sync the Order and Name inputs to the active regression's values.
  // Subsequent edits to those inputs will modify THIS regression in place.
  document.getElementById('reg-order').value = String(r.degree);
  document.getElementById('reg-name').value = r.name;
  rebuildRegList();
  refreshPlotPanel();
  Projects.saveDebounced();
}

function regClearActive() {
  // Used when the user wants to draft a new regression instead of editing the active one.
  regState.activeId = null;
  document.getElementById('reg-name').value = '';
  document.getElementById('reg-order').value = '1';
  rebuildRegList();
  refreshPlotPanel();
  Projects.saveDebounced();
}

function regApplyFilters(id) {
  // Restore the captured filter snapshot into the live filter chips. Triggered
  // by the explicit Apply Filters button in the detail panel.
  //
  // Mutate the live Sets in place rather than replacing them — the filter chip
  // click handlers from buildFilterChips closed over those Set instances by
  // reference. Replacing them would leave the chip handlers toggling a Set
  // that's no longer hooked up to filteredPoints(), so the plot would silently
  // stop responding to filter clicks.
  const r = regState.list.find(r => r.id === id);
  if (!r) return;
  function copyInto(target, source) {
    target.clear();
    for (const v of source) target.add(v);
  }
  copyInto(plotState.filters.wells,  r.filters.wells);
  copyInto(plotState.filters.zones,  r.filters.zones);
  copyInto(plotState.filters.facies, r.filters.facies);
  syncFilterChipsToState();
  refreshPlotPanel();
}

function regChangeOrder(id, newDegree) {
  // Refit the active regression in place using its locked filter snapshot.
  // Filters are not affected -- only this regression's curve and stats update.
  const r = regState.list.find(r => r.id === id);
  if (!r) return;
  newDegree = parseInt(newDegree) || 1;
  if (newDegree === r.degree) return;
  // Apply the stored filter snapshot to the current data
  const pts = lastPorPoints.filter(p =>
    r.filters.wells.has(p.well) &&
    r.filters.zones.has(p.zone) &&
    (p.facies == null || r.filters.facies.has(p.facies)) &&
    p.por != null && isFinite(p.por) &&
    p.perm != null && isFinite(p.perm) && p.perm > 0
  );
  if (pts.length < newDegree + 1) {
    alert('Need at least ' + (newDegree + 1) + ' valid samples in the captured filter set to fit a degree-' + newDegree + ' polynomial. The locked filters yield ' + pts.length + ' samples.');
    // Snap the dropdown back to the actual degree
    document.getElementById('reg-order').value = String(r.degree);
    return;
  }
  const xs = pts.map(p => p.por);
  const ys = pts.map(p => Math.log10(p.perm));
  let coeffs;
  try { coeffs = polyFit(xs, ys, newDegree); }
  catch (e) {
    alert('Refit failed: ' + e.message);
    document.getElementById('reg-order').value = String(r.degree);
    return;
  }
  r.degree = newDegree;
  r.coeffs = coeffs;
  r.r2 = rSquared(xs, ys, coeffs);
  r.n = xs.length;
  r.range = { phiLo: Math.min.apply(null, xs), phiHi: Math.max.apply(null, xs) };
  rebuildRegList();
  refreshPlotPanel();
  Projects.saveDebounced();
}

function regRename(id, newName) {
  const r = regState.list.find(r => r.id === id);
  if (!r) return;
  r.name = newName.trim() || ('Reg ' + r.id);
  rebuildRegList();
  refreshPlotPanel();
  Projects.saveDebounced();
}

function syncFilterChipsToState() {
  // Update chip "active" classes to match the current filter sets.
  for (const containerId of ['filter-wells', 'filter-zones', 'filter-facies']) {
    const c = document.getElementById(containerId);
    const set = containerId === 'filter-wells' ? plotState.filters.wells
              : containerId === 'filter-zones' ? plotState.filters.zones
              : plotState.filters.facies;
    for (const chip of c.querySelectorAll('.plot-chip')) {
      const v = chip.dataset.value;
      if (set.has(v)) chip.classList.add('active');
      else chip.classList.remove('active');
    }
  }
}

function describeFilterSet(set, label) {
  const arr = [...set];
  if (arr.length === 0) return label + ': (none)';
  if (label === 'Facies' && lastLabels) {
    return label + ': ' + arr.map(c => (lastLabels.get(c) ? lastLabels.get(c) + ' (F' + c + ')' : 'F' + c)).join(', ');
  }
  return label + ': ' + arr.join(', ');
}

function rebuildRegList() {
  const c = document.getElementById('reg-list');
  c.innerHTML = '';
  if (regState.list.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11px;color:var(--ink-soft);font-style:italic;padding:2px 0;';
    empty.textContent = 'no regressions yet';
    c.appendChild(empty);
  } else {
    for (const r of regState.list) {
      const item = document.createElement('div');
      item.className = 'plot-reg-item' + (r.id === regState.activeId ? ' active' : '') + (r.visible ? '' : ' disabled');
      item.title = 'Click to make active and restore its captured filters';
      item.addEventListener('click', (e) => {
        // Don't activate if user clicked one of the icon buttons
        if (e.target.closest('.plot-reg-icon-btn')) return;
        regSetActive(r.id);
      });

      const sw = document.createElement('span');
      sw.className = 'plot-reg-swatch';
      sw.style.background = r.color;
      item.appendChild(sw);

      const name = document.createElement('span');
      name.className = 'plot-reg-name';
      name.textContent = r.name;
      item.appendChild(name);

      const deg = document.createElement('span');
      deg.className = 'plot-reg-degree';
      deg.textContent = 'd' + r.degree;
      item.appendChild(deg);

      const visBtn = document.createElement('button');
      visBtn.className = 'plot-reg-icon-btn';
      visBtn.title = r.visible ? 'Hide on plot' : 'Show on plot';
      visBtn.textContent = r.visible ? '●' : '○';
      visBtn.addEventListener('click', (e) => { e.stopPropagation(); regToggleVisibility(r.id); });
      item.appendChild(visBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'plot-reg-icon-btn';
      delBtn.title = 'Delete';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); regDelete(r.id); });
      item.appendChild(delBtn);

      c.appendChild(item);
    }
  }
  // Update the mode hint and deselect button based on whether a reg is active
  const hint = document.getElementById('reg-mode-hint');
  const deselectBtn = document.getElementById('reg-deselect-btn');
  const activeReg = regState.list.find(x => x.id === regState.activeId);
  if (activeReg) {
    hint.classList.add('editing');
    hint.textContent = 'Editing "' + activeReg.name + '". Changes update the curve in place.';
    deselectBtn.style.display = '';
  } else {
    hint.classList.remove('editing');
    hint.textContent = 'These inputs draft the next regression. Click Add to fit on current filters.';
    deselectBtn.style.display = 'none';
  }
  rebuildRegActiveDetail();
}

function rebuildRegActiveDetail() {
  const box = document.getElementById('reg-active-detail');
  const r = regState.list.find(x => x.id === regState.activeId);
  // The detail strip is a cross-plot affordance; suppress it in histogram mode
  // even if a regression is technically still selected.
  if (!r || plotState.type !== 'cross') {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = '';
  box.innerHTML = '';

  // Header strip with the regression name and color cue
  const head = document.createElement('div');
  head.className = 'reg-detail-head';
  const sw = document.createElement('span');
  sw.className = 'reg-detail-swatch';
  sw.style.background = r.color;
  head.appendChild(sw);
  const headTxt = document.createElement('span');
  headTxt.className = 'reg-detail-head-txt';
  headTxt.textContent = r.name;
  head.appendChild(headTxt);
  box.appendChild(head);

  // Stats strip: n, R², phi range, degree
  const stats = document.createElement('div');
  stats.className = 'reg-detail-stats';
  function statCell(label, value) {
    const c = document.createElement('div');
    c.className = 'reg-detail-stat';
    const l = document.createElement('div');
    l.className = 'reg-detail-stat-lbl';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'reg-detail-stat-val';
    v.textContent = value;
    c.appendChild(l); c.appendChild(v);
    stats.appendChild(c);
  }
  statCell('n', String(r.n));
  statCell('R²', r.r2.toFixed(4));
  statCell('φ range', r.range.phiLo.toFixed(3) + '–' + r.range.phiHi.toFixed(3));
  statCell('degree', String(r.degree));
  box.appendChild(stats);

  // Petrel equation, monospaced, copy-friendly
  const eq = document.createElement('div');
  eq.className = 'reg-detail-eq';
  eq.textContent = petrelFormula(r.coeffs);
  box.appendChild(eq);

  // Locked filters section
  const filtHead = document.createElement('div');
  filtHead.className = 'reg-detail-section-head';
  filtHead.textContent = 'Locked filters';
  box.appendChild(filtHead);

  const filtBody = document.createElement('div');
  filtBody.className = 'reg-detail-filters';
  function filtRow(label, items, isFacies) {
    const row = document.createElement('div');
    row.className = 'reg-detail-filt-row';
    const lab = document.createElement('div');
    lab.className = 'reg-detail-filt-lbl';
    lab.textContent = label;
    row.appendChild(lab);
    const vals = document.createElement('div');
    vals.className = 'reg-detail-filt-vals';
    if (items.length === 0) {
      const none = document.createElement('span');
      none.className = 'reg-detail-filt-none';
      none.textContent = '—';
      vals.appendChild(none);
    } else {
      for (const item of items) {
        const tag = document.createElement('span');
        tag.className = 'reg-detail-filt-tag';
        if (isFacies && lastLabels && lastLabels.get(item)) {
          tag.textContent = lastLabels.get(item);
          tag.title = 'F' + item;
        } else {
          tag.textContent = isFacies ? ('F' + item) : item;
        }
        vals.appendChild(tag);
      }
    }
    row.appendChild(vals);
    filtBody.appendChild(row);
  }
  filtRow('Wells', [...r.filters.wells]);
  filtRow('Zones', [...r.filters.zones]);
  filtRow('Facies', [...r.filters.facies], true);
  box.appendChild(filtBody);

  // Apply filters action button
  const apply = document.createElement('button');
  apply.className = 'plot-reg-btn reg-detail-apply';
  apply.textContent = 'Apply these filters';
  apply.title = 'Restore the locked filters into the live filter chips';
  apply.addEventListener('click', () => regApplyFilters(r.id));
  box.appendChild(apply);
}
