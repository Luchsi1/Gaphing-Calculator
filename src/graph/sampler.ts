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
