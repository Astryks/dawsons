//! Nine short, fully original demo compositions across several genres —
//! shown as "example songs" on the home screen (filterable by genre) so
//! new users see a populated, layered project immediately instead of an
//! empty state, and get a feel for how different styles are put together.
//!
//! These are hand-authored here (standard chord progressions and jazz
//! turnarounds, like C-G-Am-F or a ii-V-I, aren't copyrightable — only a
//! specific melodic/lyrical realization is, and these melodies are
//! original), not transcriptions of any existing song, including the
//! real, famous songs referenced by name in the frontend's genre
//! inspiration lists (title/artist/year only — factual reference points,
//! not sources these compositions are derived from). See
//! docs/UX_DESIGN.md for why real songs (e.g. current commercial
//! releases) are deliberately not transcribed for this — bundling a
//! transcription or arrangement reconstruction of one into shipped demo
//! content is a meaningfully different (and real) copyright exposure than
//! a user analyzing their own copy of a song for personal use.

use super::synth::ScoreNote;

/// One bar's worth of (piano chord tones, bass root, guitar arpeggio
/// tones, melody notes) for a demo song's chord progression.
type ChordSpec = (Vec<u8>, u8, [u8; 3], [u8; 4]);

pub struct DemoLayer {
    pub name: &'static str,
    pub program: u8,
    pub notes: Vec<ScoreNote>,
}

pub struct DemoSong {
    pub title: &'static str,
    pub genre: &'static str,
    pub description: &'static str,
    pub layers: Vec<DemoLayer>,
    /// Percussion is rendered separately (fixed GM drum-kit key numbers,
    /// not a GM instrument program) — see audio_engine::synth::render_drums.
    pub drums: Vec<ScoreNote>,
}

const BAR_SEC: f32 = 2.0;
const EIGHTH: f32 = BAR_SEC / 8.0;
const QUARTER: f32 = BAR_SEC / 4.0;

fn standard_drum_bar() -> Vec<ScoreNote> {
    vec![
        ScoreNote::chord(vec![36, 42], EIGHTH), // kick + closed hihat
        ScoreNote::note(42, EIGHTH),
        ScoreNote::chord(vec![38, 42], EIGHTH), // snare + closed hihat
        ScoreNote::note(42, EIGHTH),
        ScoreNote::chord(vec![36, 42], EIGHTH),
        ScoreNote::note(42, EIGHTH),
        ScoreNote::chord(vec![38, 42], EIGHTH),
        ScoreNote::note(42, EIGHTH),
    ]
}

fn four_bar_drums() -> Vec<ScoreNote> {
    (0..4).flat_map(|_| standard_drum_bar()).collect()
}

fn bass_pulse(root: u8) -> Vec<ScoreNote> {
    (0..4).map(|_| ScoreNote::note(root, QUARTER)).collect()
}

fn arpeggio(tones: [u8; 3]) -> Vec<ScoreNote> {
    let [r, third, fifth] = tones;
    vec![r, third, fifth, third, r, third, fifth, third]
        .into_iter()
        .map(|p| ScoreNote::note(p, EIGHTH))
        .collect()
}

fn melody_phrase(notes: [u8; 4]) -> Vec<ScoreNote> {
    notes
        .into_iter()
        .map(|p| ScoreNote::note(p, QUARTER))
        .collect()
}

/// A slower harmony/support line: root, third, fifth, third — the same
/// rhythmic shape as `bass_pulse` (four quarter notes per bar), but
/// walking through the chord tones instead of holding one note. Used for
/// a 5th layer (backing harmony, comping keys, a synth pad bed) on the
/// more heavily-layered demo songs.
fn harmony_from_chord(chord: &[u8]) -> Vec<ScoreNote> {
    let root = chord[0];
    let third = chord.get(1).copied().unwrap_or(root);
    let fifth = chord.get(2).copied().unwrap_or(root);
    vec![root, third, fifth, third]
        .into_iter()
        .map(|p| ScoreNote::note(p, QUARTER))
        .collect()
}

