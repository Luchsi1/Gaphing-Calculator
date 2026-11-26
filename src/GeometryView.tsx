import { useEffect, useMemo, useRef, useState } from "react";
import Tex from "./Tex.tsx";
import { type View, defaultView, xToPx, yToPx, xFromPx, yFromPx, resize, pan, zoomAt, niceStep, formatCoord } from "./graph/viewport.ts";
import { type GridOptions, LIGHT, DARK, drawBackground, drawItems } from "./graph/draw.ts";
import { type Construction, movePoint, removeObject, toggleHidden, find, isFreePoint, kindOf } from "./geometry/model.ts";
import { evaluate, describe } from "./geometry/compute.ts";
import { GEO_COLORS, renderGeometry, hitTest } from "./geometry/render.ts";
import { type Tool, type PickResult, TOOLS, applyPick } from "./geometry/tools.ts";
import { type History, commit, replace, checkpoint, undo, redo, exampleConstruction } from "./geometry/history.ts";

interface Props {
  history: History;
  setHistory: (f: (h: History) => History) => void;
}

const GROUPS: ("Zeichnen" | "Konstruieren" | "Messen")[] = ["Zeichnen", "Konstruieren", "Messen"];
const TOOL_IDS = Object.keys(TOOLS) as Tool[];

const squareView = (w: number, h: number): View => ({ ...defaultView(w, h), sx: 40, sy: 40 });
const snapStep = (v: View): number => niceStep(25 / v.sx);
const snapTo = (x: number, step: number): number => Number((Math.round(x / step) * step).toPrecision(12));

interface Pt {
  px: number;
  py: number;
}

