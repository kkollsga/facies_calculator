"use strict";

// ============================================================
// J-function editor — pills + sliders for Leverett J coefficients
// ============================================================
// Lives below the saturation-height plot. Each j-function is a separate
// equation entity stored in localStorage. The bar shows one pill per
// equation plus an "Add J-function" pill at the end.
//
// Interaction:
//   * Click an inactive pill → it becomes the active equation. The SHF plot
//     gains a 10-curve overlay (one curve per evenly log-spaced sqrt(k/φ)
//     value taken from the data range).
//   * Click the active pill → editor expands. Click it again → collapses.
//   * Click anywhere outside the bar → editor collapses (but the equation
//     stays active so its curves remain on the plot).
//
// While the editor is open, dragging coefficient sliders updates the plot
// live. Save commits the current draft to localStorage; Reset reverts the
// draft to the last saved values; collapsing without saving discards the
// draft (the plot snaps back to the saved curve).

const JFN_STORAGE_KEY = 'fzp_jfunctions_v1';

// Defaults sourced from the Leverett spec. `constant: true` means the
// parameter is a physical constant — hidden behind the toggle by default.
const JFN_PARAM_DEFS = [
  { key: 'a',        value:  0.22434,    min:  0,    max: 0.5,  step: 0.001, label: 'a',   desc: 'Sw(J) prefactor' },
  { key: 'b',        value: -0.82188,    min: -2,    max: 0,    step: 0.001, label: 'b',   desc: 'Sw(J) exponent' },
  { key: 'c',        value:  0.33714,    min:  0,    max: 1,    step: 0.001, label: 'c',   desc: 'Swirr (RQI) prefactor' },
  { key: 'd',        value: -1.05865,    min: -2,    max: 0,    step: 0.001, label: 'd',   desc: 'Swirr (RQI) exponent' },
  { key: 'gamma',    value:  30,         min: 10,    max: 50,   step: 0.1,   label: 'γ',   desc: 'Interfacial tension for J [dyn/cm]', constant: true },
  { key: 'gammapc',  value:  22,         min: 10,    max: 50,   step: 0.1,   label: 'γpc', desc: 'Interfacial tension for Pc [dyn/cm]', constant: true },
  { key: 'omega',    value:  30,         min:  0,    max: 90,   step: 0.5,   label: 'ω',   desc: 'Contact angle [°]', constant: true },
  { key: 'deltarho', value:  266,        min: 100,   max: 500,  step: 1,     label: 'Δρ',  desc: 'Brine–oil density Δ [kg/m³]', constant: true },
  { key: 'g',        value:  9.81,       min: 9.80,  max: 9.82, step: 0.001, label: 'g',   desc: 'Gravity [m/s²]', constant: true },
  { key: 'fpc',      value:  3.141533543, min: 2,    max: 4,    step: 0.001, label: 'fpc', desc: 'Pc unit factor', constant: true },
  { key: 'kappa',    value:  0.2166,     min: 0.1,   max: 0.5,  step: 0.001, label: 'κ',   desc: 'J unit factor', constant: true },
  { key: 'lambda',   value:  0.0314,     min: 0.01,  max: 0.10, step: 0.001, label: 'λ',   desc: 'RQI scale factor', constant: true },
];

const jfnState = {
  list: [],            // [{ id, name, params: {<key>: number} }]
  activeId: null,
  expandedId: null,
  showConstants: false,
  draft: null,         // { name, params } — working copy of the expanded equation
};

function _jfnDefaultParams() {
  const p = {};
  for (const def of JFN_PARAM_DEFS) p[def.key] = def.value;
  return p;
}

function _jfnNewId() {
  return 'j_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function _jfnFind(id) { return jfnState.list.find(j => j.id === id); }

function _jfnLoadFromStorage() {
  try {
    const raw = localStorage.getItem(JFN_STORAGE_KEY);
    if (!raw) return [];
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj)) return [];
    return obj.filter(j => j && typeof j === 'object').map(j => ({
      id: j.id || _jfnNewId(),
      name: typeof j.name === 'string' ? j.name : 'J-function',
      // Merge defaults so older saves get any newly-added params filled in.
      params: { ..._jfnDefaultParams(), ...(j.params || {}) },
    }));
  } catch (e) { return []; }
}

function _jfnPersist() {
  try {
    localStorage.setItem(JFN_STORAGE_KEY, JSON.stringify(jfnState.list));
  } catch (e) { /* storage full / disabled — fail silently */ }
}

// All state mutations route through this so the SHF plot's curve overlay
// stays in lockstep with the active/draft params. refreshShfPanel is a
// no-op when the SHF panel is hidden.
function _jfnRefreshPlot() {
  if (typeof refreshShfPanel === 'function') refreshShfPanel();
}