/// "Morning Loop" — C major, upbeat, C-G-Am-F (I-V-vi-IV).
fn morning_loop() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![48, 52, 55], 36, [60, 64, 67], [72, 71, 69, 67]), // C
        (vec![43, 47, 50], 43, [55, 59, 62], [71, 69, 67, 65]), // G
        (vec![45, 48, 52], 45, [57, 60, 64], [69, 67, 65, 64]), // Am
        (vec![41, 45, 48], 41, [53, 57, 60], [67, 65, 64, 62]), // F
    ];

    let mut piano = Vec::new();
    let mut bass = Vec::new();
    let mut guitar = Vec::new();
    let mut vocal = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        piano.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        guitar.extend(arpeggio(arp_tones));
        vocal.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "Morning Loop",
        genre: "Pop",
        description: "Upbeat pop progression (C–G–Am–F) — piano, bass, guitar, and a choir lead.",
        layers: vec![
            DemoLayer {
                name: "Vocal",
                program: 52,
                notes: vocal,
            }, // Choir Aahs
            DemoLayer {
                name: "Guitar",
                program: 27,
                notes: guitar,
            }, // Electric Guitar (clean)
            DemoLayer {
                name: "Piano",
                program: 0,
                notes: piano,
            }, // Acoustic Grand Piano
            DemoLayer {
                name: "Bass",
                program: 33,
                notes: bass,
            }, // Electric Bass (finger)
        ],
        drums: four_bar_drums(),
    }
}

/// "Night Drive" — A minor, moodier, Am-F-C-G (vi-IV-I-V borrowed as a minor-key loop).
fn night_drive() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![45, 48, 52], 45, [57, 60, 64], [69, 67, 64, 60]), // Am
        (vec![41, 45, 48], 41, [53, 57, 60], [67, 65, 62, 60]), // F
        (vec![48, 52, 55], 48, [60, 64, 67], [64, 62, 60, 59]), // C
        (vec![43, 47, 50], 43, [55, 59, 62], [62, 60, 59, 57]), // G
    ];

    let mut piano = Vec::new();
    let mut bass = Vec::new();
    let mut guitar = Vec::new();
    let mut vocal = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        piano.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        guitar.extend(arpeggio(arp_tones));
        vocal.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "Night Drive",
        genre: "R&B / Soul",
        description:
            "Slower minor-key loop (Am–F–C–G) — electric piano, synth bass, and a synth-voice lead.",
        layers: vec![
            DemoLayer {
                name: "Vocal",
                program: 54,
                notes: vocal,
            }, // Synth Voice
            DemoLayer {
                name: "Guitar",
                program: 26,
                notes: guitar,
            }, // Electric Guitar (jazz)
            DemoLayer {
                name: "Piano",
                program: 4,
                notes: piano,
            }, // Electric Piano 1
            DemoLayer {
                name: "Bass",
                program: 38,
                notes: bass,
            }, // Synth Bass 1
        ],
        drums: four_bar_drums(),
    }
}

/// "Sunset Stroll" — G major, laid-back, G-Em-C-D (I-vi-IV-V), flute lead
/// standing in for the "other instruments" slot.
fn sunset_stroll() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![43, 47, 50], 43, [55, 59, 62], [67, 71, 74, 71]), // G
        (vec![40, 43, 47], 40, [52, 55, 59], [71, 69, 67, 66]), // Em
        (vec![48, 52, 55], 48, [60, 64, 67], [69, 67, 66, 64]), // C
        (vec![50, 54, 57], 50, [62, 66, 69], [66, 64, 62, 61]), // D
    ];

    let mut piano = Vec::new();
    let mut bass = Vec::new();
    let mut guitar = Vec::new();
    let mut lead = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        piano.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        guitar.extend(arpeggio(arp_tones));
        lead.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "Sunset Stroll",
        genre: "Folk / Acoustic",
        description:
            "Laid-back major-key loop (G–Em–C–D) — acoustic guitar, piano, and a flute lead.",
        layers: vec![
            DemoLayer {
                name: "Flute Lead",
                program: 73,
                notes: lead,
            }, // Flute — the "other instrument" slot
            DemoLayer {
                name: "Guitar",
                program: 24,
                notes: guitar,
            }, // Acoustic Guitar (nylon)
            DemoLayer {
                name: "Piano",
                program: 0,
                notes: piano,
            },
            DemoLayer {
                name: "Bass",
                program: 33,
                notes: bass,
            },
        ],
        drums: four_bar_drums(),
    }
}

