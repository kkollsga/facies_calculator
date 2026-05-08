"use strict";

// ============================================================
// Saturation-Height Function (SHF) plot panel
// ============================================================
// Becomes available when the porosity log carries all four of:
//   Por.Eff. + Perm + HAFWL + Sw
// Renders Sw on the x-axis vs HAFWL on the y-axis, points colored on a
// rainbow scale by either √(perm/φ) (rock-quality index, default) or φ.
// At most `Max points` samples are drawn — points beyond that are picked at
// random so the plot stays legible on dense logs.
//
// Independent of the cross/histogram panel: it has its own visibility,
// filter chips, and refresh debounce. SE-equation overlay (J/Brooks-Corey)
// is wired as a placeholder for a future session.

const shfState = {
  visible: false,
  filters: { wells: new Set(), zones: new Set(), facies: new Set() },
  // List of saturation-height functions. Each is a Leverett-J equation
  // with its own free coefficients and (optionally edited) constants.
  // Mirrors regState shape on the cross-plot.
  functions: [],
  activeFunctionId: null,
  nextFunctionId: 1,
  // Number of representative (k, φ) lines drawn per visible function —
  // picked at log-spaced color-metric values, snapped to nearest real
  // point. Default 10, max 40.
  lineCount: 10,
  // Constants section: collapsed by default. When expanded, a lock icon
  // appears in the header — click it to make the constants editable.
  // Locked = read-only display; unlocked = editable inputs.
  constantsExpanded: false,
  constantsLocked: true,
  // Petrel-style equations section, collapsed by default. When open
  // shows the full chain with current parameter values substituted —
  // copy-paste-friendly for Petrel calculator.
  equationsExpanded: false,
  // Exponent applied to RQI (or perm for the perm method) when
  // weighting points in the R² calculation. 0 = unweighted standard
  // R²; positive values bias the readout toward high-RQI / high-perm
  // rocks, where the fit quality usually matters most.
  r2Bias: 0,
  // ML fit algorithm:
  //   'linear'  — log-space linearised 2-stage solve + short coord-descent
  //               refinement. Fast, robust on typical data.
  //   'coord'   — pure coordinate descent + golden-section search on
  //               weighted SSE, no log linearisation. Slower; better
  //               when log-linear assumptions are bad (e.g. heavy
  //               low-Sw clipping).
  //   'mcmc'    — adaptive Metropolis-Hastings (port of leverett-j).
  //               Slower; produces P10/P50/P90 uncertainty bands shown
  //               on each slider's track.
  fitAlgo: 'linear',
  // Whether ML fit randomises the free coefficients before dispatching
  // to the algorithm. ON (default) means each click explores a fresh
  // basin; OFF warm-starts from the current parameter values.
  randomizeFit: true,
  // Fixed √(k/φ) range that line representatives are picked within.
  // Decouples line positions from the visible color-band p05/p95, so
  // lines stay at consistent rock-quality values across filter changes.
  // Empty / null = fall back to data extremes.
  lineRangeLo: 1,
  lineRangeHi: 40,
};

// ============================================================
// Leverett-J saturation chain (matches /Koding/HTML/leverett-j formulation)
// ============================================================
//   RQI    = λ · √(k/φ)
//   Swirr  = c · RQI^d                             (RQI method)
//   Swirr  = c_perm · k^d_perm                     (perm method)
//   Pc     = fpc · (0.001 · Δρ · g · h) / γpc      (psi from height m)
//   J      = κ · (Pc / (γ · cos ω)) · √(k/φ)
//   Sw     = Swirr + (1 − Swirr) · a · J^b

const SHF_DEFAULT_PARAMS = {
  // Free (fittable) — defaults from the leverett-j project's "Cerisa Main"
  a: 0.22434, b: -0.82188,
  c: 0.33714, d: -1.05865,
  c_perm: 0.1, d_perm: -0.1,
  // Constants (rarely fit, but editable when "Show constants" is on)
  gamma: 30, gammapc: 22, omega: 30,
  deltarho: 266, g: 9.81, fpc: 3.141533543,
  kappa: 0.2166, lambda: 0.0314,
};

const SHF_PARAM_RANGES = {
  a:        { min: 0,     max: 0.5,   step: 0.000001,label: 'a',   desc: 'Sw(J) prefactor' },
  b:        { min: -2,    max: 0,     step: 0.000001,label: 'b',   desc: 'Sw(J) exponent' },
  c:        { min: 0,     max: 1,     step: 0.000001,label: 'c',   desc: 'Swirr prefactor' },
  d:        { min: -2,    max: 0,     step: 0.000001,label: 'd',   desc: 'Swirr exponent' },
  c_perm:   { min: 0,     max: 1,     step: 0.000001,label: 'cₚ',  desc: 'Swirr-Perm prefactor' },
  d_perm:   { min: -2,    max: 0,     step: 0.000001,label: 'dₚ',  desc: 'Swirr-Perm exponent' },
  gamma:    { min: 10,    max: 50,    step: 1,       label: 'γ',   desc: 'Interfacial tension (J)' },
  gammapc:  { min: 10,    max: 50,    step: 1,       label: 'γₚc', desc: 'Interfacial tension (Pc)' },
  omega:    { min: 0,     max: 90,    step: 1,       label: 'ω',   desc: 'Contact angle (°)' },
  deltarho: { min: 100,   max: 500,   step: 1,       label: 'Δρ',  desc: 'Density contrast (kg/m³)' },
  g:        { min: 9.8,   max: 9.82,  step: 0.001,   label: 'g',   desc: 'Gravity' },
  fpc:      { min: 2,     max: 4,     step: 0.000001,label: 'fₚc', desc: 'Pc unit factor' },
  kappa:    { min: 0.1,   max: 0.5,   step: 0.0001,  label: 'κ',   desc: 'J unit factor' },
  lambda:   { min: 0.01,  max: 0.1,   step: 0.0001,  label: 'λ',   desc: 'RQI scale factor' },
};

// Free coefficients per Swirr method. The other set is hidden so we don't
// confuse the user with parameters that don't affect their current curve.
const SHF_FREE_PARAMS_RQI  = ['a', 'b', 'c', 'd'];
const SHF_FREE_PARAMS_PERM = ['a', 'b', 'c_perm', 'd_perm'];
const SHF_CONSTANT_PARAMS  = ['gamma', 'gammapc', 'omega', 'deltarho', 'g', 'fpc', 'kappa', 'lambda'];

// 6-color palette for distinct function pills. Reuses the cross-plot's
// regression palette so the visual language stays consistent.
const SHF_FN_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d68910', '#16a085'];

function _shfRqi(perm, por, params) {
  return params.lambda * Math.sqrt(perm / Math.max(1e-12, por));
}
function _shfSwirrFromRqi(rqi, params) {
  return params.c * Math.pow(Math.max(1e-12, rqi), params.d);
}
function _shfSwirrFromPerm(perm, params) {
  return params.c_perm * Math.pow(Math.max(1e-12, perm), params.d_perm);
}
function _shfPcFromHeight(h, params) {
  return params.fpc * (0.001 * params.deltarho * params.g * h) / params.gammapc;
}
function _shfJ(pc, perm, por, params) {
  const omRad = params.omega * Math.PI / 180;
  return params.kappa * (pc / (params.gamma * Math.cos(omRad)))
       * Math.sqrt(perm / Math.max(1e-12, por));
}
function _shfSwFromJ(swirr, j, params) {
  return swirr + (1 - swirr) * params.a * Math.pow(Math.max(1e-12, j), params.b);
}

// Predict Sw at a given (por, perm, hafwl). Returns NaN only when an
// input is invalid; everywhere else we clamp to a physical range so the
// R² readout and curve overlay degrade gracefully when params produce
// out-of-band values (instead of silently dropping the point / line).
function _shfPredictSw(por, perm, hafwl, params, method) {
  if (!(por > 0) || !(perm > 0)) return NaN;
  let swirr;
  if (method === 'perm') swirr = _shfSwirrFromPerm(perm, params);
  else                   swirr = _shfSwirrFromRqi(_shfRqi(perm, por, params), params);
  if (!Number.isFinite(swirr)) return NaN;
  // Clamp Swirr — values > 1 mean "rock is at irreducible water", values
  // < 0 are unphysical. Either way the chain still produces a defined Sw.
  swirr = Math.max(0, Math.min(1, swirr));
  if (!Number.isFinite(hafwl) || hafwl <= 0) return 1;  // water leg
  const pc = _shfPcFromHeight(hafwl, params);
  if (!Number.isFinite(pc) || pc <= 0) return NaN;
  const j = _shfJ(pc, perm, por, params);
  if (!Number.isFinite(j) || j <= 0) return NaN;
  let sw = _shfSwFromJ(swirr, j, params);
  if (!Number.isFinite(sw)) return NaN;
  return Math.max(0, Math.min(1, sw));
}

// Weighted SSE on Sw, used as the loss for every ML algorithm. Two
// weight terms compose:
//   1. 1 / Sw² — pulls the irreducible-water asymptote into the fit so
//      the long low-Sw tail isn't drowned by the high-Sw front.
//   2. metric^bias (RQI for the rqi method, perm for the perm method) —
//      bias slider's exponent. 0 = neutral; positive values push the
//      optimiser toward good-quality rock, mirroring what R² uses, so
//      the loss being minimised matches the readout.
function _shfWeightedSse(points, params, method) {
  const bias = Number.isFinite(shfState.r2Bias) ? Math.max(0, shfState.r2Bias) : 0;
  let s = 0, n = 0;
  for (const p of points) {
    const pred = _shfPredictSw(p.por, p.perm, p.hafwl, params, method);
    if (!Number.isFinite(pred)) continue;
    let w = 1 / Math.max(1e-4, p.sw * p.sw);
    if (bias > 0) {
      const m = method === 'perm' ? p.perm : _shfRqi(p.perm, p.por, params);
      if (m > 0) w *= Math.pow(m, bias);
    }
    const d = pred - p.sw;
    s += w * d * d;
    n++;
  }
  return n >= 3 ? s : Infinity;
}

// R² with optional high-RQI / high-perm bias. Weights = metric^bias
// where metric is RQI (or perm for the perm method). Bias = 0 → equal
// weights = standard R². Higher bias makes the readout favour fits
// over good-quality rock. Mean, SSres, and SStot are all computed
// against the same weighted subset so the residual decomposition stays
// internally consistent.
function _shfRSquared(points, params, method) {
  if (!points || points.length === 0) return { r2: 0, n: 0 };
  const bias = Number.isFinite(shfState.r2Bias) ? Math.max(0, shfState.r2Bias) : 0;
  const valid = [];
  for (const p of points) {
    const pred = _shfPredictSw(p.por, p.perm, p.hafwl, params, method);
    if (!Number.isFinite(pred)) continue;
    let w = 1;
    if (bias > 0) {
      const m = method === 'perm' ? p.perm : _shfRqi(p.perm, p.por, params);
      if (m > 0) w = Math.pow(m, bias);
    }
    valid.push({ sw: p.sw, pred, w });
  }
  if (valid.length === 0) return { r2: 0, n: 0 };
  let sumW = 0, sumWSw = 0;
  for (const v of valid) { sumW += v.w; sumWSw += v.w * v.sw; }
  const wmean = sumW > 0 ? sumWSw / sumW : 0;
  let sse = 0, sst = 0;
  for (const v of valid) {
    const r = v.sw - v.pred, t = v.sw - wmean;
    sse += v.w * r * r;
    sst += v.w * t * t;
  }
  // R² can go negative when the model is worse than the (weighted)
  // mean — surface as-is so the user sees they need to refit.
  const r2 = sst > 0 ? (1 - sse / sst) : 0;
  return { r2, n: valid.length };
}

