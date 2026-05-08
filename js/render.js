"use strict";

// ============================================================
// Table rendering and TSV/CSV export
// ============================================================

// In hierarchical mode (byWell+byZone+byFacies) each (well, zone) gets a parent
// row with collapsible per-facies child rows. We remember which zone keys the
// user has expanded so re-renders (e.g. flipping a Show toggle) preserve state.
// Keys are "<well>\x00<zone>". Persists across renders; harmless stale keys
// are ignored.
const expandedZones = new Set();

function fmtNum(v, dp = 2) {
  if (!isFinite(v)) return '';
  return v.toFixed(dp);
}

function fmtFrac(v) {
  if (!isFinite(v)) return '';
  return (v * 100).toFixed(1) + '%';
}

function fmtPor(v) {
  if (v == null || !isFinite(v)) return '';
  return v.toFixed(4);
}

function fmtPerm(v) {
  if (v == null || !isFinite(v)) return '';
  // Permeability ranges from < 0.01 to thousands of mD, adapt precision
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  if (a >= 1) return v.toFixed(3);
  if (a >= 0.01) return v.toFixed(4);
  return v.toExponential(2);
}

function faciesHeaderText(f, labels) {
  const lab = labels && labels.get(f);
  return lab ? lab : 'F' + f;
}

