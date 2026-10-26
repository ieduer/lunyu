import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const app=readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
const recorderSource=readFileSync(new URL('../assets/js/learning-records.js',import.meta.url),'utf8');
const files=new Map(['dialogues.json','learning-manifest.json'].map(name=>[`data/${name}`,readFileSync(new URL(`../data/${name}`,import.meta.url),'utf8')]));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const element=()=>{const listeners=new Map();return {innerHTML:'',textContent:'',value:'',disabled:false,dataset:{},style:{},scrollTop:0,scrollHeight:0,
  appendChild(){},removeChild(){},contains:()=>false,setAttribute(){},querySelector:()=>null,querySelectorAll:()=>[],focus(){},
  addEventListener:(name,fn)=>listeners.set(name,fn),fire:(name,event)=>listeners.get(name)?.(event),
  classList:{add(){},remove(){},toggle(){},contains:()=>false}};};

// The real page: app.js, the shared capture service from learning-records.js and an identity SDK that may load late,
// refuse a signed-out reader or switch accounts. Captured rows are kept exactly as the inbox receives them; events
// records the order of inbox writes and provider requests.
function page({identityDelay=0,authenticated=true}={}){
  const listeners=new Map(),rows=[],events=[],local=new Map();
  const root={document:{currentScript:{dataset:{siteKey:'kz'}}},crypto:webcrypto,setTimeout,clearTimeout,
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{origin:'https://kz.bdfz.net',pathname:'/'},innerWidth:1200,
    addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);}};
  vm.createContext(root);vm.runInContext(recorderSource,root);
  root.BdfzLearningRecords=root.KzLearningRecords=root.BdfzLearningRecordsFactory.createService({add:async row=>{rows.push(row);events.push(`row:${row.operation.action}`);return true;},list:async()=>[],remove:async()=>{}});
  const identity={account:'owner-a',mount(){},createSessionKey:prefix=>`${prefix}-${webcrypto.randomUUID()}`,getSession:async()=>({authenticated}),
    createLearningRecorder:async()=>({scope:identity.account,record:async()=>{},flush:async()=>{},retry:async()=>{},close(){}})};
  if(identityDelay)setTimeout(()=>{root.BdfzIdentity=identity;},identityDelay);else root.BdfzIdentity=identity;
  const document={addEventListener(){},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>element(),body:{classList:{add(){},toggle(){},contains:()=>false}},title:''};
  const context=vm.createContext({console,setTimeout,clearTimeout,AbortSignal,TextEncoder,window:root,document,
    localStorage:{getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)},
    fetch:async(url,init)=>{
      if(files.has(url))return {ok:true,json:async()=>JSON.parse(files.get(url))};
      events.push('fetch:ai');assert.equal(init.headers['X-Request-ID'],rows.find(row=>row.operation.action==='ai.request')?.operation.operationId,'provider request carries the saved attempt id');
      return {ok:true,json:async()=>({answer:'synthetic reply',model:'test-model'})};
    }});
  vm.runInContext(app,context);
  context.__messages=element();context.__input=element();
  vm.runInContext('messagesEl=__messages;userInputEl=__input;bindEventListeners();resetConversationSession();',context);
  const run=code=>vm.runInContext(code,context);
  const captures=action=>rows.filter(row=>!action||row.operation.action===action)
    .map(row=>({action:row.operation.action,scope:row.scope,key:row.operation.resourceKey,version:row.operation.resourceVersion,at:row.operation.occurredAt,id:row.operation.operationId,parent:row.operation.parentOperationId,revises:row.operation.revisesOperationId}));
  return {run,root,identity,rows,events,captures,focus:()=>(listeners.get('focus')||[]).forEach(fn=>fn({}))};
}
const manifest=JSON.parse(files.get('data/learning-manifest.json')),version=`${manifest.manifestVersion}:${manifest.sourceSha256||'content-digest-unavailable'}`;

test('the random chapter shown at page load is owned by the student, with the time it was shown',async()=>{
  const p=page({identityDelay:400});
  const shownAt=new Date().toISOString();
  await p.run('loadDialogues()');
  assert.equal(p.captures().length,0,'nothing is stored before the owner is known');
  await wait(1200);
  const rows=p.captures('chapter.exposure');
  assert.equal(rows.length,1);
  assert.equal(rows[0].scope,'owner-a');
  assert.equal(rows[0].version,version);
  assert.ok(rows[0].at>=shownAt && Date.parse(rows[0].at)<Date.parse(shownAt)+400,'occurredAt is the moment it was shown, not when the owner resolved');
});

