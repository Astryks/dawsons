import Foundation

/// A single placed hit in a pattern-backed track — "tap anywhere on the
/// timeline to drop a sound", mirroring the browser's click-to-place
/// pattern editor (website/js/pattern-editor.js).
struct PatternHit: Identifiable, Codable, Equatable {
    let id: UUID
    var step: Int
    /// Drum sound name for `.drums` tracks, or a scale-degree token
    /// ("root"/"third"/"fifth"/"octave") for melodic tracks.
    var sound: String

    init(id: UUID = UUID(), step: Int, sound: String) {
        self.id = id
        self.step = step
        self.sound = sound
    }
}

enum MelodicDegree: String, CaseIterable, Identifiable {
    case root, third, fifth, octave
    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }

    /// Semitone offset from the track's root MIDI note.
    var semitoneOffset: Int {
        switch self {
        case .root: return 0
        case .third: return 4
        case .fifth: return 7
        case .octave: return 12
        }
    }
}

/// Eighth-note grid, matching STEP_SEC/STEPS_PER_BEAT in the browser app.
enum Grid {
    static let stepSec: Double = 0.25
    static let stepsPerBeat: Int = 2
}

/// The palette offered in the "tap here" sound picker for a track,
/// keyed by instrument family.
enum PatternPalette {
    static func sounds(for family: InstrumentFamily) -> [String] {
        if family == .drums {
            return DrumSound.allCases.map(\.rawValue)
        }
        return MelodicDegree.allCases.map(\.rawValue)
    }
}
