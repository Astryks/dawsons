//! Minimal 16-bit PCM WAV writer — no external dependency needed for a
//! format this simple (a 44-byte header plus the sample data).

use std::io::Write;
use std::path::Path;

pub fn write_wav(
    path: &Path,
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
) -> Result<(), String> {
    let mut file =
        std::fs::File::create(path).map_err(|e| format!("failed to create {path:?}: {e}"))?;

    let bits_per_sample: u16 = 16;
    let block_align = channels * (bits_per_sample / 8);
    let byte_rate = sample_rate * block_align as u32;
    let data_len = (samples.len() * 2) as u32; // 2 bytes per i16 sample
    let riff_len = 36 + data_len;

    file.write_all(b"RIFF").map_err(io_err)?;
    file.write_all(&riff_len.to_le_bytes()).map_err(io_err)?;
    file.write_all(b"WAVE").map_err(io_err)?;

    file.write_all(b"fmt ").map_err(io_err)?;
    file.write_all(&16u32.to_le_bytes()).map_err(io_err)?; // fmt chunk size
    file.write_all(&1u16.to_le_bytes()).map_err(io_err)?; // PCM format
    file.write_all(&channels.to_le_bytes()).map_err(io_err)?;
    file.write_all(&sample_rate.to_le_bytes()).map_err(io_err)?;
    file.write_all(&byte_rate.to_le_bytes()).map_err(io_err)?;
    file.write_all(&block_align.to_le_bytes()).map_err(io_err)?;
    file.write_all(&bits_per_sample.to_le_bytes())
        .map_err(io_err)?;

    file.write_all(b"data").map_err(io_err)?;
    file.write_all(&data_len.to_le_bytes()).map_err(io_err)?;
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let quantized = (clamped * i16::MAX as f32) as i16;
        file.write_all(&quantized.to_le_bytes()).map_err(io_err)?;
    }

    Ok(())
}

fn io_err(e: std::io::Error) -> String {
    format!("failed writing WAV data: {e}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_readable_wav_header() {
        let dir = std::env::temp_dir().join(format!("dawsons-wav-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.wav");

        write_wav(&path, &[0.0, 0.5, -0.5, 1.0], 44100, 2).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[36..40], b"data");
        // header (44 bytes) + 4 samples * 2 bytes each
        assert_eq!(bytes.len(), 44 + 8);

        std::fs::remove_dir_all(&dir).ok();
    }
}
