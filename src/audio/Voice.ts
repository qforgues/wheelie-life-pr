/**
 * Speech, for the crash calls.
 *
 * Uses the browser's own speech synthesis - no audio files, which matters
 * because the eventual feature is rival trash talk in either English or Puerto
 * Rican Spanish, and recording every line is not something we can do yet. This
 * proves the channel and gives the wipeouts a voice in the meantime.
 *
 * Nothing here is guaranteed to exist: some browsers have no voices at all, and
 * the console browser may be one of them. Every path degrades to silence.
 */
export type VoiceLang = 'es' | 'en';

export class Voice {
  enabled = true;
  /** Set by the game once a voice pack has been looked for. */
  pack: { has(reason: string): boolean; play(reason: string): boolean } | null = null;
  /** 0..1. Anything below this and a line just doesn't get called. */
  chattiness = 1;

  private voices: SpeechSynthesisVoice[] = [];
  private supported = typeof speechSynthesis !== 'undefined';
  private lastAt = 0;

  constructor() {
    if (!this.supported) return;
    const load = () => { this.voices = speechSynthesis.getVoices(); };
    load();
    // Most browsers populate the list asynchronously.
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  get available(): boolean {
    return this.supported && this.voices.length > 0;
  }

  /** Best match for a language, preferring a Latin-American Spanish voice. */
  private pick(lang: VoiceLang): SpeechSynthesisVoice | null {
    if (!this.voices.length) return null;
    const wanted = lang === 'es'
      ? [/es[-_](PR|MX|US|419)/i, /^es/i]
      : [/en[-_]US/i, /^en/i];
    for (const re of wanted) {
      const hit = this.voices.find((v) => re.test(v.lang));
      if (hit) return hit;
    }
    return this.voices[0] ?? null;
  }

  /**
   * Calls a line for a crash reason.
   *
   * Three tiers, in order: a real recording if one has been made, the browser's
   * synthesised voice if it has one, and silence. Only the first is any good,
   * but the game must not depend on which is available.
   */
  call(reason: string, fallbackText: string, lang: VoiceLang = 'es'): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastAt < 900) return;
    if (Math.random() > this.chattiness) return;

    if (this.pack?.has(reason) && this.pack.play(reason)) {
      this.lastAt = now;
      return;
    }
    this.say(fallbackText, lang);
  }

  /**
   * Says a line with the browser's own voice. Cancels anything still going,
   * because a pile-up of crash calls over each other sounds broken.
   */
  say(text: string, lang: VoiceLang = 'es', opts: { rate?: number; pitch?: number } = {}): void {
    if (!this.supported || !this.enabled) return;
    if (Math.random() > this.chattiness) return;
    // Don't stack calls from a crash that bounces.
    const now = performance.now();
    if (now - this.lastAt < 900) return;
    this.lastAt = now;

    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = this.pick(lang);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = lang === 'es' ? 'es-US' : 'en-US';
      }
      u.rate = opts.rate ?? 1.05;
      u.pitch = opts.pitch ?? 1.05;
      u.volume = 1;
      speechSynthesis.speak(u);
    } catch {
      /* no voice here - the crash still has its sound */
    }
  }

  stop(): void {
    if (!this.supported) return;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}

/**
 * What gets shouted when you go down, by how you went down.
 *
 * The first line of each is what the banner shows; the spoken call is picked at
 * random from the same list, so the screen and the voice agree on the flavour
 * without always being identical.
 */
export const CRASH_CALLS: Record<string, string[]> = {
  looped: ['¡SE FUE!', '¡SE VOLTEÓ!', 'ADIÓS'],
  lowside: ['LA TIRÓ', 'SE FUE DE LADO', '¡AY BENDITO!'],
  impact: ['¡BOOM!', '¡CUIDAO!', 'ESO DOLIÓ'],
  nosedive: ['¡SE CLAVÓ!', 'DE CARA'],
};

export function pickCall(reason: string | null): string {
  const list = CRASH_CALLS[reason ?? 'impact'] ?? CRASH_CALLS.impact;
  return list[Math.floor(Math.random() * list.length)];
}
