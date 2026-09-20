import AVFoundation
import SwiftUI
import UniformTypeIdentifiers

/// The native mobile DAW screen. Deliberately not a port of the
/// browser's waveform-preview layout — a bottom-anchored transport,
/// a compact fixed-header timeline, and full-screen sheets for
/// recording/uploading are the mobile-native idiom (one-handed reach,
/// no hover states, big tap targets).
struct DAWView: View {
    @StateObject private var engine = DAWEngine()
    @StateObject private var recorder = AudioRecorder()
    @State private var selectedClipID: UUID?
    @State private var selectedTrackID: UUID?
    @State private var pickerTrack: DAWTrack?
    @State private var pickerStep: Int?
    @State private var showingRecordSheet = false
    @State private var showingAddTrackSheet = false
    @State private var showingFileImporter = false
    @State private var statusMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TimelineView(
                    engine: engine,
                    selectedClipID: $selectedClipID,
                    selectedTrackID: $selectedTrackID,
                    onTapStep: { track, step in
                        pickerTrack = track
                        pickerStep = step
                    }
                )

                if let message = statusMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal)
                        .padding(.top, 4)
                }

                if let clip = selectedClip {
                    ClipToolbar(
                        onReverse: { applyReverse(clipID: clip.id, track: selectedTrack) },
                        onPitchDown: { applyPitch(clipID: clip.id, track: selectedTrack, semitones: -2) },
                        onPitchUp: { applyPitch(clipID: clip.id, track: selectedTrack, semitones: 2) },
                        onCrop: { cropSelectedClip() }
                    )
                }

                RestyleBar(onElectronic: { engine.applyRestyle(.electronic) }, onJazz: { engine.applyRestyle(.jazz) })

                TransportBar(engine: engine)

                BottomActionBar(
                    onRecord: { showingRecordSheet = true },
                    onAddTrack: { showingAddTrackSheet = true },
                    onUpload: { showingFileImporter = true }
                )
            }
            .navigationTitle("Dawsons DAW")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $pickerTrack) { track in
                if let step = pickerStep {
                    SoundPickerSheet(track: track, step: step) {
                        pickerTrack = nil
                        pickerStep = nil
                    }
                }
            }
            .sheet(isPresented: $showingRecordSheet) {
                RecordToInstrumentSheet(recorder: recorder) { buffer, midiNote in
                    addRecordedNote(buffer: buffer, midiNote: midiNote)
                    showingRecordSheet = false
                }
            }
            .sheet(isPresented: $showingAddTrackSheet) {
                AddTrackSheet { family in
                    engine.addTrack(name: family.displayName, family: family)
                    showingAddTrackSheet = false
                }
            }
            .fileImporter(isPresented: $showingFileImporter, allowedContentTypes: [.audio]) { result in
                handleFileImport(result)
            }
        }
    }

    private var selectedTrack: DAWTrack? {
        engine.tracks.first { $0.id == selectedTrackID }
    }

    private var selectedClip: Clip? {
        selectedTrack?.clips.first { $0.id == selectedClipID }
    }

    private func applyReverse(clipID: UUID?, track: DAWTrack?) {
        guard let clipID, let track, let clip = track.clips.first(where: { $0.id == clipID }) else { return }
        track.replaceClipBuffer(id: clipID, with: AudioEffects.reversed(clip.buffer))
        statusMessage = "Reversed clip on \(track.name)"
    }

    private func applyPitch(clipID: UUID?, track: DAWTrack?, semitones: Double) {
        guard let clipID, let track, let clip = track.clips.first(where: { $0.id == clipID }) else { return }
        guard let shifted = AudioEffects.pitchShifted(clip.buffer, semitones: semitones) else { return }
        track.replaceClipBuffer(id: clipID, with: shifted)
        statusMessage = "Pitch-shifted clip on \(track.name)"
    }

    private func cropSelectedClip() {
        guard let track = selectedTrack, let clip = selectedClip else { return }
        let duration = clip.durationSec
        guard duration > 0.4 else { return }
        // A quick "trim 10% off each end" crop; a production build would
        // present drag handles — kept as a one-tap action here.
        guard let cropped = AudioEffects.trimmed(clip.buffer, startSec: duration * 0.1, endSec: duration * 0.9) else { return }
        track.replaceClipBuffer(id: clip.id, with: cropped)
        statusMessage = "Cropped clip on \(track.name)"
    }

    private func addRecordedNote(buffer: AVAudioPCMBuffer, midiNote: Int) {
        guard let track = selectedTrack ?? engine.tracks.first else { return }
        let converted = AudioEffects.converted(buffer, to: DAWEngine.trackFormat) ?? buffer
        engine.addAudioClip(to: track, buffer: converted, startSec: engine.playheadSec)
        statusMessage = "Added your recording to \(track.name)"
    }

    private func handleFileImport(_ result: Result<URL, Error>) {
        guard case .success(let url) = result else { return }
        let needsSecurityScope = url.startAccessingSecurityScopedResource()
        defer { if needsSecurityScope { url.stopAccessingSecurityScopedResource() } }
        guard let buffer = AudioFileLoader.loadBuffer(from: url) else {
            statusMessage = "Couldn't read that audio file"
            return
        }
        let track = engine.tracks.first(where: { $0.family == .anySound }) ?? engine.addTrack(name: "Any Sound", family: .anySound)
        engine.addAudioClip(to: track, buffer: buffer, startSec: engine.playheadSec)
        statusMessage = "Added \(url.lastPathComponent) to Any Sound"
    }
}

