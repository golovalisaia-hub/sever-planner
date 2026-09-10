(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const cryptoBox = window.SeverProtectedNotesCrypto;
  if (!cryptoBox) return;

  let legacy = null;
  let legacyRender = null;
  let legacyOpenNote = null;
  let legacyOpenQuickNote = null;
  let legacyNoteSubmit = null;
  let legacyQuickSubmit = null;
  let legacyRemoteChanges = null;
  let session = null;
  let sessionDescriptor = '';
  let editorMode = '';
  let quickMode = '';
  let pendingAction = null;
  let vaultDialogMode = 'setup';
  let noteListObserver = null;
  let suppressListObserver = false;
  let renderScheduled = false;
  const payloads = new Map();

  const state = () => window.SeverApp?.getState?.() || { notes: [], folders: [], profile: {}, security: {} };
  const descriptor = () => state().profile?.notesVault || null;
  const descriptorSignature = () => JSON.stringify(descriptor() || null);
  const isConfigured = () => Boolean(cryptoBox.inspectVaultDescriptor?.(descriptor()));
  const isVaultNote = note => Boolean(note?.protected && cryptoBox.isVaultPayload?.(note.secure));
  const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);

  function touch() { if (session) session.lastActivityAt = Date.now(); }
  function notify(text, kind = 'ok') {
    const root = $('#toast');
    if (!root) return;
    root.textContent = text;
    root.dataset.kind = kind;
    root.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => root.classList.remove('show'), 2400);
  }

  async function persist() {
    try { window.SeverApp?.beforeLocalSave?.(); } catch {}
    await window.SeverApp?.persist?.();
  }

  function vaultSessionValid() {
    if (!session) return false;
    if (sessionDescriptor !== descriptorSignature()) { lockVault(false); return false; }
    return true;
  }

  function clearSensitiveUi() {
    const search = $('#noteSearch');
    if (search?.value) {
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    for (const id of ['noteTitle','noteBody','notePassword','quickNoteText','notesVaultPassword','notesVaultConfirm']) {
      const field = document.getElementById(id); if (field) field.value = '';
    }
    $('#noteItemsEditor')?.replaceChildren();
    if ($('#noteDialog')?.open && editorMode === 'vault') $('#noteDialog').close();
    if ($('#quickNoteDialog')?.open && quickMode === 'vault') $('#quickNoteDialog').close();
    editorMode = ''; quickMode = '';
  }

  function lockVault(showMessage = true) {
    const wasUnlocked = Boolean(session);
    session = null;
    sessionDescriptor = '';
    payloads.clear();
    clearSensitiveUi();
    renderAll();
    if (showMessage && wasUnlocked) notify('Хранилище заметок заблокировано');
  }

  async function decryptVaultNotes() {
    if (!vaultSessionValid()) return;
    payloads.clear();
    const notes = state().notes || [];
    for (const note of notes) {
      if (!isVaultNote(note)) continue;
      try { payloads.set(note.id, await cryptoBox.unlockVaultPayload(note.secure, session.key, note.id)); }
      catch { throw new Error('Одна из зашифрованных заметок повреждена или создана другим ключом'); }
    }
    touch();
  }

  async function hardenPlaintextNotes() {
    if (!vaultSessionValid()) return false;
    const exposed = (state().notes || []).filter(note => !note.protected);
    if (!exposed.length) return false;
    const now = Date.now();
    for (const note of exposed) {
      const payload = {
        title: String(note.title || ''), body: String(note.body || ''),
        kind: note.kind === 'checklist' ? 'checklist' : 'text',
        items: Array.isArray(note.items) ? note.items.map(item => ({ id:item.id || crypto.randomUUID(), text:String(item.text || ''), done:Boolean(item.done) })) : [],
        done: Boolean(note.done)
      };
      note.secure = await cryptoBox.sealVaultPayload(payload, session.key, note.id);
      Object.assign(note, { title:'', body:'', kind:'protected', items:[], done:false, protected:true, updatedAt:now });
      payloads.set(note.id, payload);
    }
    await persist();
    return true;
  }

  async function unlockVault(password) {
    const unlocked = await cryptoBox.unlockNotesVault(descriptor(), password);
    session = unlocked;
    sessionDescriptor = descriptorSignature();
    await decryptVaultNotes();
    await hardenPlaintextNotes();
    touch();
  }

  async function setupVault(password) {
    const created = await cryptoBox.createNotesVault(password, cryptoBox.DEFAULT_ITERATIONS);
    session = created;
    const s = state();
    s.profile = { ...(s.profile || {}), notesVault: created.descriptor };
    sessionDescriptor = descriptorSignature();
    await hardenPlaintextNotes();
    await persist();
    sessionDescriptor = descriptorSignature();
  }

  async function rekeyVault(password) {
    if (!vaultSessionValid()) throw new Error('Сначала откройте хранилище');
    await decryptVaultNotes();
    const created = await cryptoBox.createNotesVault(password, cryptoBox.DEFAULT_ITERATIONS);
    const now = Date.now();
    for (const note of state().notes || []) {
      if (!isVaultNote(note)) continue;
      const payload = payloads.get(note.id);
      if (!payload) throw new Error('Не удалось расшифровать все заметки для смены пароля');
      note.secure = await cryptoBox.sealVaultPayload(payload, created.key, note.id);
      note.updatedAt = now;
    }
    state().profile = { ...(state().profile || {}), notesVault: created.descriptor };
    session = created;
    sessionDescriptor = descriptorSignature();
    await persist();
  }

  function injectUi() {
    if (!$('#notesVaultStatus')) {
      const status = document.createElement('section');
      status.id = 'notesVaultStatus';
      status.className = 'notes-vault-status';
      status.innerHTML = '<div class="notes-vault-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div><div><b id="notesVaultStatusTitle">Хранилище заметок</b><small id="notesVaultStatusText"></small></div><button id="notesVaultStatusAction" type="button"></button>';
      const search = $('#notesView .note-search');
      search?.parentNode?.insertBefore(status, search);
      $('#notesVaultStatusAction').addEventListener('click', () => {
        if (!isConfigured()) requestVault(null, 'setup');
        else if (vaultSessionValid()) lockVault(true);
        else requestVault(null, 'unlock');
      });
    }

    if (!$('#notesVaultSettingsRow')) {
      const securityTitle = [...document.querySelectorAll('#settingsView .settings-section>small')].find(node => node.textContent.trim() === 'БЕЗОПАСНОСТЬ');
      const section = securityTitle?.parentElement;
      if (section) {
        const row = document.createElement('div');
        row.id = 'notesVaultSettingsRow';
        row.className = 'settings-row notes-vault-settings-row';
        row.innerHTML = '<span><b>Шифрование заметок</b><em id="notesVaultSettingsStatus">Проверяем…</em></span><div class="notes-vault-settings-actions"><button id="notesVaultSettingsAction" type="button" class="text-action"></button><button id="notesVaultChangePassword" type="button" class="text-action hidden">Сменить пароль</button></div>';
        securityTitle.insertAdjacentElement('afterend', row);
        $('#notesVaultSettingsAction').addEventListener('click', () => {
          if (!isConfigured()) requestVault(null, 'setup');
          else if (vaultSessionValid()) lockVault(true);
          else requestVault(null, 'unlock');
        });
        $('#notesVaultChangePassword').addEventListener('click', () => {
          if (!vaultSessionValid()) return requestVault(() => requestVault(null, 'rekey'), 'unlock');
          requestVault(null, 'rekey');
        });
      }
    }

    if (!$('#notesVaultDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'notesVaultDialog';
      dialog.className = 'notes-vault-dialog';
      dialog.innerHTML = '<form id="notesVaultForm"><div class="dialog-head"><div><small>SEVER NOTES VAULT</small><h2 id="notesVaultDialogTitle">Защитить заметки</h2></div><button id="notesVaultClose" type="button" aria-label="Закрыть"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div><div class="notes-vault-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div><p id="notesVaultDialogText" class="muted"></p><label>Пароль хранилища<input id="notesVaultPassword" type="password" minlength="14" maxlength="128" autocomplete="off" required></label><label id="notesVaultConfirmWrap">Повторите пароль<input id="notesVaultConfirm" type="password" minlength="14" maxlength="128" autocomplete="off"></label><p id="notesVaultWarning" class="notes-vault-warning">Пароль не сохраняется и не отправляется в облако. Если его забыть, восстановить содержимое заметок будет невозможно.</p><p id="notesVaultError" class="secure-error hidden" role="alert"></p><div class="dialog-actions"><button id="notesVaultCancel" type="button" class="secondary">Отмена</button><button id="notesVaultSubmit" class="primary">Продолжить</button></div></form>';
      document.body.appendChild(dialog);
      $('#notesVaultClose').addEventListener('click', () => dialog.close());
      $('#notesVaultCancel').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { $('#notesVaultPassword').value=''; $('#notesVaultConfirm').value=''; $('#notesVaultError').classList.add('hidden'); pendingAction=null; });
      $('#notesVaultForm').addEventListener('submit', submitVaultDialog);
    }

    if (!$('#notesVaultStyles')) {
      const style = document.createElement('style');
      style.id = 'notesVaultStyles';
      style.textContent = `
        .notes-vault-status{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--border-subtle,var(--line));border-radius:14px;background:var(--surface-1,var(--panel));color:var(--text-primary,var(--text))}
        .notes-vault-mark,.notes-vault-lock{display:grid;place-items:center;color:var(--accent,var(--sever-blue))}.notes-vault-mark{width:40px;height:40px;border-radius:12px;background:var(--accent-soft,var(--panel2))}.notes-vault-mark svg,.notes-vault-lock svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        .notes-vault-status>div:nth-child(2){display:grid;gap:2px;min-width:0}.notes-vault-status b{font-size:13px}.notes-vault-status small{color:var(--text-muted,var(--muted));font-size:11px;line-height:1.35}.notes-vault-status>button{min-height:40px;padding:0 12px;border:1px solid var(--border-subtle,var(--line));border-radius:10px;background:var(--surface-2,var(--panel2));color:var(--text-primary,var(--text));font:inherit;font-size:11px;font-weight:750}
        .notes-vault-settings-row{align-items:center}.notes-vault-settings-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.notes-vault-settings-actions button{min-height:36px}
        .notes-vault-dialog{width:min(460px,calc(100vw - 24px))}.notes-vault-dialog form{display:grid;gap:14px}.notes-vault-lock{width:58px;height:58px;margin:2px auto;border-radius:18px;background:var(--accent-soft,var(--panel2))}.notes-vault-lock svg{width:28px;height:28px}.notes-vault-warning{margin:0;padding:10px 12px;border-radius:11px;background:var(--surface-2,var(--panel2));color:var(--text-secondary,var(--muted));font-size:11px;line-height:1.45}
        .notes-vault-gate{display:grid;justify-items:center;gap:8px;min-height:210px;padding:30px 20px;border:1px dashed var(--border-strong,var(--line));border-radius:16px;background:var(--surface-1,var(--panel));text-align:center}.notes-vault-gate svg{width:30px;height:30px;fill:none;stroke:var(--accent,var(--sever-blue));stroke-width:1.8}.notes-vault-gate b{font-size:15px}.notes-vault-gate p{max-width:42ch;margin:0;color:var(--text-muted,var(--muted));font-size:12px;line-height:1.5}.notes-vault-gate button{min-height:44px;margin-top:6px;padding:0 14px;border:0;border-radius:11px;background:var(--accent,var(--sever-blue));color:#fff;font:inherit;font-weight:750}
        .vault-note-badge{font-size:9px!important;letter-spacing:.08em}.vault-note-actions{display:flex;gap:7px;flex-wrap:wrap}.vault-note-actions button{min-height:38px;padding:0 11px;border:1px solid var(--border-subtle,var(--line));border-radius:9px;background:var(--surface-2,var(--panel2));color:var(--text-primary,var(--text));font:inherit;font-size:11px}.vault-note-actions .vault-note-lock{color:var(--text-muted,var(--muted))}
        @media(max-width:900px){.notes-vault-status{grid-template-columns:40px minmax(0,1fr);padding:11px 12px}.notes-vault-status>button{grid-column:1/-1;width:100%;min-height:44px}.notes-vault-settings-row{align-items:flex-start}.notes-vault-settings-actions{width:100%;justify-content:flex-start}.notes-vault-settings-actions button{min-height:44px}}
      `;
      document.head.appendChild(style);
    }
  }

  function updateStatusUi() {
    const configured = isConfigured(), unlocked = configured && vaultSessionValid();
    const title = $('#notesVaultStatusTitle'), text = $('#notesVaultStatusText'), action = $('#notesVaultStatusAction');
    if (title) title.textContent = configured ? 'Заметки зашифрованы' : 'Включите шифрование заметок';
    if (text) text.textContent = configured ? (unlocked ? 'AES-256-GCM · открыто только в памяти этого устройства' : 'AES-256-GCM · содержимое сейчас заблокировано') : 'Создайте пароль: существующие и новые заметки будут храниться как шифротекст';
    if (action) action.textContent = configured ? (unlocked ? 'Заблокировать' : 'Открыть') : 'Защитить';
    const settings = $('#notesVaultSettingsStatus'), settingsAction = $('#notesVaultSettingsAction'), change = $('#notesVaultChangePassword');
    if (settings) settings.textContent = configured ? (unlocked ? 'AES-256-GCM · открыто' : 'AES-256-GCM · заблокировано') : 'Ещё не настроено';
    if (settingsAction) settingsAction.textContent = configured ? (unlocked ? 'Заблокировать' : 'Открыть') : 'Настроить';
    change?.classList.toggle('hidden', !unlocked);
  }

  function requestVault(after = null, mode = null) {
    injectUi();
    pendingAction = typeof after === 'function' ? after : null;
    vaultDialogMode = mode || (isConfigured() ? 'unlock' : 'setup');
    const setup = vaultDialogMode === 'setup', rekey = vaultDialogMode === 'rekey';
    $('#notesVaultDialogTitle').textContent = setup ? 'Зашифровать заметки' : rekey ? 'Сменить пароль' : 'Открыть заметки';
    $('#notesVaultDialogText').textContent = setup
      ? 'SEVER зашифрует названия, текст и чек-листы существующих заметок перед сохранением. Новые заметки будут шифроваться автоматически.'
      : rekey ? 'Все заметки будут перешифрованы новым ключом. Используйте длинную уникальную парольную фразу.'
      : 'Введите пароль хранилища. Расшифрованное содержимое останется только в памяти и автоматически заблокируется.';
    $('#notesVaultConfirmWrap').classList.toggle('hidden', !setup && !rekey);
    $('#notesVaultConfirm').required = setup || rekey;
    $('#notesVaultSubmit').textContent = setup ? 'Зашифровать' : rekey ? 'Сменить пароль' : 'Открыть';
    $('#notesVaultError').classList.add('hidden');
    $('#notesVaultPassword').value = ''; $('#notesVaultConfirm').value = '';
    $('#notesVaultDialog').showModal();
    requestAnimationFrame(() => $('#notesVaultPassword').focus());
  }

  async function submitVaultDialog(event) {
    event.preventDefault();
    const password = $('#notesVaultPassword').value;
    const confirm = $('#notesVaultConfirm').value;
    const error = $('#notesVaultError'), button = $('#notesVaultSubmit');
    error.classList.add('hidden');
    if ((vaultDialogMode === 'setup' || vaultDialogMode === 'rekey') && password.length < 14) {
      error.textContent = 'Используйте минимум 14 символов. Лучше длинную уникальную парольную фразу.'; error.classList.remove('hidden'); return;
    }
    if ((vaultDialogMode === 'setup' || vaultDialogMode === 'rekey') && password !== confirm) {
      error.textContent = 'Пароли не совпадают.'; error.classList.remove('hidden'); return;
    }
    button.disabled = true; button.textContent = vaultDialogMode === 'unlock' ? 'Открываем…' : 'Шифруем…';
    const next = pendingAction; pendingAction = null;
    try {
      if (vaultDialogMode === 'setup') await setupVault(password);
      else if (vaultDialogMode === 'rekey') await rekeyVault(password);
      else await unlockVault(password);
      $('#notesVaultDialog').close();
      await renderAll();
      notify(vaultDialogMode === 'setup' ? 'Заметки зашифрованы' : vaultDialogMode === 'rekey' ? 'Пароль хранилища изменён' : 'Заметки открыты');
      next?.();
    } catch (reason) {
      pendingAction = next;
      error.textContent = vaultDialogMode === 'unlock' ? 'Пароль не подходит или данные повреждены.' : reason?.message || 'Не удалось завершить шифрование.';
      error.classList.remove('hidden');
      $('#notesVaultPassword').select();
    } finally {
      button.disabled = false;
      button.textContent = vaultDialogMode === 'setup' ? 'Зашифровать' : vaultDialogMode === 'rekey' ? 'Сменить пароль' : 'Открыть';
    }
  }

  function activeFolderId() { return legacy?.getContext?.().activeFolderId || 'all'; }
  function filteredNotes() {
    const folder = activeFolderId(), query = ($('#noteSearch')?.value || '').trim().toLocaleLowerCase('ru-RU');
    return (state().notes || []).filter(note => {
      const inFolder = folder === 'all' || (folder === 'none' ? !note.folderId : note.folderId === folder);
      if (!inFolder) return false;
      if (!query) return true;
      if (isVaultNote(note)) {
        const data = payloads.get(note.id); if (!data) return false;
        return `${data.title}\n${data.body}\n${(data.items || []).map(item => item.text).join(' ')}`.toLocaleLowerCase('ru-RU').includes(query);
      }
      return true;
    }).sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  function genericGate(root, configured) {
    root.replaceChildren();
    const gate = document.createElement('div'); gate.className = 'notes-vault-gate';
    gate.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><b>${configured ? 'Заметки заблокированы' : 'Защитите заметки паролем'}</b><p>${configured ? 'Названия, текст и пункты чек-листов не расшифровываются, пока хранилище закрыто.' : 'Перед созданием новых заметок включите шифрование. Существующие обычные заметки будут переведены в зашифрованный формат.'}</p>`;
    const button = document.createElement('button'); button.type='button'; button.textContent = configured ? 'Открыть хранилище' : 'Включить шифрование'; button.addEventListener('click', () => requestVault(null, configured ? 'unlock' : 'setup')); gate.appendChild(button); root.appendChild(gate);
  }

  function createLegacyProtectedCard(note) {
    const card = document.createElement('article'); card.className='note-card secure-note locked';
    card.innerHTML='<div class="secure-note-head"><span class="secure-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><div><small>ОТДЕЛЬНАЯ ЗАЩИТА</small><h3>Закрытая заметка</h3></div></div><p class="secure-description">Эта заметка была защищена отдельным паролем до включения общего хранилища.</p><div class="note-card-footer"><span></span><button class="unlock-note" type="button">Открыть</button></div>';
    card.querySelector('.unlock-note').addEventListener('click',()=>{editorMode='legacy';$('#noteProtected').disabled=false;legacyOpenNote(note)});
    return card;
  }

  function createVaultCard(note, data) {
    const card=document.createElement('article'); card.className=`note-card ${data.kind==='checklist'?'checklist-note':'text-note'} secure-note unlocked`; card.dataset.noteId=note.id;
    const items=Array.isArray(data.items)?data.items:[],done=items.length?Math.round(items.filter(item=>item.done).length/items.length*100):0;
    card.innerHTML=`<div class="note-card-head"><h3></h3><span class="note-kind vault-note-badge">ЗАШИФРОВАНО</span></div><p class="note-body"></p><div class="note-checklist"></div><div class="note-card-footer"><div><span class="folder-badge"></span><time></time></div><div class="vault-note-actions"><button class="vault-note-edit" type="button">Изменить</button></div></div>`;
    card.querySelector('h3').textContent=data.title || 'Без названия';
    const body=card.querySelector('.note-body'); body.textContent=data.body || ''; body.classList.toggle('hidden',!body.textContent);
    const folder=state().folders?.find(folder=>folder.id===note.folderId); card.querySelector('.folder-badge').textContent=folder?.name || 'Без папки';
    card.querySelector('time').textContent=`Обновлено ${new Date(note.updatedAt||Date.now()).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}`;
    const checklist=card.querySelector('.note-checklist');
    if(data.kind==='checklist') {
      if(items.length) items.forEach(item=>{
        const label=document.createElement('label'); label.className=`note-check${item.done?' done':''}`; label.innerHTML='<input type="checkbox"><span></span>';
        const checkbox=label.querySelector('input'); checkbox.checked=Boolean(item.done); label.querySelector('span').textContent=item.text;
        checkbox.addEventListener('change',async()=>{item.done=checkbox.checked;data.done=items.every(step=>step.done);await saveVaultPayload(note,data);await renderVaultList();}); checklist.appendChild(label);
      }); else checklist.innerHTML='<p class="note-empty-list">Пунктов пока нет.</p>';
      if(items.length){const actions=card.querySelector('.vault-note-actions'),toggle=document.createElement('button');toggle.type='button';toggle.textContent=items.every(item=>item.done)?'Снять все':'Отметить всё';toggle.addEventListener('click',async()=>{const next=!items.every(item=>item.done);items.forEach(item=>item.done=next);data.done=next;await saveVaultPayload(note,data);await renderVaultList()});actions.prepend(toggle)}
    }
    card.querySelector('.vault-note-edit').addEventListener('click',()=>openVaultEditor(note));
    return card;
  }

  async function renderVaultList() {
    injectUi(); updateStatusUi();
    const root=$('#noteList'); if(!root)return;
    const search=$('#noteSearch');
    if(!isConfigured()){if(search)search.disabled=true;genericGate(root,false);return}
    if(!vaultSessionValid()){if(search)search.disabled=true;genericGate(root,true);return}
    if(search)search.disabled=false;
    const notes=filteredNotes(); root.replaceChildren();
    if(!notes.length){const empty=document.createElement('div');empty.className='empty';empty.innerHTML='<b>В этой папке пока нет заметок.</b>';root.appendChild(empty);return}
    for(const note of notes){
      if(isVaultNote(note)){const data=payloads.get(note.id);if(data)root.appendChild(createVaultCard(note,data));}
      else if(note.protected)root.appendChild(createLegacyProtectedCard(note));
      else {const warning=document.createElement('article');warning.className='note-card secure-note locked';warning.innerHTML='<h3>Заметка ожидает шифрования</h3><p class="secure-description">SEVER сейчас переведёт эту запись в защищённое хранилище.</p>';root.appendChild(warning);}
    }
  }

  async function renderAll() {
    if (!legacyRender) return;
    injectUi();
    if (session && sessionDescriptor !== descriptorSignature()) lockVault(false);
    suppressListObserver=true;
    try { legacyRender(); } finally { queueMicrotask(()=>{suppressListObserver=false}); }
    if (vaultSessionValid()) {
      try { await hardenPlaintextNotes(); } catch { lockVault(false); }
    }
    await renderVaultList();
    document.documentElement.dataset.severNotesVault = isConfigured() ? (vaultSessionValid()?'unlocked':'locked') : 'setup';
  }

  function scheduleVaultList() {
    if(suppressListObserver||renderScheduled)return;renderScheduled=true;requestAnimationFrame(async()=>{renderScheduled=false;await renderVaultList()});
  }

  function setVaultEditorProtection() {
    const protection=$('#noteProtected'); if(protection){protection.checked=true;protection.disabled=true;}
    $('#notePasswordWrap')?.classList.add('hidden');
    const hint=$('#notePasswordHint'); if(hint)hint.textContent='Защищено общим хранилищем Notes Vault. Отдельный пароль для этой заметки не нужен.';
  }

  function openVaultEditor(note=null) {
    if(!vaultSessionValid())return requestVault(()=>openVaultEditor(note),'unlock');
    touch(); editorMode='vault';
    if(note){const data=payloads.get(note.id);if(!data)return notify('Не удалось открыть заметку','error');const pseudo={...clone(data),id:note.id,folderId:note.folderId,protected:false,createdAt:note.createdAt,updatedAt:note.updatedAt};legacyOpenNote(pseudo)}
    else legacyOpenNote(null);
    setVaultEditorProtection();
  }

  function openNote(note=null) {
    if(!isConfigured())return requestVault(()=>openVaultEditor(note),'setup');
    if(isVaultNote(note)||!note)return openVaultEditor(note);
    editorMode='legacy'; const protection=$('#noteProtected');if(protection)protection.disabled=false;return legacyOpenNote(note);
  }

  function openQuickNote() {
    if(!isConfigured())return requestVault(()=>openQuickNote(),'setup');
    if(!vaultSessionValid())return requestVault(()=>openQuickNote(),'unlock');
    touch(); quickMode='vault'; legacyOpenQuickNote();
  }

  function readEditorPayload() {
    const kind=$('[data-note-type].active')?.dataset.noteType==='checklist'?'checklist':'text';
    const rows=[...document.querySelectorAll('#noteItemsEditor .note-item-editor')];
    const items=rows.map(row=>({id:crypto.randomUUID(),text:row.querySelector('input[type="text"]')?.value.trim()||'',done:Boolean(row.querySelector('input[type="checkbox"]')?.checked)})).filter(item=>item.text);
    return {title:$('#noteTitle').value.trim(),body:$('#noteBody').value.trim(),kind,items,done:kind==='checklist'&&items.length?items.every(item=>item.done):false};
  }

  async function saveVaultPayload(note,payload) {
    if(!vaultSessionValid())throw new Error('Хранилище заблокировано');
    note.secure=await cryptoBox.sealVaultPayload(payload,session.key,note.id);note.updatedAt=Date.now();payloads.set(note.id,clone(payload));touch();await persist();
  }

  async function submitVaultNote(event) {
    if(editorMode!=='vault')return legacyNoteSubmit?.call($('#noteForm'),event);
    event.preventDefault();event.stopImmediatePropagation();
    if(!vaultSessionValid()){requestVault(null,'unlock');return}
    const payload=readEditorPayload(); if(!payload.title)return;
    const id=$('#noteId').value,existing=(state().notes||[]).find(note=>note.id===id),now=Date.now();
    const note=existing||{id:id||crypto.randomUUID(),folderId:'',createdAt:now,updatedAt:now};
    note.folderId=$('#noteFolder').value||'';
    if(!existing)state().notes.push(note);
    await saveVaultPayload(note,payload);
    Object.assign(note,{title:'',body:'',kind:'protected',items:[],done:false,protected:true});
    await persist();
    window.SeverUiState?.clear?.('noteDialog');editorMode='';$('#noteDialog').close();await renderAll();notify('Заметка зашифрована');
  }

  async function submitVaultQuick(event) {
    if(quickMode!=='vault')return legacyQuickSubmit?.call($('#quickNoteForm'),event);
    event.preventDefault();event.stopImmediatePropagation();
    if(!vaultSessionValid()){requestVault(null,'unlock');return}
    const text=$('#quickNoteText').value.trim();if(!text)return;
    const first=text.split(/\r?\n/,1)[0].trim(),title=(first||'Быстрая заметка').slice(0,100),now=Date.now(),note={id:crypto.randomUUID(),folderId:'',title:'',body:'',kind:'protected',items:[],done:false,protected:true,createdAt:now,updatedAt:now};
    const payload={title,body:text===title?'':text,kind:'text',items:[],done:false};note.secure=await cryptoBox.sealVaultPayload(payload,session.key,note.id);state().notes.push(note);payloads.set(note.id,payload);touch();await persist();window.SeverUiState?.clear?.('quickNoteDialog');quickMode='';$('#quickNoteText').value='';$('#quickNoteDialog').close();await renderAll();notify('Заметка зашифрована');
  }

  function bind() {
    if(!window.SeverApp||!window.SeverNotes||legacy)return false;
    legacy=window.SeverNotes;legacyRender=legacy.render.bind(legacy);legacyOpenNote=legacy.openNote.bind(legacy);legacyOpenQuickNote=legacy.openQuickNote.bind(legacy);legacyRemoteChanges=legacy.handleRemoteProtectedChanges?.bind(legacy);
    legacyNoteSubmit=$('#noteForm')?.onsubmit;legacyQuickSubmit=$('#quickNoteForm')?.onsubmit;
    if($('#noteForm'))$('#noteForm').onsubmit=submitVaultNote;
    if($('#quickNoteForm'))$('#quickNoteForm').onsubmit=submitVaultQuick;
    if($('#openNote'))$('#openNote').onclick=()=>openNote();
    window.SeverNotes={...legacy,render:renderAll,openNote,openQuickNote,getContext:()=>({...legacy.getContext?.(),vault:isConfigured()?(vaultSessionValid()?'unlocked':'locked'):'setup'}),handleRemoteProtectedChanges:ids=>{const changed=(ids||[]).some(id=>isVaultNote((state().notes||[]).find(note=>note.id===id)));if(changed)lockVault(false);legacyRemoteChanges?.(ids);renderAll();}};
    injectUi();
    const list=$('#noteList');if(list){noteListObserver=new MutationObserver(scheduleVaultList);noteListObserver.observe(list,{childList:true,subtree:true})}
    window.addEventListener('sever:account-scope',()=>lockVault(false));
    window.addEventListener('sever:lock-protected-notes',()=>lockVault(false));
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&state().security?.lockInBackground!==false)lockVault(false)});
    document.addEventListener('pointerdown',touch,{passive:true});document.addEventListener('keydown',touch,{passive:true});
    setInterval(()=>{if(session&&window.SeverSecurityCore?.shouldAutoLock?.(session,state().security,Date.now()))lockVault(false)},15000);
    renderAll();
    document.documentElement.dataset.severNotesVault='ready';
    return true;
  }

  let attempts=0;const boot=()=>{if(bind())return;if(attempts++<160)setTimeout(boot,50)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
