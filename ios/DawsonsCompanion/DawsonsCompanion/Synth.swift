import AVFoundation
import Foundation

/// Instrument families available on any timeline track. Mirrors the
/// browser DAW's family set (website/js/demo-songs.js) so the mental
/// model stays consistent across platforms.
enum InstrumentFamily: String, CaseIterable, Codable, Identifiable {
    case drums, keys, guitar, bass, lead, pad, brass, bell, flute, saxophone, clarinet, voice, anySound

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .drums: return "Drums"
        case .keys: return "Piano"
        case .guitar: return "Guitar"
        case .bass: return "Bass"
        case .lead: return "Lead Synth"
        case .pad: return "Pad"
        case .brass: return "Brass"
        case .bell: return "Bell"
        case .flute: return "Flute"
        case .saxophone: return "Saxophone"
        case .clarinet: return "Clarinet"
        case .voice: return "Voice"
        case .anySound: return "Any Sound"
        }
    }

    /// A distinct pastel hue per family, matching the web app's palette
    /// so the two DAWs feel like the same product despite the native UI.
    var colorHex: UInt32 {
        switch self {
        case .drums: return 0xFFB4A2
        case .keys: return 0xC9B6E4
        case .guitar: return 0xA7D8C9
        case .bass: return 0xF6C6D0
        case .lead: return 0xA8D0E6
        case .pad: return 0xFFE0A3
        case .brass: return 0xE3B7A0
        case .bell: return 0xB9E0D4
        case .flute: return 0xD6C9F0
        case .saxophone: return 0xF3B7C2
        case .clarinet: return 0xB7CDE0
        case .voice: return 0xFAD6A5
        case .anySound: return 0xCDE0D0
        }
    }
}

enum DrumSound: String, CaseIterable, Codable, Identifiable {
    case kick, snare, hihat, clap
    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }
}

private enum OscShape {
    case sine, sawtooth, square, triangle
}

private struct VoiceShape {
    let osc: OscShape
    let attack: Double
    let decay: Double
    let sustain: Double
    let release: Double
    let brightness: Double
}

/// Renders instrument notes directly into PCM buffers using simple
/// oscillator synthesis — no bundled soundfonts or sample libraries,
/// the same "generate everything" approach as the browser's synth.js
/// and desktop's synth.rs.
enum Synth {
    static let sampleRate: Double = 44100

    private static let shapes: [InstrumentFamily: VoiceShape] = [
        .keys: VoiceShape(osc: .triangle, attack: 0.005, decay: 0.25, sustain: 0.4, release: 0.3, brightness: 0.6),
        .guitar: VoiceShape(osc: .sawtooth, attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.25, brightness: 0.5),
        .bass: VoiceShape(osc: .sine, attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2, brightness: 0.3),
        .lead: VoiceShape(osc: .sawtooth, attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.2, brightness: 0.8),
        .pad: VoiceShape(osc: .triangle, attack: 0.4, decay: 0.3, sustain: 0.8, release: 0.8, brightness: 0.4),
        .brass: VoiceShape(osc: .sawtooth, attack: 0.05, decay: 0.1, sustain: 0.7, release: 0.15, brightness: 0.7),
        .bell: VoiceShape(osc: .sine, attack: 0.001, decay: 0.6, sustain: 0.2, release: 0.8, brightness: 0.9),
        .flute: VoiceShape(osc: .sine, attack: 0.08, decay: 0.1, sustain: 0.7, release: 0.2, brightness: 0.5),
        .saxophone: VoiceShape(osc: .sawtooth, attack: 0.06, decay: 0.1, sustain: 0.7, release: 0.2, brightness: 0.6),
        .clarinet: VoiceShape(osc: .square, attack: 0.05, decay: 0.1, sustain: 0.7, release: 0.2, brightness: 0.4),
        .voice: VoiceShape(osc: .triangle, attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.25, brightness: 0.55),
    ]

