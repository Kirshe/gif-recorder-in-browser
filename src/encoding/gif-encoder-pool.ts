import { GIFEncoder } from "gifenc";
import { WORKER_COUNT } from "../shared/constants.js";
import type { CapturedFrame } from "../shared/types.js";
import type { WorkerOutput } from "./gif-worker.js";

interface PendingFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  index: number;
}

interface EncodedResult {
  indexedPixels: Uint8Array;
  palette: number[][];
}

export class GifEncoderPool {
  private frames: PendingFrame[] = [];
  private _dimensions = { width: 0, height: 0 };

  addFrame(frame: CapturedFrame): void {
    this._dimensions = { width: frame.width, height: frame.height };
    this.frames.push({
      data: frame.data,
      width: frame.width,
      height: frame.height,
      index: frame.index,
    });
  }

  get dimensions() {
    return this._dimensions;
  }

  async encode(
    width: number,
    height: number,
    fps: number,
    onProgress?: (p: number) => void
  ): Promise<Blob> {
    const totalFrames = this.frames.length;
    if (totalFrames === 0) {
      throw new Error("No frames to encode");
    }

    const encoded = new Array<EncodedResult | null>(totalFrames).fill(null);
    let completedCount = 0;

    const workers: Worker[] = [];
    for (let i = 0; i < Math.min(WORKER_COUNT, totalFrames); i++) {
      const worker = new Worker(
        new URL("./gif-worker.ts", import.meta.url),
        { type: "module" }
      );
      workers.push(worker);
    }

    await new Promise<void>((resolve, reject) => {
      let nextFrameToSend = 0;

      const sendNext = (worker: Worker) => {
        if (nextFrameToSend >= totalFrames) return;
        const frame = this.frames[nextFrameToSend];
        const transferable = frame.data.buffer.slice(0);
        worker.postMessage(
          {
            type: "ENCODE_FRAME",
            rgba: new Uint8ClampedArray(transferable),
            width: frame.width,
            height: frame.height,
            index: frame.index,
          },
          [transferable]
        );
        nextFrameToSend++;
      };

      for (const worker of workers) {
        worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
          const { index, indexedPixels, palette } = e.data;
          encoded[index] = { indexedPixels, palette };
          completedCount++;
          onProgress?.(completedCount / totalFrames);

          if (completedCount === totalFrames) {
            workers.forEach((w) => w.terminate());
            resolve();
          } else {
            sendNext(worker);
          }
        };

        worker.onerror = (err) => {
          workers.forEach((w) => w.terminate());
          reject(new Error(err.message));
        };

        sendNext(worker);
      }
    });

    // Assemble final GIF
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);

    for (let i = 0; i < totalFrames; i++) {
      const frame = encoded[i]!;
      gif.writeFrame(frame.indexedPixels, width, height, {
        palette: frame.palette,
        delay,
      });
    }

    gif.finish();
    const bytes = gif.bytes();
    return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
  }
}
