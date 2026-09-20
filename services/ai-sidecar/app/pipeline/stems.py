"""Stem separation via Demucs (htdemucs, MIT license).

Implemented at M4:
    def separate(input_path: Path, out_dir: Path) -> dict[str, Path]:
        # invokes demucs.separate.main() or the `demucs` CLI as a subprocess,
        # returns {"vocals": Path, "drums": Path, "bass": Path, "other": Path}
"""
