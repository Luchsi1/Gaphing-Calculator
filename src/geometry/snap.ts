// Punkte platzieren: sanfter Magnet am Raster, sonst frei – aber auf wenige Nachkommastellen gerundet,
// damit freie Punkte exakte (dezimale) Koordinaten behalten und Messungen exakt bleiben.
import { type View, xFromPx, yFromPx, xToPx, yToPx, niceStep } from "../graph/viewport.ts";

/** Pixelabstand, innerhalb dessen ein Punkt an eine Rasterlinie „einrastet“. */
export const MAGNET_PX = 6;

/** Rastersschrittweite (Welteinheiten) bei gegebenem Maßstab in Pixel pro Einheit. */
export const gridStepFor = (scale: number): number => niceStep(40 / scale);

/** Rundungsgenauigkeit freier Koordinaten: etwa ein Zehntel Pixel, als Zehnerpotenz, mindestens 1e-6. */
export function precisionFor(scale: number): number {
  const px = 1 / Math.max(scale, 1e-12);
  return Math.max(1e-6, 10 ** (Math.floor(Math.log10(px)) - 1));
}

const roundTo = (x: number, step: number): number => Number((Math.round(x / step) * step).toPrecision(12));

function axis(w: number, scale: number, toPx: (x: number) => number, p: number, magnet: boolean): number {
  if (magnet) {
    const g = roundTo(w, gridStepFor(scale));
    if (Math.abs(toPx(g) - p) <= MAGNET_PX) return g;
  }
  return roundTo(w, precisionFor(scale));
}

/** Weltkoordinaten für den Pixelpunkt (px, py); jede Achse rastet getrennt ein, damit man entlang von Rasterlinien gleiten kann. */
export function placePoint(v: View, px: number, py: number, magnet: boolean): { x: number; y: number } {
  return {
    x: axis(xFromPx(v, px), v.sx, (x) => xToPx(v, x), px, magnet),
    y: axis(yFromPx(v, py), v.sy, (y) => yToPx(v, y), py, magnet),
  };
}