function initJfnPanel() {
  jfnState.list = _jfnLoadFromStorage();
  if (jfnState.activeId && !_jfnFind(jfnState.activeId)) jfnState.activeId = null;
  if (jfnState.expandedId && !_jfnFind(jfnState.expandedId)) {
    jfnState.expandedId = null;
    jfnState.draft = null;
  }
  renderJfnBar();
  _jfnRefreshPlot();
}

function _jfnAdd() {
  const j = {
    id: _jfnNewId(),
    name: 'J-function ' + (jfnState.list.length + 1),
    params: _jfnDefaultParams(),
  };
  jfnState.list.push(j);
  // New equations land active AND expanded — the user just hit Add,
  // they want to start tweaking immediately.
  jfnState.activeId = j.id;
  jfnState.expandedId = j.id;
  jfnState.showConstants = false;
  jfnState.draft = { name: j.name, params: { ...j.params } };
  _jfnPersist();
  renderJfnBar();
  _jfnRefreshPlot();
}

function _jfnDelete(id) {
  const idx = jfnState.list.findIndex(j => j.id === id);
  if (idx < 0) return;
  jfnState.list.splice(idx, 1);
  if (jfnState.activeId === id) jfnState.activeId = null;
  if (jfnState.expandedId === id) {
    jfnState.expandedId = null;
    jfnState.draft = null;
  }
  _jfnPersist();
  renderJfnBar();
  _jfnRefreshPlot();
}

function _jfnSaveDraft() {
  if (!jfnState.expandedId || !jfnState.draft) return;
  const j = _jfnFind(jfnState.expandedId);
  if (!j) return;
  j.name = (jfnState.draft.name || '').trim() || 'J-function';
  j.params = { ...jfnState.draft.params };
  _jfnPersist();
  renderJfnBar();
  // Plot was already showing the draft, so this is a no-op visually,
  // but kept for symmetry with the other mutators.
  _jfnRefreshPlot();
}

function _jfnResetDraft() {
  if (!jfnState.expandedId) return;
  const j = _jfnFind(jfnState.expandedId);
  if (!j) return;
  jfnState.draft = { name: j.name, params: { ...j.params } };
  renderJfnBar();
  _jfnRefreshPlot();
}

// Pill click is a two-stage interaction:
//   1) Click an inactive pill → activate (curves appear on the plot).
//   2) Click the active pill → toggle the editor open/closed.
// Activating a different pill while another is expanded drops the editor.
function _jfnSelect(id) {
  if (jfnState.activeId !== id) {
    jfnState.activeId = id;
    jfnState.expandedId = null;
    jfnState.draft = null;
  } else if (jfnState.expandedId === id) {
    // active + expanded → collapse
    jfnState.expandedId = null;
    jfnState.draft = null;
  } else {
    // active + collapsed → expand
    jfnState.expandedId = id;
    const j = _jfnFind(id);
    jfnState.draft = j ? { name: j.name, params: { ...j.params } } : null;
    jfnState.showConstants = false;
  }
  renderJfnBar();
  _jfnRefreshPlot();
}

function _jfnCollapse() {
  if (!jfnState.expandedId) return;
  jfnState.expandedId = null;
  jfnState.draft = null;
  renderJfnBar();
  // Plot was tracking the draft; on collapse it reverts to saved params.
  _jfnRefreshPlot();
}

function renderJfnBar() {
  const bar = document.getElementById('jfn-bar');
  if (!bar) return;
  bar.innerHTML = '';

  const pillRow = document.createElement('div');
  pillRow.className = 'jfn-pill-row';
  bar.appendChild(pillRow);

  for (const j of jfnState.list) {
    const isActive = j.id === jfnState.activeId;
    const pill = document.createElement('div');
    pill.className = 'jfn-pill' + (isActive ? ' active' : '');
    pill.dataset.id = j.id;
    pill.textContent = j.name;
    pill.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _jfnSelect(j.id);
    });
    pillRow.appendChild(pill);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'jfn-pill jfn-add-btn';
  addBtn.textContent = '+ Add J-function';
  addBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _jfnAdd();
  });
  pillRow.appendChild(addBtn);

  if (jfnState.expandedId) {
    const editor = _renderJfnEditor();
    if (editor) bar.appendChild(editor);
  }
}

