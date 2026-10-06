/* Read-only view of My's existing daily plan and accepted evaluation. */
(function (root) {
    'use strict';
    const authority = Object.freeze({
        planId: 'chinese-a-20260930-textbook-sequence-v6', version: '1.3.0',
        planDigest: 'd2a6d3e397b4f586e17bcf64855d947d35162acec17527b2e4ab1082c8828eca',
        sourceCatalogDigest: '7a2dd4a1de8507a3542845a119b473625f146f4efc5682c7fd19b85f463c8624',
    });
    const gates = Object.freeze([
        { id: 'ai-lunyu-30', title: '研讀', mode: 'read', unit: '展開譯註的有效紀錄' },
        { id: 'lunyu-battle-30', title: '義戰論語', mode: 'battle', unit: '提交作答的有效紀錄；不代表全部答對' },
    ]);
    const dayAt = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
    // /api/session exposes the central users.slug UNIQUE key, not the private
    // numeric id. Never use display names, email or inferred aliases as identity.
    const ownerOf = session => session?.authenticated === true && typeof session.user?.slug === 'string'
        && session.user.slug.length > 0 ? session.user.slug : null;
    const relevant = task => ['kz', 'ly', 'fuzi', 'weibian'].includes(task?.siteKey)
        || (task?.addenda || []).some(part => ['kz', 'ly', 'fuzi', 'weibian'].includes(part?.siteKey));
    function projection(payload, day) {
        if (payload?.schemaVersion !== 'student-progress-v1'
            || payload?.academicYear?.id !== payload?.currentAcademicYear
            || !payload?.currentAcademicYear
            || !Number.isFinite(Date.parse(payload?.generatedAt))
            || dayAt(Date.parse(payload.generatedAt)) !== day
            || payload?.daily?.day?.date !== day
            || !Object.entries(authority).every(([key, value]) => payload.daily.authority?.[key] === value)
            || !Array.isArray(payload?.daily?.day?.tasks)) throw Error('daily_source_unverified');
        const complete = payload?.coverage?.sourceReadStatus === 'ok'
            && payload.coverage.rawProgressLimitReached === false && payload.coverage.rawRecordLimitReached === false;
        const requirements = payload?.score?.aPlus?.requirements;
        if (!Array.isArray(requirements)) throw Error('progress_source_unverified');
        const progress = gates.map(gate => {
            const found = requirements.filter(item => item.id === gate.id);
            const item = found.length === 1 ? found[0] : null;
            const verified = complete && item && ['completed', 'incomplete'].includes(item.status)
                && typeof item.current === 'string' && item.current.trim().length > 0;
            return { ...gate, verified: Boolean(verified), current: verified ? item.current : '紀錄暫未核齊',
                status: verified ? item.status : 'unverified' };
        });
        const tasks = payload.daily.day.tasks.filter(relevant).map(task => {
            if (!task.taskId || typeof task.title !== 'string' || typeof task.action !== 'string'
                || typeof task.completionCheck !== 'string') throw Error('daily_task_incomplete');
            return { taskId: task.taskId, title: task.title, action: task.action,
                details: Array.isArray(task.details) ? task.details.filter(t => typeof t === 'string') : [],
                completionCheck: task.completionCheck, scoringStatus: complete ? task.scoringStatus : 'source_unverified',
                chapterIds: [...new Set((task.taskRefs || []).map(ref => /^source:kz:chapter-([1-9]\d*)$/.exec(ref)?.[1]).filter(Boolean))],
                mode: task.siteKey === 'kz' ? 'read' : task.siteKey === 'ly' ? 'battle' : null };
        });
        return { day, year: payload.currentAcademicYear, generatedAt: payload.generatedAt, tasks, progress };
    }
    function controller({ identity, render, now = Date.now, deadlineMs = 12000 }) {
        let generation = 0;
        const clear = () => { generation += 1; render({ state: 'idle' }); };
        async function refresh() {
            const request = ++generation, day = dayAt(now());
            render({ state: 'loading' });
            const bounded = promise => new Promise((resolve, reject) => {
                const timer = root.setTimeout(() => reject(Error('read_timeout')), deadlineMs);
                Promise.resolve(promise).then(resolve, reject).finally(() => root.clearTimeout(timer));
            });
            try {
                const service = identity();
                if (!service?.getSession || !service?.api) throw Error('identity_unavailable');
                const before = ownerOf(await bounded(service.getSession()));
                if (request !== generation) return;
                if (!before) { render({ state: 'anonymous' }); return; }
                const payload = await bounded(service.api('/api/student-progress?' + new URLSearchParams({ date: day, site: 'kz', limit: '1' })));
                if (request !== generation) return;
                const after = ownerOf(await bounded(service.getSession()));
                if (request !== generation) return;
                if (!after || before !== after) { render({ state: 'identity_changed' }); return; }
                if (day !== dayAt(now())) { render({ state: 'date_changed' }); return; }
                render({ state: 'ready', view: projection(payload, day) });
            } catch (_) { if (request === generation) render({ state: 'unavailable' }); }
        }
        return Object.freeze({ refresh, clear });
    }
    root.AnalectsOverview = Object.freeze({ projection, controller, dayAt });
    if (!root.document) return;
    const el = id => root.document.getElementById(id);
    const node = (tag, text, className) => {
        const item = root.document.createElement(tag); item.textContent = text;
        if (className) item.className = className; return item;
    };
    function modeLink(mode, label, chapterId = null) {
        const link = node('a', label), url = new URL(root.location.href); url.searchParams.set('mode', mode); link.href = url.href;
        if (chapterId) { url.searchParams.set('chapter', chapterId); link.href = url.href; }
        link.onclick = event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button && event.button !== 0)) return;
            event.preventDefault();
            if (chapterId) root.history.pushState(null, '', url);
            root.AnalectsModes?.select(mode);
            if (chapterId) root.KzReadingWorkspace?.openChapter(chapterId);
        };
        return link;
    }
    const dailyStatus = {
        completed: '線上部分已有完成證據；仍請自查當日要求', in_progress: '線上部分已有紀錄',
        no_evidence: '目前未查到對應的有效完成紀錄', record_only: '依當日要求自行檢查',
        needs_reconciliation: '部分紀錄仍待核對', source_unverified: '來源仍待核對',
    };
    function render(result) {
        const body = el('analects-overview-body'), status = el('analects-overview-status');
        if (!body || !status) return;
        body.replaceChildren();
        el('analects-overview-refresh').disabled = result.state === 'loading';
        const messages = {
            idle: '選擇今日與進度後讀取最新紀錄。', loading: '正在讀取 My 的今日安排與核驗紀錄…',
            anonymous: '登入後可查看自己的今日安排與核驗紀錄。', identity_changed: '登入身份已改變，請重新讀取。',
            date_changed: '北京日期已更新，請重新讀取今日安排。',
            unavailable: '目前無法核對最新紀錄。請稍後重新讀取，或到 My 查看；已有紀錄會保留。',
        };
        status.textContent = messages[result.state] || '';
        if (result.state !== 'ready') return;
        const { view } = result;
        status.textContent = `${view.day}（北京時間）· ${view.year} 學年 · 本次從 My 讀取`;
        body.append(node('h2', '今日論語安排'));
        if (!view.tasks.length) body.append(node('p', '今日沒有已發布的論語安排，可繼續研讀或複習。'));
        for (const task of view.tasks) {
            const card = node('article', '', 'analects-overview-card'); card.dataset.taskId = task.taskId;
            card.append(node('h3', task.title), node('p', task.action));
            for (const detail of task.details) card.append(node('p', detail));
            card.append(node('p', task.completionCheck), node('p', dailyStatus[task.scoringStatus] || '紀錄狀態待核對', 'analects-overview-note'));
            if (task.chapterIds.length) for (const [index, id] of task.chapterIds.entries()) {
                card.append(modeLink('read', task.chapterIds.length === 1 ? '研讀今日章句' : `研讀第 ${index + 1} 則`, id));
            } else if (task.mode) card.append(modeLink(task.mode, task.mode === 'battle' ? '開啟義戰論語' : '開啟研讀'));
            body.append(card);
        }
        body.append(node('h2', 'My 已核驗的 A+ 完成條件'), node('p', '各來源沿用原有條件，分開顯示；這裡不重新計分。', 'analects-overview-note'));
        for (const item of view.progress) {
            const card = node('article', '', 'analects-overview-card');
            card.append(node('h3', item.title), node('p', item.current), node('p', item.unit, 'analects-overview-note'), modeLink(item.mode, '繼續學習'));
            body.append(card);
        }
        body.append(node('p', '對談與韋編裝置內的紀錄請在原模式查看；未同步的紀錄不會推算成中央進度。', 'analects-overview-note'));
    }
    const client = controller({ identity: () => root.BdfzIdentity, render });
    const active = () => root.AnalectsModes?.current === 'today' && !root.document.hidden;
    root.addEventListener('analects:mode', () => { if (active()) client.refresh(); else client.clear(); });
    root.addEventListener('bdfz:session-invalidated', client.clear);
    root.addEventListener('pagehide', client.clear);
    root.addEventListener('pageshow', event => { if (event.persisted && active()) client.refresh(); });
    root.addEventListener('focus', () => { if (active()) client.refresh(); });
    root.document.addEventListener('visibilitychange', () => { if (root.document.hidden) client.clear(); else if (active()) client.refresh(); });
    root.document.addEventListener('DOMContentLoaded', () => { el('analects-overview-refresh').onclick = client.refresh; });
})(typeof window === 'undefined' ? globalThis : window);
