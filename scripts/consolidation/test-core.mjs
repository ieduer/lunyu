import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRegistry, sha256, projectProgress, resolveLegacyResource, inventoryPlan, compareDailyProjections, inspectPreservation, REQUIRED_SOURCES } from './core.mjs';
const registry=JSON.parse(fs.readFileSync(new URL('../../data/consolidation-registry.json',import.meta.url)));
const clone=x=>structuredClone(x);
const row={site:'kz',id:'fixture-only',kind:'assessment',owner:'fixture-owner',ownerVerified:true,
  resourceKey:'chapter-268',resourceVersion:'fixture-version',mode:'read',status:'passed',assessmentVerified:true};
const plan={planId:'fixture',version:'1',timeZone:'Asia/Shanghai',startInclusive:'2026-10-01',endExclusive:'2026-10-03',
  days:[{dayId:'day-001',date:'2026-10-01',tasks:[{taskId:'day-001-01',siteKey:'kz',title:'fixture',url:'https://kz.bdfz.net/',creditRefs:[],details:'讀後去 https://ly.bdfz.net/#chapter-1 完成四門'}]},
    {dayId:'day-002',date:'2026-10-02',tasks:[{taskId:'day-002-01',siteKey:'ly',title:'fixture',url:'https://ly.bdfz.net/',creditRefs:[]}]}],
  metadata:{taskAddenda:{'2026-10-01':'保留 https://fuzi.bdfz.net/'},evaluationAssignments:[{url:'https://weibian.bdfz.net/',creditRefs:[]}]}};
