import { useEffect } from "react";

export function useScrollDepth() {
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const elements = [...document.querySelectorAll<HTMLElement>(".workflow, .features-section, .real-section, .install-section, .closing")];
    let frame = 0;
    const draw = () => {
      frame = 0;
      for (const element of elements) {
        const box = element.getBoundingClientRect();
        const depth = media.matches ? 0 : Math.max(-1, Math.min(1, (box.top + box.height / 2 - innerHeight / 2) / innerHeight));
        element.style.setProperty("--depth", String(depth));
        element.classList.add("scroll-depth");
      }
    };
    const update = () => { if (!frame) frame = requestAnimationFrame(draw); };
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    media.addEventListener("change", update);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
      media.removeEventListener("change", update);
      elements.forEach(el => { el.classList.remove("scroll-depth"); el.style.removeProperty("--depth"); });
    };
  }, []);
}
