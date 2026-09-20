import AVFoundation
import Foundation

/// Autocorrelation pitch detection: a Swift port of the browser's
/// (bug-fixed) detectPitchInFrame in website/js/pitch.js. A naive
/// global-max lag search picks octave/subharmonic errors — a longer
/// lag can numerically out-correlate the true fundamental when the
/// real period isn't an exact integer number of samples. The fix is to
/// take the FIRST local peak above a threshold, then refine it with
/// parabolic interpolation for sub-sample accuracy.
enum PitchDetector {
    /// Detects the fundamental frequency of a mono frame, or nil if the
    /// signal is too quiet / has no clear periodicity.
    static func detectFrequency(samples: [Float], sampleRate: Double) -> Double? {
        let n = samples.count
        guard n > 0 else { return nil }

        var rms: Double = 0
        for s in samples { rms += Double(s) * Double(s) }
        rms = (rms / Double(n)).squareRoot()
        guard rms > 0.01 else { return nil }

        let minLag = Int(sampleRate / 1000.0)  // ~1000 Hz ceiling
        let maxLag = min(n - 1, Int(sampleRate / 60.0))  // ~60 Hz floor
        guard maxLag > minLag + 2 else { return nil }

        var correlations = [Double](repeating: 0, count: maxLag + 1)
        for lag in minLag...maxLag {
            var sum: Double = 0
            let count = n - lag
            for i in 0..<count {
                sum += Double(samples[i]) * Double(samples[i + lag])
            }
            correlations[lag] = sum / Double(count)
        }

        guard let zeroLag = correlations[minLag...maxLag].max(), zeroLag > 0 else { return nil }
        let threshold = zeroLag * 0.5

        var bestLag: Int?
        for lag in (minLag + 1)..<maxLag {
            let c = correlations[lag]
            guard c >= threshold else { continue }
            if c >= correlations[lag - 1] && c >= correlations[lag + 1] {
                bestLag = lag
                break
            }
        }

        guard let lag = bestLag else { return nil }
        let refined = refineLag(lag: lag, correlations: correlations)
        guard refined > 0 else { return nil }
        return sampleRate / refined
    }

    /// Parabolic interpolation around the discrete peak for sub-sample
    /// lag accuracy — the same technique used in the Rust YIN
    /// implementation (audio_engine's pitch tracker).
    private static func refineLag(lag: Int, correlations: [Double]) -> Double {
        guard lag > 0, lag < correlations.count - 1 else { return Double(lag) }
        let y0 = correlations[lag - 1]
        let y1 = correlations[lag]
        let y2 = correlations[lag + 1]
        let denom = y0 - 2 * y1 + y2
        guard abs(denom) > 1e-12 else { return Double(lag) }
        let offset = 0.5 * (y0 - y2) / denom
        return Double(lag) + offset
    }

    /// Converts a frequency to the nearest MIDI note number.
    static func midiNote(forFrequency freq: Double) -> Int {
        Int((69.0 + 12.0 * log2(freq / 440.0)).rounded())
    }
}

/// Runs pitch detection live against the microphone via an AVAudioEngine
/// tap, publishing the most recently detected MIDI note — the core of
/// "sing anything, turn it into any instrument".
@MainActor
final class LivePitchTracker: ObservableObject {
    @Published var currentMIDINote: Int?
    @Published var isListening = false

    private let engine = AVAudioEngine()

    func start() {
        guard !isListening else { return }
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            guard let channel = buffer.floatChannelData?[0] else { return }
            let frameLength = Int(buffer.frameLength)
            let samples = Array(UnsafeBufferPointer(start: channel, count: frameLength))
            let freq = PitchDetector.detectFrequency(samples: samples, sampleRate: format.sampleRate)
            Task { @MainActor in
                self?.currentMIDINote = freq.map(PitchDetector.midiNote(forFrequency:))
            }
        }
        do {
            try engine.start()
            isListening = true
        } catch {
            print("Failed to start pitch tracker engine: \(error)")
        }
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isListening = false
        currentMIDINote = nil
    }
}
