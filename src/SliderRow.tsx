import { useState } from "react";
import { type Slider, type SliderMode, setSliderValue, configureSlider } from "./graph/sliders.ts";
import { formatCoord } from "./graph/viewport.ts";

const MODES: { value: SliderMode; label: string }[] = [
  { value: "forward", label: "vorwärts (Schleife)" },
  { value: "backward", label: "rückwärts (Schleife)" },
  { value: "pingpong", label: "hin und her" },
];
const SPEEDS = [0.25, 0.5, 1, 2, 4];

type Field = "min" | "max" | "step";

export default function SliderRow({
  slider, onChange, onRemove,
}: {
  slider: Slider;
  onChange: (s: Slider) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<{ field: Field; text: string } | null>(null);
  const s = slider;

  const commit = (): void => {
    if (!draft) return;
    const n = Number(draft.text.replace(",", "."));
    if (Number.isFinite(n)) onChange(configureSlider(s, { [draft.field]: n }));
    setDraft(null);
  };
  const field = (f: Field, label: string) => (
    <label>
      {label}{" "}
      <input
        className="num"
        value={draft && draft.field === f ? draft.text : formatCoord(s[f])}
        onFocus={() => setDraft({ field: f, text: formatCoord(s[f]) })}
        onChange={(e: { target: { value: string } }) => setDraft({ field: f, text: e.target.value })}
        onBlur={commit}
        onKeyDown={(e: { key: string; currentTarget: { blur: () => void } }) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );

  return (
    <div className="slider">
      <div className="row">
        <b>{s.name}</b> = <span className="val">{formatCoord(s.value)}</span>
        <button title={s.playing ? "Animation anhalten" : "Animation starten"} onClick={() => onChange({ ...s, playing: !s.playing })}>
          {s.playing ? "⏸" : "▶"}
        </button>
        <select value={s.mode} onChange={(e: { target: { value: string } }) => onChange(configureSlider(s, { mode: e.target.value as SliderMode }))}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select value={String(s.speed)} onChange={(e: { target: { value: string } }) => onChange(configureSlider(s, { speed: Number(e.target.value) }))}>
          {SPEEDS.map((v) => (
            <option key={v} value={String(v)}>{String(v).replace(".", ",")}×</option>
          ))}
        </select>
        <button title="Slider entfernen" onClick={onRemove}>✕</button>
      </div>
      <input
        className="range"
        type="range"
        min={s.min}
        max={s.max}
        step={s.step > 0 ? s.step : "any"}
        value={s.value}
        onChange={(e: { target: { value: string } }) => onChange(setSliderValue(s, Number(e.target.value)))}
      />
      <div className="row small">
        {field("min", "min")}
        {field("max", "max")}
        {field("step", "Schritt")}
      </div>
    </div>
  );
}