// 1-D golden-section minimum within [lo, hi]. Pure JS so the panel doesn't
// need a numeric library; converges in ~30 iterations to 1e-5 of (hi-lo).
function _goldenSectionMin(f, lo, hi, tol) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c), fd = f(d);
  let iters = 0;
  while ((b - a) > tol && iters < 80) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = f(c); }
    else         { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = f(d); }
    iters++;
  }
  return (a + b) / 2;
}

// Weighted linear regression y = α + β · x, weights ω. Returns {a: α, b: β}
// or null if degenerate. Standard normal equations, weighted variant.
function _wlinFit(pts) {
  let sw_ = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
  for (const p of pts) {
    const w = p.w || 1;
    sw_ += w; swx += w*p.x; swy += w*p.y;
    swxx += w*p.x*p.x; swxy += w*p.x*p.y;
  }
  const denom = sw_*swxx - swx*swx;
  if (Math.abs(denom) < 1e-12) return null;
  const beta  = (sw_*swxy - swx*swy) / denom;
  const alpha = (swy - beta*swx) / sw_;
  return { a: alpha, b: beta };
}

// Clamp a value to a parameter's [min, max] range.
function _clampToRange(v, key) {
  const r = SHF_PARAM_RANGES[key];
  return Math.max(r.min, Math.min(r.max, v));
}

// ML fit dispatcher — picks the algorithm based on shfState.fitAlgo.
// Always async; the linearised + coord-descent paths resolve immediately,
// MCMC yields to the event loop periodically so the UI stays responsive.
async function _shfMlFit(points, startParams, method) {
  const algo = shfState.fitAlgo === 'mcmc'  ? 'mcmc'
             : shfState.fitAlgo === 'coord' ? 'coord'
             : 'linear';
  if (algo === 'mcmc')  return await _shfMlFitMcmc(points, startParams, method);
  if (algo === 'coord') return _shfMlFitCoord(points, startParams, method);
  return _shfMlFitLinear(points, startParams, method);
}

// Linearised 2-stage solve, then a short coordinate-descent refinement.
//
//   Stage 1 — Swirr model (c, d): bin points by RQI (or k for perm
//             method), take the p20 of Sw within each bin as the
//             empirical Swirr asymptote, log-log fit Swirr = c·RQI^d.
//
//   Stage 2 — J model (a, b): with Swirr now known per point, the chain
//             linearises: log((Sw − Swirr)/(1 − Swirr)) = log(a) + b·log(J).
//             Weighted LS in log-space, weights = 1/Sw².
//
//   Stage 3 — Refinement: small budget of coordinate-descent on weighted
//             SSE in original Sw units to clean up boundary effects from
//             the log-space fit.
//
// Constants (γ, γpc, ω, Δρ, g, fpc, κ, λ) are not touched.
function _shfMlFitLinear(points, startParams, method) {
  if (!points || points.length < 5) return null;
  const params = Object.assign({}, startParams);

  // ----- Stage 1: Swirr asymptote model -----
  const isPerm = method === 'perm';
  const xKey = isPerm ? 'perm' : null;   // perm: use k as predictor
  const stage1Pts = [];
  for (const p of points) {
    const xVal = isPerm ? p.perm : _shfRqi(p.perm, p.por, params);
    if (!(xVal > 0)) continue;
    if (!(p.sw > 0 && p.sw < 1)) continue;
    stage1Pts.push({ x: xVal, sw: p.sw });
  }
  if (stage1Pts.length >= 5) {
    stage1Pts.sort((a, b) => a.x - b.x);
    const nBins = Math.max(3, Math.min(10, Math.floor(stage1Pts.length / 5)));
    const binPts = [];
    for (let i = 0; i < nBins; i++) {
      const lo = Math.floor(i * stage1Pts.length / nBins);
      const hi = Math.floor((i + 1) * stage1Pts.length / nBins);
      const slice = stage1Pts.slice(lo, hi);
      if (slice.length === 0) continue;
      // p20 of Sw in this bin → asymptote estimate for that x bucket.
      // Median x as bin center.
      const sws = slice.map(s => s.sw).slice().sort((a, b) => a - b);
      const swirr_emp = sws[Math.floor(sws.length * 0.20)];
      const xMid = slice[Math.floor(slice.length / 2)].x;
      if (xMid > 0 && swirr_emp > 0 && swirr_emp < 1) {
        // Stage 1 also honours the high-RQI / high-k bias — fits the
        // Swirr asymptote toward better rock when bias > 0.
        const bias = Number.isFinite(shfState.r2Bias) ? Math.max(0, shfState.r2Bias) : 0;
        const w = bias > 0 ? Math.pow(xMid, bias) : 1;
        binPts.push({ x: Math.log(xMid), y: Math.log(swirr_emp), w });
      }
    }
    const lin = binPts.length >= 3 ? _wlinFit(binPts) : null;
    if (lin) {
      // y = log(c) + d · x  →  c = exp(intercept), d = slope
      const cFit = Math.exp(lin.a);
      const dFit = lin.b;
      if (Number.isFinite(cFit) && Number.isFinite(dFit)) {
        if (isPerm) {
          params.c_perm = _clampToRange(cFit, 'c_perm');
          params.d_perm = _clampToRange(dFit, 'd_perm');
        } else {
          params.c = _clampToRange(cFit, 'c');
          params.d = _clampToRange(dFit, 'd');
        }
      }
    }
  }

  // ----- Stage 2: J model (a, b) -----
  const stage2Pts = [];
  for (const p of points) {
    if (!(p.por > 0 && p.perm > 0 && p.hafwl > 0 && p.sw > 0 && p.sw < 1)) continue;
    let swirr;
    if (isPerm) swirr = params.c_perm * Math.pow(p.perm, params.d_perm);
    else        swirr = params.c * Math.pow(_shfRqi(p.perm, p.por, params), params.d);
    if (!Number.isFinite(swirr)) continue;
    swirr = Math.max(0, Math.min(0.999, swirr));
    if (p.sw <= swirr + 1e-4) continue;   // need Sw > Swirr for log argument > 0
    const pc = _shfPcFromHeight(p.hafwl, params);
    if (!(pc > 0)) continue;
    const j = _shfJ(pc, p.perm, p.por, params);
    if (!(j > 0)) continue;
    const num = (p.sw - swirr) / (1 - swirr);
    if (!(num > 0)) continue;
    // Stage 2 weight = 1/Sw² × metric^bias (mirrors _shfWeightedSse).
    let w2 = 1 / Math.max(1e-4, p.sw * p.sw);
    const bias2 = Number.isFinite(shfState.r2Bias) ? Math.max(0, shfState.r2Bias) : 0;
    if (bias2 > 0) {
      const m = isPerm ? p.perm : _shfRqi(p.perm, p.por, params);
      if (m > 0) w2 *= Math.pow(m, bias2);
    }
    stage2Pts.push({ x: Math.log(j), y: Math.log(num), w: w2 });
  }
  if (stage2Pts.length >= 3) {
    const lin = _wlinFit(stage2Pts);
    if (lin) {
      const aFit = Math.exp(lin.a);
      const bFit = lin.b;
      if (Number.isFinite(aFit)) params.a = _clampToRange(aFit, 'a');
      if (Number.isFinite(bFit)) params.b = _clampToRange(bFit, 'b');
    }
  }

  // ----- Stage 3: short coord-descent refinement on weighted SSE -----
  const free = isPerm ? SHF_FREE_PARAMS_PERM : SHF_FREE_PARAMS_RQI;
  let best = _shfWeightedSse(points, params, method);
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (const k of free) {
      const range = SHF_PARAM_RANGES[k];
      const probe = (v) => {
        const old = params[k]; params[k] = v;
        const s = _shfWeightedSse(points, params, method);
        params[k] = old;
        return s;
      };
      const newVal = _goldenSectionMin(probe, range.min, range.max, (range.max - range.min) * 1e-5);
      const oldVal = params[k];
      params[k] = newVal;
      const s = _shfWeightedSse(points, params, method);
      if (s < best - 1e-12) { best = s; improved = true; }
      else { params[k] = oldVal; }
    }
    if (!improved) break;
  }

  const quality = _shfRSquared(points, params, method);
  return { params, sse: best, r2: quality.r2, n: quality.n };
}

// Coordinate-descent body factored out so the linearised refinement and
// pure coord-descent can share it with their own iteration budgets.
// Returns the final SSE; mutates `params` in place.
function _shfCoordRefine(points, params, method, free, maxPasses, goldTol, breakRel) {
  let best = _shfWeightedSse(points, params, method);
  for (let pass = 0; pass < maxPasses; pass++) {
    const passStart = best;
    for (const k of free) {
      const range = SHF_PARAM_RANGES[k];
      const probe = (v) => {
        const old = params[k]; params[k] = v;
        const s = _shfWeightedSse(points, params, method);
        params[k] = old;
        return s;
      };
      const newVal = _goldenSectionMin(probe, range.min, range.max, (range.max - range.min) * goldTol);
      const oldVal = params[k];
      params[k] = newVal;
      const s = _shfWeightedSse(points, params, method);
      if (s < best) best = s;
      else params[k] = oldVal;
    }
    // Break only when a full pass yielded < breakRel relative improvement,
    // not the first pass that didn't improve. Prevents premature exit when
    // coupled parameters can still claw out small gains on subsequent
    // passes (which is what was making repeated ML-fit clicks keep
    // improving the fit).
    if (passStart > 0 && (passStart - best) < passStart * breakRel) break;
  }
  return best;
}

// Pure coordinate descent + golden-section search with multistart.
// Coord descent is local, so it can stall in a basin that's not the
// global optimum. We run from N random initialisations + the user's
// current params, refine each, and keep the best. Deterministic
// linearised init is a non-starter here (this algo's whole point is
// to skip the linearisation).
function _shfMlFitCoord(points, startParams, method) {
  if (!points || points.length < 5) return null;
  const free = method === 'perm' ? SHF_FREE_PARAMS_PERM : SHF_FREE_PARAMS_RQI;
  function refineFrom(seed) {
    const p = Object.assign({}, seed);
    for (const k of free) {
      const r = SHF_PARAM_RANGES[k];
      p[k] = Math.max(r.min, Math.min(r.max, p[k]));
    }
    const sse = _shfCoordRefine(points, p, method, free, 80, 1e-8, 1e-9);
    return { params: p, sse };
  }
  function randomSeed() {
    const p = Object.assign({}, startParams);
    for (const k of free) {
      const r = SHF_PARAM_RANGES[k];
      p[k] = r.min + Math.random() * (r.max - r.min);
    }
    return p;
  }
  // First candidate is the user's current params (warm-start). Five
  // random restarts on top so we get a fair shot at the global optimum
  // without explosive cost — each restart is ~80 passes × 4 params ×
  // golden-section ≈ a few thousand SSE evaluations, sub-100ms total.
  const candidates = [refineFrom(startParams)];
  for (let i = 0; i < 5; i++) candidates.push(refineFrom(randomSeed()));
  let best = candidates[0];
  for (const c of candidates) if (c.sse < best.sse) best = c;
  const quality = _shfRSquared(points, best.params, method);
  return { params: best.params, sse: best.sse, r2: quality.r2, n: quality.n };
}

