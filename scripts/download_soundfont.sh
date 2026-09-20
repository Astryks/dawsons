#!/usr/bin/env bash
# Fetches the FluidR3_GM General MIDI SoundFont (MIT license, Frank Wen)
# into the local cache — never committed to git (148MB). See
# THIRD_PARTY_NOTICES.md for license details.
set -euo pipefail

DEST_DIR="$HOME/.cache/dawsons/soundfonts"
DEST_FILE="$DEST_DIR/FluidR3_GM.sf2"
URL="https://github.com/pianobooster/fluid-soundfont/releases/download/v3.1/FluidR3_GM.sf2"

if [ -f "$DEST_FILE" ]; then
  echo "Already present: $DEST_FILE"
  exit 0
fi

mkdir -p "$DEST_DIR"
echo "Downloading FluidR3_GM.sf2 (~148MB) to $DEST_FILE ..."
curl -sL -o "$DEST_FILE" "$URL"
echo "Done."