private struct TransportBar: View {
    @ObservedObject var engine: DAWEngine

    var body: some View {
        HStack(spacing: 20) {
            Button {
                if engine.isPlaying { engine.pause() } else { engine.play() }
            } label: {
                Image(systemName: engine.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 40))
            }
            Button { engine.stop() } label: {
                Image(systemName: "stop.circle.fill").font(.system(size: 32))
            }
            Text(timeString(engine.playheadSec))
                .font(.system(.body, design: .monospaced))
            Spacer()
            Text("\(Int(engine.bpm)) BPM")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private func timeString(_ seconds: Double) -> String {
        let m = Int(seconds) / 60
        let s = Int(seconds) % 60
        return String(format: "%d:%02d", m, s)
    }
}

private struct RestyleBar: View {
    let onElectronic: () -> Void
    let onJazz: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text("Restyle:")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button(action: onElectronic) { Label("Electronic", systemImage: "bolt.fill") }
                .font(.caption).buttonStyle(.bordered)
            Button(action: onJazz) { Label("Jazzy", systemImage: "music.quarternote.3") }
                .font(.caption).buttonStyle(.bordered)
        }
        .padding(.horizontal)
    }
}

private struct ClipToolbar: View {
    let onReverse: () -> Void
    let onPitchDown: () -> Void
    let onPitchUp: () -> Void
    let onCrop: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button(action: onReverse) { Label("Reverse", systemImage: "arrow.left.arrow.right") }
            Button(action: onPitchDown) { Image(systemName: "arrow.down") }
            Button(action: onPitchUp) { Image(systemName: "arrow.up") }
            Button(action: onCrop) { Label("Crop", systemImage: "crop") }
        }
        .font(.caption)
        .buttonStyle(.bordered)
        .padding(.horizontal)
        .padding(.top, 4)
    }
}

private struct BottomActionBar: View {
    let onRecord: () -> Void
    let onAddTrack: () -> Void
    let onUpload: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onRecord) {
                Label("Sing / Record", systemImage: "mic.fill")
            }
            .buttonStyle(.borderedProminent)

            Button(action: onUpload) {
                Label("Any Sound", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.bordered)

            Button(action: onAddTrack) {
                Label("Track", systemImage: "plus")
            }
            .buttonStyle(.bordered)
        }
        .font(.footnote)
        .padding()
    }
}

/// The tap-anywhere sound picker — mirrors the browser's "touch any
/// point on any instrument's timeline and its dropdown opens" flow.
private struct SoundPickerSheet: View {
    @ObservedObject var track: DAWTrack
    let step: Int
    let onDone: () -> Void