// Adaptive Metropolis-Hastings MCMC, mirroring the leverett-j project's
// optimize(). 400 warmup + 1600 sampling iterations of independent
// Gaussian proposals per free parameter. Adapts each parameter's
// proposal σ during warmup to target ~0.4 acceptance. Posterior
// temperature is -(N/2)·log(SSE) so the credible band tracks evidence
// strength. Returns the same shape as the other algorithms (P50 of
// each posterior committed as the value), with an extra `uncertainty`
// map carrying P10/P50/P90 per parameter for future readout.
async function _shfMlFitMcmc(points, startParams, method) {
  if (!points || points.length < 5) return null;
  const free = method === 'perm' ? SHF_FREE_PARAMS_PERM : SHF_FREE_PARAMS_RQI;
  const params = Object.assign({}, startParams);

  // Project starting values into bounds.
  for (const k of free) {
    const r = SHF_PARAM_RANGES[k];
    params[k] = Math.max(r.min, Math.min(r.max, params[k]));
  }

  const N = points.length;
  const sse = () => _shfWeightedSse(points, params, method);
  const logPost = () => {
    const s = sse();
    if (!isFinite(s) || s <= 0) return -Infinity;
    return -(N / 2) * Math.log(s);
  };

  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  let lp = logPost();
  if (!isFinite(lp)) {
    // Fall back to range midpoints if the start point sits at zero
    // likelihood (can happen with extreme defaults vs odd data).
    for (const k of free) {
      const r = SHF_PARAM_RANGES[k];
      params[k] = (r.min + r.max) / 2;
    }
    lp = logPost();
    if (!isFinite(lp)) return null;
  }

  const propSigma = {}, accepted = {}, attempted = {};
  for (const k of free) {
    const r = SHF_PARAM_RANGES[k];
    propSigma[k] = 0.05 * (r.max - r.min);
    accepted[k] = 0;
    attempted[k] = 0;
  }

  const WARMUP = 400, SAMPLE = 1600, TOTAL = WARMUP + SAMPLE;
  const samples = free.map(() => []);
  let yieldCounter = 0;

  for (let it = 0; it < TOTAL; it++) {
    // One Metropolis update per free parameter (component-wise update
    // pattern — robust when the parameters have very different scales).
    for (let i = 0; i < free.length; i++) {
      const k = free[i];
      const r = SHF_PARAM_RANGES[k];
      const oldVal = params[k];
      const proposed = oldVal + gauss() * propSigma[k];
      attempted[k]++;
      if (proposed < r.min || proposed > r.max) continue;
      params[k] = proposed;
      const lpProp = logPost();
      if (Math.log(Math.random()) < lpProp - lp) {
        lp = lpProp;
        accepted[k]++;
      } else {
        params[k] = oldVal;
      }
    }

    // Adapt proposal σ during warmup.
    if (it < WARMUP && it > 0 && it % 50 === 0) {
      for (const k of free) {
        if (attempted[k] === 0) continue;
        const rate = accepted[k] / attempted[k];
        const scale = rate > 0.55 ? 1.3 : rate > 0.45 ? 1.1
                    : rate < 0.25 ? 0.7 : rate < 0.35 ? 0.9 : 1.0;
        const r = SHF_PARAM_RANGES[k];
        propSigma[k] = Math.max(1e-12, Math.min(r.max - r.min, propSigma[k] * scale));
        accepted[k] = 0;
        attempted[k] = 0;
      }
    }

    if (it >= WARMUP) {
      for (let i = 0; i < free.length; i++) samples[i].push(params[free[i]]);
    }

    // Yield every 250 iterations so the UI doesn't freeze.
    if (++yieldCounter >= 250) {
      yieldCounter = 0;
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Posterior summary. Commit P50 as the new value per parameter.
  const percentile = (arr, p) => {
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
    return sorted[idx];
  };
  const round5 = v => (v == null || isNaN(v)) ? v : Math.round(v * 1e5) / 1e5;
  const uncertainty = {};
  for (let i = 0; i < free.length; i++) {
    const k = free[i];
    uncertainty[k] = {
      lo:     round5(percentile(samples[i], 0.10)),
      center: round5(percentile(samples[i], 0.50)),
      hi:     round5(percentile(samples[i], 0.90)),
    };
    params[k] = uncertainty[k].center;
  }

  const quality = _shfRSquared(points, params, method);
  return { params, sse: sse(), r2: quality.r2, n: quality.n, uncertainty };
}

let _shfCategoryFp = null;
// Tracks the last set of categories detected per axis. Used to distinguish
// "brand-new category (default include)" from "previously-known category
// the user explicitly excluded". Cleared on project switch.
let _shfPrevDetected = { wells: [], zones: [], facies: [] };

function resetShfCategoryCache() {
  _shfCategoryFp = null;
  _shfPrevDetected = { wells: [], zones: [], facies: [] };
}

// Reconcile a filter Set against an old vs new detected category list. New
// categories get added (default include). Vanished categories get dropped.
// Categories present in both old and new are left alone — preserving the
// user's include/exclude state.
function _reconcileShfFilter(set, prevDetected, newDetected) {
  const newDet = new Set(newDetected);
  const prevDet = new Set(prevDetected);
  for (const v of [...set]) if (!newDet.has(v)) set.delete(v);
  for (const v of newDetected) if (!prevDet.has(v)) set.add(v);
}

function _shfCategoryFingerprint() {
  if (!lastPorPoints || lastPorPoints.length === 0) return '';
  const w = new Set(), z = new Set(), f = new Set();
  for (const p of lastPorPoints) {
    if (p.well != null) w.add(p.well);
    if (p.zone != null) z.add(p.zone);
    if (p.facies != null) f.add(p.facies);
  }
  return [...w].sort().join('|') + '\x00'
       + [...z].sort().join('|') + '\x00'
       + [...f].sort().join('|');
}

function _updateShfToggleUI() {
  const btn = document.getElementById('shf-toggle-btn');
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(shfState.visible));
  const lbl = btn.querySelector('.collapse-label');
  if (lbl) lbl.textContent = shfState.visible ? 'Hide saturation-height' : 'Show saturation-height';
}

function showShfPanel() {
  document.getElementById('shf-section').style.display = '';
  shfState.visible = true;
  _updateShfToggleUI();
  refreshShfPanel();
  Projects.saveDebounced();
}

function hideShfPanel() {
  document.getElementById('shf-section').style.display = 'none';
  shfState.visible = false;
  _updateShfToggleUI();
  Projects.saveDebounced();
}

// Sync DOM section display to user intent (shfState.visible) AND data
// availability (lastHasShf). Called after init so persisted "visible=true"
// actually restores the section on reload.
function syncShfPanelDisplay() {
  const section = document.getElementById('shf-section');
  if (!section) return;
  if (shfState.visible && lastHasShf) {
    section.style.display = '';
  } else {
    section.style.display = 'none';
  }
  _updateShfToggleUI();
}

function initShfPanel() {
  // Toggle visibility tracks data availability — if any of por/perm/hafwl/sw
  // is missing the SHF panel makes no sense.
  const toggleBtn = document.getElementById('shf-toggle-btn');
  if (toggleBtn) toggleBtn.style.display = lastHasShf ? '' : 'none';
  if (!lastHasShf) {
    document.getElementById('shf-section').style.display = 'none';
    // Don't touch shfState.visible — that's user intent, not derived state.
    _updateShfToggleUI();
    // Don't touch _shfCategoryFp here. SHF availability flickers as the user
    // edits the porosity log (perm column briefly missing, FWL cleared, etc.)
    // and we want filter selections to survive those flickers — not reset.
    return;
  }

  // Smart skip: same categorical structure → leave the user's filter
  // selections alone. Mirrors the pattern in initPlotPanel.
  const newFp = _shfCategoryFingerprint();
  if (newFp === _shfCategoryFp) return;
  _shfCategoryFp = newFp;

  const wells  = uniqueValues(lastPorPoints, 'well');
  const zones  = uniqueValues(lastPorPoints, 'zone');
  const facies = uniqueValues(lastPorPoints, 'facies');
  // Reconcile against the previous detection so user exclusions persist.
  // First time around, _shfPrevDetected is empty → every detected category
  // counts as "brand new" and gets default-included.
  _reconcileShfFilter(shfState.filters.wells,  _shfPrevDetected.wells,  wells);
  _reconcileShfFilter(shfState.filters.zones,  _shfPrevDetected.zones,  zones);
  _reconcileShfFilter(shfState.filters.facies, _shfPrevDetected.facies, facies);
  _shfPrevDetected = { wells, zones, facies };
  _buildShfFilterChips('shf-filter-wells', wells, shfState.filters.wells);
  _buildShfFilterChips('shf-filter-zones', zones, shfState.filters.zones);
  _buildShfFilterChips('shf-filter-facies', facies, shfState.filters.facies, f => {
    const lab = lastLabels && lastLabels.get(f);
    return lab ? (lab + ' (' + f + ')') : ('F' + f);
  });
}

function _buildShfFilterChips(containerId, items, set, labelFn) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:11px;color:var(--ink-soft);font-style:italic;';
    empty.textContent = 'no data';
    c.appendChild(empty);
    return;
  }
  for (const item of items) {
    const chip = document.createElement('span');
    chip.className = 'plot-chip' + (set.has(item) ? ' active' : '');
    chip.textContent = labelFn ? labelFn(item) : String(item);
    chip.dataset.value = String(item);
    chip.addEventListener('click', () => {
      if (set.has(item)) set.delete(item); else set.add(item);
      chip.classList.toggle('active');
      refreshShfPanel();
      Projects.saveDebounced();
    });
    c.appendChild(chip);
  }
}

// All four fields required for an SHF point.
function shfFilteredPoints() {
  return lastPorPoints.filter(p => {
    if (!shfState.filters.wells.has(p.well)) return false;
    if (!shfState.filters.zones.has(p.zone)) return false;
    if (p.facies != null && !shfState.filters.facies.has(p.facies)) return false;
    // HAFWL < 0 means "below the free water level" — those points sit in the
    // water leg, not the SHF transition zone, so they're noise for this plot.
    // Sw == 1 (and Sw > 1 from rounding/error) is also water-leg.
    return p.por != null && isFinite(p.por) && p.por > 0
        && p.perm != null && isFinite(p.perm) && p.perm > 0
        && p.hafwl != null && isFinite(p.hafwl) && p.hafwl >= 0
        && p.sw != null && isFinite(p.sw) && p.sw < 1;
  });
}

