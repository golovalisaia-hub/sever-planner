import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../js/theme-init.js', import.meta.url), 'utf8');
function init(entries = {}, blocked = false) {
  const root = { dataset: {} }, meta = {};
  const context = {
    window: {}, document: { documentElement: root, querySelector: () => meta },
    localStorage: { getItem: key => { if (blocked) throw new Error('Denied'); return entries[key] || null; } }
  };
  vm.runInNewContext(source, context);
  return { theme: root.dataset.theme, meta: meta.content, engine: context.window.SeverTheme };
}
test('early initialization uses all three saved themes and native chrome colors', () => {
  for (const [theme, color] of [['calm', '#F7F4F0'], ['cozy', '#FFF6EF'], ['focus', '#08100E']]) {
    const result = init({ 'sever-theme': theme });
    assert.equal(result.theme, theme);
    assert.equal(result.meta, color);
  }
});
test('anonymous appearance wins over a stale cache before paint', () => {
  assert.equal(init({ 'sever-theme': 'calm', 'sever-anonymous-state-v1': JSON.stringify({ appearance: { theme: 'focus' } }) }).theme, 'focus');
});
test('account paint hint does not read account planner data or authorize a scope', () => {
  const result = init({ 'sever-theme': 'focus', 'sever-theme-scope': 'sever-cloud-state-v1:account',
    'sever-anonymous-state-v1': JSON.stringify({ appearance: { theme: 'calm' } }),
    'sever-cloud-state-v1:account': '{deliberately unreadable' });
  assert.equal(result.theme, 'focus');
  assert.equal(result.engine.pendingAccount, true);
});
test('legacy themes migrate and unavailable or corrupt storage falls back safely', () => {
  for (const [old, next] of Object.entries({ aurora: 'focus', black: 'focus', light: 'calm', dawn: 'cozy', polar: 'focus', north: 'focus', motion: 'focus', minimal: 'calm', dark: 'focus' })) {
    assert.equal(init({ 'sever-theme': old }).theme, next);
  }
  assert.equal(init({}, true).theme, 'calm');
  assert.equal(init({ 'sever-theme': 'invalid' }).theme, 'calm');
  assert.equal(init({ 'sever-theme': '__proto__' }).theme, 'calm');
  assert.equal(init({ 'sever-anonymous-state-v1': '{' }).theme, 'calm');
});
test('theme root blocks declare paint values only and initialization precedes styles', () => {
  const css = fs.readFileSync(new URL('../themes.css', import.meta.url), 'utf8');
  for (const block of css.matchAll(/html\[data-theme="(?:calm|cozy|focus)"\][^{]+\{([^}]+)\}/g)) {
    for (const declaration of block[1].split(';').map(s => s.trim()).filter(Boolean)) {
      assert.match(declaration, /^(--theme-[a-z-]+|color-scheme):/);
    }
  }
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('js/theme-init.js') < html.indexOf('rel="stylesheet"'));
  assert.equal((html.match(/<script src="js\/theme-init/g) || []).length, 1);
  assert.doesNotMatch(html.match(/<script src="js\/theme-init[^>]+>/)[0], /async|defer/);
});