    static func frequency(forMIDI note: Int) -> Double {
        440.0 * pow(2.0, (Double(note) - 69.0) / 12.0)
    }

    /// Renders a single melodic note as a mono PCM buffer.
    static func renderNote(family: InstrumentFamily, midiNote: Int, durationSec: Double, velocity: Double = 0.9) -> AVAudioPCMBuffer {
        let shape = shapes[family] ?? shapes[.keys]!
        let freq = frequency(forMIDI: midiNote)
        let totalSec = durationSec + shape.release
        let frameCount = AVAudioFrameCount(max(1, totalSec * sampleRate))
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
        buffer.frameLength = frameCount
        let data = buffer.floatChannelData![0]

        var phase = 0.0
        let phaseInc = freq / sampleRate

        for i in 0..<Int(frameCount) {
            let t = Double(i) / sampleRate
            let env = envelope(t: t, noteDur: durationSec, shape: shape)
            let raw = oscillate(shape: shape.osc, phase: phase, brightness: shape.brightness)
            data[i] = Float(raw * env * velocity)
            phase += phaseInc
            if phase >= 1 { phase -= 1 }
        }
        return buffer
    }

    /// Renders one hit of a drum voice, matching the browser pattern
    /// editor's drum palette (kick/snare/hihat/clap).
    static func renderDrumHit(sound: DrumSound, velocity: Double = 0.9) -> AVAudioPCMBuffer {
        let durationSec: Double
        switch sound {
        case .kick: durationSec = 0.28
        case .snare: durationSec = 0.2
        case .hihat: durationSec = 0.08
        case .clap: durationSec = 0.18
        }
        let frameCount = AVAudioFrameCount(durationSec * sampleRate)
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
        buffer.frameLength = frameCount
        let data = buffer.floatChannelData![0]

        var rngState: UInt64 = 0x9E37_79B9_7F4A_7C15
        func nextNoise() -> Double {
            rngState = rngState &* 6364136223846793005 &+ 1
            return (Double(rngState >> 11) / Double(1 << 53)) * 2 - 1
        }

        for i in 0..<Int(frameCount) {
            let t = Double(i) / sampleRate
            let progress = t / durationSec
            var sample = 0.0
            switch sound {
            case .kick:
                let freq = 120.0 * exp(-t * 18)
                sample = sin(2 * .pi * freq * t)
            case .snare:
                sample = nextNoise() * 0.6 + sin(2 * .pi * 180 * t) * 0.4
            case .hihat:
                sample = nextNoise()
            case .clap:
                sample = nextNoise() * (progress < 0.5 ? 1.0 : 0.6)
            }
            let env = pow(1.0 - progress, 2.0)
            data[i] = Float(sample * env * velocity)
        }
        return buffer
    }

    private static func envelope(t: Double, noteDur: Double, shape: VoiceShape) -> Double {
        if t < shape.attack {
            return t / max(shape.attack, 0.0001)
        }
        let sinceAttack = t - shape.attack
        if sinceAttack < shape.decay {
            let d = sinceAttack / max(shape.decay, 0.0001)
            return 1.0 - d * (1.0 - shape.sustain)
        }
        if t < noteDur {
            return shape.sustain
        }
        let sinceRelease = t - noteDur
        if sinceRelease < shape.release {
            return shape.sustain * (1.0 - sinceRelease / shape.release)
        }
        return 0.0
    }

    private static func oscillate(shape: OscShape, phase: Double, brightness: Double) -> Double {
        switch shape {
        case .sine:
            return sin(2 * .pi * phase)
        case .sawtooth:
            let base = 2 * (phase - floor(phase + 0.5))
            return base * (0.6 + brightness * 0.4)
        case .square:
            return (phase < 0.5 ? 1.0 : -1.0) * (0.5 + brightness * 0.3)
        case .triangle:
            return 2 * abs(2 * (phase - floor(phase + 0.5))) - 1
        }
    }
}
