import AVFoundation
import Foundation

@MainActor
final class AudioRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    /// Real input level, 0...1, refreshed from the recorder's own
    /// metering — drives the pulsing waveform UI so it reacts to actual
    /// voice, not a fake canned animation.
    @Published var currentLevel: Float = 0

    private var recorder: AVAudioRecorder?
    private var startedAt: Date?
    private var onFinished: ((URL, Double) -> Void)?
    private var meterTimer: Timer?

    func start() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default)
            try session.setActive(true)
            session.requestRecordPermission { [weak self] granted in
                guard granted else { return }
                Task { @MainActor in self?.beginRecording() }
            }
        } catch {
            print("Failed to configure audio session: \(error)")
        }
    }

    private func beginRecording() {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            recorder = try AVAudioRecorder(url: tempURL, settings: settings)
            recorder?.isMeteringEnabled = true
            recorder?.record()
            startedAt = Date()
            isRecording = true
            startMetering()
        } catch {
            print("Failed to start recording: \(error)")
        }
    }

    /// Stops recording and hands the temp file + duration to `completion`.
    func stop(completion: @escaping (URL, Double) -> Void) {
        guard let recorder, let startedAt else { return }
        recorder.stop()
        stopMetering()
        let duration = Date().timeIntervalSince(startedAt)
        isRecording = false
        self.recorder = nil
        completion(recorder.url, duration)
    }

    private func startMetering() {
        meterTimer?.invalidate()
        meterTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let recorder = self.recorder else { return }
                recorder.updateMeters()
                let db = recorder.averagePower(forChannel: 0)
                // Map dB (-160...0) to a 0...1 level with a noise floor
                // around typical room silence so the UI doesn't twitch.
                let normalized = (db + 50) / 50
                self.currentLevel = max(0, min(1, normalized))
            }
        }
    }

    private func stopMetering() {
        meterTimer?.invalidate()
        meterTimer = nil
        currentLevel = 0
    }
}
