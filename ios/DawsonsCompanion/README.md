# Dawsons Companion (iOS)

Native SwiftUI companion app: voice notes recorded and stored entirely
on-device (no server, no sync — same local-first principle as the desktop
app), plus playback of any audio file (e.g. a mix exported from desktop).

## Why this exists

Full song analysis (Demucs, chord/tempo detection) needs PyTorch and
real compute — it cannot run on a phone without a paid cloud backend,
which conflicts with the project's zero-server-cost constraint. This app
covers what *can* be free on mobile: capture and playback.

## Setup (requires full Xcode, not just Command Line Tools)

1. Install Xcode from the Mac App Store if you haven't (Command Line
   Tools alone don't include the iOS SDK/simulator).
2. `sudo xcode-select -s /Applications/Xcode.app`
3. In Xcode: File → New → Project → iOS → App. Name it
   `DawsonsCompanion`, interface: SwiftUI, language: Swift.
4. Delete the auto-generated `ContentView.swift` and
   `DawsonsCompanionApp.swift`, then drag in the four `.swift` files from
   this folder (`DawsonsCompanionApp.swift`, `ContentView.swift`,
   `VoiceNoteStore.swift`, `AudioRecorder.swift`).
5. In the project's Info tab (or `Info.plist`), add a
   **"Privacy - Microphone Usage Description"** key (`NSMicrophoneUsageDescription`)
   with a value like "Dawsons Companion needs microphone access to record voice notes."
   Recording will silently fail without this.
6. Build and run on a simulator or device.

## Structure

- `DawsonsCompanionApp.swift` — app entry point
- `ContentView.swift` — the single main view (voice notes list + recorder + file player)
- `VoiceNoteStore.swift` — local persistence (JSON manifest + audio files in the app's Documents directory)
- `AudioRecorder.swift` — thin wrapper around `AVAudioRecorder`

No dependencies beyond system frameworks (`AVFoundation`, `SwiftUI`, `UniformTypeIdentifiers`).
