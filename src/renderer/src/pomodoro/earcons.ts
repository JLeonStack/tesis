// The timer's three sounds, synthesized in code (ported from Keel's EarconSynth).
// They differ in contour and rhythm, not just pitch, and share one bell timbre,
// so they read as a family. The motifs are fixed: a fixed motif is what becomes a cue.

export type Earcon = 'focusStart' | 'focusEnd' | 'breakEnd'

/** (frequency in Hz, duration in seconds) */
const NOTES: Record<Earcon, [number, number][]> = {
  focusStart: [[523.25, 0.11], [659.25, 0.11], [783.99, 0.42]], // C5 E5 G5, up
  focusEnd: [[783.99, 0.16], [659.25, 0.16], [523.25, 0.75]], // G5 E5 C5, down to rest
  breakEnd: [[783.99, 0.34], [987.77, 0.11], [1174.66, 0.3]] // G5 B5 D6, the start motif reversed, higher
}

const RATE = 44_100
const GAP = 0.03
const TAIL = 0.5

let ctx: AudioContext | null = null
const cache = new Map<Earcon, AudioBuffer>()

function render(earcon: Earcon, ac: AudioContext): AudioBuffer {
  const notes = NOTES[earcon]
  // Endings get a gentler attack: ramped onsets don't startle.
  const attack = earcon === 'focusEnd' ? 0.03 : 0.008
  const total = notes.reduce((n, [, d]) => n + d + GAP, 0) + TAIL
  const buf = ac.createBuffer(1, Math.ceil(total * RATE), RATE)
  const out = buf.getChannelData(0)
  let start = 0
  for (const [f, length] of notes) {
    const first = Math.floor(start * RATE)
    const ring = Math.floor((length + TAIL) * RATE)
    for (let i = 0; i < ring && first + i < out.length; i++) {
      const t = i / RATE
      const w = 2 * Math.PI * f * t
      // A bell: slightly inharmonic partials that die away faster than the fundamental.
      const tone = Math.sin(w) + 0.35 * Math.sin(2.76 * w) * Math.exp(-t * 9) + 0.12 * Math.sin(5.4 * w) * Math.exp(-t * 16)
      const body = t < attack ? t / attack : Math.exp(-(t - attack) * 3.2)
      const env = t > length ? body * Math.exp(-(t - length) * 6) : body
      out[first + i] += 0.28 * env * tone
    }
    start += length + GAP
  }
  // Fade the very end so nothing clicks.
  const fade = Math.min(out.length, Math.floor(0.02 * RATE))
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade
  return buf
}

export function playEarcon(earcon: Earcon, volume = 0.7): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    let buf = cache.get(earcon)
    if (!buf) {
      buf = render(earcon, ctx)
      cache.set(earcon, buf)
    }
    const src = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = Math.max(0, Math.min(1, volume))
    src.buffer = buf
    src.connect(gain).connect(ctx.destination)
    src.start()
  } catch {
    // No audio device: the visual signals still say it.
  }
}
