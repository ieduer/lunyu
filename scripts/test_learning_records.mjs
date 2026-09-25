import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/js/learning-records.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
function fixture(){const captured=[],states=[];const window={crypto:{randomUUID:()=> 'test-operation-0000000001'},BdfzIdentity:{getSession:async()=>({authenticated:true}),createLearningRecorder:async({onState})=>({scope:'a'.repeat(64),flush:async()=>({}),record:async o=>{captured.push(o);onState({status:'saved_locally'});return {ok:true};},retry:async()=>{},close(){}})}};const ctx=vm.createContext({window,console,Date,Math});vm.runInContext(source,ctx);const rows=new Map();const inbox={add:async r=>{const old=rows.get(r.id);if(old)return JSON.stringify(old)===JSON.stringify(r);rows.set(r.id,structuredClone(r));return true;},list:async()=>[...rows.values()],remove:async id=>rows.delete(id)};window.KzLearningRecords=window.KzLearningRecordsFactory.createService(inbox);window.KzLearningRecords.onState(s=>states.push(s));return {service:window.KzLearningRecords,window,captured,states,ctx,rows,inbox};}
const context={sessionKey:'test-session-000001',chapterId:'1',chapterTitle:'學而1.1',manifestVersion:'v1:sha',interactionType:'yang'};
test('full student draft and revisions retain precise operation time, stable identity and source context',async()=>{const f=fixture();await f.service.prepare();const operation=f.service.build('draft.edit',{text:'原句 < 新稿\n'+ '字'.repeat(30000)},context,{occurredAt:'2026-09-25T13:00:00Z',revisesOperationId:'test-operation-previous'});context.chapterId='2';await f.service.record(operation);await f.service.retry();assert.equal(f.captured[0].resourceKey,'chapter:1');assert.equal(f.captured[0].content.text.length,30008);assert.equal(f.captured[0].occurredAt,'2026-09-25T13:00:00Z');assert.equal(f.captured[0].revisesOperationId,'test-operation-previous');});
test('preparation/auth failure preserves exact local content without later login adoption',async()=>{
  const f=fixture();f.window.BdfzIdentity.getSession=async()=>({authenticated:false});
  const operation=f.service.build('draft.edit',{text:'synthetic < before login'},context);
  const receipt=await f.service.record(operation);assert.equal(receipt.attribution,'unconfirmed');assert.equal(f.rows.size,1);
  await assert.rejects(f.service.prepare(),e=>e.code==='LEARNING_LOGIN_REQUIRED');
  f.window.BdfzIdentity.getSession=async()=>({authenticated:true});await f.service.prepare();await f.service.retry();
  assert.equal(f.captured.length,0);assert.equal(f.rows.size,1);assert.equal([...f.rows.values()][0].operation.content.text,'synthetic < before login');
});
test('late reply preserves captured request owner after session invalidation',async()=>{
  const f=fixture();await f.service.prepare();const originalContext={...context,captureScope:f.service.scope};
  f.service.invalidate();f.window.BdfzIdentity.createLearningRecorder=async()=>({scope:'b'.repeat(64),flush:async()=>{},retry:async()=>{},record:async o=>{f.captured.push(o);},close(){}});
  await f.service.prepare();await f.service.record(f.service.build('assistant.reply',{text:'synthetic late reply'},originalContext));await f.service.retry();
  assert.equal(f.captured.length,0);assert.equal([...f.rows.values()][0].scope,'a'.repeat(64));
});
test('local inbox failure refuses durable acknowledgment and preserves error state',async()=>{
 const f=fixture();f.inbox.add=async()=>{throw new Error('full');};await assert.rejects(f.service.record(f.service.build('draft.edit',{text:'synthetic'},context)),/full/);assert.equal(f.states.at(-1).status,'storage_error');
});
test('printed translation and annotations are source text, not actual AI replies',()=>{assert.match(app,/translation\.reveal/);assert.match(app,/annotations\.reveal/);assert.match(app,/recordOptions\.contentOrigin === 'source_text' \? 'system'/);});
test('archive captures stable message IDs and timestamps before asynchronous identity lookup',()=>{const code=app.slice(app.indexOf('async function syncConversationArchive'),app.indexOf('/* ========== 初始化'));assert.ok(code.indexOf('const snapshot')<code.indexOf('await getAuthenticatedIdentity'));assert.match(code,/id: message.id/);assert.match(code,/createdAt: message.createdAt/);assert.doesNotMatch(code,/id: String\(index/);});
test('AI retries and replies remain tied to original session, with explicit failures and unknown model',()=>{assert.match(app,/requestContext.sessionKey !== conversationSessionKey/);assert.match(app,/askGemini\(prompt, callback, retryCount \+ 1, requestContext\)/);assert.match(app,/captureLearningOperation\('ai.failure'/);assert.match(app,/modelProvenance: typeof data.model === 'string' \? 'response_declared' : 'not_reported'/);});

test('provider request waits for durable attempt and never runs when persistence fails',async()=>{
  const askSource=app.slice(app.indexOf('async function askGemini('),app.indexOf('// AI 導師指令'));
  let resolveSaved,rejectSaved,fetches=0;
  const saved=new Promise((resolve,reject)=>{resolveSaved=resolve;rejectSaved=reject;});
  const base={console,setTimeout,conversationSessionKey:'s',lastStudentOperationId:'parent',isWaitingForAI:false,
    learningContext:()=>({sessionKey:'s'}),showLearningRecordState(){},disableInteractionButtons(){},enableInteractionButtons(){},removeLoadingMessage(){},
    captureLearningOperation:()=>({operation:{operationId:'attempt'},saved}),CLOUD_FLARE_WORKER_URL:'https://example.invalid',
    fetch:async()=>{fetches++;return {ok:true,json:async()=>({answer:'synthetic'})};}};
  const ctx=vm.createContext(base);vm.runInContext(askSource,ctx);
  const running=ctx.askGemini('synthetic',()=>{});await Promise.resolve();assert.equal(fetches,0);
  resolveSaved();await running;assert.equal(fetches,1);
  const failure=vm.createContext({...base,captureLearningOperation:()=>({operation:{operationId:'failed'},saved:Promise.reject(new Error('storage'))})});
  vm.runInContext(askSource,failure);let reported=false;
  await failure.askGemini('synthetic',(_text,isError)=>{reported=isError;});assert.equal(fetches,1);assert.equal(reported,true);
});
