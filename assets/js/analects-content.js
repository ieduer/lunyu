/* Read-only adapter for the existing immutable Weibian content release. */
(function (root) {
    'use strict';
    const release = Object.freeze({
        version: 'fc68413c7b70da0e',
        sha256: 'fc68413c7b70da0e1f14e36bb2229c4d9ae64fb8f26d75251f87d7457f8ffa75',
        size: 871333,
        url: 'https://weibian.bdfz.net/api/content/bundles/fc68413c7b70da0e.json',
    });
    const fail = () => { throw new Error('analects_content_mismatch'); };
    const translation = text => String(text).replace(/^译文[：:]\s*/, '').trim();
    function reconcile(bundle, rows) {
        if (rows.length !== 541 || bundle.chapters?.length !== 512 || Object.keys(bundle.aliases || {}).length !== 29) fail();
        const chapters = new Map(bundle.chapters.map(chapter => [chapter.id, chapter]));
        if (chapters.size !== 512 || new Set(rows.map(row => row.id)).size !== 541) fail();
        const byLegacy = new Map();
        for (const row of rows) {
            const canonicalId = row.displayAliasOf || row.id;
            const chapter = chapters.get(canonicalId);
            if (!chapter || (bundle.aliases[String(row.id)] || row.id) !== canonicalId
                || chapter.original !== row.text || translation(chapter.translation) !== translation(row.translation)
                || !Array.isArray(chapter.annotations)) fail();
            // Mapping never changes the requested historical ID or its learning record.
            byLegacy.set(row.id, chapter);
        }
        return byLegacy;
    }
    async function verify(bytes, rows) {
        if (bytes.byteLength !== release.size) fail();
        const digest = await root.crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== release.sha256) fail();
        return reconcile(JSON.parse(new TextDecoder().decode(bytes)), rows);
    }
    let pending;
    async function load(rows) {
        if (!pending) {
            pending = (async () => {
                const controller = new AbortController();
                const timer = root.setTimeout(() => controller.abort(), 10000);
                try {
                    const response = await root.fetch(release.url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
                    if (!response.ok) throw new Error('analects_content_unavailable');
                    return await verify(await response.arrayBuffer(), rows);
                } finally { root.clearTimeout(timer); }
            })().catch(error => { pending = null; throw error; });
        }
        return pending;
    }
    function renderTerms(document, container, chapter) {
        container.replaceChildren();
        if (!chapter.annotations.length) {
            const empty = document.createElement('p'); empty.textContent = '本章沒有另列詞語註解。'; container.append(empty); return;
        }
        for (const note of chapter.annotations) {
            const item = document.createElement('details'), term = document.createElement('summary'), gloss = document.createElement('p');
            term.textContent = `${note.marker || ''} ${note.term || '註解'}`.trim();
            gloss.textContent = note.gloss;
            item.append(term, gloss); container.append(item);
        }
    }
    root.AnalectsContent = Object.freeze({ release, reconcile, verify, load, renderTerms });
})(typeof window === 'undefined' ? globalThis : window);