function _renderJfnEditor() {
  if (!jfnState.expandedId || !jfnState.draft) return null;
  const j = _jfnFind(jfnState.expandedId);
  if (!j) return null;

  const card = document.createElement('div');
  card.className = 'jfn-card';
  card.dataset.id = j.id;
  // Stop bubble so the document-level outside-click listener treats clicks
  // anywhere inside the card as "inside" — even on inputs that don't
  // contain() the bar (none here, but keeps the rule simple).
  card.addEventListener('click', (ev) => ev.stopPropagation());

  // Header: editable name + trash
  const head = document.createElement('div');
  head.className = 'jfn-card-head';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'jfn-name-input';
  nameInput.value = jfnState.draft.name;
  nameInput.placeholder = 'Equation name';
  nameInput.spellcheck = false;
  nameInput.addEventListener('input', () => {
    jfnState.draft.name = nameInput.value;
  });
  head.appendChild(nameInput);

  const trash = document.createElement('button');
  trash.type = 'button';
  trash.className = 'jfn-icon-btn jfn-trash-btn';
  trash.title = 'Delete equation';
  trash.setAttribute('aria-label', 'Delete equation');
  trash.textContent = '🗑';
  trash.addEventListener('click', () => _jfnDelete(j.id));
  head.appendChild(trash);

  card.appendChild(head);

  // Coefficient sliders (a, b, c, d)
  card.appendChild(_buildJfnSliderBlock(
    'Coefficients',
    JFN_PARAM_DEFS.filter(d => !d.constant),
  ));

  // Constants toggle
  const togRow = document.createElement('label');
  togRow.className = 'tog jfn-toggle-row';
  const togInput = document.createElement('input');
  togInput.type = 'checkbox';
  togInput.checked = jfnState.showConstants;
  togInput.addEventListener('change', () => {
    jfnState.showConstants = togInput.checked;
    renderJfnBar();
  });
  togRow.appendChild(togInput);
  const togBox = document.createElement('span');
  togBox.className = 'tog-box';
  togRow.appendChild(togBox);
  togRow.appendChild(document.createTextNode('Show constants'));
  card.appendChild(togRow);

  if (jfnState.showConstants) {
    card.appendChild(_buildJfnSliderBlock(
      'Constants',
      JFN_PARAM_DEFS.filter(d => d.constant),
    ));
  }

  // Save / Reset
  const actions = document.createElement('div');
  actions.className = 'jfn-card-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'jfn-action-btn jfn-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', _jfnSaveDraft);
  actions.appendChild(saveBtn);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'jfn-action-btn jfn-reset-btn';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', _jfnResetDraft);
  actions.appendChild(resetBtn);

  card.appendChild(actions);

  return card;
}

function _buildJfnSliderBlock(title, defs) {
  const block = document.createElement('div');
  block.className = 'jfn-slider-block';

  const head = document.createElement('div');
  head.className = 'jfn-block-head';
  head.textContent = title;
  block.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'jfn-slider-grid';
  for (const def of defs) grid.appendChild(_buildJfnSlider(def));
  block.appendChild(grid);
  return block;
}

function _buildJfnSlider(def) {
  const row = document.createElement('div');
  row.className = 'jfn-slider-row';
  if (def.desc) row.title = def.label + ' — ' + def.desc;

  const lbl = document.createElement('span');
  lbl.className = 'jfn-slider-lbl';
  lbl.textContent = def.label;
  row.appendChild(lbl);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'jfn-slider';
  slider.min = String(def.min);
  slider.max = String(def.max);
  slider.step = String(def.step);
  slider.value = String(jfnState.draft.params[def.key]);

  const num = document.createElement('input');
  num.type = 'number';
  num.className = 'jfn-num';
  num.min = String(def.min);
  num.max = String(def.max);
  num.step = String(def.step);
  num.value = String(jfnState.draft.params[def.key]);

  // Slider 'input' fires continuously during drag. We update the draft and
  // refresh the plot — but deliberately do NOT call renderJfnBar(), since
  // that would replace the slider element mid-drag and kill the gesture.
  // refreshShfPanel rAF-coalesces, so spamming it is fine.
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (isFinite(v)) {
      jfnState.draft.params[def.key] = v;
      num.value = slider.value;
      _jfnRefreshPlot();
    }
  });
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!isFinite(v)) return;
    jfnState.draft.params[def.key] = v;
    // Only nudge the slider while the typed value stays within the slider's
    // declared range — out-of-range numeric entry is allowed but won't move
    // the thumb past its stops.
    if (v >= def.min && v <= def.max) slider.value = String(v);
    _jfnRefreshPlot();
  });

  row.appendChild(slider);
  row.appendChild(num);
  return row;
}

// Click anywhere outside the j-function bar collapses an expanded editor.
// Pill / card click handlers stopPropagation so this only fires on true
// outside clicks.
document.addEventListener('click', (ev) => {
  if (!jfnState.expandedId) return;
  const bar = document.getElementById('jfn-bar');
  if (!bar) return;
  if (bar.contains(ev.target)) return;
  _jfnCollapse();
});

