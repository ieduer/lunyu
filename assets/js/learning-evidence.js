(function initKzLearningEvidence(root) {
    'use strict';

    const EVIDENCE_SCHEMA = 'kz-learning-evidence-v1';
    const COMPLETION_KIND = 'annotation_revealed';

    function manifestItem(manifest, chapter) {
        const chapterId = String(chapter?.id ?? '');
        if (!manifest || manifest.schemaVersion !== 1 || manifest.siteKey !== 'kz' || !chapterId) return null;
        const item = Array.isArray(manifest.items)
            ? manifest.items.find((candidate) => candidate.resourceKey === `chapter-${chapterId}`)
            : null;
        if (!item || item.chapterId !== chapterId || item.itemType !== 'chapter') return null;
        return item;
    }

    function buildProgress(manifest, chapter) {
        const item = manifestItem(manifest, chapter);
        if (!item) return null;
        return {
            siteKey: 'kz',
            itemKey: item.resourceKey,
            itemTitle: item.itemTitle,
            itemGroup: item.itemGroup,
            itemType: 'chapter',
            state: 'completed',
            progressPercent: 100,
            score: 100,
            meta: {
                source: 'lunyu',
                evidenceSchema: EVIDENCE_SCHEMA,
                manifestVersion: manifest.manifestVersion,
                resourceKeySha256: manifest.resourceKeySha256,
                resourceKey: item.resourceKey,
                completionKind: COMPLETION_KIND,
                result: 'completed',
                chapterId: item.chapterId,
                major: item.major,
                minor: item.minor,
            },
        };
    }

    function buildEvent(manifest, chapter, eventId, sourceUrl) {
        const item = manifestItem(manifest, chapter);
        const opaqueId = String(eventId || '').trim();
        if (!item || !opaqueId) return null;
        return {
            siteKey: 'kz',
            recordKey: `kz:${item.resourceKey}:completed:${opaqueId}`.slice(0, 180),
            title: `${item.itemTitle} 学习完成`,
            summary: '已查看杨伯峻译文与注释',
            itemGroup: item.itemGroup,
            itemType: 'chapter_completion',
            contentFormat: EVIDENCE_SCHEMA,
            sourceUrl: String(sourceUrl || ''),
            payload: {
                eventName: 'chapter_completed',
                evidenceSchema: EVIDENCE_SCHEMA,
                manifestVersion: manifest.manifestVersion,
                resourceKeySha256: manifest.resourceKeySha256,
                resourceKey: item.resourceKey,
                completionKind: COMPLETION_KIND,
                result: 'completed',
                chapterId: item.chapterId,
            },
        };
    }

    async function authenticatedIdentity(identity) {
        if (!identity?.getSession || !identity?.syncProgress || !identity?.recordEvent) return null;
        const session = await identity.getSession().catch(() => null);
        return session?.authenticated === true && session?.user ? identity : null;
    }

    async function recordSourceCompletion(manifest, chapter, eventId) {
        const item = manifestItem(manifest, chapter);
        if (!item || !eventId) return { ok: false, reason: 'manifest-mismatch' };
        const response = await fetch('/api/learning/complete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                resourceKey: item.resourceKey,
                manifestVersion: manifest.manifestVersion,
                eventNonce: String(eventId),
                completionKind: COMPLETION_KIND,
            }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `source completion ${response.status}`);
        if (payload?.ok !== true
            || payload.sourceSiteKey !== 'kz'
            || payload.resourceKey !== item.resourceKey
            || payload.manifestVersion !== manifest.manifestVersion) {
            throw new Error('source completion receipt mismatch');
        }
        return payload;
    }

    async function syncChapterCompletion({
        identity,
        manifest,
        chapter,
        eventId,
        sourceUrl,
        sourceCompletionImpl = recordSourceCompletion,
    }) {
        const authenticated = await authenticatedIdentity(identity);
        if (!authenticated) return { status: 'skipped', reason: 'anonymous' };
        const progress = buildProgress(manifest, chapter);
        const event = buildEvent(manifest, chapter, eventId, sourceUrl);
        if (!progress || !event) return { status: 'skipped', reason: 'manifest-mismatch' };

        const sourceReceipt = await sourceCompletionImpl(manifest, chapter, eventId);
        const [progressResult, eventResult] = await Promise.allSettled([
            authenticated.syncProgress(progress),
            authenticated.recordEvent(event),
        ]);
        return {
            status: progressResult.status === 'fulfilled' && eventResult.status === 'fulfilled' ? 'synced' : 'partial',
            resourceKey: progress.itemKey,
            sourceReceipt,
            progressResult,
            eventResult,
        };
    }

    root.KzLearningEvidence = Object.freeze({
        EVIDENCE_SCHEMA,
        COMPLETION_KIND,
        manifestItem,
        buildProgress,
        buildEvent,
        authenticatedIdentity,
        recordSourceCompletion,
        syncChapterCompletion,
    });
})(typeof window !== 'undefined' ? window : globalThis);
