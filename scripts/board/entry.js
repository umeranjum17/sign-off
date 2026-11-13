// The only file that imports Excalidraw: it hands the page one call, and nothing of React reaches the page.
// The board is the agent's, so the editor is in view mode and every element it builds is locked: the page's own bar is the only interface.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

/** The drawing font's name: a label measured before it loads is sized in a fallback face and clipped. */
const FONT = 'Excalifont';

// The canvas asks a CDN for any font file this bundle does not carry, and a board reads nothing from another host: every font face
// this page builds keeps only the sources on its own origin, so no request leaves the board. A family sign-off does not ship then
// finds no file here and draws nothing, which is what a board drawn in Excalifont asks for anyway. The page's policy refuses the
// same hosts a second time; this keeps it from ever asking.
const Face = window.FontFace;
const ownFile = (url) => /^(data|blob):/.test(url) || (() => { try { return new URL(url, location.href).origin === location.origin; } catch { return false; } })();
window.FontFace = class extends Face {
  constructor(family, source, descriptors) {
    const kept = typeof source === 'string'
      ? source.split(/\s*,\s*(?=url\()/).filter((part) => ownFile(/url\(\s*['"]?([^'")]+)/.exec(part)?.[1] ?? '')).join(', ')
      : '';
    super(family, kept || 'url(/board/fonts/none.woff2)', descriptors);
  }
};

window.WB = {
  /**
   * Draw a board's scene. The page gives the boxes the server computed (one geometry owner, src/board.ts) as plain
   * skeleton shapes; this turns them into the editor's elements, fits them in view and hands the editor back.
   */
  async mount(el, { scene, theme = 'light', background = '#ffffff' }) {
    // Mount empty first: the editor registers its faces a moment after it mounts, and only then can the font be asked for.
    const root = createRoot(el), ready = new Promise((ok) => { root.render(React.createElement(Excalidraw, {
      initialData: { elements: [], appState: { theme, viewBackgroundColor: background } },
      theme, viewModeEnabled: true, excalidrawAPI: ok,
      UIOptions: { canvasActions: false }, detectScroll: false, handleKeyboardGlobally: false,
    })); });
    const api = await ready;
    const letters = JSON.stringify(scene);
    for (let i = 0; i < 120 && !document.fonts.check(`18px ${FONT}`, letters); i++) {
      await document.fonts.load(`18px ${FONT}`, letters).catch(() => {});
      await new Promise((r) => setTimeout(r, 25));
    }
    const elements = convertToExcalidrawElements(scene, { regenerateIds: false }).map((e) => ({ ...e, locked: true }));
    // The page, and the journey that proves the page, read the editor through this one handle.
    window.WB.api = api;
    // The editor's own first commit lands after the API comes back, so the scene is set again until it holds: a board that drew nothing
    // would look like a board with nothing on it.
    for (let i = 0; i < 20 && api.getSceneElements().length < elements.length; i++) {
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
      api.updateScene({ elements });
    }
    api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.95, animate: false });
    return { api, count: elements.length, font: document.fonts.check(`18px ${FONT}`, letters) };
  },
  /** The whole board in view again, which is what the page's Fit does; `ids` frames just those elements when a step names them. */
  fit(api, ids) {
    const all = api.getSceneElements();
    api.scrollToContent(ids?.length ? all.filter((e) => ids.includes(e.id)) : all, { fitToViewport: true, viewportZoomFactor: ids?.length ? 0.8 : 0.95, animate: false });
  },
};
