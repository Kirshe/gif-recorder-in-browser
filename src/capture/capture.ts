import { FrameGrabber } from "./frame-grabber.js";
import { GifEncoderPool } from "../encoding/gif-encoder-pool.js";
import type { Region, CapturedFrame } from "../shared/types.js";
import { DEFAULT_FPS, MAX_RECORDING_SECONDS } from "../shared/constants.js";

let grabber: FrameGrabber | null = null;
let encoderPool: GifEncoderPool | null = null;
let autoStopTimer: number | null = null;
let isStopping = false;

export interface CaptureCallbacks {
  // Fired once the user has picked a surface, before any frame is grabbed. The
  // player uses this to show the recording view and minimize itself out of the
  // capture — done here (not before getDisplayMedia) so that cancelling the
  // share picker leaves the player on screen instead of stranded + minimized.
  // Awaited so frame grabbing only begins after the window is fully minimized,
  // keeping the minimize animation out of the recording.
  onStart: () => void | Promise<void>;
  // Fired the moment a stop is triggered (manual, auto-stop, the keyboard
  // shortcut, or the browser's native "Stop sharing"), before encoding begins.
  // Lets the player restore itself on screen and switch to the encoding view.
  onStopBegin: () => void;
  onProgress: (p: number) => void;
  // The encoded GIF: a data URL for the <img> preview, plus the raw Blob so the
  // player can share/download the real animated file (size is blob.size).
  onComplete: (dataUrl: string, blob: Blob) => void;
  onError: (msg: string) => void;
}

export async function startCapture(
  region: Region | undefined,
  callbacks: CaptureCallbacks
): Promise<void> {
  try {
    // No preferCurrentTab: the player is its own window, so the user chooses the
    // screen, window, or tab to record from the native picker. displaySurface
    // "monitor" is an ideal hint that opens the picker defaulted to the whole
    // screen (Chrome honors it; Firefox best-effort) — the user can still pick a
    // window or tab. The browser always requires a click to share; the surface
    // can't be auto-selected from extension code.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor" },
      audio: false,
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

    // The player minimizes itself out of the capture while recording, so the
    // in-window Stop button isn't reachable. The browser's own "Stop sharing"
    // control (and the stop-recording keyboard shortcut) end the recording
    // instead — finish up when the track ends.
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => stopCapture(callbacks));
    });

    // Surface + minimize the player now that the stream is live, and wait for
    // the minimize to settle before grabbing the first frame.
    await callbacks.onStart();

    await grabber.start();

    autoStopTimer = window.setTimeout(() => {
      stopCapture(callbacks);
    }, MAX_RECORDING_SECONDS * 1000);
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "Capture failed");
  }
}

export async function stopCapture(callbacks: CaptureCallbacks): Promise<void> {
  const { onStopBegin, onProgress, onComplete, onError } = callbacks;

  // Guard against the manual stop, the auto-stop timer, the keyboard shortcut,
  // and the native "Stop sharing" track-ended event all racing to fire.
  if (isStopping) return;
  isStopping = true;

  // Bring the player back on screen and switch it to the encoding view.
  onStopBegin();

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
      onComplete(dataUrl, blob);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Encoding failed");
    }
    encoderPool = null;
  } else {
    // Stop arrived with no capture in flight — capture never started.
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
