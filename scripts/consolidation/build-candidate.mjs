import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildRegistry, inventoryPlan, sha256, stable } from './core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cfRoot=process.argv[2];
if(!cfRoot || !path.isAbsolute(cfRoot)) throw Error('absolute_workspace_root_required');
const read=(p)=>fs.readFileSync(p);
const parse=(p)=>JSON.parse(read(p));
const requireHash=(bytes,hash,label)=>{if(sha256(bytes)!==hash)throw Error(`${label}_source_changed`);};
const bundlePath=path.join(cfRoot,'apps/lunyu-yizhu-android/worker/public/content.json');
const bundleBytes=read(bundlePath),bundle=JSON.parse(bundleBytes);
requireHash(bundleBytes,'fc68413c7b70da0e1f14e36bb2229c4d9ae64fb8f26d75251f87d7457f8ffa75','weibian');
const kzBytes=read(path.join(root,'data/dialogues.json')),kz=JSON.parse(kzBytes);
requireHash(kzBytes,'8c9ebc18d6c6f0c156cad89aaab89f6a413cab0f9b2fa2fa7b65ac2b0d4400b1','kz');
const lyCommit='8cd43eef0a24b07a4240e69fadb582f21531fd7a';
const lyBytes=execFileSync('git',['-C',path.join(cfRoot,'sites/reading/lunyu-battle'),'show',`${lyCommit}:src/data/dialogues.json`],{maxBuffer:4*1024*1024});
requireHash(lyBytes,'7eab6ca6f0c4371f0e09afb091fac91287a6ce81a51759afb468b3cab36dac7c','ly');
const ly=JSON.parse(lyBytes);
if(kz.length!==ly.length || kz.some((r,i)=>r.id!==ly[i].id || ['text','translation','annotations'].some(f=>r[f]!==ly[i][f])))throw Error('ly_content_parity_failed');
const manifest=parse(path.join(root,'data/learning-manifest.json'));
const registry=buildRegistry(kz,manifest,bundle,{
  kz:{repository:'ieduer/lunyu',acceptedBase:'69674ff161ff2272ab97f3aa3fda97a8c10a8fb4',corpusSha256:sha256(kzBytes)},
  ly:{repository:'ieduer/lunyu-battle',acceptedBase:lyCommit,corpusSha256:sha256(lyBytes),unchangedContentFields:1623},
  weibian:{repository:'ieduer/lunyu-yizhu-android',contentVersion:'fc68413c7b70da0e',sha256:sha256(bundleBytes)},
  caveat:'Content equality and ID mapping verified; annotation interpretation and exam aliases remain subject to review.'
});
const planPath=path.join(cfRoot,'sites/tools/homework/source/plan.json'),planBytes=read(planPath);
requireHash(planBytes,'5ebf63164319fce7e4aa800857e4a55e33032930adc358bee6785658f7c26446','daily_plan');
const authority=parse(path.join(cfRoot,'sites/tools/homework/source/authority.json'));
if(authority.planDigest!=='d2a6d3e397b4f586e17bcf64855d947d35162acec17527b2e4ab1082c8828eca' || authority.catalogDigest!=='7a2dd4a1de8507a3542845a119b473625f146f4efc5682c7fd19b85f463c8624')throw Error('daily_authority_changed');
const impact=inventoryPlan(JSON.parse(planBytes));
impact.authority={planVersion:authority.planVersion,planDigest:authority.planDigest,catalogDigest:authority.catalogDigest};
impact.sourceBytesSha256=sha256(planBytes);
impact.consumerStatus={my:'live_readback_required',homework:'live_readback_required',ics:'live_readback_required',dot:'adopted_pins_required'};
const normalizePrompt=s=>s.replace(/^[\s（(]*[一二三四五六七八九十0-9①②③④⑤⑥⑦⑧⑨⑩]+[）).、．\s]*/u,'').replace(/\s/g,'');
const exams=bundle.gaokao.map(group=>{
  const candidates=new Map();for(const q of group.questions){const key=normalizePrompt(q.prompt);if(!candidates.has(key))candidates.set(key,[]);candidates.get(key).push(q.id);}
  return {groupId:group.id,sourceSha256:sha256(group),originalQuestionIds:group.questions.map(q=>q.id),
    candidateAliases:[...candidates.values()].filter(ids=>ids.length>1),reviewStatus:'original_paper_material_answer_and_attempt_review_required',mergeAllowed:false};
});
const outputs={
  'data/consolidation-registry.json':registry,
  'scripts/consolidation/daily-impact.json':impact,
  'scripts/consolidation/exam-review-queue.json':{schema:'analects-exam-review-v1',groups:exams,originalQuestions:exams.reduce((n,g)=>n+g.originalQuestionIds.length,0)},
};
const check=process.argv.includes('--check');
for(const [file,value] of Object.entries(outputs)){
  const bytes=`${JSON.stringify(value,null,2)}\n`,destination=path.join(root,file);
  if(check){if(!fs.existsSync(destination)||fs.readFileSync(destination,'utf8')!==bytes)throw Error(`candidate_stale:${file}`);}
  else fs.writeFileSync(destination,bytes);
}
console.log(JSON.stringify({status:check?'verified':'generated',registry:registry.counts,days:impact.dayCount,tasks:impact.taskCount,
  examQuestions:23,candidateAliasPairs:exams.reduce((n,g)=>n+g.candidateAliases.length,0),productionChanged:false,
  artifacts:Object.fromEntries(Object.entries(outputs).map(([p,v])=>[p,sha256(stable(v))]))}));
