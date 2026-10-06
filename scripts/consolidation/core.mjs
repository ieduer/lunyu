import { createHash } from 'node:crypto';

export const SITES = Object.freeze(['kz', 'fuzi', 'weibian', 'ly']);
export const REQUIRED_SOURCES = Object.freeze([
  'kz-browser', 'ly-browser', 'weibian-android', 'fuzi-d1', 'fuzi-r2',
  'weibian-d1', 'user-center', 'homework-checklist', 'daily-plan-history', 'dot-delivery-ledger',
]);
const fail = code => { throw new Error(code); };
const assert = (value, code) => { if (!value) fail(code); };
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stable(value)).digest('hex');
const translation = text => text.replace(/^译文[：:]\s*/, '').trim();

// Produces a display/reconciliation index. It never replaces a historical resourceKey,
// completion contract, answer, score, or the original source bytes.
export function buildRegistry(dialogues, manifest, bundle, provenance) {
  assert(dialogues.length === 541 && manifest.items.length === 541, 'legacy_count_changed');
  assert(manifest.itemCount === 541 && manifest.completionThreshold === 163, 'scoring_contract_changed');
  assert(bundle.chapters.length === 512 && Object.keys(bundle.aliases).length === 29, 'canonical_count_changed');
  const byId = new Map(dialogues.map(r => [r.id, r]));
  const chapters = new Map(bundle.chapters.map(c => [c.id, c]));
  assert(byId.size === 541 && chapters.size === 512, 'duplicate_source_id');
  const legacy = dialogues.map((row, index) => {
    assert(row.id === index + 1, 'legacy_order_changed');
    const canonicalId = row.displayAliasOf || row.id;
    assert((bundle.aliases[String(row.id)] || row.id) === canonicalId, 'alias_conflict');
    const chapter = chapters.get(canonicalId), item = manifest.items[index];
    assert(chapter && !byId.get(canonicalId)?.displayAliasOf, 'alias_target_invalid');
    assert(item.resourceKey === `chapter-${row.id}` && String(item.chapterId) === String(row.id), 'legacy_resource_changed');
    assert(chapter.ref === `${item.major}.${item.minor}`, 'coordinate_conflict');
    assert(row.text === chapter.original, 'original_text_conflict');
    assert(translation(row.translation) === translation(chapter.translation), 'translation_conflict');
    assert(stable(chapter.aliases) === stable(Object.keys(bundle.aliases).filter(k => bundle.aliases[k] === canonicalId).map(Number)), 'alias_reverse_conflict');
    return { sourceId: row.id, resourceKey: item.resourceKey, passageId: chapter.ref, canonicalSourceId: canonicalId,
      alias: canonicalId !== row.id, sourceFieldsSha256: sha256({text:row.text,translation:row.translation,annotations:row.annotations}) };
  });
  const passages = bundle.chapters.map(c => ({ passageId: c.ref, canonicalSourceId: c.id,
    title: byId.get(c.id).title, sourceIds: legacy.filter(x => x.canonicalSourceId === c.id).map(x => x.sourceId),
    contentSha256: sha256({original:c.original,translation:c.translation,annotations:c.annotations}),
    annotationReview: 'pending', modes: ['read', 'fuzi', 'battle', 'exam'] }));
  assert(new Set(passages.map(p => p.passageId)).size === 512, 'duplicate_coordinate');
  return { schema: 'analects-consolidation-registry-v1', status: 'shadow-only', provenance,
    historicalScoring: { siteKey:'kz', manifestVersion:manifest.manifestVersion, itemCount:541, completionThreshold:163,
      resourceKeySha256:manifest.resourceKeySha256, completionContractSha256:sha256(manifest.completionContract), mutationAllowed:false },
    counts: { legacy:541, passages:512, aliases:29 }, legacy, passages };
}

// Key formats come from the existing KZ/LY recorders. Unknown forms are held for review.
export function resolveLegacyResource(registry, key) {
  const match = typeof key === 'string' && key.match(/^chapter[-:](\d+)$/);
  return match ? registry.legacy.find(row => row.sourceId === Number(match[1])) || null : null;
}

