import { expect, it, vi } from "vitest";
vi.mock("react",()=>({useRef:(current:unknown)=>({current}),useLayoutEffect:(fn:()=>void)=>fn(),useEffect:(fn:()=>void)=>fn()}));
import { usePointerControls } from "./usePointerControls";
import type { SimNode } from "@/lib/graph/physics";
import { toWorld } from "@/lib/graph/camera";

function setup(){
 const listeners=new Map<string,(e:unknown)=>void>();
 const element={getBoundingClientRect:()=>({left:10,top:20}),setPointerCapture:vi.fn(),addEventListener:(name:string,fn:(e:unknown)=>void)=>listeners.set(name,fn),removeEventListener:vi.fn(),style:{}};
 const nodes=[{id:"a",x:10,y:20,degree:1},{id:"b",x:40,y:50,degree:1}] as SimNode[];
 const simulation={stop:vi.fn(),alpha:vi.fn(()=>0.01),alphaTarget:vi.fn(),restart:vi.fn()};
 const onOpen=vi.fn(),onSelect=vi.fn(),onContextNode=vi.fn(),onSelectionBox=vi.fn();
 const camera={current:{x:100,y:50,k:2}};
 const motion={cancel:vi.fn(),animateTo:vi.fn(),target:{current:{x:500,y:400,k:8}}};
 // Hooks are mocked above to wire real pointer handlers onto a test canvas.
 // eslint-disable-next-line react-hooks/rules-of-hooks
 usePointerControls({canvas:{current:element as unknown as HTMLCanvasElement},layout:{current:{nodes,links:[],simulation:simulation as never,revision:0}},camera,hoveredId:{current:null},isAutoFit:{current:false},nodeSize:1,onOpen,onSelect,onContextNode,onSelectionBox,motion,redraw:vi.fn()});
 const send=(type:string,x:number,y:number,extra={})=>listeners.get(type)!({clientX:x,clientY:y,button:0,pointerId:1,pointerType:"mouse",preventDefault:vi.fn(),...extra});
 return {send,onOpen,onSelect,onContextNode,onSelectionBox,nodes,simulation,camera,motion};
}
it("wheel streams zoom the visible camera immediately and keep each cursor position anchored",()=>{
 const t=setup();
 for(const [x,y] of [[300,200],[450,280],[200,150]]) {
  const point={x:x!-10,y:y!-20};
  const before=toWorld(t.camera.current,point);
  const scale=t.camera.current.k;
  t.send("wheel",x!,y!,{deltaY:-40,deltaMode:0});
  expect(t.camera.current.k).toBeGreaterThan(scale);
  expect(toWorld(t.camera.current,point).x).toBeCloseTo(before.x);
  expect(toWorld(t.camera.current,point).y).toBeCloseTo(before.y);
 }
 expect(t.motion.cancel).toHaveBeenCalledTimes(3);
 expect(t.motion.animateTo).not.toHaveBeenCalled();
});
it("wheel input cannot change the camera underneath an active node drag",()=>{
 const t=setup();t.send("pointerdown",130,110);
 const before={...t.camera.current};
 t.send("wheel",130,110,{deltaY:-160,deltaMode:0});
 expect(t.camera.current).toEqual(before);
 t.send("pointermove",150,130);
 expect(t.nodes[0]).toMatchObject({x:20,y:30});
});
it("right click opens the context menu without opening or dragging a node",()=>{
 const t=setup();t.send("pointerdown",130,110,{button:2});t.send("pointerup",130,110,{button:2});t.send("contextmenu",130,110);
 expect(t.onOpen).not.toHaveBeenCalled();expect(t.onContextNode.mock.calls[0]?.[0].id).toBe("a");
});
it("Ctrl drag selects a box in either direction after camera transforms without opening nodes",()=>{
 const t=setup();t.send("pointerdown",200,180,{ctrlKey:true});t.send("pointermove",120,100,{ctrlKey:true});t.send("pointerup",120,100,{ctrlKey:true});
 expect(t.onSelect.mock.calls[0]?.[0].map((n:SimNode)=>n.id)).toEqual(["a","b"]);expect(t.onSelect.mock.calls[0]?.[1]).toBe(false);expect(t.onOpen).not.toHaveBeenCalled();expect(t.onSelectionBox).toHaveBeenLastCalledWith(null);
});
it("Ctrl click toggles just the node and canceled boxes never select",()=>{
 const t=setup();t.send("pointerdown",130,110,{ctrlKey:true});t.send("pointerup",130,110,{ctrlKey:true});
 expect(t.onSelect.mock.calls[0]?.[0].map((n:SimNode)=>n.id)).toEqual(["a"]);expect(t.onSelect.mock.calls[0]?.[1]).toBe(true);
 t.send("pointerdown",130,110,{ctrlKey:true});t.send("pointercancel",200,180);expect(t.onSelect).toHaveBeenCalledTimes(1);expect(t.onOpen).not.toHaveBeenCalled();
});

it("holding a node pauses settling; dragging moves only that node without reheating the graph",()=>{
 const t=setup();
 t.send("pointerdown",130,110);
 expect(t.simulation.stop).toHaveBeenCalledOnce();
 t.send("pointermove",132,111);
 expect(t.nodes[0]).toMatchObject({x:10,y:20,fx:10,fy:20});
 t.send("pointermove",150,130);
 expect(t.nodes[0]).toMatchObject({x:20,y:30,fx:20,fy:30});
 expect(t.nodes[1]).toMatchObject({x:40,y:50});
 expect(t.simulation.restart).not.toHaveBeenCalled();
 t.send("pointerup",150,130);
 expect(t.nodes[0]).toMatchObject({x:20,y:30,fx:null,fy:null});
 expect(t.simulation.restart).toHaveBeenCalledOnce();
 expect(t.onOpen).not.toHaveBeenCalled();
});
