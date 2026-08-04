import { initScene } from "./scene.js";
import { initReveal } from "./reveal.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- hero 3D scene + ignition-timed word reveal ------------------------ */
const canvas = document.getElementById("scene");
if (canvas && "IntersectionObserver" in window) {
  initScene(canvas);
}

const heroChars = document.querySelectorAll(".hero-word span");
const heroLines = document.querySelectorAll(
  ".hero-eyebrow, .hero-sub, .hero-by"
);

function playHeroIntro() {
  heroChars.forEach((el, i) => {
    setTimeout(() => {
      el.style.transition = "opacity 0.9s cubic-bezier(.16,.8,.24,1), transform 0.9s cubic-bezier(.16,.8,.24,1), filter 0.9s ease";
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
      el.style.filter = "blur(0)";
    }, i * 90);
  });
  heroLines.forEach((el, i) => {
    setTimeout(() => el.classList.add("is-visible"), 280 + i * 140);
  });
  const cue = document.getElementById("scrollCue");
  if (cue) setTimeout(() => (cue.style.opacity = "1"), 1200);
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
