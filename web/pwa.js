// The board as an app: the service worker (sw.js), the line shown while the board is read from the last update, and the install row in Today's More.
// Loaded by src/cli.ts into the served page only, so an exported copy and the demo carry none of it.
(() => {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});

  // The worker answers the state with a marked copy while the board is out of reach; any real answer clears the line.
  const line = document.createElement('p');
  line.id = 'offline';
  line.setAttribute('role', 'status');
  line.hidden = true;
  line.textContent = 'Offline, showing the last update';
  const style = document.createElement('style');
  style.textContent = '#offline { position: sticky; top: 0; z-index: 30; margin: 0; padding: calc(0.5rem + env(safe-area-inset-top)) 1rem 0.5rem; background: var(--tk-ink); color: var(--tk-canvas); font-size: var(--tk-fs-secondary); text-align: center; } #offline[hidden] { display: none; } #install-app { width: 100%; padding: 0; border: 0; background: none; font-family: inherit; font-size: var(--tk-fs-row); line-height: var(--tk-lh-row); text-align: left; cursor: pointer; }';
  document.head.append(style);
  document.body.prepend(line);
  const real = window.fetch;
  window.fetch = async (...args) => {
    const res = await real.apply(window, args);
    if (new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href).pathname === '/api/decisions') line.hidden = res.headers.get('x-sign-off-offline') !== '1';
    return res;
  };
  addEventListener('online', () => real('/api/decisions').then((res) => { if (res.headers.get('x-sign-off-offline') !== '1') line.hidden = true; }, () => {}));

  // Install: Chrome and Edge offer their own prompt once the page is installable; Safari on an iPhone or iPad has no prompt, only the Share menu.
  let offered;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offered = e; });
  addEventListener('appinstalled', () => { offered = undefined; });
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const safari = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const row = (tag, words, hint) => {
    const r = document.createElement(tag), k = document.createElement('span'), v = document.createElement('span'), s = document.createElement('span');
    r.className = 'ui-pr';
    k.className = 'k';
    v.className = 'v';
    k.textContent = words;
    s.textContent = hint;
    v.append(s);
    r.append(k, v);
    return r;
  };
  /** The row Today's More adds under its links, or nothing once the app is installed or this browser cannot install it. */
  window.signOffInstall = () => {
    if (installed()) return '';
    if (offered) {
      const b = row('button', 'Install app', 'On this device');
      b.type = 'button';
      b.id = 'install-app';
      b.onclick = async () => { const e = offered; offered = undefined; b.closest('dialog')?.close(); e.prompt(); await e.userChoice; };
      return wrap(b);
    }
    return safari ? wrap(row('div', 'Add to Home Screen', 'In Share')) : '';
  };
  const wrap = (r) => { const w = document.createElement('div'); w.className = 'ui-props'; w.append(r); return w; };
})();
