"use strict";

// ============================================================
// Core algorithm: zone construction, facies intervals, calculation,
// aggregation, and shared helpers (mirrors verified Python prototype)
// ============================================================

function uniqueFaciesCodes(facRows) {
  const set = new Set();
  for (const r of facRows) set.add(r.facies);
  return [...set].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (isFinite(na) && isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

function uniqueZoneNames(topsRows) {
  const zones = buildZones(topsRows);
  const seen = new Set();
  const out = [];
  const byWell = new Map();
  for (const z of zones) {
    if (!byWell.has(z.well)) byWell.set(z.well, []);
    byWell.get(z.well).push(z);
  }
  for (const [_, wellZones] of byWell) {
    for (const z of wellZones) {
      if (!seen.has(z.zone)) { seen.add(z.zone); out.push(z.zone); }
    }
    const last = wellZones[wellZones.length - 1];
    if (last && !seen.has(last.baseSurface)) { seen.add(last.baseSurface); out.push(last.baseSurface); }
  }
  return out;
}

function uniqueFacies(results) {
  const set = new Set();
  for (const r of results) r.faciesZ.forEach((_, k) => set.add(k));
  // Sort numerically when possible, else lexicographically.
  return [...set].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (isFinite(na) && isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

function buildZones(topsRows) {
  const byWell = new Map();
  for (const r of topsRows) {
    if (!byWell.has(r.well)) byWell.set(r.well, []);
    byWell.get(r.well).push(r);
  }
  const zones = [];
  for (const [well, rows] of byWell) {
    rows.sort((a, b) => a.md - b.md);
    for (let i = 0; i < rows.length - 1; i++) {
      const top = rows[i], base = rows[i + 1];
      if (base.md <= top.md) continue;  // skip zero-span pairs
      let name = top.surface;
      if (name.toLowerCase().endsWith(' top')) name = name.slice(0, -4);
      let baseName = base.surface;
      if (baseName.toLowerCase().endsWith(' top')) baseName = baseName.slice(0, -4);
      zones.push({
        well,
        zone: name,
        baseSurface: baseName,
        mdTop: top.md, mdBase: base.md,
        zTop: top.z, zBase: base.z,
        grossZ: Math.abs(base.z - top.z),
      });
    }
  }
  return zones;
}

function buildFaciesIntervals(faciesRows) {
  const byWell = new Map();
  for (const r of faciesRows) {
    if (!byWell.has(r.well)) byWell.set(r.well, []);
    byWell.get(r.well).push(r);
  }
  const intervals = [];
  for (const [well, rows] of byWell) {
    rows.sort((a, b) => a.md - b.md);
    const n = rows.length;
    for (let i = 0; i < n; i++) {
      const md = rows[i].md;
      let start, end;
      if (i === 0) {
        if (n > 1) {
          const half = (rows[1].md - md) / 2;
          start = md - half; end = md + half;
        } else { start = md; end = md; }
      } else if (i === n - 1) {
        const half = (md - rows[i - 1].md) / 2;
        start = md - half; end = md + half;
      } else {
        start = (rows[i - 1].md + md) / 2;
        end = (md + rows[i + 1].md) / 2;
      }
      intervals.push({ well, mdStart: start, mdEnd: end, centerMd: md, facies: rows[i].facies });
    }
  }
  return intervals;
}

function calculate(zones, faciesIntervals, porosityRows) {
  porosityRows = porosityRows || [];
  const byWell = new Map();
  for (const fi of faciesIntervals) {
    if (!byWell.has(fi.well)) byWell.set(fi.well, []);
    byWell.get(fi.well).push(fi);
  }
  const porByWell = new Map();
  for (const p of porosityRows) {
    if (!porByWell.has(p.well)) porByWell.set(p.well, []);
    porByWell.get(p.well).push(p);
  }
  const out = [];
  for (const z of zones) {
    const perFacies = new Map();
    const perFaciesN = new Map();
    const mdSpan = z.mdBase - z.mdTop;
    const zPerMd = (z.zBase - z.zTop) / mdSpan;
    const wellList = byWell.get(z.well) || [];
    // Sort facies intervals for nearest-neighbor lookup of porosity samples
    const wellListSorted = wellList.slice().sort((a, b) => a.centerMd - b.centerMd);
    for (const fi of wellList) {
      const ovStart = Math.max(z.mdTop, fi.mdStart);
      const ovEnd = Math.min(z.mdBase, fi.mdEnd);
      const ov = ovEnd - ovStart;
      if (ov > 0) {
        const tZ = Math.abs(ov * zPerMd);
        perFacies.set(fi.facies, (perFacies.get(fi.facies) || 0) + tZ);
      }
      if (fi.centerMd >= z.mdTop && fi.centerMd < z.mdBase) {
        perFaciesN.set(fi.facies, (perFaciesN.get(fi.facies) || 0) + 1);
      }
    }
    let covered = 0;
    perFacies.forEach(v => covered += v);
    const fracs = new Map();
    if (z.grossZ > 0) perFacies.forEach((v, k) => fracs.set(k, v / z.grossZ));

    const porValues = [];
    const permValues = [];
    // Per-facies porosity/perm value arrays: each porosity sample gets assigned to its
    // nearest-MD facies sample, then stats can be computed per facies on demand.
    const porByFacies = new Map();
    const permByFacies = new Map();
    const porList = porByWell.get(z.well) || [];
    for (const p of porList) {
      if (p.md >= z.mdTop && p.md < z.mdBase) {
        porValues.push(p.value);
        const hasPerm = (p.perm != null && isFinite(p.perm));
        if (hasPerm) permValues.push(p.perm);
        // Find this sample's facies (nearest MD, same well, within zone)
        let facCode = null;
        if (wellListSorted.length > 0) {
          let bestD = Infinity;
          for (const fi of wellListSorted) {
            const d = Math.abs(fi.centerMd - p.md);
            if (d < bestD) { bestD = d; facCode = fi.facies; }
          }
        }
        if (facCode != null) {
          if (!porByFacies.has(facCode)) porByFacies.set(facCode, []);
          porByFacies.get(facCode).push(p.value);
          if (hasPerm) {
            if (!permByFacies.has(facCode)) permByFacies.set(facCode, []);
            permByFacies.get(facCode).push(p.perm);
          }
        }
      }
    }
    const por = porStats(porValues);
    const perm = porStats(permValues);

    out.push({
      well: z.well, zone: z.zone, baseSurface: z.baseSurface,
      mdTop: z.mdTop, mdBase: z.mdBase,
      zTop: z.zTop, zBase: z.zBase,
      grossZ: z.grossZ,
      coveredZ: covered,
      faciesZ: perFacies,
      faciesN: perFaciesN,
      faciesFrac: fracs,
      por, perm,
      porValues, permValues,
      porByFacies, permByFacies,
    });
  }
  return out;
}

function porStats(values) {
  const n = values.length;
  if (n === 0) return { n: 0, mean: null, std: null, min: null, max: null };
  let sum = 0, mn = Infinity, mx = -Infinity;
  for (const v of values) { sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const mean = sum / n;
  let std = null;
  if (n >= 2) {
    let ss = 0;
    for (const v of values) { const d = v - mean; ss += d * d; }
    std = Math.sqrt(ss / (n - 1));
  }
  return { n, mean, std, min: mn, max: mx };
}

function applyZoneRenames(results, renames) {
  if (!renames || renames.size === 0) return results;
  return results.map(r => {
    const nz = renames.get(r.zone);
    const nbs = r.baseSurface ? renames.get(r.baseSurface) : null;
    if (!nz && !nbs) return r;
    return Object.assign({}, r, {
      zone: nz || r.zone,
      baseSurface: nbs || r.baseSurface,
    });
  });
}

function aggregateResults(results, byWell, byZone, byFacies) {
  // When byFacies is on, each input row gets expanded into one row per facies present,
  // with that facies's per-facies stats. Then standard bucketing by (well/zone/facies) happens.
  // When all three flags match the natural shape (all on, no facies expansion needed because
  // input is per-(well, zone) only, but we still split by facies), we expand.
  let expanded = results;
  if (byFacies) {
    expanded = [];
    for (const r of results) {
      // Set of facies present in this row: union of faciesZ keys (which come from the
      // thickness calculation) — that's the canonical "facies in this zone" set.
      const facKeys = [...r.faciesZ.keys()];
      if (facKeys.length === 0) continue;
      // Stable order: sort numerically when possible
      facKeys.sort((a, b) => {
        const na = Number(a), nb = Number(b);
        if (isFinite(na) && isFinite(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      });
      for (const f of facKeys) {
        const facZ = r.faciesZ.get(f) || 0;
        const facN = r.faciesN.get(f) || 0;
        const fz = new Map([[f, facZ]]);
        const fn = new Map([[f, facN]]);
        const ff = new Map();
        if (r.grossZ > 0) ff.set(f, facZ / r.grossZ);
        const porVals = (r.porByFacies && r.porByFacies.get(f)) || [];
        const permVals = (r.permByFacies && r.permByFacies.get(f)) || [];
        expanded.push({
          well: r.well, zone: r.zone, facies: f,
          baseSurface: r.baseSurface, mdTop: r.mdTop, mdBase: r.mdBase,
          // Gross Z for the facies row is the facies thickness, not the zone gross —
          // because grossZ is the denominator the row "owns" for fractions.
          grossZ: facZ,
          coveredZ: facZ,
          faciesZ: fz, faciesN: fn, faciesFrac: ff,
          por: porStats(porVals),
          perm: porStats(permVals),
          porValues: porVals.slice(),
          permValues: permVals.slice(),
        });
      }
    }
  }
  // No bucketing needed if all three group dimensions are on (each row is already unique)
  if (byWell && byZone && byFacies) return expanded;
  if (byWell && byZone && !byFacies) return results;  // unchanged when no facies expansion

  // Bucket by (well, zone, facies) with '*' wildcards for inactive dims
  const buckets = new Map();
  const order = [];
  for (const r of expanded) {
    const key = (byWell ? r.well : '*') + '\x00' +
                (byZone ? r.zone : '*') + '\x00' +
                (byFacies ? r.facies : '*');
    if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
    buckets.get(key).push(r);
  }
  const out = [];
  for (const key of order) {
    const rows = buckets.get(key);
    const facZ = new Map(), facN = new Map();
    let grossZ = 0;
    const porValues = [];
    const permValues = [];
    for (const r of rows) {
      grossZ += r.grossZ;
      r.faciesZ.forEach((v, k) => facZ.set(k, (facZ.get(k) || 0) + v));
      r.faciesN.forEach((v, k) => facN.set(k, (facN.get(k) || 0) + v));
      if (r.porValues && r.porValues.length) for (const v of r.porValues) porValues.push(v);
      if (r.permValues && r.permValues.length) for (const v of r.permValues) permValues.push(v);
    }
    const facFrac = new Map();
    if (grossZ > 0) facZ.forEach((v, k) => facFrac.set(k, v / grossZ));
    out.push({
      well: byWell ? rows[0].well : '',
      zone: byZone ? rows[0].zone : '',
      facies: byFacies ? rows[0].facies : '',
      baseSurface: (byWell && byZone && !byFacies) ? rows[0].baseSurface : null,
      mdTop: (byWell && byZone && !byFacies) ? rows[0].mdTop : null,
      mdBase: (byWell && byZone && !byFacies) ? rows[0].mdBase : null,
      grossZ,
      coveredZ: rows.reduce((s, r) => s + (r.coveredZ || 0), 0),
      faciesZ: facZ,
      faciesN: facN,
      faciesFrac: facFrac,
      por: porStats(porValues),
      perm: porStats(permValues),
      porValues,
      permValues,
      _aggregated: true,
    });
  }
  return out;
}

function totalFaciesN(r) {
  let s = 0;
  r.faciesN.forEach(v => s += v);
  return s;
}

function enrichPorPoints(porRows, zones, faciesRows, renames) {
  // Each porosity sample gets {zone, facies} resolved by MD lookup.
  // - zone: half-open [mdTop, mdBase)
  // - facies: nearest-neighbor in MD (within the same well)
  const zonesByWell = new Map();
  for (const z of zones) {
    if (!zonesByWell.has(z.well)) zonesByWell.set(z.well, []);
    zonesByWell.get(z.well).push(z);
  }
  const facByWell = new Map();
  for (const f of faciesRows) {
    if (!facByWell.has(f.well)) facByWell.set(f.well, []);
    facByWell.get(f.well).push(f);
  }
  for (const [_, rows] of facByWell) rows.sort((a, b) => a.md - b.md);

  const out = [];
  for (const r of porRows) {
    let zone = null;
    for (const z of zonesByWell.get(r.well) || []) {
      if (r.md >= z.mdTop && r.md < z.mdBase) { zone = z.zone; break; }
    }
    if (zone == null) continue;  // skip samples outside any zone
    let facies = null;
    const fl = facByWell.get(r.well) || [];
    if (fl.length > 0) {
      let bestD = Infinity;
      for (const fr of fl) {
        const d = Math.abs(fr.md - r.md);
        if (d < bestD) { bestD = d; facies = fr.facies; }
      }
    }
    // Apply zone renames cosmetically to match the table
    if (renames && renames.size > 0 && renames.has(zone)) zone = renames.get(zone);
    out.push({
      well: r.well, md: r.md,
      por: r.value,
      perm:  (r.perm  != null && isFinite(r.perm))  ? r.perm  : null,
      hafwl: (r.hafwl != null && isFinite(r.hafwl)) ? r.hafwl : null,
      sw:    (r.sw    != null && isFinite(r.sw))    ? r.sw    : null,
      zone, facies,
    });
  }
  return out;
}
