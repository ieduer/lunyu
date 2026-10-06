import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/js/analects-overview.js',import.meta.url),'utf8');
const root={setTimeout,clearTimeout};
vm.runInNewContext(source,{globalThis:root,URLSearchParams});
const {projection,controller,dayAt}=root.AnalectsOverview;
const day='2026-10-06',now=()=>Date.parse(day+'T04:00:00Z');
const authority={planId:'chinese-a-20260930-textbook-sequence-v6',version:'1.3.0',
 planDigest:'d2a6d3e397b4f586e17bcf64855d947d35162acec17527b2e4ab1082c8828eca',
 sourceCatalogDigest:'7a2dd4a1de8507a3542845a119b473625f146f4efc5682c7fd19b85f463c8624'};
const payload=()=>({schemaVersion:'student-progress-v1',currentAcademicYear:'2026-2027',academicYear:{id:'2026-2027'},
 generatedAt:day+'T04:00:00Z',daily:{authority:{...authority},day:{date:day,tasks:[
  {taskId:'day-26-01',siteKey:'kz',title:'今日章句',action:'自行批註',details:['四關補充保持原文'],taskRefs:['source:kz:chapter-541','source:kz:chapter-541','source:ly:ly:q1:meaning'],completionCheck:'依課堂要求',scoringStatus:'needs_reconciliation'},
  {taskId:'day-26-02',siteKey:'yw',title:'其他任務',action:'其他',completionCheck:'其他',scoringStatus:'completed'}]}},
 coverage:{sourceReadStatus:'ok',rawProgressLimitReached:false,rawRecordLimitReached:false},
 score:{aPlus:{requirements:[{id:'ai-lunyu-30',status:'incomplete',current:'17 / 163 条（清单 541 条）'},
  {id:'lunyu-battle-30',status:'completed',current:'620 / 615 关（清单 2048 关）'}]}}});