// Read-only derived view. Calling code supplies only records belonging to one verified owner.
// Original row IDs and hashes are retained; alias grouping must not create new score credit.
export function projectProgress(registry, records, owner) {
  assert(typeof owner === 'string' && owner.length > 0, 'verified_owner_required');
  const seen = new Map(), accepted = [], held = [];
  for (const record of records) {
    assert(SITES.includes(record.site) && typeof record.id === 'string' && record.id && typeof record.kind === 'string' && record.kind, 'invalid_source_record');
    const key = stable([record.site, record.kind, record.id]);
    const hash = sha256(record);
    if (seen.has(key)) {
      assert(seen.get(key) === hash, 'source_record_conflict');
      continue;
    }
    seen.set(key, hash);
    const mapping = resolveLegacyResource(registry, record.resourceKey);
    let reason = null;
    if (record.owner !== owner || record.ownerVerified !== true) reason = 'owner_unverified';
    else if (!mapping) reason = 'resource_unmapped';
    else if (!record.resourceVersion) reason = 'version_unknown';
    else if (record.status === 'failed' || record.status === 'pending') reason = record.status;
    else if (!['read','fuzi','battle','exam'].includes(record.mode)) reason = 'mode_unmapped';
    if (reason) { held.push({ sourceKey:key, sourceHash:hash, reason }); continue; }
    accepted.push({ sourceKey:key, sourceHash:hash, passageId:mapping.passageId, resourceKey:record.resourceKey,
      resourceVersion:record.resourceVersion, mode:record.mode, kind:record.kind, status:record.status,
      // Recorded work is not automatically mastery. Only an existing verified assessment qualifies.
      assessed:record.assessmentVerified === true && record.status === 'passed' && record.kind === 'assessment' });
  }
  const modes = Object.fromEntries(['read','fuzi','battle','exam'].map(mode => {
    const rows=accepted.filter(r=>r.mode===mode);
    return [mode,{ recordedPassages:new Set(rows.map(r=>r.passageId)).size,
      assessedPassages:new Set(rows.filter(r=>r.assessed).map(r=>r.passageId)).size }];
  }));
  return { schema:'analects-progress-shadow-v1', modes, accepted, held,
    sourceRecordCount:seen.size, preservedSourceRecordCount:accepted.length+held.length,
    scoringMutationAllowed:false, masteryNotInferred:true };
}

