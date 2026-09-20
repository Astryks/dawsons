import AVFoundation
import Foundation

@MainActor
final class AudioRecorder: NSObject, ObservableObject {
    @Published var isRecording = false

    private var recorder: AVAudioRecorder?
    private var startedAt: Date?
    private var onFinished: ((URL, Double) -> Void)?

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
            recorder?.record()
            startedAt = Date()
            isRecording = true
        } catch {
            print("Failed to start recording: \(error)")
        }
    }

    /// Stops recording and hands the temp file + duration to `completion`.
    func stop(completion: @escaping (URL, Double) -> Void) {
        guard let recorder, let startedAt else { return }
        recorder.stop()
        let duration = Date().timeIntervalSince(startedAt)
        isRecording = false
        self.recorder = nil
        completion(recorder.url, duration)
    }
}
