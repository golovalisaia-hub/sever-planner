(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const panel = $('#severAiPanel');
  if (!panel) return;
  let controller = null, pending = null, generation = 0, returnFocus = null;
  const settings = () => ({enabled:true,guide:true,memory:false,...window.SeverApp?.getState?.().aiSettings});
  const sessionId = () => window.SeverCloud?.user?.id || '';
  const current = (id, version) => id === sessionId() && version === generation;
  const assertCurrent = (id, version) => { if (!current(id, version)) throw new DOMException('Account changed','AbortError'); };
  // Drafts and conversation stay in this tab, never in shared localStorage.
  function addMessage(role, value) {
    const row=document.createElement('div'), bubble=document.createElement('p');
    row.className='sever-ai-message '+role; bubble.textContent=value;
    row.append(bubble); $('#severAiMessages').append(row);
    while ($('#severAiMessages').children.length>60) $('#severAiMessages').firstElementChild.remove();
    bubble.scrollIntoView({block:'end'}); return bubble;
  }
  function open() {
    if (!settings().enabled) return;
    returnFocus=document.activeElement; panel.inert=false;
    panel.classList.add('open'); panel.setAttribute('aria-hidden','false');
    $('#severAiOpen').setAttribute('aria-expanded','true');
    requestAnimationFrame(()=>$('#severAiInput').focus());
  }
  function close() {
    panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); panel.inert=true;
    $('#severAiOpen').setAttribute('aria-expanded','false');
    if(returnFocus?.isConnected)returnFocus.focus();
  }
  function resetAccount() {
    generation++;controller?.abort();controller=null;pending=null;
    $('#severAiMessages').replaceChildren();$('#severAiInput').value='';
    $('#severAiMemoryList').replaceChildren();$('#severAiMemoryDialog').close();
    $('#severAiConfirm').classList.add('hidden');busy(false);close();
    queueMicrotask(syncSettings);
  }
  function busy(value) {
    $('#severAiSend').disabled=value;$('#severAiConfirm').disabled=value;
    $('#severAiCancel').classList.toggle('hidden',!value);
    panel.setAttribute('aria-busy',String(value));
  }
  const guide = {
    'create-task':{page:'today',selectors:['#globalAddBtn','#mobileCreateBtn']},
    notes:{page:'notes',selectors:['[data-view="notes"]','#openNote']},
    timer:{page:'timer',selectors:['#timerToggle']},
    progress:{page:'progress',selectors:['#progressView']},
    settings:{page:'settings',selectors:['#settingsView']},
    'ai-button':{selectors:['#severAiOpen']}
  };
  for(const [name,item] of Object.entries(guide))
    for(const selector of item.selectors)
      document.querySelectorAll(selector).forEach(el=>el.dataset.aiGuide=name);
  function highlight(target) {
    if(!settings().guide)throw new Error('AI Guide отключён в Настройках.');
    const item=guide[target];if(!item)throw new Error('Элемент гида не найден.');
    if(item.page)window.SeverApp.switchView(item.page);
    close();
    const el=[...document.querySelectorAll('[data-ai-guide="'+target+'"]')].find(el=>el.getClientRects().length);
    if(!el)throw new Error('Элемент сейчас недоступен.');
    el.classList.add('sever-ai-highlight');el.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>el.classList.remove('sever-ai-highlight'),5000);
  }
  async function api(method,body,{signal,stream=false,id=sessionId(),version=generation,query=''}={}) {
    if(!id)throw new Error('Войдите в аккаунт, чтобы использовать Sever AI.');
    const client=await window.SeverSupabase.getClient();
    const {data:{session},error}=await client.auth.getSession();
    assertCurrent(id,version);
    if(error||session?.user?.id!==id)throw new Error('Сессия изменилась. Войдите снова.');
    const config=window.SEVER_SUPABASE_CONFIG;
    const response=await fetch(config.url+'/functions/v1/sever-ai'+query,{
      method,signal,headers:{Authorization:'Bearer '+session.access_token,apikey:config.anonKey,
        'Content-Type':'application/json',Accept:stream?'text/event-stream':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    assertCurrent(id,version);
    if(!response.ok) {
      const data=await response.json().catch(()=>({}));
      throw new Error(data.message||'Sever AI сейчас недоступен. Остальные функции работают как обычно.');
    }
    return response;
  }
  async function readStream(response,onText) {
    if(!response.headers.get('content-type')?.includes('text/event-stream'))return response.json();
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='',result=null,total=0;
    const consume=event=>{
      const lines=event.split('\n'),type=lines.find(x=>x.startsWith('event:'))?.slice(6).trim();
      const payload=lines.filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n');
      if(!payload)return;const data=JSON.parse(payload);
      if(type==='delta')onText(data.text);
      if(type==='error')throw new Error(data.message||'Ответ AI прервался.');
      if(type==='final')result=data;
    };
    try {
      while(true) {
        const chunk=await reader.read();if(chunk.done)break;
        total+=chunk.value.length;if(total>500000)throw new Error('Слишком длинный ответ.');
        buffer+=decoder.decode(chunk.value,{stream:true}).replace(/\r/g,'');
        let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}
      }
      if(!result)throw new Error('Ответ прервался. Проверьте данные перед повтором команды.');
      return result;
    }finally{await reader.cancel().catch(()=>{});}
  }
  function previewText(action) {
    const value=action.preview?.preview;
    if(value?.plan) {
      const p=value.plan,d=p.data;
      return p.title+'\n'+(d.schedule?d.schedule.map(x=>x.date+' — '+x.amount+' '+d.currency).join('\n'):
        'С '+d.startDate+' по '+d.deadline+', '+value.tasks.length+' задач по '+d.durationMinutes+' мин')+
        '\nБудут созданы реальные задачи в календаре.';
    }
    return action.preview?.name==='memory.remember'?'Сохранить в памяти: '+value?.content:
      'Удалить: '+(value?.title||'выбранную запись')+'?';
  }
  async function applyResult(data,id,version) {
    assertCurrent(id,version);
    const action=data.result?.clientAction;
    if(action?.name==='navigation.open') {
      if(!settings().guide)throw new Error('AI Guide отключён в Настройках.');
      window.SeverApp.switchView(action.arguments.page);
    }
    if(action?.name==='guide.highlight')highlight(action.arguments.target);
    if(action?.name==='timer.start')window.SeverApp.startTimer(action.arguments);
    if(action?.name==='timer.stop')window.SeverApp.stopTimer();
    if(action?.name==='timer.get')data.message=window.SeverApp.getTimerStatus();
    if(/^(task|note|plan)\.(create|update|move|complete|delete)$/.test(data.tool||'')&&data.result) {
      await window.SeverCloud.pull();assertCurrent(id,version);
      if(window.SeverCloud.lastErrorCode)data.message+='\nСохранено на сервере; обновление устройства ожидает синхронизации.';
    }
    pending=data.pendingAction||null;
    $('#severAiConfirm').classList.toggle('hidden',!pending);
    if(pending)data.message+='\n'+previewText(pending);
    return data.message;
  }
  async function send(event,confirmationToken=null) {
    event?.preventDefault();if(controller)return;
    const input=$('#severAiInput'),message=input.value.trim();
    if(!confirmationToken&&!message)return;
    const id=sessionId(),version=generation;
    const capturedContext=window.SeverApp.getContext();
    const requestController=new AbortController();controller=requestController;busy(true);
    if(!confirmationToken){pending=null;$('#severAiConfirm').classList.add('hidden');addMessage('user',message);input.value='';}
    const status=addMessage('assistant','Соединяюсь…');
    const timeout=setTimeout(()=>requestController.abort(),30000);
    try {
      if(!settings().enabled)throw new Error('AI отключён в Настройках.');
      const cloud=window.SeverCloud;
      if(!id||!cloud?.hydrated||cloud.localOnly)throw new Error('Войдите в аккаунт и дождитесь синхронизации.');
      if(!navigator.onLine)throw new Error('Нет интернета. Текст сохранён.');
      cloud.capture();await cloud.flush();assertCurrent(id,version);
      if(cloud.running||cloud.queued.length)throw new Error('Сначала дождитесь отправки изменений в облако.');
      const response=await api('POST',{requestId:crypto.randomUUID(),message,context:capturedContext,
        memoryEnabled:settings().memory,...(confirmationToken?{confirmationToken}:{})},
        {signal:requestController.signal,stream:!confirmationToken,id,version});
      const data=await readStream(response,text=>{if(current(id,version))status.textContent='Подготавливаю действие…\n'+text;});
      assertCurrent(id,version);
      status.textContent=await applyResult(data,id,version);
    }catch(error) {
      if(current(id,version)){
        status.textContent=error.name==='AbortError'?'Запрос остановлен. Если действие уже началось, оно могло сохраниться — проверьте календарь перед повтором.':error.message;
        if(!confirmationToken&&!input.value)input.value=message;
      }
    }finally {
      clearTimeout(timeout);
      if(current(id,version)){controller=null;busy(false);}
    }
  }
  function syncSettings() {
    const value=settings();
    for(const [id,key] of [['severAiEnabled','enabled'],['severAiGuideEnabled','guide'],['severAiMemorySetting','memory'],['severAiMemory','memory']])$('#'+id).checked=Boolean(value[key]);
    $('#severAiOpen').hidden=!value.enabled;
    if(!value.enabled){controller?.abort();close();}
    $('#severAiProactive').checked=false;$('#severAiProactive').disabled=true;
    $('#severAiProactive').closest('label').title='Проактивные подсказки пока не включены: Sever не пишет первым.';
  }
  for(const [id,key] of [['severAiEnabled','enabled'],['severAiGuideEnabled','guide'],['severAiMemorySetting','memory'],['severAiMemory','memory']])
    $('#'+id).addEventListener('change',async event=>{await window.SeverApp.saveAiSettings({...settings(),[key]:event.target.checked});syncSettings();});
  async function showMemory() {
    const id=sessionId(),version=generation,list=$('#severAiMemoryList');
    list.replaceChildren();$('#severAiMemoryDialog').showModal();
    const info=document.createElement('p');info.textContent='Загружаю…';list.append(info);
    try {
      const data=await(await api('GET',null,{id,version})).json();assertCurrent(id,version);
      list.replaceChildren();
      for(const item of data.memories) {
        const row=document.createElement('section'),input=document.createElement('textarea'),save=document.createElement('button'),remove=document.createElement('button');
        input.value=item.content;input.maxLength=300;input.setAttribute('aria-label','Запись памяти');
        save.textContent='Сохранить';remove.textContent='Удалить';
        const mutate=async(method,body,query='')=>{
          save.disabled=remove.disabled=true;
          try{await api(method,body,{id,version,query});assertCurrent(id,version);if(method==='DELETE')row.remove();}
          catch(error){if(current(id,version))addMessage('assistant',error.message);}
          finally{save.disabled=remove.disabled=false;}
        };
        save.onclick=()=>mutate('PATCH',{id:item.id,content:input.value});
        remove.onclick=()=>mutate('DELETE',null,'?id='+encodeURIComponent(item.id));
        row.append(input,save,remove);list.append(row);
      }
      if(!data.memories.length){info.textContent='Память пуста. Напишите «запомни…» и подтвердите сохранение.';list.append(info);}
      if(data.plans.length) {
        const heading=document.createElement('h3');heading.textContent='Ваши планы';list.append(heading);
        for(const plan of data.plans){const row=document.createElement('p');row.textContent=plan.title+' · '+({active:'Активен',paused:'На паузе',completed:'Завершён'}[plan.status]||plan.status);list.append(row);}
      }
    }catch(error){if(current(id,version))info.textContent=error.message;}
  }
  $('#severAiOpen').addEventListener('click',open);
  $('#severAiClose').addEventListener('click',close);
  $('#severAiForm').addEventListener('submit',send);
  $('#severAiCancel').addEventListener('click',()=>controller?.abort());
  $('#severAiConfirm').textContent='Подтвердить';
  $('#severAiConfirm').addEventListener('click',()=>pending&&send(null,pending.token));
  $('#severAiManageMemory').addEventListener('click',showMemory);
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  window.addEventListener('sever:account-scope',resetAccount);
  window.addEventListener('sever:cloud-status',syncSettings);
  panel.inert=true;$('#severAiOpen').setAttribute('aria-controls','severAiPanel');
  syncSettings();
  window.SeverAI={open,close,highlight};
})();
