"use strict";

// ============================================================
// Application bootstrap: DOM lookups, event wiring, top-level handlers
// ============================================================
// This is the only module that performs side effects on load: it caches DOM
// references, attaches listeners, and hydrates persisted labels.

const topsEl = document.getElementById('tops-in');
const facEl = document.getElementById('facies-in');
const porEl = document.getElementById('por-in');
const statusEl = document.getElementById('status');
const resultsSection = document.getElementById('results-section');
const resultsMeta = document.getElementById('results-meta');
const togThk = document.getElementById('t-thickness');
const togFrac = document.getElementById('t-fraction');
const togPor = document.getElementById('t-porosity');
const togPerm = document.getElementById('t-perm');
const togGW = document.getElementById('g-well');
const togGZ = document.getElementById('g-zone');
const togGF = document.getElementById('g-facies');

// Drag-and-drop text files into any of the three input panels
attachFileDrop(topsEl);
attachFileDrop(facEl);
attachFileDrop(porEl);

// Each textarea edit fires both: schedule a debounced auto-refresh and a
// debounced project save. Combined into one listener so we add one set of
// listeners per input, not two.
function onInputChange() {
  scheduleAutoRefresh();
  Projects.saveDebounced();
}
topsEl.addEventListener('input', onInputChange);
facEl.addEventListener('input', onInputChange);
porEl.addEventListener('input', onInputChange);

function currentToggles() {
  return {
    thicknesses: togThk.checked,
    fractions: togFrac.checked,
    porosity: togPor.checked,
    permeability: togPerm.checked,
  };
}

function currentGrouping() {
  return { byWell: togGW.checked, byZone: togGZ.checked, byFacies: togGF.checked };
}

function rerenderIfReady() {
  if (!lastResults) return;
  render(lastResults, lastLabels, currentToggles(), lastHasPorosity, lastHasPermeability, currentGrouping());
  refreshPlotPanel();
}

togThk.addEventListener('change', rerenderIfReady);
togFrac.addEventListener('change', rerenderIfReady);
togPor.addEventListener('change', rerenderIfReady);
togPerm.addEventListener('change', rerenderIfReady);
togGW.addEventListener('change', rerenderIfReady);
togGZ.addEventListener('change', rerenderIfReady);
togGF.addEventListener('change', rerenderIfReady);

function setStatus(msg, kind) {
  statusEl.className = 'status show' + (kind ? ' ' + kind : '');
  statusEl.textContent = msg;
}
function clearStatus() { statusEl.className = 'status'; statusEl.textContent = ''; }

// ============================================================
// Auto-refresh: silently re-run the pipeline whenever inputs change
// ============================================================
// scheduleAutoRefresh debounces fast typing into one calc per ~250ms. Parse
// errors are swallowed (the user sees no results, not a flickering toast)
// since they're typically transient mid-edit. Once tops + facies parse, the
// full pipeline runs, the table renders, and the test affordances hide.

let _autoRefreshTimer = null;
function scheduleAutoRefresh() {
  if (_autoRefreshTimer) clearTimeout(_autoRefreshTimer);
  _autoRefreshTimer = setTimeout(() => { _autoRefreshTimer = null; autoRefresh(); }, 250);
}

