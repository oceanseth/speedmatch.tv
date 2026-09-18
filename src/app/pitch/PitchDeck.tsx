"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./pitch.module.css";

const titles = ["SpeedMatch", "The problem", "The format", "Voice demo", "Use cases", "Progress", "Business model", "The team", "Try it"];

export default function PitchDeck() {
  const [current, setCurrent] = useState(0);
  const deck = useRef<HTMLElement>(null);
  const go = (index: number) => {
    const target = deck.current?.querySelectorAll<HTMLElement>("section")[index];
    if (target && deck.current) {
      deck.current.scrollTo({ top: target.offsetTop - deck.current.offsetTop, behavior: "instant" });
      setCurrent(index);
      history.replaceState(null, "", `#${target.id}`);
    }
  };

  useEffect(() => {
    const root = deck.current;
    if (!root) return;
    const sections = [...root.querySelectorAll<HTMLElement>("section")];
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setCurrent(sections.indexOf(visible.target as HTMLElement));
    }, { root, threshold: [0.25, 0.5, 0.75] });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, a, [contenteditable]"))) return;
      const index = event.key === "ArrowRight" || event.key === "PageDown" ? Math.min(current + 1, titles.length - 1)
        : event.key === "ArrowLeft" || event.key === "PageUp" ? Math.max(current - 1, 0)
        : event.key === "Home" ? 0 : event.key === "End" ? titles.length - 1 : null;
      if (index !== null) { event.preventDefault(); go(index); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  return <div className={styles.presentation}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="SpeedMatch.tv home">speed<span>match</span><small>.tv</small></Link>
      <span className={styles.edition}>Hackathon pitch · September 2026</span>
      <button onClick={() => window.print()} className={styles.print}>Print / PDF</button>
    </header>

    <main ref={deck} className={styles.deck} aria-label="SpeedMatch pitch deck">
      <section id="intro" aria-label="Slide 1: SpeedMatch" className={`${styles.slide} ${styles.cover}`}>
        <p className={styles.eyebrow}>A voice game show for your next match</p>
        <h1>15 seconds<br />to <em>win you over.</em></h1>
        <p className={styles.lead}>People, products and places pitch.<br />You talk back. You choose.</p>
        <p className={styles.byline}>Seth Caldwell + David Tilser</p>
      </section>

      <section id="problem" aria-label="Slide 2: The problem" className={styles.slide}>
        <p className={styles.eyebrow}>Why this · the problem we’re building for</p>
        <h2>A weekend away.<br /><em>A maze of options.</em></h2>
        <div className={styles.split}>
          <p className={styles.lead}>Imagine planning a quiet weekend away. Every new tab adds another destination. What you need is help deciding which one fits you.</p>
          <p className={styles.statement}>Tell the host what matters.<br /><strong>Let the places make their case.</strong></p>
        </div>
      </section>

      <section id="format" aria-label="Slide 3: The format" className={styles.slide}>
        <p className={styles.eyebrow}>The product vision</p>
        <h2>A conversation<br /><em>with a finish line.</em></h2>
        <ol className={styles.steps}>
          <li><span>01</span><div><h3>Tell the host what matters</h3><p>A voice conversation makes your preferences explicit.</p></div></li>
          <li><span>02</span><div><h3>Hear two short pitches</h3><p>AI contestants make the case for each option, head to head.</p></div></li>
          <li><span>03</span><div><h3>Choose who advances</h3><p>One choice per round, until a single winner remains.</p></div></li>
        </ol>
        <p className={styles.note}>Short pitches make comparison manageable. A bracket gives the conversation an ending. Full voice-to-winner integration is next; simulated pitches are not endorsements by real people.</p>
      </section>

      <section id="voice" aria-label="Slide 4: Voice demo" className={`${styles.slide} ${styles.demo}`}>
        <div><p className={styles.eyebrow}>The working voice prototype</p><h2>Say what you want.<br /><em>Hear the host reply.</em></h2></div>
        <figure className={styles.preview}>
          <Image unoptimized src="/pitch/voice-preview.png" alt="SpeedMatch voice interface with a speaking host card, microphone controls, and both sides of a transcribed conversation." width={1280} height={720} sizes="(max-width: 700px) 90vw, 800px" />
          <figcaption>Product preview from a real Boson audio test using synthetic speech. The host illustration reacts to speech; avatar video comes later.</figcaption>
        </figure>
        <Link href="/session/new" target="_blank" rel="noopener noreferrer" className={styles.textLink}>Open the voice demo ↗</Link>
      </section>

      <section id="use-cases" aria-label="Slide 5: Use cases" className={styles.slide}>
        <p className={styles.eyebrow}>One format, different decisions</p>
        <h2>Find your kind of <em>match.</em></h2>
        <dl className={styles.categories}>
          <div><dt>People</dt><dd>A collaborator. An investor. Someone you want to meet.</dd></div>
          <div><dt>Products</dt><dd>The right tool or purchase for what you actually need.</dd></div>
          <div><dt>Places</dt><dd>Your next trip, neighborhood or place to spend a weekend.</dd></div>
        </dl>
        <p className={styles.note}>Initial use cases to test. Matching is a recommendation, not a promise of an introduction or outcome.</p>
      </section>

      <section id="progress" aria-label="Slide 6: Progress" className={styles.slide}>
        <p className={styles.eyebrow}>Pre-traction hackathon prototype</p>
        <h2>Built today.<br /><em>Next to prove.</em></h2>
        <div className={styles.progress}>
          <div><h3>Working pieces</h3><ul><li>Real voice input and spoken replies</li><li>Webcam preview and conversation captions</li><li>Tested tournament state machine</li><li>Public bracket recaps with seeded examples</li></ul></div>
          <div><h3>The next milestone</h3><p>A guest talks to the host, hears every pitch, chooses through a full bracket, then saves the winner to their account.</p><p className={styles.note}>Avatar video and audience broadcast follow voice integration.</p></div>
        </div>
        <p className={styles.note}>No traction yet. Seeded recaps are demo data, not customer activity.</p>
      </section>

      <section id="business" aria-label="Slide 7: Business model" className={styles.slide}>
        <p className={styles.eyebrow}>Proposed business model</p>
        <h2>Free to try.<br /><em>Pay for more conversation.</em></h2>
        <table className={styles.pricing}><caption>Proposed monthly plans in USD · billing is not live</caption><thead><tr><th scope="col">Plan</th><th scope="col">Monthly price</th><th scope="col">Voice minutes</th></tr></thead><tbody>
          <tr><th scope="row">Free</th><td>$0</td><td>10</td></tr>
          <tr className={styles.featured}><th scope="row">Plus</th><td>$12</td><td>120</td></tr>
          <tr><th scope="row">Pro <small>later</small></th><td>$29</td><td>360</td></tr>
        </tbody></table>
        <p className={styles.note}>Launch hypothesis: Free + Plus first. Watching stays free. Validate real usage costs and enforce quotas on the server before charging. Avatar video has a separate allowance.</p>
      </section>

      <section id="team" aria-label="Slide 8: The team" className={styles.slide}>
        <p className={styles.eyebrow}>Why us · the team</p>
        <h2>Two humans.<br /><em>An AI agent crew.</em></h2>
        <div className={styles.names}><p>Seth Caldwell</p><p>David Tilser</p></div>
        <p className={styles.lead}>We’re turning this idea into a public product during the hackathon. Our AI agent crew works together through Buzz, while we shape the experience and decide what to build.</p>
        <p className={styles.note}>Built with Boson voice, Next.js and InstaCloud / InsForge infrastructure.</p>
      </section>

      <section id="try-it" aria-label="Slide 9: Try it" className={`${styles.slide} ${styles.close}`}>
        <p className={styles.eyebrow}>Our ask to the judges</p>
        <h2>Try a conversation.<br /><em>Help shape the first<br />full tournament.</em></h2>
        <p className={styles.lead}>Tell us which decision you would bring to the stage.<br />Join our first testers and help us learn what makes a match useful.</p>
        <Link href="/session/new" target="_blank" rel="noopener noreferrer" className={styles.cta}>Try the voice demo ↗</Link>
        <p className={styles.url}>speedmatch.tv/session/new</p>
      </section>
    </main>

    <nav className={styles.controls} aria-label="Pitch navigation">
      <button onClick={() => go(Math.max(0, current - 1))} disabled={current === 0} aria-label="Previous slide">← <span>Previous</span></button>
      <span aria-live="polite" aria-atomic="true">{String(current + 1).padStart(2, "0")} / 09 <span className={styles.slideTitle}>· {titles[current]}</span></span>
      <button onClick={() => go(Math.min(titles.length - 1, current + 1))} disabled={current === titles.length - 1} aria-label="Next slide"><span>Next</span> →</button>
    </nav>
  </div>;
}
