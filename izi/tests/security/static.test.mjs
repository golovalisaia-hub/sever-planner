// Source-level guards: they keep future code from quietly bypassing the
// architecture (repository layer, verified identities, no secrets, D6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(name => {
  if (name === 'node_modules' || name.startsWith('.')) return [];
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = walk(ROOT).map(path => ({ path: relative(ROOT, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));
const source = files.filter(f => f.path.startsWith('src/') && f.path.endsWith('.ts'));
const withoutComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no secrets anywhere in izi/', () => {
  const patterns = [
    /sk-[A-Za-z0-9_-]{20,}/, // OpenAI-style keys
    /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, // Telegram bot tokens
    /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWTs (Supabase keys)
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/,
    /postgres(ql)?:\/\/[^\s'"]+:[^\s'"@]+@/, // connection strings with passwords
  ];
  for (const file of files) {
    for (const pattern of patterns) assert.doesNotMatch(file.text, pattern, `${file.path} matches ${pattern}`);
  }
});

test('database access only through src/core/repo', () => {
  const allowed = new Set(['src/core/db.ts']);
  for (const file of source) {
    if (file.path.startsWith('src/core/repo/') || allowed.has(file.path)) continue;
    const code = withoutComments(file.text);
    assert.doesNotMatch(code, /\.(query|transaction)\s*[(<]/, `${file.path} talks to the database directly`);
    assert.doesNotMatch(code, /from\s+['"][^'"]*\/db\.ts['"]/, `${file.path} imports the database contract`);
    assert.doesNotMatch(code, /from\s+['"][^'"]*\/repo\/sql\.ts['"]/, `${file.path} imports the SQL helpers`);
  }
});

test('every user-data repository method starts with requireContext', () => {
  const userRepos = source.filter(f => f.path.startsWith('src/core/repo/') && !['sql.ts', 'index.ts', 'system.ts'].some(n => f.path.endsWith(n)));
  for (const file of userRepos) {
    const methods = [...file.text.matchAll(/\n  async (\w+)\(([^)]*)\)[^{]*\{\n([^\n]*)/g)];
    assert.ok(methods.length > 0, file.path);
    for (const [, name, params, firstLine] of methods) {
      if (file.path.endsWith('accounts.ts') && ['resolveOrCreate', 'find'].includes(name)) {
        assert.match(firstLine, /requireVerifiedIdentity/, `${file.path}:${name}`);
        continue;
      }
      assert.match(params, /^context: AccountContext/, `${file.path}:${name} must take an AccountContext first`);
      assert.match(firstLine, /requireContext\(context\)/, `${file.path}:${name} must call requireContext first`);
    }
  }
});

test('account contexts are issued only by the account repository', () => {
  for (const file of source) {
    if (file.path === 'src/core/context.ts' || file.path === 'src/core/repo/accounts.ts') continue;
    assert.doesNotMatch(file.text, /issueAccountContext/, file.path);
  }
});

test('verified identities are created only by verifiers (none exist yet in Phase 2)', () => {
  for (const file of source) {
    if (file.path === 'src/core/identity/trusted.ts') continue;
    assert.doesNotMatch(file.text, /trustVerifiedIdentity/, `${file.path} must not mint verified identities`);
  }
});

test('no console output in source (no accidental logging of personal data)', () => {
  for (const file of source) assert.doesNotMatch(file.text, /\bconsole\./, file.path);
});

test('D6: no Russian text in core or module logic; words live in src/locales', () => {
  for (const file of source) {
    if (file.path.startsWith('src/locales/')) continue;
    assert.doesNotMatch(withoutComments(file.text), /[А-Яа-яЁё]/, `${file.path} contains Cyrillic outside comments`);
  }
});

test('no donor product code or branding in izi/ (provenance comments are allowed)', () => {
  for (const file of files) {
    if (file.path.endsWith('.md') || file.path.startsWith('tests/')) continue;
    const code = file.path.endsWith('.sql') ? file.text.replace(/--.*$/gm, '') : withoutComments(file.text);
    assert.doesNotMatch(code, /\btavro\b|_tavro|impulse|\bsever\b/i, file.path);
    assert.doesNotMatch(file.text, /from ['"][^'"]*\.\.\/\.\.\/\.\.\//, `${file.path} imports from outside izi/`);
  }
});

test('no external runtime dependencies in production code', () => {
  for (const file of source) {
    for (const [, specifier] of file.text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(specifier.startsWith('.'), `${file.path} imports ${specifier}`);
    }
  }
  const pkg = JSON.parse(files.find(f => f.path === 'package.json').text);
  assert.equal(pkg.dependencies, undefined, 'Phase 2 has no runtime dependencies');
});
