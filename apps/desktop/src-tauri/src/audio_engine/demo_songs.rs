//! Three short, fully original demo compositions — shown as "example
//! songs" on the home screen so new users see a populated, layered
//! project immediately instead of an empty state.
//!
//! These are hand-authored here (standard chord progressions, like
//! C-G-Am-F, aren't copyrightable — only a specific melodic/lyrical
//! realization is, and these melodies are original), not transcriptions
//! of any existing song. See docs/UX_DESIGN.md for why real songs (e.g.
//! current commercial releases) are deliberately not used for this —
//! bundling a transcription of one into shipped demo content is a
//! meaningfully different (and real) copyright exposure than a user
//! analyzing their own copy of a song for personal use.

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

pub fn all_demo_songs() -> Vec<DemoSong> {
    vec![morning_loop(), night_drive(), sunset_stroll()]
}

pub fn demo_song(index: usize) -> Option<DemoSong> {
    all_demo_songs().into_iter().nth(index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_three_demo_songs_have_five_layers_including_drums() {
        for song in all_demo_songs() {
            assert_eq!(
                song.layers.len(),
                4,
                "{} should have 4 melodic layers",
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
