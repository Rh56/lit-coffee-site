import { initScene } from "./scene.js";
import { initReveal } from "./reveal.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- hero 3D scene + ignition-timed word reveal ------------------------ */
const canvas = document.getElementById("scene");
if (canvas && "IntersectionObserver" in window) {
  initScene(canvas);
}

const heroLines = document.querySelectorAll(
  ".hero-eyebrow, .hero-sub, .hero-by"
);

let heroIntroPlayed = false;
function playHeroIntro() {
  if (heroIntroPlayed) return;
  heroIntroPlayed = true;
  heroLines.forEach((el, i) => {
    setTimeout(() => el.classList.add("is-visible"), i * 140);
  });
  const cue = document.getElementById("scrollCue");
  if (cue) setTimeout(() => (cue.style.opacity = "1"), 1000);
}

if (reduceMotion) {
  playHeroIntro();
} else {
  canvas?.addEventListener("scene:ignite", playHeroIntro, { once: true });
  // safety net in case WebGL init silently fails
  setTimeout(playHeroIntro, 1800);
}

/* ---- scroll cue ---------------------------------------------------------- */
document.getElementById("scrollCue")?.addEventListener("click", () => {
  document.getElementById("story")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
});

/* ---- generic scroll reveal (hero handled separately by ignition sequence) - */
initReveal({ exclude: ".hero" });
