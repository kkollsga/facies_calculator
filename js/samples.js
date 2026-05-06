"use strict";

// ============================================================
// Sample data: pre-baked tops, facies, porosity for "Load sample data"
// ============================================================

function sampleTops() {
  return [
    'Well identifier (Well name)\tWell identifier (UWI)\tSurface\tX\tY\tZ\tMD',
    '35/9-16 A\t\tAgat top\t552438.81\t6813461\t-2627.13\t2871.12',
    '35/9-16 A\t\tSand 3 top\t552442.96\t6813459.34\t-2641.03\t2885.73',
    '35/9-16 A\t\tSand 3.A top\t552442.96\t6813459.34\t-2641.03\t2885.73',
    '35/9-16 A\t\tMTC top\t552453.85\t6813454.95\t-2677.52\t2924.06',
    '35/9-3 T2\t\tAgat top\t551200.0\t6812000.0\t-1825.00\t1850.00',
    '35/9-3 T2\t\tSand 3 top\t551205.0\t6812005.0\t-1845.00\t1870.00',
    '35/9-3 T2\t\tMTC top\t551210.0\t6812010.0\t-1885.00\t1910.00',
  ].join('\n');
}

function sampleFacies() {
  // 35/9-16 A: facies 3 throughout the Agat-MTC interval (0.152 m sampling)
  // 35/9-3 T2: a mix of facies 1, 2, 3 with a transition mid-zone
  const lines = ['Well\tMD\tFacies'];
  for (let md = 2870.0; md <= 2925.0; md += 0.152) {
    lines.push('35/9-16 A\t' + md.toFixed(3) + '\t3');
  }
  // 35/9-3 T2: facies 1 from 1840 to 1860, facies 3 from 1860 to 1900, facies 2 from 1900 to 1920
  for (let md = 1840.0; md < 1860.0; md += 0.152) lines.push('35/9-3 T2\t' + md.toFixed(3) + '\t1');
  for (let md = 1860.0; md < 1900.0; md += 0.152) lines.push('35/9-3 T2\t' + md.toFixed(3) + '\t3');
  for (let md = 1900.0; md < 1920.0; md += 0.152) lines.push('35/9-3 T2\t' + md.toFixed(3) + '\t2');
  return lines.join('\n');
}

function samplePorosity() {
  // Synthetic Por.Eff. + Perm + HAFWL + Sw log.
  // 35/9-16 A:  Agat ~ 0.18 ± 0.02 (good sand), Sand 3.A ~ 0.06 ± 0.01 (tight)
  // 35/9-3 T2:  Channel ~ 0.22 ± 0.03, Floodplain ~ 0.05 ± 0.015, Crevasse ~ 0.12 ± 0.025
  // Permeability: K = exp(a*por + b) with sensible a,b per facies family.
  // HAFWL: each well has a (synthetic) Free Water Level — HAFWL = FWL_md - md.
  // Sw: simple J-curve falling off with HAFWL, scaled by rock quality and Swirr
  // floor so the SHF plot shows a recognisable pattern out of the box.
  const lines = ['Well\tMD\tPor.Eff.\tPerm\tHAFWL\tSw'];
  let seed = 1;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  }
  function permFromPor(por, family) {
    let logK;
    if (family === 'sand-good') logK = 28 * por - 1.5;
    else if (family === 'sand-channel') logK = 30 * por - 2.0;
    else if (family === 'crevasse') logK = 25 * por - 2.5;
    else logK = 35 * por - 3.5;
    logK += rand() * 1.0;
    return Math.exp(logK);
  }
  function swFromShf(hafwl, por, perm) {
    if (hafwl <= 0) return 1.0;  // below FWL → 100% water
    const Swirr = Math.min(0.45, 0.10 + (1 - Math.min(1, por * 4)) * 0.25);
    // RQI-style decay: better rock (high √(k/φ)) drops Sw faster.
    const rqi = Math.sqrt(perm / Math.max(1e-4, por));
    const decay = 0.012 + 0.06 * Math.log10(Math.max(0.1, rqi));
    const noise = rand() * 0.04;
    const sw = Swirr + (1 - Swirr) * Math.exp(-Math.max(0, decay) * hafwl) + noise;
    return Math.min(1.0, Math.max(Swirr, sw));
  }
  // Synthetic free-water levels — chosen so most samples sit above FWL.
  const fwl_16A = 2925;
  const fwl_3T2 = 1910;
  for (let md = 2871.5; md <= 2924.0; md += 0.152) {
    const isAgat = md < 2885.7;
    const mean = isAgat ? 0.18 : 0.06;
    const noise = isAgat ? 0.02 : 0.01;
    const family = isAgat ? 'sand-good' : 'tight';
    const v = Math.max(0.005, mean + rand() * 2 * noise);
    const k = permFromPor(v, family);
    const hafwl = fwl_16A - md;
    const sw = swFromShf(hafwl, v, k);
    lines.push('35/9-16 A\t' + md.toFixed(3) + '\t' + v.toFixed(4) + '\t' + k.toFixed(3) + '\t' + hafwl.toFixed(2) + '\t' + sw.toFixed(4));
  }
  for (let md = 1850.5; md < 1909.5; md += 0.152) {
    let mean, noise, family;
    if (md < 1870.0) { mean = 0.22; noise = 0.03; family = 'sand-channel'; }
    else if (md < 1900.0) { mean = 0.05; noise = 0.015; family = 'tight'; }
    else { mean = 0.12; noise = 0.025; family = 'crevasse'; }
    const v = Math.max(0.005, mean + rand() * 2 * noise);
    const k = permFromPor(v, family);
    const hafwl = fwl_3T2 - md;
    const sw = swFromShf(hafwl, v, k);
    lines.push('35/9-3 T2\t' + md.toFixed(3) + '\t' + v.toFixed(4) + '\t' + k.toFixed(3) + '\t' + hafwl.toFixed(2) + '\t' + sw.toFixed(4));
  }
  return lines.join('\n');
}
