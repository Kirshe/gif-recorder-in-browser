(() => {
  // Prevent double injection
  if (document.getElementById("gif-recorder-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "gif-recorder-overlay";

  const shadow = overlay.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.3);
      cursor: crosshair;
    }
    .selection {
      position: fixed;
      border: 2px dashed #fff;
      background: rgba(255, 255, 255, 0.1);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
      z-index: 2147483647;
      pointer-events: none;
    }
    .instructions {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      font: 14px/1.4 system-ui, sans-serif;
      padding: 8px 16px;
      border-radius: 8px;
      pointer-events: none;
    }
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const instructions = document.createElement("div");
  instructions.className = "instructions";
  instructions.textContent = "Click and drag to select a region. Press Escape to cancel.";

  const selection = document.createElement("div");
  selection.className = "selection";
  selection.style.display = "none";

  shadow.appendChild(style);
  shadow.appendChild(backdrop);
  shadow.appendChild(instructions);
  shadow.appendChild(selection);

  document.documentElement.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let isDragging = false;

  function cleanup() {
    overlay.remove();
  }

  backdrop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    isDragging = true;
    selection.style.display = "block";
    selection.style.left = `${startX}px`;
    selection.style.top = `${startY}px`;
    selection.style.width = "0px";
    selection.style.height = "0px";
  });

  backdrop.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    e.preventDefault();

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    selection.style.left = `${x}px`;
    selection.style.top = `${y}px`;
    selection.style.width = `${w}px`;
    selection.style.height = `${h}px`;
  });

  backdrop.addEventListener("mouseup", (e) => {
    if (!isDragging) return;
    isDragging = false;

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    cleanup();

    if (w < 10 || h < 10) {
      chrome.runtime.sendMessage({ type: "REGION_CANCELLED" });
      return;
    }

    // Send CSS-pixel geometry plus the current viewport size; the grabber maps
    // these onto the captured video's device-pixel resolution.
    chrome.runtime.sendMessage({
      type: "REGION_SELECTED",
      region: {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      },
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ type: "REGION_CANCELLED" });
    }
  });
})();