/// "Blue Corner" — a classic jazz turnaround (ii–V–I–vi: Dm7–G7–Cmaj7–Am7),
/// original melodic content over that (uncopyrightable) chord skeleton.
fn blue_corner() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![50, 53, 57, 60], 38, [62, 65, 69], [69, 67, 65, 62]), // Dm7
        (vec![55, 59, 62, 65], 43, [67, 71, 74], [74, 72, 71, 69]), // G7
        (vec![48, 52, 55, 59], 36, [60, 64, 67], [67, 65, 64, 62]), // Cmaj7
        (vec![57, 60, 64, 67], 45, [69, 72, 76], [76, 74, 72, 69]), // Am7
    ];

    let mut piano = Vec::new();
    let mut bass = Vec::new();
    let mut guitar = Vec::new();
    let mut lead = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        piano.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        guitar.extend(arpeggio(arp_tones));
        lead.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "Blue Corner",
        genre: "Jazz",
        description:
            "Classic jazz turnaround (Dm7–G7–Cmaj7–Am7) — tenor sax lead over piano, guitar comping, and upright bass.",
        layers: vec![
            DemoLayer {
                name: "Sax Lead",
                program: 66,
                notes: lead,
            }, // Tenor Sax
            DemoLayer {
                name: "Guitar",
                program: 26,
                notes: guitar,
            }, // Electric Guitar (jazz)
            DemoLayer {
                name: "Piano",
                program: 4,
                notes: piano,
            }, // Electric Piano 1
            DemoLayer {
                name: "Bass",
                program: 32,
                notes: bass,
            }, // Acoustic Bass
        ],
        drums: four_bar_drums(),
    }
}

/// "Corner Groove" — a boom-bap style loop (i–VII–VI–VII: Am–G–F–G), the
/// same kind of short, repeating minor-key loop the genre is built on.
fn corner_groove() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![57, 60, 64], 45, [69, 72, 76], [76, 74, 72, 69]), // Am
        (vec![55, 59, 62], 43, [67, 71, 74], [74, 72, 71, 67]), // G
        (vec![53, 57, 60], 41, [65, 69, 72], [72, 69, 65, 60]), // F
        (vec![55, 59, 62], 43, [67, 71, 74], [71, 69, 67, 62]), // G
    ];

    let mut piano = Vec::new();
    let mut bass = Vec::new();
    let mut synth_riff = Vec::new();
    let mut horn_stabs = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        piano.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        synth_riff.extend(arpeggio(arp_tones));
        horn_stabs.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "Corner Groove",
        genre: "Hip-Hop",
        description:
            "Boom-bap style loop (Am–G–F–G) — horn-stab hook, synth riff, electric piano stabs, and deep synth bass.",
        layers: vec![
            DemoLayer {
                name: "Horn Stabs",
                program: 61,
                notes: horn_stabs,
            }, // Brass Section
            DemoLayer {
                name: "Synth Riff",
                program: 81,
                notes: synth_riff,
            }, // Lead 2 (sawtooth)
            DemoLayer {
                name: "Piano",
                program: 5,
                notes: piano,
            }, // Electric Piano 2
            DemoLayer {
                name: "Bass",
                program: 39,
                notes: bass,
            }, // Synth Bass 2
        ],
        drums: four_bar_drums(),
    }
}

/// "Fireside Loop" — a warm holiday-pop progression (I–IV–V–I: F–Bb–C–F),
/// the same major-key, glockenspiel-sparkle territory the genre lives in.
fn fireside_loop() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![53, 57, 60], 41, [65, 69, 72], [72, 74, 76, 77]), // F
        (vec![58, 62, 65], 46, [70, 74, 77], [77, 76, 74, 72]), // Bb
        (vec![60, 64, 67], 48, [72, 76, 79], [79, 77, 76, 74]), // C
        (vec![53, 57, 60], 41, [65, 69, 72], [72, 69, 65, 60]), // F
    ];

    let mut piano = Vec::new();
    let mut bass = Vec::new();
    let mut sparkle = Vec::new();
    let mut lead = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        piano.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        sparkle.extend(arpeggio(arp_tones));
        lead.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "Fireside Loop",
        genre: "Holiday",
        description:
            "Warm holiday-pop loop (F–Bb–C–F) — glockenspiel sparkle, piano, bass, and a choir lead.",
        layers: vec![
            DemoLayer {
                name: "Choir Lead",
                program: 52,
                notes: lead,
            }, // Choir Aahs
            DemoLayer {
                name: "Sparkle",
                program: 9,
                notes: sparkle,
            }, // Glockenspiel
            DemoLayer {
                name: "Piano",
                program: 0,
                notes: piano,
            },
            DemoLayer {
                name: "Bass",
                program: 33,
                notes: bass,
            },
        ],
        drums: four_bar_drums(),
    }
}

