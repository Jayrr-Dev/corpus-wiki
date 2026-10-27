import { expect, it } from "vitest";
import { nodeRadius } from "@/lib/graph/physics";
import { DEFAULT_GRAPH_SETTINGS } from "@/lib/graph/settings";
import { drawGraph, type DrawInput } from "./drawGraph";

function dot(id: string, degree: number, x: number, y: number, label = id) {
  return { id, kind: "unit" as const, label, text: label, href: "", createdAt: "", degree, domainPaths: [] as string[], entityNames: [] as string[], unitKind: null, status: null, x, y };
}

function recordingContext(measure: (text: string) => number) {
  const painted: { text: string; x: number; y: number }[] = [];
  let font = "10px sans-serif";
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(_, key) {
      if (key === "font") return font;
      if (key === "measureText") return (text: string) => ({ width: measure(text) });
      if (key === "fillText") return (text: string, x: number, y: number) => painted.push({ text, x, y });
      return () => {};
    },
    set(_, key, value) {
      if (key === "font") font = String(value);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, painted };
}

const palette = { background: "#111", border: "#333", text: "#fff", muted: "#aaa", faint: "#666", fontFamily: "sans-serif", token: () => "#aaf" };

it("keeps domain text at readable screen sizes even below the canvas font limit", () => {
  let font = "10px sans-serif";
  let transform: number[] = [];
  const labels: {font:string;transform:number[];x:number;y:number}[] = [];
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === "font") return font;
      if (key === "setTransform") return (...value:number[]) => {transform=value;};
      if (key === "fillText") return (_:string,x:number,y:number) => labels.push({font,transform:[...transform],x,y});
      if (key === "measureText") return () => ({width:60});
      return () => {};
    },
    set(_, key, value) {if(key === "font") font=value; return true;},
  }) as unknown as CanvasRenderingContext2D;
  drawGraph({
    ctx,width:800,height:600,pixelRatio:2,camera:{x:400,y:300,k:0.000001},overviewZoom:0.000001,
    nodes:[],links:[],circles:[{key:"root",label:"Domain",depth:0,isBranch:true,x:0,y:0,r:100,index:0}],
    display:DEFAULT_GRAPH_SETTINGS.display,
    palette:{background:"#111",border:"#333",text:"#fff",muted:"#aaa",faint:"#666",fontFamily:"sans-serif",token:()=>"#aaf"},
    colorOf:()=>null,focusId:null,focusIds:new Set(),hoverLabelOnly:false,
  });
  expect(labels).toHaveLength(1);
  expect(labels[0]!.font).toBe("700 20px sans-serif");
  expect(labels[0]!.transform).toEqual([2,0,0,2,0,0]);
  expect(labels[0]!.x).toBe(400);
  expect(labels[0]!.y).toBeCloseTo(297);
});