function autoRefresh() {
  let tops = null, fac = null, por = [];
  try { tops = parseTops(topsEl.value); } catch (_) {}
  try { fac = parseFacies(facEl.value); } catch (_) {}
  try { por = parsePorosity(porEl.value); } catch (_) { por = []; }

  // The dynamic label/zone input panels track whatever has parsed so far,
  // even if the other side is still incomplete.
  state.detectedZones = tops ? uniqueZoneNames(tops) : [];
  state.detectedFacies = fac ? uniqueFaciesCodes(fac) : [];
  if (state.zoneRenames.size > 0) {
    const live = new Set(state.detectedZones);
    for (const k of [...state.zoneRenames.keys()]) if (!live.has(k)) state.zoneRenames.delete(k);
  }

  // Wells whose porosity rows carry TVDSS but no HAFWL need a per-well FWL.
  // For those rows, derive HAFWL = TVDSS − FWL once the user has filled the
  // FWL input. Rows that already carry HAFWL are left alone.
  state.detectedFwlWells = por.length > 0 ? porosityWellsNeedingFwl(por) : [];
  if (state.fwlValues.size > 0) {
    const live = new Set(state.detectedFwlWells);
    for (const k of [...state.fwlValues.keys()]) if (!live.has(k)) state.fwlValues.delete(k);
  }
  for (const r of por) {
    if (r.hafwl == null && r.tvdss != null) {
      const fwl = state.fwlValues.get(r.well);
      if (fwl != null && Number.isFinite(fwl)) r.hafwl = r.tvdss - fwl;
    }
  }

  rebuildZoneInputs();
  rebuildLabelInputs();
  rebuildFwlInputs();

  // Need both required inputs; otherwise hide derived UI and surface the
  // empty-state affordances (Run self-tests).
  if (!tops || !fac) {
    hideResultsAndPlot();
    return;
  }

  const labels = state.faciesLabels;
  const renames = state.zoneRenames;
  const zones = buildZones(tops);
  const intervals = buildFaciesIntervals(fac);
  const rawResults = calculate(zones, intervals, por);
  const results = applyZoneRenames(rawResults, renames);
  const hasPor = por.length > 0;
  const hasPerm = hasPor && porosityRowsHavePerm(por);

  lastPorPoints = hasPor ? enrichPorPoints(por, zones, fac, renames) : [];
  lastResults = results;
  lastLabels = labels;
  lastHasPorosity = hasPor;
  lastHasPermeability = hasPerm;
  // SHF panel needs all four — por (always present here) + perm + hafwl + sw.
  lastHasShf = hasPor && hasPerm && porosityRowsHaveShf(por);

  togPor.disabled = !hasPor;
  if (!hasPor) togPor.checked = false;
  else if (togPor.checked === false && !togPor.dataset.userTouched) togPor.checked = true;
  togPerm.disabled = !hasPerm;
  if (!hasPerm) togPerm.checked = false;
  else if (togPerm.checked === false && !togPerm.dataset.userTouched) togPerm.checked = true;

  render(results, labels, currentToggles(), hasPor, hasPerm, currentGrouping());
  resultsSection.style.display = '';
  initPlotPanel();
  refreshPlotPanel();
  initShfPanel();
  refreshShfPanel();
  // Apply persisted visibility AFTER init/refresh — restores plot/SHF section
  // visibility on page reload, doesn't clobber user intent on data flickers.
  syncPlotPanelDisplay();
  syncShfPanelDisplay();
  // Restore BC fit inputs/stats from any persisted shfState.fit.
  syncShfFitInputs();

  const allCodes = new Set();
  results.forEach(r => r.faciesZ.forEach((_, k) => allCodes.add(k)));
  const unlabelled = [...allCodes].filter(c => !labels.has(c));
  let metaText = results.length + ' zones, ' + new Set(results.map(r => r.well)).size + ' well(s)';
  if (labels.size > 0) {
    metaText += ', ' + (allCodes.size - unlabelled.length) + '/' + allCodes.size + ' facies labelled';
  }
  if (renames.size > 0) {
    metaText += ', ' + renames.size + ' zone(s) renamed';
  }
  if (hasPor) {
    let s = ', ' + por.length + ' porosity samples';
    if (hasPerm) s += ' (with perm)';
    metaText += s;
  }
  resultsMeta.textContent = metaText;

  document.getElementById('csv-btn').disabled = false;
  document.getElementById('copy-btn').disabled = false;
  // Real data is loaded — hide the empty-state-only block (sample data
  // loader and self-test runner). The CSV/Copy buttons live inside the
  // data-inputs-area now, so they collapse with the inputs.
  document.getElementById('empty-state-actions').style.display = 'none';
  document.getElementById('tests-panel').style.display = 'none';
  // Reveal the inputs collapse toggle so the user can fold the inputs out
  // of the way once they have a working pivot.
  document.getElementById('inputs-toggle-btn').style.display = '';
  _updateInputsToggleUI();
}

