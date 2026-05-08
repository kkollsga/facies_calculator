"use strict";

// ============================================================
// Projects: per-project storage of inputs, labels, and zone renames
// ============================================================
// Storage shape (key: PROJECTS_STORAGE_KEY):
//   {
//     active: <id>,
//     projects: {
//       <id>: { id, name, tops, facies, por, faciesLabels: {code:label}, zoneRenames: {old:new} }
//     }
//   }
//
// Migration: on first load, if there's no projects object but the legacy
// LABELS_STORAGE_KEY ("fzp_labels_v1") exists, we seed a Default project from
// its Facies map so existing users don't lose their labels.

const PROJECTS_STORAGE_KEY = 'fzp_projects_v1';

// Regressions hold Set instances (filter snapshots) that JSON drops, so
// round-trip through arrays. The shape matches what regression.js builds in
// regAddFromCurrentFilters, plus a per-regression `visible` flag.
function _serializeRegression(r) {
  return {
    id: r.id,
    name: r.name,
    degree: r.degree,
    color: r.color,
    coeffs: Array.isArray(r.coeffs) ? r.coeffs.slice() : [],
    r2: r.r2,
    n: r.n,
    range: r.range ? { phiLo: r.range.phiLo, phiHi: r.range.phiHi } : { phiLo: 0, phiHi: 0 },
    visible: r.visible !== false,
    filters: {
      wells:  r.filters && r.filters.wells  ? [...r.filters.wells]  : [],
      zones:  r.filters && r.filters.zones  ? [...r.filters.zones]  : [],
      facies: r.filters && r.filters.facies ? [...r.filters.facies] : [],
    },
  };
}
function _deserializeRegression(o) {
  return {
    id: o.id,
    name: o.name || ('Reg ' + o.id),
    degree: o.degree | 0,
    color: o.color,
    coeffs: Array.isArray(o.coeffs) ? o.coeffs.slice() : [],
    r2: typeof o.r2 === 'number' ? o.r2 : 0,
    n: o.n | 0,
    range: { phiLo: o.range && o.range.phiLo, phiHi: o.range && o.range.phiHi },
    visible: o.visible !== false,
    filters: {
      wells:  new Set((o.filters && o.filters.wells)  || []),
      zones:  new Set((o.filters && o.filters.zones)  || []),
      facies: new Set((o.filters && o.filters.facies) || []),
    },
  };
}

