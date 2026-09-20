# AI-Native DAW Blueprint

## Comprehensive Product & Technical Design

# Executive Summary

## Vision

Create a desktop-first DAW similar in simplicity to GarageBand but
powered by an AI layer that understands music rather than merely
generating it.

The two flagship capabilities are:

1.  Upload any commercially released song and reconstruct it into an
    editable musical project.
2.  Sing, hum or beatbox musical ideas and instantly convert them into
    editable performances for any instrument.

The product's long-term competitive advantage is not any individual AI
model. Instead it is the combination of:

-   Musical Scene Graph
-   AI orchestration
-   Conversational editing
-   Unified workflow
-   Model-agnostic architecture

------------------------------------------------------------------------

# Product Philosophy

Traditional workflow

Idea → DAW → Manual editing

AI-native workflow

Idea (voice, song, MIDI, text) → AI understanding → Musical Scene Graph
→ Editable project → DAW

The Musical Scene Graph becomes the source of truth.

------------------------------------------------------------------------

# Core User Stories

## Song Analysis

User drops an MP3.

System produces:

-   separated stems
-   BPM
-   tempo map
-   key
-   chord progression
-   sections
-   instrument list
-   editable MIDI
-   confidence scores

## Voice Sketching

User hums a melody.

System:

-   detects pitch
-   estimates rhythm
-   quantizes
-   creates MIDI
-   renders using any selected instrument

## Conversational Editing

Examples:

"Make the chorus bigger."

"Replace piano with Rhodes."

"Transpose up two semitones."

"Double the tempo."

The LLM never edits audio directly. It calls structured DAW operations.

------------------------------------------------------------------------

# Overall Architecture

User ↓ Desktop UI ↓ AI Orchestrator ↓ Musical Scene Graph ↓ Analysis
Engines ↓ DAW Engine ↓ Audio Output

------------------------------------------------------------------------

# Musical Scene Graph

Represents the song as structured objects.

Song - Metadata - Sections - Tracks - Notes - Chords - Automation -
Audio references - Confidence - Source

Example object:

{ instrument, note, start, duration, velocity, confidence, source }

Every edit modifies these objects instead of raw waveforms.

------------------------------------------------------------------------

# AI Pipeline

## Upload Song

Audio → Demucs → stems → beat/key detection → transcription → Scene
Graph → Timeline

## Voice Input

Microphone → Noise reduction → CREPE/YIN → Pitch curve → Note
segmentation → Quantization → MIDI → Instrument

------------------------------------------------------------------------

# Recommended Open-Source Models

## Separation

-   Demucs

## Pitch

-   CREPE
-   YIN

## Beat / Key

-   Librosa
-   Essentia

## Chords

-   Omnizart
-   Chordino

## Polyphonic Transcription

-   MT3
-   Omnizart

## Drum Transcription

-   Omnizart

## Generation (later)

-   ACE-Step
-   YuE2

------------------------------------------------------------------------

# Technology Stack

Desktop - Tauri + React (preferred) or - Electron + React

Audio Engine - JUCE

Backend - Python - FastAPI

Storage - SQLite initially - PostgreSQL later

AI - Python wrappers around open-source models

Conversation - GPT-class LLM using structured tool calls

------------------------------------------------------------------------

# DAW Operations

The AI agent operates only through explicit commands.

Examples

create_track() delete_track() mute_track() solo_track() set_instrument()
transpose() quantize() duplicate_section() change_key() change_tempo()
add_notes() delete_notes() generate_section()

------------------------------------------------------------------------

# Phased Roadmap

Phase 1 - Desktop shell - Audio import - Playback - Demucs integration -
BPM/key detection

Phase 2 - Chords - MIDI transcription - Piano roll - Timeline

Phase 3 - Voice → MIDI - Instrument rendering

Phase 4 - Conversational editing

Phase 5 - Generative arrangement - AI mixing - AI mastering

------------------------------------------------------------------------

# Monetisation

Free - Basic editing - Voice sketching - Song analysis limits

Pro - Unlimited analysis - Advanced AI editing - Cloud processing -
Premium instruments - Collaboration

Enterprise - Studios - Education - Music schools

------------------------------------------------------------------------

# Engineering Principles

-   Local-first
-   CPU compatible
-   Optional GPU acceleration
-   Swappable AI models
-   Structured data over waveform editing
-   Explainable confidence scores
-   Non-destructive editing

------------------------------------------------------------------------

# Biggest Risks

-   Perfect reconstruction is impossible from stereo audio.
-   Transcription accuracy varies by instrument overlap.
-   Latency on low-end hardware.
-   Licensing of commercial music must be considered.

------------------------------------------------------------------------

# Immediate Next Steps

1.  Define Scene Graph schema.
2.  Build desktop shell.
3.  Integrate Demucs.
4.  Integrate Librosa/Essentia.
5.  Integrate MT3 and Omnizart.
6.  Render timeline and piano roll.
7.  Add voice-to-MIDI.
8.  Add conversational AI.
9.  Add generation features after editing workflow is robust.

This document should serve as the initial blueprint. Future versions
should expand into detailed API specifications, UI mockups, plugin
architecture, data model diagrams, testing strategy, deployment, and
contributor guidelines.
