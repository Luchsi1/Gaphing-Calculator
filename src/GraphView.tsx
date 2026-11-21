import { useEffect, useMemo, useRef, useState } from "react";
import {
  type View, type Ranges, defaultView, xToPx, yToPx, xFromPx, ranges, viewFromRanges, resize, pan, zoomAt,
  setScale, oneToOne, formatCoord,
} from "./graph/viewport.ts";
import type { PlotItem } from "./graph/items.ts";
import { type DrawnItem, type GridOptions, LIGHT, DARK, drawBackground, drawItems, drawMarker } from "./graph/draw.ts";

interface Hover {
  px: number;
  py: number;
}

interface Info {
  x: number;
  y: number | null;
  snap: { py: number; color: string } | null;
}

const resetView = (v: View): View => {
  let n = defaultView(v.width, v.height);
  if (v.xScale === "log") n = setScale(n, "x", "log");
  if (v.yScale === "log") n = setScale(n, "y", "log");
  return n;
};

const RANGE_KEYS: { key: keyof Ranges; label: string }[] = [
  { key: "xMin", label: "x min" },
  { key: "xMax", label: "x max" },
  { key: "yMin", label: "y min" },
  { key: "yMax", label: "y max" },
];

const toStep = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function GraphView({ items }: { items: PlotItem[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<View>(() => defaultView());
  const [dark, setDark] = useState<boolean>(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [gridX, setGridX] = useState<string>("");
  const [gridY, setGridY] = useState<string>("");
  const [hover, setHover] = useState<Hover | null>(null);
  const [editing, setEditing] = useState<{ key: keyof Ranges; text: string } | null>(null);

  // Hell/Dunkel folgt dem System
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent): void => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Größe der Zeichenfläche
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const apply = (): void => {
      const w = Math.floor(stage.clientWidth);
      const h = Math.floor(stage.clientHeight);
      if (w > 0 && h > 0) setView((v) => (v.width === w && v.height === h ? v : resize(v, w, h)));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // Maus: Ziehen = Verschieben, Rad = Zoom am Cursor (Shift: nur x, Alt: nur y), Doppelklick = Zurücksetzen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let drag: { x: number; y: number } | null = null;
    const local = (e: MouseEvent): Hover => {
      const r = canvas.getBoundingClientRect();
      return { px: e.clientX - r.left, py: e.clientY - r.top };
    };
    const down = (e: PointerEvent): void => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent): void => {
      setHover(local(e));
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag = { x: e.clientX, y: e.clientY };
        setView((v) => pan(v, dx, dy));
      }
    };
    const up = (): void => {
      drag = null;
      canvas.style.cursor = "crosshair";
    };
    const leave = (): void => {
      if (!drag) setHover(null);
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const { px, py } = local(e);
      let d = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (e.deltaMode === 1) d *= 16;
      const k = Math.exp(-d * 0.0015);
      setView((v) => zoomAt(v, px, py, e.altKey ? 1 : k, e.shiftKey ? 1 : k));
    };
    const dbl = (): void => setView(resetView);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", dbl);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", dbl);
    };
  }, []);

  // Tastatur (wenn der Graph den Fokus hat): + − Pfeile 0 1
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const key = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const big = e.shiftKey ? 200 : 50;
      let handled = true;
      switch (e.key) {
        case "+": case "=": setView((v) => zoomAt(v, v.width / 2, v.height / 2, 1.25, 1.25)); break;
        case "-": case "_": setView((v) => zoomAt(v, v.width / 2, v.height / 2, 0.8, 0.8)); break;
        case "ArrowLeft": setView((v) => pan(v, big, 0)); break;
        case "ArrowRight": setView((v) => pan(v, -big, 0)); break;
        case "ArrowUp": setView((v) => pan(v, 0, big)); break;
        case "ArrowDown": setView((v) => pan(v, 0, -big)); break;
        case "0": case "Home": setView(resetView); break;
        case "1": setView(oneToOne); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    };
    wrap.addEventListener("keydown", key);
    return () => wrap.removeEventListener("keydown", key);
  }, []);

  const drawn = useMemo<DrawnItem[]>(
    () => items.map((it) => ({ color: it.color, shapes: it.draw(view) })),
    [items, view]
  );

  // Funktionswert unter dem Cursor; rastet an einer Kurve ein, wenn sie nah genug ist
  const info = useMemo<Info | null>(() => {
    if (!hover) return null;
    const x = xFromPx(view, hover.px);
    let best: { py: number; color: string; y: number; d: number } | null = null;
    for (const it of items) {
      if (!it.probe) continue;
      let y = NaN;
      try {
        y = it.probe(x);
      } catch {
        /* ignorieren */
      }
      const py = yToPx(view, y);
      if (!Number.isFinite(py)) continue;
      const d = Math.abs(py - hover.py);
      if (d < 14 && (!best || d < best.d)) best = { py, color: it.color, y, d };
    }
    if (best) return { x, y: best.y, snap: { py: best.py, color: best.color } };
    return { x, y: null, snap: null };
  }, [hover, view, items]);

  const grid: GridOptions = { show: showGrid, stepX: toStep(gridX), stepY: toStep(gridY) };
  const gridKey = `${grid.show}|${grid.stepX}|${grid.stepY}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(view.width * dpr));
    canvas.height = Math.max(1, Math.round(view.height * dpr));
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${view.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const theme = dark ? DARK : LIGHT;
    drawBackground(ctx, view, theme, grid);
    drawItems(ctx, view, drawn);
    if (info && hover && info.snap) drawMarker(ctx, hover.px, info.snap.py, info.snap.color, theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, drawn, dark, gridKey, info, hover]);

  const r = ranges(view);

  const commit = (): void => {
    if (!editing) return;
    const val = Number(editing.text.replace(",", "."));
    if (Number.isFinite(val)) {
      const nv = viewFromRanges({ ...r, [editing.key]: val }, view.width, view.height, view.xScale, view.yScale);
      if (nv) setView(nv);
    }
    setEditing(null);
  };

  return (
    <div className="graph" ref={wrapRef} tabIndex={0}>
      <div className="toolbar">
        <button onClick={() => setView(resetView)} title="Ansicht zurücksetzen (0)">Zurücksetzen</button>
        <button onClick={() => setView(oneToOne)} title="Gleicher Maßstab auf beiden Achsen (1)">1 : 1</button>
        <label><input type="checkbox" checked={view.xScale === "log"} onChange={(e: { target: { checked: boolean } }) => setView((v) => setScale(v, "x", e.target.checked ? "log" : "linear"))} /> x log</label>
        <label><input type="checkbox" checked={view.yScale === "log"} onChange={(e: { target: { checked: boolean } }) => setView((v) => setScale(v, "y", e.target.checked ? "log" : "linear"))} /> y log</label>
        <label><input type="checkbox" checked={showGrid} onChange={(e: { target: { checked: boolean } }) => setShowGrid(e.target.checked)} /> Raster</label>
        <label>Raster x <input className="num" placeholder="auto" value={gridX} onChange={(e: { target: { value: string } }) => setGridX(e.target.value)} /></label>
        <label>y <input className="num" placeholder="auto" value={gridY} onChange={(e: { target: { value: string } }) => setGridY(e.target.value)} /></label>
      </div>
      <div className="toolbar">
        {RANGE_KEYS.map(({ key, label }) => (
          <label key={key}>
            {label}{" "}
            <input
              className="num"
              value={editing && editing.key === key ? editing.text : formatCoord(r[key])}
              onFocus={() => setEditing({ key, text: formatCoord(r[key]) })}
              onChange={(e: { target: { value: string } }) => setEditing({ key, text: e.target.value })}
              onBlur={commit}
              onKeyDown={(e: { key: string; currentTarget: { blur: () => void } }) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
        ))}
      </div>
      <div className="stage" ref={stageRef}>
        <canvas ref={canvasRef} style={{ cursor: "crosshair", touchAction: "none" }} />
      </div>
      <div className="status">
        {info ? (
          <>
            <span>x = {formatCoord(info.x)}</span>
            {info.snap && info.y !== null ? (
              <span style={{ color: info.snap.color }}> &nbsp; f(x) = {formatCoord(info.y)}</span>
            ) : (
              <span> &nbsp; y = {formatCoord(yFromPxSafe(view, hover))}</span>
            )}
          </>
        ) : (
          <span className="hint">Ziehen: verschieben · Mausrad: zoomen (Shift: nur x, Alt: nur y) · Doppelklick: zurücksetzen · Tasten + − Pfeile 0 1</span>
        )}
      </div>
    </div>
  );
}

function yFromPxSafe(v: View, h: Hover | null): number {
  if (!h) return NaN;
  const u = v.cy - (h.py - v.height / 2) / v.sy;
  return v.yScale === "log" ? Math.pow(10, u) : u;
}
