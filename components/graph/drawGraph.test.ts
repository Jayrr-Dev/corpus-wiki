import { expect, it } from "vitest";
import { DEFAULT_GRAPH_SETTINGS } from "@/lib/graph/settings";
import { drawGraph, type DrawInput } from "./drawGraph";

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
    colorOf:()=>null,hoveredId:null,focusIds:new Set(),hoverLabelOnly:false,
  });
  expect(labels).toHaveLength(1);
  expect(labels[0]!.font).toBe("600 14px sans-serif");
  expect(labels[0]!.transform).toEqual([2,0,0,2,0,0]);
  expect(labels[0]!.x).toBe(400);
  expect(labels[0]!.y).toBeCloseTo(297);
});

it("paints nested domain circles progressively fainter without fading their names", () => {
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
    colorOf: () => null, hoveredId: null, focusIds: new Set(), hoverLabelOnly: false,
  };
  drawGraph(input);
  expect(paint.map((entry) => entry.color)).toEqual(["#aaf", "#111", "#aaf", "#111", "#aaf", "#111", "#aaf"]);
  expect(paint.filter((entry) => entry.color === "#111").map((entry) => entry.alpha)).toEqual([1, 1, 1]);
  expect(fills[0]).toBe(0.16);
  expect(fills[1]).toBeCloseTo(0.0288);
  expect(fills[2]).toBeLessThan(0.006);
  expect(fills[3]).toBeLessThan(0.001);
  expect(outlines.slice(0, 4)).toEqual([0.8, 0.8, 0.8, 0.8]);
  expect(labels).toEqual([1, 1, 1, 1]);
});
