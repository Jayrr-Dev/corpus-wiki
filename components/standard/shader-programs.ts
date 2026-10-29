/**
 * Original fragment shaders for the Shader layer, run through Paper's
 * ShaderMount. Each reads three colors (back, front, accent) and a scale,
 * and draws from gl_FragCoord so it needs none of Paper's sizing uniforms.
 */

const header = `#version 300 es
precision highp float;

uniform float u_time;
// Paper's vertex shader declares these at mediump; linked uniforms must match.
uniform mediump vec2 u_resolution;
uniform mediump float u_pixelRatio;
uniform vec4 u_colorBack;
uniform vec4 u_colorFront;
uniform vec4 u_colorAccent;
uniform float u_density;

out vec4 fragColor;

#define PI 3.14159265359

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Back, then front by f, then accent by a. Premultiplied so alpha colors work.
vec4 paint(float f, float a) {
  vec4 back = vec4(u_colorBack.rgb * u_colorBack.a, u_colorBack.a);
  vec4 front = vec4(u_colorFront.rgb * u_colorFront.a, u_colorFront.a);
  vec4 accent = vec4(u_colorAccent.rgb * u_colorAccent.a, u_colorAccent.a);
  vec4 color = mix(back, front, clamp(f, 0., 1.));
  return mix(color, accent, clamp(a, 0., 1.));
}

// Centered, aspect-correct coordinates, about -0.5..0.5 on the short side.
vec2 centered() {
  return (gl_FragCoord.xy - .5 * u_resolution) / min(u_resolution.x, u_resolution.y);
}

// A 3x5 pseudo glyph that flips its bits over time.
float glyph(vec2 cellUV, vec2 id, float tick) {
  vec2 inner = (cellUV - vec2(.18, .12)) / vec2(.64, .76);
  if (inner.x < 0. || inner.x > 1. || inner.y < 0. || inner.y > 1.) return 0.;
  vec2 bit = floor(inner * vec2(3., 5.));
  return step(.5, hash(bit + id * 17.31 + tick));
}
`

/** Digital rain: glyph columns falling at their own speeds, bright heads. */
const matrix = `${header}
void main() {
  vec2 px = gl_FragCoord.xy / u_pixelRatio;
  float cell = 14. * u_density;
  vec2 id = floor(px / cell);
  vec2 cellUV = fract(px / cell);
  float rows = floor(u_resolution.y / u_pixelRatio / cell) + 1.;
  float fromTop = rows - id.y;

  float speed = 6. + hash(vec2(id.x, 1.)) * 10.;
  float span = rows + 24.;
  float head = mod(u_time * speed + hash(vec2(id.x, 7.)) * span, span);
  float trail = 10. + hash(vec2(id.x, 3.)) * 14.;
  float behind = head - fromTop;
  float lit = behind >= 0. && behind < trail ? 1. - behind / trail : 0.;

  float tick = floor(u_time * 6. + hash(id) * 20.);
  float g = glyph(cellUV, id, tick);
  float isHead = behind >= 0. && behind < 1. ? 1. : 0.;
  fragColor = paint(lit * g, isHead * g);
}
`

/** Hacker console: typed lines scrolling up, scanlines, glitching rows. */
const terminal = `${header}
void main() {
  vec2 px = gl_FragCoord.xy / u_pixelRatio;
  vec2 cell = vec2(8., 14.) * u_density;
  float scroll = u_time * 22.;
  float row = floor((px.y + scroll) / cell.y);

  // Occasional rows jump sideways and flash the accent.
  float glitchTick = floor(u_time * 5.);
  float glitch = step(.975, hash(vec2(row, glitchTick)));
  float shift = glitch * (hash(vec2(glitchTick, row)) - .5) * 60.;
  vec2 p = vec2(px.x + shift, px.y + scroll);

  vec2 id = floor(p / cell);
  vec2 cellUV = fract(p / cell);
  float cols = u_resolution.x / u_pixelRatio / cell.x;
  float lineLength = hash(vec2(row, 2.)) * cols * .85 + 3.;
  float indent = floor(hash(vec2(row, 5.)) * 3.) * 2.;
  float typed = step(indent, id.x) * step(id.x, lineLength);
  float blank = step(.82, hash(vec2(row, 9.)));
  float g = glyph(cellUV, id, floor(hash(id) * 4.)) * typed * (1. - blank);

  float scan = .75 + .25 * sin(gl_FragCoord.y / u_pixelRatio * PI);
  float cursor = step(abs(id.x - lineLength - 1.), .5) * step(.5, fract(u_time * 2.)) * (1. - blank);
  fragColor = paint(g * scan + cursor * .8, glitch * g);
}
`

