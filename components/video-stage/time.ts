// =====================================================================
// STAGE TIME HELPERS: a scene is a pure function of t (seconds), so all
// motion is computed from t with these. No React, no DOM.
// =====================================================================

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

// Progress 0..1 of t through the window a..b (0 before, 1 after)
export function seg(t: number, a: number, b: number): number {
  if (b <= a) return t >= b ? 1 : 0;
  return clamp((t - a) / (b - a));
}

// Cubic ease out: fast start, soft landing
export function easeOut(p: number): number {
  const x = clamp(p);
  return 1 - (1 - x) ** 3;
}

// Cubic ease in-out: soft start and landing
export function easeInOut(p: number): number {
  const x = clamp(p);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

export function lerp(from: number, to: number, p: number): number {
  return from + (to - from) * p;
}

// The first part of `text` a typist has reached at progress p (0..1)
export function typed(text: string, p: number): string {
  return text.slice(0, Math.round(clamp(p) * text.length));
}

// Value at t on a keyframe track [[time, value], ...] sorted by time; eased between keys,
// held before the first and after the last
export function keyframes(t: number, keys: readonly (readonly [number, number])[], ease: (p: number) => number = easeInOut): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [time, value] = keys[i]!;
    if (t < time) {
      const [prevTime, prevValue] = keys[i - 1]!;
      return lerp(prevValue, value, ease(seg(t, prevTime, time)));
    }
  }
  return keys.at(-1)![1];
}
