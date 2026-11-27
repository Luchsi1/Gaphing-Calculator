import { useEffect, useMemo, useRef, useState } from "react";
import {
  type View, type Ranges, defaultView, xToPx, yToPx, xFromPx, yFromPx, ranges, viewFromRanges, resize, pan, zoomAt,
  setScale, oneToOne, formatCoord,
} from "./graph/viewport.ts";
import type { PlotItem } from "./graph/items.ts";
import { type History, commit as commitHistory, replace, checkpoint, undo, redo } from "./geometry/history.ts";
import type { Values } from "./geometry/compute.ts";
import { movePoint, removeObject, find, isFreePoint } from "./geometry/model.ts";
import { renderGeometry, hitTest } from "./geometry/render.ts";
import { type Tool, type PickResult, TOOLS, applyPick } from "./geometry/tools.ts";
import { placePoint } from "./geometry/snap.ts";
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

export interface HoverMarker {
  x: number;
  y: number;
  label: string;
  color: string;
}

/** Anbindung der Geometrie: Konstruktion, Auswertung und Auswahl liegen in App (Liste im linken Panel). */
export interface GeoBinding {
  history: History;
  setHistory: (f: (h: History) => History) => void;
  vals: Values;
  selected: string[];
  setSelected: (s: string[] | ((p: string[]) => string[])) => void;
}

const GROUPS: ("Zeichnen" | "Konstruieren" | "Messen")[] = ["Zeichnen", "Konstruieren", "Messen"];
const TOOL_IDS = Object.keys(TOOLS) as Tool[];

interface Props {
  items: PlotItem[];
  geo?: GeoBinding;
  /** Punkte mit Beschriftung, die beim Überfahren angezeigt wird */
  markers?: HoverMarker[];
  /** meldet den sichtbaren x-Bereich (verzögert) */
  onRange?: (r: Ranges) => void;
  /** Klick ohne Ziehen: Weltkoordinaten des Punkts */
  onPick?: (p: { x: number; y: number }) => void;
  picking?: boolean;
}

