// Entry point kept separate from lib.rs so the app can also be built as a library
// (useful for integration tests exercising the audio engine / scene graph without a window).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dawsons_lib::run();
}
