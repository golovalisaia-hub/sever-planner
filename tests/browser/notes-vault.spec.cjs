const { test, expect } = require('@playwright/test');

const PASSWORD = 'SEVER vault phrase 2026!';
const SECRET_TITLE = 'Личный секрет 8af19';
const SECRET_BODY = 'Текст который не должен лежать открытым 41c7d';

async function seed(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType:'text/javascript', body:'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(({ title, body }) => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version:11,onboarded:true,tasks:[],habits:[],checks:{},taskMemory:[],focusSessions:[],stats:{focusMs:0,sessions:0},
      notes:[{id:'plain-1',folderId:'',title,body,kind:'text',items:[],done:false,protected:false,createdAt:1,updatedAt:1}],folders:[],
      profile:{name:'ADMIN'},appearance:{theme:'light',animations:'off',reduceEffects:true},reminders:{enabled:false,time:'19:00',lastDate:''},
      security:{protectedNotesAutoLockMinutes:5,lockInBackground:true}
    }));
    localStorage.setItem('sever-theme','light');
  }, { title:SECRET_TITLE, body:SECRET_BODY });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes && document.documentElement.dataset.severNotesVault);
  await page.evaluate(() => window.SeverApp.switchView('notes'));
}

async function setupVault(page) {
  await expect(page.locator('#notesVaultStatus')).toBeVisible();
  await page.locator('#notesVaultStatusAction').click();
  await expect(page.locator('#notesVaultDialog')).toBeVisible();
  await page.locator('#notesVaultPassword').fill(PASSWORD);
  await page.locator('#notesVaultConfirm').fill(PASSWORD);
  await page.locator('#notesVaultSubmit').click();
  await expect(page.locator('#notesVaultDialog')).toBeHidden({ timeout:15000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesVault), { timeout:15000 }).toBe('unlocked');
}

test.beforeEach(async ({ page }) => { await seed(page); });

test('setup migrates legacy plaintext note to authenticated ciphertext at rest', async ({ page }) => {
  await expect(page.locator('#noteList')).not.toContainText(SECRET_TITLE);
  await setupVault(page);
  await expect(page.locator('#noteList')).toContainText(SECRET_TITLE);
  const stored = await page.evaluate(() => {
    const state = window.SeverApp.getState(), note = state.notes.find(item => item.id === 'plain-1');
    return { note, raw:localStorage.getItem('sever-anonymous-state-v1'), descriptor:state.profile.notesVault };
  });
  expect(stored.note.protected).toBe(true);
  expect(stored.note.title).toBe('');
  expect(stored.note.body).toBe('');
  expect(stored.note.kind).toBe('protected');
  expect(stored.note.secure.version).toBe(3);
  expect(stored.note.secure.algorithm).toBe('AES-GCM');
  expect(stored.note.secure.keyScope).toBe('notes-vault-v1');
  expect(stored.raw).not.toContain(SECRET_TITLE);
  expect(stored.raw).not.toContain(SECRET_BODY);
  expect(JSON.stringify(stored.descriptor)).not.toContain(PASSWORD);
  expect(stored.descriptor.kdf.iterations).toBe(600000);
});

test('lock clears visible plaintext and wrong password fails closed', async ({ page }) => {
  await setupVault(page);
  await expect(page.locator('#noteList')).toContainText(SECRET_TITLE);
  await page.locator('#notesVaultStatusAction').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesVault)).toBe('locked');
  await expect(page.locator('#noteList')).not.toContainText(SECRET_TITLE);
  await page.locator('#notesVaultStatusAction').click();
  await page.locator('#notesVaultPassword').fill('this is definitely wrong');
  await page.locator('#notesVaultSubmit').click();
  await expect(page.locator('#notesVaultError')).toBeVisible();
  await expect(page.locator('#notesVaultDialog')).toBeVisible();
  await page.locator('#notesVaultPassword').fill(PASSWORD);
  await page.locator('#notesVaultSubmit').click();
  await expect(page.locator('#notesVaultDialog')).toBeHidden({ timeout:15000 });
  await expect(page.locator('#noteList')).toContainText(SECRET_TITLE);
});

test('quick note is encrypted automatically and reload starts locked', async ({ page }) => {
  await setupVault(page);
  const quickSecret='Мгновенная секретная мысль 77a0';
  await page.evaluate(() => window.SeverNotes.openQuickNote());
  await expect(page.locator('#quickNoteDialog')).toBeVisible();
  await page.locator('#quickNoteText').fill(quickSecret);
  await page.locator('#quickNoteForm .primary').click();
  await expect.poll(() => page.evaluate(secret => {
    const note=window.SeverApp.getState().notes.find(item=>item.secure?.version===3 && item.id!=='plain-1');
    return Boolean(note?.protected && note.title==='' && !localStorage.getItem('sever-anonymous-state-v1').includes(secret));
  }, quickSecret)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes && document.documentElement.dataset.severNotesVault);
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesVault)).toBe('locked');
  await expect(page.locator('#noteList')).not.toContainText(quickSecret);
});

test('note editor saves title body and checklist only inside the encrypted envelope', async ({ page }) => {
  await setupVault(page);
  await page.evaluate(() => window.SeverNotes.openNote());
  await expect(page.locator('#noteDialog')).toBeVisible();
  await page.locator('#noteTitle').fill('Зашифрованный список 19b');
  await page.locator('#noteBody').fill('Скрытое описание 52f');
  await page.locator('[data-note-type="checklist"]').click();
  await page.locator('#noteItemsEditor input[type="text"]').first().fill('Секретный пункт 3d1');
  await page.locator('#noteForm .primary').click();
  await expect(page.locator('#noteDialog')).toBeHidden();
  const raw=await page.evaluate(()=>localStorage.getItem('sever-anonymous-state-v1'));
  for(const secret of ['Зашифрованный список 19b','Скрытое описание 52f','Секретный пункт 3d1']) expect(raw).not.toContain(secret);
  const encrypted=await page.evaluate(()=>window.SeverApp.getState().notes.find(note=>note.id!=='plain-1'));
  expect(encrypted.protected).toBe(true);expect(encrypted.secure.version).toBe(3);expect(encrypted.title).toBe('');expect(encrypted.items).toEqual([]);
});
