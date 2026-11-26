// Darstellbare Objekte: jedes PlotItem erzeugt für eine Ansicht die zu zeichnenden Formen (Pixelkoordinaten).
import { type View, xToPx, yToPx, xFromPx } from "./viewport.ts";
import { samplePolylines, sampleParametric } from "./sampler.ts";
import { sampleGrid, contourLines, fillRects } from "./implicit.ts";
import type { Expr } from "../engine/index.ts";

export type Glyph = "circle" | "ring" | "up" | "down" | "diamond" | "square";

export type Shape =
  | { type: "lines"; lines: number[][]; dashed?: boolean }
  | { type: "fillPoly"; polys: number[][] }
  | { type: "fillRects"; rects: number[] }
  | { type: "points"; pts: number[]; glyph?: Glyph };

export type ItemKind = "explicit" | "parametric" | "polar" | "implicit" | "inequality" | "point";

export interface ItemBase {
  id: string;
  line: number;
  color: string;
}

/** Ausdruck einer expliziten Funktion samt Parametern – Grundlage der Funktionsanalyse. */
export interface ItemAnalysis {
  expr: Expr;
  v: string;
  params: Record<string, number>;
}

/** Kurve als Nullstellenmenge F(x, y) = 0 – Grundlage für Schnittpunkte beliebiger Kurven. */
export interface ItemCurve {
  F: Expr;
  params: Record<string, number>;
}

export interface PlotItem extends ItemBase {
  kind: ItemKind;
  analysis?: ItemAnalysis;
  curve?: ItemCurve;
  /** Funktionswert an der Stelle x (nur für explizite Kurven; für Anzeige beim Überfahren). */
  probe?: (x: number) => number;
  draw: (view: View) => Shape[];
}

const sopts = (view: View) => ({
  xFromPx: (p: number) => xFromPx(view, p),
  yToPx: (y: number) => yToPx(view, y),
  width: view.width,
  height: view.height,
});

const popts = (view: View) => ({
  xToPx: (x: number) => xToPx(view, x),
  yToPx: (y: number) => yToPx(view, y),
  width: view.width,
  height: view.height,
});

export function explicitItem(b: ItemBase, f: (x: number) => number, analysis?: ItemAnalysis): PlotItem {
  return { ...b, kind: "explicit", probe: f, analysis, draw: (view) => [{ type: "lines", lines: samplePolylines(f, sopts(view)) }] };
}

export function parametricItem(b: ItemBase, point: (t: number) => [number, number], t0: number, t1: number, kind: ItemKind = "parametric"): PlotItem {
  return { ...b, kind, draw: (view) => [{ type: "lines", lines: sampleParametric(point, t0, t1, popts(view)) }] };
}

export function polarItem(b: ItemBase, r: (theta: number) => number, t0: number, t1: number): PlotItem {
  return parametricItem(b, (t) => { const rr = r(t); return [rr * Math.cos(t), rr * Math.sin(t)]; }, t0, t1, "polar");
}

export function implicitItem(b: ItemBase, h: (x: number, y: number) => number, mask?: (x: number, y: number) => boolean): PlotItem {
  return {
    ...b,
    kind: "implicit",
    draw: (view) => {
      const grid = sampleGrid(h, view, 4);
      return [{ type: "lines", lines: contourLines(grid, h, view, mask) }];
    },
  };
}

export interface Constraint {
  /** F = linke Seite − rechte Seite */
  h: (x: number, y: number) => number;
  op: string;
}

/** Allgemeine Ungleichung (auch Ketten wie 0 < y < x): Füllung per Raster, bei einer Relation zusätzlich der Rand. */
export function inequalityItem(b: ItemBase, cons: Constraint[], mask?: (x: number, y: number) => boolean): PlotItem {
  return {
    ...b,
    kind: "inequality",
    draw: (view) => {
      const grids = cons.map((c) => sampleGrid(c.h, view, 4));
      const shapes: Shape[] = [{ type: "fillRects", rects: fillRects(grids, cons.map((c) => c.op), mask) }];
      if (cons.length === 1) {
        const strict = cons[0].op === "<" || cons[0].op === ">";
        shapes.push({ type: "lines", lines: contourLines(grids[0], cons[0].h, view, mask), dashed: strict });
      }
      return shapes;
    },
  };
}

/** y < g(x) bzw. y > g(x): exakte Füllung zwischen Kurve und Rand (schnell und ohne Rasterkanten). */
export function inequalityExplicitItem(b: ItemBase, g: (x: number) => number, below: boolean, strict: boolean): PlotItem {
  return {
    ...b,
    kind: "inequality",
    probe: g,
    draw: (view) => {
      const lines = samplePolylines(g, sopts(view));
      const edge = below ? view.height + 20 : -20;
      const polys = lines.map((l) => [...l, l[l.length - 2], edge, l[0], edge]);
      return [
        { type: "fillPoly", polys },
        { type: "lines", lines, dashed: strict },
      ];
    },
  };
}

export function pointItem(b: ItemBase, x: number, y: number): PlotItem {
  return {
    ...b,
    kind: "point",
    draw: (view) => {
      const px = xToPx(view, x);
      const py = yToPx(view, y);
      return Number.isFinite(px) && Number.isFinite(py) ? [{ type: "points", pts: [px, py] }] : [];
    },
  };
}