test('a chapter opened and a draft typed right after a window focus are owned instead of stored without an owner',async()=>{
  const p=page();
  await p.run('loadDialogues()');
  await p.root.KzLearningRecords.prepare();
  await wait(50);
  p.focus();
  assert.equal(p.root.KzLearningRecords.scope,null);
  const openedAt=new Date().toISOString();
  p.run('displayChapter(2)');
  p.run("userInputEl.value='學而時習之';userInputEl.fire('input',{inputType:'insertText'})");
  await wait(800);
  const [open]=p.captures('chapter.open'),[draft]=p.captures('draft.edit');
  assert.deepEqual([open.key,open.scope],['chapter:2','owner-a']);
  assert.ok(open.at>=openedAt && Date.parse(open.at)<Date.parse(openedAt)+200);
  assert.equal(draft.scope,'owner-a');
  assert.deepEqual(p.captures().filter(x=>!x.scope),[]);
});

test('an account switch during the wait is not adopted',async()=>{
  const p=page();
  await p.run('loadDialogues()');
  await p.root.KzLearningRecords.prepare();
  await wait(50);
  p.run('displayChapter(1)');
  p.identity.account='owner-b';
  p.focus();
  p.run('displayChapter(2)');
  await wait(800);
  assert.deepEqual(p.captures('chapter.open').map(x=>[x.key,x.scope]),[['chapter:1','owner-a'],['chapter:2',null]]);
  p.run('displayChapter(3)');
  await wait(100);
  assert.equal(p.captures('chapter.open').at(-1).scope,'owner-b','once the new recorder is ready, its own captures are owned');
});

test('a signed-out reader stays unattributed without a long wait',async()=>{
  const p=page({authenticated:false});
  const started=Date.now();
  await p.run('loadDialogues()');
  p.run('displayChapter(1)');
  await wait(600);
  assert.deepEqual(p.captures().map(x=>[x.action,x.scope]),[['chapter.exposure',null],['chapter.open',null]]);
  assert.ok(Date.now()-started<1500);
});

test('moving on while the owner resolves keeps each capture on its own chapter, time and id, in order',async()=>{
  const p=page({identityDelay:400});
  await p.run('loadDialogues()');
  p.run('displayChapter(1)');p.run('displayChapter(2)');p.run('displayChapter(3)');
  await wait(1200);
  const rows=p.captures('chapter.open');
  assert.deepEqual(rows.map(x=>[x.key,x.scope]),[['chapter:1','owner-a'],['chapter:2','owner-a'],['chapter:3','owner-a']]);
  assert.equal(new Set(rows.map(x=>x.id)).size,3);
  assert.ok(rows[0].at<=rows[1].at && rows[1].at<=rows[2].at);
});

test('a question asked right after a window focus: the answer, request and reply are owned and linked, and the provider waits for the saved request',async()=>{
  const p=page();
  await p.run('loadDialogues()');
  await p.root.KzLearningRecords.prepare();
  await wait(50);
  p.run("displayChapter(1);currentInteractionType='yang';");
  await wait(100);
  p.focus();
  p.run("userInputEl.value='為什麼要時習？';handleUserInput()");
  assert.ok(!p.events.includes('fetch:ai'),'no provider request before the request is saved');
  await wait(1000);
  const [submit]=p.captures('answer.submit'),[request]=p.captures('ai.request'),[reply]=p.captures('assistant.reply');
  assert.deepEqual([submit.scope,request.scope,reply.scope],['owner-a','owner-a','owner-a']);
  assert.equal(request.parent,submit.id);
  assert.equal(reply.parent,request.id);
  assert.ok(p.events.indexOf('row:ai.request')<p.events.indexOf('fetch:ai'));
  assert.equal(p.events.filter(x=>x==='fetch:ai').length,1);
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(conversationHistory.map(m=>m.captureScope))')),['owner-a','owner-a'],'the conversation archive sees one owner');
});

test('a capture made with a ready recorder is stored at once, unchanged',async()=>{
  const p=page();
  await p.run('loadDialogues()');
  await p.root.KzLearningRecords.prepare();
  await wait(50);
  const before=p.captures().length;
  p.run('displayChapter(5)');
  await Promise.resolve();await Promise.resolve();
  assert.equal(p.captures().length,before+1);
  assert.equal(p.captures().at(-1).scope,'owner-a');
});
