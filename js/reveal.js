/* Shared scroll-reveal: adds .is-visible to [data-reveal] elements once in view. */
export function initReveal({ root = document, exclude = null } = {}) {
  let els = Array.from(root.querySelectorAll("[data-reveal]"));
  if (exclude) els = els.filter((el) => !el.closest(exclude));

  els.forEach((el) => {
    if (el.classList.contains("bean-card")) {
      const i = Array.from(el.parentElement.children).indexOf(el);
      el.style.setProperty("--i", i % 12);
    }
  });

  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16, rootMargin: "0px 0px -6% 0px" }
  );
  els.forEach((el) => io.observe(el));
}
