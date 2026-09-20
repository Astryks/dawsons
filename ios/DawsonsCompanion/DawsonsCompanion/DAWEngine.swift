import AVFoundation
import Foundation
import QuartzCore

/// A rule-based genre reshape: real tempo change + a real drum-pattern
/// swap, built from patterns already used elsewhere in the app (the
/// browser's `neonPulse` four-on-the-floor and a swung jazz feel) —
/// not a trained model, and not claimed to be one.
struct GenreRestyle {
    let name: String
    let bpm: Double
    /// (step, drum sound) pairs on the existing 8th-note grid.
    let drumPattern: [(Int, String)]

    static let electronic = GenreRestyle(
        name: "Electronic",
        bpm: 128,
        drumPattern: [
            (0, "kick"), (2, "kick"), (4, "kick"), (6, "kick"),
            (1, "hihat"), (3, "hihat"), (5, "hihat"), (7, "hihat"),
            (4, "clap"),
        ]
    )

    static let jazz = GenreRestyle(
        name: "Jazzy",
        bpm: 92,
        drumPattern: [
            (0, "kick"), (3, "snare"), (4, "kick"), (7, "snare"),
            (1, "hihat"), (5, "hihat"),
        ]
    )
}

/// A single audio region placed on a track's timeline — either
/// generated from a pattern (drum/melodic taps) or an uploaded/recorded
/// clip. `startSec` supports drag-to-reposition; the buffer itself may
/// already be trimmed/reversed/pitch-shifted by `AudioEffects`.
struct Clip: Identifiable {
    let id: UUID
    var buffer: AVAudioPCMBuffer
    var startSec: Double

    var durationSec: Double {
        Double(buffer.frameLength) / buffer.format.sampleRate
    }

    init(id: UUID = UUID(), buffer: AVAudioPCMBuffer, startSec: Double) {
        self.id = id
        self.buffer = buffer
        self.startSec = startSec
    }
}

/// One instrument lane. Multiple tracks can share the same family
/// (e.g. two guitar tracks) — "add as many timelines as you need".
final class DAWTrack: ObservableObject, Identifiable {
    let id = UUID()
    @Published var name: String
    @Published var family: InstrumentFamily
    @Published var clips: [Clip] = []
    @Published var hits: [PatternHit] = []
    @Published var rootMIDINote: Int
    @Published var volume: Float = 0.9
    @Published var pan: Float = 0
    @Published var muted = false
    @Published var solo = false

    let playerNode = AVAudioPlayerNode()
    let pitchNode = AVAudioUnitTimePitch()

    init(name: String, family: InstrumentFamily, rootMIDINote: Int = 60) {
        self.name = name
        self.family = family
        self.rootMIDINote = rootMIDINote
    }

    /// Rebuilds `clips` for a pattern-backed track from its `hits`,
    /// synthesizing each hit fresh — the native equivalent of the
    /// browser's re-render-on-every-edit pattern editor.
    func regenerateClipsFromPattern() {
        clips = hits.map { hit in
            let startSec = Double(hit.step) * Grid.stepSec
            let buffer: AVAudioPCMBuffer
            if family == .drums, let sound = DrumSound(rawValue: hit.sound) {
                buffer = Synth.renderDrumHit(sound: sound)
            } else if let degree = MelodicDegree(rawValue: hit.sound) {
                let note = rootMIDINote + degree.semitoneOffset
                buffer = Synth.renderNote(family: family, midiNote: note, durationSec: Grid.stepSec * 0.9)
            } else {
                buffer = Synth.renderNote(family: family, midiNote: rootMIDINote, durationSec: Grid.stepSec * 0.9)
            }
            return Clip(buffer: buffer, startSec: startSec)
        }
    }

    /// Tap-to-place / tap-again-to-remove a hit at a given step.
    func toggleHit(step: Int, sound: String) {
        if let index = hits.firstIndex(where: { $0.step == step }) {
            if hits[index].sound == sound {
                hits.remove(at: index)
            } else {
                hits[index].sound = sound
            }
        } else {
            hits.append(PatternHit(step: step, sound: sound))
        }
        regenerateClipsFromPattern()
    }

    /// Adds an uploaded/recorded audio clip (already converted to the
    /// engine's track format) at a draggable timeline position.
    func addAudioClip(_ buffer: AVAudioPCMBuffer, startSec: Double) {
        clips.append(Clip(buffer: buffer, startSec: startSec))
    }

    func moveClip(id: UUID, toStartSec startSec: Double) {
        guard let index = clips.firstIndex(where: { $0.id == id }) else { return }
        clips[index].startSec = max(0, startSec)
    }

    func replaceClipBuffer(id: UUID, with buffer: AVAudioPCMBuffer) {
        guard let index = clips.firstIndex(where: { $0.id == id }) else { return }
        clips[index].buffer = buffer
    }
}

/// Native multi-track playback engine — the iOS equivalent of the
/// browser's Web Audio engine and the desktop's cpal engine. One
/// AVAudioPlayerNode (+ per-track AVAudioUnitTimePitch, for future
/// per-track pitch/restyle effects) feeds a shared AVAudioEngine mixer.
@MainActor
final class DAWEngine: ObservableObject {
    @Published var tracks: [DAWTrack] = []
    @Published var isPlaying = false
    @Published var playheadSec: Double = 0
    @Published var bpm: Double = 100