// Stratified-by-cell sample over the (Sw, HAFWL, √(k/φ)) space so the plot
// shows the *full solution space*, not just the densest blob.
//
// Strategy:
//   1. Bucket points into a 3D grid. Total cells ≈ n/2. The vertical (RQI)
//      axis is capped at 3 strata so the Sw/HAFWL cells stay narrow enough
//      to resolve features there — XY is sized as sqrt(n / (6)) (so
//      bx · by · 3 ≈ n/2).
//   2. Phase 1 — pick one random point from each occupied cell. Cell order is
//      shuffled so when occupied cells > n we drop random cells (not the
//      ones at the corner of axis-min).
//   3. Phase 2 — fill the remaining budget by uniform random sample over the
//      points NOT yet picked. Uniform sampling from the leftover pool is
//      naturally density-weighted: denser cells contribute more leftovers.
function _stratifiedSample(arr, n) {
  if (arr.length <= n) return arr.slice();

  const xVals = arr.map(p => p.sw);
  const yVals = arr.map(p => p.hafwl);
  const zVals = arr.map(p => Math.sqrt(p.perm / Math.max(1e-12, p.por)));
  const xMin = Math.min.apply(null, xVals), xMax = Math.max.apply(null, xVals);
  const yMin = Math.min.apply(null, yVals), yMax = Math.max.apply(null, yVals);
  const zMin = Math.min.apply(null, zVals), zMax = Math.max.apply(null, zVals);
  const binsXY = Math.max(2, Math.round(Math.sqrt(n / 6)));
  const binsZ = Math.min(3, binsXY);
  const xR = (xMax - xMin) || 1;
  const yR = (yMax - yMin) || 1;
  const zR = (zMax - zMin) || 1;
  const cells = new Map();
  for (let idx = 0; idx < arr.length; idx++) {
    const i = Math.min(binsXY - 1, Math.floor((xVals[idx] - xMin) / xR * binsXY));
    const j = Math.min(binsXY - 1, Math.floor((yVals[idx] - yMin) / yR * binsXY));
    const k = Math.min(binsZ  - 1, Math.floor((zVals[idx] - zMin) / zR * binsZ));
    const key = i + '|' + j + '|' + k;
    let bucket = cells.get(key);
    if (!bucket) { bucket = []; cells.set(key, bucket); }
    bucket.push(arr[idx]);
  }

  const cellKeys = [...cells.keys()];
  for (let i = cellKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cellKeys[i]; cellKeys[i] = cellKeys[j]; cellKeys[j] = tmp;
  }
  const out = [];
  const leftover = [];
  for (const key of cellKeys) {
    const bucket = cells.get(key);
    if (out.length < n) {
      const r = Math.floor(Math.random() * bucket.length);
      out.push(bucket[r]);
      for (let i = 0; i < bucket.length; i++) if (i !== r) leftover.push(bucket[i]);
    } else {
      for (const p of bucket) leftover.push(p);
    }
  }

  const need = n - out.length;
  if (need > 0 && leftover.length > 0) {
    const k = Math.min(need, leftover.length);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (leftover.length - i));
      const tmp = leftover[i]; leftover[i] = leftover[j]; leftover[j] = tmp;
    }
    for (let i = 0; i < k; i++) out.push(leftover[i]);
  }
  return out;
}

// ============================================================
// SHF function management (mirrors regression.js shape on the cross-plot)
// ============================================================
// Each function is one Leverett-J equation with its own free coefficients,
// optional constant overrides, locked filter snapshot for fitting, and a
// visibility flag. The active function is the one whose editor is open.

function _shfFnMakeBlank(name) {
  const id = shfState.nextFunctionId++;
  const colorIdx = (id - 1) % SHF_FN_COLORS.length;
  return {
    id,
    name: name || ('Function ' + id),
    color: SHF_FN_COLORS[colorIdx],
    visible: true,
    // Per-function lock — when true the editor's free coefficients,
    // method radio, constants (always), and ML-fit button become
    // read-only. Toggled via the lock icon on the pill.
    locked: false,
    method: 'rqi',
    params: Object.assign({}, SHF_DEFAULT_PARAMS),
    // Snapshot of the user's filter chips at create-time. Auto-fit and r²
    // only look at points matching this filter so the function stays tied
    // to the data set it was calibrated against.
    filters: {
      wells:  new Set(shfState.filters.wells),
      zones:  new Set(shfState.filters.zones),
      facies: new Set(shfState.filters.facies),
    },
    r2: null, n: 0,
  };
}

function shfFnToggleLocked(id) {
  const fn = shfState.functions.find(f => f.id === id);
  if (!fn) return;
  fn.locked = !fn.locked;
  rebuildShfFunctionsList();
  rebuildShfFunctionEditor();
  Projects.saveDebounced();
}

function shfFnAdd() {
  const fn = _shfFnMakeBlank();
  shfState.functions.push(fn);
  shfState.activeFunctionId = fn.id;
  rebuildShfFunctionsList();
  rebuildShfFunctionEditor();
  refreshShfPanel();
  Projects.saveDebounced();
}

function shfFnDelete(id) {
  const idx = shfState.functions.findIndex(f => f.id === id);
  if (idx < 0) return;
  shfState.functions.splice(idx, 1);
  if (shfState.activeFunctionId === id) shfState.activeFunctionId = null;
  rebuildShfFunctionsList();
  rebuildShfFunctionEditor();
  refreshShfPanel();
  Projects.saveDebounced();
}

function shfFnSetActive(id) {
  shfState.activeFunctionId = (shfState.activeFunctionId === id) ? null : id;
  rebuildShfFunctionsList();
  rebuildShfFunctionEditor();
  Projects.saveDebounced();
}

function shfFnToggleVisibility(id) {
  const fn = shfState.functions.find(f => f.id === id);
  if (!fn) return;
  fn.visible = !fn.visible;
  rebuildShfFunctionsList();
  refreshShfPanel();
  Projects.saveDebounced();
}

function shfFnRename(id, name) {
  const fn = shfState.functions.find(f => f.id === id);
  if (!fn) return;
  fn.name = (name || '').trim() || ('Function ' + id);
  rebuildShfFunctionsList();
  Projects.saveDebounced();
}

function shfFnSetMethod(id, method) {
  const fn = shfState.functions.find(f => f.id === id);
  if (!fn) return;
  const next = method === 'perm' ? 'perm' : 'rqi';
  fn.method = next;
  // Quality changes whenever the chain changes; null it out so stale
  // numbers don't display on the editor. Same for the MCMC uncertainty
  // — it was conditioned on the previous method's free parameters.
  fn.r2 = null; fn.n = 0;
  fn.uncertainty = null;
  // Color metric tracks the Swirr predictor: perm method colors by
  // permeability, RQI method colors by √(k/φ). The user can override
  // afterwards via the Color-by dropdown. Dispatch a change event so
  // any listeners (debugging, persistence) see the value flip.
  const colorEl = document.getElementById('shf-color');
  if (colorEl) {
    const target = next === 'perm' ? 'perm' : 'rqi';
    if (colorEl.value !== target) {
      colorEl.value = target;
      colorEl.dispatchEvent(new Event('change'));
    }
  }
  rebuildShfFunctionEditor();
  refreshShfPanel();
  Projects.saveDebounced();
}

function shfFnSetParam(id, key, value) {
  const fn = shfState.functions.find(f => f.id === id);
  if (!fn) return;
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  fn.params[key] = v;
  // Live-recompute r² so the editor's stat readout follows the slider.
  _shfFnRefreshQuality(fn);
  _updateShfEditorStats();
  _scheduleShfEquationsUpdate();
  refreshShfPanel();
  Projects.saveDebounced();
}

// Use the *current* chip-filtered point set for fitting and quality, not
// the function's locked filter snapshot. This way line representatives,
// r², and ML fit all track whatever the user is looking at right now —
// changing a chip filter immediately recomputes the lines and r² off the
// new (k, φ) distribution. The locked snapshot is preserved on the
// function record for forward compatibility but no longer queried here.
function _shfFnPointsForFit(_fn) {
  return shfFilteredPoints();
}

function _shfFnRefreshQuality(fn) {
  const pts = _shfFnPointsForFit(fn);
  const q = _shfRSquared(pts, fn.params, fn.method);
  fn.r2 = q.r2; fn.n = q.n;
}

// Mutex flag — prevents a second ML-fit click from overlapping the
// first when MCMC is in flight. The button gets disabled too, but on
// rapid clicks (or queued events from before the disable lands) we'd
// otherwise re-enter and stomp on `fn.params` from two chains at once,
// which was making the algos appear to "get stuck" with NaN params.
let _shfMlFitInFlight = false;

async function shfFnMlFit(id) {
  if (_shfMlFitInFlight) return;
  const fn = shfState.functions.find(f => f.id === id);
  if (!fn) return;
  _shfMlFitInFlight = true;
  const pts = _shfFnPointsForFit(fn);

  const isMcmc = shfState.fitAlgo === 'mcmc';
  const fitBtn = document.querySelector('.shf-fn-fit-row .plot-reg-btn');
  if (fitBtn) {
    fitBtn.disabled = true;
    if (isMcmc) fitBtn.textContent = 'Fitting…';
  }
  // Snapshot the user's current params so we can roll back if the run
  // returns NaN — protects later renders / fits from a corrupted chain.
  const startSnap = Object.assign({}, fn.params);
  // Build the start parameters. When the Randomize toggle is on
  // (default), reset every free coefficient to a uniformly-random
  // value within its parameter range — repeated clicks explore
  // different basins. When off, warm-start from the user's current
  // params. Constants stay put either way (they're physical knowns).
  // For MCMC, the adaptive warmup walks from this start.
  const startParams = Object.assign({}, fn.params);
  if (shfState.randomizeFit !== false) {
    const freeKeys = fn.method === 'perm' ? SHF_FREE_PARAMS_PERM : SHF_FREE_PARAMS_RQI;
    for (const k of freeKeys) {
      const r = SHF_PARAM_RANGES[k];
      startParams[k] = r.min + Math.random() * (r.max - r.min);
    }
  }
  let result = null;
  try {
    result = await _shfMlFit(pts, startParams, fn.method);
  } catch (e) {
    setStatus('ML fit failed: ' + e.message, 'error');
    fn.params = startSnap;
  } finally {
    _shfMlFitInFlight = false;
    if (fitBtn) {
      fitBtn.disabled = !!fn.locked;
      fitBtn.textContent = 'ML fit';
    }
  }
  if (!result) {
    const stats = document.getElementById('shf-editor-stats');
    if (stats) {
      stats.style.display = '';
      stats.textContent = 'Not enough samples to fit (need 3+ with por, perm, hafwl, sw < 1).';
    }
    return;
  }
  // Sanity-check the returned params. A NaN slipping through (extreme
  // data, numerical underflow on a long MCMC chain) would break every
  // subsequent fit and render — clamp to defaults instead.
  for (const k of Object.keys(result.params)) {
    if (!Number.isFinite(result.params[k])) {
      result.params[k] = SHF_DEFAULT_PARAMS[k];
    }
  }
  fn.params = result.params;
  fn.r2 = result.r2; fn.n = result.n;
  // MCMC reports posterior P10/P50/P90 per free parameter — stash for
  // future readout (other algorithms leave this null).
  fn.uncertainty = result.uncertainty || null;
  // Refresh the locked filter snapshot to match the user's current
  // selection — most natural workflow is "filter → ML fit".
  fn.filters = {
    wells:  new Set(shfState.filters.wells),
    zones:  new Set(shfState.filters.zones),
    facies: new Set(shfState.filters.facies),
  };
  rebuildShfFunctionEditor();
  rebuildShfFunctionsList();
  refreshShfPanel();
  Projects.saveDebounced();
}