// ============================================================
// Leverett J-function math + SHF curve overlay
// ============================================================
// Forward chain (RQI variant of the spec):
//   RQI   = λ · sqrt(k/φ)
//   Swirr = c · RQI^d
//   Pc    = fpc · (10⁻³ · Δρ · g · h) / γpc
//   J     = κ · ( Pc / (γ · cos ω) ) · sqrt(k/φ)
//   Sw    = Swirr + (1 − Swirr) · a · J^b   (clamped to [0,1])
// Everything past RQI depends only on the ratio sqrt(k/φ), so curves are
// parameterized by 10 log-spaced ratio values from the data range.

function jfnComputeSw(params, hafwl, ratio) {
  const RQI = params.lambda * ratio;
  let Swirr = params.c * Math.pow(RQI, params.d);
  if (!isFinite(Swirr)) Swirr = 0;
  Swirr = Math.max(0, Math.min(1, Swirr));
  const Pc = params.fpc * (1e-3 * params.deltarho * params.g * hafwl) / params.gammapc;
  const cosOmega = Math.cos(params.omega * Math.PI / 180);
  const J = params.kappa * (Pc / (params.gamma * cosOmega)) * ratio;
  // Math.pow(0, b<0) = Infinity, which clamps cleanly to 1 (full water at FWL).
  // Math.pow(neg, fractional) = NaN → caller's segment splitter drops these.
  const Sw = Swirr + (1 - Swirr) * params.a * Math.pow(J, params.b);
  if (!isFinite(Sw)) return Sw;
  return Math.max(0, Math.min(1, Sw));
}

// Returns the params currently driving the plot. While the editor is open
// for the active equation, that's the unsaved draft (so slider drags are
// reflected live); otherwise it's the persisted params.
function _jfnPlotParams() {
  if (!jfnState.activeId) return null;
  if (jfnState.expandedId === jfnState.activeId && jfnState.draft) {
    return jfnState.draft.params;
  }
  const j = _jfnFind(jfnState.activeId);
  return j ? j.params : null;
}

// Called from shf.js _renderShfPlot. ctx supplies the SVG, scales, plot
// bounds, and the current point set so we can pick a representative
// sqrt(k/φ) range. No-op when nothing is active.
function jfnRenderCurves(ctx) {
  const params = _jfnPlotParams();
  if (!params) return;
  const { svg, xScale, yScale, xLo, xHi, yLo, yHi, points } = ctx;

  // Pick the ratio range from the data so curves bracket the observed
  // points. Fall back to a generic span when there's nothing to anchor to.
  const ratios = [];
  for (const p of points) {
    const r = Math.sqrt(p.perm / p.por);
    if (isFinite(r) && r > 0) ratios.push(r);
  }
  let ratLo, ratHi;
  if (ratios.length >= 2) {
    ratLo = Math.min.apply(null, ratios);
    ratHi = Math.max.apply(null, ratios);
  } else {
    ratLo = 1; ratHi = 100;
  }
  if (!isFinite(ratLo) || ratLo <= 0) ratLo = 1;
  if (!isFinite(ratHi) || ratHi <= ratLo) ratHi = ratLo * 100;

  // Number of curves comes from the SHF plot-options control. Defaults to
  // 10 when missing or invalid; capped at the input's max so a stray edit
  // can't flood the SVG.
  const countEl = document.getElementById('shf-jfn-count');
  let N_CURVES = countEl ? parseInt(countEl.value, 10) : 10;
  if (!isFinite(N_CURVES) || N_CURVES < 1) N_CURVES = 10;
  if (N_CURVES > 50) N_CURVES = 50;
  const N_SAMPLES = 120;
  const h0 = Math.max(yLo, 0);   // J is defined only above FWL
  const h1 = yHi;
  if (h1 <= h0) return;

  const logLo = Math.log(ratLo);
  const logHi = Math.log(ratHi);

  for (let k = 0; k < N_CURVES; k++) {
    const t = N_CURVES === 1 ? 0.5 : k / (N_CURVES - 1);
    const ratio = Math.exp(logLo + t * (logHi - logLo));

    // Sample HAFWL across the visible y-range, splitting into segments
    // whenever Sw leaves the visible x-range or evaluates to NaN.
    const segments = [];
    let cur = [];
    for (let i = 0; i <= N_SAMPLES; i++) {
      const h = h0 + (h1 - h0) * i / N_SAMPLES;
      const sw = jfnComputeSw(params, h, ratio);
      if (!isFinite(sw) || sw < xLo || sw > xHi) {
        if (cur.length >= 2) segments.push(cur);
        cur = [];
        continue;
      }
      cur.push([xScale(sw), yScale(h)]);
    }
    if (cur.length >= 2) segments.push(cur);
    if (segments.length === 0) continue;

    const color = (typeof _rainbowColor === 'function') ? _rainbowColor(t) : '#3a3528';
    for (const seg of segments) {
      const d = 'M ' + seg.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L ');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '1.6');
      path.setAttribute('stroke-opacity', '0.85');
      svg.appendChild(path);
    }
  }
}
