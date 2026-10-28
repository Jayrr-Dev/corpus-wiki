import { clusterCircles, ORPHANS_LABEL } from "@/lib/graph";
import { DEFAULT_GRAPH_SETTINGS } from "@/lib/graph/settings";
import { expect, it } from "vitest";
import { drawGraph, type DrawInput } from "./drawGraph";

function dot(id: string, degree: number, x: number, y: number, label = id) {
  return {
    id,
    kind: "unit" as const,
    label,
    text: label,
    href: "",
    createdAt: "",
    degree,
    domainPaths: [] as string[],
    entityNames: [] as string[],
    unitKind: null,
    status: null,
    x,
    y,
  };
}

function recordingContext(measure: (text: string) => number) {
  const painted: { text: string; x: number; y: number; font: string }[] = [];
  let font = "10px sans-serif";
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(_, key) {
        if (key === "font") return font;
        if (key === "measureText")
          return (text: string) => ({ width: measure(text) });
        if (key === "fillText")
          return (text: string, x: number, y: number) =>
            painted.push({ text, x, y, font });
        return () => {};
      },
      set(_, key, value) {
        if (key === "font") font = String(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, painted };
}

const palette = {
  background: "#111",
  border: "#333",
  text: "#fff",
  muted: "#aaa",
  faint: "#666",
  fontFamily: "sans-serif",
  token: () => "#aaf",
};

it("keeps domain text at readable screen sizes even below the canvas font limit", () => {
  let font = "10px sans-serif";
  let transform: number[] = [];
  const labels: { font: string; transform: number[]; x: number; y: number }[] =
    [];
  const ctx = new Proxy(
    {},
    {
      get(_, key) {
        if (key === "font") return font;
        if (key === "setTransform")
          return (...value: number[]) => {
            transform = value;
          };
        if (key === "fillText")
          return (_: string, x: number, y: number) =>
            labels.push({ font, transform: [...transform], x, y });
        if (key === "measureText") return () => ({ width: 60 });
        return () => {};
      },
      set(_, key, value) {
        if (key === "font") font = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  drawGraph({
    ctx,
    width: 800,
    height: 600,
    pixelRatio: 2,
    camera: { x: 400, y: 300, k: 0.000001 },
    overviewZoom: 0.000001,
    nodes: [],
    links: [],
    circles: [
      {
        key: "root",
        label: "Domain",
        depth: 0,
        parent: "",
        isBranch: true,
        x: 0,
        y: 0,
        r: 100,
        count: 1,
        index: 0,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette: {
      background: "#111",
      border: "#333",
      text: "#fff",
      muted: "#aaa",
      faint: "#666",
      fontFamily: "sans-serif",
      token: () => "#aaf",
    },
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  expect(labels).toHaveLength(1);
  expect(labels[0]!.font).toBe("700 32px sans-serif");
  expect(labels[0]!.transform).toEqual([2, 0, 0, 2, 0, 0]);
  expect(labels[0]!.x).toBe(400);
  expect(labels[0]!.y).toBeCloseTo(297);
});

it("paints nested domain circles progressively fainter and names only the top two levels at the overview", () => {
  const fills: number[] = [];
  const outlines: number[] = [];
  const labels: number[] = [];
  const paint: { alpha: number; color: string }[] = [];
  const ctx = new Proxy(
    { globalAlpha: 1, fillStyle: "" },
    {
      get(target, key) {
        if (key === "globalAlpha") return target.globalAlpha;
        if (key === "fill")
          return () => {
            paint.push({ alpha: target.globalAlpha, color: target.fillStyle });
            if (target.fillStyle !== "#111") fills.push(target.globalAlpha);
          };
        if (key === "stroke") return () => outlines.push(target.globalAlpha);
        if (key === "fillText") return () => labels.push(target.globalAlpha);
        if (key === "measureText") return () => ({ width: 20 });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const input: DrawInput = {
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 0, y: 0, k: 1 },
    overviewZoom: 1,
    nodes: [],
    links: [],
    circles: [0, 1, 2, 3].map((depth) => ({
      key: `domain-${depth}`,
      label: `Domain ${depth}`,
      depth,
      parent: "",
      isBranch: true,
      x: 100 + depth * 150,
      y: 300,
      r: 30,
      count: 1,
      index: 0,
    })),
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain" as const,
    palette: {
      background: "#111",
      border: "#333",
      text: "#fff",
      muted: "#aaa",
      faint: "#666",
      fontFamily: "sans-serif",
      token: () => "#aaf",
    },
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  };
  drawGraph(input);
  expect(paint.map((entry) => entry.color)).toEqual([
    "#aaf",
    "#111",
    "#aaf",
    "#111",
    "#aaf",
    "#111",
    "#aaf",
  ]);
  expect(
    paint.filter((entry) => entry.color === "#111").map((entry) => entry.alpha),
  ).toEqual([1, 1, 1]);
  expect(fills[0]).toBe(0.16);
  expect(fills[1]).toBeCloseTo(0.0288);
  expect(fills[2]).toBeLessThan(0.006);
  expect(fills[3]).toBeLessThan(0.001);
  expect(outlines.slice(0, 4)).toEqual([0.8, 0.8, 0.8, 0.8]);
  expect(labels).toEqual([1, 1]);
  labels.length = 0;
  // Four times the overview zoom: every level is named
  drawGraph({ ...input, overviewZoom: 0.25 });
  expect(labels).toEqual([1, 1, 1, 1]);
});

it("sums links between domains into one line at the overview, then shows them bundled one by one on zoom", () => {
  const strokes: { alpha: number; curves: number; lines: number }[] = [];
  let curves = 0,
    lines = 0;
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, key) {
        if (key === "globalAlpha") return target.globalAlpha;
        if (key === "beginPath")
          return () => {
            curves = 0;
            lines = 0;
          };
        if (key === "quadraticCurveTo")
          return () => {
            curves++;
          };
        if (key === "lineTo")
          return () => {
            lines++;
          };
        if (key === "stroke")
          return () => {
            if (curves || lines)
              strokes.push({ alpha: target.globalAlpha, curves, lines });
          };
        if (key === "measureText") return () => ({ width: 20 });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const node = (id: string, x: number, domain: string) => ({
    id,
    kind: "unit" as const,
    label: id,
    text: id,
    href: "",
    createdAt: "",
    degree: 1,
    domainPaths: [domain],
    entityNames: [],
    unitKind: null,
    status: null,
    x,
    y: 0,
  });
  const [a, b, c] = [
    node("a", 0, "Left"),
    node("b", 400, "Right"),
    node("c", 10, "Left"),
  ];
  const input = (k: number): DrawInput => ({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 0, y: 0, k },
    overviewZoom: 1,
    nodes: [a, b, c],
    links: [
      { id: "stored", source: a, target: b, kind: "supports" },
      { id: "similar", source: a, target: c, kind: "similar" },
      { id: "across", source: c, target: b, kind: "similar" },
    ],
    circles: [
      {
        key: "Left",
        label: "Left",
        depth: 0,
        parent: "",
        isBranch: false,
        x: 0,
        y: 100,
        r: 50,
        count: 1,
        index: 0,
      },
      {
        key: "Right",
        label: "Right",
        depth: 0,
        parent: "",
        isBranch: false,
        x: 400,
        y: 100,
        r: 50,
        count: 1,
        index: 1,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette: {
      background: "#111",
      border: "#333",
      text: "#fff",
      muted: "#aaa",
      faint: "#666",
      fontFamily: "sans-serif",
      token: () => "#aaf",
    },
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  drawGraph(input(1));
  // Overview: one summary line between the two domains; similar links and single links hidden
  expect(strokes).toEqual([{ alpha: 0.45, curves: 0, lines: 1 }]);
  strokes.length = 0;
  drawGraph(input(4));
  // Zoomed in: the similar link inside "Left" shows, the one across domains stays hidden,
  // and the stored link is still bundled
  expect(strokes).toHaveLength(2);
  expect(strokes[0]).toMatchObject({ curves: 0, lines: 1 });
  expect(strokes[1]).toEqual({ alpha: 0.7, curves: 2, lines: 0 });
});

it("centers a bubble title and keeps it larger than the note title size", () => {
  const { ctx, painted } = recordingContext(() => 48);
  const node = dot("hub", 40, 200, 200, "Instinctive Triad grouping");
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 0, y: 0, k: 3 },
    overviewZoom: null,
    nodes: [node],
    links: [],
    circles: [],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => "applied",
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  const title = painted.find((item) => item.text.startsWith("Instinctive"));
  expect(title?.text).toBe("Instinctive Triad grouping");
  const centerY = 200 * 3;
  const size = Number.parseFloat(title!.font);
  const line = size * 1.3;
  // Bigger than the outside title (12px), and the line sits across the middle
  expect(size).toBeGreaterThan(12);
  expect(title!.y).toBeLessThan(centerY);
  expect(title!.y + line).toBeGreaterThan(centerY);
});

it("drops the ellipsis once a bubble is large on screen", () => {
  let font = "12px sans-serif";
  const painted: { text: string; y: number }[] = [];
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(_, key) {
        if (key === "font") return font;
        if (key === "measureText")
          return (text: string) => ({
            width: text.length * Number.parseFloat(font) * 0.5,
          });
        if (key === "fillText")
          return (text: string, _x: number, y: number) =>
            painted.push({ text, y });
        return () => {};
      },
      set(_, key, value) {
        if (key === "font") font = String(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const label = "Eight cognitive fixation pattern";
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 400, y: 400, k: 6 },
    overviewZoom: null,
    nodes: [dot("hub", 20, 0, 0, label)],
    links: [],
    circles: [],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  const lines = painted.map((item) => item.text);
  expect(lines.join(" ")).toBe(label);
  expect(lines.some((line) => line.includes("…"))).toBe(false);
  const centerY = 400;
  const first = painted[0]!;
  const last = painted.at(-1)!;
  expect(first.y).toBeLessThan(centerY);
  expect(last.y).toBeGreaterThanOrEqual(first.y);
  expect(last.y).toBeLessThan(centerY + 80);
});

it("keeps the first words when a title is too tall for its bubble", () => {
  const { ctx, painted } = recordingContext((text) => text.length * 6);
  const label =
    "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike";
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 0, y: 0, k: 2 },
    overviewZoom: null,
    nodes: [dot("note", 15, 200, 200, label)],
    links: [],
    circles: [],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  const title = painted.map((item) => item.text).join(" ");
  expect(title.startsWith("Alpha")).toBe(true);
  expect(title.endsWith("…")).toBe(true);
  expect(title.length).toBeLessThan(label.length);
});

it("gives a larger bubble its title before a smaller neighbor can take the space", () => {
  const { ctx, painted } = recordingContext(() => 80);
  const large = dot("large", 3, 200, 200, "Large title");
  const small = dot("small", 1, 200, 200, "Small title");
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 0, y: 0, k: 2 },
    overviewZoom: null,
    nodes: [small, large],
    links: [],
    circles: [],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  const texts = painted.map((item) => item.text);
  expect(texts).toContain("Large title");
  expect(texts).not.toContain("Small title");
});

it("dims lines that only cross the circle in view, and keeps lines that enter or leave it", () => {
  const alphas: number[] = [];
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, key) {
        if (key === "globalAlpha") return target.globalAlpha;
        if (key === "stroke")
          return () => {
            alphas.push(target.globalAlpha);
          };
        if (key === "measureText") return () => ({ width: 20 });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const node = (id: string, x: number, domain: string) => ({
    id,
    kind: "unit" as const,
    label: id,
    text: id,
    href: "",
    createdAt: "",
    degree: 1,
    domainPaths: [domain],
    entityNames: [],
    unitKind: null,
    status: null,
    x,
    y: 0,
  });
  const inside = node("in", 0, "Type Two");
  const left = node("left", -800, "Other");
  const right = node("right", 800, "Else");
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 400, y: 400, k: 2 },
    overviewZoom: null,
    nodes: [inside, left, right],
    links: [
      { id: "out", source: inside, target: right, kind: "supports" },
      { id: "cross", source: left, target: right, kind: "supports" },
    ],
    circles: [
      {
        key: "Type Two",
        label: "Type Two",
        depth: 0,
        parent: "",
        isBranch: true,
        x: 0,
        y: 0,
        r: 200,
        count: 3,
        index: 0,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  expect(alphas).toContain(0.08);
  expect(alphas).toContain(0.7);
});

it("hides note titles until the camera is inside an inner group", () => {
  const titles: string[] = [];
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, key) {
        if (key === "globalAlpha") return target.globalAlpha;
        if (key === "fillText")
          return (text: string) => {
            if (target.globalAlpha > 0.05) titles.push(text);
          };
        if (key === "measureText") return () => ({ width: 40 });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const node = {
    ...dot("note", 4, 0, 0, "Average Twos"),
    domainPaths: ["Type Two/Stress"],
  };
  const input = (k: number): DrawInput => ({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 400, y: 400, k },
    overviewZoom: 1,
    nodes: [node],
    links: [],
    circles: [
      {
        key: "Type Two/Stress",
        label: "Stress and movement",
        depth: 1,
        parent: "Type Two",
        isBranch: false,
        x: 0,
        y: 0,
        r: 40,
        count: 4,
        index: 0,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  drawGraph(input(2));
  expect(titles).not.toContain("Average Twos");
  titles.length = 0;
  drawGraph(input(16));
  expect(titles).toContain("Average Twos");
});

it("wraps a long group title inside its circle", () => {
  const lines: string[] = [];
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, key) {
        if (key === "globalAlpha") return target.globalAlpha;
        if (key === "fillText")
          return (text: string) => {
            if (target.globalAlpha > 0.2) lines.push(text);
          };
        if (key === "measureText")
          return (text: string) => ({ width: text.length * 10 });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 400, y: 400, k: 2 },
    overviewZoom: null,
    nodes: [],
    links: [],
    circles: [
      {
        key: "ocpd",
        label: "Obsessive-Compulsive Personality Disorder",
        depth: 1,
        parent: "",
        isBranch: false,
        x: 0,
        y: 0,
        r: 50,
        count: 8,
        index: 0,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.join(" ")).toContain("Obsessive-");
  expect(lines.join(" ")).toContain("Disorder");
});

it("shows a title inside a large bubble before the group fills the view", () => {
  const { ctx, painted } = recordingContext((text) => text.length * 5);
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 400, y: 400, k: 2 },
    overviewZoom: 1,
    nodes: [
      {
        ...dot("hub", 40, 0, 0, "Instinctive Triad"),
        domainPaths: ["Type Two/Stress"],
      },
    ],
    links: [],
    circles: [
      {
        key: "Type Two/Stress",
        label: "Stress and movement",
        depth: 1,
        parent: "Type Two",
        isBranch: false,
        x: 0,
        y: 0,
        r: 30,
        count: 4,
        index: 0,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => "applied",
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  expect(painted.map((item) => item.text).join(" ")).toContain("Instinctive");
});

it("leaves a note title off when it would sit on the domain title", () => {
  const { ctx, painted } = recordingContext((text) => text.length * 6);
  const domain = {
    ...dot("domain", 30, 0, 0, "Levels of development"),
    kind: "domain" as const,
    domainPaths: ["Levels of development"],
  };
  const note = dot("note", 6, 0, 0, "Type One");
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 400, y: 400, k: 2 },
    overviewZoom: 1,
    nodes: [note, domain],
    links: [],
    circles: [
      {
        key: "Levels of development",
        label: "Levels of development",
        depth: 0,
        parent: "",
        isBranch: false,
        x: 0,
        y: 0,
        r: 80,
        count: 4,
        index: 0,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => "link",
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  const texts = painted.map((item) => item.text).join(" ");
  expect(texts).toContain("Levels");
  expect(texts).not.toContain("Type One");
});

it("paints a group name across the bubbles in dark ink", () => {
  const paints: { text: string; fill: string }[] = [];
  let fillStyle = "";
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, key) {
        if (key === "globalAlpha") return target.globalAlpha;
        if (key === "fillStyle") return fillStyle;
        if (key === "fillText")
          return (text: string) => {
            if (target.globalAlpha > 0.2) paints.push({ text, fill: fillStyle });
          };
        if (key === "measureText")
          return (text: string) => ({ width: text.length * 8 });
        return () => {};
      },
      set(target, key, value) {
        if (key === "fillStyle") fillStyle = String(value);
        if (key === "globalAlpha") target.globalAlpha = Number(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 400, y: 400, k: 2 },
    overviewZoom: 1,
    nodes: [],
    links: [],
    circles: [
      {
        key: "Type Two/Stress",
        label: "Stress and movement",
        depth: 1,
        parent: "Type Two",
        isBranch: false,
        x: 0,
        y: 0,
        r: 40,
        count: 4,
        index: 0,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  });
  const title = paints.find((item) => item.text.includes("Stress"));
  expect(title?.fill).toBe(palette.background);
});

it("sizes a group name from the circle and keeps a minimum", () => {
  const paint = (r: number, label: string) => {
    const { ctx, painted } = recordingContext((text) => text.length * 8);
    drawGraph({
      ctx,
      width: 800,
      height: 800,
      pixelRatio: 1,
      camera: { x: 400, y: 400, k: 2 },
      overviewZoom: 1,
      nodes: [],
      links: [],
      circles: [
        {
          key: "group",
          label,
          depth: 1,
          parent: "",
          isBranch: false,
          x: 0,
          y: 0,
          r,
          count: 8,
          index: 0,
        },
      ],
      display: DEFAULT_GRAPH_SETTINGS.display,
      groupBy: "domain",
      palette,
      colorOf: () => null,
      focusId: null,
      focusIds: new Set(),
      hoverLabelOnly: false,
    });
    return painted.filter((item) => item.text.length > 0);
  };
  const sizeOf = (font: string) => Number(font.match(/(\d+)px/)?.[1]);
  const large = paint(
    120,
    "Type Three Level 7: Dishonest Opportunist and a longer group name",
  );
  const small = paint(16, "Group");
  expect(large.length).toBeGreaterThan(0);
  expect(small.length).toBeGreaterThan(0);
  expect(sizeOf(large[0]!.font)).toBe(64);
  expect(sizeOf(small[0]!.font)).toBe(12);
  expect(large.map((item) => item.text).join(" ").startsWith("Type")).toBe(
    true,
  );
});

it("fades groups the focus does not connect to and keeps linked groups bright", () => {
  const rings: number[] = [];
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, key) {
        if (key === "globalAlpha") return target.globalAlpha;
        if (key === "stroke") return () => rings.push(target.globalAlpha);
        if (key === "measureText") return () => ({ width: 20 });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const placed = (id: string, domain: string, x: number) => ({
    id,
    kind: "unit" as const,
    label: id,
    text: id,
    href: "",
    createdAt: "",
    degree: 1,
    domainPaths: [domain],
    entityNames: [] as string[],
    unitKind: null,
    status: null,
    x,
    y: 0,
  });
  const home = placed("home", "Home/Child", 0);
  const linked = placed("linked", "Linked", 200);
  const other = placed("other", "Other", 400);
  const circle = (
    key: string,
    depth: number,
    x: number,
  ): DrawInput["circles"][number] => ({
    key,
    label: key,
    depth,
    parent: depth === 0 ? "" : "Home",
    isBranch: depth === 0 && key === "Home",
    x,
    y: 0,
    r: 40,
    count: 1,
    index: depth,
  });
  const input: DrawInput = {
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 0, y: 0, k: 1 },
    overviewZoom: null,
    nodes: [home, linked, other],
    links: [{ id: "join", source: home, target: linked, kind: "supports" }],
    circles: [
      circle("Home", 0, 0),
      circle("Linked", 0, 200),
      circle("Other", 0, 400),
      circle("Home/Child", 1, 0),
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: () => null,
    focusId: "home",
    focusMix: 1,
    focusIds: new Set(["home", "linked"]),
    hoverLabelOnly: false,
  };
  drawGraph(input);
  expect(rings.slice(0, 4).map((alpha) => Number(alpha.toFixed(3)))).toEqual([
    0.8, 0.8, 0.08, 0.8,
  ]);
  rings.length = 0;
  drawGraph({
    ...input,
    focusId: null,
    focusIds: new Set(),
    focusedDomain: "Home",
  });
  expect(rings.slice(0, 4).map((alpha) => Number(alpha.toFixed(3)))).toEqual([
    0.8, 0.8, 0.096, 0.8,
  ]);
});

it("paints a domain bubble and its ring from the connection, shifted for the canvas", () => {
  const fills: string[] = [];
  let fillStyle = "";
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(_, key) {
        if (key === "fillStyle") return fillStyle;
        if (key === "fill")
          return () => {
            fills.push(fillStyle);
          };
        if (key === "measureText") return () => ({ width: 10 });
        return () => {};
      },
      set(_, key, value) {
        if (key === "fillStyle") fillStyle = String(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const domain = {
    ...dot("d", 8, 0, 0, "Topic"),
    kind: "domain" as const,
    domainPaths: ["Topic"],
  };
  const note = { ...dot("u", 2, 40, 0, "Note"), domainPaths: ["Topic"] };
  const palette = {
    background: "#111111",
    border: "#333333",
    text: "#ffffff",
    muted: "#aaaaaa",
    faint: "#666666",
    fontFamily: "sans-serif",
    token: (name: string) => (name === "link" ? "#8ab4f8" : "#aaaaaa"),
  };
  const input: DrawInput = {
    ctx,
    width: 400,
    height: 400,
    pixelRatio: 1,
    camera: { x: 200, y: 200, k: 1 },
    overviewZoom: null,
    nodes: [domain, note],
    links: [{ id: "join", source: domain, target: note, kind: "supports" }],
    circles: [
      {
        key: "Topic",
        label: "Topic",
        depth: 0,
        parent: "",
        isBranch: false,
        x: 0,
        y: 0,
        r: 80,
        count: 1,
        index: 0,
      },
    ],
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "domain",
    palette,
    colorOf: (node) => (node.kind === "domain" ? null : "link"),
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
  };
  drawGraph(input);
  expect(fills).toContain("#cee0fc");
  expect(fills).toContain("#8ab4f8");
  fills.length = 0;
  drawGraph({
    ...input,
    palette: { ...palette, background: "#faf9f6" },
  });
  expect(fills).toContain("#3b4c69");
  expect(fills).toContain("#8ab4f8");
});

it("lights orphan notes when the Orphans circle is selected", () => {
  const fills: { style: string; alpha: number }[] = [];
  let fillStyle = "";
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, key) {
        if (key === "globalAlpha") return target.globalAlpha;
        if (key === "fillStyle") return fillStyle;
        if (key === "fill")
          return () => {
            fills.push({ style: fillStyle, alpha: target.globalAlpha });
          };
        if (key === "measureText") return () => ({ width: 10 });
        return () => {};
      },
      set(target, key, value) {
        if (key === "fillStyle") fillStyle = String(value);
        if (key === "globalAlpha") target.globalAlpha = Number(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const orphan = {
    ...dot("orphan", 0, 0, 0, "Loose"),
    pageTitles: [] as string[],
  };
  const circles = clusterCircles([orphan], 1, "page");
  const group = circles.find((circle) => circle.label === ORPHANS_LABEL)!;
  drawGraph({
    ctx,
    width: 800,
    height: 800,
    pixelRatio: 1,
    camera: { x: 400, y: 400, k: 1 },
    overviewZoom: 1,
    nodes: [orphan],
    links: [],
    circles,
    display: DEFAULT_GRAPH_SETTINGS.display,
    groupBy: "page",
    palette,
    colorOf: () => null,
    focusId: null,
    focusIds: new Set(),
    hoverLabelOnly: false,
    focusedDomain: group.key,
  });
  expect(
    fills.some((fill) => fill.style === palette.text && fill.alpha === 1),
  ).toBe(true);
});
