# Frozen sidecar output (generated, mostly gitignored)

This directory is where `scripts/build_sidecar.sh` writes the
PyInstaller-frozen sidecar (`dawsons-sidecar` executable + `_internal/`
support files) — see that script and `apps/desktop/src-tauri/src/sidecar/
process.rs`'s `resolve_launch()`.

This README is the one file in this directory that's actually committed.
Everything else here is real build output (100MB+ executable, hundreds of
support files) and is gitignored — see `.gitignore`.

**This file must keep existing even though its contents don't matter**:
Tauri's build script validates `tauri.conf.json`'s `bundle.resources`
paths at compile time, for every `cargo check`/`clippy`/`build` — not
just an actual `tauri build` packaging run. Without something real
here, the path wouldn't exist on a fresh checkout (or in CI, which never
runs `build_sidecar.sh`), and *any* Rust build of the desktop app would
fail immediately, not just packaging. Run `./scripts/build_sidecar.sh`
before an actual `tauri build` to populate the real contents.
