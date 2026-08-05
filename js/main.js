const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- hero settles in on load --------------------------------------------- */
document.querySelectorAll(".hero [data-reveal]").forEach((el, i) => {
  setTimeout(() => el.classList.add("is-visible"), reduceMotion ? 0 : 90 + i * 130);
});

/* ---- if the logo file is missing, fall back to the wordmark --------------- */
const logo = document.getElementById("logo");
logo?.addEventListener("error", () => {
  const h1 = logo.closest(".hero-logo");
  if (h1) {
    h1.classList.add("hero-logo--text");
    h1.textContent = "lit";
  }
});

/* ---- scroll reveal for everything below the fold -------------------------- */
const revealEls = Array.from(document.querySelectorAll("[data-reveal]")).filter(
  (el) => !el.closest(".hero")
);

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -6% 0px" }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("is-visible"));
}

/* ---- scroll cue ----------------------------------------------------------- */
document.getElementById("scrollCue")?.addEventListener("click", () => {
  document.getElementById("story")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
});

/* ==========================================================================
   Opening hours — drives both the hero status line and the highlighted row
   in the hours table. Minutes from midnight, local to the shop.
   ========================================================================== */
const HOURS = {
  0: null,              // Sunday — closed
  1: [8 * 60, 14 * 60],
  2: [8 * 60, 17 * 60 + 30],
  3: [8 * 60, 17 * 60 + 30],
  4: [8 * 60, 17 * 60 + 30],
  5: [8 * 60, 17 * 60 + 30],
  6: [8 * 60, 14 * 60],
};
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function shopNow() {
  // the shop is in Bethlehem PA; read the clock there, not in the visitor's zone
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function formatTime(mins) {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
}

function describeStatus(now) {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = HOURS[day];

  if (today && mins >= today[0] && mins < today[1]) {
    return { open: true, text: `Open now · until ${formatTime(today[1])}` };
  }
  if (today && mins < today[0]) {
    return { open: false, text: `Closed · opens today at ${formatTime(today[0])}` };
  }
  for (let step = 1; step <= 7; step++) {
    const d = (day + step) % 7;
    if (HOURS[d]) {
      const label = step === 1 ? "tomorrow" : DAY_NAMES[d];
      return { open: false, text: `Closed · opens ${label} at ${formatTime(HOURS[d][0])}` };
    }
  }
  return { open: false, text: "Closed" };
}

function paintStatus() {
  const now = shopNow();

  const statusEl = document.getElementById("status");
  const textEl = document.getElementById("statusText");
  if (statusEl && textEl) {
    const { open, text } = describeStatus(now);
    textEl.textContent = text;
    statusEl.classList.toggle("status--open", open);
  }

  const today = now.getDay();
  document.querySelectorAll("#hours [data-day]").forEach((row) => {
    row.classList.toggle("is-today", Number(row.dataset.day) === today);
  });
}

paintStatus();
setInterval(paintStatus, 60_000);
