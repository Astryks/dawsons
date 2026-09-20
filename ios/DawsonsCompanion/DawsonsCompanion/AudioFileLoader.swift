import AVFoundation
import Foundation

/// Decodes an audio file on disk into an in-memory PCM buffer — used
/// for both "Any Sound" uploads and turning a recorded voice note into
/// raw samples for pitch analysis.
enum AudioFileLoader {
    static func loadBuffer(from url: URL) -> AVAudioPCMBuffer? {
        guard let file = try? AVAudioFile(forReading: url) else { return nil }
        let format = file.processingFormat
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else { return nil }
        do {
            try file.read(into: buffer)
        } catch {
            print("Failed to read audio file \(url): \(error)")
            return nil
        }
        return buffer
    }

    /// Runs the autocorrelation pitch detector across a whole buffer in
    /// overlapping windows and returns the most common detected MIDI
    /// note — a simple but robust way to find "the note I sang" from a
    /// short recording without needing a live mic tap.
    static func dominantMIDINote(in buffer: AVAudioPCMBuffer) -> Int? {
        guard let channel = buffer.floatChannelData?[0] else { return nil }
        let sampleRate = buffer.format.sampleRate
        let windowSize = 2048
        let hop = 1024
        let frameCount = Int(buffer.frameLength)
        guard frameCount > windowSize else { return nil }

        var noteVotes: [Int: Int] = [:]
        var start = 0
        while start + windowSize <= frameCount {
            let window = Array(UnsafeBufferPointer(start: channel + start, count: windowSize))
            if let freq = PitchDetector.detectFrequency(samples: window, sampleRate: sampleRate) {
                let note = PitchDetector.midiNote(forFrequency: freq)
                noteVotes[note, default: 0] += 1
            }
            start += hop
        }
        return noteVotes.max(by: { $0.value < $1.value })?.key
    }
}
