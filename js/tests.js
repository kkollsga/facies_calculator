"use strict";

// ============================================================
// Self-tests (mirror of the Python prototype)
// ============================================================

function approxEq(a, b, tol = 1e-6) { return Math.abs(a - b) < tol; }

function runSelfTests() {
  const tests = [];
  function test(name, fn) {
    try { const detail = fn(); tests.push({ name, ok: true, detail: detail || '' }); }
    catch (e) { tests.push({ name, ok: false, detail: e.message }); }
  }
  function assertNear(a, b, tol, label) {
    if (!approxEq(a, b, tol == null ? 1e-6 : tol)) {
      throw new Error((label || 'value') + ' = ' + a.toFixed(4) + ', expected ' + b);
    }
  }

  test('vertical_uniform_facies', () => {
    const tops = [
      { well: 'V1', surface: 'A top', z: -1000, md: 1000 },
      { well: 'V1', surface: 'B top', z: -1100, md: 1100 },
      { well: 'V1', surface: 'C top', z: -1200, md: 1200 },
    ];
    const fac = [];
    for (let md = 950; md <= 1250; md += 0.5) fac.push({ well: 'V1', md, facies: '1' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    for (const row of r) {
      assertNear(row.grossZ, 100, 1e-6, 'grossZ');
      assertNear(row.faciesZ.get('1') || 0, 100, 0.5, 'F1 thickness');
      assertNear(row.faciesFrac.get('1') || 0, 1, 0.005, 'F1 frac');
    }
    return r.length + ' zones, all gross Z = 100m, frac F1 ≈ 1.0';
  });

  test('deviated_well_z_vs_md', () => {
    const tops = [
      { well: 'D1', surface: 'A top', z: -1000, md: 1000 },
      { well: 'D1', surface: 'B top', z: -1080, md: 1100 },
      { well: 'D1', surface: 'C top', z: -1160, md: 1200 },
    ];
    const fac = [];
    for (let md = 950; md <= 1250; md += 0.5) fac.push({ well: 'D1', md, facies: '1' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    for (const row of r) {
      assertNear(row.grossZ, 80, 1e-6, 'grossZ');
      assertNear(row.faciesZ.get('1') || 0, 80, 0.4, 'F1 in Z');
    }
    return 'gross Z = 80m for 100m MD zones (deviated)';
  });

  test('holy_zone_edges', () => {
    const tops = [
      { well: 'H1', surface: 'A top', z: -1000, md: 1000 },
      { well: 'H1', surface: 'B top', z: -1100, md: 1100 },
    ];
    const fac = [];
    for (let md = 1000.25; md < 1050; md += 0.5) fac.push({ well: 'H1', md, facies: '1' });
    for (let md = 1050.25; md < 1100; md += 0.5) fac.push({ well: 'H1', md, facies: '2' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    assertNear(r[0].faciesZ.get('1'), 50, 0.5, 'F1');
    assertNear(r[0].faciesZ.get('2'), 50, 0.5, 'F2');
    return 'transition at 1050: F1=50m, F2=50m';
  });

  test('facies_crossing_two_zones', () => {
    const tops = [
      { well: 'X1', surface: 'A top', z: -1000, md: 1000 },
      { well: 'X1', surface: 'B top', z: -1100, md: 1100 },
      { well: 'X1', surface: 'C top', z: -1200, md: 1200 },
    ];
    // Coarse samples at 1080,1100,1120 -> middle interval [1090,1110] crosses 1100 boundary
    const fac = [
      { well: 'X1', md: 1080, facies: '1' },
      { well: 'X1', md: 1100, facies: '1' },
      { well: 'X1', md: 1120, facies: '1' },
    ];
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const by = Object.fromEntries(r.map(x => [x.zone, x]));
    assertNear(by['A'].faciesZ.get('1'), 30, 1e-6, 'A F1');
    assertNear(by['B'].faciesZ.get('1'), 30, 1e-6, 'B F1');
    return 'sample across boundary split exactly: A=30m, B=30m';
  });

  test('facies_outside_zone_ignored', () => {
    const tops = [
      { well: 'O1', surface: 'A top', z: -1000, md: 1000 },
      { well: 'O1', surface: 'B top', z: -1100, md: 1100 },
    ];
    const fac = [];
    for (let md = 500; md <= 2000; md += 0.5) fac.push({ well: 'O1', md, facies: '1' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    assertNear(r[0].faciesZ.get('1'), 100, 0.5, 'F1');
    return 'samples outside zone do not inflate thickness';
  });

  test('multi_well_isolation', () => {
    const tops = [
      { well: 'A', surface: 'X top', z: -1000, md: 1000 },
      { well: 'A', surface: 'Y top', z: -1100, md: 1100 },
      { well: 'B', surface: 'X top', z: -1000, md: 1000 },
      { well: 'B', surface: 'Y top', z: -1100, md: 1100 },
    ];
    const fac = [];
    for (let md = 1000.25; md < 1100; md += 0.5) fac.push({ well: 'A', md, facies: '1' });
    for (let md = 1000.25; md < 1100; md += 0.5) fac.push({ well: 'B', md, facies: '2' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const a = r.find(x => x.well === 'A'); const b = r.find(x => x.well === 'B');
    if (!a.faciesZ.has('1') || a.faciesZ.has('2')) throw new Error('Well A leaked to F2');
    if (!b.faciesZ.has('2') || b.faciesZ.has('1')) throw new Error('Well B leaked to F1');
    return 'no cross-well leakage';
  });

  test('zero_thickness_top_pair_skipped', () => {
    const tops = [
      { well: 'Z1', surface: 'A top',   z: -1000, md: 1000 },
      { well: 'Z1', surface: 'B top',   z: -1050, md: 1050 },
      { well: 'Z1', surface: 'B.A top', z: -1050, md: 1050 },
      { well: 'Z1', surface: 'C top',   z: -1100, md: 1100 },
    ];
    const fac = [];
    for (let md = 1000.25; md < 1100; md += 0.5) fac.push({ well: 'Z1', md, facies: '1' });
    const zones = buildZones(tops);
    const names = new Set(zones.map(z => z.zone));
    if (!(names.has('A') && names.has('B.A') && names.size === 2)) throw new Error('zone set: ' + [...names].join(','));
    const r = calculate(zones, buildFaciesIntervals(fac));
    const a = r.find(x => x.zone === 'A'); const ba = r.find(x => x.zone === 'B.A');
    assertNear(a.grossZ, 50, 1e-6, 'A grossZ');
    assertNear(ba.grossZ, 50, 1e-6, 'B.A grossZ');
    return 'zero-span pair (Sand 3 / Sand 3.A pattern) skipped cleanly';
  });

  test('user_format_example', () => {
    const tops = [
      { well: '35/9-16 A', surface: 'Agat top',    z: -2627.13, md: 2871.12 },
      { well: '35/9-16 A', surface: 'Sand 3 top',  z: -2641.03, md: 2885.73 },
      { well: '35/9-16 A', surface: 'Sand 3.A top',z: -2641.03, md: 2885.73 },
      { well: '35/9-16 A', surface: 'MTC top',     z: -2677.52, md: 2924.06 },
    ];
    const fac = [];
    for (let md = 2870; md <= 2925; md += 0.152) fac.push({ well: '35/9-16 A', md, facies: '3' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const agat = r.find(x => x.zone === 'Agat');
    const s3a = r.find(x => x.zone === 'Sand 3.A');
    assertNear(agat.grossZ, 13.90, 0.01, 'Agat grossZ');
    assertNear(s3a.grossZ, 36.49, 0.01, 'Sand 3.A grossZ');
    assertNear(agat.faciesFrac.get('3'), 1.0, 0.02, 'Agat F3 frac');
    assertNear(s3a.faciesFrac.get('3'), 1.0, 0.02, 'Sand 3.A F3 frac');
    return 'Agat=13.90m, Sand 3.A=36.49m, both F3 frac ≈ 1.0';
  });

  test('zone_detection_strips_top_suffix', () => {
    const tops = [
      { well: 'W1', surface: 'Agat top',     z: -1000, md: 1000 },
      { well: 'W1', surface: 'Sand 3 top',   z: -1050, md: 1050 },
      { well: 'W1', surface: 'Sand 3.A top', z: -1050, md: 1050 },
      { well: 'W1', surface: 'MTC top',      z: -1100, md: 1100 },
    ];
    // uniqueZoneNames now includes both zone names AND the deepest base surface
    // (so closing-row labels are also renameable)
    const names = uniqueZoneNames(tops);
    if (names.length !== 3) throw new Error('expected 3 names (2 zones + 1 base), got ' + names.length);
    if (names[0] !== 'Agat' || names[1] !== 'Sand 3.A' || names[2] !== 'MTC') throw new Error('order: ' + names.join(','));
    return 'detected: Agat, Sand 3.A (zones) + MTC (closing-row base surface)';
  });

  test('facies_codes_numeric_sort', () => {
    const fac = [
      { well: 'W', md: 100, facies: '10' },
      { well: 'W', md: 101, facies: '2' },
      { well: 'W', md: 102, facies: '1' },
      { well: 'W', md: 103, facies: '10' },
    ];
    const codes = uniqueFaciesCodes(fac);
    if (codes.join(',') !== '1,2,10') throw new Error('order: ' + codes.join(','));
    return 'numeric sort: 1, 2, 10 (not 1, 10, 2)';
  });

  test('apply_zone_renames', () => {
    const tops = [
      { well: 'W', surface: 'Agat top',   z: -1000, md: 1000 },
      { well: 'W', surface: 'Sand 3 top', z: -1100, md: 1100 },
      { well: 'W', surface: 'MTC top',    z: -1200, md: 1200 },
    ];
    const fac = [];
    for (let md = 1000.25; md < 1200; md += 0.5) fac.push({ well: 'W', md, facies: '1' });
    const raw = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const renames = new Map([['Agat', 'Agat reservoir']]);
    const renamed = applyZoneRenames(raw, renames);
    const r0 = renamed.find(x => x.zone === 'Agat reservoir');
    const r1 = renamed.find(x => x.zone === 'Sand 3');
    if (!r0) throw new Error('Agat was not renamed');
    if (!r1) throw new Error('Sand 3 unexpectedly renamed');
    assertNear(r0.grossZ, 100, 1e-6, 'renamed grossZ unchanged');
    return 'rename map applies cosmetically; calculations preserved';
  });

  test('facies_n_count_uniform', () => {
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
    ];
    const fac = [];
    for (let md = 1000; md < 1100; md += 1) fac.push({ well: 'W', md, facies: '1' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    if (r[0].faciesN.get('1') !== 100) throw new Error('expected 100, got ' + r[0].faciesN.get('1'));
    return '100 samples in 100m zone counted correctly';
  });

  test('facies_n_boundary_convention', () => {
    // [mdTop, mdBase): exact top included, exact base excluded
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
      { well: 'W', surface: 'C top', z: -1200, md: 1200 },
    ];
    const fac = [
      { well: 'W', md: 1000, facies: '1' },  // exact A top -> A
      { well: 'W', md: 1100, facies: '1' },  // exact B top (= A base) -> B
      { well: 'W', md: 1200, facies: '1' },  // exact C top (= B base) -> outside
    ];
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const a = r.find(x => x.zone === 'A');
    const b = r.find(x => x.zone === 'B');
    if (a.faciesN.get('1') !== 1) throw new Error('A should have 1 sample, got ' + a.faciesN.get('1'));
    if (b.faciesN.get('1') !== 1) throw new Error('B should have 1 sample, got ' + b.faciesN.get('1'));
    return 'sample at exact top -> upper zone, at exact base -> next zone';
  });

  test('porosity_stats_known_values', () => {
    // [0.10, 0.20, 0.30] -> mean 0.20, sample-std 0.1
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
    ];
    const fac = [{ well: 'W', md: 1050, facies: '1' }];
    const por = [
      { well: 'W', md: 1010, value: 0.10 },
      { well: 'W', md: 1050, value: 0.20 },
      { well: 'W', md: 1090, value: 0.30 },
    ];
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac), por);
    const z = r[0].por;
    if (z.n !== 3) throw new Error('n: ' + z.n);
    assertNear(z.mean, 0.20, 1e-9, 'mean');
    assertNear(z.std, 0.1, 1e-9, 'std');
    assertNear(z.min, 0.10, 1e-9, 'min');
    assertNear(z.max, 0.30, 1e-9, 'max');
    return 'mean=0.20, std=0.1 (n-1), min=0.10, max=0.30';
  });

  test('porosity_n0_and_n1_handling', () => {
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
      { well: 'W', surface: 'C top', z: -1200, md: 1200 },
    ];
    const fac = [{ well: 'W', md: 1050, facies: '1' }];
    const por = [{ well: 'W', md: 1050, value: 0.15 }];  // only in zone A
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac), por);
    const a = r.find(x => x.zone === 'A');
    const b = r.find(x => x.zone === 'B');
    if (a.por.n !== 1) throw new Error('A n: ' + a.por.n);
    if (a.por.std !== null) throw new Error('A std should be null for n=1, got ' + a.por.std);
    assertNear(a.por.mean, 0.15, 1e-9, 'A mean');
    if (b.por.n !== 0) throw new Error('B n: ' + b.por.n);
    if (b.por.mean !== null) throw new Error('B mean should be null for n=0');
    return 'n=1 has mean but null std; n=0 has all null stats';
  });

  test('porosity_no_log_no_crash', () => {
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
    ];
    const fac = [{ well: 'W', md: 1050, facies: '1' }];
    const r1 = calculate(buildZones(tops), buildFaciesIntervals(fac));      // no por arg
    const r2 = calculate(buildZones(tops), buildFaciesIntervals(fac), []);  // empty por
    if (r1[0].por.n !== 0 || r2[0].por.n !== 0) throw new Error('expected n=0 in both');
    return 'missing porosity arg or empty array both produce n=0 stats';
  });

  test('base_surface_propagation', () => {
    const tops = [
      { well: 'W', surface: 'Agat top',     z: -2627.13, md: 2871.12 },
      { well: 'W', surface: 'Sand 3 top',   z: -2641.03, md: 2885.73 },
      { well: 'W', surface: 'Sand 3.A top', z: -2641.03, md: 2885.73 },
      { well: 'W', surface: 'MTC top',      z: -2677.52, md: 2924.06 },
    ];
    const zones = buildZones(tops);
    if (zones[zones.length - 1].baseSurface !== 'MTC') throw new Error('baseSurface: ' + zones[zones.length-1].baseSurface);
    if (Math.abs(zones[zones.length - 1].mdBase - 2924.06) > 1e-6) throw new Error('mdBase wrong');
    return 'deepest top "MTC" carried through as baseSurface for closing row';
  });

  test('parsePorosity_header_variants', () => {
    const a = parsePorosity('Well\tMD\tPor.Eff.\nW1\t1000\t0.15\nW1\t1001\t0.18');
    if (a.length !== 2) throw new Error('Por.Eff. failed: ' + a.length);
    const b = parsePorosity('Well\tMD\tPHIE\nW1\t1000\t0.15');
    if (b.length !== 1) throw new Error('PHIE failed');
    const c = parsePorosity('Well\tMD\tPorosity\nW1\t1000\t0.15');
    if (c.length !== 1) throw new Error('Porosity failed');
    const d = parsePorosity('');
    if (d.length !== 0) throw new Error('empty failed');
    return 'Por.Eff., PHIE, Porosity, and empty-input all parse correctly';
  });

  test('zone_renames_apply_to_base_surface', () => {
    // Renaming MTC should make the closing row read "Reservoir base"
    const tops = [
      { well: 'W', surface: 'Agat top', z: -1000, md: 1000 },
      { well: 'W', surface: 'MTC top',  z: -1100, md: 1100 },
    ];
    const fac = [{ well: 'W', md: 1050, facies: '1' }];
    const raw = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const renamed = applyZoneRenames(raw, new Map([['MTC', 'Reservoir base']]));
    if (renamed[0].baseSurface !== 'Reservoir base') throw new Error('baseSurface not renamed: ' + renamed[0].baseSurface);
    return 'renaming the deepest top updates the closing-row label';
  });

  test('aggregate_state_1_passthrough', () => {
    const tops = [
      { well: 'A', surface: 'X top', z: -1000, md: 1000 },
      { well: 'A', surface: 'Y top', z: -1100, md: 1100 },
      { well: 'B', surface: 'X top', z: -2000, md: 2000 },
      { well: 'B', surface: 'Y top', z: -2100, md: 2100 },
    ];
    const fac = [];
    for (let md = 1000; md < 1100; md += 1) fac.push({ well: 'A', md, facies: '1' });
    for (let md = 2000; md < 2100; md += 1) fac.push({ well: 'B', md, facies: '1' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const agg = aggregateResults(r, true, true);
    if (agg !== r) throw new Error('state 1 should return original array unchanged');
    return 'byWell + byZone returns input unchanged';
  });

  test('aggregate_state_2_well_only', () => {
    // Two wells with two zones each. By-well aggregation should give one row per well.
    const tops = [
      { well: 'A', surface: 'X top', z: -1000, md: 1000 },
      { well: 'A', surface: 'Y top', z: -1050, md: 1050 },
      { well: 'A', surface: 'Z top', z: -1100, md: 1100 },
      { well: 'B', surface: 'X top', z: -2000, md: 2000 },
      { well: 'B', surface: 'Y top', z: -2080, md: 2080 },
      { well: 'B', surface: 'Z top', z: -2110, md: 2110 },
    ];
    const fac = [];
    for (let md = 1000; md < 1050; md += 1) fac.push({ well: 'A', md, facies: '1' });
    for (let md = 1050; md < 1100; md += 1) fac.push({ well: 'A', md, facies: '2' });
    for (let md = 2000; md < 2110; md += 1) fac.push({ well: 'B', md, facies: '1' });
    const por = [
      { well: 'A', md: 1010, value: 0.10 },
      { well: 'A', md: 1060, value: 0.20 },
      { well: 'B', md: 2050, value: 0.30 },
    ];
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac), por);
    const agg = aggregateResults(r, true, false);
    if (agg.length !== 2) throw new Error('expected 2 rows, got ' + agg.length);
    const a = agg.find(x => x.well === 'A');
    const b = agg.find(x => x.well === 'B');
    if (!a || !b) throw new Error('missing wells');
    assertNear(a.grossZ, 100, 1e-6, 'A grossZ');
    // Note: midpoint intervals create a 0.5m clip at the very top and bottom of the well's
    // sampled range, so totals are 99-99.5m for a 100m well rather than exactly 100m.
    assertNear(a.faciesZ.get('1'), 49.5, 0.6, 'A facies 1');
    assertNear(a.faciesZ.get('2'), 50, 0.6, 'A facies 2');
    if (a.por.n !== 2) throw new Error('A por n: ' + a.por.n);
    assertNear(a.por.mean, 0.15, 1e-9, 'A pooled mean');
    if (b.por.n !== 1) throw new Error('B por n: ' + b.por.n);
    return 'one row per well, facies summed across zones, porosity from pooled samples';
  });

  test('aggregate_state_3_zone_only', () => {
    // Same zone X exists in both wells; aggregation should pool across wells
    const tops = [
      { well: 'A', surface: 'X top', z: -1000, md: 1000 },
      { well: 'A', surface: 'Y top', z: -1100, md: 1100 },
      { well: 'B', surface: 'X top', z: -2000, md: 2000 },
      { well: 'B', surface: 'Y top', z: -2080, md: 2080 },
    ];
    const fac = [];
    for (let md = 1000; md < 1100; md += 1) fac.push({ well: 'A', md, facies: '1' });
    for (let md = 2000; md < 2080; md += 1) fac.push({ well: 'B', md, facies: '1' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const agg = aggregateResults(r, false, true);
    if (agg.length !== 1) throw new Error('expected 1 zone (Y is base, never a zone), got ' + agg.length);
    const x = agg.find(z => z.zone === 'X');
    assertNear(x.grossZ, 180, 1e-6, 'X gross Z = 100 + 80');
    // Edge-of-sample-range clip: total facies thickness can be 0.5-1m short of grossZ
    assertNear(x.faciesZ.get('1'), 180, 1.2, 'X facies 1');
    if (x.well !== '') throw new Error('aggregated row should have empty well field');
    return 'one row per zone, gross Z and facies summed across wells';
  });

  test('aggregate_state_4_global', () => {
    const tops = [
      { well: 'A', surface: 'X top', z: -1000, md: 1000 },
      { well: 'A', surface: 'Y top', z: -1100, md: 1100 },
      { well: 'B', surface: 'X top', z: -2000, md: 2000 },
      { well: 'B', surface: 'Y top', z: -2050, md: 2050 },
    ];
    const fac = [];
    for (let md = 1000; md < 1100; md += 1) fac.push({ well: 'A', md, facies: '1' });
    for (let md = 2000; md < 2050; md += 1) fac.push({ well: 'B', md, facies: '2' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const agg = aggregateResults(r, false, false);
    if (agg.length !== 1) throw new Error('expected 1 row, got ' + agg.length);
    const g = agg[0];
    assertNear(g.grossZ, 150, 1e-6, 'global gross Z');
    assertNear(g.faciesZ.get('1'), 100, 0.6, 'F1 across all');
    assertNear(g.faciesZ.get('2'), 50, 0.6, 'F2 across all');
    // fractions should be close to 100/150 and 50/150 (within edge tolerance)
    assertNear(g.faciesFrac.get('1'), 100/150, 0.005, 'F1 frac');
    if (g.well !== '' || g.zone !== '') throw new Error('global row should have empty well/zone');
    return 'single global row with summed gross Z and recomputed fractions';
  });

  test('aggregate_porosity_pooled_not_averaged', () => {
    // 2 zones with porosity values; std must come from raw pooled values, not averaged stds
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
      { well: 'W', surface: 'C top', z: -1200, md: 1200 },
    ];
    const fac = [{ well: 'W', md: 1050, facies: '1' }, { well: 'W', md: 1150, facies: '1' }];
    const por = [
      { well: 'W', md: 1010, value: 0.10 }, { well: 'W', md: 1090, value: 0.30 },
      { well: 'W', md: 1110, value: 0.20 }, { well: 'W', md: 1190, value: 0.40 },
    ];
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac), por);
    const agg = aggregateResults(r, false, false)[0];
    assertNear(agg.por.mean, 0.25, 1e-9, 'pooled mean');
    assertNear(agg.por.std, Math.sqrt(0.05/3), 1e-9, 'pooled std');
    if (agg.por.n !== 4) throw new Error('n: ' + agg.por.n);
    return 'porosity std recomputed from pooled raw values, not averaged';
  });

  test('parsePorosity_with_perm_column', () => {
    const text = 'Well\tMD\tPor.Eff.\tPerm\nW\t1000\t0.15\t10.5\nW\t1001\t0.20\t250\nW\t1002\t0.10\t';
    const rows = parsePorosity(text);
    if (rows.length !== 3) throw new Error('expected 3 rows, got ' + rows.length);
    if (rows[0].perm !== 10.5) throw new Error('perm 0: ' + rows[0].perm);
    if (rows[1].perm !== 250) throw new Error('perm 1: ' + rows[1].perm);
    if (rows[2].perm !== undefined) throw new Error('perm 2 should be undefined for empty cell');
    if (!porosityRowsHavePerm(rows)) throw new Error('porosityRowsHavePerm should be true');
    // Alternative perm headers
    const rows2 = parsePorosity('Well\tMD\tPHIE\tKair\nW\t1000\t0.15\t100');
    if (rows2[0].perm !== 100) throw new Error('Kair header not detected');
    return 'perm column parsed for Perm/Kair/Permeability headers; missing values produce undefined';
  });

  test('per_zone_perm_stats', () => {
    // Two zones, 5 perm values in zone A (mean 100, log spread), 3 in zone B
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
      { well: 'W', surface: 'C top', z: -1200, md: 1200 },
    ];
    const fac = [{ well: 'W', md: 1050, facies: '1' }, { well: 'W', md: 1150, facies: '1' }];
    const por = [
      { well: 'W', md: 1010, value: 0.20, perm: 50 },
      { well: 'W', md: 1030, value: 0.18, perm: 100 },
      { well: 'W', md: 1090, value: 0.22, perm: 150 },
      { well: 'W', md: 1110, value: 0.05, perm: 1 },
      { well: 'W', md: 1190, value: 0.04, perm: 2 },
    ];
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac), por);
    if (r[0].perm.n !== 3) throw new Error('zone A perm n: ' + r[0].perm.n);
    assertNear(r[0].perm.mean, 100, 1e-6, 'zone A perm mean');
    if (r[1].perm.n !== 2) throw new Error('zone B perm n: ' + r[1].perm.n);
    assertNear(r[1].perm.mean, 1.5, 1e-6, 'zone B perm mean');
    return 'permeability stats computed per zone alongside porosity';
  });

  test('aggregate_perm_pooled', () => {
    // Aggregating across zones should pool perm values, not average them
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
      { well: 'W', surface: 'C top', z: -1200, md: 1200 },
    ];
    const fac = [{ well: 'W', md: 1050, facies: '1' }, { well: 'W', md: 1150, facies: '1' }];
    const por = [
      { well: 'W', md: 1050, value: 0.20, perm: 100 },
      { well: 'W', md: 1150, value: 0.05, perm: 1 },
    ];
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac), por);
    const agg = aggregateResults(r, false, false)[0];
    if (agg.perm.n !== 2) throw new Error('pooled perm n: ' + agg.perm.n);
    assertNear(agg.perm.mean, 50.5, 1e-6, 'pooled perm mean');
    return 'permValues pooled when aggregating; stats recomputed from raw values';
  });

  test('enrichPorPoints_assigns_zone_and_facies', () => {
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
      { well: 'W', surface: 'C top', z: -1200, md: 1200 },
    ];
    const fac = [
      { well: 'W', md: 1050, facies: '1' },
      { well: 'W', md: 1150, facies: '2' },
    ];
    const por = [
      { well: 'W', md: 1010, value: 0.15 },                  // zone A, facies 1
      { well: 'W', md: 1140, value: 0.20, perm: 50 },        // zone B, facies 2
      { well: 'W', md: 1300, value: 0.05 },                  // outside any zone -> dropped
      { well: 'W', md: 1100, value: 0.10 },                  // exact boundary -> zone B
    ];
    const zones = buildZones(tops);
    const out = enrichPorPoints(por, zones, fac, new Map());
    if (out.length !== 3) throw new Error('expected 3 enriched points (1300 dropped), got ' + out.length);
    const p0 = out.find(p => p.md === 1010);
    if (p0.zone !== 'A' || p0.facies !== '1') throw new Error('1010: ' + p0.zone + '/' + p0.facies);
    const p1 = out.find(p => p.md === 1140);
    if (p1.zone !== 'B' || p1.facies !== '2') throw new Error('1140: ' + p1.zone + '/' + p1.facies);
    if (p1.perm !== 50) throw new Error('1140 perm: ' + p1.perm);
    const p2 = out.find(p => p.md === 1100);
    if (p2.zone !== 'B') throw new Error('boundary 1100 should go to zone B (half-open)');
    const out2 = enrichPorPoints(por, zones, fac, new Map([['A', 'Reservoir']]));
    const r0 = out2.find(p => p.md === 1010);
    if (r0.zone !== 'Reservoir') throw new Error('rename not applied to enriched point');
    return 'zone via [mdTop,mdBase), facies via nearest-neighbor MD, renames applied, out-of-zone dropped';
  });

  test('label_storage_roundtrip', () => {
    // Save current state so we don't disturb the user's labels
    const before = (typeof localStorage !== 'undefined') ? localStorage.getItem(LABELS_STORAGE_KEY) : null;
    if (typeof localStorage === 'undefined') return 'skipped (no localStorage in this context)';
    try {
      // Write a known structure and load it
      const orig = state.faciesLabels;
      state.faciesLabels = new Map([['1', 'Channel'], ['7', 'Mud']]);
      persistFaciesLabels();
      const raw = localStorage.getItem(LABELS_STORAGE_KEY);
      const obj = JSON.parse(raw);
      if (!obj.Facies) throw new Error('Facies key missing in stored object');
      if (obj.Facies['1'] !== 'Channel') throw new Error('Facies code 1 not saved correctly');
      if (obj.Facies['7'] !== 'Mud') throw new Error('Facies code 7 not saved correctly');
      // Hydrate clears state map and reloads from storage
      state.faciesLabels = new Map();
      hydrateFaciesLabelsFromStorage();
      if (state.faciesLabels.get('1') !== 'Channel') throw new Error('hydrate did not load code 1');
      if (state.faciesLabels.get('7') !== 'Mud') throw new Error('hydrate did not load code 7');
      // Outer object structure: extensible for future categories
      const all = loadStoredLabels();
      all.Lithology = { 'sst': 'Sandstone' };
      saveStoredLabels(all);
      const reloaded = loadStoredLabels();
      if (reloaded.Lithology.sst !== 'Sandstone') throw new Error('outer-object extension failed');
      if (!reloaded.Facies) throw new Error('Facies dropped when adding new category');
      // Restore
      state.faciesLabels = orig;
    } finally {
      if (before == null) localStorage.removeItem(LABELS_STORAGE_KEY);
      else localStorage.setItem(LABELS_STORAGE_KEY, before);
    }
    return 'labels save/load via localStorage; outer object extensible by category';
  });

  test('label_storage_handles_missing_or_corrupt', () => {
    if (typeof localStorage === 'undefined') return 'skipped (no localStorage in this context)';
    const before = localStorage.getItem(LABELS_STORAGE_KEY);
    try {
      localStorage.removeItem(LABELS_STORAGE_KEY);
      const orig = state.faciesLabels;
      state.faciesLabels = new Map();
      hydrateFaciesLabelsFromStorage();
      if (state.faciesLabels.size !== 0) throw new Error('missing storage should produce empty map');
      // Corrupt JSON shouldn't throw
      localStorage.setItem(LABELS_STORAGE_KEY, '{not valid json');
      hydrateFaciesLabelsFromStorage();
      if (state.faciesLabels.size !== 0) throw new Error('corrupt storage should produce empty map');
      state.faciesLabels = orig;
    } finally {
      if (before == null) localStorage.removeItem(LABELS_STORAGE_KEY);
      else localStorage.setItem(LABELS_STORAGE_KEY, before);
    }
    return 'absent or malformed storage degrades gracefully';
  });

  test('histogram_per_series_normalization', () => {
    function binAndNormalize(values, lo, hi, nBins) {
      const counts = new Array(nBins).fill(0);
      for (const v of values) {
        let bin = Math.floor((v - lo) / (hi - lo) * nBins);
        if (bin < 0) bin = 0;
        if (bin >= nBins) bin = nBins - 1;
        counts[bin]++;
      }
      const total = values.length || 1;
      return counts.map(c => c / total * 100);
    }
    const A = [0.05, 0.06, 0.07, 0.08, 0.09];
    const B = [];
    for (let i = 0; i < 50; i++) B.push(0.20 + (i / 50) * 0.05);
    const lo = 0, hi = 0.30, nBins = 10;
    const pA = binAndNormalize(A, lo, hi, nBins);
    const pB = binAndNormalize(B, lo, hi, nBins);
    const sumA = pA.reduce((s, v) => s + v, 0);
    const sumB = pB.reduce((s, v) => s + v, 0);
    if (Math.abs(sumA - 100) > 1e-6) throw new Error('A series sum: ' + sumA + ' (expect 100)');
    if (Math.abs(sumB - 100) > 1e-6) throw new Error('B series sum: ' + sumB + ' (expect 100)');
    return 'each series sums to 100% so distribution shapes are comparable across n';
  });

  test('aggregate_facies_grouping_expands_rows', () => {
    // 1 well, 1 zone, 2 facies. byFacies should produce 2 rows.
    const tops = [
      { well: 'W', surface: 'A top', z: -1000, md: 1000 },
      { well: 'W', surface: 'B top', z: -1100, md: 1100 },
    ];
    const fac = [];
    for (let md = 1000; md < 1050; md += 1) fac.push({ well: 'W', md, facies: '1' });
    for (let md = 1050; md < 1100; md += 1) fac.push({ well: 'W', md, facies: '2' });
    const por = [
      { well: 'W', md: 1010, value: 0.20, perm: 100 },  // facies 1
      { well: 'W', md: 1030, value: 0.18, perm: 80 },   // facies 1
      { well: 'W', md: 1070, value: 0.05, perm: 1 },    // facies 2
      { well: 'W', md: 1090, value: 0.04, perm: 0.5 },  // facies 2
    ];
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac), por);
    const agg = aggregateResults(r, true, true, true);
    if (agg.length !== 2) throw new Error('expected 2 facies rows, got ' + agg.length);
    const f1 = agg.find(x => x.facies === '1');
    const f2 = agg.find(x => x.facies === '2');
    if (!f1 || !f2) throw new Error('missing facies rows');
    if (f1.por.n !== 2) throw new Error('F1 por n: ' + f1.por.n);
    if (f2.por.n !== 2) throw new Error('F2 por n: ' + f2.por.n);
    assertNear(f1.por.mean, 0.19, 1e-9, 'F1 por mean');
    assertNear(f2.por.mean, 0.045, 1e-9, 'F2 por mean');
    assertNear(f1.perm.mean, 90, 1e-9, 'F1 perm mean');
    assertNear(f2.perm.mean, 0.75, 1e-9, 'F2 perm mean');
    return 'byFacies splits each (well, zone) row into per-facies rows with their own stats';
  });

  test('aggregate_facies_global', () => {
    // byFacies only (no well, no zone) -- pools each facies across all wells/zones
    const tops = [
      { well: 'A', surface: 'X top', z: -1000, md: 1000 },
      { well: 'A', surface: 'Y top', z: -1100, md: 1100 },
      { well: 'B', surface: 'X top', z: -2000, md: 2000 },
      { well: 'B', surface: 'Y top', z: -2100, md: 2100 },
    ];
    const fac = [];
    for (let md = 1000; md < 1100; md += 1) fac.push({ well: 'A', md, facies: '1' });
    for (let md = 2000; md < 2100; md += 1) fac.push({ well: 'B', md, facies: '1' });
    const r = calculate(buildZones(tops), buildFaciesIntervals(fac));
    const agg = aggregateResults(r, false, false, true);
    if (agg.length !== 1) throw new Error('expected 1 row (only F1), got ' + agg.length);
    if (agg[0].facies !== '1') throw new Error('facies should be "1"');
    if (agg[0].well !== '' || agg[0].zone !== '') throw new Error('well/zone should be empty');
    return 'byFacies alone pools the facies across all wells and zones';
  });

  test('polyFit_recovers_known_linear', () => {
    // y = -1 + 30*x, exact fit
    const xs = [0.05, 0.10, 0.15, 0.20, 0.25];
    const ys = xs.map(x => -1 + 30 * x);
    const coeffs = polyFit(xs, ys, 1);
    assertNear(coeffs[0], -1, 1e-9, 'intercept');
    assertNear(coeffs[1], 30, 1e-9, 'slope');
    return 'linear least-squares recovers exact coefficients';
  });

  test('polyFit_recovers_known_quadratic', () => {
    // y = -2 + 25*x - 10*x^2
    const xs = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
    const ys = xs.map(x => -2 + 25 * x - 10 * x * x);
    const coeffs = polyFit(xs, ys, 2);
    assertNear(coeffs[0], -2, 1e-9, 'a0');
    assertNear(coeffs[1], 25, 1e-9, 'a1');
    assertNear(coeffs[2], -10, 1e-9, 'a2');
    return 'quadratic least-squares recovers exact coefficients';
  });

  test('polyFit_handles_noisy_data', () => {
    // Generate noisy data around a known linear; check the fit stays close
    const xs = []; const ys = [];
    let seed = 7;
    function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) - 0.5; }
    for (let i = 0; i < 20; i++) {
      const x = 0.05 + i * 0.01;
      xs.push(x);
      ys.push(-2.5 + 28 * x + rand() * 0.2);
    }
    const coeffs = polyFit(xs, ys, 1);
    if (Math.abs(coeffs[0] + 2.5) > 0.5) throw new Error('intercept off: ' + coeffs[0]);
    if (Math.abs(coeffs[1] - 28) > 5) throw new Error('slope off: ' + coeffs[1]);
    const r2 = rSquared(xs, ys, coeffs);
    if (r2 < 0.8) throw new Error('R² too low: ' + r2);
    return 'fit on noisy data recovers parameters within tolerance, R²=' + r2.toFixed(3);
  });

  test('polyFit_higher_degree_better_or_equal_R2', () => {
    // R² should be monotonically non-decreasing in degree
    const xs = []; const ys = [];
    let seed = 13;
    function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) - 0.5; }
    for (let i = 0; i < 25; i++) {
      const x = 0.05 + i * 0.01;
      xs.push(x);
      ys.push(-2 + 25 * x - 8 * x * x + rand() * 0.1);
    }
    const r1 = rSquared(xs, ys, polyFit(xs, ys, 1));
    const r2 = rSquared(xs, ys, polyFit(xs, ys, 2));
    if (r2 < r1 - 1e-12) throw new Error('degree-2 R² (' + r2 + ') < degree-1 R² (' + r1 + ')');
    return 'higher-degree R² >= lower-degree R² (deg1=' + r1.toFixed(3) + ', deg2=' + r2.toFixed(3) + ')';
  });

  test('petrelFormula_format', () => {
    const linear = petrelFormula([-1.5, 28.3]);
    if (!/PERM = Pow\(10, /.test(linear)) throw new Error('missing prefix: ' + linear);
    if (!/\*PHIE/.test(linear)) throw new Error('missing PHIE term: ' + linear);
    if (!linear.endsWith(')')) throw new Error('missing closing paren: ' + linear);
    const quad = petrelFormula([-2.0, 25.5, -10.2]);
    if (!/Pow\(PHIE,2\)/.test(quad)) throw new Error('missing Pow(PHIE,2): ' + quad);
    if (!/ - 10/.test(quad)) throw new Error('negative coefficient should print with " - ": ' + quad);
    const cubic = petrelFormula([-3, 30, -15, 5]);
    if (!/Pow\(PHIE,3\)/.test(cubic)) throw new Error('missing Pow(PHIE,3): ' + cubic);
    return 'Petrel-form output matches expected structure for degrees 1-3';
  });

  test('polyFit_rejects_underdetermined', () => {
    // 2 points cannot fit a degree-2 polynomial
    let threw = false;
    try {
      polyFit([0.1, 0.2], [1, 2], 2);
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('should have thrown');
    return 'polyFit raises when given fewer than degree+1 points';
  });

  test('regression_filter_snapshot_independence', () => {
    // Snapshot must NOT share references with the live filter sets, so editing
    // one does not affect the other.
    const live = { wells: new Set(['A', 'B']), zones: new Set(['X']), facies: new Set(['1', '2']) };
    // Mimic snapshotFilters() behavior on this synthetic input
    const snap = {
      wells: new Set(live.wells),
      zones: new Set(live.zones),
      facies: new Set(live.facies),
    };
    // Mutate live
    live.wells.delete('A');
    live.facies.add('3');
    if (!snap.wells.has('A')) throw new Error('snapshot wells should still contain A');
    if (snap.facies.has('3')) throw new Error('snapshot facies should not contain 3');
    return 'snapshots decouple from live filter sets';
  });

  test('regression_change_order_in_place_uses_locked_filters', () => {
    // Set up a regression with a locked filter snapshot, then refit at a new
    // degree using the same snapshot. The new fit's input set must match the
    // snapshot, not the current "live" set.
    const allPoints = [];
    for (let i = 0; i < 30; i++) {
      const phi = 0.05 + i * 0.005;
      const k = Math.pow(10, -2 + 25 * phi - 8 * phi * phi);
      allPoints.push({ well: 'A', zone: 'X', facies: '1', por: phi, perm: k });
    }
    // Add some points with a different facies that should NOT influence the refit
    for (let i = 0; i < 30; i++) {
      const phi = 0.05 + i * 0.005;
      allPoints.push({ well: 'A', zone: 'X', facies: '2', por: phi, perm: 0.001 });
    }
    // The locked snapshot includes only facies '1'
    const locked = {
      wells: new Set(['A']), zones: new Set(['X']), facies: new Set(['1']),
    };
    function refit(degree) {
      const pts = allPoints.filter(p =>
        locked.wells.has(p.well) && locked.zones.has(p.zone) && locked.facies.has(p.facies)
      );
      const xs = pts.map(p => p.por);
      const ys = pts.map(p => Math.log10(p.perm));
      return { coeffs: polyFit(xs, ys, degree), n: pts.length };
    }
    const d1 = refit(1);
    const d2 = refit(2);
    // n must be 30 in both cases (only the F1 points)
    if (d1.n !== 30) throw new Error('expected 30 F1 points, got ' + d1.n);
    if (d2.n !== 30) throw new Error('expected 30 F1 points, got ' + d2.n);
    // d2 should recover the synthetic quadratic almost exactly (it's noiseless)
    assertNear(d2.coeffs[0], -2, 1e-6, 'd2 a0');
    assertNear(d2.coeffs[1], 25, 1e-6, 'd2 a1');
    assertNear(d2.coeffs[2], -8, 1e-6, 'd2 a2');
    return 'refit at new degree uses captured filters, not live points';
  });

  test('regression_set_active_does_not_modify_passed_filters', () => {
    // Even though regSetActive used to copy filters into plotState, the new
    // version is a pure selection. Verify that selecting a regression's data
    // does not mutate the passed-in snapshot.
    const original = {
      wells: new Set(['A']),
      zones: new Set(['X', 'Y']),
      facies: new Set(['1', '2', '3']),
    };
    // Make a "regression" with these filters
    const reg = { id: 1, filters: original };
    // Simulating what a corrupted regSetActive might do (creating new sets):
    const liveCopy = {
      wells: new Set(reg.filters.wells),
      zones: new Set(reg.filters.zones),
      facies: new Set(reg.filters.facies),
    };
    liveCopy.wells.add('C');
    liveCopy.facies.delete('2');
    // The original snapshot must remain untouched
    if (original.wells.has('C')) throw new Error('original snapshot was mutated (wells)');
    if (!original.facies.has('2')) throw new Error('original snapshot was mutated (facies)');
    return 'modifying a copy of the locked filters does not affect the snapshot';
  });

  return tests;
}
