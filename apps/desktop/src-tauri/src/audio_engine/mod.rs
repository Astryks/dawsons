//! Real-time audio engine built on `cpal` (device I/O) and `symphonia`
//! (file decoding). No JUCE dependency — avoids its GPL-3.0 free tier.

pub mod decode;
pub mod device;
pub mod effects;
pub mod mixer;
pub mod transport;

pub use device::{spawn_audio_thread, EngineConfig};
pub use mixer::SharedMixer;