/// "Storybook Sky" — a 5-layer story-song pop ballad (I–V–vi–IV: G–D–Em–C),
/// the same chord family as countless pop story-songs. A more heavily
/// layered example (vocal, harmony, guitar, strings, bass) than the
/// original three, for genres where "detailed" matters more.
fn storybook_sky() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![43, 47, 50], 43, [55, 59, 62], [67, 69, 71, 72]), // G
        (vec![50, 54, 57], 50, [62, 66, 69], [74, 72, 71, 69]), // D
        (vec![40, 43, 47], 40, [52, 55, 59], [71, 69, 67, 64]), // Em
        (vec![48, 52, 55], 48, [60, 64, 67], [72, 71, 69, 67]), // C
    ];

    let mut strings = Vec::new();
    let mut bass = Vec::new();
    let mut guitar = Vec::new();
    let mut vocal = Vec::new();
    let mut harmony = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        harmony.extend(harmony_from_chord(&chord));
        strings.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        guitar.extend(arpeggio(arp_tones));
        vocal.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "Storybook Sky",
        genre: "Pop",
        description:
            "Story-song pop ballad (G–D–Em–C) — vocal lead, warm pad harmony, acoustic guitar, strings, and bass.",
        layers: vec![
            DemoLayer {
                name: "Lead Vocal",
                program: 53,
                notes: vocal,
            }, // Voice Oohs
            DemoLayer {
                name: "Harmony",
                program: 89,
                notes: harmony,
            }, // Pad 2 (warm)
            DemoLayer {
                name: "Guitar",
                program: 24,
                notes: guitar,
            }, // Acoustic Guitar (nylon)
            DemoLayer {
                name: "Strings",
                program: 48,
                notes: strings,
            }, // String Ensemble 1
            DemoLayer {
                name: "Bass",
                program: 32,
                notes: bass,
            }, // Acoustic Bass
        ],
        drums: four_bar_drums(),
    }
}

/// "Night Funk Signal" — a 5-layer driving funk-rock loop (i–VI–III–VII:
/// Em–C–G–D), the same territory as classic funk-rock hybrids: overdriven
/// guitar, a punchy synth riff, stabs, a pad bed, and slap bass.
fn night_funk_signal() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![40, 43, 47], 40, [52, 55, 59], [64, 67, 69, 67]), // Em
        (vec![48, 52, 55], 48, [60, 64, 67], [67, 69, 72, 69]), // C
        (vec![43, 47, 50], 43, [55, 59, 62], [71, 72, 74, 71]), // G
        (vec![50, 54, 57], 50, [62, 66, 69], [69, 67, 64, 62]), // D
    ];

    let mut pad = Vec::new();
    let mut bass = Vec::new();
    let mut guitar = Vec::new();
    let mut lead = Vec::new();
    let mut stabs = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        stabs.extend(harmony_from_chord(&chord));
        pad.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        guitar.extend(arpeggio(arp_tones));
        lead.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "Night Funk Signal",
        genre: "Funk / Rock",
        description:
            "Driving funk-rock loop (Em–C–G–D) — synth lead riff, overdriven guitar, synth stabs, a pad bed, and slap bass.",
        layers: vec![
            DemoLayer {
                name: "Lead Riff",
                program: 86,
                notes: lead,
            }, // Lead 7 (fifths)
            DemoLayer {
                name: "Guitar",
                program: 29,
                notes: guitar,
            }, // Overdriven Guitar
            DemoLayer {
                name: "Synth Stabs",
                program: 62,
                notes: stabs,
            }, // Synth Brass 1
            DemoLayer {
                name: "Pad",
                program: 50,
                notes: pad,
            }, // Synth Strings 1
            DemoLayer {
                name: "Bass",
                program: 36,
                notes: bass,
            }, // Slap Bass 1
        ],
        drums: four_bar_drums(),
    }
}