function headCell(text, cls) {
  const th = document.createElement('th');
  th.textContent = text;
  if (cls) th.className = cls;
  return th;
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function cellClass(text, cls) {
  const td = cell(text);
  if (cls) td.className = cls;
  return td;
}

function render(results, labels, toggles, hasPorosity, hasPermeability, grouping) {
  const tbl = document.getElementById('pivot-table');
  tbl.innerHTML = '';
  if (results.length === 0) {
    tbl.innerHTML = '<tbody><tr><td>No zones to display.</td></tr></tbody>';
    return;
  }
  const facies = uniqueFacies(results);
  lastFacies = facies;

  const showThk = !!toggles.thicknesses;
  const showFrac = !!toggles.fractions;
  const showPor = !!(toggles.porosity && hasPorosity);
  const showPerm = !!(toggles.permeability && hasPermeability);

  const byWell = !!grouping.byWell;
  const byZone = !!grouping.byZone;
  const byFacies = !!grouping.byFacies;

  const rowsView = aggregateResults(results, byWell, byZone, byFacies);
  // State 1 retains the per-well base + totals row pattern only when grouping
  // is well + zone with no facies dimension.
  const isStateOne = byWell && byZone && !byFacies;

  const showWellCol = byWell;
  const showZoneCol = byZone;
  const showFaciesCol = byFacies;
  const showMdTopCol = byWell && byZone && !byFacies;

  const hasAnyGroup = showThk || showFrac || showPor || showPerm;

  // ---- thead: two rows when groups are present, one row otherwise ----
  const thead = document.createElement('thead');
  const tr1 = document.createElement('tr');

  function rowspanHead(text, cls) {
    const th = document.createElement('th');
    th.textContent = text;
    if (cls) th.className = cls;
    if (hasAnyGroup) th.rowSpan = 2;
    return th;
  }
  if (showWellCol) tr1.appendChild(rowspanHead('Well', 'well-h'));
  if (showZoneCol) tr1.appendChild(rowspanHead('Zone', 'zone-h'));
  if (showFaciesCol) tr1.appendChild(rowspanHead('Facies', 'zone-h'));
  if (showMdTopCol) tr1.appendChild(rowspanHead('MD top'));
  if (!showWellCol && !showZoneCol && !showMdTopCol) {
    // State 4: no row labels -- the leading column is Gross Z, no extra label needed
  }
  tr1.appendChild(rowspanHead('Gross Z'));

  function groupTitle(text, span) {
    const th = document.createElement('th');
    th.className = 'group-title-h group-start';
    th.colSpan = span;
    th.textContent = text;
    return th;
  }
  // Each facies group: 1 (n) + facies.length columns
  if (showThk) tr1.appendChild(groupTitle('Facies thicknesses (m)', 1 + facies.length));
  if (showFrac) tr1.appendChild(groupTitle('Facies fractions', 1 + facies.length));
  if (showPor) tr1.appendChild(groupTitle('Porosity', 5));
  if (showPerm) tr1.appendChild(groupTitle('Permeability (mD)', 5));
  thead.appendChild(tr1);

  if (hasAnyGroup) {
    const tr2 = document.createElement('tr');
    function nHead(isGroupStart) {
      const th = document.createElement('th');
      th.className = 'n-h' + (isGroupStart ? ' group-start' : '');
      th.textContent = 'n';
      return th;
    }
    function makeFacHead(f, metaText) {
      const th = document.createElement('th');
      th.className = 'fac-h';
      const labEl = document.createElement('span');
      labEl.className = 'fac-label';
      labEl.textContent = faciesHeaderText(f, labels);
      const metaEl = document.createElement('span');
      metaEl.className = 'fac-meta';
      metaEl.textContent = (labels && labels.get(f)) ? ('F' + f + (metaText ? ' · ' + metaText : '')) : metaText;
      th.appendChild(labEl); th.appendChild(metaEl);
      return th;
    }
    function porSubHead(text, meta, isGroupStart) {
      const th = document.createElement('th');
      th.className = 'fac-h' + (isGroupStart ? ' group-start' : '');
      const labEl = document.createElement('span');
      labEl.className = 'fac-label';
      labEl.textContent = text;
      if (meta) {
        const metaEl = document.createElement('span');
        metaEl.className = 'fac-meta';
        metaEl.textContent = meta;
        th.appendChild(labEl); th.appendChild(metaEl);
      } else {
        th.appendChild(labEl);
      }
      return th;
    }
    if (showThk) {
      tr2.appendChild(nHead(true));
      for (const f of facies) tr2.appendChild(makeFacHead(f, ''));
    }
    if (showFrac) {
      tr2.appendChild(nHead(true));
      for (const f of facies) tr2.appendChild(makeFacHead(f, ''));
    }
    if (showPor) {
      tr2.appendChild(nHead(true));
      tr2.appendChild(porSubHead('mean', 'φ'));
      tr2.appendChild(porSubHead('std',  'σ'));
      tr2.appendChild(porSubHead('min', null));
      tr2.appendChild(porSubHead('max', null));
    }
    if (showPerm) {
      tr2.appendChild(nHead(true));
      tr2.appendChild(porSubHead('mean', 'k'));
      tr2.appendChild(porSubHead('std',  'σ'));
      tr2.appendChild(porSubHead('min', null));
      tr2.appendChild(porSubHead('max', null));
    }
    thead.appendChild(tr2);
  }
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');

  function emitDataRow(r, isFirstInGroup, isAggregate, role) {
    // role (optional, hierarchical mode only):
    //   { kind: 'zone-parent', key, hasChildren, expanded }   — collapsible parent row
    //   { kind: 'facies-child', parentKey, expanded }         — child row, hidden if !expanded
    role = role || {};
    const row = document.createElement('tr');
    if (isAggregate) row.classList.add('agg-row');
    if (isFirstInGroup && tbody.children.length > 0) row.classList.add('group-divider');
    if (role.kind === 'zone-parent') {
      row.classList.add('zone-parent-row');
      if (role.hasChildren) row.classList.add('has-children');
      if (role.expanded) row.classList.add('expanded');
      row.dataset.key = role.key;
    } else if (role.kind === 'facies-child') {
      row.classList.add('facies-child-row');
      if (!role.expanded) row.classList.add('collapsed');
      row.dataset.parent = role.parentKey;
    }

    if (showWellCol) {
      const wellTd = document.createElement('td');
      wellTd.className = 'well-c';
      // Print the well only on the first row of each well group; rows
      // that share the well with the previous row leave the cell blank.
      // The caller is responsible for setting isFirstInGroup to mark a
      // well boundary — flat aggregations track previous well, state-1
      // and hierarchical modes flush per well group.
      const showWell = role.kind !== 'facies-child' && isFirstInGroup;
      if (showWell) wellTd.textContent = r.well;
      row.appendChild(wellTd);
    }
    if (showZoneCol) {
      const zoneTd = document.createElement('td');
      zoneTd.className = 'zone-c';
      if (role.kind === 'facies-child') {
        // Children inherit the zone label from their parent — leave the cell empty.
      } else if (role.kind === 'zone-parent' && role.hasChildren) {
        const caret = document.createElement('span');
        caret.className = 'zone-caret';
        caret.textContent = '▸';
        zoneTd.appendChild(caret);
        zoneTd.appendChild(document.createTextNode(r.zone));
      } else {
        zoneTd.textContent = r.zone;
      }
      row.appendChild(zoneTd);
    }
    if (showFaciesCol) {
      const facTd = document.createElement('td');
      facTd.className = 'zone-c';
      if (role.kind === 'zone-parent') {
        // Parent row covers all facies; leave the per-facies label cell empty.
      } else {
        // Show the human label if available; fall back to F<code>
        const code = r.facies;
        const lab = (lastLabels && lastLabels.get(code)) ? lastLabels.get(code) : ('F' + code);
        facTd.textContent = lab;
        if (role.kind === 'facies-child') facTd.classList.add('facies-child-cell');
      }
      row.appendChild(facTd);
    }
    if (showMdTopCol) {
      row.appendChild(cell(r.mdTop != null ? fmtNum(r.mdTop) : ''));
    }
    row.appendChild(cell(fmtNum(r.grossZ)));

    const facN = totalFaciesN(r);
    if (showThk) {
      const nTd = cell(facN > 0 ? String(facN) : '');
      nTd.className = 'n-cell group-start' + (facN === 0 ? ' zero' : '');
      row.appendChild(nTd);
      for (const f of facies) {
        const v = r.faciesZ.get(f) || 0;
        const c = cell(fmtNum(v));
        if (v === 0) c.classList.add('num-cell', 'zero');
        row.appendChild(c);
      }
    }
    if (showFrac) {
      const nTd = cell(facN > 0 ? String(facN) : '');
      nTd.className = 'n-cell group-start' + (facN === 0 ? ' zero' : '');
      row.appendChild(nTd);
      for (const f of facies) {
        const v = r.faciesFrac.get(f) || 0;
        const c = cell(fmtFrac(v));
        c.classList.add('frac-cell');
        if (v >= 0.999) c.classList.add('full');
        row.appendChild(c);
      }
    }
    if (showPor) {
      const p = r.por || { n: 0, mean: null, std: null, min: null, max: null };
      const nTd = cell(String(p.n));
      nTd.className = 'n-cell group-start' + (p.n === 0 ? ' zero' : '');
      row.appendChild(nTd);
      row.appendChild(cellClass(p.n > 0 ? fmtPor(p.mean) : '', 'stat-cell' + (p.n === 0 ? ' por-empty' : '')));
      row.appendChild(cellClass(p.std != null ? fmtPor(p.std) : (p.n > 0 ? '—' : ''), 'stat-cell' + (p.std == null ? ' por-empty' : '')));
      row.appendChild(cellClass(p.n > 0 ? fmtPor(p.min) : '', 'stat-cell' + (p.n === 0 ? ' por-empty' : '')));
      row.appendChild(cellClass(p.n > 0 ? fmtPor(p.max) : '', 'stat-cell' + (p.n === 0 ? ' por-empty' : '')));
    }
    if (showPerm) {
      const k = r.perm || { n: 0, mean: null, std: null, min: null, max: null };
      const nTd = cell(String(k.n));
      nTd.className = 'n-cell group-start' + (k.n === 0 ? ' zero' : '');
      row.appendChild(nTd);
      row.appendChild(cellClass(k.n > 0 ? fmtPerm(k.mean) : '', 'stat-cell' + (k.n === 0 ? ' por-empty' : '')));
      row.appendChild(cellClass(k.std != null ? fmtPerm(k.std) : (k.n > 0 ? '—' : ''), 'stat-cell' + (k.std == null ? ' por-empty' : '')));
      row.appendChild(cellClass(k.n > 0 ? fmtPerm(k.min) : '', 'stat-cell' + (k.n === 0 ? ' por-empty' : '')));
      row.appendChild(cellClass(k.n > 0 ? fmtPerm(k.max) : '', 'stat-cell' + (k.n === 0 ? ' por-empty' : '')));
    }
    if (role.kind === 'zone-parent' && role.hasChildren) {
      // Toggle child visibility in place — no full re-render. Walks the next
      // siblings while they are children of this parent and flips .collapsed.
      row.addEventListener('click', () => {
        const wasExpanded = expandedZones.has(role.key);
        if (wasExpanded) expandedZones.delete(role.key);
        else expandedZones.add(role.key);
        row.classList.toggle('expanded', !wasExpanded);
        let n = row.nextElementSibling;
        while (n && n.classList.contains('facies-child-row') && n.dataset.parent === role.key) {
          n.classList.toggle('collapsed', wasExpanded);
          n = n.nextElementSibling;
        }
      });
    }
    tbody.appendChild(row);
  }

  function emitBaseRow(lastZone) {
    // Closing marker row for the deepest top in the well, only in state 1
    const row = document.createElement('tr');
    row.classList.add('base-row');
    if (showWellCol) row.appendChild(document.createElement('td')).className = 'well-c';
    if (showZoneCol) {
      const zoneTd = document.createElement('td');
      zoneTd.className = 'zone-c';
      zoneTd.textContent = lastZone.baseSurface || '';
      row.appendChild(zoneTd);
    }
    if (showMdTopCol) row.appendChild(cell(fmtNum(lastZone.mdBase)));
    row.appendChild(cell(''));  // Gross Z blank

    let groupCols = 0;
    if (showThk) groupCols += 1 + facies.length;
    if (showFrac) groupCols += 1 + facies.length;
    if (showPor) groupCols += 5;
    if (showPerm) groupCols += 5;
    let groupBoundaries = new Set();
    let acc = 0;
    if (showThk) { groupBoundaries.add(acc); acc += 1 + facies.length; }
    if (showFrac) { groupBoundaries.add(acc); acc += 1 + facies.length; }
    if (showPor) { groupBoundaries.add(acc); acc += 5; }
    if (showPerm) { groupBoundaries.add(acc); acc += 5; }
    for (let i = 0; i < groupCols; i++) {
      const c = cell('');
      if (groupBoundaries.has(i)) c.classList.add('group-start');
      row.appendChild(c);
    }
    tbody.appendChild(row);
  }

  function emitWellTotalsRow(well, wellRows) {
    // Per-well totals (only in state 1, after each well's group)
    const agg = aggregateResults(wellRows, true, false)[0];
    const row = document.createElement('tr');
    row.className = 'totals-row';
    if (showWellCol) {
      const wTd = document.createElement('td'); wTd.className = 'well-c'; wTd.textContent = well + ' total'; row.appendChild(wTd);
    }
    if (showZoneCol) row.appendChild(cell(''));
    if (showMdTopCol) row.appendChild(cell(''));
    row.appendChild(cell(fmtNum(agg.grossZ)));

    const facN = totalFaciesN(agg);
    if (showThk) {
      const nTd = cell(facN > 0 ? String(facN) : '');
      nTd.className = 'n-cell group-start';
      row.appendChild(nTd);
      for (const f of facies) row.appendChild(cell(fmtNum(agg.faciesZ.get(f) || 0)));
    }
    if (showFrac) {
      const nTd = cell(facN > 0 ? String(facN) : '');
      nTd.className = 'n-cell group-start';
      row.appendChild(nTd);
      for (const f of facies) {
        const v = agg.faciesFrac.get(f) || 0;
        const c = cell(fmtFrac(v));
        c.classList.add('frac-cell');
        if (v >= 0.999) c.classList.add('full');
        row.appendChild(c);
      }
    }
    if (showPor) {
      const p = agg.por;
      const nTd = cell(String(p.n));
      nTd.className = 'n-cell group-start';
      row.appendChild(nTd);
      row.appendChild(cellClass(p.n > 0 ? fmtPor(p.mean) : '', 'stat-cell'));
      row.appendChild(cellClass(p.std != null ? fmtPor(p.std) : (p.n > 0 ? '—' : ''), 'stat-cell'));
      row.appendChild(cellClass(p.n > 0 ? fmtPor(p.min) : '', 'stat-cell'));
      row.appendChild(cellClass(p.n > 0 ? fmtPor(p.max) : '', 'stat-cell'));
    }
    if (showPerm) {
      const k = agg.perm;
      const nTd = cell(String(k.n));
      nTd.className = 'n-cell group-start';
      row.appendChild(nTd);
      row.appendChild(cellClass(k.n > 0 ? fmtPerm(k.mean) : '', 'stat-cell'));
      row.appendChild(cellClass(k.std != null ? fmtPerm(k.std) : (k.n > 0 ? '—' : ''), 'stat-cell'));
      row.appendChild(cellClass(k.n > 0 ? fmtPerm(k.min) : '', 'stat-cell'));
      row.appendChild(cellClass(k.n > 0 ? fmtPerm(k.max) : '', 'stat-cell'));
    }
    tbody.appendChild(row);
  }

  const isHierarchical = byWell && byZone && byFacies;

  // Emit rows. In state 1 we group by well; in hierarchical mode we render the
  // byWell+byZone view as parent rows + per-facies child rows underneath
  // (collapsed by default). Other modes are flat aggregations, one row each.
  if (isStateOne) {
    let prevWell = null;
    let groupBuffer = [];
    function flushGroup() {
      if (groupBuffer.length === 0) return;
      const w = groupBuffer[0].well;
      for (let i = 0; i < groupBuffer.length; i++) emitDataRow(groupBuffer[i], i === 0, false);
      emitBaseRow(groupBuffer[groupBuffer.length - 1]);
      emitWellTotalsRow(w, groupBuffer);
      groupBuffer = [];
    }
    for (const r of rowsView) {
      if (prevWell !== null && r.well !== prevWell) flushGroup();
      groupBuffer.push(r);
      prevWell = r.well;
    }
    flushGroup();
  } else if (isHierarchical) {
    // Parent rows = the byWell+byZone view. Children = the per-facies expansion
    // (already in rowsView). Index children by (well, zone) for fast lookup.
    const childrenByKey = new Map();
    for (const c of rowsView) {
      const k = c.well + '\x00' + c.zone;
      if (!childrenByKey.has(k)) childrenByKey.set(k, []);
      childrenByKey.get(k).push(c);
    }
    let prevWell = null;
    let groupBuffer = [];
    function flushHGroup() {
      if (groupBuffer.length === 0) return;
      const w = groupBuffer[0].well;
      for (let i = 0; i < groupBuffer.length; i++) {
        const z = groupBuffer[i];
        const key = z.well + '\x00' + z.zone;
        const kids = childrenByKey.get(key) || [];
        const expanded = expandedZones.has(key);
        emitDataRow(z, i === 0, false, {
          kind: 'zone-parent', key, hasChildren: kids.length > 0, expanded,
        });
        for (const c of kids) {
          emitDataRow(c, false, false, {
            kind: 'facies-child', parentKey: key, expanded,
          });
        }
      }
      emitBaseRow(groupBuffer[groupBuffer.length - 1]);
      emitWellTotalsRow(w, groupBuffer);
      groupBuffer = [];
    }
    for (const r of results) {  // results is the byWell+byZone view (no facies expansion)
      if (prevWell !== null && r.well !== prevWell) flushHGroup();
      groupBuffer.push(r);
      prevWell = r.well;
    }
    flushHGroup();
  } else {
    // Non-state-1, non-hierarchical: each rowsView entry is already an
    // aggregated summary. Track the previous row's well so the well
    // column only labels the first row of each well group (e.g. when
    // grouping by Well + Facies, multiple facies rows share a well).
    let prevWell = null;
    for (const r of rowsView) {
      const isFirstWellRow = r.well !== prevWell;
      emitDataRow(r, isFirstWellRow, true);
      prevWell = r.well;
    }
  }

  tbl.appendChild(tbody);
}

function buildTSV(results, facies, labels, toggles, hasPorosity, hasPermeability, grouping) {
  const showThk = !!toggles.thicknesses;
  const showFrac = !!toggles.fractions;
  const showPor = !!(toggles.porosity && hasPorosity);
  const showPerm = !!(toggles.permeability && hasPermeability);
  const byWell = !!grouping.byWell;
  const byZone = !!grouping.byZone;
  const byFacies = !!grouping.byFacies;
  const showWellCol = byWell;
  const showZoneCol = byZone;
  const showFaciesCol = byFacies;
  const showMdTopCol = byWell && byZone && !byFacies;
  const isStateOne = byWell && byZone && !byFacies;

  function facLabel(f) { return (labels && labels.get(f)) ? labels.get(f) : ('F' + f); }
  const head = [];
  if (showWellCol) head.push('Well');
  if (showZoneCol) head.push('Zone');
  if (showFaciesCol) head.push('Facies');
  if (showMdTopCol) head.push('MD top');
  head.push('Gross Z');
  if (showThk) { head.push('Facies n'); for (const f of facies) head.push(facLabel(f) + ' (m)'); }
  if (showFrac) { head.push('Facies n'); for (const f of facies) head.push(facLabel(f) + ' frac'); }
  if (showPor) head.push('Por n', 'Por mean', 'Por std', 'Por min', 'Por max');
  if (showPerm) head.push('Perm n', 'Perm mean', 'Perm std', 'Perm min', 'Perm max');

  const rowsView = aggregateResults(results, byWell, byZone, byFacies);
  const lines = [head.join('\t')];

  function rowFor(r) {
    const row = [];
    if (showWellCol) row.push(r.well);
    if (showZoneCol) row.push(r.zone);
    if (showFaciesCol) row.push(facLabel(r.facies));
    if (showMdTopCol) row.push(r.mdTop != null ? fmtNum(r.mdTop) : '');
    row.push(fmtNum(r.grossZ));
    const facN = totalFaciesN(r);
    if (showThk) {
      row.push(facN > 0 ? String(facN) : '');
      for (const f of facies) row.push(fmtNum(r.faciesZ.get(f) || 0));
    }
    if (showFrac) {
      row.push(facN > 0 ? String(facN) : '');
      for (const f of facies) row.push(((r.faciesFrac.get(f) || 0)).toFixed(4));
    }
    if (showPor) {
      const p = r.por || { n: 0, mean: null, std: null, min: null, max: null };
      row.push(String(p.n));
      row.push(p.n > 0 ? fmtPor(p.mean) : '');
      row.push(p.std != null ? fmtPor(p.std) : '');
      row.push(p.n > 0 ? fmtPor(p.min) : '');
      row.push(p.n > 0 ? fmtPor(p.max) : '');
    }
    if (showPerm) {
      const k = r.perm || { n: 0, mean: null, std: null, min: null, max: null };
      row.push(String(k.n));
      row.push(k.n > 0 ? fmtPerm(k.mean) : '');
      row.push(k.std != null ? fmtPerm(k.std) : '');
      row.push(k.n > 0 ? fmtPerm(k.min) : '');
      row.push(k.n > 0 ? fmtPerm(k.max) : '');
    }
    return row.join('\t');
  }

  if (isStateOne) {
    let prev = null;
    let buf = [];
    function flushExport() {
      if (buf.length === 0) return;
      for (const r of buf) lines.push(rowFor(r));
      const last = buf[buf.length - 1];
      const baseRow = [];
      if (showWellCol) baseRow.push('');
      if (showZoneCol) baseRow.push(last.baseSurface || '');
      if (showMdTopCol) baseRow.push(fmtNum(last.mdBase));
      baseRow.push('');
      const pad = (showThk ? 1 + facies.length : 0) + (showFrac ? 1 + facies.length : 0) + (showPor ? 5 : 0) + (showPerm ? 5 : 0);
      for (let i = 0; i < pad; i++) baseRow.push('');
      lines.push(baseRow.join('\t'));
      const agg = aggregateResults(buf, true, false)[0];
      const totalsRow = [];
      if (showWellCol) totalsRow.push(buf[0].well + ' total');
      if (showZoneCol) totalsRow.push('');
      if (showMdTopCol) totalsRow.push('');
      totalsRow.push(fmtNum(agg.grossZ));
      const aggFacN = totalFaciesN(agg);
      if (showThk) {
        totalsRow.push(aggFacN > 0 ? String(aggFacN) : '');
        for (const f of facies) totalsRow.push(fmtNum(agg.faciesZ.get(f) || 0));
      }
      if (showFrac) {
        totalsRow.push(aggFacN > 0 ? String(aggFacN) : '');
        for (const f of facies) totalsRow.push(((agg.faciesFrac.get(f) || 0)).toFixed(4));
      }
      if (showPor) {
        const p = agg.por;
        totalsRow.push(String(p.n));
        totalsRow.push(p.n > 0 ? fmtPor(p.mean) : '');
        totalsRow.push(p.std != null ? fmtPor(p.std) : '');
        totalsRow.push(p.n > 0 ? fmtPor(p.min) : '');
        totalsRow.push(p.n > 0 ? fmtPor(p.max) : '');
      }
      if (showPerm) {
        const k = agg.perm;
        totalsRow.push(String(k.n));
        totalsRow.push(k.n > 0 ? fmtPerm(k.mean) : '');
        totalsRow.push(k.std != null ? fmtPerm(k.std) : '');
        totalsRow.push(k.n > 0 ? fmtPerm(k.min) : '');
        totalsRow.push(k.n > 0 ? fmtPerm(k.max) : '');
      }
      lines.push(totalsRow.join('\t'));
      buf = [];
    }
    for (const r of rowsView) {
      if (prev !== null && r.well !== prev) flushExport();
      buf.push(r);
      prev = r.well;
    }
    flushExport();
  } else {
    for (const r of rowsView) lines.push(rowFor(r));
  }

  return lines.join('\n');
}

function buildCSV(results, facies, labels, toggles, hasPorosity, hasPermeability, grouping) {
  return buildTSV(results, facies, labels, toggles, hasPorosity, hasPermeability, grouping).split('\n').map(l => l.split('\t').map(c => {
    if (/[",\n]/.test(c)) return '"' + c.replace(/"/g, '""') + '"';
    return c;
  }).join(',')).join('\n');
}
