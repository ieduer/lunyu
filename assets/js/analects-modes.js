(function (root) {
    'use strict';
    const protocol = 'analects-host-v1';
    const sources = Object.freeze({
        fuzi: { origin: 'https://fuzi.bdfz.net', path: '/', title: '夫子對談' },
        battle: { origin: 'https://ly.bdfz.net', path: '/', title: '義戰論語完整遊戲' },
    });
    const frames = new Map();
    const el = id => root.document.getElementById(id);
    const modeFrom = url => ['read', 'today', ...Object.keys(sources)].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'read';
    let active = modeFrom(new URL(root.location.href));
    const modeUrl = mode => { const url = new URL(root.location.href); url.searchParams.set('mode', mode); return url; };
    const notify = (mode, entry) => entry.frame.contentWindow?.postMessage({ protocol, type: 'visibility', mode,
        visible: mode === active && !root.document.hidden }, sources[mode].origin);
    function select(mode, { history = true } = {}) {
        if (!['read', 'today'].includes(mode) && !sources[mode]) return;
        active = mode;
        if (history && root.location.href !== modeUrl(mode).href) root.history.pushState(null, '', modeUrl(mode));
        root.document.body.dataset.analectsMode = mode;
        for (const link of root.document.querySelectorAll('[data-analects-mode-link]')) {
            const selected = link.dataset.analectsModeLink === mode;
            if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        }
        if (sources[mode] && !frames.has(mode)) {
            const panel = root.document.createElement('section'); panel.className = 'analects-mode-panel';
            panel.setAttribute('aria-label', sources[mode].title);
            const status = root.document.createElement('p'); status.className = 'analects-mode-status';
            status.setAttribute('role', 'status'); status.textContent = '正在載入…';
            const frame = root.document.createElement('iframe'); frame.title = sources[mode].title;
            frame.hidden = true;
            frame.src = sources[mode].origin + sources[mode].path;
            frame.referrerPolicy = 'strict-origin-when-cross-origin';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads');
            panel.append(status, frame); el('analects-modes').append(panel);
            const entry = { panel, status, frame, ready: false, timer: null };
            frames.set(mode, entry);
            frame.addEventListener('load', () => notify(mode, entry));
            entry.timer = root.setTimeout(() => {
                if (entry.ready) return;
                status.textContent = '此模式尚未連上。可以保留這頁，稍後返回，或';
                const fallback = root.document.createElement('a'); fallback.href = frame.src;
                fallback.target = '_blank'; fallback.rel = 'noopener'; fallback.textContent = '在原頁繼續';
                status.append(' ', fallback);
            }, 12000);
        }
        for (const [key, entry] of frames) { entry.panel.hidden = key !== mode; notify(key, entry); }
        el('analects-modes').hidden = !sources[mode];
        el('analects-overview').hidden = mode !== 'today';
        root.dispatchEvent(new CustomEvent('analects:mode', { detail: { mode } }));
    }
    function login() {
        const returnTo = modeUrl(active).href;
        const target = root.BdfzIdentity?.buildAuthUrl?.('login', returnTo)
            || `https://my.bdfz.net/?returnTo=${encodeURIComponent(returnTo)}`;
        root.location.assign(target);
    }
    root.AnalectsModes = Object.freeze({ get current() { return active; }, select });
    root.addEventListener('message', event => {
        const message = event.data, source = sources[message?.mode], entry = frames.get(message?.mode);
        if (!source || !entry || event.source !== entry.frame.contentWindow || event.origin !== source.origin
            || message.protocol !== protocol) return;
        if (message.type === 'ready') {
            entry.ready = true; root.clearTimeout(entry.timer); entry.status.hidden = true; entry.frame.hidden = false; notify(message.mode, entry);
        } else if (message.type === 'login' && message.mode === active) login();
    });
    root.addEventListener('popstate', () => select(modeFrom(new URL(root.location.href)), { history: false }));
    root.document.addEventListener('visibilitychange', () => { for (const [mode, entry] of frames) notify(mode, entry); });
    root.document.addEventListener('DOMContentLoaded', () => {
        for (const link of root.document.querySelectorAll('[data-analects-mode-link]')) {
            const mode = link.dataset.analectsModeLink;
            link.href = modeUrl(mode).href;
            link.onclick = event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button && event.button !== 0)) return;
                event.preventDefault(); select(mode);
            };
        }
        el('analects-login').onclick = login;
        select(active, { history: false });
    });
})(window);
