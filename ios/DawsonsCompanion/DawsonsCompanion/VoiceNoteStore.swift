import Foundation

/// A single locally-recorded voice note. Nothing here is ever uploaded —
/// the audio file lives in the app's own Documents directory and the
/// metadata lives in a plain JSON manifest alongside it. No server, no
/// sync, consistent with the rest of Dawsons' local-first design.
struct VoiceNote: Identifiable, Codable {
    let id: UUID
    var title: String
    let createdAt: Date
    let durationSec: Double
    let fileName: String
}

@MainActor
final class VoiceNoteStore: ObservableObject {
    @Published private(set) var notes: [VoiceNote] = []

    private let manifestURL: URL
    private let notesDirectory: URL

    init() {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        notesDirectory = documents.appendingPathComponent("VoiceNotes", isDirectory: true)
        manifestURL = notesDirectory.appendingPathComponent("manifest.json")
        try? FileManager.default.createDirectory(at: notesDirectory, withIntermediateDirectories: true)
        load()
    }

    func fileURL(for note: VoiceNote) -> URL {
        notesDirectory.appendingPathComponent(note.fileName)
    }

    /// Moves a just-recorded file (from a temp location) into the notes
    /// directory and adds it to the manifest.
    func addNote(title: String, durationSec: Double, temporaryFileURL: URL) throws {
        let fileName = "\(UUID().uuidString).m4a"
        let destination = notesDirectory.appendingPathComponent(fileName)
        try FileManager.default.moveItem(at: temporaryFileURL, to: destination)

        let note = VoiceNote(id: UUID(), title: title, createdAt: Date(), durationSec: durationSec, fileName: fileName)
        notes.insert(note, at: 0)
        save()
    }

    func rename(_ note: VoiceNote, to newTitle: String) {
        guard let index = notes.firstIndex(where: { $0.id == note.id }) else { return }
        notes[index].title = newTitle
        save()
    }

    func delete(_ note: VoiceNote) {
        try? FileManager.default.removeItem(at: fileURL(for: note))
        notes.removeAll { $0.id == note.id }
        save()
    }

    private func load() {
        guard let data = try? Data(contentsOf: manifestURL) else { return }
        notes = (try? JSONDecoder().decode([VoiceNote].self, from: data)) ?? []
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(notes) else { return }
        try? data.write(to: manifestURL, options: .atomic)
    }
}
