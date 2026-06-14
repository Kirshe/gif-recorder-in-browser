// A bare interval that lives in a worker so it keeps firing at full rate even
// when the recording window is minimized. Browsers throttle setInterval on a
// hidden/minimized document to ~1fps; a worker's timer is exempt, so the Firefox
// popout can hide itself out of the screen capture without dropping frames.

let intervalId: number | null = null;

self.onmessage = (e: MessageEvent<{ type: "start" | "stop"; interval?: number }>) => {
  if (e.data.type === "start") {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = setInterval(() => {
      (self as unknown as Worker).postMessage("tick");
    }, e.data.interval ?? 100) as unknown as number;
  } else if (e.data.type === "stop") {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};