function shfFnSetLineCount(n) {
  const v = Math.max(1, Math.min(40, parseInt(n) || 10));
  shfState.lineCount = v;
  refreshShfPanel();
  Projects.saveDebounced();
}

function shfFnSetR2Bias(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return;
  shfState.r2Bias = Math.max(0, Math.min(5, n));
  // Recompute r² for every function under the new weighting and refresh
  // the active function's editor stat (others read on next render).
  for (const fn of shfState.functions) _shfFnRefreshQuality(fn);
  _updateShfEditorStats();
  Projects.saveDebounced();
}

function shfFnSetAlgo(algo) {
  shfState.fitAlgo = (algo === 'coord' || algo === 'mcmc') ? algo : 'linear';
  Projects.saveDebounced();
}

function shfFnToggleRandomize() {
  shfState.randomizeFit = !shfState.randomizeFit;
  rebuildShfFunctionEditor();
  Projects.saveDebounced();
}

function shfFnToggleConstantsExpanded() {
  shfState.constantsExpanded = !shfState.constantsExpanded;
  rebuildShfFunctionEditor();
  Projects.saveDebounced();
}

function shfFnToggleConstantsLock() {
  shfState.constantsLocked = !shfState.constantsLocked;
  rebuildShfFunctionEditor();
  Projects.saveDebounced();
}

// Monochrome eye icon. open=true draws a normal eye; open=false adds
// a diagonal slash to indicate hidden. stroke="currentColor" so the
// icon adopts the surrounding button color — replaces the ⌀ glyph
// fallback that didn't render consistently across fonts.
function _shfEyeIcon(open) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const outline = document.createElementNS(ns, 'path');
  outline.setAttribute('d', 'M1 7s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z');
  svg.appendChild(outline);
  const pupil = document.createElementNS(ns, 'circle');
  pupil.setAttribute('cx', '7'); pupil.setAttribute('cy', '7'); pupil.setAttribute('r', '1.5');
  svg.appendChild(pupil);
  if (!open) {
    const slash = document.createElementNS(ns, 'line');
    slash.setAttribute('x1', '2'); slash.setAttribute('y1', '2');
    slash.setAttribute('x2', '12'); slash.setAttribute('y2', '12');
    svg.appendChild(slash);
  }
  return svg;
}

// Monochrome lock icon as inline SVG. stroke="currentColor" so it picks
// up the surrounding text color from the parent button — keeps the
// editor's tone consistent (the colored emoji 🔒/🔓 didn't).
function _shfLockIcon(locked) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.25');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const body = document.createElementNS(ns, 'rect');
  body.setAttribute('x', '2.5');
  body.setAttribute('y', '5.5');
  body.setAttribute('width', '7');
  body.setAttribute('height', '5');
  body.setAttribute('rx', '0.6');
  svg.appendChild(body);
  const arc = document.createElementNS(ns, 'path');
  // Closed: shackle finishes back into the body. Open: shackle right
  // leg lifts out to indicate the lock is unlocked.
  arc.setAttribute('d', locked
    ? 'M4 5.5V3.6a2 2 0 0 1 4 0V5.5'
    : 'M4 5.5V3.6a2 2 0 0 1 3.6-1.05');
  svg.appendChild(arc);
  return svg;
}

function shfFnToggleEquationsExpanded() {
  shfState.equationsExpanded = !shfState.equationsExpanded;
  rebuildShfFunctionEditor();
  Projects.saveDebounced();
}

// ============================================================
// SHF function-list rendering (pills + add button)
// ============================================================

function rebuildShfFunctionsList() {
  const list = document.getElementById('shf-fn-list');
  if (!list) return;
  list.innerHTML = '';
  for (const fn of shfState.functions) {
    const pill = document.createElement('div');
    pill.className = 'shf-fn-pill'
      + (fn.id === shfState.activeFunctionId ? ' active' : '')
      + (fn.visible ? '' : ' hidden');
    pill.dataset.id = String(fn.id);

    const swatch = document.createElement('span');
    swatch.className = 'shf-fn-swatch';
    swatch.style.background = fn.color;
    pill.appendChild(swatch);

    const nameEl = document.createElement('span');
    nameEl.className = 'shf-fn-name';
    nameEl.textContent = fn.name;
    pill.appendChild(nameEl);

    pill.addEventListener('click', (e) => {
      // Clicks on the icon buttons (lock / eye / delete) handle their
      // own action; everything else opens the editor for this function.
      if (e.target.closest('.shf-fn-icon')) return;
      shfFnSetActive(fn.id);
    });

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'shf-fn-icon shf-fn-pill-lock' + (fn.locked ? ' locked' : '');
    lockBtn.appendChild(_shfLockIcon(!!fn.locked));
    lockBtn.title = fn.locked ? 'Unlock equation' : 'Lock equation';
    lockBtn.addEventListener('click', (e) => { e.stopPropagation(); shfFnToggleLocked(fn.id); });
    pill.appendChild(lockBtn);

    const visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.className = 'shf-fn-icon shf-fn-vis';
    visBtn.appendChild(_shfEyeIcon(!!fn.visible));
    visBtn.title = fn.visible ? 'Hide overlay' : 'Show overlay';
    visBtn.addEventListener('click', (e) => { e.stopPropagation(); shfFnToggleVisibility(fn.id); });
    pill.appendChild(visBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'shf-fn-icon shf-fn-del';
    delBtn.textContent = '×';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); shfFnDelete(fn.id); });
    pill.appendChild(delBtn);

    list.appendChild(pill);
  }
  // Empty-state hint
  if (shfState.functions.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'shf-fn-empty';
    hint.textContent = 'No saturation-height functions yet.';
    list.appendChild(hint);
  }
}

// ============================================================
// SHF function editor (sliders for the active function)
// ============================================================

function rebuildShfFunctionEditor() {
  const editor = document.getElementById('shf-fn-editor');
  if (!editor) return;
  const fn = shfState.functions.find(f => f.id === shfState.activeFunctionId);
  if (!fn) {
    editor.style.display = 'none';
    editor.innerHTML = '';
    return;
  }
  editor.style.display = '';
  editor.innerHTML = '';

  // Top bar: name input + Swirr-from radio side-by-side. Landscape
  // layout below the plot has plenty of room so we collapse what was
  // previously two stacked rows into one.
  const topbar = document.createElement('div');
  topbar.className = 'shf-fn-topbar';
  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.value = fn.name;
  nameInp.className = 'shf-fn-name-input';
  nameInp.addEventListener('input', () => shfFnRename(fn.id, nameInp.value));
  topbar.appendChild(nameInp);

  const fnLocked = !!fn.locked;
  const methodRow = document.createElement('div');
  methodRow.className = 'shf-fn-method-row';
  const methodLbl = document.createElement('span');
  methodLbl.className = 'shf-fn-method-lbl';
  methodLbl.textContent = 'Swirr from';
  methodRow.appendChild(methodLbl);
  for (const m of ['rqi', 'perm']) {
    const lab = document.createElement('label');
    lab.className = 'shf-fn-method-opt' + (fn.method === m ? ' active' : '')
      + (fnLocked ? ' readonly' : '');
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = 'shf-fn-method-' + fn.id;
    r.value = m;
    r.checked = fn.method === m;
    if (fnLocked) r.disabled = true;
    r.addEventListener('change', () => { if (r.checked) shfFnSetMethod(fn.id, m); });
    lab.appendChild(r);
    lab.appendChild(document.createTextNode(' ' + (m === 'rqi' ? 'RQI' : 'Perm')));
    methodRow.appendChild(lab);
  }
  topbar.appendChild(methodRow);
  editor.appendChild(topbar);

  // Free coefficient rows: slider + numeric input. Pairs map to chain
  // segments — (a, b) drive Sw(J); (c, d) (or c_perm, d_perm in the
  // perm-Swirr method) drive Swirr. A leading row label calls out
  // which segment each pair belongs to.
  const freeKeys = fn.method === 'perm' ? SHF_FREE_PARAMS_PERM : SHF_FREE_PARAMS_RQI;
  const freeWrap = document.createElement('div');
  freeWrap.className = 'shf-fn-sliders';
  const swjLbl = document.createElement('span');
  swjLbl.className = 'shf-fn-coef-row-lbl';
  swjLbl.textContent = 'Sw(J)';
  freeWrap.appendChild(swjLbl);
  freeWrap.appendChild(_shfBuildSliderRow(fn, freeKeys[0], fnLocked));
  freeWrap.appendChild(_shfBuildSliderRow(fn, freeKeys[1], fnLocked));
  const swirrLbl = document.createElement('span');
  swirrLbl.className = 'shf-fn-coef-row-lbl';
  swirrLbl.textContent = 'Swirr';
  freeWrap.appendChild(swirrLbl);
  freeWrap.appendChild(_shfBuildSliderRow(fn, freeKeys[2], fnLocked));
  freeWrap.appendChild(_shfBuildSliderRow(fn, freeKeys[3], fnLocked));
  editor.appendChild(freeWrap);

  // Fit row (top): algorithm dropdown · ML fit button · R² readout · bias slider.
  const fitRow = document.createElement('div');
  fitRow.className = 'shf-fn-fit-row';

  const algoSel = document.createElement('select');
  algoSel.className = 'shf-fn-algo-sel';
  algoSel.title = 'ML fit algorithm';
  for (const opt of [['linear', 'Linearised'], ['coord', 'Coord descent'], ['mcmc', 'MCMC']]) {
    const o = document.createElement('option');
    o.value = opt[0]; o.textContent = opt[1];
    if ((shfState.fitAlgo || 'linear') === opt[0]) o.selected = true;
    algoSel.appendChild(o);
  }
  if (fnLocked) algoSel.disabled = true;
  algoSel.addEventListener('change', () => shfFnSetAlgo(algoSel.value));
  fitRow.appendChild(algoSel);

  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.className = 'plot-reg-btn';
  fitBtn.textContent = 'ML fit';
  if (fnLocked) fitBtn.disabled = true;
  fitBtn.addEventListener('click', () => { if (!fnLocked) shfFnMlFit(fn.id); });
  fitRow.appendChild(fitBtn);

  const stats = document.createElement('div');
  stats.id = 'shf-editor-stats';
  stats.className = 'shf-fn-editor-stats';
  fitRow.appendChild(stats);

  // High-quality-rock bias slider — exponent on RQI/perm in the R² weights.
  const biasGroup = document.createElement('div');
  biasGroup.className = 'shf-fn-bias-group';
  const biasLbl = document.createElement('span');
  biasLbl.className = 'shf-fn-bias-lbl';
  biasLbl.textContent = (fn.method === 'perm' ? 'High-k bias' : 'High-RQI bias');
  biasLbl.title = 'Weight for the R² calc — higher values pull the readout toward good-quality rock.';
  biasGroup.appendChild(biasLbl);
  const biasSlider = document.createElement('input');
  biasSlider.type = 'range';
  biasSlider.className = 'shf-fn-slider shf-fn-bias-slider';
  biasSlider.min = '0'; biasSlider.max = '5'; biasSlider.step = '0.1';
  biasSlider.value = String(shfState.r2Bias || 0);
  biasGroup.appendChild(biasSlider);
  const biasVal = document.createElement('span');
  biasVal.className = 'shf-fn-bias-val';
  biasVal.textContent = (Number(biasSlider.value)).toFixed(1);
  biasGroup.appendChild(biasVal);
  biasSlider.addEventListener('input', () => {
    biasVal.textContent = Number(biasSlider.value).toFixed(1);
    shfFnSetR2Bias(biasSlider.value);
  });
  fitRow.appendChild(biasGroup);

  // Randomize toggle — controls whether shfFnMlFit randomises the free
  // coefficients before each run. ON (default) = explore; OFF = warm-
  // start from current params each click.
  const randBtn = document.createElement('button');
  randBtn.type = 'button';
  randBtn.className = 'shf-fn-rand-toggle' + (shfState.randomizeFit !== false ? ' on' : '');
  randBtn.textContent = 'Randomize';
  randBtn.title = (shfState.randomizeFit !== false)
    ? 'ML fit starts from random params each click — click to disable'
    : 'ML fit warm-starts from current params — click to enable random restarts';
  randBtn.addEventListener('click', shfFnToggleRandomize);
  fitRow.appendChild(randBtn);

  editor.appendChild(fitRow);

  // Toggles row: Constants and Show-equations side-by-side, 50/50.
  const togglesRow = document.createElement('div');
  togglesRow.className = 'shf-fn-toggles';

  const constHead = document.createElement('div');
  constHead.className = 'shf-fn-const-head-wrap';
  const constToggle = document.createElement('button');
  constToggle.type = 'button';
  constToggle.className = 'shf-fn-const-head' + (shfState.constantsExpanded ? ' open' : '');
  constToggle.textContent = (shfState.constantsExpanded ? '▾' : '▸') + ' Constants';
  constToggle.addEventListener('click', shfFnToggleConstantsExpanded);
  constHead.appendChild(constToggle);
  if (shfState.constantsExpanded) {
    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'shf-fn-lock' + (shfState.constantsLocked ? '' : ' open');
    lockBtn.appendChild(_shfLockIcon(shfState.constantsLocked));
    lockBtn.title = shfState.constantsLocked
      ? 'Unlock constants for editing'
      : 'Lock constants';
    lockBtn.addEventListener('click', shfFnToggleConstantsLock);
    constHead.appendChild(lockBtn);
  }
  togglesRow.appendChild(constHead);

  const eqHead = document.createElement('button');
  eqHead.type = 'button';
  eqHead.className = 'shf-fn-const-head' + (shfState.equationsExpanded ? ' open' : '');
  eqHead.textContent = (shfState.equationsExpanded ? '▾' : '▸') + ' Show equations';
  eqHead.addEventListener('click', shfFnToggleEquationsExpanded);
  togglesRow.appendChild(eqHead);

  editor.appendChild(togglesRow);

  if (shfState.constantsExpanded) {
    const constWrap = document.createElement('div');
    constWrap.className = 'shf-fn-constants';
    // Function-level lock overrides the constants section's own lock —
    // when the whole equation is locked, no editing is allowed.
    const constsEditable = !shfState.constantsLocked && !fnLocked;
    for (const k of SHF_CONSTANT_PARAMS) {
      constWrap.appendChild(_shfBuildConstantRow(fn, k, constsEditable));
    }
    editor.appendChild(constWrap);
  }
  if (shfState.equationsExpanded) {
    editor.appendChild(_shfBuildEquationsBlock(fn));
  }

  _updateShfEditorStats();
}

