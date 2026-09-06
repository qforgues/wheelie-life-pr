/**
 * Recorded voice lines.
 *
 * Speech synthesis was only ever a stand-in: it cannot be captured or shipped,
 * it sounds like a satnav, and the console browser may have no voices at all.
 * Real recordings solve all three - and the interview asked for voice acting in
 * Puerto Rican Spanish, which is not something a TTS engine is going to give us.
 *
 * Format-agnostic on purpose. `decodeAudioData` handles mp3, m4a, wav, ogg and
 * webm, so a phone voice memo dropped into public/voice/ works with no
 * conversion - which matters when the people recording these are a kid and his
 * dad, not a studio.
 */
export interface VoiceManifest {
  /** Lines keyed by crash reason; each is a list of files to pick between. */
  lines: Record<string, string[]>;
}

export class VoicePack {
  /** reason -> decoded clips ready to fire. */
  private clips = new Map<string, AudioBuffer[]>();
  private loading: Promise<void> | null = null;
  loaded = false;
  /** How many files actually decoded, for the diagnostics readout. */
  count = 0;

  constructor(
    private ctx: () => AudioContext | null,
    private destination: () => AudioNode | null,
    private base = 'voice/',
  ) {}

  /**
   * Fetches the manifest and decodes every clip. Safe to call before audio has
   * started; it waits for a context. A missing manifest is the normal case
   * until someone records something, so a 404 resolves quietly.
   */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let manifest: VoiceManifest;
      try {
        const res = await fetch(`${this.base}manifest.json`, { cache: 'no-cache' });
        if (!res.ok) return;
        manifest = await res.json();
      } catch {
        return; // no pack recorded yet - the caller falls back
      }
      const ctx = this.ctx();
      if (!ctx || !manifest?.lines) return;

      const jobs: Array<Promise<void>> = [];
      for (const [reason, files] of Object.entries(manifest.lines)) {
        for (const file of files) {
          jobs.push(
            (async () => {
              try {
                const r = await fetch(`${this.base}${file}`);
                if (!r.ok) return;
                const buf = await ctx.decodeAudioData(await r.arrayBuffer());
                const list = this.clips.get(reason) ?? [];
                list.push(buf);
                this.clips.set(reason, list);
                this.count++;
              } catch {
                /* one bad file must not take the rest of the pack down */
              }
            })(),
          );
        }
      }
      await Promise.all(jobs);
      this.loaded = true;
    })();
    return this.loading;
  }

  has(reason: string): boolean {
    return (this.clips.get(reason)?.length ?? 0) > 0;
  }

  /** Fires a random clip for a reason. Returns false if there wasn't one. */
  play(reason: string, volume = 1): boolean {
    const list = this.clips.get(reason);
    const ctx = this.ctx();
    const dest = this.destination();
    if (!list?.length || !ctx || !dest) return false;

    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(dest);
    src.start();
    return true;
  }
}
