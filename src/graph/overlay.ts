// Zusatzobjekte für die Analyse: Marker, Hilfslinien (Asymptoten), schattierte Flächen, Tangenten.
import { type View, xToPx, yToPx, xFromPx } from "./viewport.ts";
import { samplePolylines } from "./sampler.ts";
import type { PlotItem, ItemBase, Glyph, Shape } from "./items.ts";
import { type Expr, compile, evalNumber } from "../engine/index.ts";

const finite = Number.isFinite;

export function lineItem(b: ItemBase, f: (x: number) => number, dashed = false): PlotItem {
  return {
    ...b,
    kind: "explicit",
    draw: (view) => [{
      type: "lines",
      dashed,
      lines: samplePolylines(f, {
        xFromPx: (p) => xFromPx(view, p),
        yToPx: (y) => yToPx(view, y),
        width: view.width,
        height: view.height,
      }),
    }],
  };
}

export function markersItem(b: ItemBase, pts: { x: number; y: number }[], glyph: Glyph): PlotItem {
  return {
    ...b,
    kind: "point",
    draw: (view) => {
      const flat: number[] = [];
      for (const p of pts) {
        const px = xToPx(view, p.x);
        const py = yToPx(view, p.y);
        if (finite(px) && finite(py) && px > -20 && px < view.width + 20 && py > -20 && py < view.height + 20) flat.push(px, py);
      }
      return flat.length ? [{ type: "points", pts: flat, glyph }] : [];
    },
  };
}

export type Guide = { kind: "v"; x: number } | { kind: "h"; y: number } | { kind: "line"; m: number; b: number };

/** Senkrechte/waagerechte/schräge Hilfslinien (Asymptoten, vertikale Tangente …). */
export function guidesItem(b: ItemBase, guides: Guide[], dashed = true): PlotItem {
  return {
    ...b,
    kind: "explicit",
    draw: (view) => {
      if (view.xScale === "log" || view.yScale === "log") return [];
      const W = view.width;
      const H = view.height;
      const lines: number[][] = [];
      for (const g of guides) {
        if (g.kind === "v") {
          const px = xToPx(view, g.x);
          if (finite(px)) lines.push([px, -20, px, H + 20]);
        } else if (g.kind === "h") {
          const py = yToPx(view, g.y);
          if (finite(py)) lines.push([-20, py, W + 20, py]);
        } else {
          const x0 = xFromPx(view, -20);
          const x1 = xFromPx(view, W + 20);
          const [y0, y1] = [yToPx(view, g.m * x0 + g.b), yToPx(view, g.m * x1 + g.b)];
          if (finite(y0) && finite(y1)) lines.push([-20, y0, W + 20, y1]);
        }
      }
      return lines.length ? [{ type: "lines", lines, dashed }] : [];
    },
  };
}

/** Fläche zwischen f und g (g = null: x-Achse) über [lo, hi]. */
export function areaItem(b: ItemBase, f: (x: number) => number, g: ((x: number) => number) | null, lo: number, hi: number): PlotItem {
  const [a, c] = lo <= hi ? [lo, hi] : [hi, lo];
  return {
    ...b,
    kind: "inequality",
    draw: (view) => {
      const p0 = xToPx(view, a);
      const p1 = xToPx(view, c);
      if (!finite(p0) || !finite(p1)) return [];
      const n = Math.min(3000, Math.max(8, Math.ceil(Math.abs(p1 - p0) / 2)));
      const polys: number[][] = [];
      let top: number[] = [];
      let bot: number[] = [];
      const flush = (): void => {
        if (top.length >= 4) {
          const rev: number[] = [];
          for (let i = bot.length - 2; i >= 0; i -= 2) rev.push(bot[i], bot[i + 1]);
          polys.push([...top, ...rev]);
        }
        top = [];
        bot = [];
      };
      for (let i = 0; i <= n; i++) {
        const x = a + ((c - a) * i) / n;
        let yf = NaN;
        let yg = 0;
        try {
          yf = f(x);
          yg = g ? g(x) : 0;
        } catch {
          /* undefiniert */
        }
        const px = xToPx(view, x);
        const qf = yToPx(view, yf);
        const qg = yToPx(view, yg);
        if (finite(px) && finite(qf) && finite(qg) && Math.abs(qf) < 1e6 && Math.abs(qg) < 1e6) {
          top.push(px, qf);
          bot.push(px, qg);
        } else flush();
      }
      flush();
      return polys.length ? [{ type: "fillPoly", polys }] : [];
    },
  };
}

/** Gleichung y = f(x) bzw. x = c als Objekt (z. B. Tangente/Normale). */
export function relationItem(b: ItemBase, rel: Expr, params: Record<string, number>, dashed = false): PlotItem | null {
  if (rel.t !== "rel" || rel.ops[0] !== "=") return null;
  const [l, r] = rel.args;
  try {
    if (l.t === "sym" && l.name === "y") {
      const f = compile(r, ["x"], { params });
      return lineItem(b, (x) => f(x), dashed);
    }
    if (l.t === "sym" && l.name === "x") return guidesItem(b, [{ kind: "v", x: evalNumber(r, params) }], dashed);
  } catch {
    return null;
  }
  return null;
}

export type { Shape };