// Row for an editable free coefficient: label · slider · numeric input.
// When `disabled` is true (function-level lock) the controls render but
// can't be moved — keeps layout stable so unlocking doesn't shift cells.
function _shfBuildSliderRow(fn, key, disabled) {
  const range = SHF_PARAM_RANGES[key];
  const row = document.createElement('div');
  row.className = 'shf-fn-slider-row' + (disabled ? ' readonly' : '');

  const lab = document.createElement('span');
  lab.className = 'shf-fn-slider-lbl';
  lab.title = range.desc;
  lab.textContent = range.label;
  row.appendChild(lab);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'shf-fn-slider';
  slider.min = String(range.min);
  slider.max = String(range.max);
  slider.step = String(range.step);
  slider.value = String(fn.params[key]);
  if (disabled) slider.disabled = true;
  // MCMC uncertainty band — paint a slightly darker tone on the track
  // between the posterior P10 and P90 for this parameter. Other
  // algorithms leave fn.uncertainty null, so the slider keeps its
  // plain track in those cases.
  const u = fn.uncertainty && fn.uncertainty[key];
  if (u && Number.isFinite(u.lo) && Number.isFinite(u.hi) && u.hi > u.lo) {
    const span = (range.max - range.min) || 1;
    const lo = Math.max(0, Math.min(100, ((u.lo - range.min) / span) * 100));
    const hi = Math.max(0, Math.min(100, ((u.hi - range.min) / span) * 100));
    // CSS variable resolves correctly inside an inline-style gradient
    // — keeps the band's outer track in sync with the page theme.
    const base = 'var(--rule)';
    const band = 'rgba(40, 38, 32, 0.40)';
    slider.style.background =
      `linear-gradient(to right, ${base} 0%, ${base} ${lo.toFixed(2)}%,`
      + ` ${band} ${lo.toFixed(2)}%, ${band} ${hi.toFixed(2)}%,`
      + ` ${base} ${hi.toFixed(2)}%, ${base} 100%)`;
  }
  row.appendChild(slider);

  const numInp = document.createElement('input');
  numInp.type = 'number';
  numInp.className = 'shf-fn-num';
  numInp.min = String(range.min);
  numInp.max = String(range.max);
  numInp.step = String(range.step);
  numInp.value = _shfFmtParam(fn.params[key]);
  if (disabled) numInp.readOnly = true;
  row.appendChild(numInp);

  if (!disabled) {
    slider.addEventListener('input', () => {
      numInp.value = _shfFmtParam(Number(slider.value));
      shfFnSetParam(fn.id, key, slider.value);
    });
    numInp.addEventListener('input', () => {
      const v = Number(numInp.value);
      if (!Number.isFinite(v)) return;
      const clamped = Math.max(range.min, Math.min(range.max, v));
      slider.value = String(clamped);
      shfFnSetParam(fn.id, key, clamped);
    });
    numInp.addEventListener('blur', () => {
      numInp.value = _shfFmtParam(Number(numInp.value));
    });
  }

  return row;
}

// Constant row: value · symbol. Two columns, value right-aligned on
// the left. When `editable` is true the value cell becomes a subtle
// number input that writes through to fn.params[key]; otherwise it's
// a plain span — no border, no box.
function _shfBuildConstantRow(fn, key, editable) {
  const range = SHF_PARAM_RANGES[key];
  const row = document.createElement('div');
  row.className = 'shf-fn-const-row' + (editable ? ' editable' : '');
  if (editable) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'shf-fn-const-input';
    inp.min = String(range.min);
    inp.max = String(range.max);
    inp.step = String(range.step);
    inp.value = _shfFmtParam(fn.params[key]);
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      const clamped = Math.max(range.min, Math.min(range.max, v));
      shfFnSetParam(fn.id, key, clamped);
    });
    inp.addEventListener('blur', () => { inp.value = _shfFmtParam(Number(inp.value)); });
    row.appendChild(inp);
  } else {
    const valEl = document.createElement('span');
    valEl.className = 'shf-fn-const-val';
    valEl.textContent = _shfFmtParam(fn.params[key]);
    row.appendChild(valEl);
  }
  const lblEl = document.createElement('span');
  lblEl.className = 'shf-fn-const-lbl';
  lblEl.title = range.desc;
  lblEl.textContent = range.label;
  row.appendChild(lblEl);
  return row;
}