test('all 541 legacy IDs resolve; 29 aliases group for display while preserving historical keys and scoring',()=>{
  assert.equal(registry.legacy.length,541);assert.equal(new Set(registry.legacy.map(r=>r.passageId)).size,512);
  assert.equal(registry.legacy.filter(r=>r.alias).length,29);
  for(let id=1;id<=541;id++){assert.equal(resolveLegacyResource(registry,`chapter-${id}`).sourceId,id);assert.equal(resolveLegacyResource(registry,`chapter:${id}`).sourceId,id);}
  assert.equal(resolveLegacyResource(registry,'chapter-268').passageId,'10.25');assert.equal(resolveLegacyResource(registry,'chapter-265').passageId,'10.25');
  assert.equal(registry.historicalScoring.itemCount,541);assert.equal(registry.historicalScoring.completionThreshold,163);
  assert.equal(resolveLegacyResource(registry,'chapter-542'),null);assert.equal(resolveLegacyResource(registry,'任意章節'),null);
});
test('alias attempts and separate source evidence remain distinct, replay is idempotent and input is immutable',()=>{
  const rows=[row,{...row,id:'alias-original',resourceKey:'chapter-265'},{...row,site:'ly',mode:'battle'}];const before=sha256(rows);
  const view=projectProgress(registry,[...rows,row],'fixture-owner');
  assert.equal(view.sourceRecordCount,3);assert.equal(view.preservedSourceRecordCount,3);assert.equal(view.modes.read.assessedPassages,1);assert.equal(view.modes.battle.assessedPassages,1);
  assert.equal(view.scoringMutationAllowed,false);assert.equal(sha256(rows),before);
});
test('same source record with changed bytes is rejected rather than overwritten',()=>assert.throws(()=>projectProgress(registry,[row,{...row,status:'failed'}],'fixture-owner'),/source_record_conflict/));
test('unknown identities, unknown resources, versions and unsynced states remain held',()=>{
  const changes=[{ownerVerified:false},{owner:'other'},{resourceKey:'chapter-999'},{resourceVersion:''},{status:'pending'},{status:'failed'}];
  const view=projectProgress(registry,changes.map((x,i)=>({...row,id:`f-${i}`,...x})),'fixture-owner');
  assert.equal(view.held.length,6);assert.equal(view.accepted.length,0);assert.equal(view.preservedSourceRecordCount,6);
});
test('page views, conversations, and unverified answers cannot become assessed mastery',()=>{
  const changes=[{kind:'conversation',mode:'fuzi'},{kind:'page_view'},{assessmentVerified:false},{status:'observed'},{status:'completed'}];
  const view=projectProgress(registry,changes.map((x,i)=>({...row,id:`f-${i}`,...x})),'fixture-owner');
  for(const mode of Object.values(view.modes))assert.equal(mode.assessedPassages,0);
});
test('daily inventory finds inline and supplementary references, preserving empty credit as unresolved',()=>{
  const result=inventoryPlan(plan);assert.equal(result.dayCount,2);assert.equal(result.taskCount,2);
  assert.equal(result.days[0].tasks[0].urls.length,2);assert.equal(result.metadataReferences.length,2);
  assert.equal(result.days[0].tasks[0].creditMapping,'unresolved');assert.equal('estimatedMinutes' in plan.days[0].tasks[0],false);
});
for(const [name,modify] of [
  ['missing details',p=>delete p.days[0].tasks[0].details],
  ['wrong date',p=>p.days[0].date='2026-09-30'],
  ['wrong version',p=>p.version='2'],
  ['same ID different lesson',p=>p.days[0].tasks[0].title='different lesson'],
  ['lost supplement',p=>p.metadata.taskAddenda={}],
  ['changed evaluation',p=>p.metadata.evaluationAssignments[0].creditRefs=['unapproved-credit']],
  ['wrong order',p=>p.days.reverse()],
])test(`daily comparison rejects ${name}`,()=>{
  const changed=clone(plan);modify(changed);
  const result=compareDailyProjections(plan,{my:plan,homework:changed,dot:plan});
  assert.equal(result.status,'out_of_sync');assert.deepEqual(result.discrepancies,[{consumer:'homework',reason:'full_plan_difference'}]);
});
test('source parity does not claim delivery or live synchronization',()=>{
  const result=compareDailyProjections(plan,{my:plan,homework:clone(plan),dot:plan});assert.equal(result.status,'source_candidates_match');
  assert.equal(result.liveReadbackVerified,false);assert.equal(result.deliveryVerified,false);
});
test('date gaps and duplicate task IDs reject the entire candidate',()=>{
  const gap=clone(plan);gap.days.pop();assert.throws(()=>inventoryPlan(gap),/date_coverage_gap/);
  const dup=clone(plan);dup.days[1].tasks[0].taskId=dup.days[0].tasks[0].taskId;assert.throws(()=>inventoryPlan(dup),/duplicate_task_id/);
});
test('missing source or offline device census prevents cutover prerequisite review',()=>{
  const result=inspectPreservation({sources:[]});assert.equal(result.status,'blocked');assert.equal(result.issues.length,REQUIRED_SOURCES.length);
  assert.equal(result.productionSwitchAuthorized,false);
});
test('machine inspection is not teaching review; failed checks never leak row IDs',()=>{
  const sources=REQUIRED_SOURCES.map(id=>({id,coverage:'complete',snapshotId:'fixture',backupReceipt:'fixture',restoreReceipt:'fixture',incrementalReceipt:'fixture',expectedRecords:0,records:[]}));
  sources[0].expectedRecords=1;sources[0].records=[{sourceRecordId:'private-fixture-row',contentHash:'a'.repeat(64),retainedReceipt:'fixture',targetRecordId:'fixture',identityStatus:'verified',resourceStatus:'verified',reviewStatus:'machine_checked',disposition:'preserved',originalScorePreserved:true,privacyScopePreserved:true,consentStatePreserved:true}];
  const result=inspectPreservation({sources});assert.equal(result.status,'blocked');assert.ok(result.issues.some(x=>x.reason==='review_incomplete'));
  assert.equal(JSON.stringify(result).includes('private-fixture-row'),false);
});
test('complete prerequisite receipts still require independent acceptance and cannot authorize production',()=>{
  const sources=REQUIRED_SOURCES.map(id=>({id,coverage:'complete',snapshotId:'fixture',backupReceipt:'fixture',restoreReceipt:'fixture',incrementalReceipt:'fixture',expectedRecords:0,records:[]}));
  const result=inspectPreservation({sources});assert.equal(result.status,'ready_for_independent_receipt_review');assert.equal(result.productionSwitchAuthorized,false);
});
