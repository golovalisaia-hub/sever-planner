import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sever2-ios-push-corefix-v1111.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../sever2-notes-org-repair-v95.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('v111.1 iOS push core fix is syntax-valid, bootstrapped early and shipped atomically inside v112', () => {
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /document\.addEventListener\('change', interceptEnable, true\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /registration\.pushManager\.subscribe\(\{/);
  assert.match(source, /applicationServerKey:decodePublicKey\(VAPID_PUBLIC_KEY\)/);
  assert.match(source, /client\.from\('push_subscriptions'\)\.upsert/);
  assert.match(source, /severIosPushCoreFix = VERSION/);
  assert.match(bootstrap, /sever2-ios-push-corefix-v1111\.js\?v=1111/);
  assert.match(bootstrap, /installIosPushCoreFixLayer\(\);[\s\S]*scheduleLateExperienceLayers\(\)/);
  assert.match(sw, /const CACHE = 'sever-v112-email-otp-release-v1'/);
  assert.match(sw, /sever2-ios-push-corefix-v1111\.js\?v=1111/);
  assert.match(sw, /'\/sever2-ios-push-corefix-v1111\.js'/);
});

test('document capture wins before the legacy Settings listener on iPhone and starts subscribe from that gesture', async () => {
  let changeCapture = null;
  let subscribeCalls = 0;
  let legacyCalls = 0;
  let upsertCalls = 0;
  let persisted = 0;

  class FakeInput {
    constructor() {
      this.id = 'settingsNotificationToggle';
      this.checked = true;
      this.disabled = false;
    }
  }

  const statusNode = { textContent:'', dataset:{} };
  const dayNode = { disabled:false };
  const fifteenNode = { disabled:false };
  const state = { pushReminders:{ enabled:false, dayBefore:true, fifteenMinutes:true, legacyRetired:true } };
  const subscription = {
    endpoint:'https://example.invalid/apple-push',
    toJSON:() => ({ keys:{ p256dh:'p256', auth:'auth' } })
  };
  const registration = {
    pushManager:{
      getSubscription:async () => null,
      subscribe:options => {
        subscribeCalls += 1;
        assert.equal(options.userVisibleOnly, true);
        assert.ok(options.applicationServerKey instanceof Uint8Array);
        return Promise.resolve(subscription);
      }
    }
  };
  const client = {
    auth:{
      getSession:async () => ({ data:{ session:{ user:{ id:'user-1' } } } }),
      getUser:async () => ({ data:{ user:{ id:'user-1' } } })
    },
    from:table => {
      assert.equal(table, 'push_subscriptions');
      return {
        upsert:async row => {
          upsertCalls += 1;
          assert.equal(row.user_id, 'user-1');
          assert.equal(row.endpoint, subscription.endpoint);
          return { error:null };
        }
      };
    }
  };

  const document = {
    documentElement:{ dataset:{} },
    querySelector:selector => ({
      '#severReminderStatus':statusNode,
      '#severReminderDayBefore':dayNode,
      '#severReminderFifteen':fifteenNode
    })[selector] || null,
    addEventListener:(type, handler, capture) => {
      if (type === 'change' && capture === true) changeCapture = handler;
    }
  };
  const listeners = new Map();
  const notificationApi = { permission:'default' };
  const PushManagerApi = function PushManager(){};
  const window = {
    matchMedia:query => ({ matches:query === '(display-mode: standalone)' }),
    Notification:notificationApi,
    PushManager:PushManagerApi,
    SeverApp:{
      getState:() => state,
      persist:async () => { persisted += 1; }
    },
    SeverSupabase:{ getClient:async () => client },
    addEventListener:(type, handler) => listeners.set(type, handler),
    dispatchEvent:() => true
  };
  const navigator = {
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    platform:'iPhone',
    maxTouchPoints:5,
    standalone:true,
    serviceWorker:{ ready:Promise.resolve(registration) }
  };
  const context = {
    window,
    document,
    navigator,
    Notification:notificationApi,
    PushManager:PushManagerApi,
    HTMLInputElement:FakeInput,
    Uint8Array,
    atob:value => Buffer.from(value, 'base64').toString('binary'),
    Intl,
    Date,
    Promise,
    CustomEvent:class CustomEvent { constructor(type, init){ this.type=type; this.detail=init?.detail; } },
    console
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(typeof changeCapture, 'function');
  assert.equal(document.documentElement.dataset.severIosPushPrewarm, 'ready');

  const input = new FakeInput();
  let stopped = false;
  const event = {
    target:input,
    preventDefault(){},
    stopImmediatePropagation(){ stopped = true; }
  };

  changeCapture(event);
  if (!stopped) legacyCalls += 1;

  assert.equal(stopped, true, 'iOS capture must stop the old target listener');
  assert.equal(legacyCalls, 0, 'legacy enableFromGesture must not run on iPhone');
  assert.equal(subscribeCalls, 1, 'subscribe must start synchronously from the toggle gesture');
  assert.equal(document.documentElement.dataset.severIosPushGesture, 'captured');

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(upsertCalls, 1);
  assert.equal(state.pushReminders.enabled, true);
  assert.equal(input.checked, true);
  assert.ok(persisted >= 1);
  assert.equal(statusNode.textContent, 'Включено на iPhone · Web Push подключён.');
  assert.equal(statusNode.dataset.kind, 'ok');
});
