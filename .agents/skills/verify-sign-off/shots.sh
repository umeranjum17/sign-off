#!/usr/bin/env bash
# Captures every board screen at 390 (phone) and 1280 (desk), light and dark, with chrome-devtools-axi.
# Usage: shots.sh <board URL from seed-board.sh> <evidence folder> [screen...]
# Screens are summary, waiting, evidence, reports and answered (all by default). Files: <screen>.<theme>.<width>w.png
set -euo pipefail
url=$1 out=$2; shift 2
screens=${*:-summary waiting evidence reports answered}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-verify-sign-off}
mkdir -p "$out"
for theme in light dark; do
  for vp in 390x844x2,mobile,touch 1280x800x1; do
    w=${vp%%x*}
    chrome-devtools-axi emulate --viewport "$vp" --color-scheme "$theme" >/dev/null
    for s in $screens; do
      hash=$s; [ "$s" = summary ] && hash=
      chrome-devtools-axi open "$url#$hash" >/dev/null
      chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 600))" >/dev/null
      chrome-devtools-axi screenshot "$out/$s.$theme.${w}w.png" >/dev/null
      echo "$out/$s.$theme.${w}w.png"
    done
  done
done