/** Shared by the escape-time fractals: complex math and band coloring. */
const escapeTime = `${header}
vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cdiv(vec2 a, vec2 b) {
  return vec2(dot(a, b), a.y * b.x - a.x * b.y) / (dot(b, b) + 1e-12);
}

// Color bands cycle through the escape count; the accent glows near the set.
vec4 escapePaint(float n, vec2 z, float maxIter) {
  if (n >= maxIter) return paint(0., 0.);
  float smoothN = n - log2(log2(dot(z, z))) + 4.;
  float bands = .5 + .5 * sin(smoothN * .45 - u_time * 1.2);
  float nearSet = smoothstep(.25, 1., clamp(smoothN / 40., 0., 1.));
  return paint(bands * smoothstep(1., 6., smoothN), nearSet);
}
`

/**
 * Endless Mandelbrot dive into Seahorse Valley. The zoom loops before
 * float precision runs out.
 */
const mandelbrot = `${escapeTime}
void main() {
  vec2 target = vec2(-.743643887, .131825904);
  float zoom = 2.5 * exp(-mod(u_time * .25, 9.)) / u_density;
  vec2 c = target + centered() * zoom;
  vec2 z = vec2(0.);
  float n = 0.;
  const float maxIter = 200.;
  for (float i = 0.; i < maxIter; i++) {
    z = cmul(z, z) + c;
    if (dot(z, z) > 16.) break;
    n++;
  }
  fragColor = escapePaint(n, z, maxIter);
}
`

/** Julia set whose constant orbits the Mandelbrot edge, so it keeps morphing. */
const julia = `${escapeTime}
void main() {
  float t = u_time * .2;
  vec2 c = .7885 * vec2(cos(t), sin(t));
  vec2 z = centered() * 3. / u_density;
  float n = 0.;
  const float maxIter = 160.;
  for (float i = 0.; i < maxIter; i++) {
    z = cmul(z, z) + c;
    if (dot(z, z) > 16.) break;
    n++;
  }
  fragColor = escapePaint(n, z, maxIter);
}
`

/** Burning Ship: a looping zoom from the whole fleet down to a small ship. */
const burningShip = `${escapeTime}
void main() {
  vec2 target = vec2(-1.762, -.028);
  float zoom = 3. * exp(-mod(u_time * .2, 4.)) / u_density;
  vec2 uv = centered();
  // Flip y so the ship sails upright.
  vec2 c = target + vec2(uv.x, -uv.y) * zoom;
  vec2 z = vec2(0.);
  float n = 0.;
  const float maxIter = 160.;
  for (float i = 0.; i < maxIter; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2. * abs(z.x * z.y)) + c;
    if (dot(z, z) > 16.) break;
    n++;
  }
  fragColor = escapePaint(n, z, maxIter);
}
`

/**
 * Newton's method on z^3 - 1. Each root gets a color, shaded by how long a
 * point takes to settle; a breathing relaxation factor keeps the basins moving.
 */
const newton = `${escapeTime}
void main() {
  float angle = u_time * .05;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 z = rot * centered() * 3. / u_density;
  float relax = 1. + .35 * sin(u_time * .4);
  float n = 0.;
  const float maxIter = 40.;
  for (float i = 0.; i < maxIter; i++) {
    vec2 z2 = cmul(z, z);
    vec2 dz = cdiv(cmul(z2, z) - vec2(1., 0.), 3. * z2);
    z -= relax * dz;
    if (dot(dz, dz) < 1e-6) break;
    n++;
  }
  float d0 = length(z - vec2(1., 0.));
  float d1 = length(z - vec2(-.5, .8660254));
  float d2 = length(z - vec2(-.5, -.8660254));
  float shade = sqrt(1. - n / maxIter);
  if (d0 < d1 && d0 < d2) fragColor = paint(shade, 0.);
  else if (d1 < d2) fragColor = paint(0., shade);
  else fragColor = paint(shade, shade * .5);
}
`