const Projects = {
  store: null,
  _saveTimer: null,

  init() {
    this.store = this._load();
    // Defensive: ensure we always have at least one project and a valid active id
    if (!this.store || !this.store.projects || Object.keys(this.store.projects).length === 0) {
      const id = this._newId();
      this.store = { active: id, projects: { [id]: this._blankProject(id, 'Default') } };
    } else if (!this.store.active || !this.store.projects[this.store.active]) {
      this.store.active = Object.keys(this.store.projects)[0];
    }
    this._save();
  },

  active() {
    return this.store && this.store.projects[this.store.active] || null;
  },

  list() {
    // Return projects in insertion order (Object.values preserves it for string keys)
    return Object.values(this.store.projects);
  },

  setActive(id) {
    if (!this.store.projects[id]) return;
    this.store.active = id;
    this._save();
  },

  create(name) {
    const id = this._newId();
    this.store.projects[id] = this._blankProject(id, name || 'New project');
    this.store.active = id;
    this._save();
    return this.store.projects[id];
  },

  rename(id, name) {
    if (!this.store.projects[id]) return;
    this.store.projects[id].name = (name || '').trim() || 'Untitled';
    this._save();
  },

  delete(id) {
    if (!this.store.projects[id]) return;
    delete this.store.projects[id];
    if (this.store.active === id) {
      const remaining = Object.keys(this.store.projects);
      if (remaining.length > 0) {
        this.store.active = remaining[0];
      } else {
        // Always keep at least one project so the rest of the app has a target
        const fresh = this._newId();
        this.store.projects[fresh] = this._blankProject(fresh, 'Default');
        this.store.active = fresh;
      }
    }
    this._save();
  },

  // Pull current UI/state into the active project record (no save).
  // Used right before switching projects so nothing pending is lost.
  pullFromUI() {
    const p = this.active();
    if (!p) return;
    p.tops = topsEl.value;
    p.facies = facEl.value;
    p.por = porEl.value;
    p.faciesLabels = Object.fromEntries(state.faciesLabels);
    p.zoneRenames = Object.fromEntries(state.zoneRenames);
    p.fwlValues = Object.fromEntries(state.fwlValues);
    p.regressions = regState.list.map(_serializeRegression);
    p.regActiveId = regState.activeId;
    p.regNextId = regState.nextId;
    // Pivot table toggles. porosity/permeabilityTouched track whether the
    // user has explicitly flipped those toggles, so the auto-on-when-data-
    // returns logic in autoRefresh respects the user's last choice.
    const togPorEl  = document.getElementById('t-porosity');
    const togPermEl = document.getElementById('t-perm');
    p.pivotPanel = {
      byWell:        document.getElementById('g-well').checked,
      byZone:        document.getElementById('g-zone').checked,
      byFacies:      document.getElementById('g-facies').checked,
      thicknesses:   document.getElementById('t-thickness').checked,
      fractions:     document.getElementById('t-fraction').checked,
      porosity:      togPorEl  ? togPorEl.checked  : true,
      permeability:  togPermEl ? togPermEl.checked : true,
      porosityTouched:     !!(togPorEl  && togPorEl.dataset.userTouched),
      permeabilityTouched: !!(togPermEl && togPermEl.dataset.userTouched),
    };
    // Cross-plot panel state: visibility + filter chip selections + the
    // last-detected categories so reconcile (in initPlotPanel) preserves
    // user exclusions across page refreshes.
    p.plotPanel = {
      visible: !!plotState.visible,
      type: plotState.type || 'hist',
      filters: {
        wells:  [...plotState.filters.wells],
        zones:  [...plotState.filters.zones],
        facies: [...plotState.filters.facies],
      },
      prevDetected: {
        wells:  (_plotPrevDetected.wells  || []).slice(),
        zones:  (_plotPrevDetected.zones  || []).slice(),
        facies: (_plotPrevDetected.facies || []).slice(),
      },
    };
    p.shfPanel = {
      visible: !!shfState.visible,
      filters: {
        wells:  [...shfState.filters.wells],
        zones:  [...shfState.filters.zones],
        facies: [...shfState.filters.facies],
      },
      prevDetected: {
        wells:  (_shfPrevDetected.wells  || []).slice(),
        zones:  (_shfPrevDetected.zones  || []).slice(),
        facies: (_shfPrevDetected.facies || []).slice(),
      },
      lineCount: shfState.lineCount | 0,
      constantsExpanded: !!shfState.constantsExpanded,
      constantsLocked: shfState.constantsLocked !== false,
      equationsExpanded: !!shfState.equationsExpanded,
      // Max HAFWL: empty means auto (shallowest data point); otherwise
      // a positive number override.
      maxHafwl: (() => {
        const el = document.getElementById('shf-max-hafwl');
        if (!el) return null;
        const v = Number(el.value);
        return (el.value === '' || !Number.isFinite(v) || v <= 0) ? null : v;
      })(),
      activeFunctionId: shfState.activeFunctionId,
      nextFunctionId: shfState.nextFunctionId,
      // SHF function list. Filters are Sets so round-trip via arrays.
      // Quality stats (r2, n) are derived — recomputed on load — so we
      // skip persisting them.
      functions: (shfState.functions || []).map(fn => ({
        id: fn.id, name: fn.name, color: fn.color,
        visible: fn.visible !== false,
        locked: !!fn.locked,
        method: fn.method === 'perm' ? 'perm' : 'rqi',
        params: Object.assign({}, fn.params),
        filters: {
          wells:  fn.filters && fn.filters.wells  ? [...fn.filters.wells]  : [],
          zones:  fn.filters && fn.filters.zones  ? [...fn.filters.zones]  : [],
          facies: fn.filters && fn.filters.facies ? [...fn.filters.facies] : [],
        },
      })),
    };
  },

  // Push the active project's data into the UI/state. Caller is responsible
  // for resetting derived UI (results section, plot, etc.). regState is
  // owned by this method now: don't wipe it elsewhere or saved regressions
  // get clobbered after they're loaded.
  applyToUI() {
    const p = this.active();
    if (!p) return;
    topsEl.value = p.tops || '';
    facEl.value = p.facies || '';
    porEl.value = p.por || '';
    state.faciesLabels = new Map(Object.entries(p.faciesLabels || {}));
    state.zoneRenames = new Map(Object.entries(p.zoneRenames || {}));
    // FWL values were stored as plain {well: number}; rebuild a Map preserving
    // numeric values (Object.entries returns string keys, but values stay typed).
    state.fwlValues = new Map();
    for (const [w, v] of Object.entries(p.fwlValues || {})) {
      const n = Number(v);
      if (Number.isFinite(n)) state.fwlValues.set(w, n);
    }
    regState.list = (p.regressions || []).map(_deserializeRegression);
    regState.activeId = (p.regActiveId != null) ? p.regActiveId : null;
    regState.nextId = p.regNextId || 1;

    // Pivot panel toggles. Missing fields fall back to the same defaults
    // _afterProjectSwitch used to set explicitly.
    const piv = p.pivotPanel || {};
    function applyToggle(id, key, def) {
      const el = document.getElementById(id); if (!el) return;
      el.checked = (piv[key] !== undefined) ? !!piv[key] : def;
    }
    applyToggle('g-well',      'byWell',       true);
    applyToggle('g-zone',      'byZone',       true);
    applyToggle('g-facies',    'byFacies',     false);
    applyToggle('t-thickness', 'thicknesses',  true);
    applyToggle('t-fraction',  'fractions',    false);
    applyToggle('t-porosity',  'porosity',     true);
    applyToggle('t-perm',      'permeability', true);
    const togPorEl  = document.getElementById('t-porosity');
    const togPermEl = document.getElementById('t-perm');
    if (togPorEl) {
      if (piv.porosityTouched) togPorEl.dataset.userTouched = '1';
      else delete togPorEl.dataset.userTouched;
    }
    if (togPermEl) {
      if (piv.permeabilityTouched) togPermEl.dataset.userTouched = '1';
      else delete togPermEl.dataset.userTouched;
    }

    // Cross-plot panel state. Filter chips are restored as Sets; prevDetected
    // tracks the categories present last time so initPlotPanel's reconcile
    // can preserve exclusions across reloads.
    const pp = p.plotPanel || {};
    plotState.visible = !!pp.visible;
    plotState.type = pp.type === 'cross' ? 'cross' : 'hist';
    plotState.filters.wells  = new Set((pp.filters && pp.filters.wells)  || []);
    plotState.filters.zones  = new Set((pp.filters && pp.filters.zones)  || []);
    plotState.filters.facies = new Set((pp.filters && pp.filters.facies) || []);
    _plotPrevDetected = {
      wells:  ((pp.prevDetected && pp.prevDetected.wells)  || []).slice(),
      zones:  ((pp.prevDetected && pp.prevDetected.zones)  || []).slice(),
      facies: ((pp.prevDetected && pp.prevDetected.facies) || []).slice(),
    };
    // Force the next initPlotPanel to actually run reconcile against the
    // restored prevDetected (otherwise smart-skip would skip on session 1).
    _plotCategoryFp = null;

    const sp = p.shfPanel || {};
    shfState.visible = !!sp.visible;
    shfState.filters.wells  = new Set((sp.filters && sp.filters.wells)  || []);
    shfState.filters.zones  = new Set((sp.filters && sp.filters.zones)  || []);
    shfState.filters.facies = new Set((sp.filters && sp.filters.facies) || []);
    _shfPrevDetected = {
      wells:  ((sp.prevDetected && sp.prevDetected.wells)  || []).slice(),
      zones:  ((sp.prevDetected && sp.prevDetected.zones)  || []).slice(),
      facies: ((sp.prevDetected && sp.prevDetected.facies) || []).slice(),
    };
    _shfCategoryFp = null;
    shfState.lineCount = Math.max(1, Math.min(40, parseInt(sp.lineCount) || 10));
    shfState.constantsExpanded = !!sp.constantsExpanded;
    shfState.constantsLocked = sp.constantsLocked !== false;
    shfState.equationsExpanded = !!sp.equationsExpanded;
    shfState.activeFunctionId = (sp.activeFunctionId != null) ? sp.activeFunctionId : null;
    shfState.nextFunctionId = parseInt(sp.nextFunctionId) || 1;
    shfState.functions = (Array.isArray(sp.functions) ? sp.functions : []).map(o => ({
      id: o.id,
      name: o.name || ('Function ' + o.id),
      color: o.color || '#c0392b',
      visible: o.visible !== false,
      locked: !!o.locked,
      method: o.method === 'perm' ? 'perm' : 'rqi',
      // Merge with defaults so a save from an older session that didn't
      // include some constants doesn't surface NaN through the chain.
      params: Object.assign({}, SHF_DEFAULT_PARAMS, o.params || {}),
      filters: {
        wells:  new Set((o.filters && o.filters.wells)  || []),
        zones:  new Set((o.filters && o.filters.zones)  || []),
        facies: new Set((o.filters && o.filters.facies) || []),
      },
      r2: null, n: 0,
    }));
    // Sync DOM controls that aren't reactive to state.
    const linesEl = document.getElementById('shf-lines');
    if (linesEl) linesEl.value = String(shfState.lineCount);
    const maxHafwlEl = document.getElementById('shf-max-hafwl');
    if (maxHafwlEl) {
      const v = Number(sp.maxHafwl);
      maxHafwlEl.value = (Number.isFinite(v) && v > 0) ? String(v) : '';
    }
  },

  // Debounced persist: pulls UI state and writes to localStorage.
  // Used by every "data changed" listener so typing fast doesn't thrash storage.
  saveDebounced() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.pullFromUI();
      this._save();
    }, 250);
  },

  // Synchronous persist (no debounce). Used right before project switches /
  // window unload paths so we never drop pending edits.
  saveNow() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.pullFromUI();
    this._save();
  },

  // ---- internals ----
  _load() {
    let store = null;
    try {
      const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
      if (raw) store = JSON.parse(raw);
    } catch (e) { store = null; }
    if (!store || typeof store !== 'object' || !store.projects || typeof store.projects !== 'object') {
      store = this._migrateFromLegacy();
    }
    return store;
  },
  _save() {
    try {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(this.store));
    } catch (e) {
      // Storage quota exceeded or storage disabled: swallow. The app keeps
      // running with in-memory state; persistence resumes on the next save
      // attempt if the user frees space.
    }
  },
  _migrateFromLegacy() {
    let legacyLabels = {};
    try {
      const raw = localStorage.getItem(LABELS_STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.Facies && typeof obj.Facies === 'object') legacyLabels = obj.Facies;
      }
    } catch (e) { /* ignore */ }
    const id = this._newId();
    return {
      active: id,
      projects: { [id]: this._blankProject(id, 'Default', legacyLabels) },
    };
  },
  _blankProject(id, name, faciesLabels) {
    return {
      id, name,
      tops: '', facies: '', por: '',
      faciesLabels: faciesLabels || {},
      zoneRenames: {},
      fwlValues: {},
      regressions: [],
      regActiveId: null,
      regNextId: 1,
      pivotPanel: {
        byWell: true, byZone: true, byFacies: false,
        thicknesses: true, fractions: false,
        porosity: true, permeability: true,
        porosityTouched: false, permeabilityTouched: false,
      },
    };
  },
  _newId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  },
};

