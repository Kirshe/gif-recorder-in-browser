import type { Region } from "./types.js";

// Popup → Background
export type StartRecording = {
  type: "START_RECORDING";
  region?: Region;
};

export type StopRecording = {
  type: "STOP_RECORDING";
};

export type ShowRegionSelector = {
  type: "SHOW_REGION_SELECTOR";
};

// Popup → Background: ask for the current recording state (popup re-open)
export type GetState = {
  type: "GET_STATE";
};

// Popup → Background: discard the current result and return to idle
export type ResetSession = {
  type: "RESET";
};

// Background → Popup
export type RecordingStarted = {
  type: "RECORDING_STARTED";
  streamId?: string; // Chrome only
  recordingStartTime?: number;
};

export type RecordingStopped = {
  type: "RECORDING_STOPPED";
};

export type EncodingProgress = {
  type: "ENCODING_PROGRESS";
  progress: number; // 0-1
};

export type GifReady = {
  type: "GIF_READY";
  dataUrl: string;
  size: number;
};

export type ErrorOccurred = {
  type: "ERROR";
  message: string;
};

// Content Script → Background
export type RegionSelected = {
  type: "REGION_SELECTED";
  region: Region;
};

export type RegionCancelled = {
  type: "REGION_CANCELLED";
};

// Background → Offscreen (Chrome only)
export type StartCapture = {
  type: "START_CAPTURE";
  streamId: string;
  region?: Region;
};

export type StopCapture = {
  type: "STOP_CAPTURE";
};

// Offscreen → Background (Chrome only)
export type CaptureGifReady = {
  type: "CAPTURE_GIF_READY";
  dataUrl: string;
  size: number;
};

export type CaptureEncodingProgress = {
  type: "CAPTURE_ENCODING_PROGRESS";
  progress: number;
};

export type Message =
  | StartRecording
  | StopRecording
  | ShowRegionSelector
  | GetState
  | ResetSession
  | RecordingStarted
  | RecordingStopped
  | EncodingProgress
  | GifReady
  | ErrorOccurred
  | RegionSelected
  | RegionCancelled
  | StartCapture
  | StopCapture
  | CaptureGifReady
  | CaptureEncodingProgress;
