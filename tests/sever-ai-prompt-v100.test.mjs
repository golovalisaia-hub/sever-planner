import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const prompt=fs.readFileSync(path.join(root,'supabase/functions/sever-ai/prompt.ts'),'utf8');

test('v100 prompt documents every habit tool argument and keeps future checks forbidden',()=>{
  assert.match(prompt,/PROMPT_VERSION='sever-system-v3'/);
  assert.match(prompt,/habit\.list: date/);
  assert.match(prompt,/habit\.create: title/);
  assert.match(prompt,/habit\.update: habitId,title/);
  assert.match(prompt,/habit\.check: habitId,completed \(boolean\),date/);
  assert.match(prompt,/habit\.delete: habitId/);
  assert.match(prompt,/Никогда не отмечай привычку на будущую дату/);
  assert.match(prompt,/Не выдумывай taskId\/noteId\/habitId/);
});
