// Adaptives Abtasten einer Funktion y = f(x) im Pixelraum.
// Erkennt Definitionslücken, Sprungstellen und Polstellen (Asymptoten) und liefert Polylinien ohne Verbindungsstriche darüber.

export interface SampleOptions {
  xFromPx: (px: number) => number;
  yToPx: (y: number) => number;
  width: number;
  height: number;
  /** Anfangsabstand der Stützstellen in Pixeln. */
  step?: number;
  maxDepth?: number;
  /** erlaubte Abweichung der Kurve von der Sehne in Pixeln. */
  tol?: number;
  /** ab dieser Höhe (px) zwischen zwei sehr nahen Punkten gilt die Kurve als unterbrochen. */
  jump?: number;
  /** maximale Anzahl Funktionsauswertungen. */
  budget?: number;
}

const CLAMP = 1e6;
const clamp = (q: number): number => (q < -CLAMP ? -CLAMP : q > CLAMP ? CLAMP : q);

/** Liefert Polylinien als flache Arrays [px0, py0, px1, py1, …] in Pixelkoordinaten. */
export function samplePolylines(f: (x: number) => number, o: SampleOptions): number[][] {
  const step = o.step ?? 2;
  const maxDepth = o.maxDepth ?? 10;
  const tol = o.tol ?? 0.25;
  const jump = o.jump ?? 4;
  const budget = o.budget ?? Math.min(30000, Math.max(2000, Math.round(o.width * 30)));
  const H = o.height;

  let evals = 0;
  const at = (p: number): number => {
    evals++;
    let y: number;
    try {
      y = f(o.xFromPx(p));
    } catch {
      return NaN;
    }
    return o.yToPx(y);
  };

  const lines: number[][] = [];
  let cur: number[] | null = null;
  const emit = (p: number, q: number): void => {
    if (!cur) {
      cur = [];
      lines.push(cur);
    }
    cur.push(p, clamp(q));
  };
  const brk = (): void => {
    cur = null;
  };

  const leaf = (pa: number, qa: number, qb: number, final: boolean): void => {
    const fa = Number.isFinite(qa);
    const fb = Number.isFinite(qb);
    if (fa && fb) {
      emit(pa, qa);
      if (final && Math.abs(qa - qb) > jump) brk();
    } else if (fa) {
      emit(pa, qa);
      brk();
    } else brk();
  };

  const rec = (pa: number, qa: number, pb: number, qb: number, d: number): void => {
    const fa = Number.isFinite(qa);
    const fb = Number.isFinite(qb);
    if (d >= maxDepth || evals >= budget) return leaf(pa, qa, qb, true);
    if (fa && fb) {
      if ((qa < -H && qb < -H) || (qa > 2 * H && qb > 2 * H)) return leaf(pa, qa, qb, false);
      const pm = (pa + pb) / 2;
      const qm = at(pm);
      if (Number.isFinite(qm) && Math.abs(qm - (qa + qb) / 2) <= tol) return leaf(pa, qa, qb, false);
      rec(pa, qa, pm, qm, d + 1);
      rec(pm, qm, pb, qb, d + 1);
      return;
    }
    if (fa || fb) {
      // Rand des Definitionsbereichs: bis zur maximalen Tiefe halbieren
      const pm = (pa + pb) / 2;
      const qm = at(pm);
      rec(pa, qa, pm, qm, d + 1);
      rec(pm, qm, pb, qb, d + 1);
      return;
    }
    // beide Enden undefiniert: schmale definierte Inseln nur grob prüfen
    if (d < 2) {
      const pm = (pa + pb) / 2;
      const qm = at(pm);
      if (Number.isFinite(qm)) {
        rec(pa, qa, pm, qm, d + 1);
        rec(pm, qm, pb, qb, d + 1);
        return;
      }
    }
    brk();
  };

  const start = -2 * step;
  const n = Math.ceil((o.width + 4 * step) / step);
  let pPrev = start;
  let qPrev = at(pPrev);
  for (let i = 1; i <= n; i++) {
    const p = start + i * step;
    const q = at(p);
    rec(pPrev, qPrev, p, q, 0);
    pPrev = p;
    qPrev = q;
  }
  if (Number.isFinite(qPrev)) emit(pPrev, qPrev);
  // einzelne Punkte (z. B. direkt an einer Polstelle) ergeben keine Linie
  return lines.filter((l) => l.length >= 4);
}

