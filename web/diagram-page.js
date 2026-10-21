// Added to each diagram page the board serves. Only on the page opened by itself (Full size, not the card's frame): a way back to the plan or report,
// and on a phone's drawing-alone page (embed=1) the page is sized to the drawing, with the drawing's own surface carried down the rest of the screen, so no grey area follows it.
(() => {
  if (parent !== window) return;
  const me = document.currentScript, back = me.dataset.back, label = me.dataset.label;
  const style = document.createElement('style');
  style.textContent = '.so-back { display: flex; align-items: center; gap: 0.375rem; box-sizing: border-box; width: fit-content; min-height: 2.75rem; margin: 0.25rem 0.5rem; padding: 0 0.875rem; border: 1px solid currentColor; border-radius: 999px; color: inherit; font: 600 0.9375rem/1 system-ui, sans-serif; text-decoration: none; }'
    + '.so-back:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }';
  const surface = document.querySelector('.diagram-container');
  if (new URLSearchParams(location.search).get('embed') === '1') {
    style.textContent += 'html, body { height: auto !important; min-height: 0 !important; }';
    if (surface) {
      // The drawing sits on its own surface over the page's colour; the page takes that surface too, so the screen below the drawing is the drawing's own.
      const s = getComputedStyle(surface);
      style.textContent += `body { background-image: ${s.backgroundImage}, linear-gradient(${s.backgroundColor}, ${s.backgroundColor}) !important; background-size: ${s.backgroundSize}, auto !important; }`
        + '.diagram-container { background: none !important; }';
    }
  }
  const link = document.createElement('a');
  link.className = 'so-back'; link.href = back; link.textContent = `← ${label}`;
  document.head.append(style); document.body.prepend(link);
})();
