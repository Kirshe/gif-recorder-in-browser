import { FRAME_INTERVAL, MAX_WIDTH } from "../shared/constants.js";
import type { Region, CapturedFrame } from "../shared/types.js";

export class FrameGrabber {
  private video: HTMLVideoElement;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private intervalId: number | null = null;
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

    this.intervalId = window.setInterval(() => {
      this.captureFrame();
    }, FRAME_INTERVAL);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.video.pause();
    const stream = this.video.srcObject as MediaStream;
    stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }

  private captureFrame(): void {
    if (this.video.readyState < 2) return;

    if (this.region) {
      const track = (this.video.srcObject as MediaStream).getVideoTracks()[0];
      const settings = track.getSettings();
      const videoW = settings.width ?? this.video.videoWidth;
      const videoH = settings.height ?? this.video.videoHeight;
      const scaleX = this.video.videoWidth / videoW;
      const scaleY = this.video.videoHeight / videoH;

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