function hideResultsAndPlot() {
  resultsSection.style.display = 'none';
  document.getElementById('csv-btn').disabled = true;
  document.getElementById('copy-btn').disabled = true;
  // Empty state — restore the empty-state actions block.
  document.getElementById('empty-state-actions').style.display = '';
  // Hide DOM sections without touching plotState.visible / shfState.visible
  // — those represent user intent and should be restored when data returns.
  document.getElementById('plot-section').style.display = 'none';
  document.getElementById('shf-section').style.display = 'none';
  // Plot + SHF toggles hide alongside the rest of the data UI.
  const plotBtn = document.getElementById('plot-toggle-btn');
  if (plotBtn) plotBtn.style.display = 'none';
  const shfBtn = document.getElementById('shf-toggle-btn');
  if (shfBtn) shfBtn.style.display = 'none';
  lastHasShf = false;
  // Reset inputs to expanded so the user can paste data straight away,
  // and hide the toggle (no data → nothing to collapse).
  const inputsArea = document.getElementById('data-inputs-area');
  if (inputsArea) inputsArea.classList.remove('collapsed');
  const inputsBtn = document.getElementById('inputs-toggle-btn');
  if (inputsBtn) inputsBtn.style.display = 'none';
  _updateInputsToggleUI();
}

togPor.addEventListener('change', () => { togPor.dataset.userTouched = '1'; });
togPerm.addEventListener('change', () => { togPerm.dataset.userTouched = '1'; });

