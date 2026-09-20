import AVKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @StateObject private var store = VoiceNoteStore()
    @StateObject private var recorder = AudioRecorder()
    @State private var showingFilePicker = false
    @State private var openedFileURL: URL?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Recorded and stored only on this device — nothing is uploaded, nothing syncs. Export a note to move it to the desktop app.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button(recorder.isRecording ? "Stop & save" : "Start recording") {
                        if recorder.isRecording {
                            recorder.stop { url, duration in
                                let title = "Idea \(store.notes.count + 1)"
                                try? store.addNote(title: title, durationSec: duration, temporaryFileURL: url)
                            }
                        } else {
                            recorder.start()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(recorder.isRecording ? .red : .accentColor)
                } header: {
                    Text("Voice Notes")
                }

                Section {
                    ForEach(store.notes) { note in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(note.title)
                                Spacer()
                                Text(String(format: "%.1fs", note.durationSec))
                                    .foregroundStyle(.secondary)
                            }
                            HStack(spacing: 16) {
                                Button("Rename") {
                                    // A production build would use a proper
                                    // text-entry sheet; kept minimal here.
                                    store.rename(note, to: note.title + " ✎")
                                }
                                Button("Delete", role: .destructive) {
                                    store.delete(note)
                                }
                            }
                            .font(.footnote)
                        }
                    }
                }

                Section {
                    Button("Open an audio file…") {
                        showingFilePicker = true
                    }
                    if let openedFileURL {
                        VideoPlayer(player: AVPlayer(url: openedFileURL))
                            .frame(height: 60)
                    }
                } header: {
                    Text("Play an audio file")
                } footer: {
                    Text("Open any audio file on this device — e.g. a mix exported from the desktop app.")
                }
            }
            .navigationTitle("Dawsons Companion")
            .fileImporter(isPresented: $showingFilePicker, allowedContentTypes: [.audio]) { result in
                if case .success(let url) = result {
                    openedFileURL = url
                }
            }
        }
    }
}

#Preview {
    ContentView()
}
