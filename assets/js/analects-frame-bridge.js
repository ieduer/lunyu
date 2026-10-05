/* Canonical source: KZ assets/js/analects-frame-bridge.js. Copies are generated verbatim. */
(function (root) {
    'use strict';
    const protocol = 'analects-host-v1';
    const mode = root.document.currentScript?.dataset.analectsMode;
    if (!['battle', 'fuzi'].includes(mode) || root.parent === root) return;
    const allowed = origin => origin === 'https://kz.bdfz.net' || origin === 'https://lunyu-6ky.pages.dev'
        || /^https:\/\/[a-z0-9-]+\.lunyu-6ky\.pages\.dev$/.test(origin);
    let host = null, visible = false, announced = false;
    const send = type => root.parent.postMessage({ protocol, type, mode }, host);
    const announce = () => { if (host && !announced) { announced = true; send('ready'); } };
    function activate(origin) {
        if (host) return host === origin;
        if (!allowed(origin)) return false;
        host = origin;
        Object.defineProperty(root, 'AnalectsHostBridge', { value: Object.freeze({
            get visible() { return visible; },
        }), configurable: false });
        // No URL, token, owner or answer crosses the bridge. Host builds its own login return URL.
        root.document.addEventListener('click', event => {
            const anchor = event.target?.closest?.('a[href]');
            if (!anchor || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            let url;
            try { url = new URL(anchor.href, root.location.href); } catch { return; }
            if (url.origin !== 'https://my.bdfz.net' || !url.searchParams.has('returnTo')) return;
            event.preventDefault(); send('login');
        });
        return true;
    }
    // Referrer is only an initial hint; in-frame navigation changes it to the child origin.
    // Each load therefore also accepts a handshake from the exact, allowlisted parent window.
    try { activate(new URL(root.document.referrer).origin); } catch { /* wait for parent handshake */ }
    root.addEventListener('message', event => {
        const message = event.data;
        if (event.source !== root.parent || !allowed(event.origin) || message?.protocol !== protocol
            || message.type !== 'visibility' || message.mode !== mode || typeof message.visible !== 'boolean'
            || !activate(event.origin)) return;
        visible = message.visible;
        root.dispatchEvent(new CustomEvent('analects:visibility', { detail: { visible } }));
        announce();
    });
    if (root.document.readyState === 'complete') announce();
    else root.addEventListener('load', announce, { once: true });
})(window);