// Petrel-friendly formatting for a number — no unnecessary trailing
// zeros, no scientific notation; numbers paste cleanly into the
// Petrel calculator.
function _shfFmtPetrel(v) {
  if (!Number.isFinite(v)) return 'NaN';
  // 6-sig-fig is enough for the parameter ranges we expose.
  let s = Number(v).toPrecision(6);
  // Strip trailing zeros after a decimal point and a trailing dot.
  if (s.indexOf('.') >= 0 && s.indexOf('e') < 0) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  // toPrecision can use scientific for very small/large; for our
  // domain (10^-6 .. 10^3) we don't expect that, but guard anyway.
  if (s.indexOf('e') >= 0) s = Number(v).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// Petrel-style chain text, rebuilt on demand from the function's
// current params. Pulled out of the block builder so the debounced
// updater can rewrite just the <pre> on slider drags without
// reconstructing the surrounding markup.
function _shfEquationLines(fn) {
  const p = fn.params;
  const fmt = _shfFmtPetrel;
  const omegaRad = (p.omega * Math.PI / 180);
  return [
    'RQI = ' + fmt(p.lambda) + ' * Sqrt(Perm / Por)',
    (fn.method === 'perm'
      ? 'Swirr = ' + fmt(p.c_perm) + ' * Pow(Perm, ' + fmt(p.d_perm) + ')'
      : 'Swirr = ' + fmt(p.c) + ' * Pow(RQI, ' + fmt(p.d) + ')'),
    'Pc = ' + fmt(p.fpc) + ' * (0.001 * ' + fmt(p.deltarho) + ' * ' + fmt(p.g) + ' * HAFWL) / ' + fmt(p.gammapc),
    'J = ' + fmt(p.kappa) + ' * (Pc / (' + fmt(p.gamma) + ' * Cos(' + fmt(omegaRad) + '))) * Sqrt(Perm / Por)',
    'Sw = Swirr + (1 - Swirr) * ' + fmt(p.a) + ' * Pow(J, ' + fmt(p.b) + ')',
  ];
}

function _shfBuildEquationsBlock(fn) {
  const wrap = document.createElement('div');
  wrap.className = 'shf-fn-equations';
  const pre = document.createElement('pre');
  pre.className = 'shf-fn-equations-pre';
  pre.textContent = _shfEquationLines(fn).join('\n');
  wrap.appendChild(pre);
  return wrap;
}

// Debounced equations rebuild — slider drags fire many input events,
// no point rewriting the text on every tick. ~120 ms is short enough
// to feel responsive while keeping rebuild churn trivial.
let _shfEquationsTimer = null;
function _scheduleShfEquationsUpdate() {
  if (!shfState.equationsExpanded) return;
  if (_shfEquationsTimer != null) clearTimeout(_shfEquationsTimer);
  _shfEquationsTimer = setTimeout(() => {
    _shfEquationsTimer = null;
    const fn = shfState.functions.find(f => f.id === shfState.activeFunctionId);
    if (!fn) return;
    const pre = document.querySelector('.shf-fn-equations-pre');
    if (!pre) return;
    pre.textContent = _shfEquationLines(fn).join('\n');
  }, 120);
}

function _shfFmtParam(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return v.toFixed(1);
  if (a >= 10)  return v.toFixed(2);
  if (a >= 1)   return v.toFixed(3);
  if (a >= 0.01) return v.toFixed(4);
  return v.toFixed(5);
}

function _updateShfEditorStats() {
  const stats = document.getElementById('shf-editor-stats');
  if (!stats) return;
  const fn = shfState.functions.find(f => f.id === shfState.activeFunctionId);
  if (!fn) { stats.style.display = 'none'; return; }
  if (fn.r2 == null || fn.n === 0) {
    stats.style.display = '';
    stats.textContent = 'No usable samples (need points with por, perm, hafwl, and Sw < 1).';
    return;
  }
  stats.style.display = '';
  // Negative R² means the model fits worse than the mean — surface the
  // value as-is rather than clamping, so the user sees they need to refit.
  stats.textContent = 'R² = ' + fn.r2.toFixed(3) + '   ·   n = ' + fn.n;
}

// Sync editor + list state to the loaded shfState (after applyToUI).
function syncShfFitInputs() {
  for (const fn of shfState.functions) _shfFnRefreshQuality(fn);
  rebuildShfFunctionsList();
  rebuildShfFunctionEditor();
}

// Linear-interpolation percentile (NumPy-default style). Input must be sorted
// ascending. Used to clip color scales to p05/p95 so a handful of error /
// bad-quality samples can't compress the rainbow ramp.
function _percentile(sortedAsc, q) {
  const m = sortedAsc.length;
  if (m === 0) return 0;
  if (m === 1) return sortedAsc[0];
  const pos = q * (m - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] * (hi - pos) + sortedAsc[hi] * (pos - lo);
}

// Rainbow ramp: t ∈ [0,1] mapped to HSL hue from blue (240°) → red (0°).
function _rainbowColor(t) {
  if (!isFinite(t)) t = 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const hue = 240 * (1 - t);
  return 'hsl(' + hue.toFixed(1) + ', 75%, 50%)';
}

let _shfRefreshHandle = null;
function refreshShfPanel() {
  if (_shfRefreshHandle != null) return;
  _shfRefreshHandle = (typeof requestAnimationFrame !== 'undefined')
    ? requestAnimationFrame(_runShfRefresh)
    : setTimeout(_runShfRefresh, 16);
}
function _runShfRefresh() {
  _shfRefreshHandle = null;
  _refreshShfPanelImpl();
}

function _refreshShfPanelImpl() {
  if (!shfState.visible) return;
  const sec = document.getElementById('shf-section');
  if (sec.style.display === 'none') return;

  const pts = shfFilteredPoints();
  // Keep r² for each function in sync with whatever the user currently has
  // selected on the panel (chip filters can change between renders).
  for (const fn of shfState.functions) _shfFnRefreshQuality(fn);
  _updateShfEditorStats();
  const maxInput = document.getElementById('shf-max');
  const maxPts = Math.max(10, parseInt(maxInput.value) || 500);
  const sampled = _stratifiedSample(pts, maxPts);

  const meta = document.getElementById('shf-meta');
  meta.textContent = sampled.length + ' / ' + pts.length + ' samples'
    + (pts.length > maxPts ? ' (random subset)' : '');

  const canvas = document.getElementById('shf-canvas');
  const legend = document.getElementById('shf-legend');
  canvas.innerHTML = '';
  legend.innerHTML = '';

  if (sampled.length === 0) {
    canvas.textContent = pts.length === 0
      ? 'No samples have all of por, perm, HAFWL, and Sw.'
      : 'No samples match current filters.';
    return;
  }
  _renderShfPlot(sampled);
}

function _colorMetric(p, mode) {
  if (mode === 'por')  return p.por;
  if (mode === 'perm') return p.perm;
  // Default 'rqi' — √(perm/φ), the common rock-quality proxy.
  return Math.sqrt(p.perm / p.por);
}

// Lazily create a single hover-tooltip element pinned to the SHF canvas
// wrap. Reused across renders — we only flip display + textContent.
let _shfTooltipEl = null;
function _ensureShfTooltipEl() {
  if (_shfTooltipEl && _shfTooltipEl.isConnected) return _shfTooltipEl;
  const canvas = document.getElementById('shf-canvas');
  const wrap = canvas && canvas.parentElement;
  if (!wrap) return null;
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  _shfTooltipEl = document.createElement('div');
  _shfTooltipEl.className = 'shf-tooltip';
  wrap.appendChild(_shfTooltipEl);
  return _shfTooltipEl;
}

// HTML tooltip body. Two label/value pairs per row in a 4-column grid; the
// well name spans both columns at the top. Values fall back to '—' when
// the source row didn't carry the column.
// Tooltip body for hovering the function-overlay curves. Each line is a
// fixed (por, perm) traversed across HAFWL — so √(k/φ) and Swirr are
// constants of the line, while Sw and HAFWL track the cursor along it.
// Swmov = Sw − Swirr (mobile water saturation).
function _shfLineTooltipHtml(fn, ref, h, sw) {
  const num = (v, d) => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const sqrtKPhi = (ref.por > 0 && ref.perm > 0)
    ? Math.sqrt(ref.perm / ref.por) : null;
  let swirr;
  if (fn.method === 'perm') swirr = fn.params.c_perm * Math.pow(Math.max(1e-12, ref.perm), fn.params.d_perm);
  else                      swirr = fn.params.c * Math.pow(Math.max(1e-12, _shfRqi(ref.perm, ref.por, fn.params)), fn.params.d);
  if (Number.isFinite(swirr)) swirr = Math.max(0, Math.min(1, swirr));
  const swmov = (Number.isFinite(swirr) && Number.isFinite(sw))
    ? Math.max(0, sw - swirr) : null;
  const pairs = [
    ['√(k/φ)', num(sqrtKPhi, 3)],
    ['Swirr',  num(swirr, 4)],
    ['Swmov',  num(swmov, 4)],
    ['Sw',     num(sw, 4)],
    ['HAFWL',  num(h, 2)],
  ];
  let body = '';
  for (const [k, v] of pairs) {
    body += '<span class="tt-k">' + esc(k) + '</span><span class="tt-v">' + esc(v) + '</span>';
  }
  return '<div class="tt-name">' + esc(fn.name) + '</div>'
       + '<div class="tt-grid">' + body + '</div>';
}

function _shfTooltipHtml(p) {
  const num = (v, d) => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const rqi = (p.por != null && p.perm != null && p.por > 0)
    ? Math.sqrt(p.perm / p.por) : null;
  const pairs = [
    ['MD',     num(p.md, 3)],
    ['TVDSS',  num(p.tvdss, 2)],
    ['HAFWL',  num(p.hafwl, 2)],
    ['Sw',     num(p.sw, 4)],
    ['φ',      num(p.por, 4)],
    ['k',      num(p.perm, 3)],
    ['√(k/φ)', num(rqi, 3)],
  ];
  let body = '';
  for (const [k, v] of pairs) {
    body += '<span class="tt-k">' + esc(k) + '</span><span class="tt-v">' + esc(v) + '</span>';
  }
  return '<div class="tt-name">' + esc(p.well) + '</div>'
       + '<div class="tt-grid">' + body + '</div>';
}

function _colorMetricLabel(mode) {
  if (mode === 'por')  return 'Porosity (φ)';
  if (mode === 'perm') return 'Permeability (k)';
  return '√(k/φ)';
}

function _renderShfPlot(points) {
  const colorBy = document.getElementById('shf-color').value;
  const cvalsRaw = points.map(p => _colorMetric(p, colorBy));
  // Color ramp is always log because both metrics (RQI, porosity) span
  // orders of magnitude in well data. If any value is non-positive we
  // fall back to linear so the ramp doesn't NaN.
  const useLog = cvalsRaw.every(v => Number.isFinite(v) && v > 0);
  const cvals = useLog ? cvalsRaw.map(Math.log) : cvalsRaw;
  // p05–p95 percentile clip prevents a handful of error samples from
  // compressing the ramp into a thin band; points beyond the bounds
  // saturate at the ramp ends.
  const sortedC = cvals.slice().sort((a, b) => a - b);
  const cLo = _percentile(sortedC, 0.05);
  const cHi = _percentile(sortedC, 0.95);
  const cRange = (cHi - cLo) || 1;
  // Legend reads in original units; color metric is mapped through the
  // (possibly log) scale to find a point's t in [0, 1] for the rainbow.
  const legendLo = useLog ? Math.exp(cLo) : cLo;
  const legendHi = useLog ? Math.exp(cHi) : cHi;
  // Helper: mapping an original-units color metric value into [0, 1] on
  // the same ramp the points use. Reused for fit-curve coloring + tick
  // markers on the color bar.
  function colorTFromValue(v) {
    if (!Number.isFinite(v)) return 0;
    const x = useLog ? (v > 0 ? Math.log(v) : cLo) : v;
    return Math.max(0, Math.min(1, (x - cLo) / cRange));
  }

  // X = Sw (clipped to [0, max(1, observed)]); Y = HAFWL (linear, low at bottom).
  const xs = points.map(p => p.sw);
  const ys = points.map(p => p.hafwl);
  let xLo = 0;
  let xHi = Math.max(1, Math.max.apply(null, xs));
  // Y-axis pinned at HAFWL = 0 (FWL); below-FWL points are filtered upstream.
  let yLo = 0;
  // Max HAFWL: user override via the input, otherwise the shallowest
  // data point's height. The override lets the user extend the chart
  // upward to inspect the curves' asymptotic Sw → Swirr region beyond
  // the data.
  const maxHafwlInput = document.getElementById('shf-max-hafwl');
  const userMaxHafwl = maxHafwlInput ? Number(maxHafwlInput.value) : NaN;
  let yHi = (Number.isFinite(userMaxHafwl) && userMaxHafwl > 0)
    ? userMaxHafwl
    : Math.max.apply(null, ys);
  if (yHi <= yLo) yHi = yLo + 1;
  // Headroom on top so points don't kiss the axis.
  yHi = yHi + (yHi - yLo) * 0.05;

  const W = 700, H = 460;
  const M = { top: 14, right: 14, bottom: 46, left: 60 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const canvas = document.getElementById('shf-canvas');
  canvas.innerHTML = '';
  // Stale tooltip from a previous render won't get a mouseleave when its
  // circle is removed — hide eagerly so it doesn't hang over the new plot.
  if (_shfTooltipEl) _shfTooltipEl.style.display = 'none';
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' }, canvas);

  const xScale = v => M.left + (v - xLo) / (xHi - xLo) * iw;
  const yScale = v => M.top + ih - (v - yLo) / (yHi - yLo) * ih;

  // Y gridlines + labels
  const yTicks = niceLinearTicks(yLo, yHi, 6);
  for (const t of yTicks) {
    if (t < yLo || t > yHi) continue;
    const y = yScale(t);
    svgEl('line', { x1: M.left, x2: M.left + iw, y1: y, y2: y, stroke: '#e8dec8', 'stroke-width': 1 }, svg);
    const lbl = svgEl('text', { x: M.left - 6, y: y + 3.5, 'text-anchor': 'end', 'font-size': '10', 'font-family': 'IBM Plex Mono, monospace', fill: '#7c7461' }, svg);
    lbl.textContent = fmtTick(t);
  }
  // X gridlines + labels
  const xTicks = niceLinearTicks(xLo, xHi, 5);
  for (const t of xTicks) {
    if (t < xLo || t > xHi) continue;
    const x = xScale(t);
    svgEl('line', { x1: x, x2: x, y1: M.top, y2: M.top + ih, stroke: '#e8dec8', 'stroke-width': 1 }, svg);
    const lbl = svgEl('text', { x: x, y: M.top + ih + 14, 'text-anchor': 'middle', 'font-size': '10', 'font-family': 'IBM Plex Mono, monospace', fill: '#7c7461' }, svg);
    lbl.textContent = fmtTick(t);
  }
  // Axes
  svgEl('line', { x1: M.left, x2: M.left + iw, y1: M.top + ih, y2: M.top + ih, stroke: '#5a5142', 'stroke-width': 1 }, svg);
  svgEl('line', { x1: M.left, x2: M.left, y1: M.top, y2: M.top + ih, stroke: '#5a5142', 'stroke-width': 1 }, svg);
  // Axis labels
  const xLab = svgEl('text', { x: M.left + iw / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': '11', 'font-family': 'IBM Plex Sans, sans-serif', fill: '#3a3528', 'font-weight': '500' }, svg);
  xLab.textContent = 'Water saturation (Sw)';
  const yLab = svgEl('text', { x: 16, y: M.top + ih / 2, 'text-anchor': 'middle', transform: 'rotate(-90 16 ' + (M.top + ih / 2) + ')', 'font-size': '11', 'font-family': 'IBM Plex Sans, sans-serif', fill: '#3a3528', 'font-weight': '500' }, svg);
  yLab.textContent = 'HAFWL';

  // Points. Hover tooltip is a custom HTML overlay (not native SVG <title>)
  // because native tooltips collapse newlines in Chrome/Safari, are slow to
  // appear, and look like OS chrome. The overlay is created once per render
  // alongside the canvas and positioned by mousemove.
  const tip = _ensureShfTooltipEl();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = xScale(p.sw);
    const y = yScale(p.hafwl);
    const t = (cvals[i] - cLo) / cRange;
    const color = _rainbowColor(t);
    const c = svgEl('circle', {
      cx: x, cy: y, r: 3.4,
      fill: color, 'fill-opacity': 0.78,
      stroke: color, 'stroke-opacity': 0.95, 'stroke-width': 0.6,
    }, svg);
    c.addEventListener('mouseenter', () => {
      tip.innerHTML = _shfTooltipHtml(p);
      tip.style.display = 'block';
    });
    c.addEventListener('mousemove', (ev) => {
      const wrap = tip.parentElement;
      const r = wrap.getBoundingClientRect();
      tip.style.left = (ev.clientX - r.left) + 'px';
      tip.style.top  = (ev.clientY - r.top) + 'px';
    });
    c.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  // Leverett-J overlay. For each visible function we draw `lineCount`
  // curves picking representative (k, φ) points at evenly-spaced log
  // values of the color metric. Each curve also gets a wide invisible
  // hit-path layered on top so hover tooltips light up easily.
  const colorBarTicks = [];
  // Tooltip element already obtained above for the points loop; reuse `tip`.
  for (const fn of shfState.functions) {
    if (!fn.visible) continue;
    const fnPts = _shfFnPointsForFit(fn);
    if (fnPts.length === 0) continue;
    // Sample lines in a *fixed* √(k/φ) range so the line positions stay
    // stable across filter / color changes. Default range is 1..40
    // (covers most reservoir-quality rocks); overrides via the line-
    // range inputs in the panel sidebar. The line picker still snaps
    // each target to the nearest real (k, φ) pair in fnPts.
    const lLo = Number(shfState.lineRangeLo);
    const lHi = Number(shfState.lineRangeHi);
    const refs = _shfPickReferencePoints(
      fnPts, 'rqi', shfState.lineCount,
      Number.isFinite(lLo) && lLo > 0 ? lLo : null,
      Number.isFinite(lHi) && lHi > 0 ? lHi : null);
    for (const ref of refs) {
      const cv = _colorMetric(ref, colorBy);
      const t  = colorTFromValue(cv);
      const lineColor = _rainbowColor(t);
      // Walk h, store screen-coord samples + the (h, sw) values so the
      // hover handler can find the closest point and read its values.
      const samples = [];
      let dPath = '';
      const N = 160;
      let started = false;
      for (let i = 0; i <= N; i++) {
        const h = yLo + (yHi - yLo) * (i / N);
        const sw = _shfPredictSw(ref.por, ref.perm, h, fn.params, fn.method);
        if (!Number.isFinite(sw)) continue;
        const x = xScale(Math.max(xLo, Math.min(xHi, sw)));
        const y = yScale(h);
        dPath += (started ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2);
        started = true;
        samples.push({ x, y, h, sw });
      }
      if (!started) continue;
      // Subtle drop-shadow via the CSS filter pipeline (modern browsers
      // apply it on SVG elements). Replaces the previous dark outline
      // path which was too heavy and dirtied the rainbow colors.
      svgEl('path', {
        d: dPath, fill: 'none',
        stroke: lineColor, 'stroke-width': 1.8,
        'stroke-linecap': 'round',
        style: 'filter: drop-shadow(0 1px 1.2px rgba(0, 0, 0, 0.35));',
      }, svg);
      // Wide invisible hit-path so the user doesn't need pixel-perfect
      // hover. Mouse events fire on this; we look up the closest sample
      // and populate the same tooltip overlay used for points.
      const hit = svgEl('path', {
        d: dPath, fill: 'none',
        stroke: 'transparent', 'stroke-width': 12,
        'stroke-linecap': 'round',
      }, svg);
      hit.style.cursor = 'crosshair';
      hit.addEventListener('mousemove', (ev) => {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX; pt.y = ev.clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const local = pt.matrixTransform(ctm.inverse());
        let best = null, bestD = Infinity;
        for (const s of samples) {
          const dx = s.x - local.x, dy = s.y - local.y;
          const d2 = dx*dx + dy*dy;
          if (d2 < bestD) { bestD = d2; best = s; }
        }
        if (!best || !tip) return;
        tip.innerHTML = _shfLineTooltipHtml(fn, ref, best.h, best.sw);
        tip.style.display = 'block';
        const wrap = tip.parentElement;
        const r = wrap.getBoundingClientRect();
        tip.style.left = (ev.clientX - r.left) + 'px';
        tip.style.top  = (ev.clientY - r.top) + 'px';
      });
      hit.addEventListener('mouseleave', () => { if (tip) tip.style.display = 'none'; });
      colorBarTicks.push({ t, label: _shfFmtParam(cv), color: lineColor });
    }
  }

  _renderShfColorBar(_colorMetricLabel(colorBy) + '  (log)', legendLo, legendHi, colorBarTicks);
}

// Pick `n` reference points equally log-spaced in `metric` over the
// [lo, hi] range. Targets are snapped to the nearest *unique* real
// point so dense data with repeats can't collapse multiple targets
// onto the same row. Points outside the range are still allowed as
// snap candidates (so a tighter range than the data extent doesn't
// silently produce zero lines), but only when no in-range point is
// available for a given target.
//
// Falls back to data extremes when lo/hi aren't supplied.
function _shfPickReferencePoints(points, metric, n, lo, hi) {
  if (points.length === 0 || n <= 0) return [];
  const all = [];
  for (const p of points) {
    const v = _colorMetric(p, metric);
    if (Number.isFinite(v) && v > 0) all.push({ p, v });
  }
  if (all.length === 0) return [];
  if (!(lo > 0)) {
    let minV = Infinity; for (const e of all) if (e.v < minV) minV = e.v;
    lo = minV;
  }
  if (!(hi > 0)) {
    let maxV = -Infinity; for (const e of all) if (e.v > maxV) maxV = e.v;
    hi = maxV;
  }
  if (!(hi > lo)) {
    const med = all[Math.floor(all.length / 2)].p;
    return Array(Math.min(n, all.length)).fill(med);
  }
  const lnLo = Math.log(lo);
  const lnHi = Math.log(hi);
  const out = [];
  const used = new Set();
  for (let i = 0; i < n; i++) {
    const q = (n === 1) ? 1 : i / (n - 1);
    const target = Math.exp(lnLo + q * (lnHi - lnLo));
    let bestIdx = -1, bestD = Infinity;
    for (let j = 0; j < all.length; j++) {
      if (used.has(j)) continue;
      const d = Math.abs(all[j].v - target);
      if (d < bestD) { bestD = d; bestIdx = j; }
    }
    if (bestIdx < 0) break;
    used.add(bestIdx);
    out.push(all[bestIdx].p);
  }
  return out;
}

function _renderShfColorBar(label, vMin, vMax, ticks) {
  const legend = document.getElementById('shf-legend');
  const wrap = document.createElement('div');
  wrap.className = 'shf-legend-wrap';

  const titleEl = document.createElement('span');
  titleEl.className = 'shf-legend-title';
  titleEl.textContent = label;
  wrap.appendChild(titleEl);

  const minEl = document.createElement('span');
  minEl.className = 'shf-legend-num';
  minEl.textContent = fmtTick(vMin);
  wrap.appendChild(minEl);

  // Bar-with-ticks: position absolute child markers over the gradient at
  // their normalised t. Each marker is a small triangle pointing at the
  // bar plus a tiny label below.
  const barWrap = document.createElement('span');
  barWrap.className = 'shf-legend-barwrap';
  const swatches = document.createElement('span');
  swatches.className = 'shf-legend-bar';
  const N = 32;
  for (let i = 0; i < N; i++) {
    const s = document.createElement('span');
    s.style.background = _rainbowColor(i / (N - 1));
    swatches.appendChild(s);
  }
  barWrap.appendChild(swatches);
  if (Array.isArray(ticks)) {
    for (const tk of ticks) {
      const mark = document.createElement('span');
      mark.className = 'shf-legend-tick';
      mark.style.left = (tk.t * 100).toFixed(2) + '%';
      mark.title = tk.label;
      barWrap.appendChild(mark);
    }
  }
  wrap.appendChild(barWrap);

  const maxEl = document.createElement('span');
  maxEl.className = 'shf-legend-num';
  maxEl.textContent = fmtTick(vMax);
  wrap.appendChild(maxEl);

  legend.appendChild(wrap);
}
