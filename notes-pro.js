const NOTE_CRYPTO_ITERATIONS = 600000;
let editingNoteItems=[];
let editingNoteType='text';
function noteProgress(note){const items=Array.isArray(note.items)?note.items:[];if(items.length)return Math.round(items.filter(item=>item.done).length/items.length*100);if(note.done)return 100;return Math.max(0,Math.min(100,Number(note.progress)||0))}
function setAllNoteItems(note,done){(note.items||[]).forEach(item=>item.done=done);note.done=Boolean(done&&(note.items||[]).length);note.updatedAt=Date.now()}
function setNoteType(type){editingNoteType=type==='checklist'?'checklist':'text';$$('[data-note-type]').forEach(button=>button.classList.toggle('active',button.dataset.noteType===editingNoteType));$('#checklistEditor').classList.toggle('hidden',editingNoteType!=='checklist');$('#noteBodyLabel').textContent=editingNoteType==='checklist'?'Описание — необязательно':'Текст заметки';$('#noteBody').placeholder=editingNoteType==='checklist'?'Описание списка':'Запиши мысли или важную информацию';if(editingNoteType==='checklist'&&!editingNoteItems.length){editingNoteItems.push({id:uid(),text:'',done:false});renderNoteItemsEditor()}}
function renderNoteItemsEditor(){const root=$('#noteItemsEditor');root.innerHTML='';editingNoteItems.forEach((item,index)=>{const row=document.createElement('div');row.className='note-item-editor';row.innerHTML='<input type="checkbox" aria-label="Пункт выполнен"><input type="text" maxlength="160" placeholder="Название пункта"><button type="button" aria-label="Удалить пункт">×</button>';const checkbox=row.children[0],input=row.children[1],remove=row.children[2];checkbox.checked=Boolean(item.done);checkbox.onchange=()=>item.done=checkbox.checked;input.value=item.text;input.oninput=()=>item.text=input.value;input.onkeydown=event=>{if(event.key!=='Enter')return;event.preventDefault();item.text=input.value;editingNoteItems.splice(index+1,0,{id:uid(),text:'',done:false});renderNoteItemsEditor();$$('#noteItemsEditor input[type="text"]')[index+1]?.focus()};remove.onclick=()=>{editingNoteItems.splice(index,1);renderNoteItemsEditor()};root.appendChild(row)})}
$$('[data-note-type]').forEach(button=>button.onclick=()=>setNoteType(button.dataset.noteType));$('#openNote').onclick=()=>openNote();$('#addNoteItem').onclick=()=>{editingNoteItems.push({id:uid(),text:'',done:false});renderNoteItemsEditor();const inputs=$$('#noteItemsEditor input[type="text"]');inputs.at(-1)?.focus()};
const noteCrypto = window.SeverProtectedNotesCrypto;
const unlockedNotes = new Map();
let activeFolderId = 'all';
let pendingUnlockNote = null;
let pendingUnlockEdit = false;
let noteSearchQuery = '';
function ensureNoteCollections() { state.folders = Array.isArray(state.folders) ? state.folders : []; state.notes.forEach(note => note.folderId ??= ''); }
ensureNoteCollections();
async function protectNotePayload(payload, password) { return noteCrypto.protect(payload, password, NOTE_CRYPTO_ITERATIONS); }
async function unlockNotePayload(note, password) { return noteCrypto.unlock(note.secure, password); }
async function saveUnlockedProtectedNote(note, payload) { const unlocked = unlockedNotes.get(note.id); if (!unlocked) throw new Error('Note is locked'); note.secure = await noteCrypto.sealWithMaterial(payload, unlocked.material, NOTE_CRYPTO_ITERATIONS); note.updatedAt = Date.now(); unlocked.payload = payload; unlocked.lastActivityAt = Date.now(); await save(); }

function folderName(folderId) {
  return state.folders.find(folder => folder.id === folderId)?.name || 'Без папки';
}

function renderFolderSelect(selected = '') {
  const select = $('#noteFolder');
  select.innerHTML = '<option value="">Без папки</option>';
  state.folders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  });
  select.value = state.folders.some(folder => folder.id === selected) ? selected : '';
}