// ---------- Parametrische Kurven (auch Polarkurven) ----------
export interface ParamSampleOptions {
  xToPx: (x: number) => number;
  yToPx: (y: number) => number;
  width: number;
  height: number;
  /** Anzahl der Anfangsintervalle. */
  n?: number;
  maxDepth?: number;
  tol?: number;
  jump?: number;
  budget?: number;
}

type P = [number, number] | null;

function chordDist(m: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(m[0] - a[0], m[1] - a[1]);
  return Math.abs((m[0] - a[0]) * dy - (m[1] - a[1]) * dx) / len;
}

/** Tastet t ↦ (x(t), y(t)) auf [t0, t1] adaptiv ab. Liefert Polylinien in Pixelkoordinaten. */
export function sampleParametric(
  point: (t: number) => [number, number],
  t0: number,
  t1: number,
  o: ParamSampleOptions
): number[][] {
  const n = o.n ?? 300;
  const maxDepth = o.maxDepth ?? 12;
  const tol = o.tol ?? 0.25;
  const jump = o.jump ?? 4;
  const budget = o.budget ?? 60000;
  const W = o.width;
  const H = o.height;
  let evals = 0;

  const pt = (t: number): P => {
    evals++;
    let r: [number, number];
    try {
      r = point(t);
    } catch {
      return null;
    }
    const px = o.xToPx(r[0]);
    const py = o.yToPx(r[1]);
    return Number.isFinite(px) && Number.isFinite(py) ? [px, py] : null;
  };

  const lines: number[][] = [];
  let cur: number[] | null = null;
  const emit = (a: [number, number]): void => {
    if (!cur) {
      cur = [];
      lines.push(cur);
    }
    cur.push(clamp(a[0]), clamp(a[1]));
  };
  const brk = (): void => {
    cur = null;
  };
  const off = (a: [number, number], b: [number, number]): boolean =>
    (a[0] < -W && b[0] < -W) || (a[0] > 2 * W && b[0] > 2 * W) || (a[1] < -H && b[1] < -H) || (a[1] > 2 * H && b[1] > 2 * H);

  const leaf = (a: P, b: P, final: boolean): void => {
    if (a && b) {
      emit(a);
      if (final && Math.hypot(a[0] - b[0], a[1] - b[1]) > jump) brk();
    } else if (a) {
      emit(a);
      brk();
    } else brk();
  };

  const rec = (ta: number, a: P, tb: number, b: P, d: number): void => {
    if (d >= maxDepth || evals >= budget) return leaf(a, b, true);
    const tm = (ta + tb) / 2;
    if (a && b) {
      if (off(a, b)) return leaf(a, b, false);
      const m = pt(tm);
      if (m && chordDist(m, a, b) <= tol) {
        if (d >= 2) return leaf(a, b, false);
        const q1 = pt(ta + (tb - ta) / 4);
        const q3 = pt(ta + (3 * (tb - ta)) / 4);
        if (q1 && q3 && chordDist(q1, a, b) <= tol * 1.5 && chordDist(q3, a, b) <= tol * 1.5) return leaf(a, b, false);
      }
      rec(ta, a, tm, m, d + 1);
      rec(tm, m, tb, b, d + 1);
      return;
    }
    if (a || b) {
      const m = pt(tm);
      rec(ta, a, tm, m, d + 1);
      rec(tm, m, tb, b, d + 1);
      return;
    }
    if (d < 2) {
      const m = pt(tm);
      if (m) {
        rec(ta, a, tm, m, d + 1);
        rec(tm, m, tb, b, d + 1);
        return;
      }
    }
    brk();
  };

  let tPrev = t0;
  let pPrev = pt(tPrev);
  for (let i = 1; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const p = pt(t);
    rec(tPrev, pPrev, t, p, 0);
    tPrev = t;
    pPrev = p;
  }
  if (pPrev) emit(pPrev);
  return lines.filter((l) => l.length >= 4);
}
