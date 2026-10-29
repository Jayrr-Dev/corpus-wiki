import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SCENES } from "../scenes";
import { StageRunner } from "./StageRunner";

// =====================================================================
// VIDEO STAGE (development only): renders one launch-video scene from the
// app's real components in a fixed 1920x1080 frame. A normal visit loops
// it; ?t=2.5 freezes it; ?render hands frame-by-frame control to
// docs/launch-video/product-shots/render.mjs via window.SCENE. The proxy
// lets /stage through without sign-in only in development, and outside
// development every address here is a 404.
// =====================================================================

export const metadata: Metadata = { title: "Stage", robots: { index: false, follow: false } };

export default async function StagePage({ params, searchParams }: { params: Promise<{ scene: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const [{ scene }, query] = await Promise.all([params, searchParams]);
  if (!Object.hasOwn(SCENES, scene)) notFound();
  const rawT = typeof query.t === "string" ? Number(query.t) : NaN;
  const still = Number.isFinite(rawT) ? rawT : null;
  const mode = query.render !== undefined ? "render" : still !== null ? "still" : "loop";
  return <StageRunner id={scene} mode={mode} still={still} />;
}
