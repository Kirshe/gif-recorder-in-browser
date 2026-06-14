export interface Region {
  // Geometry in CSS pixels, relative to the captured tab's viewport.
  x: number;
  y: number;
  w: number;
  h: number;
  // Viewport size (CSS pixels) at selection time, used to map CSS coords onto
  // the captured video's device-pixel resolution without double-counting DPR.
  viewportW?: number;
  viewportH?: number;
}

// The player's view, also used as a coarse recording state.
export type RecordingState = "idle" | "recording" | "encoding" | "preview";

export interface CapturedFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  index: number;
}

export interface EncodedFrame {
  chunk: Uint8Array;
  index: number;
}
