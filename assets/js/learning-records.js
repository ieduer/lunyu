// Explicit learning content only. Unconfirmed identity is preserved locally, never adopted on login.
(function(root){
  const failure=code=>Object.assign(new Error(code),{code});
  function createInbox(indexedDB=root.indexedDB){
    let opening;
    const open=()=>opening ||= new Promise((resolve,reject)=>{
      if(!indexedDB){reject(failure('LEARNING_STORAGE_UNAVAILABLE'));return;}
      const req=indexedDB.open('kz-learning-capture-v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('captures',{keyPath:'id'});
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>{opening=null;reject(failure('LEARNING_STORAGE_UNAVAILABLE'));};
      req.onblocked=()=>reject(failure('LEARNING_STORAGE_BLOCKED'));
    });
    async function transaction(mode,run){
      const db=await open();return new Promise((resolve,reject)=>{
        const tx=db.transaction('captures',mode,{durability:'strict'});let result;
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(failure('LEARNING_STORAGE_WRITE_FAILED'));tx.onerror=()=>{};
        try{run(tx.objectStore('captures'),value=>{result=value;},tx);}catch(error){tx.abort();reject(error);}
      });
    }
    return {
      add:row=>transaction('readwrite',(s,set,tx)=>{const q=s.get(row.id);q.onsuccess=()=>{if(q.result){set(JSON.stringify(q.result)===JSON.stringify(row));return;}s.add(row);set(true);};}),
      list:()=>transaction('readonly',(s,set)=>{const q=s.getAll();q.onsuccess=()=>set(q.result);}),
      remove:id=>transaction('readwrite',s=>s.delete(id)),
    };
  }
  function createService(inbox=createInbox()){
    let ready=null,recorder=null,draining=null,generation=0;
    const states=new Set(),bindings=new WeakMap();
    const notify=state=>{for(const fn of states){try{fn(state);}catch{}}};
    const id=()=>root.crypto?.randomUUID?.() || `kz-op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    async function drain(r){
      if(draining)return draining.then(()=>drain(r));
      draining=(async()=>{
        let unowned=0,otherOwner=0;
        for(const row of await inbox.list()){
          if(!row.scope){unowned++;continue;}
          if(row.scope!==r.scope){otherOwner++;continue;}
          // The shared outbox acknowledges only after its own durable write.
          try {
            await r.record(row.operation);
            await inbox.remove(row.id);
          } catch(error) {
            // Keep exact bytes (including oversize payloads), but do not block other captures.
            notify({status:'needs_attention',code:error.code||'LEARNING_RECORDING_UNAVAILABLE'});
          }
        }
        if(unowned)notify({status:'unattributed',count:unowned});
        return {unowned,otherOwner};
      })().catch(error=>{notify({status:'needs_attention',code:error.code||'LEARNING_RECORDING_UNAVAILABLE'});throw error;}).finally(()=>{draining=null;});
      return draining;
    }
    async function prepare(){
      if(!ready){const epoch=generation;
        ready=(async()=>{
          const identity=root.BdfzIdentity;
          if(!identity?.createLearningRecorder)throw failure('LEARNING_RECORDER_NOT_READY');
          const session=await identity.getSession();
          if(!session?.authenticated)throw failure('LEARNING_LOGIN_REQUIRED');
          const r=await identity.createLearningRecorder({siteKey:'kz',onState:notify});
          if(epoch!==generation){r.close();throw failure('LEARNING_IDENTITY_CHANGED');}
          recorder=r;
          await drain(r);void r.flush().catch(()=>{});return r;
        })().catch(error=>{if(epoch===generation)ready=null;notify({status:'needs_attention',code:error.code||'LEARNING_RECORDING_UNAVAILABLE'});throw error;});
      }
      return ready;
    }
    function build(action,content,context={},options={}){
      const operation={operationId:options.operationId||id(),sessionKey:context.sessionKey,resourceKey:`chapter:${context.chapterId}`,resourceVersion:context.manifestVersion||'source-version-unavailable',action,actor:options.actor||'student',status:options.status||'observed',occurredAt:options.occurredAt||new Date().toISOString(),parentOperationId:options.parentOperationId||'',revisesOperationId:options.revisesOperationId||'',content,context:{chapterTitle:context.chapterTitle||'',chapterId:String(context.chapterId||''),interactionType:context.interactionType||'',contentOrigin:options.contentOrigin||'student',sourceVersion:'kz-learning-records-v1'},assessment:options.assessment||{}};
      bindings.set(operation,Object.prototype.hasOwnProperty.call(context,'captureScope')?context.captureScope:recorder?.scope||null);
      return operation;
    }
    async function record(operation){
      // Snapshot bytes and identity before any await, including authentication/module loading.
      const row={id:operation.operationId,scope:bindings.get(operation)||null,operation:JSON.parse(JSON.stringify(operation))};
      try{
        if(!await inbox.add(row))throw failure('LEARNING_OPERATION_LOCAL_CONFLICT');
        notify({status:row.scope?'saved_locally':'unattributed'});
        void prepare().then(r=>drain(r)).catch(()=>{});
        return {ok:true,queued:true,operationId:row.id,attribution:row.scope?'captured_scope':'unconfirmed'};
      }catch(error){notify({status:'storage_error',code:error.code||'LEARNING_STORAGE_WRITE_FAILED'});throw error;}
    }
    function invalidate(){generation++;recorder?.close();recorder=null;ready=null;}
    return {id,build,record,prepare,get scope(){return recorder?.scope||null;},pending:()=>inbox.list(),onState:fn=>{states.add(fn);return()=>states.delete(fn);},retry:async()=>{const r=await prepare();await drain(r);return r.retry();},invalidate,close:invalidate};
  }
  root.KzLearningRecordsFactory={createService,createInbox};
  root.KzLearningRecords=createService();
  root.addEventListener?.('bdfz:session-invalidated',()=>root.KzLearningRecords.invalidate());
  root.addEventListener?.('pagehide',()=>root.KzLearningRecords.invalidate());
  root.addEventListener?.('focus',()=>{root.KzLearningRecords.invalidate();void root.KzLearningRecords.prepare().catch(()=>{});});
})(typeof window==='undefined'?globalThis:window);
