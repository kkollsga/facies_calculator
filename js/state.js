"use strict";

// ============================================================
// Application state and persistence
// ============================================================
// Globals are intentional: this is a no-build, plain-script setup. Each module
// reads/writes these via the global scope. Treat them as the application's
// shared state container.

const state = {
  detectedFacies: [],   // ordered array of facies code strings
  detectedZones: [],    // ordered array of zone name strings
  detectedFwlWells: [], // wells whose porosity log carries TVDSS but no HAFWL
  faciesLabels: new Map(),   // code -> label
  zoneRenames: new Map(),    // original zone name -> new name
  fwlValues: new Map(),      // well -> free-water level (TVDSS, same sign convention as input)
  // Pivot table filters: when enabled, drop rows whose well/zone/facies
  // isn't in the corresponding set before render. Disabled = no filter,
  // even when sets have non-default selections.
  pivotFilterEnabled: false,
  pivotFilters: { wells: new Set(), zones: new Set(), facies: new Set() },
  pivotFiltersPrevDetected: { wells: [], zones: [], facies: [] },
};

// Snapshot of the most recent successful calculation, used by render, plot, and exports.
let lastResults = null;        // post-filter results (used by render + exports)
let lastResultsRaw = null;     // pre-filter results — survives chip toggles so we can re-apply
let lastFacies = null;
let lastLabels = null;
let lastHasPorosity = false;
let lastHasPermeability = false;
let lastHasShf = false;  // true when porosity log carries por + perm + hafwl + sw
let lastPorPoints = [];  // enriched per-sample data for the plot panel

// Plot-panel UI state. `filters` are sets of currently-selected categorical values.
const plotState = {
  visible: false,
  type: 'hist',
  filters: { wells: new Set(), zones: new Set(), facies: new Set() },
};

// Regression-panel state. Each regression captures a snapshot of the filter sets
// at creation time so refits stay tied to the originally selected data.
// Each entry: { id, name, degree, color, coeffs, r2, filters: {wells,zones,facies}, n, range:{phiLo,phiHi}, visible }
const regState = {
  list: [],
  activeId: null,
  nextId: 1,
};

// ============================================================
// Persistent labels in localStorage
// ============================================================
// Structured to allow more category types in future. Today: { Facies: {code: label} }
const LABELS_STORAGE_KEY = 'fzp_labels_v1';

function loadStoredLabels() {
  try {
    const raw = localStorage.getItem(LABELS_STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) {
    return {};
  }
}

function saveStoredLabels(allLabels) {
  try {
    localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(allLabels));
  } catch (e) {
    // Storage may be full or disabled; fail silently
  }
}

function persistFaciesLabels() {
  const all = loadStoredLabels();
  const facies = {};
  state.faciesLabels.forEach((label, code) => { facies[code] = label; });
  all.Facies = facies;
  saveStoredLabels(all);
}

function hydrateFaciesLabelsFromStorage() {
  const all = loadStoredLabels();
  const facies = all.Facies || {};
  state.faciesLabels = new Map();
  for (const code of Object.keys(facies)) {
    if (typeof facies[code] === 'string' && facies[code].length > 0) {
      state.faciesLabels.set(code, facies[code]);
    }
  }
}
