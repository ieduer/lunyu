/* Derived navigation only. The existing reader remains the learning/identity authority. */
(function (root) {
    'use strict';
    function resolveChapter(value, chapters, rows) {
        if (typeof value !== 'string' || !value) return null;
        if (/^(?:chapter-)?[1-9]\d*$/.test(value)) {
            const id = Number(value.replace(/^chapter-/, ''));
            return rows.find(row => row.id === id) || null;
        }
        if (/^[1-9]\d*\.[1-9]\d*$/.test(value)) {
            return chapters.find(row => `${row.major}.${row.minor}` === value) || null;
        }
        return null;
    }
    function searchChapters(chapters, query) {
        const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.length) return [];
        return chapters.filter(row => {
            const text = `${row.title}\n${row.text}\n${row.translation}`.toLocaleLowerCase();
            return terms.every(term => /^[1-9]\d*\.[1-9]\d*$/.test(term)
                ? `${row.major}.${row.minor}` === term : text.includes(term));
        });
    }
    function progressSummary(chapters, aliases, ids) {
        const done = new Set(ids.map(String).map(id => aliases.get(id)).filter(Boolean));
        return { count: done.size, total: chapters.length,
            next: chapters.find(row => !done.has(String(row.id))) || null };
    }
    let reader = null;
    let listening = false;
    const el = id => root.document.getElementById(id);
    function urlFor(id) {
        const url = new URL(root.location.href);
        url.searchParams.set('chapter', String(id));
        return url;
    }
    function refresh() {
        if (!reader) return;
        const summary = progressSummary(reader.chapters, reader.aliases, reader.getProgress());
        el('reading-progress-label').textContent = `已讀 ${summary.count} / ${summary.total} 章句`;
        el('reading-progress-meter').max = summary.total;
        el('reading-progress-meter').value = summary.count;
        const next = el('reading-continue');
        next.hidden = !summary.next;
        if (summary.next) {
            next.textContent = `繼續閱讀：${summary.next.title}`;
            next.href = urlFor(summary.next.id).href;
            next.onclick = event => { if (!plainClick(event)) return; event.preventDefault(); reader.openChapter(summary.next.id); };
        }
    }
    function plainClick(event) {
        return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (!event.button || event.button === 0);
    }
    function selected(id, { history = true } = {}) {
        if (!reader) return;
        const source = reader.rows.find(row => row.id === Number(id));
        if (!source) return;
        if (history && root.location.href !== urlFor(source.id).href) root.history.pushState(null, '', urlFor(source.id));
        const index = reader.chapters.findIndex(row => String(row.id) === reader.aliases.get(String(source.id)));
        el('reading-current').textContent = source.title;
        for (const [name, offset] of [['previous', -1], ['next', 1]]) {
            const button = el(`reading-${name}`), target = reader.chapters[index + offset];
            button.disabled = !target;
            button.onclick = () => { if (target) reader.openChapter(target.id); };
        }
        el('reading-results').hidden = true;
        refresh();
    }
    function introduction() {
        reader.showIntroduction();
        el('reading-current').textContent = '選擇一章開始閱讀';
        el('reading-previous').disabled = true;
        el('reading-next').disabled = true;
    }
    function route({ initial = false } = {}) {
        if (!reader) return false;
        const value = new URL(root.location.href).searchParams.get('chapter');
        if (value === null) {
            if (!initial) introduction();
            return false;
        }
        const chapter = resolveChapter(value, reader.chapters, reader.rows);
        if (!chapter) {
            el('reading-search-status').textContent = '這個章節網址無法辨識，請從目錄或搜尋選擇。';
            if (!initial) introduction();
            return false;
        }
        // Keep the historical ID in the actual reader and evidence path, including aliases.
        reader.openChapter(chapter.id, { updateHistory: false });
        return true;
    }
    function initialize(adapter) {
        reader = adapter;
        if (!el('reading-workspace')) return false;
        el('reading-workspace').hidden = false;
        el('reading-search-form').onsubmit = event => {
            event.preventDefault();
            const query = el('reading-search').value.trim();
            const matches = searchChapters(reader.chapters, query), list = el('reading-results');
            list.replaceChildren();
            list.hidden = !query;
            el('reading-search-status').textContent = query ? `找到 ${matches.length} 章句` : '輸入章句、篇名或原文。';
            for (const chapter of matches) {
                const item = root.document.createElement('li'), link = root.document.createElement('a');
                link.href = urlFor(chapter.id).href;
                const title = root.document.createElement('strong'), excerpt = root.document.createElement('span');
                title.textContent = chapter.title;
                excerpt.textContent = chapter.text;
                link.append(title, excerpt);
                link.onclick = event => {
                    if (!plainClick(event)) return;
                    event.preventDefault(); reader.openChapter(chapter.id);
                    el('reading-current').focus();
                };
                item.append(link); list.append(item);
            }
        };
        if (!listening) {
            root.addEventListener('popstate', () => route());
            listening = true;
        }
        refresh();
        return route({ initial: true });
    }
    root.KzReadingWorkspace = Object.freeze({ initialize, refresh, selected, resolveChapter, searchChapters, progressSummary });
})(typeof window === 'undefined' ? globalThis : window);
