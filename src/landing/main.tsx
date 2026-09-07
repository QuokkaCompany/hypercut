import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Code2,
  Copy,
  Globe2,
  HardDrive,
  Layers3,
  Minus,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Subtitles,
  VolumeX,
  X,
} from "lucide-react";
import editorImage from "../../docs/media/silence-editing.png?url";
import walkthrough from "../../docs/media/walkthrough.mp4?url";
import "./landing.css";

function Github({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.14.69-3.8-1.33-3.8-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.29.94.1-.73.4-1.23.72-1.51-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.44.11-2.99 0 0 .95-.3 3.09 1.15A10.74 10.74 0 0 1 12 6.16c.96 0 1.92.13 2.81.38 2.14-1.45 3.09-1.15 3.09-1.15.61 1.55.23 2.7.11 2.99.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.28-5.14 5.56.4.35.77 1.03.77 2.08v3.09c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z" />
    </svg>
  );
}
const REPO = "https://github.com/QuokkaCompany/hypercut";
const SOURCE_DURATION = 18.87;
const spans = [
  { duration: 1.05, db: -52, quiet: true },
  { duration: 2.5, db: -14, quiet: false },
  { duration: 1.8, db: -46, quiet: true },
  { duration: 3.1, db: -12, quiet: false },
  { duration: 1.42, db: -42, quiet: true },
  { duration: 2.6, db: -18, quiet: false },
  { duration: 1.6, db: -48, quiet: true },
  { duration: 4.8, db: -16, quiet: false },
];
const commands = {
  local:
    "git clone https://github.com/QuokkaCompany/hypercut.git\ncd hypercut\nnpm ci\nnpm run build\nnpm start",
  cloud:
    "git clone https://github.com/QuokkaCompany/hypercut.git\ncd hypercut\ndocker compose up --build -d",
};
function Brand() {
  return (
    <a className="brand" href="#top" aria-label="HyperCut home">
      <img src="/favicon.svg" alt="" width="34" height="34" />
      <span>
        hypercut<span className="brand-dot">.</span>
      </span>
    </a>
  );
}
function Wave({ quiet, index }: { quiet: boolean; index: number }) {
  return (
    <span className="wave-bars" aria-hidden="true">
      {Array.from({ length: 24 }, (_, n) => (
        <i
          key={n}
          style={{
            height: `${quiet ? 4 + ((n * 7 + index) % 8) : 17 + Math.abs(Math.sin(n * 1.7 + index)) * 53 + Math.sin(n * 0.4) * 12}%`,
          }}
        />
      ))}
    </span>
  );
}
function TimelineDemo() {
  const [threshold, setThreshold] = useState(-40);
  const [restored, setRestored] = useState<number[]>([]);
  const [mode, setMode] = useState<"original" | "edited">("edited");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const removed = spans.map(
    (span, i) => span.quiet && span.db <= threshold && !restored.includes(i),
  );
  const saved = spans.reduce(
    (sum, span, i) => sum + (removed[i] ? span.duration : 0),
    0,
  );
  const duration =
    mode === "edited" ? SOURCE_DURATION - saved : SOURCE_DURATION;
  const count = removed.filter(Boolean).length;
  useEffect(() => {
    setPosition(0);
    setPlaying(false);
  }, [threshold, mode, restored]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(),
        delta = (now - last) / 1000;
      last = now;
      setPosition((previous) => {
        if (previous + delta >= duration) {
          setPlaying(false);
          return 0;
        }
        return previous + delta;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [playing, duration]);
  function reset() {
    setThreshold(-40);
    setRestored([]);
    setMode("edited");
    setPosition(0);
    setPlaying(false);
  }
  return (
    <div className="demo-shell" id="playground">
      <div className="demo-toolbar">
        <span className="session-name">
          <span className="live-dot" /> A little less dead air
        </span>
        <span className="demo-label">
          <SlidersHorizontal size={13} /> INTERACTIVE DEMO
        </span>
      </div>
      <div className="demo-topline">
        <div className="demo-project">
          <span className="clip-icon">
            <Layers3 size={20} />
          </span>
          <div>
            <strong>My next big idea.mp4</strong>
            <span>A talking-head sample · {SOURCE_DURATION}s</span>
          </div>
        </div>
        <div className="view-switch" role="group" aria-label="Timeline view">
          <button
            aria-pressed={mode === "original"}
            onClick={() => setMode("original")}
          >
            Original
          </button>
          <button
            aria-pressed={mode === "edited"}
            onClick={() => setMode("edited")}
          >
            HyperCut <Sparkles size={12} />
          </button>
        </div>
      </div>
      <div className="timeline-caption">
        <span>
          <span className="tiny-square" /> AUDIO / VIDEO
        </span>
        <span>
          {mode === "edited"
            ? "Pauses out. Your voice stays."
            : "Every word. Every pause."}
        </span>
      </div>
      <div className="timeline-ruler" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((n) => (
          <span key={n}>{((duration * n) / 4).toFixed(1)}s</span>
        ))}
      </div>
      <div className="timeline-track" aria-label="Interactive sample timeline">
        {spans.map((span, index) => {
          const cut = removed[index];
          return (
            <button
              key={index}
              disabled={!span.quiet}
              onClick={() => {
                if (cut) setRestored([...restored, index]);
                else if (restored.includes(index))
                  setRestored(restored.filter((x) => x !== index));
              }}
              className={`timeline-span ${span.quiet ? "quiet" : "speech"} ${cut && mode === "edited" ? "cut" : ""} ${restored.includes(index) ? "restored" : ""}`}
              style={{ flex: mode === "edited" && cut ? 0.22 : span.duration }}
              aria-label={
                span.quiet
                  ? `${cut ? "Restore" : restored.includes(index) ? "Remove" : "Quiet"} pause ${index / 2 + 1}, ${span.duration.toFixed(2)} seconds${!cut && !restored.includes(index) ? ", below detection sensitivity" : ""}`
                  : "Speech retained"
              }
              title={
                span.quiet
                  ? cut
                    ? "Click to restore this pause"
                    : restored.includes(index)
                      ? "Click to remove again"
                      : "Move the threshold to detect this pause"
                  : "Speech retained"
              }
            >
              <Wave quiet={span.quiet} index={index} />
              {cut && mode === "edited" && (
                <Scissors className="cut-icon" size={12} />
              )}
            </button>
          );
        })}
        <div
          className="playhead"
          style={{ left: `${(position / duration) * 100}%` }}
          aria-hidden="true"
        >
          <span />
        </div>
      </div>
      <div className="timeline-under">
        <span>
          <i /> Speech kept
        </span>
        <span>
          <i /> Detected pause{" "}
          <span className="click-hint">— click to restore</span>
        </span>
        <button onClick={reset} aria-label="Reset demo">
          <RotateCcw size={12} /> Reset
        </button>
      </div>
      <div className="demo-controls">
        <button
          className="play-button"
          aria-label={
            playing ? "Pause timeline preview" : "Play silent timeline preview"
          }
          onClick={() => setPlaying(!playing)}
        >
          {playing ? (
            <Pause size={17} fill="currentColor" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
        </button>
        <span className="timecode">
          {position.toFixed(2)} <span>/ {duration.toFixed(2)}</span>
        </span>
        <div className="threshold-control">
          <label htmlFor="threshold">
            Silence threshold{" "}
            <output htmlFor="threshold">{threshold} dB</output>
          </label>
          <input
            id="threshold"
            type="range"
            min="-55"
            max="-25"
            step="1"
            value={threshold}
            onChange={(event) => {
              setThreshold(Number(event.target.value));
              setRestored([]);
            }}
          />
          <div className="slider-labels">
            <span>Keep more</span>
            <span>Cut more</span>
          </div>
        </div>
        <div className="savings" aria-live="polite">
          <strong>
            {saved.toFixed(2)}
            <small>s</small>
          </strong>
          <span>{count} pauses removed</span>
        </div>
      </div>
      <div className="demo-footer">
        <ShieldCheck size={12} />
        <span>
          Illustrative timeline. No uploads, audio playback, or AI calls.
        </span>
        <span className="demo-footer-right">
          MAKE SOME ROOM FOR YOUR STORY <ArrowUpRight size={12} />
        </span>
      </div>
    </div>
  );
}
function CaptionPreview() {
  const [style, setStyle] = useState("box");
  const [language, setLanguage] = useState("en");
  const text: Record<string, string> = {
    en: "Good ideas deserve to be heard.",
    ko: "좋은 아이디어는 들려줄 가치가 있어요.",
    ja: "いいアイデアを、もっと届けよう。",
  };
  return (
    <div className="caption-card">
      <div className="caption-scene">
        <div className="scene-window">
          <span />
          <span />
          <span />
        </div>
        <div className="scene-art">
          <i />
          <i />
          <i />
        </div>
        <span className="scene-label">YOUR NEXT TUTORIAL</span>
        <span className={`sample-caption caption-${style}`}>
          {text[language]}
        </span>
        <span className="scene-time">00:04 / 00:13</span>
      </div>
      <div className="caption-options">
        <div role="group" aria-label="Caption style">
          {["clean", "box", "emphasis"].map((item) => (
            <button
              key={item}
              aria-pressed={style === item}
              onClick={() => setStyle(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="language-select">
          <Globe2 size={14} />
          <select
            aria-label="Sample caption language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="en">EN</option>
            <option value="ko">KO</option>
            <option value="ja">JA</option>
          </select>
        </label>
      </div>
      <span className="caption-disclaimer">
        Style playground · prewritten translations
      </span>
    </div>
  );
}
function Install() {
  const [edition, setEdition] = useState<"local" | "cloud">("local");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(commands[edition]);
      setCopied(true);
      setCopyError(false);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <section className="install-section section-container" id="get-started">
      <div className="install-copy">
        <span className="eyebrow">
          <span /> YOUR FOOTAGE. YOUR SETUP.
        </span>
        <h2>
          Make room for
          <br />
          the good stuff<span className="lime-dot">.</span>
        </h2>
        <p>
          Start on your own machine. Or bring HyperCut to your own server. The
          same open-source editor, your choice.
        </p>
        <a
          className="text-link"
          href={`${REPO}#run-locally`}
          target="_blank"
          rel="noreferrer"
        >
          Read the setup guide <ArrowUpRight size={16} />
        </a>
        <div className="edition-note">
          <Code2 size={18} />
          <span>
            Early development · GPL-3.0
            <br />
            <small>The editing interface is currently in Korean.</small>
          </span>
        </div>
      </div>
      <div className="install-card">
        <div
          className="install-tabs"
          role="group"
          aria-label="Installation edition"
        >
          <button
            aria-pressed={edition === "local"}
            onClick={() => {
              setEdition("local");
              setCopied(false);
              setCopyError(false);
            }}
          >
            <HardDrive size={15} /> Run locally
          </button>
          <button
            aria-pressed={edition === "cloud"}
            onClick={() => {
              setEdition("cloud");
              setCopied(false);
              setCopyError(false);
            }}
          >
            <Globe2 size={15} /> Self-host
          </button>
        </div>
        <div className="install-description">
          <strong>
            {edition === "local"
              ? "Your desk. Your creative space."
              : "Your server. Your editing workspace."}
          </strong>
          <p>
            {edition === "local"
              ? "Requires Go 1.26+, a C compiler, Node.js 22.12+ and FFmpeg. Desktop development targets Apple Silicon macOS."
              : "Requires Docker Compose. Runs a Go API and worker. This is a self-hosted beta, not a hosted service."}
          </p>
        </div>
        <div className="code-block">
          <div>
            <span>TERMINAL</span>
            <button onClick={copy} aria-label="Copy installation commands">
              {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre>
            <code>{commands[edition]}</code>
          </pre>
        </div>
        <div className="install-bottom" aria-live="polite">
          {copyError ? (
            "Clipboard unavailable. Select and copy the commands above."
          ) : edition === "local" ? (
            <>
              Then open <code>localhost:4327</code> in your browser.
            </>
          ) : (
            <>
              Next: create an account using the{" "}
              <a
                href={`${REPO}/blob/main/docs/cloud/README.md`}
                target="_blank"
                rel="noreferrer"
              >
                cloud setup guide ↗
              </a>
              .
            </>
          )}
        </div>
        <p className="install-footnote">
          Local transcription needs a one-time Whisper model setup. See the
          guide for current platform support and prerequisites.
        </p>
      </div>
    </section>
  );
}
function App() {
  const [videoOpen, setVideoOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (videoOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [videoOpen]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="page" id="top">
        <header className="site-header section-container">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#features">Features</a>
            <a href={`${REPO}#run-locally`} target="_blank" rel="noreferrer">
              Docs <ArrowUpRight size={12} />
            </a>
          </nav>
          <a
            className="github-button"
            href={REPO}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} />
            <span>Star on GitHub</span>
            <ArrowUpRight size={14} />
          </a>
        </header>
        <main id="main">
          <section className="hero section-container">
            <div className="hero-heading">
              <div>
                <a
                  href={REPO}
                  className="release-badge"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="status-dot" /> OPEN SOURCE. OPEN
                  POSSIBILITIES. <ArrowUpRight size={13} />
                </a>
                <h1>
                  Your story.
                  <br />
                  Without the{" "}
                  <span className="word-pause">
                    pauses
                    <svg viewBox="0 0 400 18" aria-hidden="true">
                      <path d="M3 12Q195-3 395 9M14 17Q220 3 370 12" />
                    </svg>
                  </span>
                  <span className="lime-dot">.</span>
                </h1>
              </div>
              <div className="hero-aside">
                <p>
                  You bring the ideas.
                  <br />
                  HyperCut makes the space for them.
                </p>
                <p className="hero-description">
                  Remove quiet gaps, shape your clips, and turn speech into
                  captions. A local-first video editor for the way you talk.
                </p>
                <a className="button button-dark" href="#get-started">
                  Get started — it’s open source <ArrowUpRight size={17} />
                </a>
                <button
                  className="watch-link"
                  onClick={() => setVideoOpen(true)}
                >
                  <span>
                    <Play size={11} fill="currentColor" />
                  </span>{" "}
                  See the real editor in action <ArrowRight size={14} />
                </button>
              </div>
            </div>
            <div className="demo-intro">
              <span>
                <ArrowDown size={14} /> A SMALL CHANGE. A BETTER FLOW.
              </span>
              <span>Drag the threshold. Feel the difference.</span>
            </div>
            <TimelineDemo />
            <div className="hero-benefits">
              <span>
                <ShieldCheck size={16} /> Local editing, no account needed
              </span>
              <span>
                <CheckCheck size={16} /> Originals stay untouched
              </span>
              <span>
                <Github size={16} /> Yours to use. Yours to improve.
              </span>
            </div>
          </section>
          <section className="workflow section-container" id="how-it-works">
            <div className="section-heading">
              <span className="eyebrow">
                <span /> FIND YOUR FLOW
              </span>
              <h2>
                From “one more take”
                <br />
                to ready to share.
              </h2>
              <p>
                For the tutorials, lessons, and conversations
                <br className="desktop-break" /> that deserve a little less
                editing.
              </p>
            </div>
            <div className="steps">
              <article>
                <span className="step-number">
                  01 <Minus size={26} />
                </span>
                <div className="step-icon">
                  <Layers3 size={24} />
                </div>
                <h3>Bring your recording.</h3>
                <p>
                  Import an H.264 MP4 or MOV. Pick your audio track. Your
                  original file stays exactly as it is.
                </p>
              </article>
              <article>
                <span className="step-number">
                  02 <Minus size={26} />
                </span>
                <div className="step-icon">
                  <Scissors size={24} />
                </div>
                <h3>Cut the quiet parts.</h3>
                <p>
                  Choose a silence threshold and review the draft. Restore any
                  cut. You get the final say.
                </p>
              </article>
              <article>
                <span className="step-number">
                  03 <Minus size={26} />
                </span>
                <div className="step-icon">
                  <Subtitles size={24} />
                </div>
                <h3>Let every word land.</h3>
                <p>
                  Transcribe locally, polish your captions, and export your
                  video, subtitles, or transcript.
                </p>
              </article>
            </div>
          </section>
          <section className="features-section" id="features">
            <div className="section-container">
              <div className="feature-heading">
                <div>
                  <span className="eyebrow">
                    <span /> LESS FRICTION. MORE EXPRESSION.
                  </span>
                  <h2>
                    A small toolkit.
                    <br />A big creative difference.
                  </h2>
                </div>
                <p>
                  Enough control to make it yours.
                  <br />
                  Enough help to keep you moving.
                </p>
              </div>
              <div className="feature-grid">
                <article className="feature feature-captions">
                  <div className="feature-copy">
                    <span className="feature-kicker">
                      WORDS, WITH PERSONALITY
                    </span>
                    <h3>Your voice. Your style.</h3>
                    <p>
                      Edit the words, choose a look, and make your captions part
                      of the story. Try a style below.
                    </p>
                  </div>
                  <CaptionPreview />
                </article>
                <article className="feature feature-ai">
                  <div className="feature-copy">
                    <span className="feature-kicker">
                      A LITTLE HELP, ON YOUR TERMS
                    </span>
                    <h3>Bring your own AI.</h3>
                    <p>
                      Ask for caption corrections, translations, or editing
                      suggestions. Review each proposal before anything changes.
                    </p>
                  </div>
                  <div className="ai-orbit" aria-hidden="true">
                    <span className="orbit-label label-one">
                      <span className="provider-mark">◎</span> Ollama
                    </span>
                    <span className="orbit-label label-two">
                      <Sparkles size={17} /> OpenAI API
                    </span>
                    <span className="orbit-label label-three">
                      <span className="provider-mark">✳</span> Claude
                    </span>
                    <div className="orbit-ring ring-one" />
                    <div className="orbit-ring ring-two" />
                    <img src="/favicon.svg" alt="" />
                  </div>
                  <div className="ai-note">
                    <ShieldCheck size={14} /> Optional connections. Explicit
                    requests. Your approval.
                  </div>
                </article>
                <article className="feature feature-control">
                  <div className="feature-copy">
                    <span className="feature-kicker">
                      THE FINAL CUT IS YOURS
                    </span>
                    <h3>Keep the human in the edit.</h3>
                    <p>
                      Restore a breath. Adjust a caption. Reopen a project.
                      Every draft leaves room for your judgment.
                    </p>
                  </div>
                  <div className="control-chips">
                    <span>
                      <RotateCcw size={14} /> Restore cuts
                    </span>
                    <span>
                      <Layers3 size={14} /> Save projects
                    </span>
                    <span>
                      <VolumeX size={14} /> Shape sound
                    </span>
                  </div>
                </article>
              </div>
            </div>
          </section>
          <section className="real-section section-container">
            <div className="real-copy">
              <span className="eyebrow">
                <span /> THIS IS THE ACTUAL APP
              </span>
              <h2>
                Less busywork.
                <br />
                More “that’s a wrap.”
              </h2>
              <p>
                A waveform you can read. Cuts you can change. Captions you can
                make your own.
              </p>
              <button className="text-link" onClick={() => setVideoOpen(true)}>
                Watch the product walkthrough <ArrowRight size={16} />
              </button>
              <p className="capture-note">
                Actual application capture. The editor is currently in Korean.
                The walkthrough is silent and uses a generated-speech sample.
              </p>
            </div>
            <button
              className="editor-shot"
              onClick={() => setVideoOpen(true)}
              aria-label="Watch the actual HyperCut editor walkthrough"
            >
              <img
                src={editorImage}
                alt="Actual HyperCut editor with source preview, green waveform, and editable silence cuts"
                loading="lazy"
                width="1560"
                height="1000"
              />
              <span className="shot-play">
                <Play size={20} fill="currentColor" />
              </span>
              <span className="shot-label">REAL PRODUCT. REAL WORKFLOW.</span>
            </button>
          </section>
          <Install />
          <section className="faq section-container">
            <div>
              <span className="eyebrow">
                <span /> A FEW GOOD QUESTIONS
              </span>
              <h2>Before your first cut.</h2>
            </div>
            <div className="faq-list">
              {[
                [
                  "Is HyperCut free?",
                  "The code is open source under GPL-3.0. Local silence editing and prepared local transcription do not need a paid AI account. Optional API providers and your own cloud infrastructure can have separate costs.",
                ],
                [
                  "Does my footage leave my computer?",
                  "In the local edition, core media processing stays on your computer. Self-hosting uploads footage to the server you choose. Optional AI requests send selected text and instructions; original media is not automatically attached.",
                ],
                [
                  "Can I use it instead of my professional editor?",
                  "HyperCut is in early development, focused on silence editing, clips, captions, and effects. Start with a copy of a short H.264 SDR recording and review the result. It is not a fully validated replacement for a professional editor.",
                ],
                [
                  "Which languages does it support?",
                  "Transcription supports Korean, English, Japanese, Chinese, Spanish, French, German, Portuguese, Italian, and Russian, plus automatic language detection. Always review the transcript. The landing page and documentation are in English; the editing interface is currently in Korean.",
                ],
              ].map(([question, answer]) => (
                <details key={question}>
                  <summary>
                    {question}
                    <ChevronDown size={17} />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </section>
          <section className="closing section-container">
            <span className="closing-spark" aria-hidden="true">
              ✳
            </span>
            <h2>
              The world needs your ideas.
              <br />
              Not the pauses between them.
            </h2>
            <a className="button button-dark" href="#get-started">
              Make your first cut <ArrowUpRight size={17} />
            </a>
            <p>Open source. Local first. Always your story.</p>
          </section>
        </main>
        <footer className="site-footer section-container">
          <Brand />
          <span>Made for makers, by QuokkaCompany.</span>
          <div>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub <ArrowUpRight size={12} />
            </a>
            <a
              href={`${REPO}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer"
            >
              GPL-3.0 <ArrowUpRight size={12} />
            </a>
          </div>
        </footer>
      </div>
      <dialog
        ref={dialog}
        className="video-dialog"
        onCancel={() => setVideoOpen(false)}
        onClose={() => setVideoOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setVideoOpen(false);
        }}
        aria-labelledby="walkthrough-title"
      >
        <div className="video-dialog-content">
          <div>
            <span id="walkthrough-title">Inside HyperCut</span>
            <button
              onClick={() => setVideoOpen(false)}
              aria-label="Close walkthrough"
            >
              <X size={20} />
            </button>
          </div>
          {videoOpen && (
            <video
              src={walkthrough}
              controls
              playsInline
              preload="metadata"
              autoPlay
              muted
              aria-label="Silent recording of the actual HyperCut application"
            />
          )}
          <p>
            Actual app recording · silent · generated-speech sample · waiting
            time omitted
          </p>
        </div>
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