it("paints nested domain circles progressively fainter and names only the top two levels at the overview", () => {
  const fills: number[] = [];
  const outlines: number[] = [];
  const labels: number[] = [];
  const paint: { alpha: number; color: string }[] = [];
  const ctx = new Proxy({ globalAlpha: 1, fillStyle: "" }, {
    get(target, key) {
      if (key === "globalAlpha") return target.globalAlpha;
      if (key === "fill") return () => {
        paint.push({ alpha: target.globalAlpha, color: target.fillStyle });
        if (target.fillStyle !== "#111") fills.push(target.globalAlpha);
      };
      if (key === "stroke") return () => outlines.push(target.globalAlpha);
      if (key === "fillText") return () => labels.push(target.globalAlpha);
      if (key === "measureText") return () => ({ width: 20 });
      return () => {};
    },
  }) as unknown as CanvasRenderingContext2D;
  const input: DrawInput = {
    ctx, width: 800, height: 800, pixelRatio: 1,
    camera: { x: 0, y: 0, k: 1 }, overviewZoom: 1,
    nodes: [], links: [],
    circles: [0, 1, 2, 3].map((depth) => ({ key: `domain-${depth}`, label: `Domain ${depth}`, depth, isBranch: true, x: 100 + depth * 150, y: 300, r: 30, index: 0 })),
    display: DEFAULT_GRAPH_SETTINGS.display,
    palette: { background: "#111", border: "#333", text: "#fff", muted: "#aaa", faint: "#666", fontFamily: "sans-serif", token: () => "#aaf" },
    colorOf: () => null, focusId: null, focusIds: new Set(), hoverLabelOnly: false,
  };
  drawGraph(input);
  expect(paint.map((entry) => entry.color)).toEqual(["#aaf", "#111", "#aaf", "#111", "#aaf", "#111", "#aaf"]);
  expect(paint.filter((entry) => entry.color === "#111").map((entry) => entry.alpha)).toEqual([1, 1, 1]);
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
  let curves = 0, lines = 0;
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(target, key) {
      if (key === "globalAlpha") return target.globalAlpha;
      if (key === "beginPath") return () => { curves = 0; lines = 0; };
      if (key === "quadraticCurveTo") return () => { curves++; };
      if (key === "lineTo") return () => { lines++; };
      if (key === "stroke") return () => { if (curves || lines) strokes.push({ alpha: target.globalAlpha, curves, lines }); };
      if (key === "measureText") return () => ({ width: 20 });
      return () => {};
    },
  }) as unknown as CanvasRenderingContext2D;
  const node = (id: string, x: number, domain: string) => ({ id, kind: "unit" as const, label: id, text: id, href: "", createdAt: "", degree: 1, domainPaths: [domain], entityNames: [], unitKind: null, status: null, x, y: 0 });
  const [a, b, c] = [node("a", 0, "Left"), node("b", 400, "Right"), node("c", 10, "Left")];
  const input = (k: number): DrawInput => ({
    ctx, width: 800, height: 800, pixelRatio: 1, camera: { x: 0, y: 0, k }, overviewZoom: 1,
    nodes: [a, b, c],
    links: [{ id: "stored", source: a, target: b, kind: "supports" }, { id: "similar", source: a, target: c, kind: "similar" }, { id: "across", source: c, target: b, kind: "similar" }],
    circles: [{ key: "Left", label: "Left", depth: 0, isBranch: false, x: 0, y: 100, r: 50, index: 0 }, { key: "Right", label: "Right", depth: 0, isBranch: false, x: 400, y: 100, r: 50, index: 1 }],
    display: DEFAULT_GRAPH_SETTINGS.display,
    palette: { background: "#111", border: "#333", text: "#fff", muted: "#aaa", faint: "#666", fontFamily: "sans-serif", token: () => "#aaf" },
    colorOf: () => null, focusId: null, focusIds: new Set(), hoverLabelOnly: false,
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

it("puts the start of a bubble title at the top of the bubble", () => {
  const { ctx, painted } = recordingContext(() => 48);
  const node = dot("hub", 40, 200, 200, "Instinctive Triad grouping");
  drawGraph({
    ctx, width: 800, height: 800, pixelRatio: 1, camera: { x: 0, y: 0, k: 3 }, overviewZoom: null,
    nodes: [node], links: [], circles: [], display: DEFAULT_GRAPH_SETTINGS.display, palette,
    colorOf: () => "applied", focusId: null, focusIds: new Set(), hoverLabelOnly: false,
  });
  const title = painted.find((item) => item.text.startsWith("Instinctive"));
  expect(title?.text).toBe("Instinctive Triad grouping");
  const centerY = 200 * 3;
  expect(title!.y).toBeLessThan(centerY - nodeRadius(node, 1) * 3 * 0.5);
});

it("keeps the first words when a title is too tall for its bubble", () => {
  const { ctx, painted } = recordingContext((text) => text.length * 6);
  const label = "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike";
  drawGraph({
    ctx, width: 800, height: 800, pixelRatio: 1, camera: { x: 0, y: 0, k: 2 }, overviewZoom: null,
    nodes: [dot("note", 15, 200, 200, label)], links: [], circles: [],
    display: DEFAULT_GRAPH_SETTINGS.display, palette,
    colorOf: () => null, focusId: null, focusIds: new Set(), hoverLabelOnly: false,
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
    ctx, width: 800, height: 800, pixelRatio: 1, camera: { x: 0, y: 0, k: 2 }, overviewZoom: null,
    nodes: [small, large], links: [], circles: [], display: DEFAULT_GRAPH_SETTINGS.display, palette,
    colorOf: () => null, focusId: null, focusIds: new Set(), hoverLabelOnly: false,
  });
  const texts = painted.map((item) => item.text);
  expect(texts).toContain("Large title");
  expect(texts).not.toContain("Small title");
});
