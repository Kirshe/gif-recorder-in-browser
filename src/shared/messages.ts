import type { Region } from "./types.js";

// Player → Background: capture started — show the REC badge and minimize the
// player window out of a full-screen capture.
export type StartRecording = {
  type: "START_RECORDING";
};

// Player → Background: recording stopped — clear the badge and restore the
// player window so the user sees the encoding progress and the finished GIF.
export type StopRecording = {
  type: "STOP_RECORDING";
};

// Player → Background: inject the region-selection overlay into the user's
// active page.
export type ShowRegionSelector = {
  type: "SHOW_REGION_SELECTOR";
};

// Content script → Background → Player: the user finished drawing a region.
export type RegionSelected = {
  type: "REGION_SELECTED";
  region: Region;
};

// Content script → Background → Player: the user aborted region selection.
export type RegionCancelled = {
  type: "REGION_CANCELLED";
};

// Background → Player: the stop-recording keyboard command fired (the player is
// minimized, so its own Stop button isn't reachable).
export type StopRequested = {
  type: "STOP_REQUESTED";
};

export type Message =
  | StartRecording
  | StopRecording
  | ShowRegionSelector
  | RegionSelected
  | RegionCancelled
  | StopRequested;
