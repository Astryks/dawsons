import AVFoundation
import Foundation

/// Buffer-level audio editing utilities — reverse, trim/crop ("mask"),
/// format conversion, and offline pitch-shifting — used for both
/// uploaded "Any Sound" clips and recorded voice notes dropped onto a
/// timeline.
enum AudioEffects {
    /// Reverses a PCM buffer (returns a new buffer; the original is
    /// left untouched).
    static func reversed(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
        let format = buffer.format
        let frameCount = buffer.frameLength
        let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
        out.frameLength = frameCount
        let channels = Int(format.channelCount)
        for ch in 0..<channels {
            guard let src = buffer.floatChannelData?[ch], let dst = out.floatChannelData?[ch] else { continue }
            for i in 0..<Int(frameCount) {
                dst[i] = src[Int(frameCount) - 1 - i]
            }
        }
        return out
    }

    /// Crops ("masks out") everything outside `[startSec, endSec]`.
    static func trimmed(_ buffer: AVAudioPCMBuffer, startSec: Double, endSec: Double) -> AVAudioPCMBuffer? {
        let sampleRate = buffer.format.sampleRate
        let totalFrames = Int(buffer.frameLength)
        let startFrame = max(0, Int(startSec * sampleRate))
        let endFrame = min(totalFrames, Int(endSec * sampleRate))
        guard endFrame > startFrame else { return nil }
        let frameCount = AVAudioFrameCount(endFrame - startFrame)
        let out = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: frameCount)!
        out.frameLength = frameCount
        let channels = Int(buffer.format.channelCount)
        for ch in 0..<channels {
            guard let src = buffer.floatChannelData?[ch], let dst = out.floatChannelData?[ch] else { continue }
            for i in 0..<Int(frameCount) {
                dst[i] = src[startFrame + i]
            }
        }
        return out
    }

    /// Converts a buffer to a different format/sample rate/channel
    /// count so uploaded or recorded audio can sit on the same
    /// engine-format track lanes as synthesized clips.
    static func converted(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard buffer.format != format else { return buffer }
        guard let converter = AVAudioConverter(from: buffer.format, to: format) else { return nil }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let outCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: outCapacity) else { return nil }

        var consumed = false
        var conversionError: NSError?
        let status = converter.convert(to: outBuffer, error: &conversionError) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return buffer
        }
        guard status != .error else {
            print("Audio conversion failed: \(conversionError?.localizedDescription ?? "unknown")")
            return nil
        }
        return outBuffer
    }

    /// Renders a buffer through `AVAudioUnitTimePitch` offline, shifting
    /// pitch by `semitones` (positive = up, negative = down) without
    /// changing playback speed.
    static func pitchShifted(_ buffer: AVAudioPCMBuffer, semitones: Double) -> AVAudioPCMBuffer? {
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        let timePitch = AVAudioUnitTimePitch()
        timePitch.pitch = Float(semitones * 100) // cents

        engine.attach(player)
        engine.attach(timePitch)
        engine.connect(player, to: timePitch, format: buffer.format)
        engine.connect(timePitch, to: engine.mainMixerNode, format: buffer.format)

        do {
            try engine.enableManualRenderingMode(.offline, format: buffer.format, maximumFrameCount: 4096)
            try engine.start()
        } catch {
            print("Failed to prepare offline pitch-shift engine: \(error)")
            return nil
        }

        player.scheduleBuffer(buffer, at: nil)
        player.play()

        let outputFrameCapacity = buffer.frameLength + AVAudioFrameCount(buffer.format.sampleRate)
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: outputFrameCapacity) else {
            return nil
        }

        var collected: AVAudioFrameCount = 0
        while collected < outputFrameCapacity {
            let framesToRender = min(4096, outputFrameCapacity - collected)
            guard let tempBuffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: framesToRender) else { break }
            guard let status = try? engine.renderOffline(framesToRender, to: tempBuffer), status == .success else { break }
            append(tempBuffer, into: outBuffer, at: collected)
            collected += tempBuffer.frameLength
            if tempBuffer.frameLength == 0 { break }
        }
        outBuffer.frameLength = collected
        engine.stop()
        return outBuffer
    }

    private static func append(_ source: AVAudioPCMBuffer, into destination: AVAudioPCMBuffer, at offset: AVAudioFrameCount) {
        let channels = Int(source.format.channelCount)
        for ch in 0..<channels {
            guard let src = source.floatChannelData?[ch], let dst = destination.floatChannelData?[ch] else { continue }
            for i in 0..<Int(source.frameLength) {
                dst[Int(offset) + i] = src[i]
            }
        }
    }
}