    var body: some View {
        NavigationStack {
            List(PatternPalette.sounds(for: track.family), id: \.self) { sound in
                Button {
                    track.toggleHit(step: step, sound: sound)
                    onDone()
                } label: {
                    HStack {
                        Circle().fill(color(fromHex: track.family.colorHex)).frame(width: 14, height: 14)
                        Text(sound.capitalized)
                    }
                }
            }
            .navigationTitle("\(track.name) · step \(step)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", action: onDone)
                }
            }
        }
    }
}

private struct AddTrackSheet: View {
    let onPick: (InstrumentFamily) -> Void

    var body: some View {
        NavigationStack {
            List(InstrumentFamily.allCases) { family in
                Button {
                    onPick(family)
                } label: {
                    HStack {
                        Circle().fill(color(fromHex: family.colorHex)).frame(width: 14, height: 14)
                        Text(family.displayName)
                    }
                }
            }
            .navigationTitle("Add instrument")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Record → detect pitch → pick a target instrument. The engaging,
/// reactive-waveform recording UI (real mic level, not a canned
/// animation) that makes recording feel alive, the way Vochlea/Suno's
/// recording screens do.
private struct RecordToInstrumentSheet: View {
    @ObservedObject var recorder: AudioRecorder
    let onFinished: (AVAudioPCMBuffer, Int) -> Void

    @State private var detectedNote: Int?
    @State private var recordedBuffer: AVAudioPCMBuffer?
    @State private var selectedFamily: InstrumentFamily = .keys

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                PulsingWaveformView(level: recorder.currentLevel, isActive: recorder.isRecording)
                    .frame(height: 120)
                    .padding(.horizontal)

                Button {
                    if recorder.isRecording {
                        recorder.stop { url, _ in
                            guard let buffer = AudioFileLoader.loadBuffer(from: url) else { return }
                            recordedBuffer = buffer
                            detectedNote = AudioFileLoader.dominantMIDINote(in: buffer)
                        }
                    } else {
                        detectedNote = nil
                        recordedBuffer = nil
                        recorder.start()
                    }
                } label: {
                    Text(recorder.isRecording ? "Stop" : "Sing or hum")
                        .font(.title3.bold())
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(recorder.isRecording ? Color.red : Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .padding(.horizontal)

                if let note = detectedNote {
                    Text("Detected note: \(noteName(note))")
                        .font(.headline)

                    Picker("Turn it into", selection: $selectedFamily) {
                        ForEach(InstrumentFamily.allCases) { family in
                            Text(family.displayName).tag(family)
                        }
                    }
                    .pickerStyle(.menu)

                    Button("Add to timeline as \(selectedFamily.displayName)") {
                        let rendered = Synth.renderNote(family: selectedFamily, midiNote: note, durationSec: 1.0)
                        onFinished(rendered, note)
                    }
                    .buttonStyle(.borderedProminent)
                } else if recordedBuffer != nil {
                    Text("Couldn't detect a clear pitch — try humming a single steady note.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding(.top, 24)
            .navigationTitle("Sing → Instrument")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func noteName(_ midi: Int) -> String {
        let names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        let octave = midi / 12 - 1
        return "\(names[midi % 12])\(octave)"
    }
}

/// A row of bars that pulse red in real time with the mic's actual
/// input level while recording — the "blinking sound waves" engagement
/// cue, driven by genuine `AVAudioRecorder` metering, not a fake timer.
private struct PulsingWaveformView: View {
    let level: Float
    let isActive: Bool

    private let barCount = 24

    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .center, spacing: 4) {
                ForEach(0..<barCount, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(isActive ? Color.red : Color.gray.opacity(0.3))
                        .frame(height: barHeight(for: i, totalHeight: geo.size.height))
                        .animation(.easeOut(duration: 0.08), value: level)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .center)
        }
    }

    private func barHeight(for index: Int, totalHeight: CGFloat) -> CGFloat {
        guard isActive else { return totalHeight * 0.08 }
        // A little per-bar variation so the reaction reads as a
        // waveform rather than a single flat block, while still being
        // driven entirely by the one real level value.
        let variation = 0.6 + 0.4 * sin(Double(index) * 0.9)
        let magnitude = CGFloat(level) * variation
        return max(totalHeight * 0.08, totalHeight * CGFloat(magnitude))
    }
}

private func color(fromHex hex: UInt32) -> Color {
    Color(
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255
    )
}