function renderFolders() {
  ensureNoteCollections();
  if (activeFolderId !== 'all' && activeFolderId !== 'none' && !state.folders.some(folder => folder.id === activeFolderId)) activeFolderId = 'all';
  const notesContext = $('#notesContext');
  if (notesContext) {
    const activeFolder = state.folders.find(folder => folder.id === activeFolderId);
    notesContext.textContent = activeFolderId === 'all'
      ? 'МЫСЛИ И РЕЗУЛЬТАТЫ'
      : activeFolderId === 'none'
        ? 'ПАПКА · БЕЗ ПАПКИ'
        : `ПАПКА · ${activeFolder?.name || 'ЗАМЕТКИ'}`;
  }
  $('#manageFolder').classList.toggle('hidden', activeFolderId === 'all' || activeFolderId === 'none');
  const root = $('#folderTabs');
  root.innerHTML = '';
  const entries = [
    { id: 'all', name: 'Все', count: state.notes.length },
    { id: 'none', name: 'Без папки', count: state.notes.filter(note => !note.folderId).length },
    ...state.folders.map(folder => ({ id: folder.id, name: folder.name, count: state.notes.filter(note => note.folderId === folder.id).length }))
  ];
  entries.forEach(entry => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = entry.id === activeFolderId ? 'active' : '';
    button.setAttribute('aria-pressed', String(entry.id === activeFolderId));
    const name = document.createElement('span');
    const count = document.createElement('b');
    name.textContent = entry.name;
    count.textContent = entry.count;
    button.append(name, count);
    button.onclick = () => {
      activeFolderId = entry.id;
      renderFolders();
      renderNotes();
    };
    root.appendChild(button);
  });
}

function askToUnlock(note, editAfter = false) {
  pendingUnlockNote = note;
  pendingUnlockEdit = editAfter;
  $('#unlockPassword').value = '';
  $('#unlockError').classList.add('hidden');
  $('#unlockDialog').showModal();
  requestAnimationFrame(() => $('#unlockPassword').focus());
}

function visibleNoteData(note) {
  return note.protected ? unlockedNotes.get(note.id)?.payload || null : note;
}

