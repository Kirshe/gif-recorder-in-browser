export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RecordingState = "idle" | "selecting-region" | "recording" | "encoding" | "preview";

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
