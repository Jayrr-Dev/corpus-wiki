import type { ReactNode } from "react";

// THE FRAME every scene is drawn in, in CSS pixels
export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;

// A SCENE: a pure function of t (seconds, 0..duration) plus its length
export type Scene = { duration: number; Component: (props: { t: number }) => ReactNode; title?: string };
