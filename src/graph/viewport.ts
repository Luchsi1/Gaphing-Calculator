// Koordinatensystem: Welt <-> Pixel, Zoom/Pan, lineare und logarithmische Achsen.
// Intern wird im "Achsenraum" gerechnet (bei log-Achsen: log10 der Weltwerte).

export type AxisScale = "linear" | "log";

export interface View {
  cx: number; // Mittelpunkt im Achsenraum
  cy: number;
  sx: number; // Pixel pro Einheit im Achsenraum (log: Pixel pro Dekade)
  sy: number;
  width: number; // CSS-Pixel
  height: number;
  xScale: AxisScale;
  yScale: AxisScale;
}

export interface Ranges {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const toAxis = (s: AxisScale, v: number): number => (s === "log" ? (v > 0 ? Math.log10(v) : NaN) : v);
const fromAxis = (s: AxisScale, u: number): number => (s === "log" ? Math.pow(10, u) : u);

export const defaultView = (width = 800, height = 500): View => ({
  cx: 0, cy: 0, sx: 50, sy: 50, width, height, xScale: "linear", yScale: "linear",
});

export const xToPx = (v: View, x: number): number => v.width / 2 + (toAxis(v.xScale, x) - v.cx) * v.sx;
export const yToPx = (v: View, y: number): number => v.height / 2 - (toAxis(v.yScale, y) - v.cy) * v.sy;
export const xFromPx = (v: View, px: number): number => fromAxis(v.xScale, v.cx + (px - v.width / 2) / v.sx);
export const yFromPx = (v: View, py: number): number => fromAxis(v.yScale, v.cy - (py - v.height / 2) / v.sy);

export function ranges(v: View): Ranges {
  const hx = v.width / (2 * v.sx);
  const hy = v.height / (2 * v.sy);
  return {
    xMin: fromAxis(v.xScale, v.cx - hx),
    xMax: fromAxis(v.xScale, v.cx + hx),
    yMin: fromAxis(v.yScale, v.cy - hy),
    yMax: fromAxis(v.yScale, v.cy + hy),
  };
}

const clampScale = (s: AxisScale, k: number): number =>
  s === "log" ? Math.min(20000, Math.max(2, k)) : Math.min(1e9, Math.max(1e-9, k));

export function viewFromRanges(r: Ranges, width: number, height: number, xScale: AxisScale, yScale: AxisScale): View | null {
  const ax0 = toAxis(xScale, r.xMin);
  const ax1 = toAxis(xScale, r.xMax);
  const ay0 = toAxis(yScale, r.yMin);
  const ay1 = toAxis(yScale, r.yMax);
  if (![ax0, ax1, ay0, ay1].every(Number.isFinite) || ax1 <= ax0 || ay1 <= ay0) return null;
  const sx = width / (ax1 - ax0);
  const sy = height / (ay1 - ay0);
  if (clampScale(xScale, sx) !== sx || clampScale(yScale, sy) !== sy) return null;
  return { cx: (ax0 + ax1) / 2, cy: (ay0 + ay1) / 2, sx, sy, width, height, xScale, yScale };
}

export const resize = (v: View, width: number, height: number): View => ({ ...v, width, height });

export const pan = (v: View, dxPx: number, dyPx: number): View => ({
  ...v, cx: v.cx - dxPx / v.sx, cy: v.cy + dyPx / v.sy,
});

/** Zoom um den Punkt (px, py): der Weltpunkt unter dem Cursor bleibt fest. fx, fy > 1 vergrößert. */
export function zoomAt(v: View, px: number, py: number, fx: number, fy: number): View {
  const ax = v.cx + (px - v.width / 2) / v.sx;
  const ay = v.cy - (py - v.height / 2) / v.sy;
  const sx = clampScale(v.xScale, v.sx * fx);
  const sy = clampScale(v.yScale, v.sy * fy);
  return { ...v, sx, sy, cx: ax - (px - v.width / 2) / sx, cy: ay + (py - v.height / 2) / sy };
}

/** Wechselt eine Achse zwischen linear und logarithmisch; wählt bei Bedarf einen positiven Bereich. */
export function setScale(v: View, axis: "x" | "y", scale: AxisScale): View {
  if ((axis === "x" ? v.xScale : v.yScale) === scale) return v;
  const r = ranges(v);
  let lo = axis === "x" ? r.xMin : r.yMin;
  let hi = axis === "x" ? r.xMax : r.yMax;
  if (scale === "log") {
    if (!(lo > 0)) lo = hi > 0 ? hi / 1000 : 0.01;
    if (!(hi > lo)) hi = lo * 1000;
  }
  const next: Ranges = axis === "x" ? { ...r, xMin: lo, xMax: hi } : { ...r, yMin: lo, yMax: hi };
  const xs = axis === "x" ? scale : v.xScale;
  const ys = axis === "y" ? scale : v.yScale;
  return viewFromRanges(next, v.width, v.height, xs, ys) ?? { ...v, xScale: xs, yScale: ys };
}

/** Gleicher Maßstab auf beiden Achsen (nur sinnvoll bei linearen Achsen). */
export const oneToOne = (v: View): View => (v.xScale === "linear" && v.yScale === "linear" ? { ...v, sy: v.sx } : v);

// ---------- Raster ----------
export interface Ticks {
  major: number[];
  minor: number[];
  step: number;
}

export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const clean = (x: number): number => Number(x.toPrecision(12));

export function linearTicks(min: number, max: number, pxPerUnit: number, forcedStep?: number | null): Ticks {
  let step = forcedStep && forcedStep > 0 ? forcedStep : niceStep(80 / pxPerUnit);
  if ((max - min) / step > 400) step = niceStep((max - min) / 20);
  const mant = step / Math.pow(10, Math.floor(Math.log10(step)));
  const minorDiv = Math.abs(mant - 2) < 1e-9 ? 4 : 5;
  const minorStep = step / minorDiv;
  const major: number[] = [];
  const minor: number[] = [];
  for (let i = Math.ceil(min / step); i <= Math.floor(max / step); i++) major.push(clean(i * step));
  if (minorStep * pxPerUnit >= 8 && (max - min) / minorStep <= 2000) {
    for (let j = Math.ceil(min / minorStep); j <= Math.floor(max / minorStep); j++) {
      if (j % minorDiv !== 0) minor.push(clean(j * minorStep));
    }
  }
  return { major, minor, step };
}

export function logTicks(min: number, max: number, pxPerDecade: number): Ticks {
  const major: number[] = [];
  const minor: number[] = [];
  if (!(min > 0) || !(max > min)) return { major, minor, step: 10 };
  const k0 = Math.floor(Math.log10(min));
  const k1 = Math.ceil(Math.log10(max));
  const every = Math.max(1, Math.ceil(40 / pxPerDecade));
  const showMinor = pxPerDecade >= 120 && every === 1;
  const inside = (x: number): boolean => x >= min && x <= max;
  for (let k = k0; k <= k1; k++) {
    const dec = Math.pow(10, k);
    if (k % every === 0 && inside(dec)) major.push(dec);
    if (showMinor) {
      for (let m = 2; m <= 9; m++) if (inside(m * dec)) minor.push(m * dec);
    }
  }
  return { major, minor, step: 10 };
}

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
};

export function formatTick(v: number, step: number, scale: AxisScale = "linear"): string {
  if (v === 0) return "0";
  if (scale === "log") {
    const k = Math.round(Math.log10(v));
    if (k >= -3 && k <= 4) return String(Number(v.toPrecision(6)));
    return "10" + String(k).split("").map((c) => SUP[c] ?? c).join("");
  }
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return Number(v.toPrecision(6)).toExponential();
  const decimals = Math.min(10, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  const s = v.toFixed(decimals);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

export function formatCoord(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "undefiniert" : v > 0 ? "∞" : "−∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e9 || a < 1e-6) return v.toExponential(4);
  return String(Number(v.toPrecision(6)));
}