/**
 * Endless zoom into a Sierpinski carpet. The carpet repeats at 3x about its
 * corner, so mirroring into four quadrants and scaling by 3 loops seamlessly.
 */
const sierpinski = `${header}
void main() {
  float phase = fract(u_time * .12);
  vec2 p = abs(centered()) * 2. / u_density / pow(3., phase);
  // Points past the unit square read the carpet at a coarser level.
  float m = 0.;
  float q = max(p.x, p.y);
  if (q >= 1.) {
    m = floor(log(q) / log(3.)) + 1.;
    p /= pow(3., m);
  }
  float hole = 0.;
  float level = 0.;
  for (float i = 0.; i < 12.; i++) {
    p *= 3.;
    vec2 digit = floor(p);
    p = fract(p);
    if (digit.x == 1. && digit.y == 1.) {
      hole = 1.;
      level = i;
      break;
    }
  }
  // The same apparent hole keeps its color across the loop.
  float depth = level - m + phase;
  float glow = .5 + .5 * cos(depth * 1.3 - u_time * .6);
  fragColor = paint(1. - hole, hole * glow);
}
`

/** Apollonian gasket by repeated circle inversion, its folds breathing. */
const apollonian = `${header}
void main() {
  float angle = u_time * .03;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 p = rot * centered() * 2.5 / u_density;
  float s = 1.2 + .08 * sin(u_time * .3);
  float scale = 1.;
  float trap = 1e3;
  for (float i = 0.; i < 8.; i++) {
    p = -1. + 2. * fract(.5 * p + .5);
    float r2 = dot(p, p);
    trap = min(trap, r2);
    float k = s / r2;
    p *= k;
    scale *= k;
  }
  float d = .25 * abs(p.y) / scale;
  float pixel = 2.5 / u_density / min(u_resolution.x, u_resolution.y);
  float edge = smoothstep(pixel * 2., 0., d);
  float fill = .5 + .5 * sin(log(trap) * 2. + u_time * .5);
  fragColor = paint(fill * .6, edge);
}
`

/** Hypnotic spiral: rotating arms with pulsing color rings. */
const hypno = `${header}
void main() {
  vec2 uv = centered();
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float arms = 2.;
  float wave = sin(a * arms + r * 40. / u_density - u_time * 4.);
  float aa = fwidth(wave) * 1.5;
  float stripe = smoothstep(-aa, aa, wave);
  float pulse = .5 + .5 * sin(u_time * 3. - r * 18.);
  float core = smoothstep(.06, .0, r);
  fragColor = paint(stripe, stripe * pulse + core);
}
`

/** Classic demoscene plasma. */
const plasma = `${header}
void main() {
  vec2 uv = centered() * 8. / u_density;
  float t = u_time;
  float v = sin(uv.x + t);
  v += sin((uv.y + t) * .5);
  v += sin((uv.x + uv.y + t) * .5);
  vec2 c = uv + vec2(sin(t / 3.), cos(t / 2.)) * 3.;
  v += sin(sqrt(dot(c, c) + 1.) + t);
  v *= .5;
  float f = .5 + .5 * sin(v * PI);
  float a = smoothstep(.6, 1., .5 + .5 * cos(v * PI * 2.));
  fragColor = paint(f, a);
}
`

/** Endless checkered tunnel rushing toward the viewer. */
const tunnel = `${header}
void main() {
  vec2 uv = centered();
  float r = max(length(uv), 1e-3);
  float a = atan(uv.y, uv.x) / PI;
  float depth = .35 / r + u_time * .6;
  float twist = a * 8. / u_density + u_time * .15;
  float checker = mod(floor(twist) + floor(depth * 4. / u_density), 2.);
  float fog = smoothstep(0., .45, r);
  float ring = smoothstep(.92, 1., fract(depth * 4. / u_density));
  fragColor = paint(checker * fog, ring * fog);
}
`

/** Folded mirror symmetry over moving waves. */
const kaleidoscope = `${header}
void main() {
  vec2 uv = centered();
  float r = length(uv);
  float a = atan(uv.y, uv.x) + u_time * .1;
  float slice = 2. * PI / 8.;
  a = abs(mod(a, slice) - slice * .5);
  vec2 p = r * vec2(cos(a), sin(a)) * 6. / u_density;
  p += vec2(u_time * .3, -u_time * .2);
  float v = sin(p.x * 3. + sin(p.y * 2. + u_time)) * cos(p.y * 3. - u_time * .7);
  v += .5 * sin(length(p) * 4. - u_time * 2.);
  float f = .5 + .5 * v;
  fragColor = paint(smoothstep(.3, .7, f), smoothstep(.82, .98, f));
}
`