    static let trackFormat = AVAudioFormat(standardFormatWithSampleRate: Synth.sampleRate, channels: 1)!

    private let engine = AVAudioEngine()
    private var displayTimer: Timer?
    private var playStartHostTime: Double = 0
    private var playStartOffsetSec: Double = 0

    init() {
        setupDefaultTracks()
    }

    private func setupDefaultTracks() {
        let defaults: [(String, InstrumentFamily, Int)] = [
            ("Drums", .drums, 60),
            ("Keys", .keys, 60),
            ("Guitar", .guitar, 52),
            ("Bass", .bass, 40),
        ]
        for (name, family, root) in defaults {
            addTrack(name: name, family: family, rootMIDINote: root)
        }
    }

    @discardableResult
    func addTrack(name: String, family: InstrumentFamily, rootMIDINote: Int = 60) -> DAWTrack {
        let track = DAWTrack(name: name, family: family, rootMIDINote: rootMIDINote)
        engine.attach(track.playerNode)
        engine.attach(track.pitchNode)
        engine.connect(track.playerNode, to: track.pitchNode, format: Self.trackFormat)
        engine.connect(track.pitchNode, to: engine.mainMixerNode, format: Self.trackFormat)
        tracks.append(track)
        return track
    }

    func removeTrack(_ track: DAWTrack) {
        engine.disconnectNodeInput(track.pitchNode)
        engine.disconnectNodeInput(track.playerNode)
        engine.detach(track.pitchNode)
        engine.detach(track.playerNode)
        tracks.removeAll { $0.id == track.id }
    }

    func addAudioClip(to track: DAWTrack, buffer: AVAudioPCMBuffer, startSec: Double) {
        let matched = AudioEffects.converted(buffer, to: Self.trackFormat) ?? buffer
        track.addAudioClip(matched, startSec: startSec)
    }

    var totalDurationSec: Double {
        tracks.flatMap(\.clips).map { $0.startSec + $0.durationSec }.max() ?? 0
    }

    func play(fromSec: Double? = nil) {
        let startAt = fromSec ?? playheadSec
        stopEngineIfNeeded()

        do {
            try engine.start()
        } catch {
            print("Failed to start DAW engine: \(error)")
            return
        }

        let anySoloed = tracks.contains { $0.solo }
        for track in tracks {
            let audible = !track.muted && (!anySoloed || track.solo)
            track.playerNode.volume = audible ? track.volume : 0
            track.playerNode.pan = track.pan
            for clip in track.clips {
                let relativeStart = clip.startSec - startAt
                guard relativeStart + clip.durationSec > 0 else { continue }
                let when: AVAudioTime? = relativeStart > 0
                    ? AVAudioTime(sampleTime: AVAudioFramePosition(relativeStart * clip.buffer.format.sampleRate), atRate: clip.buffer.format.sampleRate)
                    : nil
                track.playerNode.scheduleBuffer(clip.buffer, at: when)
            }
            track.playerNode.play()
        }

        playStartOffsetSec = startAt
        playStartHostTime = CACurrentMediaTime()
        isPlaying = true
        startDisplayTimer()
    }

    func pause() {
        playheadSec = currentPlaybackPositionSec()
        stopEngineIfNeeded()
        isPlaying = false
        displayTimer?.invalidate()
    }

    func stop() {
        pause()
        playheadSec = 0
    }

    func seek(toSec sec: Double) {
        let wasPlaying = isPlaying
        playheadSec = max(0, sec)
        if wasPlaying {
            play(fromSec: playheadSec)
        }
    }

    private func currentPlaybackPositionSec() -> Double {
        guard isPlaying else { return playheadSec }
        return playStartOffsetSec + (CACurrentMediaTime() - playStartHostTime)
    }

    private func stopEngineIfNeeded() {
        for track in tracks {
            track.playerNode.stop()
        }
        if engine.isRunning {
            engine.stop()
        }
    }

    /// Rule-based "restyle": genuine AI audio style-transfer needs
    /// cloud-scale compute we don't depend on, so instead this reshapes
    /// the song using data we already have — tempo and the drum
    /// pattern already on the grid — into a recognizably different
    /// genre feel. Honest about what it is: pattern/tempo reshaping,
    /// not a trained model.
    func applyRestyle(_ style: GenreRestyle) {
        bpm = style.bpm
        guard let drums = tracks.first(where: { $0.family == .drums }) else { return }
        drums.hits = style.drumPattern.map { PatternHit(step: $0.0, sound: $0.1) }
        drums.regenerateClipsFromPattern()
    }

    private func startDisplayTimer() {
        displayTimer?.invalidate()
        displayTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isPlaying else { return }
                self.playheadSec = self.currentPlaybackPositionSec()
                if self.totalDurationSec > 0, self.playheadSec >= self.totalDurationSec {
                    self.stop()
                }
            }
        }
    }
}
