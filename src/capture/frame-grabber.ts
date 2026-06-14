import { FRAME_INTERVAL, MAX_WIDTH } from "../shared/constants.js";
import type { Region, CapturedFrame } from "../shared/types.js";

export class FrameGrabber {
  private video: HTMLVideoElement;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private clock: Worker | null = null;
  private frameIndex = 0;
  private onFrame: (frame: CapturedFrame) => void;
  private region?: Region;
  private outWidth: number;
  private outHeight: number;

  constructor(
    stream: MediaStream,
    onFrame: (frame: CapturedFrame) => void,
    region?: Region
  ) {
    this.onFrame = onFrame;
    this.region = region;

    this.video = document.createElement("video");
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;

    // Calculate output dimensions
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    const srcW = region?.w ?? settings.width ?? 1920;
    const srcH = region?.h ?? settings.height ?? 1080;

    const scale = Math.min(1, MAX_WIDTH / srcW);
    this.outWidth = Math.round(srcW * scale);
    this.outHeight = Math.round(srcH * scale);

    this.canvas = new OffscreenCanvas(this.outWidth, this.outHeight);
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }

  async start(): Promise<void> {
    await this.video.play();

    // Drive frame capture from a worker timer. A plain setInterval here would be
    // throttled to ~1fps once the recording window is minimized out of the screen
    // capture; the worker's clock keeps ticking at full rate.
    this.clock = new Worker(new URL("./clock-worker.ts", import.meta.url), {
      type: "module",
    });
    this.clock.onmessage = () => this.captureFrame();
    this.clock.postMessage({ type: "start", interval: FRAME_INTERVAL });
  }

  stop(): void {
    if (this.clock !== null) {
      this.clock.postMessage({ type: "stop" });
      this.clock.terminate();
      this.clock = null;
    }
    this.video.pause();
    const stream = this.video.srcObject as MediaStream;
    stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }

  private captureFrame(): void {
    if (this.video.readyState < 2) return;

    if (this.region) {
      // The region was captured in CSS pixels against the page viewport. Map it
      // onto the captured video's device-pixel resolution using the viewport
      // size recorded at selection time — this avoids double-counting DPR.
      const viewportW = this.region.viewportW ?? this.video.videoWidth;
      const viewportH = this.region.viewportH ?? this.video.videoHeight;
      const scaleX = this.video.videoWidth / viewportW;
      const scaleY = this.video.videoHeight / viewportH;

      this.ctx.drawImage(
        this.video,
        this.region.x * scaleX,
        this.region.y * scaleY,
        this.region.w * scaleX,
        this.region.h * scaleY,
        0,
        0,
        this.outWidth,
        this.outHeight
      );
    } else {
      this.ctx.drawImage(this.video, 0, 0, this.outWidth, this.outHeight);
    }

    const imageData = this.ctx.getImageData(0, 0, this.outWidth, this.outHeight);

    this.onFrame({
      data: imageData.data,
      width: this.outWidth,
      height: this.outHeight,
      index: this.frameIndex++,
    });
  }

  get dimensions() {
    return { width: this.outWidth, height: this.outHeight };
  }
}
