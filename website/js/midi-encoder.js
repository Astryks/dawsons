// Minimal, from-scratch Standard MIDI File (SMF) writer for the
// "Melody to MIDI (experimental)" per-track export — consistent with
// this project's established pattern of writing its own small,
// well-documented binary encoders instead of adding a dependency (see
// wav-encoder.js for WAV, and STATUS.md's in-house chord detector for
// the same "known, public, textbook technique, written ourselves"
// philosophy). This is deliberately simple: format 0 (one track), a
// single tempo meta-event, then a Note On/Note Off pair per detected
// note from pitch.js's monophonic detectNotes() — no multi-channel
// support, no velocity curves, no control-change data, just enough to
// produce a real, standards-compliant .mid file any DAW/MIDI player
// can open.

const TICKS_PER_QUARTER = 480;

// MIDI's variable-length quantity encoding: 7 data bits per byte, the
// high bit set on every byte except the last.
function writeVarLen(value) {
  let buffer = value & 0x7f;
  let v = value;
  while ((v >>= 7) > 0) {
    buffer <<= 8;
    buffer |= 0x80 | (v & 0x7f);
  }
  const bytes = [];
  for (;;) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u16(n) {
  return [(n >>> 8) & 0xff, n & 0xff];
}

// notes: [{note, startSec, durationSec}] (pitch.js's detectNotes shape,
// MIDI note numbers already), bpm: number — returns a Uint8Array ready
// to hand to a Blob.
function encodeMidiFile(notes, bpm) {
  const ticksPerSec = (TICKS_PER_QUARTER * bpm) / 60;
  const events = [];
  for (const n of notes) {
    const startTick = Math.round(n.startSec * ticksPerSec);
    const endTick = Math.max(startTick + 1, Math.round((n.startSec + n.durationSec) * ticksPerSec));
    events.push({ tick: startTick, type: "on", note: n.note });
    events.push({ tick: endTick, type: "off", note: n.note });
  }
  // Note-offs sort before note-ons at an identical tick, so two
  // back-to-back same-pitch notes with no gap (detectNotes can produce
  // this) don't look like one note overlapping itself.
  events.sort((a, b) => a.tick - b.tick || (a.type === "off" ? -1 : 1));

  const trackBytes = [];
  const usPerQuarter = Math.round(60000000 / bpm);
  trackBytes.push(...writeVarLen(0), 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);

  let lastTick = 0;
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - lastTick);
    lastTick = ev.tick;
    const status = ev.type === "on" ? 0x90 : 0x80;
    const velocity = ev.type === "on" ? 100 : 0;
    trackBytes.push(...writeVarLen(delta), status, ev.note & 0x7f, velocity);
  }
  trackBytes.push(...writeVarLen(0), 0xff, 0x2f, 0x00); // End of track

  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(TICKS_PER_QUARTER)];
  const track = [0x4d, 0x54, 0x72, 0x6b, ...u32(trackBytes.length), ...trackBytes];
  return new Uint8Array([...header, ...track]);
}

export { encodeMidiFile };