export default function GraphView({ items, geo, markers, onRange, onPick, picking }: Props) {
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
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;
  const pickingRef = useRef<boolean>(!!picking);
  pickingRef.current = !!picking;

  // Geometrie-Werkzeug und -Auswahl
  const [tool, setTool] = useState<Tool>("move");
  const [picks, setPicks] = useState<string[]>([]);
  const [snapOn, setSnapOn] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [radiusText, setRadiusText] = useState<string>("2");
  const [message, setMessage] = useState<string>("");
  const selectedRef = useRef<string[]>(geo ? geo.selected : []);
  selectedRef.current = geo ? geo.selected : [];
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const snapRef = useRef(snapOn);
  snapRef.current = snapOn;
  const radiusRef = useRef(radiusText);
  radiusRef.current = radiusText;
  const geoOn = !!geo && view.xScale === "linear" && view.yScale === "linear";

  const chooseTool = (t: Tool): void => {
    setTool(t);
    setPicks([]);
    setMessage("");
  };

  useEffect(() => {
    if (canvasRef.current) canvasRef.current.style.cursor = picking ? "copy" : "crosshair";
  }, [picking]);

  // sichtbaren Bereich (verzögert) melden
  useEffect(() => {
    const t = setTimeout(() => onRangeRef.current?.(ranges(view)), 150);
    return () => clearTimeout(t);
  }, [view]);

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

  // Maus: Ziehen = Verschieben (oder freien Geometrie-Punkt ziehen), Rad = Zoom am Cursor (Shift: nur x, Alt: nur y),
  // Klick = Geometrie-Werkzeug bzw. Auswahl, Doppelklick = Zurücksetzen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let drag: { x: number; y: number } | null = null;
    let moved = 0;
    let dragPoint: string | null = null;
    let dragStarted = false;
    const local = (e: MouseEvent): Hover => {
      const r = canvas.getBoundingClientRect();
      return { px: e.clientX - r.left, py: e.clientY - r.top };
    };
    const geoActive = (): boolean => !!geoRef.current && viewRef.current.xScale === "linear" && viewRef.current.yScale === "linear";

    const clickMove = (p: Hover, additive: boolean): void => {
      const g = geoRef.current;
      if (!g) return;
      const hits = hitTest(g.history.present, g.vals, viewRef.current, p.px, p.py);
      if (hits.length) {
        const id = hits[0];
        g.setSelected((prev) => (additive ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]));
      } else if (!additive) g.setSelected([]);
    };

    const clickTool = (p: Hover, noMagnet: boolean): void => {
      const g = geoRef.current;
      if (!g) return;
      const v = viewRef.current;
      const cc = g.history.present;
      const t = toolRef.current;
      const opts = { radius: Math.max(1e-9, Number(radiusRef.current.replace(",", ".")) || 1) };
      const at = placePoint(v, p.px, p.py, snapRef.current && !noMagnet);
      const picks0 = picksRef.current.filter((id) => !!find(cc, id));
      let res: PickResult | null = null;
      for (const id of hitTest(cc, g.vals, v, p.px, p.py)) {
        const r = applyPick(cc, t, picks0, { type: "object", id }, opts);
        if (!r.message) {
          res = r;
          break;
        }
      }
      if (!res) res = applyPick(cc, t, picks0, { type: "empty", x: at.x, y: at.y }, opts);
      if (res.message) {
        setMessage(res.message);
        return;
      }
      setMessage("");
      const next = res.c;
      if (next !== cc) g.setHistory((h) => commitHistory(h, next));
      setPicks(res.picks);
      g.setSelected(res.picks.length === 0 ? res.created : []);
    };

    const down = (e: PointerEvent): void => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY };
      moved = 0;
      dragPoint = null;
      dragStarted = false;
      const g = geoRef.current;
      if (g && geoActive() && toolRef.current === "move") {
        const p = local(e);
        const hits = hitTest(g.history.present, g.vals, viewRef.current, p.px, p.py);
        const free = hits.find((id) => isFreePoint(find(g.history.present, id)));
        if (free) {
          dragPoint = free;
          g.setSelected([free]);
        }
      }
      canvas.style.cursor = dragPoint ? "move" : "grabbing";
    };
    const move = (e: PointerEvent): void => {
      const p = local(e);
      setHover(p);
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      const g = geoRef.current;
      if (dragPoint && g) {
        if (moved < 3 && !dragStarted) return;
        const id = dragPoint;
        if (!dragStarted) {
          dragStarted = true;
          g.setHistory(checkpoint);
        }
        const at = placePoint(viewRef.current, p.px, p.py, snapRef.current && !e.altKey);
        g.setHistory((h) => replace(h, movePoint(h.present, id, at.x, at.y)));
      } else {
        setView((v) => pan(v, dx, dy));
      }
    };
    const up = (e: PointerEvent): void => {
      const wasClick = drag !== null && moved < 4 && e.type === "pointerup";
      const wasDrag = dragPoint !== null;
      drag = null;
      dragPoint = null;
      canvas.style.cursor = pickingRef.current ? "copy" : "crosshair";
      if (!wasClick || wasDrag) return;
      const p = local(e);
      if (geoActive() && toolRef.current !== "move") clickTool(p, e.altKey);
      else if (onPickRef.current) {
        const v = viewRef.current;
        onPickRef.current({ x: xFromPx(v, p.px), y: yFromPx(v, p.py) });
      } else if (geoActive()) clickMove(p, e.shiftKey || e.ctrlKey || e.metaKey);
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
    const dbl = (): void => {
      if (toolRef.current === "move") setView(resetView);
    };
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

  // Tastatur (wenn der Graph den Fokus hat): + − Pfeile 0 1; Geometrie: Strg+Z/Y, Entf, Esc
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const key = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const big = e.shiftKey ? 200 : 50;
      let handled = true;
      const g = geoRef.current;
      const mod = e.ctrlKey || e.metaKey;
      if (g && mod && (e.key === "z" || e.key === "Z")) {
        g.setHistory(e.shiftKey ? redo : undo);
        e.preventDefault();
        return;
      }
      if (g && mod && (e.key === "y" || e.key === "Y")) {
        g.setHistory(redo);
        e.preventDefault();
        return;
      }
      if (g && e.key === "Escape") {
        setPicks([]);
        setMessage("");
        setTool("move");
        g.setSelected([]);
        e.preventDefault();
        return;
      }
      if (g && (e.key === "Delete" || e.key === "Backspace")) {
        const ids = selectedRef.current;
        if (ids.length) g.setHistory((h) => commitHistory(h, ids.reduce((acc, id) => (find(acc, id) ? removeObject(acc, id) : acc), h.present)));
        g.setSelected([]);
        setPicks([]);
        e.preventDefault();
        return;
      }
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

  const highlighted = useMemo(() => new Set([...(geo ? geo.selected : []), ...picks]), [geo, picks]);
  const scene = useMemo(
    () => (geo && geoOn ? renderGeometry(geo.history.present, geo.vals, view, highlighted, showLabels) : null),
    [geo, geoOn, view, highlighted, showLabels]
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

  const hoverMarker = useMemo<HoverMarker | null>(() => {
    if (!hover || !markers) return null;
    let best: HoverMarker | null = null;
    let bd = 12;
    for (const m of markers) {
      const d = Math.hypot(xToPx(view, m.x) - hover.px, yToPx(view, m.y) - hover.py);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }, [hover, markers, view]);

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
    if (scene && geo) {
      drawItems(ctx, view, scene.items);
      // Gummiband vom zuletzt gewählten Punkt zum Mauszeiger
      const lastPick = picks.length ? geo.vals[picks[picks.length - 1]] : null;
      if (hover && lastPick && lastPick.t === "point" && tool !== "move") {
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = theme.axis;
        ctx.beginPath();
        ctx.moveTo(xToPx(view, lastPick.x), yToPx(view, lastPick.y));
        ctx.lineTo(hover.px, hover.py);
        ctx.stroke();
        ctx.restore();
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(45,112,179,0.55)";
      for (let i = 0; i < scene.halos.length; i += 2) {
        ctx.beginPath();
        ctx.arc(scene.halos[i], scene.halos[i + 1], 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = "600 13px system-ui, 'Segoe UI', sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      for (const l of scene.labels) {
        if (l.px < -50 || l.px > view.width + 50 || l.py < -20 || l.py > view.height + 20) continue;
        ctx.lineWidth = 3;
        ctx.strokeStyle = theme.bg;
        ctx.strokeText(l.text, l.px, l.py);
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, l.px, l.py);
      }
    }
    if (hoverMarker) {
      ctx.beginPath();
      ctx.arc(xToPx(view, hoverMarker.x), yToPx(view, hoverMarker.y), 10, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hoverMarker.color;
      ctx.stroke();
    } else if (info && hover && info.snap && !(geoOn && tool !== "move")) drawMarker(ctx, hover.px, info.snap.py, info.snap.color, theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, drawn, dark, gridKey, info, hover, hoverMarker, scene, picks, tool]);

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
      {geo && (
        <>
          <div className="toolbar tools">
            {GROUPS.map((g) => (
              <span className="toolgroup" key={g}>
                <b>{g}</b>
                {TOOL_IDS.filter((t) => TOOLS[t].group === g).map((t) => (
                  <button key={t} className={tool === t ? "tool-btn on" : "tool-btn"} onClick={() => chooseTool(t)} title={TOOLS[t].hint}>
                    {TOOLS[t].label}
                  </button>
                ))}
              </span>
            ))}
          </div>
          <div className="toolbar">
            <button onClick={() => geo.setHistory(undo)} disabled={!geo.history.past.length} title="Rückgängig (Strg+Z)">Rückgängig</button>
            <button onClick={() => geo.setHistory(redo)} disabled={!geo.history.future.length} title="Wiederholen (Strg+Y)">Wiederholen</button>
            <label title="Punkte rasten nahe an Rasterlinien ein (Alt gedrückt halten: nie einrasten)"><input type="checkbox" checked={snapOn} onChange={(e: { target: { checked: boolean } }) => setSnapOn(e.target.checked)} /> Magnet</label>
            <label><input type="checkbox" checked={showLabels} onChange={(e: { target: { checked: boolean } }) => setShowLabels(e.target.checked)} /> Beschriftung</label>
            {tool === "circler" && (
              <label>
                Radius <input className="num" value={radiusText} onChange={(e: { target: { value: string } }) => setRadiusText(e.target.value)} />
              </label>
            )}
            {!geoOn && <span className="note">Geometrie braucht lineare Achsen (x log / y log ausschalten).</span>}
          </div>
        </>
      )}
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
        {message ? (
          <span className="error">{message}</span>
        ) : geoOn && tool !== "move" ? (
          <span>
            {TOOLS[tool].hint}
            {picks.length > 0 && geo ? ` Gewählt: ${picks.map((id) => find(geo.history.present, id)?.name ?? "?").join(", ")}.` : ""}
            {hover ? ` (x = ${formatCoord(xFromPx(view, hover.px))}, y = ${formatCoord(yFromPxSafe(view, hover))})` : ""}
          </span>
        ) : hoverMarker ? (
          <span style={{ color: hoverMarker.color }}>{hoverMarker.label}</span>
        ) : picking ? (
          <span>Klicke auf den Graphen, um die Stelle zu wählen …</span>
        ) : info ? (
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
