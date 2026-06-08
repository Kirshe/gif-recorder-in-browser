import { FrameGrabber } from "./frame-grabber.js";
import { GifEncoderPool } from "../encoding/gif-encoder-pool.js";
import type { Region, CapturedFrame } from "../shared/types.js";
import { DEFAULT_FPS, MAX_RECORDING_SECONDS } from "../shared/constants.js";

let grabber: FrameGrabber | null = null;
let encoderPool: GifEncoderPool | null = null;
let autoStopTimer: number | null = null;
let isStopping = false;

export async function startChromeCapture(
  streamId: string,
  region: Region | undefined,
  onProgress: (p: number) => void,
  onComplete: (dataUrl: string, size: number) => void,
  onError: (msg: string) => void
): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // @ts-expect-error Chrome-specific mandatory constraints
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    isStopping = false;
    encoderPool = new GifEncoderPool();

    grabber = new FrameGrabber(
      stream,
      (frame: CapturedFrame) => {
        encoderPool!.addFrame(frame);
      },
      region
    );

    await grabber.start();

    autoStopTimer = window.setTimeout(() => {
      stopChromeCapture(onProgress, onComplete, onError);
    }, MAX_RECORDING_SECONDS * 1000);
  } catch (err) {
    onError(err instanceof Error ? err.message : "Capture failed");
  }
}

export async function stopChromeCapture(
  onProgress: (p: number) => void,
  onComplete: (dataUrl: string, size: number) => void,
  onError: (msg: string) => void
): Promise<void> {
  // Guard against the manual stop and the auto-stop timer both firing.
  if (isStopping) return;
  isStopping = true;

  if (autoStopTimer !== null) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }

  if (grabber) {
    grabber.stop();
    grabber = null;
  }

  if (encoderPool) {
    // Switch the UI to the encoding view immediately (covers auto-stop too).
    onProgress(0);
    try {
      const { width, height } = encoderPool.dimensions;
      const blob = await encoderPool.encode(width, height, DEFAULT_FPS, onProgress);
      const dataUrl = await blobToDataUrl(blob);
      onComplete(dataUrl, blob.size);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Encoding failed");
    }
    encoderPool = null;
  } else {
    // Stop arrived with no capture in flight — capture never started. Surface an
    // error instead of leaving the popup stuck forever on the encoding view.
    onError("Recording didn't start — please try again");
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
