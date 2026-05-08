"use strict";

// ============================================================
// Input parsing: tabular text -> typed row arrays
// ============================================================

function splitDelim(line) {
  // Tabs preferred; explicit semicolon next (common European-CSV format,
  // and reliable when cell content contains single spaces, e.g.
  // "35/9-16 A;;Sand 3 top;..."); then 2+ spaces, comma, single-space fallback.
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(';')) return line.split(';');
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/);
  if (line.includes(',')) return line.split(',');
  return line.split(/\s+/);
}

function findCol(headers, candidates) {
  // Find a column index whose header (lowercased) contains any of the candidates.
  const lower = headers.map(h => h.trim().toLowerCase());
  for (let i = 0; i < lower.length; i++) {
    for (const c of candidates) {
      if (lower[i] === c) return i;
    }
  }
  for (let i = 0; i < lower.length; i++) {
    for (const c of candidates) {
      if (lower[i].includes(c)) return i;
    }
  }
  return -1;
}

function parseTops(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('Tops: need a header row plus at least one data row.');
  const headers = splitDelim(lines[0]).map(h => h.trim());
  const wellIdx = findCol(headers, ['well identifier (well name)', 'well name', 'well']);
  const surfIdx = findCol(headers, ['surface', 'horizon', 'top']);
  const zIdx = findCol(headers, ['z', 'tvdss', 'tvd', 'depth']);
  const mdIdx = findCol(headers, ['md', 'measured depth']);
  if (wellIdx < 0) throw new Error('Tops: cannot find "Well" column.');
  if (surfIdx < 0) throw new Error('Tops: cannot find "Surface" column.');
  if (zIdx < 0) throw new Error('Tops: cannot find "Z" column.');
  if (mdIdx < 0) throw new Error('Tops: cannot find "MD" column.');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = splitDelim(lines[i]);
    const well = (parts[wellIdx] || '').trim();
    const surface = (parts[surfIdx] || '').trim();
    const z = parseFloat((parts[zIdx] || '').trim());
    const md = parseFloat((parts[mdIdx] || '').trim());
    if (!well || !surface || !isFinite(z) || !isFinite(md)) continue;
    rows.push({ well, surface, z, md });
  }
  if (rows.length === 0) throw new Error('Tops: no valid rows parsed.');
  return rows;
}

function parseFacies(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('Facies log: need a header row plus at least one data row.');
  const headers = splitDelim(lines[0]).map(h => h.trim());
  const wellIdx = findCol(headers, ['well']);
  const mdIdx = findCol(headers, ['md', 'measured depth', 'depth']);
  const facIdx = findCol(headers, ['facies', 'rock type', 'lithology', 'litho']);
  if (wellIdx < 0) throw new Error('Facies log: cannot find "Well" column.');
  if (mdIdx < 0) throw new Error('Facies log: cannot find "MD" column.');
  if (facIdx < 0) throw new Error('Facies log: cannot find "Facies" column.');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = splitDelim(lines[i]);
    const well = (parts[wellIdx] || '').trim();
    const md = parseFloat((parts[mdIdx] || '').trim());
    const facRaw = (parts[facIdx] || '').trim();
    if (!well || !isFinite(md) || facRaw === '') continue;
    // Keep facies as-is (string); numeric facies still string-keyable for grouping.
    rows.push({ well, md, facies: facRaw });
  }
  if (rows.length === 0) throw new Error('Facies log: no valid rows parsed.');
  return rows;
}

