// Web MIDI input (Chrome/Edge/Firefox; not Safari). Channel 10 or GM drum
// notes from a pad controller go to the pads; everything else to the keys.
export async function connectMidi({ onNoteOn, onNoteOff, onStatus }) {
  if (!navigator.requestMIDIAccess) {
    onStatus("Web MIDI isn't supported in this browser");
    return null;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    const bind = () => {
      const names = [];
      access.inputs.forEach((input) => {
        names.push(input.name);
        input.onmidimessage = (msg) => {
          const [st, d1, d2] = msg.data;
          const cmd = st & 0xf0;
          const ch = st & 0x0f;
          if (cmd === 0x90 && d2 > 0) onNoteOn(d1, d2, ch);
          else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) onNoteOff(d1, ch);
        };
      });
      onStatus(names.length ? `MIDI: ${names.join(", ")}` : "MIDI ready — plug in a keyboard");
    };
    access.onstatechange = bind;
    bind();
    return access;
  } catch (e) {
    onStatus("MIDI permission denied");
    return null;
  }
}
