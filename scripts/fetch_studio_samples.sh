#!/usr/bin/env bash
# Vendors the small, permissively licensed one-shot drum samples and loops
# used by the browser Studio (website/studio) into website/studio/samples.
# Every file here is Public Domain / CC0 — see website/studio/SOUND_LIBRARY.md
# for per-set provenance. Re-run to refresh; it is idempotent.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/website/studio/samples"
BASE="https://smpldsnds.github.io"
mkdir -p "$OUT"

fetch() { # <remote path without extension> <local path without extension>
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$OUT/$dst")"
  for ext in ogg m4a; do
    [ -s "$OUT/$dst.$ext" ] && continue
    curl -fsSL "$BASE/$src.$ext" -o "$OUT/$dst.$ext"
  done
}

# Roland TR-808 — Michael Fischer / Technopolis set (1994), published by
# smpldsnds/drum-machines as public domain.
for p in tom-hi/ht50 mid-tom/mt50 tom-low/lt50 cowbell/cb clave/cl conga-hi/hc50 \
         hihat-close/ch maraca/ma hihat-open/oh25 hihat-open/oh75 cymbal/cy5050 cymbal/cy1010 cymbal/cy7525 \
         kick/bd2575 kick/bd5010 kick/bd7575 snare/sd5050 snare/sd2575 snare/sd7575 clap/cp rimshot/rs; do
  fetch "drum-machines/TR-808/$p" "tr808/$(basename "$p")"
done

# LinnDrum-style LM-2 — smpldsnds/drum-machines (public domain).
for p in tom-h tom-m tom-l cowbell tambourine conga-h conga-m hhclosed hhclosed-short hhopen crash ride cabasa \
         kick kick-alt snare-m snare-h clap stick-m; do
  fetch "drum-machines/LM-2/$p" "lm2/$p"
done

# Sonic Pi sample pack (all CC0, sourced from freesound.org) — acoustic
# kit, tabla kit, vinyl FX and loops. loop_amen*/loop_breakbeat are
# deliberately NOT vendored: they are recognisable breaks from commercial
# records, so a CC0 tag on freesound doesn't clear the underlying recording.
for n in drum_tom_hi_hard drum_tom_mid_hard drum_tom_lo_hard drum_cowbell drum_cymbal_closed drum_cymbal_pedal \
         drum_cymbal_open drum_cymbal_hard drum_cymbal_soft drum_splash_hard drum_heavy_kick drum_bass_hard \
         drum_snare_hard drum_snare_soft drum_roll perc_snap \
         tabla_dhec tabla_ghe1 tabla_ghe4 tabla_ghe8 tabla_ke1 tabla_ke2 tabla_na tabla_na_o tabla_na_s tabla_re \
         tabla_tas1 tabla_tas3 tabla_te1 tabla_te2 tabla_te_m tabla_te_ne tabla_tun1 tabla_tun3 \
         vinyl_hiss vinyl_scratch vinyl_backspin; do
  fetch "sonic-pi-samples/samples/$n" "sonicpi/$n"
done
for n in loop_industrial loop_compus loop_garzul loop_mika loop_safari loop_tabla loop_perc1 loop_perc2 \
         loop_mehackit1 loop_mehackit2 loop_electric loop_3d_printer loop_weirdo loop_drone_g_97 \
         guit_em9 guit_e_fifths guit_harmonics guit_e_slide bass_woodsy_c bass_voxy_c bass_thick_c ambi_piano ambi_choir; do
  fetch "sonic-pi-samples/samples/$n" "loops/$n"
done
echo "Samples in $OUT: $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