/// "West Coast Cruise" — a 5-layer, laid-back G-funk-style loop
/// (i–VII–i–VI: Dm–C–Dm–Bb), the same minor-key-vamp territory the style
/// is built on: a whiny synth lead, funky electric piano, a synth pad,
/// deep bass, and a whistle accent.
fn west_coast_cruise() -> DemoSong {
    let chords: [ChordSpec; 4] = [
        (vec![50, 53, 57], 38, [62, 65, 69], [69, 72, 74, 72]), // Dm
        (vec![48, 52, 55], 36, [60, 64, 67], [72, 71, 69, 67]), // C
        (vec![50, 53, 57], 38, [62, 65, 69], [69, 67, 65, 62]), // Dm
        (vec![46, 50, 53], 34, [58, 62, 65], [65, 62, 58, 53]), // Bb
    ];

    let mut pad = Vec::new();
    let mut bass = Vec::new();
    let mut keys = Vec::new();
    let mut lead = Vec::new();
    let mut whistle = Vec::new();
    for (chord, root, arp_tones, mel) in chords {
        keys.extend(harmony_from_chord(&chord));
        pad.push(ScoreNote::chord(chord, BAR_SEC));
        bass.extend(bass_pulse(root));
        whistle.extend(arpeggio(arp_tones));
        lead.extend(melody_phrase(mel));
    }

    DemoSong {
        title: "West Coast Cruise",
        genre: "Hip-Hop",
        description:
            "Laid-back G-funk-style loop (Dm–C–Dm–Bb) — whiny synth lead, funky electric piano, synth pad, deep bass, and a whistle accent.",
        layers: vec![
            DemoLayer {
                name: "Synth Lead",
                program: 84,
                notes: lead,
            }, // Lead 5 (charang)
            DemoLayer {
                name: "Rhythm Keys",
                program: 4,
                notes: keys,
            }, // Electric Piano 1
            DemoLayer {
                name: "Pad",
                program: 90,
                notes: pad,
            }, // Pad 3 (polysynth)
            DemoLayer {
                name: "Whistle Accent",
                program: 78,
                notes: whistle,
            }, // Whistle
            DemoLayer {
                name: "Bass",
                program: 38,
                notes: bass,
            }, // Synth Bass 1
        ],
        drums: four_bar_drums(),
    }
}

pub fn all_demo_songs() -> Vec<DemoSong> {
    vec![
        morning_loop(),
        night_drive(),
        sunset_stroll(),
        blue_corner(),
        corner_groove(),
        fireside_loop(),
        storybook_sky(),
        night_funk_signal(),
        west_coast_cruise(),
    ]
}

pub fn demo_song(index: usize) -> Option<DemoSong> {
    all_demo_songs().into_iter().nth(index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_demo_songs_have_several_layers_plus_drums() {
        assert_eq!(all_demo_songs().len(), 9);
        for song in all_demo_songs() {
            assert!(
                (4..=5).contains(&song.layers.len()),
                "{} should have 4 or 5 melodic layers",
                song.title
            );
            assert!(
                !song.drums.is_empty(),
                "{} should have a drum pattern",
                song.title
            );
        }
    }

    #[test]
    fn demo_song_by_index_matches_all_demo_songs() {
        let all = all_demo_songs();
        for (i, expected) in all.iter().enumerate() {
            assert_eq!(demo_song(i).unwrap().title, expected.title);
        }
        assert!(demo_song(99).is_none());
    }

    #[test]
    fn each_layer_and_the_drum_track_span_the_same_total_duration() {
        for song in all_demo_songs() {
            let drum_total: f32 = song.drums.iter().map(|n| n.duration_sec).sum();
            for layer in &song.layers {
                let layer_total: f32 = layer.notes.iter().map(|n| n.duration_sec).sum();
                assert!(
                    (layer_total - drum_total).abs() < 0.01,
                    "{}/{} duration {layer_total} != drums {drum_total}",
                    song.title,
                    layer.name
                );
            }
        }
    }
}