export default function GeometryView({ history, setHistory }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<View>(() => squareView(800, 500));
  const [dark, setDark] = useState<boolean>(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [tool, setTool] = useState<Tool>("move");
  const [picks, setPicks] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [snapOn, setSnapOn] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [radiusText, setRadiusText] = useState<string>("2");
  const [message, setMessage] = useState<string>("");
  const [hover, setHover] = useState<Pt | null>(null);

  const c: Construction = history.present;
  const vals = useMemo(() => evaluate(c), [c]);

  // Aktueller Stand für die Ereignisbehandlung (die Listener werden nur einmal registriert)
  const cRef = useRef(c);
  cRef.current = c;
  const valsRef = useRef(vals);
  valsRef.current = vals;
  const viewRef = useRef(view);
  viewRef.current = view;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const snapRef = useRef(snapOn);
  snapRef.current = snapOn;
  const radiusRef = useRef(radiusText);
  radiusRef.current = radiusText;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const setHistoryRef = useRef(setHistory);
  setHistoryRef.current = setHistory;

  const chooseTool = (t: Tool): void => {
    setTool(t);
    setPicks([]);
    setMessage("");
  };

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

  // Maus: Ziehen eines freien Punkts (Bewegen), sonst Verschieben der Ansicht; Klick = Werkzeug anwenden; Rad = Zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let down: { x: number; y: number } | null = null;
    let last = { x: 0, y: 0 };
    let moved = 0;
    let dragPoint: string | null = null;
    let dragStarted = false;
    const local = (e: MouseEvent): Pt => {
      const r = canvas.getBoundingClientRect();
      return { px: e.clientX - r.left, py: e.clientY - r.top };
    };
    const cursor = (): string => (toolRef.current === "move" ? "default" : "crosshair");

    const clickMove = (p: Pt, additive: boolean): void => {
      const hits = hitTest(cRef.current, valsRef.current, viewRef.current, p.px, p.py);
      if (hits.length) {
        const id = hits[0];
        setSelected((prev) => (additive ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]));
      } else if (!additive) setSelected([]);
    };

    const clickTool = (p: Pt): void => {
      const v = viewRef.current;
      const cc = cRef.current;
      const t = toolRef.current;
      const opts = { radius: Math.max(1e-9, Number(radiusRef.current.replace(",", ".")) || 1) };
      const wx = xFromPx(v, p.px);
      const wy = yFromPx(v, p.py);
      const step = snapStep(v);
      const empty = { type: "empty" as const, x: snapRef.current ? snapTo(wx, step) : wx, y: snapRef.current ? snapTo(wy, step) : wy };
      let res: PickResult | null = null;
      for (const id of hitTest(cc, valsRef.current, v, p.px, p.py)) {
        const r = applyPick(cc, t, picksRef.current, { type: "object", id }, opts);
        if (!r.message) {
          res = r;
          break;
        }
      }
      if (!res) res = applyPick(cc, t, picksRef.current, empty, opts);
      if (res.message) {
        setMessage(res.message);
        return;
      }
      setMessage("");
      const next = res.c;
      if (next !== cc) setHistoryRef.current((h) => commit(h, next));
      setPicks(res.picks);
      setSelected(res.picks.length === 0 ? res.created : []);
    };

    const onDown = (e: PointerEvent): void => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      down = { x: p.px, y: p.py };
      last = { x: e.clientX, y: e.clientY };
      moved = 0;
      dragPoint = null;
      dragStarted = false;
      if (toolRef.current === "move") {
        const hits = hitTest(cRef.current, valsRef.current, viewRef.current, p.px, p.py);
        const free = hits.find((id) => isFreePoint(find(cRef.current, id)));
        if (free) {
          dragPoint = free;
          setSelected([free]);
        }
      }
    };
    const onMove = (e: PointerEvent): void => {
      const p = local(e);
      setHover(p);
      if (!down) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 3 && !dragStarted) return;
      if (dragPoint) {
        const id = dragPoint;
        if (!dragStarted) {
          dragStarted = true;
          setHistoryRef.current(checkpoint);
        }
        const v = viewRef.current;
        const step = snapStep(v);
        const x = snapRef.current ? snapTo(xFromPx(v, p.px), step) : xFromPx(v, p.px);
        const y = snapRef.current ? snapTo(yFromPx(v, p.py), step) : yFromPx(v, p.py);
        setHistoryRef.current((h) => replace(h, movePoint(h.present, id, x, y)));
      } else {
        dragStarted = true;
        canvas.style.cursor = "grabbing";
        setView((v) => pan(v, dx, dy));
      }
    };
    const onUp = (e: PointerEvent): void => {
      const wasClick = down !== null && moved < 4 && e.type === "pointerup";
      const wasDrag = dragPoint !== null;
      down = null;
      dragPoint = null;
      canvas.style.cursor = cursor();
      if (!wasClick || wasDrag) return;
      const p = local(e);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (toolRef.current === "move") clickMove(p, additive);
      else clickTool(p);
    };
    const onLeave = (): void => {
      if (!down) setHover(null);
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const p = local(e);
      let d = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (e.deltaMode === 1) d *= 16;
      const k = Math.exp(-d * 0.0015);
      setView((v) => zoomAt(v, p.px, p.py, k, k));
    };
    const onDbl = (): void => {
      if (toolRef.current === "move") setView((v) => squareView(v.width, v.height));
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDbl);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
    };
  }, []);

  useEffect(() => {
    if (canvasRef.current) canvasRef.current.style.cursor = tool === "move" ? "default" : "crosshair";
  }, [tool]);

  const deleteSelected = (): void => {
    const ids = selectedRef.current;
    if (!ids.length) return;
    setHistoryRef.current((h) => commit(h, ids.reduce((acc, id) => (find(acc, id) ? removeObject(acc, id) : acc), h.present)));
    setSelected([]);
    setPicks([]);
  };

  // Tastatur (wenn der Arbeitsbereich den Fokus hat)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const key = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      let handled = true;
      if (mod && (e.key === "z" || e.key === "Z")) setHistoryRef.current(e.shiftKey ? redo : undo);
      else if (mod && (e.key === "y" || e.key === "Y")) setHistoryRef.current(redo);
      else if (e.key === "Escape") {
        setPicks([]);
        setSelected([]);
        setMessage("");
        setTool("move");
      } else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "+" || e.key === "=") setView((v) => zoomAt(v, v.width / 2, v.height / 2, 1.25, 1.25));
      else if (e.key === "-" || e.key === "_") setView((v) => zoomAt(v, v.width / 2, v.height / 2, 0.8, 0.8));
      else if (e.key === "ArrowLeft") setView((v) => pan(v, 50, 0));
      else if (e.key === "ArrowRight") setView((v) => pan(v, -50, 0));
      else if (e.key === "ArrowUp") setView((v) => pan(v, 0, 50));
      else if (e.key === "ArrowDown") setView((v) => pan(v, 0, -50));
      else if (e.key === "0" || e.key === "Home") setView((v) => squareView(v.width, v.height));
      else handled = false;
      if (handled) e.preventDefault();
    };
    wrap.addEventListener("keydown", key);
    return () => wrap.removeEventListener("keydown", key);
  }, []);

  const highlighted = useMemo(() => new Set([...selected, ...picks]), [selected, picks]);
  const scene = useMemo(() => renderGeometry(c, vals, view, highlighted, showLabels), [c, vals, view, highlighted, showLabels]);

  const grid: GridOptions = { show: showGrid, stepX: null, stepY: null };

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
    drawItems(ctx, view, scene.items);

    // Gummiband vom zuletzt gewählten Punkt zum Mauszeiger
    const lastPick = picks.length ? vals[picks[picks.length - 1]] : null;
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

    // Auswahlringe um Punkte
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(45,112,179,0.55)";
    for (let i = 0; i < scene.halos.length; i += 2) {
      ctx.beginPath();
      ctx.arc(scene.halos[i], scene.halos[i + 1], 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Beschriftungen
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scene, dark, showGrid, hover, picks, tool, vals]);

  const rows = useMemo(() => c.objects.map((o) => ({ o, tex: describe(c, vals, o), defined: vals[o.id] !== null })), [c, vals]);
  const nameOf = (id: string): string => find(c, id)?.name ?? "?";
  const spec = TOOLS[tool];
  const snapInfo = snapOn ? `Raster-Fang ${formatCoord(snapStep(view))}` : "";

  return (
    <div className="geo" ref={wrapRef} tabIndex={0}>
      <div className="geo-main">
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
          <button onClick={() => setHistory(undo)} disabled={!history.past.length} title="Rückgängig (Strg+Z)">Rückgängig</button>
          <button onClick={() => setHistory(redo)} disabled={!history.future.length} title="Wiederholen (Strg+Y)">Wiederholen</button>
          <button onClick={() => setView((v) => squareView(v.width, v.height))} title="Ansicht zurücksetzen (0)">Ansicht zurücksetzen</button>
          <label><input type="checkbox" checked={showGrid} onChange={(e: { target: { checked: boolean } }) => setShowGrid(e.target.checked)} /> Raster</label>
          <label><input type="checkbox" checked={snapOn} onChange={(e: { target: { checked: boolean } }) => setSnapOn(e.target.checked)} /> Fangen</label>
          <label><input type="checkbox" checked={showLabels} onChange={(e: { target: { checked: boolean } }) => setShowLabels(e.target.checked)} /> Beschriftung</label>
          {tool === "circler" && (
            <label>
              Radius <input className="num" value={radiusText} onChange={(e: { target: { value: string } }) => setRadiusText(e.target.value)} />
            </label>
          )}
        </div>
        <div className="stage" ref={stageRef}>
          <canvas ref={canvasRef} style={{ touchAction: "none" }} />
        </div>
        <div className="status">
          {message ? (
            <span className="error">{message}</span>
          ) : (
            <span>
              {spec.hint}
              {picks.length > 0 ? ` Gewählt: ${picks.map(nameOf).join(", ")}.` : ""}
            </span>
          )}
          {hover && (
            <span className="hint">
              {" "}· x = {formatCoord(xFromPx(view, hover.px))}, y = {formatCoord(yFromPx(view, hover.py))}
              {snapInfo ? ` · ${snapInfo}` : ""}
            </span>
          )}
        </div>
      </div>
      <aside className="geo-side">
        <h2>Objekte</h2>
        {rows.length === 0 && (
          <div>
            <p className="note">Noch nichts konstruiert. Wähle oben ein Werkzeug und klicke in die Zeichenfläche.</p>
            <button className="small-btn" onClick={() => setHistory((h) => commit(h, exampleConstruction()))}>Beispiel laden (Umkreis)</button>
          </div>
        )}
        <ul className="geo-list">
          {rows.map(({ o, tex, defined }) => (
            <li key={o.id} className={(selected.includes(o.id) ? "sel " : "") + (o.hidden ? "dim" : "")} onClick={() => setSelected([o.id])}>
              <span className="swatch" style={{ background: GEO_COLORS[kindOf(o.def)] }} />
              <div className="body">
                {!defined ? <span className="note">{o.name}: nicht definiert</span> : tex ? <Tex latex={tex} inline /> : <code>{o.name}</code>}
              </div>
              <button className="small-btn" title={o.hidden ? "Einblenden" : "Ausblenden"} onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); setHistory((h) => commit(h, toggleHidden(h.present, o.id))); }}>
                {o.hidden ? "○" : "●"}
              </button>
              <button className="small-btn" title="Löschen (mit abhängigen Objekten)" onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); setHistory((h) => commit(h, removeObject(h.present, o.id))); setSelected((s) => s.filter((x) => x !== o.id)); }}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <p className="note">Tasten: Strg+Z / Strg+Y, Entf löscht Auswahl, Esc bricht ab. Mit „Bewegen“ lassen sich freie Punkte ziehen; abhängige Objekte folgen.</p>
      </aside>
    </div>
  );
}
