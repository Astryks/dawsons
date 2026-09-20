"""Original instrumental music generation via ACE-Step.

ACE-Step (https://github.com/ace-step/ACE-Step) is a diffusion-based
text-to-music foundation model. Both its code and its published model
weights are Apache-2.0 (verified directly against the LICENSE file and
the Hugging Face model card, not just a description) — genuinely free
for commercial use, unlike Meta's MusicGen, whose code is MIT but whose
pretrained *weights* are CC-BY-NC 4.0 (non-commercial only) and are
therefore excluded from this project.

This wrapper only ever generates instrumental output (`lyrics` is fixed
to the model's own "[instrumental]" tag) — sidestepping synthesized-
vocal/voice-cloning concerns entirely, which aren't a fit for a "type a
style, get an original backing layer" feature anyway.
"""

from pathlib import Path

_pipeline = None
_pipeline_device: str | None = None


def _get_pipeline(device: str):
    global _pipeline, _pipeline_device
    if _pipeline is None or _pipeline_device != device:
        from acestep.pipeline_ace_step import ACEStepPipeline

        _pipeline = ACEStepPipeline(
            checkpoint_dir="",
            # bf16 is the upstream default but their own README calls out
            # macOS-specific errors with it — float32 is the documented
            # macOS-safe choice, at the cost of some speed/memory.
            dtype="float32",
            torch_compile=False,
            cpu_offload=(device == "cpu"),
            overlapped_decode=False,
        )
        _pipeline_device = device
    return _pipeline


def generate(prompt: str, duration_sec: float, out_dir: Path, device: str = "cpu") -> Path:
    """Generates an original instrumental clip from a text style/mood
    prompt (e.g. "upbeat lo-fi hip hop, mellow piano, soft drums").
    Returns the path to the rendered WAV.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "generated.wav"
    pipeline = _get_pipeline(device)

    pipeline(
        audio_duration=duration_sec,
        prompt=prompt,
        lyrics="[instrumental]",
        infer_step=60,
        guidance_scale=15,
        scheduler_type="euler",
        cfg_type="apg",
        omega_scale=10,
        manual_seeds=None,
        guidance_interval=0.5,
        guidance_interval_decay=0.0,
        min_guidance_scale=3,
        use_erg_tag=True,
        use_erg_lyric=True,
        use_erg_diffusion=True,
        oss_steps=[],
        guidance_scale_text=0.0,
        guidance_scale_lyric=0.0,
        save_path=str(out_path),
    )
    return out_path