function walkStrings(value, visit, path = '') {
  if (typeof value === 'string') visit(value,path);
  else if (Array.isArray(value)) value.forEach((v,i)=>walkStrings(v,visit,`${path}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v])=>walkStrings(v,visit,path?`${path}.${k}`:k));
}
export function collectAnalectsReferences(value) {
  const found=[];
  walkStrings(value,(text,path)=>{
    for(const match of text.matchAll(/https:\/\/(?:kz|fuzi|weibian|ly)\.bdfz\.net(?:[^\s<>"）】。，；]*)/g)) found.push({path,url:match[0]});
  });
  return found;
}
export function inventoryPlan(plan) {
  assert(plan?.planId && plan.version && plan.timeZone === 'Asia/Shanghai' && Array.isArray(plan.days), 'invalid_plan_identity');
  const seenDays=new Set(), seenTasks=new Set();
  const rows=plan.days.map(day=>{
    assert(day.date >= plan.startInclusive && day.date < plan.endExclusive && !seenDays.has(day.date), 'invalid_or_duplicate_date');
    seenDays.add(day.date);
    assert(Array.isArray(day.tasks), 'tasks_missing');
    return {date:day.date,dayId:day.dayId,digest:sha256(day),tasks:day.tasks.map(task=>{
      assert(task.taskId && !seenTasks.has(task.taskId), 'duplicate_task_id');seenTasks.add(task.taskId);
      // Includes details, future schema fields, taskRefs and creditRefs without fabricating defaults.
      return {taskId:task.taskId,semanticDigest:sha256(task),siteKey:task.siteKey,
        urls:collectAnalectsReferences(task),creditMapping:!Array.isArray(task.creditRefs)?'missing':task.creditRefs.length?'declared_not_revalidated':'unresolved'};
    })};
  });
  const expectedDays=(Date.parse(`${plan.endExclusive}T00:00:00Z`)-Date.parse(`${plan.startInclusive}T00:00:00Z`))/86400000;
  assert(Number.isInteger(expectedDays) && expectedDays===rows.length, 'date_coverage_gap');
  return {schema:'analects-daily-impact-v1',planId:plan.planId,version:plan.version,projectionDigest:sha256(plan),
    dayCount:rows.length,taskCount:seenTasks.size,metadataDigest:sha256(plan.metadata),
    metadataReferences:collectAnalectsReferences(plan.metadata),days:rows};
}
export function compareDailyProjections(canonical, consumers) {
  inventoryPlan(canonical);
  const names=['my','homework','dot'];
  const canonicalDigest=sha256(canonical);
  const discrepancies=[];
  for(const name of names){
    const value=consumers[name];
    if(!value){discrepancies.push({consumer:name,reason:'projection_missing'});continue;}
    if(sha256(value)!==canonicalDigest)discrepancies.push({consumer:name,reason:'full_plan_difference'});
  }
  return {status:discrepancies.length?'out_of_sync':'source_candidates_match',canonicalDigest,discrepancies,
    liveReadbackVerified:false,deliveryVerified:false};
}

// This is a prerequisite review, never release authority. Receipts must be independently
// verified under the existing publisher, identity and data-preservation contracts.
export function inspectPreservation(manifest) {
  const issues=[];
  const sources=manifest?.sources || [];
  for(const id of REQUIRED_SOURCES){
    const matches=sources.filter(s=>s.id===id);
    if(matches.length!==1){issues.push({source:id,reason:'source_missing_or_duplicate'});continue;}
    const source=matches[0];
    if(source.coverage!=='complete')issues.push({source:id,reason:'coverage_unknown_or_partial'});
    if(!source.snapshotId || !source.backupReceipt || !source.restoreReceipt || !source.incrementalReceipt)issues.push({source:id,reason:'preservation_receipt_missing'});
    if(!Array.isArray(source.records) || source.records.length!==source.expectedRecords){issues.push({source:id,reason:'record_inventory_incomplete'});continue;}
    const seen=new Set();
    for(const row of source.records){
      const reasons=[];
      if(!row.sourceRecordId || seen.has(row.sourceRecordId))reasons.push('record_identity_missing_or_duplicate');
      seen.add(row.sourceRecordId);
      if(!/^[a-f0-9]{64}$/.test(row.contentHash||''))reasons.push('content_hash_missing');
      if(!row.retainedReceipt || !row.targetRecordId)reasons.push('retention_unconfirmed');
      if(row.identityStatus!=='verified' || row.resourceStatus!=='verified')reasons.push('mapping_unresolved');
      if(row.reviewStatus!=='reviewed' || !row.reviewer || !row.reviewPolicy || !row.reviewedAt)reasons.push('review_incomplete');
      if(row.disposition!=='preserved' || row.originalScorePreserved!==true)reasons.push('history_preservation_unconfirmed');
      if(row.privacyScopePreserved!==true || row.consentStatePreserved!==true)reasons.push('privacy_preservation_unconfirmed');
      // No student IDs or payloads in the public result, even on failure.
      for(const reason of reasons)issues.push({source:id,reason});
    }
  }
  const groups=new Map();for(const issue of issues){const key=stable(issue);groups.set(key,{...issue,count:(groups.get(key)?.count||0)+1});}
  return {status:issues.length?'blocked':'ready_for_independent_receipt_review',issues:[...groups.values()],
    productionSwitchAuthorized:false,scoringMutationAllowed:false};
}
