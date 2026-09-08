import { useEffect, useRef } from "react";
import { ArrowDown, Scissors, Subtitles, Sparkles } from "lucide-react";

export function MotionStory() {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const draw = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const progress = reduced.matches ? 1 : Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height - innerHeight)));
      const cut = Math.max(0, Math.min(1, (progress - .12) / .42));
      const caption = Math.max(0, Math.min(1, (progress - .55) / .3));
      element.style.setProperty("--journey", String(progress));
      element.style.setProperty("--cut", String(cut));
      element.style.setProperty("--caption", String(caption));
      element.dataset.phase = progress < .32 ? "0" : progress < .68 ? "1" : "2";
    };
    const update = () => { if (!frame) frame = requestAnimationFrame(draw); };
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    reduced.addEventListener("change", update);
    draw();
    return () => { cancelAnimationFrame(frame); removeEventListener("scroll", update); removeEventListener("resize", update); reduced.removeEventListener("change", update); };
  }, []);
  return (
    <section ref={root} className="motion-story" aria-label="From recording to story">
      <div className="motion-stage">
        <div className="motion-heading">
          <span className="eyebrow">A LITTLE SPACE. A BIG DIFFERENCE.</span>
          <h2>Your story.<br /><em>Coming together.</em></h2>
          <p>Scroll to bring the edit to life. <ArrowDown size={14} /></p>
        </div>
        <div className="motion-world" aria-hidden="true">
          <div className="clay-orb clay-lime" /><div className="clay-orb clay-berry" />
          <div className="story-card">
            <div className="story-card-top"><span className="live-dot" /> YOUR NEXT GREAT STORY <Sparkles size={18} /></div>
            <div className="story-wave">
              {[0,1,2].map(i => <div className="story-fragment" key={i}>
                {Array.from({length:18},(_,n)=><i key={n} style={{height: `${18 + Math.abs(Math.sin(n*2.1+i))*62}%`}} />)}
              </div>)}
              <div className="story-gap gap-one"><Scissors size={20} /></div>
              <div className="story-gap gap-two"><Scissors size={20} /></div>
            </div>
            <div className="story-caption">Your story. <mark>Without the pauses.</mark></div>
            <div className="story-card-bottom"><span>ORIGINAL IDEAS. BETTER FLOW.</span><span>HYPERCUT ✳</span></div>
          </div>
          <div className="floating-label label-cut"><Scissors size={17} /> A little less waiting.</div>
          <div className="floating-label label-caption"><Subtitles size={17} /> Every word, in your style.</div>
        </div>
        <ol className="story-steps">
          <li><span>01</span> Bring your voice.</li><li><span>02</span> Lose the pauses.</li><li><span>03</span> Make it yours.</li>
        </ol>
        <span className="motion-disclosure">An illustration of the editing flow. Try the audio demo above.</span>
      </div>
    </section>
  );
}