/** Layers of stars flying outward, a few tinted by the accent. */
const starfield = `${header}
void main() {
  vec2 uv = centered();
  float bright = 0.;
  float tinted = 0.;
  for (float i = 0.; i < 4.; i++) {
    float depth = fract(i / 4. + u_time * .08);
    float zoom = mix(24., .6, depth) / u_density;
    float fade = depth * smoothstep(1., .85, depth);
    vec2 grid = uv * zoom + i * 45.3;
    vec2 id = floor(grid);
    vec2 gv = fract(grid) - .5;
    float n = hash(id);
    vec2 offset = vec2(n, fract(n * 34.)) - .5;
    float d = length(gv - offset * .7);
    float star = smoothstep(.06, 0., d) + .015 / max(d, .005) * .15;
    star *= fade * step(.35, n);
    bright += star;
    tinted += star * step(.85, fract(n * 91.));
  }
  fragColor = paint(bright, tinted);
}
`

/** Retro sun over a scrolling neon grid. */
const synthwave = `${header}
void main() {
  vec2 uv = centered();
  float horizon = -.05;
  float f = 0.;
  float a = 0.;

  if (uv.y > horizon) {
    vec2 sunUV = uv - vec2(0., .17);
    float sun = smoothstep(.3, .295, length(sunUV));
    // Horizontal cutouts widen toward the bottom of the sun.
    float band = fract((uv.y - .17) * 18. + u_time * .4);
    float gap = mix(0., .45, clamp((.17 - uv.y) / .3, 0., 1.));
    sun *= step(gap, band);
    a = sun;
    f = exp(-(uv.y - horizon) * 14.) * .35;
  } else {
    float d = horizon - uv.y;
    float z = .3 / d;
    float x = uv.x * z * 2. / u_density;
    float zLine = z * .5 / u_density - u_time * .6;
    float gx = abs(fract(x) - .5) / fwidth(x);
    float gz = abs(fract(zLine) - .5) / fwidth(zLine);
    float line = 1. - min(min(gx, gz), 1.);
    f = line * smoothstep(0., .25, d) + exp(-d * 30.) * .6;
  }
  fragColor = paint(f, a);
}
`

/** Northern-lights ribbons with vertical shimmer. */
const aurora = `${header}
void main() {
  vec2 uv = centered();
  float f = 0.;
  float a = 0.;
  for (float i = 0.; i < 4.; i++) {
    float wave = sin(uv.x * 3. / u_density + u_time * .3 + i) * .1;
    wave += sin(uv.x * 7. / u_density - u_time * .5 + i * 2.) * .04;
    float center = .18 - i * .09 + wave;
    float band = exp(-abs(uv.y - center) * (10. + i * 4.));
    band *= .6 + .4 * sin(uv.x * 90. / u_density + i * 5. + u_time * 2.);
    band *= smoothstep(-.5, .1, uv.y - center + .2);
    f += band * (1. - i * .18);
    a += band * step(2., i) * .7;
  }
  fragColor = paint(f, a);
}
`

/** A soft spotlight wandering the surface, with a hot core in the accent. */
const spotlight = `${header}
void main() {
  vec2 uv = centered();
  vec2 center = vec2(sin(u_time * .31) * .35, sin(u_time * .23 + 1.) * .2);
  float d = length(uv - center);
  float radius = .32 * u_density;
  float light = smoothstep(radius, 0., d);
  float core = smoothstep(radius * .35, 0., d);
  fragColor = paint(light * light, core * .6);
}
`

/** Stage beams swinging down from the top edge, pooling where they land. */
const beam = `${header}
void main() {
  vec2 uv = centered();
  float halfW = .5 * u_resolution.x / min(u_resolution.x, u_resolution.y);
  float halfH = .5 * u_resolution.y / min(u_resolution.x, u_resolution.y);
  float f = 0.;
  float a = 0.;
  for (float i = 0.; i < 3.; i++) {
    vec2 origin = vec2((i - 1.) * halfW * .6, halfH + .05);
    float swing = sin(u_time * .5 + i * 2.1) * .35;
    vec2 dir = vec2(sin(swing), -cos(swing));
    vec2 v = uv - origin;
    float along = dot(v, dir);
    float across = abs(dot(v, vec2(-dir.y, dir.x)));
    float width = .1 * u_density * along;
    float cone = along > 0. ? smoothstep(width, width * .2, across) : 0.;
    float falloff = exp(-along * .9);
    f += cone * falloff * .55;
    a += cone * falloff * step(1.5, i) * .35;
  }
  fragColor = paint(f, a);
}
`

