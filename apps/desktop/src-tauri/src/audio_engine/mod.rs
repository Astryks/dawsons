//! Real-time audio engine built on `cpal` (device I/O) and `symphonia`
//! (file decoding). No JUCE dependency — avoids its GPL-3.0 free tier.

pub mod capture;
pub mod decode;
pub mod demo_songs;
pub mod device;
pub mod effects;
pub mod mixer;
pub mod pitch;
pub mod synth;
pub mod transport;
pub mod wav_writer;

pub use device::{spawn_audio_thread, EngineConfig};
pub use mixer::SharedMixer;