document.getElementById('csv-btn').addEventListener('click', () => {
  if (!lastResults) return;
  const csv = buildCSV(lastResults, lastFacies, lastLabels, currentToggles(), lastHasPorosity, lastHasPermeability, currentGrouping());
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'facies_zone_pivot.csv';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('copy-btn').addEventListener('click', async () => {
  if (!lastResults) return;
  const tsv = buildTSV(lastResults, lastFacies, lastLabels, currentToggles(), lastHasPorosity, lastHasPermeability, currentGrouping());
  try { await navigator.clipboard.writeText(tsv); setStatus('TSV copied to clipboard.', 'ok'); }
  catch (e) { setStatus('Copy failed: ' + e.message, 'error'); }
});

document.getElementById('sample-btn').addEventListener('click', () => {
  topsEl.value = sampleTops();
  facEl.value = sampleFacies();
  porEl.value = samplePorosity();
  // Pre-populate label state so the dynamic inputs show pre-filled values
  state.faciesLabels = new Map([
    ['1', 'Channel sand'],
    ['2', 'Crevasse splay'],
    ['3', 'Floodplain mud'],
  ]);
  state.zoneRenames.clear();
  Projects.saveDebounced();
  autoRefresh();   // detects codes/zones + computes + renders in one shot
  setStatus('Sample data loaded.', 'ok');
});

// Plot UI wiring
document.getElementById('plot-toggle-btn').addEventListener('click', () => {
  if (plotState.visible) hidePlotPanel(); else showPlotPanel();
});

// SHF panel wiring (visible only when por + perm + hafwl + sw all present)
document.getElementById('shf-toggle-btn').addEventListener('click', () => {
  if (shfState.visible) hideShfPanel(); else showShfPanel();
});
document.getElementById('shf-color').addEventListener('change', refreshShfPanel);
document.getElementById('shf-max').addEventListener('input', refreshShfPanel);
document.getElementById('shf-swirr').addEventListener('input', shfFitInputChanged);
document.getElementById('shf-he').addEventListener('input', shfFitInputChanged);
document.getElementById('shf-lambda').addEventListener('input', shfFitInputChanged);
document.getElementById('shf-fit-btn').addEventListener('click', shfAutoFit);
document.getElementById('shf-fit-clear-btn').addEventListener('click', shfClearFit);

// Inputs collapse bar
function _updateInputsToggleUI() {
  const area = document.getElementById('data-inputs-area');
  const btn = document.getElementById('inputs-toggle-btn');
  if (!area || !btn) return;
  const expanded = !area.classList.contains('collapsed');
  btn.setAttribute('aria-expanded', String(expanded));
  const lbl = btn.querySelector('.collapse-label');
  if (lbl) lbl.textContent = expanded ? 'Hide data inputs' : 'Show data inputs';
}
document.getElementById('inputs-toggle-btn').addEventListener('click', () => {
  document.getElementById('data-inputs-area').classList.toggle('collapsed');
  _updateInputsToggleUI();
});
document.getElementById('pt-hist').addEventListener('change', refreshPlotPanel);
document.getElementById('pt-cross').addEventListener('change', refreshPlotPanel);
document.getElementById('hist-var').addEventListener('change', refreshPlotPanel);
document.getElementById('hist-split').addEventListener('change', () => {
  // Show/hide layout selector based on whether a split is active
  const split = document.getElementById('hist-split').value;
  document.getElementById('hist-layout-row').style.display = split ? '' : 'none';
  refreshPlotPanel();
});
document.getElementById('hist-layout').addEventListener('change', refreshPlotPanel);
document.getElementById('hist-bins').addEventListener('input', refreshPlotPanel);
document.getElementById('cross-color').addEventListener('change', refreshPlotPanel);
document.getElementById('cross-shape').addEventListener('change', refreshPlotPanel);
document.getElementById('reg-add-btn').addEventListener('click', () => {
  // Add always creates a new regression from the current filters using the current
  // Order/Name input values. After adding, that new regression becomes active.
  // To draft a new one while another is active, just hit Add -- a new one is created.
  regAddFromCurrentFilters();
});
document.getElementById('reg-deselect-btn').addEventListener('click', regClearActive);
document.getElementById('reg-name').addEventListener('input', () => {
  // Live-rename the active regression as the user types.
  // When no regression is active, the input is just a draft for the next Add.
  if (regState.activeId !== null) {
    regRename(regState.activeId, document.getElementById('reg-name').value);
  }
});
document.getElementById('reg-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    // Enter on an empty draft (or on the active reg's name field) shouldn't
    // double-add the active regression. Only Add when there's no active selection.
    if (regState.activeId === null) regAddFromCurrentFilters();
  }
});
document.getElementById('reg-order').addEventListener('change', () => {
  // When a regression is active, changing the Order refits it in place using its
  // locked filter snapshot. When nothing is active, the dropdown is just a draft.
  if (regState.activeId !== null) {
    regChangeOrder(regState.activeId, document.getElementById('reg-order').value);
  }
});

// Self-test panel
document.getElementById('test-btn').addEventListener('click', () => {
  const tests = runSelfTests();
  const panel = document.getElementById('tests-panel');
  const list = document.getElementById('test-list');
  const summary = document.getElementById('test-summary');
  list.innerHTML = '';
  const passed = tests.filter(t => t.ok).length;
  const failed = tests.length - passed;
  summary.innerHTML = '(<b class="ok">' + passed + ' passed</b>'
    + (failed ? ', <b class="bad">' + failed + ' failed</b>' : '') + ')';
  for (const t of tests) {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (t.ok ? 'ok' : 'bad');
    badge.textContent = t.ok ? 'PASS' : 'FAIL';
    li.appendChild(badge);
    const body = document.createElement('div');
    body.innerHTML = '<div>' + t.name + '</div><div class="detail">' + t.detail + '</div>';
    li.appendChild(body);
    list.appendChild(li);
  }
  panel.style.display = '';
});

// Boot the projects layer: load (or migrate) the store, push the active
// project's data into the inputs, and wire up the project bar UI. autoRefresh
// then handles detection + render based on whatever data the active project
// already has. With an empty project it hides results and shows the
// self-test affordance.
Projects.init();
ProjectBar.init();
Projects.applyToUI();
autoRefresh();

// Last-chance flush on tab close so a pending debounce doesn't drop edits.
window.addEventListener('beforeunload', () => { try { Projects.saveNow(); } catch (e) {} });