function parsePorosity(text) {
  // Optional input. Returns array of {well, md, value, perm?}.
  // perm is undefined if no perm column is detected.
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitDelim(lines[0]).map(h => h.trim());
  const wellIdx = findCol(headers, ['well']);
  const mdIdx = findCol(headers, ['md', 'measured depth', 'depth']);
  let valIdx = findCol(headers, ['por.eff.', 'por.eff', 'por_eff', 'phie', 'phi_e', 'porosity', 'por', 'phi']);
  if (valIdx < 0) {
    const lower = headers.map(h => h.trim().toLowerCase());
    for (let i = 0; i < lower.length; i++) {
      if (lower[i].includes('por') || lower[i].includes('phi')) { valIdx = i; break; }
    }
  }
  if (wellIdx < 0) throw new Error('Porosity log: cannot find "Well" column.');
  if (mdIdx < 0) throw new Error('Porosity log: cannot find "MD" column.');
  if (valIdx < 0) throw new Error('Porosity log: cannot find a porosity column (e.g. Por.Eff., PHIE).');

  // Optional permeability detection - exact match first, then substring match excluding the porosity column
  let permIdx = findCol(headers, ['perm', 'permeability', 'k', 'kair', 'k_air', 'kabs', 'kh', 'k_h']);
  if (permIdx === valIdx) permIdx = -1;
  if (permIdx < 0) {
    const lower = headers.map(h => h.trim().toLowerCase());
    for (let i = 0; i < lower.length; i++) {
      if (i === valIdx || i === wellIdx || i === mdIdx) continue;
      const h = lower[i];
      if (h === 'k' || h.startsWith('k_') || h.startsWith('k ') || h.includes('perm')) {
        permIdx = i; break;
      }
    }
  }

  // Optional HAFWL (height above free water level) and Sw (water saturation)
  // columns. When all four (por + perm + hafwl + sw) are present the SHF
  // panel becomes available.
  let hafwlIdx = findCol(headers, [
    'hafwl', 'h_afwl', 'h.afwl',
    'height above free water level', 'height_above_free_water_level',
    'height above fwl', 'height_above_fwl',
  ]);
  let swIdx = findCol(headers, [
    'sw', 's_w', 'sw.eff', 'sw_eff',
    'water saturation', 'water_saturation', 'sat_w',
  ]);

  // Optional TVDSS column (subsea depth — typically negative going down).
  // Used as an HAFWL fallback: when TVDSS + per-well FWL are known the app
  // layer computes HAFWL = TVDSS − FWL. We deliberately skip columns already
  // claimed by other roles (MD, porosity, perm, etc.) so a header named just
  // "Depth" alongside "MD" resolves to TVDSS, not a second MD.
  let tvdssIdx = -1;
  {
    const used = new Set([wellIdx, mdIdx, valIdx, permIdx, hafwlIdx, swIdx].filter(i => i >= 0));
    const candidates = ['tvdss', 'tvd_ss', 'tvd ss', 'tvd', 'depth', 'z', 'subsea'];
    const lower = headers.map(h => h.trim().toLowerCase());
    for (let i = 0; i < lower.length && tvdssIdx < 0; i++) {
      if (used.has(i)) continue;
      if (candidates.includes(lower[i])) tvdssIdx = i;
    }
    for (let i = 0; i < lower.length && tvdssIdx < 0; i++) {
      if (used.has(i)) continue;
      for (const c of candidates) if (lower[i].includes(c)) { tvdssIdx = i; break; }
    }
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = splitDelim(lines[i]);
    const well = (parts[wellIdx] || '').trim();
    const md = parseFloat((parts[mdIdx] || '').trim());
    const value = parseFloat((parts[valIdx] || '').trim());
    if (!well || !isFinite(md) || !isFinite(value)) continue;
    const row = { well, md, value };
    if (permIdx >= 0 && permIdx < parts.length) {
      const p = parseFloat((parts[permIdx] || '').trim());
      if (isFinite(p)) row.perm = p;
    }
    if (hafwlIdx >= 0 && hafwlIdx < parts.length) {
      const h = parseFloat((parts[hafwlIdx] || '').trim());
      if (isFinite(h)) row.hafwl = h;
    }
    if (swIdx >= 0 && swIdx < parts.length) {
      const s = parseFloat((parts[swIdx] || '').trim());
      if (isFinite(s)) row.sw = s;
    }
    if (tvdssIdx >= 0 && tvdssIdx < parts.length) {
      const t = parseFloat((parts[tvdssIdx] || '').trim());
      if (isFinite(t)) row.tvdss = t;
    }
    rows.push(row);
  }
  return rows;
}

// Wells that bring TVDSS but no HAFWL — these need a per-well FWL value
// before the SHF panel can compute HAFWL. Returns a stable, sorted list.
function porosityWellsNeedingFwl(porRows) {
  const set = new Set();
  for (const r of porRows) {
    if (r.hafwl == null && r.tvdss != null) set.add(r.well);
  }
  return [...set].sort((a, b) => String(a).localeCompare(String(b)));
}

function porosityRowsHavePerm(porRows) {
  for (const r of porRows) if (r.perm != null) return true;
  return false;
}

// SHF panel needs all four: por (always present in parsed rows), perm,
// hafwl, sw. Returns true as soon as one row carries them all.
function porosityRowsHaveShf(porRows) {
  for (const r of porRows) {
    if (r.perm != null && r.hafwl != null && r.sw != null) return true;
  }
  return false;
}
