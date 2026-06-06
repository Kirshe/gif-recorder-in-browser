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

export type RecordingState = "idle" | "selecting-region" | "recording" | "encoding" | "preview";

// Snapshot of the background's recording state, returned to the popup on open
// so it can re-render correctly even if it was closed mid-recording.
export interface SessionSnapshot {
  state: RecordingState;
  recordingStartTime?: number;
  progress?: number;
  gifDataUrl?: string;
  size?: number;
  error?: string;
}

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
