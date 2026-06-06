import { GIFEncoder } from "gifenc";
import { WORKER_COUNT } from "../shared/constants.js";
import type { CapturedFrame } from "../shared/types.js";
import type { WorkerOutput } from "./gif-worker.js";

interface EncodedResult {
  indexedPixels: Uint8Array;
  palette: number[][];
}

/**
 * Quantizes frames in a pool of workers *as they are captured* rather than
 * buffering raw RGBA until the recording stops. This keeps memory bounded to a
 * handful of in-flight frames plus the (≈4× smaller) indexed results, instead
 * of holding hundreds of full-resolution RGBA frames at once.
 */
export class GifEncoderPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: CapturedFrame[] = [];
  private results: (EncodedResult | null)[] = [];
  private submitted = 0;
  private completed = 0;
  private _dimensions = { width: 0, height: 0 };

  private onProgress?: (p: number) => void;
  private totalAtFinish = 0;
  private finishing = false;
  private resolveDone?: () => void;
  private failure: Error | null = null;
  private rejectDone?: (err: Error) => void;

  constructor() {
    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(new URL("./gif-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent<WorkerOutput>) =>
        this.onWorkerDone(worker, e.data);
      worker.onerror = (err) => this.onWorkerError(err);
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  get dimensions() {
    return this._dimensions;
  }

  addFrame(frame: CapturedFrame): void {
    if (this.failure) return;
    this._dimensions = { width: frame.width, height: frame.height };
    this.results[frame.index] = null;
    this.submitted++;
    this.queue.push(frame);
    this.pump();
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const frame = this.queue.shift()!;
      // Transfer the frame's buffer — FrameGrabber allocates a fresh ImageData
      // per frame, so the original is never reused after this point.
      const buffer = frame.data.buffer;
      worker.postMessage(
        {
          type: "ENCODE_FRAME",
          rgba: frame.data,
          width: frame.width,
          height: frame.height,
          index: frame.index,
        },
        [buffer]
      );
    }
  }

  private onWorkerDone(worker: Worker, data: WorkerOutput): void {
    this.results[data.index] = {
      indexedPixels: data.indexedPixels,
      palette: data.palette,
    };
    this.completed++;
    this.idle.push(worker);
    this.pump();

    if (this.finishing) {
      this.onProgress?.(this.totalAtFinish ? this.completed / this.totalAtFinish : 1);
      if (this.completed === this.submitted) this.resolveDone?.();
    }
  }

  private onWorkerError(err: ErrorEvent): void {
    this.failure = new Error(err.message || "Encoder worker failed");
    this.terminate();
    this.rejectDone?.(this.failure);
  }

  private terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }

  /**
   * Wait for all submitted frames to finish quantizing, then assemble the GIF.
   */
  async encode(
    width: number,
    height: number,
    fps: number,
    onProgress?: (p: number) => void
  ): Promise<Blob> {
    if (this.failure) {
      this.terminate();
      throw this.failure;
    }
    if (this.submitted === 0) {
      this.terminate();
      throw new Error("No frames to encode");
    }

    this.onProgress = onProgress;
    this.totalAtFinish = this.submitted;
    this.finishing = true;
    onProgress?.(this.completed / this.totalAtFinish);

    await new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
      if (this.failure) reject(this.failure);
      else if (this.completed === this.submitted) resolve();
    });

    this.terminate();

    // Assemble final GIF (frames are written in capture order).
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);

    for (let i = 0; i < this.totalAtFinish; i++) {
      const frame = this.results[i];
      if (!frame) continue;
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