/** A glossy shine band sweeping diagonally across, then resting. */
const shine = `${header}
void main() {
  vec2 uv = centered();
  float s = uv.x + uv.y * .6;
  float pos = mod(u_time * .6, 4.) - 1.5;
  float width = .09 * u_density;
  float band = exp(-pow((s - pos) / width, 2.));
  float core = exp(-pow((s - pos) / (width * .25), 2.));
  float ambient = .12 + .08 * uv.y;
  fragColor = paint(ambient + band * .7, core * .8);
}
`

/** Out-of-focus bokeh discs drifting upward. */
const bokeh = `${header}
void main() {
  vec2 uv = centered();
  float f = 0.;
  float a = 0.;
  for (float i = 0.; i < 18.; i++) {
    float h = hash(vec2(i, 3.7));
    float size = mix(.05, .14, hash(vec2(i, 9.1))) * u_density;
    vec2 p = vec2(
      (h - .5) * 1.8 + sin(u_time * .2 + i) * .05,
      mod(hash(vec2(i, 1.3)) + u_time * mix(.02, .06, h), 1.4) - .7
    );
    float d = length(uv - p);
    float disc = smoothstep(size, size * .85, d);
    float rim = smoothstep(size * .75, size, d) * disc;
    float twinkle = .6 + .4 * sin(u_time + i * 4.);
    f += disc * (.45 + rim * .45) * twinkle;
    a += disc * step(.7, h) * .4;
  }
  fragColor = paint(f, a);
}
`

const shaderPrograms = {
  matrix,
  terminal,
  mandelbrot,
  julia,
  burningShip,
  newton,
  sierpinski,
  apollonian,
  hypno,
  plasma,
  tunnel,
  kaleidoscope,
  starfield,
  synthwave,
  aurora,
  spotlight,
  beam,
  shine,
  bokeh,
}

type ShaderProgramKind = keyof typeof shaderPrograms

type ShaderProgramParams = {
  colorBack: string
  colorFront: string
  colorAccent: string
  scale: number
  speed: number
}

/** Named looks per program. The first is the default. */
const shaderProgramPresets: Record<
  ShaderProgramKind,
  { name: string; params: ShaderProgramParams }[]
