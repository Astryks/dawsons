// Monophonic pitch detection for "sing it, hear any instrument" in the
// browser DAW — normalized autocorrelation (a classical, public DSM
// technique, the same family as the desktop app's YIN implementation in
// audio_engine/pitch.rs, adapted here for a single-pass, no-download,
// runs-in-the-tab implementation). Not derived from any specific
// product's code.

const MIN_FREQ = 70; // covers typical singing/humming range
const MAX_FREQ = 1000;
const CORRELATION_THRESHOLD = 0.35;

function midiFromFreq(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

// Estimates one frame's fundamental frequency via normalized
// autocorrelation, or null if no confident pitch is found.
//
// Two well-known pitfalls of naive lag-based autocorrelation, both
// handled here the same way real pitch trackers (including this
// project's own Rust YIN implementation) do:
//
// 1. A periodic signal's autocorrelation is high at *every* integer
//    multiple of the true period, not just the fundamental, and because
//    a real period is rarely an exact integer number of samples, a
//    longer multiple can round to an even better numerical alignment
//    than the fundamental itself — so picking the single highest
//    correlation (or even "shortest lag within X% of the max") can
//    still land on a subharmonic. The fix: scan from the shortest lag
//    upward and take the *first* local peak that clears the threshold —
//    the true fundamental always produces one before any of its
//    multiples are even reached.
// 2. That discrete peak is still only accurate to one sample of lag.
//    Parabolic interpolation across the three points around it (the
//    same technique as `pitch.rs`'s `parabolic_interpolate`) recovers
//    the sub-sample period so notes don't read a semitone or two flat.
function detectPitchInFrame(frame, sampleRate) {
  const minLag = Math.floor(sampleRate / MAX_FREQ);
  const maxLag = Math.min(frame.length - 1, Math.ceil(sampleRate / MIN_FREQ));
  if (maxLag <= minLag) return null;

  let rootMeanSquare = 0;
  for (let i = 0; i < frame.length; i++) rootMeanSquare += frame[i] * frame[i];
  rootMeanSquare = Math.sqrt(rootMeanSquare / frame.length);
  if (rootMeanSquare < 0.01) return null; // silence/noise floor

  const correlations = new Array(maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i + lag < frame.length; i++) {
      sum += frame[i] * frame[i + lag];
      normA += frame[i] * frame[i];
      normB += frame[i + lag] * frame[i + lag];
    }
    const denom = Math.sqrt(normA * normB);
    correlations[lag - minLag] = denom > 0 ? sum / denom : 0;
  }

  for (let i = 1; i < correlations.length - 1; i++) {
    if (
      correlations[i] >= CORRELATION_THRESHOLD &&
      correlations[i] >= correlations[i - 1] &&
      correlations[i] >= correlations[i + 1]
    ) {
      return sampleRate / refineLag(correlations, i, minLag);
    }
  }

  // No clean interior peak (e.g. it sits right at the search boundary) —
  // fall back to the global max.
  let bestIndex = 0;
  for (let i = 1; i < correlations.length; i++) {
    if (correlations[i] > correlations[bestIndex]) bestIndex = i;
  }
  if (correlations[bestIndex] < CORRELATION_THRESHOLD) return null;
  return sampleRate / (minLag + bestIndex);
}

function refineLag(correlations, index, minLag) {
  if (index <= 0 || index + 1 >= correlations.length) return minLag + index;
  const y0 = correlations[index - 1];
  const y1 = correlations[index];
  const y2 = correlations[index + 1];
  const denom = 2 * (2 * y1 - y2 - y0);
  if (Math.abs(denom) < 1e-9) return minLag + index;
  return minLag + index + (y2 - y0) / denom;
}

// Extracts a monophonic melody as quantized MIDI notes from an
// AudioBuffer: frame-by-frame autocorrelation pitch tracking, quantized
// to the nearest semitone, consecutive same-note frames merged, with a
// minimum note duration to suppress spurious single-frame blips — same
// structure as the desktop app's `extract_notes`.
function detectNotes(buffer) {
  const sampleRate = buffer.sampleRate;
  const mono = buffer.getChannelData(0);
  const frameSize = 2048;
  const hop = 512;
  const minNoteSec = 0.08;
  const hopSec = hop / sampleRate;

  const frameNotes = [];
  for (let pos = 0; pos + frameSize <= mono.length; pos += hop) {
    const frame = mono.subarray(pos, pos + frameSize);
    const freq = detectPitchInFrame(frame, sampleRate);
    frameNotes.push(freq ? Math.round(midiFromFreq(freq)) : null);
  }

  const notes = [];
  let current = null; // { note, startIndex }
  const flush = (endIndex) => {
    if (current === null) return;
    const durationSec = (endIndex - current.startIndex) * hopSec;
    if (durationSec >= minNoteSec) {
      notes.push({
        note: current.note,
        startSec: current.startIndex * hopSec,
        durationSec,
      });
    }
  };

  frameNotes.forEach((note, i) => {
    if (current && note === current.note) return;
    flush(i);
    current = note === null ? null : { note, startIndex: i };
  });
  flush(frameNotes.length);

  return notes;
}

// Semitone offsets from the tonic — the same music-theory facts used
// throughout this project, not anyone's copyrightable expression.
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

// Snaps a MIDI note to the nearest pitch in a given key/scale — the
// "auto-tune" correction for singing that isn't quite in tune. `tonic`
// is a pitch class 0-11 (C=0); `scale` is semitone offsets from the
// tonic. Mirrors the desktop app's `snap_to_scale`.
function snapToScale(note, tonic, scale) {
  let best = note;
  let bestDist = Infinity;
  for (let octave = -1; octave <= 1; octave++) {
    const octaveBase = (Math.floor(note / 12) + octave) * 12;
    for (const interval of scale) {
      const candidate = octaveBase + tonic + interval;
      if (candidate < 0 || candidate > 127) continue;
      const dist = Math.abs(candidate - note);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best;
}

function snapNotesToScale(notes, tonic, scale) {
  return notes.map((n) => ({ ...n, note: snapToScale(n.note, tonic, scale) }));
}

export { detectNotes, snapToScale, snapNotesToScale, MAJOR_SCALE, MINOR_SCALE };