const session=(id=10)=>({authenticated:true,user:{slug:`fixture-account-${id}`,displayName:'同名測試'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Shanghai dates use midnight independently of browser timezone',()=>{
 assert.equal(dayAt(Date.parse('2026-10-05T15:59:59Z')),'2026-10-05');
 assert.equal(dayAt(Date.parse('2026-10-05T16:00:00Z')),'2026-10-06');
});
test('daily IDs, requirements and details stay exact; gates retain server counts and source denominators',()=>{
 const p=payload(),before=JSON.stringify(p),v=projection(p,day);
 assert.equal(v.tasks.length,1);assert.equal(v.tasks[0].taskId,'day-26-01');
 assert.equal(v.tasks[0].details[0],p.daily.day.tasks[0].details[0]);assert.equal(v.tasks[0].scoringStatus,'needs_reconciliation');
 assert.deepEqual(Array.from(v.tasks[0].chapterIds),['541']);
 assert.equal(v.progress[0].current,p.score.aPlus.requirements[0].current);assert.equal(v.progress[1].current,p.score.aPlus.requirements[1].current);
 assert.equal(JSON.stringify(p),before);assert(!('score' in v));
});
test('missing, stale or mismatched plan authority never becomes no-tasks or zero progress',()=>{
 const mutations=[p=>delete p.daily,p=>p.daily.authority.version='wrong',p=>p.daily.authority.planDigest='changed',
  p=>p.daily.day.date='2026-10-05',p=>p.academicYear.id='2025-2026',p=>p.schemaVersion='old',
  p=>p.generatedAt='2026-10-04T04:00:00Z',p=>delete p.generatedAt,
  p=>delete p.daily.day.tasks,p=>delete p.daily.day.tasks[0].completionCheck];
 for(const mutate of mutations){const p=payload();mutate(p);assert.throws(()=>projection(p,day));}
});
test('truncation, partial sources, missing or ambiguous gates show unknown, not invented completion',()=>{
 for(const field of ['sourceReadStatus','rawProgressLimitReached','rawRecordLimitReached']){
  const p=payload();p.coverage[field]=field==='sourceReadStatus'?'partial_source_catalog':true;
  const v=projection(p,day);assert(v.progress.every(p=>!p.verified));assert.equal(v.tasks[0].scoringStatus,'source_unverified');
 }
 for(const alter of [p=>p.score.aPlus.requirements.shift(),p=>p.score.aPlus.requirements.push({...p.score.aPlus.requirements[0]}),p=>p.score.aPlus.requirements[0].status='source_validation_error']){
  const p=payload();alter(p);assert.equal(projection(p,day).progress[0].verified,false);
 }
});
test('anonymous visits make no progress request and create no persistent state',async()=>{
 let calls=0;const states=[];
 const c=controller({now,identity:()=>({getSession:async()=>({authenticated:false}),api:()=>{calls++;}}),render:r=>states.push(r)});
 await c.refresh();assert.equal(calls,0);assert.equal(states.at(-1).state,'anonymous');
 assert.doesNotMatch(source,/localStorage|sessionStorage|postMessage|syncProgress|recordEvent|method:\s*['"](?:POST|PUT)/);
});
test('one current-owner read uses fixed endpoint without owner selectors and rechecks session',async()=>{
 const calls=[],states=[];let sessions=0;
 const c=controller({now,identity:()=>({getSession:async()=>{sessions++;return session();},api:async path=>{calls.push(path);return payload();}}),render:r=>states.push(r)});
 await c.refresh();assert.equal(sessions,2);assert.deepEqual(calls,['/api/student-progress?date=2026-10-06&site=kz&limit=1']);assert.equal(states.at(-1).state,'ready');
});
test('account switch after read discards private response',async()=>{
 let n=0;const states=[];
 const c=controller({now,identity:()=>({getSession:async()=>session(++n),api:async()=>payload()}),render:r=>states.push(r)});
 await c.refresh();assert.equal(states.at(-1).state,'identity_changed');assert(states.every(s=>!s.view));
});
test('real public session shape needs its unique central slug, never a display name or private id',async()=>{
 for(const user of [{id:10},{displayName:'同名測試'},{slug:''}]){
  let calls=0;const states=[];
  const c=controller({now,identity:()=>({getSession:async()=>({authenticated:true,user}),api:async()=>{calls++;return payload();}}),render:r=>states.push(r)});
  await c.refresh();assert.equal(calls,0);assert.equal(states.at(-1).state,'anonymous');
 }
});
test('logout, hidden page or leaving mode invalidates an outstanding response',async()=>{
 const pending=deferred(),states=[];
 const c=controller({now,identity:()=>({getSession:async()=>session(),api:()=>pending.promise}),render:r=>states.push(r)});
 const done=c.refresh();await tick();c.clear();pending.resolve(payload());await done;
 assert.equal(states.at(-1).state,'idle');assert(states.every(s=>!s.view));
});
test('older request cannot replace a newer result and midnight needs a fresh read',async()=>{
 const first=deferred(),states=[];let n=0;
 const c=controller({now,identity:()=>({getSession:async()=>session(),api:()=>++n===1?first.promise:Promise.resolve(payload())}),render:r=>states.push(r)});
 const stale=c.refresh();await tick();await c.refresh();first.resolve(payload());await stale;
 assert.equal(states.filter(s=>s.state==='ready').length,1);
 let clock=Date.parse('2026-10-05T15:59:59Z');const midnight=[];
 const d=controller({now:()=>clock,identity:()=>({getSession:async()=>session(),api:async()=>{clock+=2000;return payload();}}),render:r=>midnight.push(r)});
 await d.refresh();assert.equal(midnight.at(-1).state,'date_changed');
});
test('failed and stalled reads clear previous results and have a bounded explicit retry',async()=>{
 for(const api of [async()=>{throw Error('offline');},()=>new Promise(()=>{})]){
  const states=[];const c=controller({now,deadlineMs:5,identity:()=>({getSession:async()=>session(),api}),render:r=>states.push(r)});
  await c.refresh();assert.equal(states.at(-1).state,'unavailable');assert(states.every(s=>!s.view));
 }
});
