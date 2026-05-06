"use strict";

// ============================================================
// J-function editor — pills + sliders for Leverett J coefficients
// ============================================================
// Lives below the saturation-height plot. Each j-function is a separate
// equation entity stored in localStorage. The bar shows one pill per
// equation plus an "Add J-function" pill at the end.
//
// Interaction:
//   * Click a pill → it becomes the active equation AND the editor expands.
//   * Click the active+expanded pill again → editor collapses.
//   * Click anywhere outside the bar → editor collapses to pills.
//
// The editor exposes sliders for the four free coefficients (a, b, c, d),
// a "Show constants" toggle that reveals sliders for the locked physical
// constants (γ, γpc, ω, Δρ, g, fpc, κ, λ), an editable equation name, a
// trash button, and Save / Reset actions. Save commits the current draft
// to localStorage; Reset reverts the draft to the last saved values.

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

function initJfnPanel() {
  jfnState.list = _jfnLoadFromStorage();
  if (jfnState.activeId && !_jfnFind(jfnState.activeId)) jfnState.activeId = null;
  if (jfnState.expandedId && !_jfnFind(jfnState.expandedId)) {
    jfnState.expandedId = null;
    jfnState.draft = null;
  }
  renderJfnBar();
}

function _jfnAdd() {
  const j = {
    id: _jfnNewId(),
    name: 'J-function ' + (jfnState.list.length + 1),
    params: _jfnDefaultParams(),
  };
  jfnState.list.push(j);
  jfnState.activeId = j.id;
  jfnState.expandedId = j.id;
  jfnState.showConstants = false;
  jfnState.draft = { name: j.name, params: { ...j.params } };
  _jfnPersist();
  renderJfnBar();
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
}

function _jfnSaveDraft() {
  if (!jfnState.expandedId || !jfnState.draft) return;
  const j = _jfnFind(jfnState.expandedId);
  if (!j) return;
  j.name = (jfnState.draft.name || '').trim() || 'J-function';
  j.params = { ...jfnState.draft.params };
  _jfnPersist();
  renderJfnBar();
}

function _jfnResetDraft() {
  if (!jfnState.expandedId) return;
  const j = _jfnFind(jfnState.expandedId);
  if (!j) return;
  jfnState.draft = { name: j.name, params: { ...j.params } };
  renderJfnBar();
}

function _jfnSelect(id) {
  if (jfnState.activeId === id && jfnState.expandedId === id) {
    // Click on the active+expanded pill collapses the editor.
    jfnState.expandedId = null;
    jfnState.draft = null;
  } else {
    jfnState.activeId = id;
    jfnState.expandedId = id;
    const j = _jfnFind(id);
    jfnState.draft = j ? { name: j.name, params: { ...j.params } } : null;
    jfnState.showConstants = false;
  }
  renderJfnBar();
}

function _jfnCollapse() {
  if (!jfnState.expandedId) return;
  jfnState.expandedId = null;
  jfnState.draft = null;
  renderJfnBar();
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

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (isFinite(v)) {
      jfnState.draft.params[def.key] = v;
      num.value = slider.value;
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
