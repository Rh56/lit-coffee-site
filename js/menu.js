import { initReveal } from "./reveal.js";

initReveal();

/* ---- roast progression: page darkens from green to dark roast on scroll - */
const STOPS = [
  { t: 0.0, rgb: [92, 107, 66], label: "green" },
  { t: 0.22, rgb: [150, 133, 62], label: "yellow" },
  { t: 0.42, rgb: [176, 116, 46], label: "first crack" },
  { t: 0.62, rgb: [138, 74, 38], label: "city roast" },
  { t: 0.82, rgb: [92, 47, 28], label: "full city" },
  { t: 1.0, rgb: [23, 17, 13], label: "dark" },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function colorAt(t) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return {
        rgb: a.rgb.map((v, idx) => Math.round(lerp(v, b.rgb[idx], localT))),
        label: localT < 0.5 ? a.label : b.label,
      };
    }
  }
  return { rgb: STOPS[STOPS.length - 1].rgb, label: STOPS[STOPS.length - 1].label };
}

const bg = document.getElementById("roastBg");
const marker = document.getElementById("roastMarker");
const label = document.getElementById("roastLabel");

function scrollFraction() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

let ticking = false;
function update() {
  ticking = false;
  const t = scrollFraction();
  const { rgb, label: stage } = colorAt(t);

  if (bg) bg.style.setProperty("--roast-color", `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`);
  if (marker) marker.style.top = `${t * 100}%`;
  if (label && label.textContent !== stage) label.textContent = stage;
}

function onScroll() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(update);
  }
}

update();
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);
