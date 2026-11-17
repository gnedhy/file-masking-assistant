// Builds each <figure class="shot"> from a full-page screenshot.
// data-src: file in 截图/; data-crop: "x,y,w,h"; data-marks: "label@x,y,w,h;..." (label may be empty, "r:" puts it on the right).
// All coordinates are CSS px of the 1440-wide capture (the PNGs are 2x).
window.guideReady = Promise.all([...document.querySelectorAll(".shot")].map(fig => {
  const [x, y, w, h] = fig.dataset.crop.split(",").map(Number);
  const scale = fig.clientWidth / w;
  fig.style.height = `${h * scale}px`;
  const img = new Image();
  img.src = `截图/${fig.dataset.src}.png`;
  Object.assign(img.style, { width: `${1440 * scale}px`, left: `${-x * scale}px`, top: `${-y * scale}px` });
  fig.append(img);
  for (const spec of (fig.dataset.marks || "").split(";").filter(Boolean)) {
    const [rawLabel, rect] = spec.split("@");
    const [mx, my, mw, mh] = rect.split(",").map(Number);
    const pad = 6;
    const mark = document.createElement("div");
    mark.className = "mark" + (rawLabel.startsWith("r:") ? " right" : "");
    Object.assign(mark.style, { left: `${(mx - x) * scale - pad}px`, top: `${(my - y) * scale - pad}px`, width: `${mw * scale + pad * 2}px`, height: `${mh * scale + pad * 2}px` });
    const label = rawLabel.replace(/^r:/, "");
    if (label) { const i = document.createElement("i"); i.textContent = label; mark.append(i); }
    fig.append(mark);
  }
  return img.decode();
}));
