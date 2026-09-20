//! Decodes an audio file into interleaved f32 PCM via symphonia, and
//! converts the result to a target sample rate / channel count (the
//! engine's actual output device format, known only once cpal opens a
//! stream — see device.rs).

use std::fs::File;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: u16,
    /// Interleaved samples, `channels` values per frame.
    pub samples: Vec<f32>,
}

pub fn decode_file(path: &Path) -> Result<DecodedAudio, String> {
    let file = File::open(path).map_err(|e| format!("failed to open {path:?}: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("failed to probe {path:?}: {e}"))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "no supported audio track found".to_string())?
        .clone();

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("failed to create decoder: {e}"))?;

    let track_id = track.id;
    let mut samples: Vec<f32> = Vec::new();
    let mut sample_rate: Option<u32> = None;
    let mut channels: Option<u16> = None;
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                break
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(format!("error reading packet: {e}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                if sample_buf.is_none() {
                    sample_rate = Some(spec.rate);
                    channels = Some(spec.channels.count() as u16);
                    sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                }
                if let Some(buf) = sample_buf.as_mut() {
                    buf.copy_interleaved_ref(decoded);
                    samples.extend_from_slice(buf.samples());
                }
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("decode error: {e}")),
        }
    }

    let sample_rate = sample_rate.ok_or_else(|| "no audio frames decoded".to_string())?;
    let channels = channels.ok_or_else(|| "no audio frames decoded".to_string())?;

    Ok(DecodedAudio {
        sample_rate,
        channels,
        samples,
    })
}

/// Converts decoded audio to the engine's output sample rate/channel count.
/// Channel conversion is a simple average-to-mono or cycle-to-fill; rate
/// conversion is linear interpolation. Good enough to prove the playback
/// path without glitches for Phase 1; a proper resampler (e.g. `rubato`)
/// is a candidate upgrade once multi-track stem playback needs higher
/// fidelity.
pub fn to_engine_format(audio: &DecodedAudio, target_rate: u32, target_channels: u16) -> Vec<f32> {
    let remixed = remix_channels(&audio.samples, audio.channels, target_channels);
    if audio.sample_rate == target_rate {
        remixed
    } else {
        resample_linear(&remixed, target_channels, audio.sample_rate, target_rate)
    }
}

fn remix_channels(samples: &[f32], from_channels: u16, to_channels: u16) -> Vec<f32> {
    if from_channels == to_channels || from_channels == 0 {
        return samples.to_vec();
    }
    let from = from_channels as usize;
    let to = to_channels as usize;
    let mut out = Vec::with_capacity((samples.len() / from) * to);
    for frame in samples.chunks_exact(from) {
        if to == 1 {
            out.push(frame.iter().sum::<f32>() / from as f32);
        } else {
            for ch in 0..to {
                out.push(frame[ch % from]);
            }
        }
    }
    out
}

pub(super) fn resample_linear(
    samples: &[f32],
    channels: u16,
    from_rate: u32,
    to_rate: u32,
) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    let frame_count = samples.len() / channels;
    if frame_count == 0 || from_rate == 0 {
        return Vec::new();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_frames = ((frame_count as f64) / ratio).round() as usize;
    let mut out = Vec::with_capacity(out_frames * channels);
    for i in 0..out_frames {
        let src_pos = i as f64 * ratio;
        let src_index = (src_pos.floor() as usize).min(frame_count - 1);
        let next_index = (src_index + 1).min(frame_count - 1);
        let frac = (src_pos - src_index as f64) as f32;
        for ch in 0..channels {
            let a = samples[src_index * channels + ch];
            let b = samples[next_index * channels + ch];
            out.push(a + (b - a) * frac);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remix_mono_to_stereo_duplicates_channel() {
        let mono = vec![0.1, 0.2, 0.3];
        let stereo = remix_channels(&mono, 1, 2);
        assert_eq!(stereo, vec![0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
    }

    #[test]
    fn remix_stereo_to_mono_averages() {
        let stereo = vec![1.0, 0.0, 0.5, 0.5];
        let mono = remix_channels(&stereo, 2, 1);
        assert_eq!(mono, vec![0.5, 0.5]);
    }

    #[test]
    fn resample_identity_when_rates_match() {
        let samples = vec![0.1, 0.2, 0.3, 0.4];
        let out = resample_linear(&samples, 1, 44100, 44100);
        assert_eq!(out, samples);
    }

    #[test]
    fn resample_upsamples_to_expected_length() {
        let samples = vec![0.0, 1.0, 0.0, 1.0];
        let out = resample_linear(&samples, 1, 22050, 44100);
        assert_eq!(out.len(), 8);
    }
}
