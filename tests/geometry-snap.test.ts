import test from "node:test";
import assert from "node:assert/strict";
import { placePoint, precisionFor, gridStepFor, MAGNET_PX } from "../src/geometry/snap.ts";
import { defaultView, xToPx, yToPx } from "../src/graph/viewport.ts";
import { exactOf } from "../src/geometry/compute.ts";

const v = { ...defaultView(800, 500), sx: 40, sy: 40 };

test("Geometrie-Fang: Magnet nur in der Nähe von Rasterlinien, sonst fließende Bewegung", () => {
  const step = gridStepFor(40);
  const gx = xToPx(v, step);
  const gy = yToPx(v, step);
  // genau auf / knapp neben der Rasterlinie -> rastet ein
  assert.deepEqual(placePoint(v, gx + MAGNET_PX - 1, gy - MAGNET_PX + 1, true), { x: step, y: step });
  // weiter weg: kein Einrasten, Bewegung ist feiner als das Raster
  const free = placePoint(v, gx + 17, gy, true);
  assert.notEqual(free.x, step);
  assert.ok(free.x > step && free.x < 2 * step);
  assert.equal(free.y, step);
  // Magnet aus: nie einrasten
  assert.notEqual(placePoint(v, gx + 1, gy, false).x, step);
});

test("Geometrie-Fang: freie Bewegung ist feiner als ein Pixel und behält exakte Dezimalkoordinaten", () => {
  const seen = new Set<number>();
  for (let px = 300; px < 340; px += 0.5) seen.add(placePoint(v, px, 100, false).x);
  assert.ok(seen.size >= 79, "jede halbe Pixelverschiebung ergibt einen neuen Wert");
  for (const sx of [1, 10, 40, 300, 5000, 1e5]) {
    const view = { ...v, sx, sy: sx };
    for (const [px, py] of [[123.37, 55.91], [400, 250], [799.99, 0.01]]) {
      for (const m of [true, false]) {
        const p = placePoint(view, px, py, m);
        assert.ok(exactOf(p.x) !== null && exactOf(p.y) !== null, `exakt bei Maßstab ${sx}: ${p.x}, ${p.y}`);
      }
    }
  }
  assert.ok(precisionFor(40) <= 1e-3 && precisionFor(1e9) === 1e-6);
});
