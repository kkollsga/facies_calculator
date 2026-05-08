"use strict";

// ============================================================
// Dynamic input panels: facies labels and zone renames
// ============================================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rebuildLabelInputs() {
  const container = document.getElementById('labels-fields');
  container.innerHTML = '';
  if (state.detectedFacies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'kv-empty';
    empty.textContent = 'paste a facies log to detect codes';
    container.appendChild(empty);
    return;
  }
  for (const code of state.detectedFacies) {
    const row = document.createElement('div');
    row.className = 'kv-row';
    const key = document.createElement('label');
    key.className = 'kv-key';
    key.innerHTML = '<span class="accent">F</span>' + escapeHtml(code);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'kv-input';
    inp.placeholder = 'no label';
    inp.value = state.faciesLabels.get(code) || '';
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      if (v) state.faciesLabels.set(code, v); else state.faciesLabels.delete(code);
      Projects.saveDebounced();
      rerenderIfReady();
    });
    row.appendChild(key); row.appendChild(inp);
    container.appendChild(row);
  }
}

function rebuildZoneInputs() {
  const container = document.getElementById('zones-fields');
  container.innerHTML = '';
  if (state.detectedZones.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'kv-empty';
    empty.textContent = 'paste tops to detect zones';
    container.appendChild(empty);
    return;
  }
  for (const name of state.detectedZones) {
    const row = document.createElement('div');
    row.className = 'kv-row';
    const key = document.createElement('label');
    key.className = 'kv-key';
    key.textContent = name;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'kv-input';
    inp.placeholder = 'keep "' + name + '"';
    inp.value = state.zoneRenames.get(name) || '';
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      if (v && v !== name) state.zoneRenames.set(name, v); else state.zoneRenames.delete(name);
      Projects.saveDebounced();
      // Renames are applied during calculate(), so re-run the pipeline. The
      // smart-init in initPlotPanel keeps existing plot filters when only the
      // zone label changed (the well/facies sets haven't moved).
      scheduleAutoRefresh();
    });
    row.appendChild(key); row.appendChild(inp);
    container.appendChild(row);
  }
}

function rebuildFwlInputs() {
  const panel = document.getElementById('fwl-panel');
  const container = document.getElementById('fwl-fields');
  if (!panel || !container) return;
  // Hide the entire panel when no well needs an FWL — TVDSS-based porosity
  // input is optional, so keeping the panel out of the layout in the common
  // case (HAFWL provided or no porosity data at all) is the right default.
  if (!state.detectedFwlWells || state.detectedFwlWells.length === 0) {
    panel.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  panel.style.display = '';
  container.innerHTML = '';
  for (const well of state.detectedFwlWells) {
    const row = document.createElement('div');
    row.className = 'kv-row';
    const key = document.createElement('label');
    key.className = 'kv-key';
    key.textContent = well;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.className = 'kv-input';
    inp.placeholder = 'TVDSS, e.g. -2580';
    const cur = state.fwlValues.get(well);
    if (cur != null && Number.isFinite(cur)) inp.value = String(cur);
    inp.addEventListener('input', () => {
      const raw = inp.value.trim();
      if (raw === '') state.fwlValues.delete(well);
      else {
        const v = Number(raw);
        if (Number.isFinite(v)) state.fwlValues.set(well, v);
      }
      Projects.saveDebounced();
      // FWL flips HAFWL availability per row, which gates the SHF panel —
      // re-run the pipeline so SHF lights up (or hides) immediately.
      scheduleAutoRefresh();
    });
    row.appendChild(key); row.appendChild(inp);
    container.appendChild(row);
  }
}

// ============================================================
// Drag-and-drop file support on input panels
// ============================================================
// Wires the parent .panel as the drop target so the user has a generous hit
// area, not just the textarea itself. Reading is text-only — binary drops
// will look like garbage in the textarea, which is the user's signal to
// re-pick a file.
function attachFileDrop(textarea) {
  const panel = textarea.closest('.panel');
  if (!panel) return;
  let depth = 0;  // dragenter/leave fires for every nested child; track depth so we don't flicker
  panel.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    depth++;
    panel.classList.add('drag-over');
  });
  panel.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  panel.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) panel.classList.remove('drag-over');
  });
  panel.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    depth = 0;
    panel.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    try {
      const text = await file.text();
      textarea.value = text;
      // Trigger the same listeners (scan + autosave) the user gets when typing
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {
      // file.text() can reject for unreadable files; degrade silently
    }
  });
}
