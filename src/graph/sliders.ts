// Slider für Parameter: Werte, Wertebereich, Schrittweite und Animation.

export type SliderMode = "forward" | "backward" | "pingpong";

export interface Slider {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  playing: boolean;
  /** Geschwindigkeit als Vielfaches von „ein Durchlauf des Bereichs in 4 Sekunden“. */
  speed: number;
  mode: SliderMode;
  /** aktuelle Richtung (nur für „hin und her“ relevant). */
  dir: 1 | -1;
}

const clean = (x: number): number => Number(x.toPrecision(12));

export function createSlider(name: string): Slider {
  return { name, value: 1, min: -10, max: 10, step: 0.1, playing: false, speed: 1, mode: "forward", dir: 1 };
}

/** Wert setzen: auf [min, max] begrenzen und auf die Schrittweite einrasten. */
export function setSliderValue(s: Slider, v: number): Slider {
  if (!Number.isFinite(v)) return s;
  let x = Math.min(s.max, Math.max(s.min, v));
  if (s.step > 0) x = clean(s.min + Math.round((x - s.min) / s.step) * s.step);
  return { ...s, value: Math.min(s.max, Math.max(s.min, x)) };
}

/** Setzt Bereich/Schrittweite; ungültige Eingaben (min ≥ max, step ≤ 0) werden ignoriert. */
export function configureSlider(s: Slider, patch: Partial<Pick<Slider, "min" | "max" | "step" | "speed" | "mode">>): Slider {
  const n = { ...s, ...patch };
  if (!(n.max > n.min) || !(n.step >= 0) || !(n.speed > 0)) return s;
  return { ...n, value: Math.min(n.max, Math.max(n.min, n.value)), dir: n.mode === "backward" ? -1 : n.mode === "forward" ? 1 : n.dir };
}

/** Ein Animationsschritt über dt Sekunden. */
export function stepSlider(s: Slider, dt: number): Slider {
  const range = s.max - s.min;
  if (!(range > 0)) return { ...s, playing: false };
  const rate = (range / 4) * s.speed;
  let dir: 1 | -1 = s.mode === "forward" ? 1 : s.mode === "backward" ? -1 : s.dir;
  let v = s.value + dir * rate * dt;
  if (s.mode === "pingpong") {
    for (let guard = 0; guard < 8 && (v > s.max || v < s.min); guard++) {
      if (v > s.max) {
        v = 2 * s.max - v;
        dir = -1;
      } else {
        v = 2 * s.min - v;
        dir = 1;
      }
    }
  } else if (s.mode === "forward" && v > s.max) v = s.min + ((v - s.min) % range);
  else if (s.mode === "backward" && v < s.min) v = s.max - ((s.min - v) % range);
  return { ...s, value: Math.min(s.max, Math.max(s.min, v)), dir };
}

export const sliderParams = (sliders: Slider[]): Record<string, number> => {
  const p: Record<string, number> = {};
  for (const s of sliders) p[s.name] = s.value;
  return p;
};
