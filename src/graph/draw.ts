// Zeichnen auf einem 2D-Canvas (Koordinaten in CSS-Pixeln; der Aufrufer setzt die DPR-Transformation).
import { type View, ranges, linearTicks, logTicks, formatTick, xToPx, yToPx } from "./viewport.ts";

export interface Theme {
  bg: string;
  gridMinor: string;
  gridMajor: string;
  axis: string;
  text: string;
}

export const LIGHT: Theme = {
  bg: "#ffffff", gridMinor: "rgba(0,0,0,0.07)", gridMajor: "rgba(0,0,0,0.18)", axis: "rgba(0,0,0,0.7)", text: "#3f3f46",
};
export const DARK: Theme = {
  bg: "#18181b", gridMinor: "rgba(255,255,255,0.08)", gridMajor: "rgba(255,255,255,0.2)", axis: "rgba(255,255,255,0.75)", text: "#d4d4d8",
};

export interface GridOptions {
  show: boolean;
  stepX: number | null;
  stepY: number | null;
}

export interface Curve {
  lines: number[][];
  color: string;
}

const crisp = (p: number): number => Math.round(p) + 0.5;

function label(ctx: CanvasRenderingContext2D, t: Theme, text: string, x: number, y: number): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = t.bg;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = t.text;
  ctx.fillText(text, x, y);
}

export function drawBackground(ctx: CanvasRenderingContext2D, v: View, t: Theme, g: GridOptions): void {
  const W = v.width;
  const H = v.height;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  const r = ranges(v);
  const xt = v.xScale === "log" ? logTicks(r.xMin, r.xMax, v.sx) : linearTicks(r.xMin, r.xMax, v.sx, g.stepX);
  const yt = v.yScale === "log" ? logTicks(r.yMin, r.yMax, v.sy) : linearTicks(r.yMin, r.yMax, v.sy, g.stepY);

  const vline = (x: number): void => {
    const p = crisp(xToPx(v, x));
    ctx.moveTo(p, 0);
    ctx.lineTo(p, H);
  };
  const hline = (y: number): void => {
    const p = crisp(yToPx(v, y));
    ctx.moveTo(0, p);
    ctx.lineTo(W, p);
  };

  if (g.show) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.gridMinor;
    ctx.beginPath();
    xt.minor.forEach(vline);
    yt.minor.forEach(hline);
    ctx.stroke();
    ctx.strokeStyle = t.gridMajor;
    ctx.beginPath();
    xt.major.forEach(vline);
    yt.major.forEach(hline);
    ctx.stroke();
  }

  // Achsen: bei log-Achsen gibt es keine Null; Beschriftung dann am Rand
  const axisPy = v.yScale === "log" ? H : yToPx(v, 0);
  const axisPx = v.xScale === "log" ? 0 : xToPx(v, 0);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = t.axis;
  ctx.beginPath();
  if (v.yScale === "linear" && axisPy >= 0 && axisPy <= H) {
    ctx.moveTo(0, crisp(axisPy));
    ctx.lineTo(W, crisp(axisPy));
  }
  if (v.xScale === "linear" && axisPx >= 0 && axisPx <= W) {
    ctx.moveTo(crisp(axisPx), 0);
    ctx.lineTo(crisp(axisPx), H);
  }
  ctx.stroke();

  ctx.font = "12px system-ui, 'Segoe UI', sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const labelY = Math.min(Math.max(axisPy + 5, 2), H - 16);
  for (const x of xt.major) {
    if (x === 0 && v.xScale === "linear") continue;
    const p = xToPx(v, x);
    if (p > 14 && p < W - 14) label(ctx, t, formatTick(x, xt.step, v.xScale), p, labelY);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const labelX = Math.min(Math.max(axisPx + 6, 4), W - 48);
  for (const y of yt.major) {
    if (y === 0 && v.yScale === "linear") continue;
    const p = yToPx(v, y);
    if (p > 8 && p < H - 8) label(ctx, t, formatTick(y, yt.step, v.yScale), labelX, p);
  }
}

export function drawCurves(ctx: CanvasRenderingContext2D, v: View, curves: Curve[]): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, v.width, v.height);
  ctx.clip();
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const c of curves) {
    ctx.strokeStyle = c.color;
    ctx.beginPath();
    for (const l of c.lines) {
      ctx.moveTo(l[0], l[1]);
      for (let i = 2; i < l.length; i += 2) ctx.lineTo(l[i], l[i + 1]);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawMarker(ctx: CanvasRenderingContext2D, px: number, py: number, color: string, t: Theme): void {
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = t.bg;
  ctx.stroke();
}

// ---------- Objekte aus dem Modell (PlotItem-Formen) ----------
import type { Shape } from "./items.ts";

export interface DrawnItem {
  color: string;
  shapes: Shape[];
  /** Linienbreite in Pixeln (Standard 2,5) */
  width?: number;
}

/** Zeichnet erst alle Füllungen (halbtransparent), dann Linien, dann Punkte. */
export function drawItems(ctx: CanvasRenderingContext2D, v: View, items: DrawnItem[]): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, v.width, v.height);
  ctx.clip();

  ctx.globalAlpha = 0.22;
  for (const it of items) {
    ctx.fillStyle = it.color;
    for (const s of it.shapes) {
      if (s.type === "fillRects") {
        ctx.beginPath();
        for (let i = 0; i < s.rects.length; i += 4) ctx.rect(s.rects[i], s.rects[i + 1], s.rects[i + 2], s.rects[i + 3]);
        ctx.fill();
      } else if (s.type === "fillPoly") {
        ctx.beginPath();
        for (const p of s.polys) {
          ctx.moveTo(p[0], p[1]);
          for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
          ctx.closePath();
        }
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const it of items) {
    ctx.strokeStyle = it.color;
    ctx.lineWidth = it.width ?? 2.5;
    for (const s of it.shapes) {
      if (s.type !== "lines") continue;
      ctx.setLineDash(s.dashed ? [8, 6] : []);
      ctx.beginPath();
      for (const l of s.lines) {
        ctx.moveTo(l[0], l[1]);
        for (let i = 2; i < l.length; i += 2) ctx.lineTo(l[i], l[i + 1]);
      }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.strokeStyle = it.color;
    for (const s of it.shapes) {
      if (s.type !== "points") continue;
      const glyph = s.glyph ?? "circle";
      for (let i = 0; i < s.pts.length; i += 2) {
        const x = s.pts[i];
        const y = s.pts[i + 1];
        ctx.beginPath();
        switch (glyph) {
          case "up": ctx.moveTo(x, y - 7); ctx.lineTo(x - 6.5, y + 5); ctx.lineTo(x + 6.5, y + 5); ctx.closePath(); ctx.fill(); break;
          case "down": ctx.moveTo(x, y + 7); ctx.lineTo(x - 6.5, y - 5); ctx.lineTo(x + 6.5, y - 5); ctx.closePath(); ctx.fill(); break;
          case "diamond": ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill(); break;
          case "square": ctx.rect(x - 5, y - 5, 10, 10); ctx.fill(); break;
          case "ring": ctx.lineWidth = 2.5; ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke(); break;
          default: ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}
