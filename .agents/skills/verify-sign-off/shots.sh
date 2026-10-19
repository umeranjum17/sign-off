#!/usr/bin/env bash
# Captures every board screen at 390 (phone), 820 (pad) and 1280 (desk), light and dark, with chrome-devtools-axi.
# Usage: shots.sh <board URL from seed-board.sh> <evidence folder> [screen...]
# Screens include summary, waiting, decide (the sign-in ask), designs, design-review, design-viewer, evidence, reports and answered (all by default).
# Files: <screen>.<theme>.<width>w.png; the design viewer also writes <screen>.<theme>.<width>w.widths.json,
# the note box against the buttons under it, which must share both edges.
# SHOTS_WIDTHS="390" or "1280" keeps the widths named (all three by default).
set -euo pipefail
url=$1 out=$2; shift 2
screens=${*:-summary waiting decide designs design-review design-viewer evidence reports answered}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-verify-sign-off}
mkdir -p "$out"
chrome-devtools-axi open "$url" >/dev/null  # a page must be selected before emulate
WIDTHS='() => { const p = document.querySelector(".design-viewer-panel"), m = (e) => e && Math.round(e.getBoundingClientRect().width); const note = p?.querySelector("textarea"), foot = p?.querySelector(".foot"); return { width: innerWidth, note: m(note), buttons: m(foot), aligned: !!note && !!foot && Math.abs(note.getBoundingClientRect().left - foot.getBoundingClientRect().left) <= 1 && Math.abs(note.getBoundingClientRect().right - foot.getBoundingClientRect().right) <= 1 } }'
for theme in light dark; do
  for vp in 390x844x2,mobile,touch 820x1180x2,mobile,touch 1280x800x1; do
    w=${vp%%x*}
    case " ${SHOTS_WIDTHS:-390 820 1280} " in *" $w "*) ;; *) continue ;; esac
    chrome-devtools-axi emulate --viewport "$vp" --color-scheme "$theme" >/dev/null
    for s in $screens; do
      hash=$s; [ "$s" = summary ] && hash=
      [ "$s" = decide ] && hash=decide/npm
      [ "$s" = design-review ] && hash=designs/chat-journeys
      [ "$s" = design-viewer ] && hash=designs/chat-journeys
      chrome-devtools-axi open "$url#$hash" >/dev/null
      chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 600))" >/dev/null
      # A viewer left open from the cell before is closed first: a dialog stays open across a same-hash open, and the next capture would show it.
      chrome-devtools-axi eval "() => { document.querySelector('.design-viewer[open]')?.close(); return 'ok' }" >/dev/null
      if [ "$s" = design-viewer ]; then
        chrome-devtools-axi eval "() => { document.querySelector('button[data-design]').click(); return 'ok' }" >/dev/null
        chrome-devtools-axi eval "() => new Promise((ok) => setTimeout(ok, 600))" >/dev/null
      fi
      chrome-devtools-axi screenshot "$out/$s.$theme.${w}w.png" >/dev/null
      echo "$out/$s.$theme.${w}w.png"
      if [ "$s" = design-viewer ]; then
        chrome-devtools-axi eval "$WIDTHS" | sed -n 's/^result: "\(.*\)"$/\1/p' | sed 's/\\"/"/g' > "$out/$s.$theme.${w}w.widths.json"
      fi
    done
  done
done