> = {
  matrix: [
    { name: "Default", params: { colorBack: "#000000", colorFront: "#00ff66", colorAccent: "#e6ffe9", scale: 1, speed: 1 } },
    { name: "Amber", params: { colorBack: "#0d0700", colorFront: "#ffb000", colorAccent: "#fff1c9", scale: 1, speed: 0.8 } },
    { name: "Ice", params: { colorBack: "#020816", colorFront: "#3fa9ff", colorAccent: "#ffffff", scale: 1.3, speed: 0.6 } },
  ],
  terminal: [
    { name: "Default", params: { colorBack: "#020a04", colorFront: "#33ff77", colorAccent: "#ff2e88", scale: 1, speed: 1 } },
    { name: "Amber", params: { colorBack: "#120900", colorFront: "#ffb347", colorAccent: "#4fd1ff", scale: 1, speed: 1 } },
    { name: "Mono", params: { colorBack: "#0a0a0a", colorFront: "#e8e8e8", colorAccent: "#ff4040", scale: 1.2, speed: 0.7 } },
  ],
  mandelbrot: [
    { name: "Default", params: { colorBack: "#05010f", colorFront: "#7b3cff", colorAccent: "#ffd166", scale: 1, speed: 1 } },
    { name: "Fire", params: { colorBack: "#000000", colorFront: "#d7261e", colorAccent: "#fff3b0", scale: 1, speed: 0.6 } },
    { name: "Ocean", params: { colorBack: "#001018", colorFront: "#00a6a6", colorAccent: "#e0fbfc", scale: 1.4, speed: 0.8 } },
  ],
  julia: [
    { name: "Default", params: { colorBack: "#03001a", colorFront: "#3d7bff", colorAccent: "#ff7ae0", scale: 1, speed: 1 } },
    { name: "Gold", params: { colorBack: "#0d0800", colorFront: "#c77800", colorAccent: "#fff4c2", scale: 0.8, speed: 0.7 } },
    { name: "Frost", params: { colorBack: "#f4f8ff", colorFront: "#5b8def", colorAccent: "#0b1e4a", scale: 1.2, speed: 0.5 } },
  ],
  burningShip: [
    { name: "Default", params: { colorBack: "#000000", colorFront: "#ff5a1f", colorAccent: "#ffe08a", scale: 1, speed: 1 } },
    { name: "Ghost", params: { colorBack: "#02040a", colorFront: "#5ad1ff", colorAccent: "#ffffff", scale: 1, speed: 0.7 } },
    { name: "Toxic", params: { colorBack: "#050d00", colorFront: "#7dff3a", colorAccent: "#d63cff", scale: 1.2, speed: 0.8 } },
  ],
  newton: [
    { name: "Default", params: { colorBack: "#05030f", colorFront: "#ff4d6d", colorAccent: "#4dd4ff", scale: 1, speed: 1 } },
    { name: "Candy", params: { colorBack: "#1a0022", colorFront: "#ffd23f", colorAccent: "#ee4266", scale: 0.8, speed: 1.3 } },
    { name: "Slate", params: { colorBack: "#0b0d10", colorFront: "#cfd8e3", colorAccent: "#5e81ac", scale: 1.3, speed: 0.6 } },
  ],
  sierpinski: [
    { name: "Default", params: { colorBack: "#0a0014", colorFront: "#e8e3ff", colorAccent: "#9b5cff", scale: 1, speed: 1 } },
    { name: "Circuit", params: { colorBack: "#000a05", colorFront: "#0f3d24", colorAccent: "#39ff88", scale: 1, speed: 0.7 } },
    { name: "Paper", params: { colorBack: "#fdf6e3", colorFront: "#1c1c1c", colorAccent: "#e4572e", scale: 1.3, speed: 0.5 } },
  ],
  apollonian: [
    { name: "Default", params: { colorBack: "#02010a", colorFront: "#4b2bbf", colorAccent: "#ffd6a5", scale: 1, speed: 1 } },
    { name: "Coral", params: { colorBack: "#001219", colorFront: "#0a9396", colorAccent: "#ee9b00", scale: 0.8, speed: 0.8 } },
    { name: "Ink", params: { colorBack: "#f7f4ea", colorFront: "#c9c3b1", colorAccent: "#111111", scale: 1.2, speed: 0.6 } },
  ],
  hypno: [
    { name: "Default", params: { colorBack: "#1b0036", colorFront: "#ff3df2", colorAccent: "#3dffb8", scale: 1, speed: 1 } },
    { name: "Toad", params: { colorBack: "#2a1500", colorFront: "#ffb000", colorAccent: "#ff3b00", scale: 0.8, speed: 1.3 } },
    { name: "Mono", params: { colorBack: "#000000", colorFront: "#ffffff", colorAccent: "#888888", scale: 1.2, speed: 0.7 } },
  ],
  plasma: [
    { name: "Default", params: { colorBack: "#12005e", colorFront: "#ff4f81", colorAccent: "#ffe66d", scale: 1, speed: 1 } },
    { name: "Acid", params: { colorBack: "#001a0d", colorFront: "#9dff00", colorAccent: "#ff00c8", scale: 0.7, speed: 1.4 } },
    { name: "Lava", params: { colorBack: "#1a0000", colorFront: "#ff4500", colorAccent: "#ffd000", scale: 1.5, speed: 0.5 } },
  ],
  tunnel: [
    { name: "Default", params: { colorBack: "#000000", colorFront: "#5a2dff", colorAccent: "#00f0ff", scale: 1, speed: 1 } },
    { name: "Checker", params: { colorBack: "#101010", colorFront: "#f5f5f5", colorAccent: "#ff3355", scale: 1, speed: 1.2 } },
    { name: "Wormhole", params: { colorBack: "#02000d", colorFront: "#2b0a5c", colorAccent: "#ff9ef7", scale: 0.6, speed: 0.7 } },
  ],
  kaleidoscope: [
    { name: "Default", params: { colorBack: "#0b0221", colorFront: "#00c2ff", colorAccent: "#ff5edb", scale: 1, speed: 1 } },
    { name: "Stained", params: { colorBack: "#1a0f00", colorFront: "#e63946", colorAccent: "#f4d35e", scale: 0.8, speed: 0.6 } },
    { name: "Mint", params: { colorBack: "#f1fff8", colorFront: "#2ec4b6", colorAccent: "#011627", scale: 1.3, speed: 0.8 } },
  ],
  starfield: [
    { name: "Default", params: { colorBack: "#000008", colorFront: "#ffffff", colorAccent: "#7ab8ff", scale: 1, speed: 1 } },
    { name: "Warp", params: { colorBack: "#02000a", colorFront: "#e0e7ff", colorAccent: "#ff6ad5", scale: 0.6, speed: 2.5 } },
    { name: "Drift", params: { colorBack: "#000000", colorFront: "#bfbfbf", colorAccent: "#ffd27a", scale: 1.4, speed: 0.4 } },
  ],
  synthwave: [
    { name: "Default", params: { colorBack: "#12002b", colorFront: "#ff2bd6", colorAccent: "#ffb627", scale: 1, speed: 1 } },
    { name: "Outrun", params: { colorBack: "#060016", colorFront: "#00e5ff", colorAccent: "#ff3864", scale: 1, speed: 1.3 } },
    { name: "Dusk", params: { colorBack: "#1d0b1f", colorFront: "#b967ff", colorAccent: "#fffb96", scale: 1.3, speed: 0.6 } },
  ],
  aurora: [
    { name: "Default", params: { colorBack: "#020617", colorFront: "#22e3a1", colorAccent: "#a855f7", scale: 1, speed: 1 } },
    { name: "Arctic", params: { colorBack: "#00111c", colorFront: "#7dd3fc", colorAccent: "#f0abfc", scale: 1.3, speed: 0.6 } },
    { name: "Ember", params: { colorBack: "#0c0200", colorFront: "#ff7a18", colorAccent: "#ff2e63", scale: 0.8, speed: 0.8 } },
  ],
  spotlight: [
    { name: "Default", params: { colorBack: "#050505", colorFront: "#f4efe6", colorAccent: "#ffffff", scale: 1, speed: 1 } },
    { name: "Warm", params: { colorBack: "#0d0703", colorFront: "#ffb866", colorAccent: "#fff4dc", scale: 1.2, speed: 0.6 } },
    { name: "Neon", params: { colorBack: "#07001a", colorFront: "#7c3aed", colorAccent: "#22d3ee", scale: 0.8, speed: 1.2 } },
  ],
  beam: [
    { name: "Default", params: { colorBack: "#040406", colorFront: "#e8eefc", colorAccent: "#8ab4ff", scale: 1, speed: 1 } },
    { name: "Concert", params: { colorBack: "#06000c", colorFront: "#ff3dbb", colorAccent: "#3dd9ff", scale: 1.2, speed: 1.4 } },
    { name: "Gold", params: { colorBack: "#0a0602", colorFront: "#ffcf7a", colorAccent: "#ff8a3d", scale: 0.8, speed: 0.6 } },
  ],
  shine: [
    { name: "Default", params: { colorBack: "#111114", colorFront: "#9ea3b0", colorAccent: "#ffffff", scale: 1, speed: 1 } },
    { name: "Gold", params: { colorBack: "#1a1206", colorFront: "#c9a24a", colorAccent: "#fff6d8", scale: 1.3, speed: 0.7 } },
    { name: "Holo", params: { colorBack: "#0b0b1a", colorFront: "#7de2fc", colorAccent: "#f9a8d4", scale: 1.6, speed: 0.8 } },
  ],
  bokeh: [
    { name: "Default", params: { colorBack: "#05060d", colorFront: "#ffd9a0", colorAccent: "#ff9ec4", scale: 1, speed: 1 } },
    { name: "City", params: { colorBack: "#02030a", colorFront: "#6ea8ff", colorAccent: "#ffcc4d", scale: 0.8, speed: 0.7 } },
    { name: "Fairy", params: { colorBack: "#040d08", colorFront: "#c8ff9e", colorAccent: "#fff7c2", scale: 0.6, speed: 1.2 } },
  ],
}

export {
  shaderProgramPresets,
  shaderPrograms,
  type ShaderProgramKind,
  type ShaderProgramParams,
}