// ============================================================
// Project bar UI: horizontal pills, hover-revealed actions, inline rename
// ============================================================
// One pill per project, the active one highlighted. Hover the active pill to
// reveal pen (rename) and trash (delete) icons. Pen swaps the pill into an
// inline-edit state with ✓/✗ buttons; trash slides out a confirmation strip.
// The "+ New project" pill is always last in the list.

const ProjectBar = {
  els: null,
  _editing: false,   // true while the active pill is in inline-rename mode

  init() {
    this.els = {
      bar: document.getElementById('project-bar'),
      deleteConfirm: document.getElementById('project-delete-confirm'),
      deleteConfirmName: document.getElementById('project-delete-confirm-name'),
      deleteOk: document.getElementById('project-delete-ok-btn'),
      deleteCancel: document.getElementById('project-delete-cancel-btn'),
    };
    this.els.deleteCancel.addEventListener('click', () => this._hideDeleteConfirm());
    this.els.deleteOk.addEventListener('click', () => this._handleDeleteConfirmed());
    this.render();
  },

  render() {
    const bar = this.els.bar;
    bar.innerHTML = '';
    const activeId = Projects.store && Projects.store.active;
    for (const p of Projects.list()) {
      bar.appendChild(this._buildPill(p, p.id === activeId));
    }
    bar.appendChild(this._buildAddPill());
  },

  _buildPill(p, isActive) {
    const pill = document.createElement('div');
    pill.className = 'project-pill'
      + (isActive ? ' active' : '')
      + (isActive && this._editing ? ' editing' : '');
    pill.dataset.id = p.id;

    const name = document.createElement('span');
    name.className = 'project-pill-name';
    name.textContent = p.name;
    pill.appendChild(name);

    if (isActive) {
      // Pen + trash + edit-mode controls live on the active pill only.
      const pen = this._iconBtn('proj-pen', '✎', 'Rename project',
        (ev) => { ev.stopPropagation(); this._enterEditMode(); });
      pill.appendChild(pen);

      const trash = this._iconBtn('proj-trash', '🗑', 'Delete project',
        (ev) => { ev.stopPropagation(); this._showDeleteConfirm(); });
      pill.appendChild(trash);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'project-pill-input';
      input.value = p.name;
      input.spellcheck = false;
      input.addEventListener('click', (ev) => ev.stopPropagation());
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); this._exitEditMode(true, input.value); }
        else if (ev.key === 'Escape') { ev.preventDefault(); this._exitEditMode(false); }
      });
      pill.appendChild(input);

      pill.appendChild(this._iconBtn('proj-confirm', '✓', 'Save name',
        (ev) => { ev.stopPropagation(); this._exitEditMode(true, input.value); }));
      pill.appendChild(this._iconBtn('proj-cancel', '✗', 'Cancel',
        (ev) => { ev.stopPropagation(); this._exitEditMode(false); }));

      if (this._editing) {
        // Element will be in the DOM by next animation frame.
        const focus = () => { input.focus(); input.select(); };
        if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(focus);
        else setTimeout(focus, 0);
      }
    } else {
      // Click an inactive pill to switch to it.
      pill.addEventListener('click', () => this._switchTo(p.id));
    }

    return pill;
  },

  _buildAddPill() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'project-pill project-pill-add';
    btn.textContent = '+ New project';
    btn.title = 'Create a new project';
    btn.addEventListener('click', () => this._handleNew());
    return btn;
  },

  _iconBtn(cls, glyph, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'proj-icon ' + cls;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.textContent = glyph;
    b.addEventListener('click', onClick);
    return b;
  },

  _switchTo(id) {
    Projects.saveNow();
    Projects.setActive(id);
    Projects.applyToUI();
    this._editing = false;
    this._hideDeleteConfirm();
    this._afterProjectSwitch();
    this.render();
  },

  _handleNew() {
    Projects.saveNow();
    Projects.create('New project');
    Projects.applyToUI();
    this._editing = true;       // drop straight into rename mode
    this._hideDeleteConfirm();
    this._afterProjectSwitch();
    this.render();
  },

  _handleDeleteConfirmed() {
    const p = Projects.active(); if (!p) return;
    Projects.delete(p.id);
    Projects.applyToUI();
    this._editing = false;
    this._hideDeleteConfirm();
    this._afterProjectSwitch();
    this.render();
  },

  _enterEditMode() {
    this._editing = true;
    this._hideDeleteConfirm();
    this.render();
  },

  _exitEditMode(commit, newName) {
    if (commit) {
      const p = Projects.active();
      if (p) Projects.rename(p.id, newName);
    }
    this._editing = false;
    this.render();
  },

  _showDeleteConfirm() {
    const p = Projects.active(); if (!p) return;
    this.els.deleteConfirmName.textContent = p.name;
    this.els.deleteConfirm.classList.add('show');
  },

  _hideDeleteConfirm() {
    this.els.deleteConfirm.classList.remove('show');
  },

  // After a project switch (change/create/delete), reset the transient/derived UI
  // so stale results from the previous project don't bleed through. autoRefresh
  // then runs the full pipeline against the newly loaded inputs.
  // (regState was set by Projects.applyToUI from the new project's saved
  // regressions; don't wipe it here.)
  _afterProjectSwitch() {
    lastResults = null; lastFacies = null; lastLabels = null;
    lastHasPorosity = false; lastHasPermeability = false; lastPorPoints = [];
    lastHasShf = false;
    resetPlotCategoryCache();
    resetShfCategoryCache();

    // Pivot toggles are owned by Projects.applyToUI now (it ran before
    // _afterProjectSwitch). The disabled state for porosity/perm gets
    // reapplied by autoRefresh from the new project's data.

    clearStatus();
    // autoRefresh handles the rest: detect codes/zones, rebuild label/zone
    // inputs, render the table (or hide it for empty data), reinit plot,
    // toggle the test-btn affordance.
    autoRefresh();
  },
};
