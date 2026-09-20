# AI-Native DAW Project Master Plan

## Vision

Build a **GarageBand-style DAW with an AI overlay** whose defining
capabilities are:

1.  **Upload any song** and reconstruct it into an editable musical
    project (stems, notes, chords, tempo, arrangement, confidence).
2.  **Sing or hum any musical idea** and instantly convert it into any
    instrument (piano, guitar, bass, violin, synth, etc.).

The goal is **not** to build another text-to-song generator. The goal is
to build a system that understands music and makes it editable.

------------------------------------------------------------------------

# Core Product Philosophy

Traditional DAWs start with an empty timeline.

This product starts with **music understanding**.

Everything (uploaded songs, voice, MIDI, text prompts) becomes a common
internal representation called the **Musical Scene Graph**.

------------------------------------------------------------------------

# High-Level Architecture

User → AI Music Orchestrator → Musical Scene Graph → Analysis /
Transcription / Generation → DAW UI

The DAW is the interface. The Musical Scene Graph is the brain.

------------------------------------------------------------------------

# Main Features

## Feature 1 -- Song → Editable Project

Pipeline:

Upload audio → Stem separation → Beat/BPM detection → Key detection →
Chord detection → Instrument transcription → Musical Scene Graph →
Editable timeline

Output:

-   Stems
-   MIDI
-   Piano roll
-   Chords
-   BPM
-   Sections
-   Confidence scores

Important: Market this as an **AI reconstruction** rather than exact
recovery of the original project.

------------------------------------------------------------------------

## Feature 2 -- Voice → Any Instrument

Pipeline:

Microphone → Noise reduction → Pitch detection → Note segmentation →
Rhythm estimation → Quantization → MIDI → Selected instrument

The same sung melody can become piano, guitar, violin, bass, etc.

------------------------------------------------------------------------

# Musical Scene Graph

Instead of storing:

song.wav

Store structured musical objects:

Song - Metadata - BPM - Key - Time signature - Sections - Tracks -
Vocals - Piano - Bass - Drums - Events - Notes - Chords - Automation

Example event:

``` json
{
  "instrument":"Piano",
  "note":"C4",
  "start":2.31,
  "duration":0.45,
  "velocity":92,
  "confidence":0.94,
  "source":"ai_transcription"
}
```

AI edits these objects instead of raw waveforms.

------------------------------------------------------------------------

# Open-Source Models

## Stem Separation

-   Demucs

## Pitch Detection

-   CREPE
-   YIN

## Tempo / Beat Analysis

-   Librosa
-   Essentia

## Chord Detection

-   Omnizart
-   Chordino

## Multi-instrument Transcription

-   MT3
-   Omnizart

## Drum Transcription

-   Omnizart

## Music Generation (Later)

-   ACE-Step
-   YuE2

------------------------------------------------------------------------

# AI Overlay

The LLM never edits audio directly.

Instead it calls structured DAW operations.

Examples:

-   create_track()
-   delete_track()
-   mute_track()
-   set_instrument()
-   transpose()
-   quantize()
-   duplicate_section()
-   generate_section()
-   change_key()
-   change_tempo()

User examples:

-   "Make the piano simpler."
-   "Replace the bass with cello."
-   "Move the chorus earlier."
-   "Double the tempo."

------------------------------------------------------------------------

# Technology Stack

Desktop: - Electron + React (or Tauri + React)

Audio Engine: - JUCE

AI Backend: - Python + FastAPI

Music Analysis: - Demucs - MT3 - Omnizart - CREPE - Librosa - Essentia

Generation (later): - ACE-Step - YuE2

Conversation: - GPT or another reasoning model

------------------------------------------------------------------------

# MVP Roadmap

## Phase 1

-   Desktop shell
-   Audio import
-   Demucs integration
-   BPM/key detection
-   Timeline
-   Basic playback

## Phase 2

-   Chords
-   MIDI transcription
-   Piano roll
-   Clickable notes
-   Confidence display

## Phase 3

-   Sing → MIDI
-   Instrument selection
-   Playback

## Phase 4

-   Conversational AI editing

## Phase 5

-   AI generation
-   Arrangement completion
-   Mixing assistance

------------------------------------------------------------------------

# Long-Term Vision

The long-term moat is **not** any individual model.

The value comes from:

1.  Musical Scene Graph
2.  AI orchestration
3.  Conversational editing
4.  Unified workflow
5.  Ability to swap in better open-source models over time.

------------------------------------------------------------------------

# Immediate Next Steps

1.  Finalize the Musical Scene Graph schema.
2.  Build a desktop application shell.
3.  Integrate Demucs.
4.  Add Librosa/Essentia for BPM and key.
5.  Integrate MT3/Omnizart for transcription.
6.  Render a basic timeline and piano roll.
7.  Add voice-to-MIDI using CREPE.
8.  Add the AI agent that performs structured DAW operations.
9.  Add generation features only after the editing pipeline is solid.
