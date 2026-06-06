import { quantize, applyPalette } from "gifenc";
import { MAX_COLORS } from "../shared/constants.js";

export interface WorkerInput {
  type: "ENCODE_FRAME";
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  index: number;
}

export interface WorkerOutput {
  type: "FRAME_ENCODED";
  index: number;
  indexedPixels: Uint8Array;
  palette: number[][];
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { rgba, width, height, index } = e.data;

  // Each frame gets its own local color table. This is simpler and
  // parallelizes cleanly across workers; the trade-off is slightly larger files
  // (and occasional inter-frame shift) versus a single shared global palette.
  const palette = quantize(rgba, MAX_COLORS);
  const indexedPixels = applyPalette(rgba, palette);

  const response: WorkerOutput = {
    type: "FRAME_ENCODED",
    index,
    indexedPixels,
    palette,
  };

  (self as unknown as Worker).postMessage(response, [indexedPixels.buffer]);
};
