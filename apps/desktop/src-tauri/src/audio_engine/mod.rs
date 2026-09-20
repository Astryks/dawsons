//! Real-time audio engine built on `cpal` (device I/O) and `symphonia`
//! (file decoding). No JUCE dependency — avoids its GPL-3.0 free tier.
//!
//! Implemented starting at M2: `device.rs` (cpal stream setup), `decode.rs`
//! (symphonia file -> PCM), `mixer.rs` (sample-accurate multi-track gain/mix),
//! `transport.rs` (play head, clock, scheduling).
