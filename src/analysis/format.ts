// LaTeX-Darstellung der Analyseergebnisse (exakt oder deutlich als Näherung gekennzeichnet) und Zeilen zum Übernehmen.
import { type Expr, toLatex, numberToLatex, simplify, add, mul, sym, rationalOf } from "../engine/index.ts";
import type { Pt, FunctionAnalysis } from "./function.ts";

export const approx = (x: number, digits = 6): string => numberToLatex(x, digits);

/** Komponente: exakter Ausdruck oder „≈ Zahl“. */
export const comp = (e: Expr | null, x: number): string => (e ? toLatex(e) : `\\approx ${approx(x)}`);

export const pointLatex = (p: Pt): string => `\\left(${comp(p.xExpr, p.x)},\\; ${comp(p.yExpr, p.y)}\\right)`;

/** Punkt als eigene Zeile (exakt, wenn möglich; sonst mit 12 Stellen). */
export const pointLine = (p: Pt): string =>
  `\\left(${p.xExpr ? toLatex(p.xExpr) : numberToLatex(p.x, 12)}, ${p.yExpr ? toLatex(p.yExpr) : numberToLatex(p.y, 12)}\\right)`;

/** Klartext für die Anzeige beim Überfahren. */
export const plainPoint = (p: { x: number; y: number }): string =>
  `(${Number(p.x.toPrecision(6))}, ${Number(p.y.toPrecision(6))})`;

export interface Entry {
  kind: "root" | "min" | "max" | "inflection" | "intercept" | "hole" | "vertical" | "horizontal" | "slant";
  title: string;
  latex: string;
  exact: boolean;
  guess?: string;
  line: string;
  /** Position für Marker (nur Punkte) */
  pt?: Pt;
}

const sideText = (s: "both" | "+" | "-"): string => (s === "both" ? "" : s === "+" ? " (x → +∞)" : " (x → −∞)");

/** Alle Ergebnisse einer Funktionsanalyse als Liste von Einträgen. */
export function entriesOf(a: FunctionAnalysis): Entry[] {
  const out: Entry[] = [];
  const pt = (kind: Entry["kind"], title: string, p: Pt): void => {
    out.push({
      kind, title, latex: pointLatex(p), exact: p.exact, pt: p, line: pointLine(p),
      guess: !p.xExpr && p.xGuess ? `x \\overset{?}{=} ${toLatex(p.xGuess)}` : undefined,
    });
  };
  if (a.yIntercept) pt("intercept", "y-Achsenabschnitt", a.yIntercept);
  a.roots.forEach((p) => pt("root", "Nullstelle", p));
  a.maxima.forEach((p) => pt("max", "Hochpunkt", p));
  a.minima.forEach((p) => pt("min", "Tiefpunkt", p));
  a.inflections.forEach((p) => pt("inflection", "Wendepunkt", p));
  a.holes.forEach((p) => pt("hole", "Definitionslücke", p));
  for (const v of a.vertical) {
    const xe = v.xExpr ? toLatex(v.xExpr) : null;
    out.push({
      kind: "vertical", title: "senkrechte Asymptote", exact: v.exact,
      latex: `x = ${v.exact && xe ? xe : `\\approx ${approx(v.x)}`}`,
      guess: !v.exact && xe ? `x \\overset{?}{=} ${xe}` : undefined,
      line: `x=${xe ?? numberToLatex(v.x, 12)}`,
    });
  }
  for (const h of a.horizontal) {
    const ye = h.yExpr ? toLatex(h.yExpr) : null;
    out.push({
      kind: "horizontal", title: `waagerechte Asymptote${sideText(h.side)}`, exact: h.exact,
      latex: `y = ${h.exact && ye ? ye : `\\approx ${approx(h.y)}`}`,
      guess: !h.exact && ye ? `y \\overset{?}{=} ${ye}` : undefined,
      line: `y=${ye ?? numberToLatex(h.y, 12)}`,
    });
  }
  for (const s of a.slant) {
    const m = s.mExpr ?? rationalOf(s.m);
    const b = s.bExpr ?? rationalOf(s.b);
    const eq = toLatex(simplify(add(mul(m, sym("x")), b)));
    out.push({
      kind: "slant", title: `schräge Asymptote${sideText(s.side)}`, exact: s.exact,
      latex: s.exact ? `y = ${eq}` : `y \\approx ${eq}`,
      line: `y=${eq}`,
    });
  }
  return out;
}
