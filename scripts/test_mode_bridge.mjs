import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../assets/js/analects-frame-bridge.js',import.meta.url),'utf8');
function fixture({referrer='https://kz.bdfz.net/?mode=battle',mode='battle',standalone=false}={}){
 const events=new Map(),docEvents=new Map(),sent=[],dispatched=[],parent={postMessage:(data,origin)=>sent.push({data,origin})};
 const root={document:{currentScript:{dataset:{analectsMode:mode}},referrer,readyState:'complete',addEventListener:(name,fn)=>docEvents.set(name,fn)},location:{href:'https://ly.bdfz.net/'},parent,addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent:event=>dispatched.push(event)};
 if(standalone)root.parent=root;
 vm.runInNewContext(source,{window:root,URL,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
 return{root,parent,sent,events,docEvents,dispatched};
}
test('standalone and untrusted framing install no bridge or login interception',()=>{
 for(const options of [{standalone:true},{referrer:'https://evil.example/'},{referrer:'https://kz.bdfz.net.evil.example/'},{referrer:'https://unrelated.pages.dev/'},{mode:'other'}]){
  const f=fixture(options);assert.equal(f.root.AnalectsHostBridge,undefined);assert.equal(f.sent.length,0);assert.equal(f.docEvents.size,0);
 }
});
test('ready has exact target origin and contains no identity, progress or answer data',()=>{
 const f=fixture();assert.equal(f.sent.length,1);assert.equal(f.sent[0].origin,'https://kz.bdfz.net');
 assert.deepEqual(JSON.parse(JSON.stringify(f.sent[0].data)),{protocol:'analects-host-v1',type:'ready',mode:'battle'});
 assert.equal(f.root.AnalectsHostBridge.visible,false);
});
test('visibility accepts only the exact parent, allowed origin, protocol, mode and boolean',()=>{
 const f=fixture(),valid={origin:'https://kz.bdfz.net',source:f.parent,data:{protocol:'analects-host-v1',type:'visibility',mode:'battle',visible:true}};
 for(const bad of [{...valid,source:{}},{...valid,origin:'https://evil.example'},{...valid,data:{...valid.data,mode:'fuzi'}},{...valid,data:{...valid.data,visible:'true'}},{...valid,data:{...valid.data,protocol:'wrong'}}])f.events.get('message')(bad);
 assert.equal(f.dispatched.length,0);assert.equal(f.root.AnalectsHostBridge.visible,false);
 f.events.get('message')(valid);assert.equal(f.root.AnalectsHostBridge.visible,true);
 f.events.get('message')({...valid,data:{...valid.data,visible:false}});assert.equal(f.root.AnalectsHostBridge.visible,false);assert.equal(f.dispatched.length,2);
});
test('login bridge strips return URL and all account data; unrelated and modified clicks remain untouched',()=>{
 const f=fixture();let prevented=0;
 const click=(href,extra={})=>f.docEvents.get('click')({target:{closest:()=>({href})},preventDefault:()=>prevented++,...extra});
 click('https://my.bdfz.net/?returnTo=https%3A%2F%2Fly.bdfz.net%2F');
 assert.equal(prevented,1);assert.deepEqual(Object.keys(f.sent[1].data).sort(),['mode','protocol','type']);assert.equal(f.sent[1].data.type,'login');
 click('https://evil.example/?returnTo=anything');click('https://my.bdfz.net/');click('https://my.bdfz.net/?returnTo=x',{ctrlKey:true});assert.equal(prevented,1);
});
const hostSource=readFileSync(new URL('../assets/js/analects-modes.js',import.meta.url),'utf8');
function hostFixture(){
 const events=new Map(),docEvents=new Map(),sent=[],redirects=[];
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.hidden=false;this.attributes={};if(tag==='iframe')this.contentWindow={postMessage:(data,origin)=>sent.push({data,origin})};}
  addEventListener(){}
  setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}append(...values){this.children.push(...values);}
 }
 const holder=new Element('div'),login=new Element('button'),location={href:'https://kz.bdfz.net/?mode=battle',assign:u=>redirects.push(u)};
 const root={document:{body:{dataset:{}},hidden:false,querySelectorAll:()=>[],getElementById:id=>id==='analects-modes'?holder:login,createElement:tag=>new Element(tag),addEventListener:(n,f)=>docEvents.set(n,f)},location,history:{pushState:(_s,_t,url)=>location.href=String(url)},addEventListener:(n,f)=>events.set(n,f),dispatchEvent(){},setTimeout:()=>1,clearTimeout(){}};
 vm.runInNewContext(hostSource,{window:root,URL,CustomEvent:class{constructor(type,o){this.type=type;this.detail=o.detail;}}});docEvents.get('DOMContentLoaded')();return{root,events,holder,sent,redirects};
}
test('host accepts readiness only from its own exact source frame and fixed origin',()=>{
 const f=hostFixture(),panel=f.holder.children[0],[status,frame]=panel.children;
 const valid={source:frame.contentWindow,origin:'https://ly.bdfz.net',data:{protocol:'analects-host-v1',type:'ready',mode:'battle'}};
 for(const event of [{...valid,source:{}},{...valid,origin:'https://evil.example'},{...valid,data:{...valid.data,protocol:'other'}}])f.events.get('message')(event);
 assert.equal(status.hidden,false);assert.equal(frame.hidden,true);f.events.get('message')(valid);assert.equal(status.hidden,true);assert.equal(frame.hidden,false);
 assert.equal(f.sent.at(-1).origin,'https://ly.bdfz.net');assert.equal(f.sent.at(-1).data.visible,true);
});
test('switches preserve frame objects and background frames cannot redirect login',()=>{
 const f=hostFixture(),original=f.holder.children[0],frame=original.children[1];
 f.root.AnalectsModes.select('fuzi');assert.equal(original.hidden,true);assert.equal(f.holder.children.length,2);
 const login={source:frame.contentWindow,origin:'https://ly.bdfz.net',data:{protocol:'analects-host-v1',type:'login',mode:'battle',url:'https://evil.example'}};
 f.events.get('message')(login);assert.equal(f.redirects.length,0);
 f.root.AnalectsModes.select('battle');assert.equal(f.holder.children[0],original);assert.equal(original.hidden,false);assert.equal(f.holder.children.length,2);
 f.root.AnalectsModes.select('https://evil.example');assert.equal(f.holder.children.length,2);
 f.events.get('message')(login);assert.equal(f.redirects.length,1);const target=new URL(f.redirects[0]);assert.equal(target.origin,'https://my.bdfz.net');assert.equal(new URL(target.searchParams.get('returnTo')).origin,'https://kz.bdfz.net');
});

test('today mode creates no child frame and preserves the full game when returning',()=>{
 const f=hostFixture(),original=f.holder.children[0];
 f.root.AnalectsModes.select('today');assert.equal(f.root.AnalectsModes.current,'today');
 assert.equal(f.holder.children.length,1);assert.equal(original.hidden,true);assert.equal(f.holder.hidden,true);
 f.root.AnalectsModes.select('battle');assert.equal(f.holder.children[0],original);assert.equal(original.hidden,false);
});

test('in-frame navigation re-establishes trust from an exact parent handshake without a ready loop',()=>{
 const f=fixture({referrer:'https://fuzi.bdfz.net/progress',mode:'fuzi'});
 assert.equal(f.root.AnalectsHostBridge,undefined);
 const message={source:f.parent,origin:'https://kz.bdfz.net',data:{protocol:'analects-host-v1',mode:'fuzi',type:'visibility',visible:true}};
 f.events.get('message')(message);assert.equal(f.root.AnalectsHostBridge.visible,true);assert.equal(f.sent.length,1);
 f.events.get('message')(message);assert.equal(f.sent.length,1);
});