function renderNotes() {
  ensureNoteCollections();
  syncProtectedNoteSecuritySettings();
  renderFolders();
  const root = $('#noteList');
  root.innerHTML = '';
  const filtered = state.notes.filter(note => {
    const inFolder = activeFolderId === 'all' || (activeFolderId === 'none' ? !note.folderId : note.folderId === activeFolderId);
    if (!inFolder) return false;
    if (!noteSearchQuery || note.protected && !visibleNoteData(note)) return true;
    const data = visibleNoteData(note);
    return `${data.title || ''}\n${data.body || ''}\n${(data.items || []).map(item => item.text).join(' ')}`.toLocaleLowerCase('ru-RU').includes(noteSearchQuery);
  });
  if (!filtered.length) {
    root.innerHTML = empty(activeFolderId === 'all' ? 'Заметок пока нет. Создай обычную запись или чек-лист.' : 'В этой папке пока нет заметок.');
    return;
  }
  [...filtered].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach(note => {
    const data = visibleNoteData(note);
    const locked = note.protected && !data;
    const card = document.createElement('article');
    card.className = `note-card${locked ? ' secure-note locked' : ''}`;
    if (locked) {
      card.innerHTML = '<div class="secure-note-head"><span class="secure-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><div><small>ЗАЩИЩЕНО ПАРОЛЕМ</small><h3>Закрытая заметка</h3></div></div><p class="secure-description">Название и содержимое зашифрованы. Введи пароль, чтобы открыть заметку.</p><div class="note-card-footer"><span class="folder-badge"></span><button class="unlock-note" type="button">Открыть</button></div>';
      card.querySelector('.folder-badge').textContent = folderName(note.folderId);
      card.querySelector('.unlock-note').onclick = () => askToUnlock(note);
      root.appendChild(card);
      return;
    }

    const items = data.items || [];
    const isChecklist = data.kind === 'checklist';
    const progress = noteProgress(data);
    card.className += ` ${isChecklist ? 'checklist-note' : 'text-note'}${isChecklist && progress === 100 ? ' complete' : ''}${note.protected ? ' secure-note unlocked' : ''}`;
    const progressMarkup = isChecklist
      ? `<div class="note-ring" aria-label="Выполнено ${progress}%"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="track" cx="40" cy="40" r="34"></circle><circle class="value" cx="40" cy="40" r="34" style="stroke-dashoffset:${213.63 * (1 - progress / 100)}"></circle></svg><b>${progress}%</b></div>`
      : `<span class="note-kind">${note.protected ? 'ОТКРЫТА' : 'ЗАМЕТКА'}</span>`;
    card.innerHTML = `<div class="note-card-head"><h3></h3>${progressMarkup}</div><p class="note-body"></p><div class="note-checklist"></div><div class="note-card-footer"><div><span class="folder-badge"></span><time></time></div><div class="note-card-actions"></div></div>`;
    card.querySelector('h3').textContent = data.title;
    card.querySelector('.folder-badge').textContent = folderName(note.folderId);
    const body = card.querySelector('.note-body');
    body.textContent = data.body || (!isChecklist ? 'Пустая заметка' : '');
    body.classList.toggle('hidden', !body.textContent);
    const checklist = card.querySelector('.note-checklist');
    if (isChecklist) {
      if (items.length) {
        items.forEach(item => {
          const label = document.createElement('label');
          label.className = `note-check${item.done ? ' done' : ''}`;
          label.innerHTML = '<input type="checkbox"><span></span>';
          const checkbox = label.querySelector('input');
          checkbox.checked = Boolean(item.done);
          label.querySelector('span').textContent = item.text;
          checkbox.onchange = async () => {
            item.done = checkbox.checked;
            data.done = items.every(step => step.done);
            note.updatedAt = Date.now();
            if (note.protected) await saveUnlockedProtectedNote(note, data); else await save();
            renderNotes();
          };
          checklist.appendChild(label);
        });
      } else checklist.innerHTML = '<p class="note-empty-list">Добавь пункты через «Изменить».</p>';
    }
    const actions = card.querySelector('.note-card-actions');
    if (isChecklist && items.length) {
      const toggle = document.createElement('button');
      toggle.className = 'note-toggle-all';
      toggle.type = 'button';
      const allDone = items.every(item => item.done);
      toggle.textContent = allDone ? 'Снять все' : 'Отметить всё';
      toggle.onclick = async () => {
        setAllNoteItems(data, !allDone);
        if (note.protected) await saveUnlockedProtectedNote(note, data); else await save();
        renderNotes();
        toast(allDone ? 'Отметки сняты' : 'Все пункты выполнены');
      };
      actions.appendChild(toggle);
    }
    if (note.protected) {
      const lock = document.createElement('button');
      lock.className = 'note-lock-now';
      lock.type = 'button';
      lock.textContent = 'Заблокировать';
      lock.onclick = () => lockProtectedNote(note.id, true);
      actions.appendChild(lock);
    }
    const edit = document.createElement('button');
    edit.className = 'note-edit';
    edit.type = 'button';
    edit.textContent = 'Изменить';
    edit.onclick = () => openNote(note);
    actions.appendChild(edit);
    card.querySelector('time').textContent = `Обновлено ${new Date(note.updatedAt || Date.now()).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
    root.appendChild(card);
  });
};

async function openNote(note = null) {
  if (note?.protected && !unlockedNotes.has(note.id)) {
    askToUnlock(note, true);
    return;
  }
  const data = note?.protected ? unlockedNotes.get(note.id).payload : note;
  window.SeverUiState?.begin('noteDialog', { domain: 'notes', entityId: note?.id || '' });
  $('#noteDialogTitle').textContent = note ? 'Изменить заметку' : 'Новая заметка';
  $('#noteId').value = note?.id || '';
  $('#noteTitle').value = data?.title || '';
  $('#noteBody').value = data?.body || '';
  editingNoteItems = (data?.items || []).map(item => ({ ...item }));
  $('#deleteNote').classList.toggle('hidden', !note);
  renderFolderSelect(note?.folderId || (activeFolderId !== 'all' && activeFolderId !== 'none' ? activeFolderId : ''));
  setNoteType(data?.kind || ((data?.items || []).length ? 'checklist' : 'text'));
  renderNoteItemsEditor();
  $('#noteProtected').checked = Boolean(note?.protected);
  $('#notePassword').value = '';
  $('#notePasswordWrap').classList.toggle('hidden', !note?.protected);
  $('#notePasswordHint').textContent = note?.protected
    ? 'Оставь поле пустым, чтобы сохранить текущий пароль, или введи новый.'
    : 'Пароль не сохраняется. Если его забыть, заметку нельзя будет восстановить.';
  $('#noteDialog').showModal();
};

$('#noteProtected').onchange = event => {
  $('#notePasswordWrap').classList.toggle('hidden', !event.target.checked);
  if (event.target.checked) $('#notePassword').focus();
};

$('#noteForm').onsubmit = async event => {
  event.preventDefault();
  const id = $('#noteId').value;
  const existing = state.notes.find(note => note.id === id);
  const items = editingNoteItems.map(item => ({ id: item.id || uid(), text: item.text.trim(), done: Boolean(item.done) })).filter(item => item.text);
  const payload = {
    title: $('#noteTitle').value.trim(),
    body: $('#noteBody').value.trim(),
    kind: editingNoteType,
    items,
    done: editingNoteType === 'checklist' && items.length ? items.every(item => item.done) : false
  };
  const folderId = $('#noteFolder').value;
  const wantsProtection = $('#noteProtected').checked;
  const newPassword = $('#notePassword').value;

  try {
    if (wantsProtection && !crypto?.subtle) throw new Error('Шифрование не поддерживается этим браузером');
    if (wantsProtection && !existing?.protected && !newPassword && !unlockedNotes.has(id)) throw new Error('Введите пароль для защищённой заметки');
    if (wantsProtection && newPassword && newPassword.length < 12 && !confirm('Короткий пароль легче подобрать. Рекомендуем 12 или больше символов. Сохранить с этим паролем?')) return;

    let note = existing;
    if (!note) {
      note = { id: id || uid(), folderId, createdAt: Date.now(), updatedAt: Date.now() };
      state.notes.push(note);
      clearSyncTombstone('notes', note.id);
    }
    note.folderId = folderId;
    note.updatedAt = Date.now();

    if (wantsProtection) {
      let protectedData;
      if (newPassword) protectedData = await protectNotePayload(payload, newPassword);
      else {
        const unlocked = unlockedNotes.get(note.id);
        if (!unlocked) throw new Error('Сначала разблокируй заметку');
        protectedData = { ...unlocked, payload, secure: await noteCrypto.sealWithMaterial(payload, unlocked.material, NOTE_CRYPTO_ITERATIONS) };
      }
      Object.assign(note, { title: '', body: '', kind: 'protected', items: [], done: false, protected: true, secure: protectedData.secure });
      unlockedNotes.set(note.id, { payload, material: protectedData.material, unlockedAt: Date.now(), lastActivityAt: Date.now() });
    } else {
      Object.assign(note, payload, { protected: false });
      delete note.secure;
      unlockedNotes.delete(note.id);
    }
    await save();
    const hadConflict = window.SeverUiState?.consumeConflict('noteDialog');
    $('#noteDialog').close();
    renderNotes();
    toast(hadConflict ? 'Заметка сохранена. Изменение с другого устройства заменено.' : wantsProtection ? 'Заметка зашифрована' : editingNoteType === 'checklist' ? 'Чек-лист сохранён' : 'Заметка сохранена');
  } catch (error) {
    toast(error.message || 'Не удалось сохранить заметку');
  }
};

$('#deleteNote').onclick = () => {
  const id = $('#noteId').value;
  const note = state.notes.find(item => item.id === id); const index = state.notes.findIndex(item => item.id === id); if (!note) return;
  const snapshot = cloneValue(note); unlockedNotes.delete(id); state.notes.splice(index, 1); save(); renderNotes();
  $('#noteDialog').close();
  toast('Заметка удалена', { type: 'note-delete', note: snapshot, index });
};

$('#unlockForm').onsubmit = async event => {
  event.preventDefault();
  if (!pendingUnlockNote) return;
  const button = $('#unlockForm .primary');
  button.disabled = true;
  button.textContent = 'Открываем…';
  try {
    const note = pendingUnlockNote, editAfter = pendingUnlockEdit;
    const unlocked = await unlockNotePayload(note, $('#unlockPassword').value);
    unlockedNotes.set(note.id, unlocked); touchUnlockedNote(note.id);
    $('#unlockPassword').value = ''; pendingUnlockNote = null; pendingUnlockEdit = false;
    $('#unlockDialog').close(); $('#unlockError').classList.add('hidden'); renderNotes();
    if (editAfter) await openNote(note);
    else toast('Заметка открыта');
  } catch {
    $('#unlockError').classList.remove('hidden');
    $('#unlockPassword').select();
  } finally {
    button.disabled = false;
    button.textContent = 'Открыть заметку';
  }
};

function openFolderDialog() {
  window.SeverUiState?.begin('folderDialog', { domain: 'folders' });
  $('#folderForm').reset();
  $('#folderDialog').showModal();
  requestAnimationFrame(() => $('#folderName').focus());
}
function openQuickNote() {
  window.SeverUiState?.begin('quickNoteDialog', { domain: 'notes' });
  $('#quickNoteForm').reset();
  $('#quickNoteDialog').showModal();
  requestAnimationFrame(() => $('#quickNoteText').focus());
}
$('#quickNoteForm').onsubmit = async event => {
  event.preventDefault();
  const text = $('#quickNoteText').value.trim();
  if (!text) return;
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  const title = (firstLine || 'Быстрая заметка').slice(0, 100);
  const now = Date.now();
  state.notes.push({ id: uid(), folderId: '', title, body: text === title ? '' : text, kind: 'text', items: [], done: false, protected: false, createdAt: now, updatedAt: now });
  await save();
  window.SeverUiState?.clear('quickNoteDialog');
  $('#quickNoteDialog').close();
  renderNotes();
  toast('Заметка сохранена');
};
$('#openFolder')?.addEventListener('click', openFolderDialog);
window.SeverNotes = { ...(window.SeverNotes || {}), render: renderNotes, openNote, openFolderDialog, openQuickNote, syncSecuritySettings: syncProtectedNoteSecuritySettings, getContext:()=>({activeFolderId,selectedNoteId:document.querySelector('#noteId')?.value||''}) };

$('#folderForm').onsubmit = async event => {
  event.preventDefault();
  const name = $('#folderName').value.trim();
  if (!name) return;
  const existing = state.folders.find(folder => folder.name.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'));
  if (existing) {
    activeFolderId = existing.id;
    toast('Такая папка уже есть');
  } else {
    const folder = { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now() };
    state.folders.push(folder);
    activeFolderId = folder.id;
    await save();
    toast('Папка создана');
  }
  $('#folderDialog').close();
  renderFolders();
  renderNotes();
};

renderFolders();
renderNotes();

$('#noteSearch').oninput = event => { noteSearchQuery = event.target.value.trim().toLocaleLowerCase('ru-RU'); renderNotes(); };

function currentFolder() {
  return state.folders.find(folder => folder.id === activeFolderId) || null;
}

$('#manageFolder').onclick = () => {
  const folder = currentFolder();
  if (!folder) return;
  window.SeverUiState?.begin('folderManagerDialog', { domain: 'folders', entityId: folder.id });
  $('#folderManagerName').value = folder.name;
  $('#folderManagerDialog').showModal();
  requestAnimationFrame(() => $('#folderManagerName').focus());
};

$('#folderManagerForm').onsubmit = async event => {
  event.preventDefault();
  const folder = currentFolder();
  const name = $('#folderManagerName').value.trim();
  if (!folder || !name) return;
  const duplicate = state.folders.find(item => item.id !== folder.id && item.name.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'));
  if (duplicate) return toast('Такая папка уже есть');
  const before = { name: folder.name };
  folder.name = name;
  folder.updatedAt = Date.now();
  await save();
  $('#folderManagerDialog').close();
  renderNotes();
  toast('Папка переименована', { type: 'folder-state', id: folder.id, before });
};

function removeFolder(withNotes) {
  const folder = currentFolder();
  if (!folder) return;
  const notes = state.notes.filter(note => note.folderId === folder.id), snapshots = notes.map(note => cloneValue(note));
  const index = state.folders.findIndex(item => item.id === folder.id);
  state.folders.splice(index, 1);
  if (withNotes) state.notes = state.notes.filter(note => note.folderId !== folder.id);
  else notes.forEach(note => { note.folderId = ''; note.updatedAt = Date.now(); });
  activeFolderId = 'all';
  $('#folderManagerDialog').close();
  save();
  renderNotes();
  toast(withNotes ? 'Папка и заметки удалены' : 'Папка удалена', { type: 'folder-delete', folder: cloneValue(folder), index, notes: snapshots });
}

$('#deleteFolderOnly').onclick = () => removeFolder(false);
$('#deleteFolderWithNotes').onclick = () => removeFolder(true);

function clearProtectedForm(){for(const id of ['noteId','noteTitle','noteBody','notePassword','unlockPassword']){const field=document.querySelector('#'+id);if(field)field.value=''}const editor=document.querySelector('#noteItemsEditor');if(editor)editor.textContent='';editingNoteItems=[];pendingUnlockNote=null;pendingUnlockEdit=false;document.querySelector('#unlockError')?.classList.add('hidden')}
function touchUnlockedNote(noteId){const session=unlockedNotes.get(noteId);if(session)session.lastActivityAt=Date.now()}
function lockProtectedNote(noteId,notify=false){const existed=unlockedNotes.delete(noteId);if(document.querySelector('#noteId')?.value===noteId){clearProtectedForm();document.querySelector('#noteDialog')?.close()}if(pendingUnlockNote?.id===noteId){clearProtectedForm();document.querySelector('#unlockDialog')?.close()}if(existed)renderNotes();if(notify&&existed)toast('Заметка заблокирована')}
function lockAllProtectedNotes(notify=false){const hadUnlocked=unlockedNotes.size>0;unlockedNotes.clear();clearProtectedForm();document.querySelector('#noteDialog')?.close();document.querySelector('#unlockDialog')?.close();if(hadUnlocked)renderNotes();if(notify)toast(hadUnlocked?'Защищённые заметки заблокированы':'Все заметки уже заблокированы')}
function syncProtectedNoteSecuritySettings(){state.security??={protectedNotesAutoLockMinutes:5,lockInBackground:true};const timeout=document.querySelector('#protectedNotesAutoLock'),background=document.querySelector('#protectedNotesBackgroundLock'),status=document.querySelector('#securityCheckStatus');if(timeout)timeout.value=String(state.security.protectedNotesAutoLockMinutes||5);if(background)background.checked=state.security.lockInBackground!==false;if(status){const valid=state.notes.filter(note=>note.protected).every(note=>{try{return window.SeverSecurityCore.assertProtectedNote(note)}catch{return false}});status.textContent=valid?'Локальные проверки пройдены':'Есть повреждённые защищённые данные';status.dataset.status=valid?'ok':'warning'}}
function checkProtectedNoteTimeouts(now=Date.now()){for(const[noteId,session]of unlockedNotes)if(window.SeverSecurityCore.shouldAutoLock(session,state.security,now))lockProtectedNote(noteId)}
document.querySelector('#protectedNotesAutoLock')?.addEventListener('change',event=>{state.security??={};state.security.protectedNotesAutoLockMinutes=[1,5,15,30].includes(Number(event.target.value))?Number(event.target.value):5;save()});
document.querySelector('#protectedNotesBackgroundLock')?.addEventListener('change',event=>{state.security??={};state.security.lockInBackground=Boolean(event.target.checked);save()});
document.querySelector('#lockProtectedNotesNow')?.addEventListener('click',()=>lockAllProtectedNotes(true));
document.querySelector('#noteDialog')?.addEventListener('close',()=>{const id=document.querySelector('#noteId')?.value;if(id&&state.notes.find(note=>note.id===id)?.protected)lockProtectedNote(id);else clearProtectedForm()});
document.querySelector('#unlockDialog')?.addEventListener('close',()=>{const password=document.querySelector('#unlockPassword');if(password)password.value='';pendingUnlockNote=null;pendingUnlockEdit=false});
window.addEventListener('sever:lock-protected-notes',()=>lockAllProtectedNotes(false));
window.SeverNotes.handleRemoteProtectedChanges=noteIds=>{(noteIds||[]).forEach(noteId=>{const note=state.notes.find(item=>item.id===noteId);if(!note?.protected||!unlockedNotes.has(noteId))return;if(document.querySelector('#noteDialog')?.open&&document.querySelector('#noteId')?.value===noteId&&window.SeverUiState?.isDirty('noteDialog'))return;lockProtectedNote(noteId)})};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&state.security?.lockInBackground!==false)lockAllProtectedNotes(false);checkProtectedNoteTimeouts()});
document.addEventListener('pointerdown',()=>{const id=document.querySelector('#noteId')?.value;if(id)touchUnlockedNote(id)},{passive:true});document.addEventListener('keydown',()=>{const id=document.querySelector('#noteId')?.value;if(id)touchUnlockedNote(id)},{passive:true});setInterval(checkProtectedNoteTimeouts,15000);syncProtectedNoteSecuritySettings();
