import { initReveal } from "./reveal.js";

initReveal();

/* ---- coffee pour, scrubbed by scroll position through a pinned section - */
const section = document.getElementById("pour");
const kettle = document.getElementById("kettle");
const stream = document.getElementById("stream");
const cupFill = document.getElementById("cupFill");
const steam = document.getElementById("steam");
const caption = document.getElementById("pourCaption");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const CUP_TOP = 262;
const CUP_BOTTOM = 368;
const CUP_MAX_FILL = CUP_BOTTOM - CUP_TOP;

function clamp(v, min = 0, max = 1) {
  return Math.min(max, Math.max(min, v));
}

// piecewise-linear interpolation across named keyframes
function keyframe(t, stops) {
  if (t <= stops[0][0]) return stops[0][1];
  if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, v0] = stops[i];
    const [t1, v1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const local = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * local;
    }
  }
  return stops[stops.length - 1][1];
}

const KETTLE_ANGLE = [
  [0, -6],
  [0.14, -40],
  [0.82, -40],
  [1, -6],
];
const STREAM_DASH = [
  [0, 1],
  [0.16, 0],
  [0.84, 0],
  [0.98, 1],
];
const FILL_LEVEL = [
  [0.18, 0],
  [0.86, 1],
];
const STEAM_OPACITY = [
  [0.78, 0],
  [0.95, 1],
];
const CAPTION_OPACITY = [
  [0.75, 0],
  [0.92, 1],
];

function render(p) {
  const angle = keyframe(p, KETTLE_ANGLE);
  kettle.setAttribute("transform", `rotate(${angle.toFixed(2)} 166 150)`);

  stream.style.strokeDasharray = "1";
  stream.style.strokeDashoffset = String(keyframe(p, STREAM_DASH));

  const fill = clamp(keyframe(p, FILL_LEVEL));
  const h = fill * CUP_MAX_FILL;
  cupFill.setAttribute("height", String(h));
  cupFill.setAttribute("y", String(CUP_BOTTOM - h));

  steam.style.opacity = String(clamp(keyframe(p, STEAM_OPACITY)));
  caption.style.opacity = String(clamp(keyframe(p, CAPTION_OPACITY)));
}

function progress() {
  const rect = section.getBoundingClientRect();
  const total = rect.height - window.innerHeight;
  if (total <= 0) return 1;
  return clamp(-rect.top / total);
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    render(progress());
    ticking = false;
  });
}

if (reduceMotion) {
  render(1);
} else {
  render(progress());
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
}
