# IZI Planner — PHASE 1: аудит доноров и архитектура

> Статус документа: PHASE 1 — **DESIGN**; PHASE 2 (Foundation) —
> **IMPLEMENTED + TESTED LOCALLY** в ветке `izi/foundation` (см. раздел Z и
> «PHASE 2 — фактические решения»). Ни одна миграция не применена к реальному
> Supabase, ничего не задеплоено. Дата аудита: 2026-09-25.

---

## 0. Что фактически исследовано и как

| Источник | Состояние на момент аудита | Что сделано |
|---|---|---|
| `golovalisaia-hub/sever-planner` · `main` | HEAD `4f722eb` (merge PR #76, v126, 2026-09-17), 611 коммитов | Прочитаны миграции 001–017 целиком, Edge Functions `sever-ai/*`, `sever-push-*`, `js/cloud-runtime.js`, `js/sync-core.mjs`, `sever2-finance-v111.js` (модель хранения), `backend/`, ARCHITECTURE/SECURITY/DEPLOY_SECURITY/README, CI `security.yml` |
| `claude/hopeful-hawking-gljtn8` (TAVRO) | 5 коммитов поверх `4f722eb` (2026-09-19…20), +7 652 строки в 35 файлах, **ни один файл SEVER не изменён** | Прочитаны `TAVRO.md`, `_shared/*`, `_tavro/*` (bot, api, store, capture, search, reminders, telegram, billing, payments, quick, ai/*), миграции 018–019, тесты |
| Тесты TAVRO | `node --test tests/tavro-*.test.mjs tests/security/tavro-security.test.mjs` | **75 pass / 0 fail** (Node 22, в этой сессии). В TAVRO.md заявлено 76 unit + 84 browser; браузерные не запускались |
| Тесты SEVER | `node --test tests/*.test.mjs tests/security/*.test.*` | **276 pass / 1 fail / 2 skip**. Fail — `sever-ai-sql` (нет установленного `@electric-sql/pglite`, это не дефект кода). Skip — внешние RLS/Auth тесты без секретов |
| Внешние сервисы (Telegram, OpenAI, Supabase prod) | — | **Не проверялись.** Ключей нет, в production ничего не вызывалось |
| SGX Planner | — | Не исследовался напрямую; используется только список возможностей из ТЗ |

**Важно про окружение:** сессия была привязана к репозиторию `golovalisaia-hub/-`
(это другой проект — QA Academy). `sever-planner` подключён отдельно; документ
положен в `sever-planner` на ветку `claude/gallant-feynman-lsqj0j`. PR не создавался.

### Шкала статусов, используемая в документе

| Статус | Значение |
|---|---|
| DESIGN | Только описано в этом документе |
| IMPLEMENTED | Код написан |
| TESTED WITH MOCKS | Проходят тесты с поддельными провайдерами/БД |
| TESTED LOCALLY | Проверено на локальном Postgres/Deno с реальной схемой |
| TESTED AGAINST REAL SERVICE | Вызван настоящий OpenAI/Telegram/Supabase |
| DEPLOYED | Выложено в облако |
| VERIFIED IN TELEGRAM | Прогнан реальный сценарий в живом Telegram-клиенте |
| PRODUCTION READY | Всё выше + мониторинг, бэкапы, runbook, нагрузочная проверка |

Статус доноров: TAVRO — **IMPLEMENTED + TESTED WITH MOCKS**, не DEPLOYED, не
VERIFIED IN TELEGRAM (подтверждено самим TAVRO.md, раздел 10). SEVER PWA —
DEPLOYED на GitHub Pages по README; SEVER AI — «deployed» по
`SEVER_AI_PROGRESS.md`; **мной не проверялось**.

---

## A. Executive Summary

**IZI Planner** — персональная Telegram-first система управления жизнью.
Пользователь не выбирает раздел: пишет, говорит (позже — присылает фото), а IZI
понимает смысл, раскладывает фразу на типизированные записи, показывает
предпросмотр и сохраняет только после подтверждения. Mini App — окно для
визуального обзора и массового управления, а не основной ввод.

Ключевые архитектурные решения:

1. **Одна модель данных и одна идентичность.** Никаких параллельных `tasks` и
   `tavro_tasks`. Аккаунт IZI — корневая сущность; Telegram — первая из
   нескольких *привязанных идентичностей* (позже — email/web, импорт SEVER).
2. **Сервер — единственная граница доверия.** Клиенты (бот, Mini App, Shortcuts)
   никогда не ходят в БД напрямую и никогда не сообщают свой `account_id`.
3. **AI — недоверенный парсер.** Он выдаёт только строго типизированный
   `Capture | Query | Mutation` план. Сервер валидирует, находит реальные
   записи, строит предпросмотр, пишет в БД транзакционно.
4. **Каждая мутация — это `pending_action` → confirm → apply → `activity_log`.**
   Отсюда бесплатно получаются Undo, аудит, Trends и Personal Memory.
5. **Доменные модули с единым контрактом** (схема для AI, валидатор,
   предпросмотр, apply-RPC, query-intents, вклад в Digest). Money/Food/Goals
   добавляются как новые модули без изменения ядра.

Доноры: из TAVRO берём *механизмы* (Telegram trust boundary, date resolver,
строгая схема, capture→preview→confirm, типизированный поиск, квоты, fakes,
тесты), из SEVER — *инженерные конвенции и бизнес-правила* (RLS-паттерны,
least-privilege, pg_cron+Vault, «один голос за раз», PGlite-тесты БД,
расчёт финансовых планов). Не берём: отдельные `tavro_*` таблицы как продукт,
PWA sync-протокол SEVER, UI обоих, FastAPI-заготовку, iPhone-диагностику v119–v126.

---

## B. Product Principles

1. **Не думай, куда записать.** Один вход (чат/голос/кнопка), IZI сам определяет тип.
2. **Capture → Understand → Preview → Confirm → Save.** Без подтверждения AI
   ничего не пишет в БД.
3. **AI не придумывает данные.** Нет даты — `null`. Нет времени — `null`.
   «Вечером» — это подсказка части дня, а не 18:00. Нет длительности — `null`
   (а не 60 минут по умолчанию).
4. **Сомневаешься — спроси или положи в Inbox.** Ничего не теряется; ничего не
   домысливается.
5. **Ответы о данных пользователя — только из реальных записей.** Каждое
   утверждение ответа ссылается на конкретные ID, полученные сервером.
6. **Всё обратимо.** Каждая подтверждённая мутация имеет Undo минимум 10 минут
   и след в журнале.
7. **Telegram достаточно.** 80% ежедневных операций не требуют Mini App.
8. **Тишина по умолчанию.** Уведомление — возможность, а не обязанность
   (правило SEVER v118). Не больше одного «голоса» за раз, тихие часы уважаются.
9. **FREE реально полезен.** Планер, напоминания, Digest и ручной ввод не
   ограничены; лимитируется только стоимость внешнего AI.
10. **Приватность по конструкции.** Минимум данных в AI-запросе, ничего
    личного в логах, экспорт и удаление аккаунта — с первого релиза.
11. **Одна правда о данных.** Одна схема, одна идентичность, одна точка записи.
12. **Честные статусы.** Функция не называется готовой, пока не прошла
    соответствующий уровень проверки из шкалы выше.
13. **Расширяемость модулями.** Новая сфера жизни = новый модуль, ядро не трогаем.
14. **Сначала логика, потом дизайн.** UI не проектируется, пока не зафиксированы
    контракты API.

---

## C. SEVER Audit

### C.1 Что это на самом деле

Статический offline-first PWA (vanilla JS, `index.html` + `app.js` + ~45
патч-модулей `sever2-*-vNNN.js/css`) на GitHub Pages; Supabase Auth (email) +
Postgres + Realtime; 7 Edge Functions (`sever-ai`, 6 × `sever-push-*`);
pg_cron + pg_net + Vault для web push. Экспериментальный FastAPI в `backend/`.

### C.2 Модель данных (миграции 001–017)

| Таблица | Ключевые поля | Наблюдения |
|---|---|---|
| `profiles` | id→auth.users, email, role(owner/user) | Единственный owner через уникальный частичный индекс |
| `tasks` | title ≤160, `scheduled_for date`, `scheduled_time time` (003), duration, `category` NOT NULL default 'Личное', `priority bool`, `challenge bool`, completed/completed_at, soft delete | **Нет** дедлайна, отличного от даты плана; **нет** часового пояса; **нет** повторяемости в БД; **нет** истории переносов |
| `habits` / `habit_entries` | title ≤80; entry по дате | Нет расписания, цели, единиц |
| `note_folders` / `notes` | kind, items jsonb, protected + `secure` (AES-GCM envelope) | Сильная клиентская криптография |
| `focus_sessions` | task_id, длительность | Вне скоупа IZI |
| `user_settings` | `data jsonb` | **Финансы v111 хранятся здесь как JSON-блоб** (`state.profile.finance`) — не запрашиваемы из SQL |
| `ai_memories`, `ai_plans`, `ai_usage` | память ≤300 символов, планы, учёт | |
| `push_subscriptions`, `push_deliveries`, `push_rhythm_deliveries` | Web Push | |
| `push_probe_attempts_v120`, `push_iphone_*_v121/122/126` | одноразовые диагностические журналы | Технический долг под конкретный iPhone |

Во все синхронизируемые таблицы добавлен `sync_versions jsonb` + триггер
`sever_keep_newest_update` (005) — пополевое версионирование для offline-клиентов.

### C.3 Решения по компонентам

| Компонент | Решение | Почему |
|---|---|---|
| Supabase как платформа (Postgres, Edge Functions на Deno, pg_cron, pg_net, Vault) | **REUSE** | Проверенный стек, команда умеет, есть паттерны деплоя и секретов |
| Supabase Auth (email/OTP) как корень идентичности | **ADAPT** | Telegram-пользователь не имеет Auth-сессии. В IZI корень — `accounts`; Supabase Auth станет *одной из* привязываемых идентичностей (web-вход, импорт SEVER) |
| RLS-конвенции: `(select auth.uid())`, `to authenticated`, deny-all политики для серверных таблиц, `force`, FK-индексы (006, 008, 012) | **REUSE** (как конвенции) | Правильные и дешёвые практики; переносим в чек-лист миграций |
| Least-privilege grants (009): revoke all → grant только нужное | **REUSE** | Для IZI: клиентские роли не получают ничего |
| Триггер владения связями `sever_check_owned_relations` | **ADAPT** | Заменяем на составные FK `(account_id, id)` — проверка на уровне схемы, без триггера |
| Soft delete `deleted_at` | **REUSE** | Нужен для Undo и «корзины» |
| Field-version sync (005), `sync-core.mjs`, `cloud-runtime.js` | **DROP** | IZI server-authoritative, Mini App online-first. Протокол сложный и **опасен при совместном использовании**: триггер копирует в результат только колонки из групп `sever_sync_groups`, поэтому любой новый столбец, изменённый версионированным UPDATE, откатывается к старому значению. Использовать таблицы SEVER как ядро IZI = вечно поддерживать этот протокол |
| Полный pull всех таблиц на каждое Realtime-событие (`cloud-runtime.js:424`, пагинация по offset) | **DROP** | O(N) на изменение; не масштабируется |
| Таблицы `tasks/habits/notes` как схема ядра IZI | **DROP как схему, ADAPT как источник импорта** | Ограничения под PWA (title ≤160, обязательная категория 'Личное', нет tz/дедлайна/повторов/истории). Данные SEVER переносятся импортом |
| Защищённые заметки (клиентское AES-GCM, PBKDF2 600k) | **DROP для V1** (FUTURE: «Сейф») | Несовместимы с серверным AI и ботом: сервер не может читать содержимое. Возможна будущая функция «сейф вне AI» |
| Focus timer / focus_sessions | **DROP** (FUTURE) | Не входит в продукт IZI |
| Finance v111 (бюджеты по категориям, регулярные платежи, цели/долги) | **ADAPT (домен), DROP (хранение)** | Бизнес-правила полезны для модуля Money; хранение в JSON-блобе настроек — нет |
| `sever-ai/plans.ts` (детерминированный расчёт финансовой цели/плана чтения) | **ADAPT** | Правильный принцип: AI извлекает числа, считает код |
| `sever-ai` handler: провайдер за сервером, строгая валидация, owner-инструменты | **ADAPT (идеи)** | Регекс-гейтинг инструментов `toolsFor()` — **DROP**, заменяется типизированным роутером |
| `sever_claim_ai_quota` | **REWRITE** | Берёт **глобальный** `pg_advisory_xact_lock(78142201)` и считает `count(*)` по всем пользователям за день — сериализует все AI-запросы всех пользователей. При 100k — узкое место |
| HMAC-подписанные confirmation-токены (`confirmation.ts`) | **ADAPT** | Для IZI лучше серверное состояние `pending_actions` (массовые операции, выбор кандидатов, Undo). HMAC оставляем для коротких callback-токенов и сессий Mini App |
| `ai_memories` (явная память ≤300 символов, выключаемая) | **ADAPT** | Основа слоя «явные факты» Personal Memory |
| Push-инфраструктура (VAPID, dispatch, delivery ledger с unique-ключом) | **ADAPT (паттерн)** | Паттерн «claim → ledger с unique → send» переносим в диспетчер Telegram-уведомлений. Web Push — FUTURE-канал |
| iPhone probe/retry/topic/live-check v120–v126 | **DROP** | Разовая диагностика одного устройства |
| Day rhythm v115/v118 (утро/день/вечер, агрегирование, «один голос за раз», «checkpoint — возможность, а не обязанность») | **ADAPT** | Прямая основа Digest и политики уведомлений |
| Missed tasks v106, Home/Now, usability-бизнес-правила | **ADAPT (правила)** | Идеи «пропущенных» и «что сейчас» переходят в Digest/Today |
| `backend/` FastAPI | **DROP** | Идентичность через заголовок `X-SEVER-User-Id` (dev-only) |
| UI (CSS/темы/мобильная геометрия) | **DROP** | Дизайн IZI не делается на этом этапе |
| Тестовая инфраструктура: `node --test` по `.ts`, PGlite-тест миграций с ролями и `request.jwt.claim.sub`, Playwright 320/360/390/desktop, secret scan в CI | **REUSE** | Лучший актив SEVER для IZI |
| Backup-формат `sever-backup v2` | **ADAPT** | Готовый вход для импорта SEVER → IZI |

---

## D. TAVRO Audit

### D.1 Что это

Telegram-бот + Mini App на тех же Supabase и Deno, 14 таблиц `tavro_*`,
service-role-only доступ, Yandex/OpenAI-совместимый LLM, SpeechKit/Whisper STT,
Stars-платежи, быстрый ввод по токену. Качество инженерии заметно выше
среднего: много правильных механизмов и честная документация ограничений.

### D.2 Найденные дефекты и риски (проверено чтением кода)

| # | Где | Проблема | Последствие |
|---|---|---|---|
| T1 | `bot.ts` + `tavro_claim_update` | `update_id` фиксируется **до** обработки, любая ошибка отдаёт Telegram `200 OK` | Временный сбой БД/AI после claim = сообщение пользователя **молча потеряно**, повтора не будет |
| T2 | `bot.ts` | Весь конвейер (скачивание голоса, STT, LLM) выполняется синхронно внутри webhook | Таймауты webhook/Edge Function, повторы Telegram, нет backpressure |
| T3 | `store.saveItems` + `claimCapture` | Черновик помечается `confirmed`, затем записи вставляются по одной через PostgREST без транзакции | Частичный сбой = часть записей сохранена, черновик «подтверждён», повторить нельзя |
| T4 | `store.saveItems` | Встреча без длительности получает **60 минут по умолчанию**; встреча без даты **молча** превращается в задачу категории «Встречи» | Нарушение правила «не придумывать данные» и скрытая трансформация |
| T5 | `datetime.ts` | `next_week` → `today + 7`, `next_month` → то же число | «На следующей неделе» превращается в конкретный день — выдуманная дата. Нужна *точность даты* (день/неделя/месяц) |
| T6 | `ai/schema.ts` | Нет различия «когда сделать» и «срок до» | «Оплатить интернет **до пятницы**» записывается как плановая дата пятницы |
| T7 | `ai/schema.ts` | Запрет на выдуманное время обеспечивается **только промптом** | Модель вернёт `"18:00"` на «вечером» — схема это пропустит |
| T8 | `bot.ts:isQuestion` | Регекс по первому слову. `(?![а-яё])` пропускает дефис | «Как-нибудь позвонить бабушке» классифицируется как вопрос, а не как задача |
| T9 | `tavro_claim_reminders` | Помечает `sent` в момент claim; ошибка отправки = `failed` без повтора, 429/403 Telegram не различаются | Потерянные напоминания; пользователь, заблокировавший бота, продолжает «получать» |
| T10 | `tavro_rate_check`, `tavro_claim_update` | `delete … where window_start/received_at < …` на **каждом** вызове; для `tavro_updates` нет индекса по `received_at` | Полный скан таблицы на каждое сообщение при росте |
| T11 | `store.snoozeTask` | Перенос перезаписывает дату без истории | Невозможны Trends «что я чаще переношу» |
| T12 | `api.ts` | Каждый запрос Mini App делает `UPDATE tavro_accounts` (last_seen) | Запись на каждое чтение |
| T13 | `verifyInitData` | `signature` исключается из data-check-string; тест подписывает initData тем же кодом | Соответствие реальному initData Telegram **не проверено**; тест не может поймать расхождение со спецификацией |
| T14 | `quick.ts` | `uses` не выбирается в `select`, счётчик всегда становится 1 | Мелкий баг учёта |
| T15 | `search.ts` | Фильтры собираются строкой для PostgREST `.or()` | Хрупкая экранизация; для IZI — параметризованные RPC |
| T16 | Схема | `quiet_hours_*` объявлены, но нигде не используются | Мёртвая схема |
| T17 | Архитектура | 14 собственных таблиц, собственная идентичность, `sever_user_id` как «мостик» | Второй продукт со второй моделью данных — главная ошибка |

### D.3 Решения по компонентам

| Компонент TAVRO | Решение | Что меняем |
|---|---|---|
| `telegram.ts` verifyInitData (HMAC WebAppData, constant-time, auth_date свежесть/будущее) | **ADAPT** | Проверить на реальном initData (T13); уменьшить maxAge до ~1 ч и обменивать initData на короткую серверную сессию |
| `verifyWebhookSecret` | **REUSE** | Без изменений |
| `TelegramApi` клиент, `escapeHtml`, потоковое скачивание с лимитом | **ADAPT** | Добавить обработку `retry_after` (429), 403 → пометить чат заблокированным, глобальный rate limiter исходящих |
| `_shared/validation.ts` (`object` с запретом identity-полей, `text`, `uuid`, `day`, `clock`…) | **REUSE** | Переименовать сообщения, общий модуль ядра |
| `_shared/datetime.ts` (todayIn, zonedToUtc через DST, resolveRelative, formatWhen) | **ADAPT** | Ввести точность даты (T5), период суток как подсказку, дедлайн (T6) |
| `ai/schema.ts` строгий парсер: неизвестные ключи = ошибка, date ∈ {null, relative, absolute}, dedupe, повторная валидация черновика | **ADAPT** | + evidence-спаны (T7), + дедлайн/точность, + discriminated union Capture/Query/Mutation, + inbox-тип |
| `ai/prompt.ts` (фраза как JSON-данные, запрет на выдумывание) | **ADAPT** | Версионирование промптов; eval-набор |
| `ai/provider.ts` интерфейс AIProvider + OpenAI-compatible адаптер + fake | **ADAPT** | Добавить OpenAI-адаптер со строгой JSON-схемой; Yandex — **DROP** (основной провайдер — OpenAI по решению владельца) |
| `ai/speech.ts` SpeechProvider + лимиты | **ADAPT** | OpenAI-транскрипция; формат OGG/Opus требует проверки (см. раздел J) |
| `capture.ts` квота до вызова, release при сбое, один вызов = одно действие, preview HTML/JSON | **ADAPT** | Перенести в worker; apply через транзакционный RPC |
| `search.ts` AI → типизированный план → детерминированный ответ | **REUSE (принцип) / ADAPT (код)** | Реестр query-intents по модулям, параметризованные RPC |
| `store.ts` «всё по account_id» | **ADAPT** | Репозиторий + составные FK; мутации через SQL-функции |
| `reminders.ts` + `tavro_claim_reminders` (SKIP LOCKED, проверка актуальности цели перед отправкой) | **ADAPT** | Статусы `claimed → sent/failed(retry)`, повторы, 403-обработка, тихие часы |
| `tavro_claim_ai_action` / release | **ADAPT** | Per-account lock (хорошо), учёт стоимости; лимиты из entitlements, не из кода |
| `tavro_claim_update` | **REWRITE** | Очередь входящих обновлений со статусами (T1) |
| `tavro_rate_check` | **ADAPT** | Очистка по cron, не в горячем пути (T10) |
| `quick.ts` scoped tokens (SHA-256, отзыв, лимит 5) | **ADAPT** | Исправить T14; scope только `capture`; используется для iOS Shortcuts |
| `billing.ts` (цена в Stars только из конфигурации, не продавать без цены, terms_version фиксируется) | **ADAPT (принципы)** | Тарифы — в таблице конфигурации, не в коде |
| `payments.ts` (идемпотентность по charge_id, pre-checkout, refund, expire) | **ADAPT позже** (Phase Subscriptions) | Не на этом этапе |
| `tavro_*` таблицы | **DROP** | Главная ошибка (T17). Схема IZI проектируется заново |
| Mini App IMPULSE (`tavro/`) | **DROP** | Дизайн позже; допустимо взять только паттерн API-клиента |
| `tests/tavro-fakes.mjs` (FakeDb/FakeTelegram/FakeProvider) | **ADAPT** | Основа тестового контура IZI |
| Тесты tavro-core/bot/api/security | **ADAPT** | Сценарии переносим, ассерты меняем под новую модель |
| Бренд TAVRO, IMPULSE, тексты | **DROP** | |

---

## E. Architecture mistakes — больше не повторяем

1. **Продукт «рядом», а не «поверх».** Две модели данных и две идентичности.
   → Одна схема, один `accounts`, идентичности привязываются.
2. **Подтверждение ≠ транзакция.** Отметка «сохранено» до реальной записи (T3).
   → Apply = одна SQL-функция в одной транзакции; статус меняется в ней же.
3. **«Обработано» до обработки** (T1). → Входящие обновления сначала
   персистятся, потом обрабатываются с повторами.
4. **Тяжёлая работа в webhook** (T2). → Webhook только принимает; работа в worker.
5. **Правило держится на промпте** (T7). → Правило держится на коде: evidence-спаны
   и детерминированная проверка.
6. **Дефолты, выдающие себя за данные** (T4, T5). → `null` и явная точность.
7. **Перезапись без истории** (T11). → Append-only `activity_log`.
8. **Глобальные блокировки и полные сканы в горячем пути** (SEVER quota, T10).
   → Только per-account блокировки; очистка — фоновой задачей.
9. **Регексы вместо понимания** (`toolsFor`, `isQuestion`). → Типизированный
   роутер; детерминированно только команды и кнопки.
10. **Бизнес-данные в JSON-блобе настроек** (Finance v111). → Отдельные таблицы.
11. **Патч-модули с версиями в имени файла** (`sever2-*-v109.js`, таблицы `*_v121`).
    → Версии живут в git и миграциях, не в именах сущностей.
12. **Тест, подписывающий данные тем же кодом, что проверяет** (T13). →
    Контрактные тесты на реальных образцах + проверка в живом Telegram.

---

## F. User model — как Telegram-пользователь становится аккаунтом IZI

```
accounts (1) ──< identities (N)
   id uuid                      provider: 'telegram' | 'supabase_auth' | 'sever_import'
   timezone, locale             subject:  telegram user id | auth.users.id | ...
   status, plan                 unique(provider, subject)
```

Поток первого контакта:

1. Telegram присылает `message` от `from.id = 123` (webhook проверен секретом).
2. Worker ищет `identities(provider='telegram', subject='123')`.
3. Нет — в одной транзакции создаётся `accounts` + `identities` + `telegram_chats`
   (chat_id, статус доставки). Идемпотентно по unique(provider, subject).
4. Онбординг: язык из `language_code` (подсказка), **часовой пояс спрашивается
   явно** (кнопки популярных поясов + «другой»), до ответа используется
   `timezone_source='unconfirmed'` и относительные даты показываются с пометкой.
   Mini App может передать `Intl.DateTimeFormat().resolvedOptions().timeZone`
   как *подсказку*, пользователь подтверждает.
5. Mini App: initData → проверка подписи → та же identity → выдача короткой
   серверной сессии (HMAC-токен, 1 ч, привязан к account_id и identity).

Позже:
- **Web/email вход**: Supabase Auth → `identities(provider='supabase_auth')`.
  Привязка к существующему аккаунту только из уже аутентифицированной сессии
  (код подтверждения в Telegram), никогда по совпадению email.
- **Импорт SEVER**: пользователь входит в SEVER-аккаунт в Mini App или загружает
  `sever-backup v2`; данные конвертируются в сущности IZI, `source='sever_import'`.
- **Удаление аккаунта**: каскад от `accounts`; идентичности освобождаются.

Инварианты: `account_id` никогда не приходит от клиента; одна Telegram-личность
= ровно один аккаунт; слияние аккаунтов — отдельная явная операция (FUTURE).

---

## G. Core entities

### G.1 Принцип модульности

Ядро (фиксировано):

| Таблица | Назначение |
|---|---|
| `accounts`, `identities`, `telegram_chats` | Идентичность и канал доставки |
| `account_settings` | Типизированные настройки (tz, тихие часы, время digest, язык) |
| `captures` | Каждый сырой вход (текст/транскрипт/фото-метаданные), источник, статус |
| `pending_actions` | Предложение: черновик capture или план мутации; статус, срок жизни, короткий токен для callback |
| `activity_log` | Append-only журнал доменных событий (created/updated/completed/rescheduled/deleted/restored…) с before/after |
| `reminders` | Запланированные уведомления по конкретной записи |
| `notification_outbox` | Всё, что нужно отправить (reminder, digest, ответ), с ретраями |
| `ai_runs` | Учёт AI-вызовов: тип, провайдер, модель, версия промпта/схемы, токены, секунды аудио, латентность, исход. **Без содержимого** |
| `inbound_updates` | Очередь входящих Telegram-обновлений |
| `entitlements`, `plan_catalog` | Права и лимиты (без зашитых тарифов) |
| `quick_tokens`, `rate_limits` | Быстрый ввод, ограничения |

Доменные модули (каждый — свои таблицы, одинаковый контракт):

| Модуль | Таблицы | Фаза |
|---|---|---|
| Tasks | `tasks` | MVP |
| Calendar | `events` | MVP |
| Notes | `notes` (kind: note / idea / diary) | MVP (diary — V1) |
| Inbox | `inbox_items` | MVP |
| Habits/Rituals | `habits`, `habit_logs` | V1 |
| Money | `money_accounts`?, `transactions`, `categories`, `budgets`, `recurring_payments` | V2 |
| Food/Water | `meals`, `water_logs` | V2 |
| Goals | `goals`, `goal_links` | V2 |
| Memory | `subjects` (люди/места/вещи/темы), `subject_links`, `memory_facts` | V2+ |

Контракт модуля (`DomainModule`):
`itemSchema` (JSON Schema для AI) · `validate()` · `preview()` (Telegram HTML +
JSON для Mini App) · `apply` (SQL RPC) · `queryIntents` · `digestContributor` ·
`activityEvents` · `exportRows()`. Роутер собирает общую AI-схему из
зарегистрированных модулей, поэтому новый модуль не меняет ядро.

Почему не одна универсальная таблица `records`: разные инварианты (сумма денег
в minor units + валюта, интервал встречи, лог привычки), разные индексы и
разные запросы Trends. Общие *поведения* (журнал, напоминания, ссылки,
источник) вынесены в ядро, а *данные* — в типизированные таблицы.

### G.2 Общие колонки каждой доменной записи

`id uuid`, `account_id uuid not null`, `source` (text/voice/photo/miniapp/quick/import),
`capture_id` (nullable, FK), `version int` (оптимистичная конкуренция),
`created_at`, `updated_at`, `deleted_at`, `unique (account_id, id)` — для составных FK.

### G.3 Ключевые сущности (MVP/V1)

**Task**
- `title`, `notes`
- `status`: open / done / cancelled; `completed_at`, `completed_local_date`, `completed_local_hour`
- **План**: `plan_date date null`, `plan_precision`: day / week / month (для «на следующей неделе»), `plan_time time null`, `part_of_day`: morning/afternoon/evening/null (подсказка, **не время**)
- **Срок**: `due_date date null`, `due_time time null` («до пятницы»)
- `duration_min int null`, `importance`: normal/high (без выдуманной шкалы)
- `timezone` (фиксируется, если есть время), `recurrence` (RRULE-подмножество, V1)
- `reschedule_count int` (кэш из activity_log)

**Event / Meeting**
- `title`, `starts_date`, `start_time null`, `end_time null` / `duration_min null` (**без дефолта 60**), `all_day bool`, `timezone`, `starts_at timestamptz` (вычисляется), `location`, `participants text[]` (→ `subjects` в V2), `status` planned/done/cancelled, `recurrence`

**Note** — `kind` note/idea/diary, `title`, `body`, `entry_date` (обязательна для diary), `tags text[]`, полнотекстовый индекс.

**Inbox item** — см. раздел N.

**Habit** — `title`, `schedule` (дни недели или N раз в неделю), `target_value numeric null` + `unit` («30 мин»), `preferred_time null`, `active`. **HabitLog** — `habit_id`, `local_date`, `value`, `done`, unique(habit_id, local_date).

**Reminder** — см. раздел O.

### G.4 Связи

Связи — через явные FK, где тип известен (`reminders.task_id | event_id | habit_id`
с ограничением «ровно один»; `inbox_items.converted_task_id…`). Для
«после стоматолога купить пасту» — `tasks.after_event_id null` (V1) либо общая
`record_links` (V2) с проверкой владения триггером. Полиморфные ссылки без FK
допускаются только в `activity_log` (журнал, не источник правды).

---

## H. Data ownership

Многослойно, потому что Edge Functions работают service-role (RLS обходится):

1. **Идентичность только из подписи** (webhook secret / initData / сессия /
   quick-token). Входной `account_id`/`user_id`/`telegram_id`/`role` —
   ошибка валидации (механизм `object()` из TAVRO).
2. **Единственный слой доступа к данным** — репозиторий, принимающий
   `AccountContext` первым аргументом. Статический тест в CI запрещает
   `.from('…')`/`.rpc('…')` вне этого слоя.
3. **Мутации — SQL-функции** `izi_apply_*(p_account uuid, …)`: каждая фильтрует
   по `p_account`, выполняется в одной транзакции, `security invoker`, grant
   только service_role.
4. **Составные FK `(account_id, target_id) → target(account_id, id)`**: запись
   одного аккаунта физически не может ссылаться на запись другого (напоминание,
   конвертация inbox, лог привычки, capture).
5. **RLS включён и `force` на всех таблицах, клиентских политик нет** (deny-all);
   `revoke all from anon, authenticated`. Утечка publishable key не даёт ничего.
6. **Будущее прямое чтение из Mini App** (если понадобится Realtime): Supabase
   custom JWT с `sub = account_id` + политики `account_id = (select auth.jwt()->>'sub')::uuid`.
   Только чтение, запись — всегда через API.
7. **Тесты владения** на каждом эндпоинте и RPC: «аккаунт B не видит/не меняет
   запись A», включая угадывание UUID и callback-токены чужого `pending_action`.

---

## I. AI Architecture

### I.1 Поток

```
вход (текст | транскрипт)
  → детерминированный пре-роутер: команды, кнопки, ответ на уточнение
  → AI Interpret (1 вызов, строгая схема, discriminated union):
        { kind: "capture",  items: [...] }
      | { kind: "query",    plan: {...} }
      | { kind: "mutation", plan: {...} }
      | { kind: "clarify",  question, partial }
      | { kind: "chat" }            // благодарность, помощь — без записи
  → локальная валидация (всегда, даже при strict-схеме провайдера)
  → evidence-проверка дат/времени/сумм
  → сервер: разрешение дат в TZ пользователя, поиск реальных записей
  → preview + pending_action   (для capture/mutation)
  → confirm → транзакционный apply → activity_log → ответ
```

### I.2 AI Provider abstraction

```ts
interface AIProvider {
  interpret(input: { system: string; payload: object; schema: JsonSchema;
                     schemaName: string; maxOutputTokens: number; signal }):
    Promise<{ json: unknown; usage: {inputTokens, outputTokens}; model: string; refusal?: string }>;
}
interface SpeechProvider { transcribe(audio, mime, durationSec, lang): Promise<{ text, seconds }> }
interface VisionProvider { describe(image, task): Promise<...> }   // V2
```

- Адаптеры: `OpenAIProvider` (основной), `OpenAICompatibleProvider` (запасной,
  из TAVRO), `FakeProvider` (тесты). Выбор и **модели — только из конфигурации**
  (`IZI_AI_MODEL_INTERPRET`, `IZI_AI_MODEL_ANSWER`, `IZI_STT_MODEL`), разные
  модели для разных задач (дешёвая — роутинг/извлечение, сильнее — анализ).
- Для OpenAI планируется использовать Structured Outputs со строгой JSON-схемой.
  **Не проверено в этой сессии:** точные эндпоинты, имена параметров,
  ограничения поддерживаемого подмножества JSON Schema, актуальные модели и цены
  — фиксируются в PHASE 6 по официальной документации и реальным вызовам.
  Поэтому локальный валидатор остаётся обязательным.
- Схема генерируется из зарегистрированных модулей → один источник правды для
  AI-схемы и серверной валидации.

### I.3 Правило «AI не придумывает дату и время» — теперь в коде

1. **Закрытый словарь**: `date` ∈ `null` | `{relative: token}` | `{absolute: YYYY-MM-DD}` |
   `{week: "this"|"next"}` | `{month: "this"|"next"|YYYY-MM}`; время ∈ `null` | `HH:MM`;
   `part_of_day` отдельно.
2. **Evidence-спаны**: каждое непустое поле даты/времени/суммы/длительности
   сопровождается `evidence` — точной подстрокой исходного текста. Сервер
   проверяет: (а) подстрока присутствует в тексте, (б) детерминированный
   русский лексикон подтверждает соответствие («завтра»↔tomorrow,
   «в 16:00»/«в четыре»↔16:00, «до пятницы»↔due). Несоответствие → поле
   обнуляется и превращается в уточнение, а не в ошибку всей фразы.
3. **Двусмысленности** («в 4» = 04:00 или 16:00; «в пятницу» сегодня пятница)
   разрешаются правилами продукта, зафиксированными в тестах, либо вопросом.
4. **Дедлайн ≠ план**: «до», «не позже», «к пятнице» → `due_*`.

### I.4 Безопасность AI

- Пользовательский текст передаётся как значение JSON, не склеивается с
  инструкциями; содержимое записей в контексте помечено как данные.
- Модель не видит SQL, ID других аккаунтов, секретов; в capture-вызов не
  передаются чужие/старые записи (только фраза + дата/время/TZ).
- Для mutation модель получает не записи, а только описание селектора;
  кандидатов находит сервер.
- Запрещённые поля (identity/entitlement) → отказ всего ответа.
- Лимиты: длина входа, `maxOutputTokens`, число items (≤12), таймаут.
- `ai_runs` хранит версии промпта/схемы/модели — воспроизводимость.
- **Eval-набор**: ≥150 эталонных русских фраз (разговорные, опечатки, голосовые
  артефакты, инъекции) с ожидаемым разбором. Прогон на реальном провайдере —
  gate перед сменой модели/промпта. Не в обычном CI (стоимость), результаты
  коммитятся.

### I.5 Что AI делает и не делает

| Может | Не может |
|---|---|
| Классифицировать намерение | Писать в БД |
| Извлекать поля со evidence | Выдумывать дату/время/длительность/сумму |
| Строить query/mutation plan из закрытого словаря | Выбирать конкретные ID записей для мутации |
| Формулировать ответ по переданным строкам с ссылками на их ID (V1+) | Утверждать то, чего нет в переданных строках |
| Предлагать план дня (как pending_action) | Применять план без подтверждения |

---

## J. Capture Engine

```
Telegram text ──┐
Telegram voice ─┼─> captures(status=received) ─> worker:
Mini App text ──┤      transcribe? (voice) ─> interpret ─> validate ─> evidence
Quick token ────┘      ─> resolve dates (TZ) ─> dedupe ─> pending_action(preview)
                       ─> сообщение с кнопками [Сохранить] [Изменить] [Отмена]
confirm ─> izi_apply_capture(account, pending_action_id, selected_items)
        ─> одна транзакция: записи + reminders + activity_log + статус
```

- **Text**: MVP.
- **Voice**: Telegram OGG/Opus → STT → тот же конвейер; транскрипт показывается
  в предпросмотре; аудио не хранится. **Риск:** поддерживает ли выбранная
  OpenAI-модель транскрипции OGG/Opus напрямую — **не проверено**; в Edge
  Runtime нет ffmpeg. Варианты: прямой приём (если поддерживается), перекодирование
  в отдельном сервисе, либо альтернативный STT за тем же интерфейсом. Решается в PHASE 7.
- **Image** (V2): фото → VisionProvider → те же items; калории — только как
  явно помеченная оценка, никогда как факт.
- **Частичный выбор**: пользователь может снять отдельные items (Mini App,
  в боте — «Изменить» → список с переключателями).
- **Уточнения**: `chat_sessions` хранит «жду ответ на вопрос X для
  pending_action Y» (срок 15 мин); ответ пользователя направляется туда, а не в новый capture.
- **Классификация «задача или привычка»** («английский 30 минут вечером»):
  если признаков регулярности нет — задача с `duration=30`, `part_of_day=evening`;
  если есть («каждый вечер») — привычка; если спорно — вопрос с двумя кнопками.
- **Одна фраза = одно AI-действие** (как в TAVRO).
- **Идемпотентность**: `captures` unique(`account_id`, `channel`, `external_id`)
  (chat_id:message_id); повтор обновления не создаёт второй capture.

---

## K. Query Engine («Что у меня завтра?»)

- AI строит `QueryPlan` из закрытого словаря интентов, собранного из модулей:
  `agenda(date|range)`, `upcoming`, `overdue`, `inbox_list`, `search(text, types)`,
  `last_occurrence(text)`, `count(type, range, filters)`, `progress(range)`,
  `habit_stats(habit, range)`, позже `money_summary`, `trend(...)`.
- **Частые запросы без AI**: кнопки и команды `/today`, `/tomorrow`, `/week`,
  `/inbox` исполняются детерминированно (быстро и бесплатно). Эвристика
  «вопрос это или запись» — только в AI-роутере (исправление T8).
- Исполнение — параметризованные SQL-функции, все по `account_id`, с лимитами
  периода и строк (из TAVRO `dayRange`).
- Ответ: V1 — детерминированные шаблоны (как в TAVRO: цифры и списки только из
  строк). V2 — AI-формулировка по переданным строкам, где каждый пункт ответа
  несёт ID записи; сервер отбрасывает ответ, ссылающийся на ID вне выборки.
- Полнотекстовый поиск: Postgres FTS (`russian` конфигурация) по заголовкам
  и тексту; семантический (pgvector) — V2, opt-in.

---

## L. Mutation Engine («Перенеси всё неважное с завтра на субботу»)

1. AI → `MutationPlan`:
   `{ op: "reschedule", selector: { type: "task", plan_date: {relative:"tomorrow"},
      importance: "normal", status: "open" }, change: { plan_date: {relative:"next_saturday"} } }`
   Допустимые `op`: complete, reopen, reschedule, update_fields, delete, restore,
   convert (inbox → X). Никаких ID от модели.
2. Сервер разрешает даты, **сам** выбирает кандидатов по селектору (лимит, например, 50).
3. Создаётся `pending_action` с явным списком ID и снимком `version` каждой записи.
4. Предпросмотр: «Нашёл 4 задачи, которые можно перенести на сб, 27 сен:» + список
   + `[Перенести 4] [Изменить выбор] [Отмена]`.
5. Confirm → `izi_apply_mutation`: в транзакции проверяет, что каждая запись
   принадлежит аккаунту и её `version` не изменилась (иначе исключает и
   сообщает), применяет, пишет `activity_log` (before/after), планирует/отменяет
   напоминания.
6. Ответ: «Перенёс 4. [Отменить]» — Undo восстанавливает `before` из журнала,
   если записи с тех пор не менялись.

Если селектор пуст — сообщение «Ничего подходящего нет», без pending_action.
Если признак не хранится («неважное» при отсутствии importance) — предпросмотр
явно говорит, по какому правилу отобрано.

---

## M. Confirmation model

| Действие | Подтверждение | Undo |
|---|---|---|
| Capture из свободного текста/голоса | **Да** (preview) | Да |
| Одиночное действие кнопкой на конкретной записи (✓ выполнено, → завтра, отметка привычки) | Нет — кнопка сама есть явное намерение | Да (кнопка «Вернуть») |
| Команда с явными параметрами из Mini App-формы | Нет | Да |
| Любая мутация, выведенная AI из текста | **Да** | Да |
| Массовая операция (>1 записи) | **Да**, со списком | Да |
| Удаление | **Да** | Да (корзина 30 дней) |
| Изменение прошлого (отметки за прошлые дни, выполненные задачи) | **Да** | Да |
| Финансовые операции (V2) | **Да** | Да |
| Удаление аккаунта / всех данных | **Двойное** + код | Нет (льготный период 7 дней — решение владельца) |
| Экспорт данных | Да (файл уходит в чат) | — |

Опция «быстрый режим» (FUTURE, выключена по умолчанию): одиночная задача без
даты сохраняется сразу с Undo. Только по явному согласию пользователя.

`pending_actions`: `id`, `short_token` (для `callback_data` ≤ 64 байт),
`account_id`, `kind`, `payload`, `candidate_ids`, `status`
(pending/confirmed/applied/discarded/expired/failed), `expires_at` (24 ч для
capture, 30 мин для мутаций), `applied_at`, `result`. Переход `pending → applied`
только внутри apply-RPC.

---

## N. Inbox model

- `inbox_items`: `text`, `capture_id`, `status` (open / converted / archived),
  `suggested_type` (AI-подсказка, nullable), `converted_type` + typed FK
  (`converted_task_id` | `converted_event_id` | `converted_note_id` …).
- Попадание:
  1. AI вернул `type: "inbox"` (мысль без явного намерения: «надо изучить Playwright»);
  2. пользователь нажал «В Inbox» на preview;
  3. AI недоступен/лимит исчерпан — **текст не теряется**, сохраняется в Inbox
     без AI (это же поведение FREE при исчерпании квоты);
  4. явная команда `/inbox <текст>` или быстрый ввод без разбора.
- Разбор: в боте `/inbox` → по одному элементу с кнопками
  `[Задача] [Встреча] [Заметка] [Архив]`; конвертация — mutation с журналом.
- Digest напоминает о необработанных элементах старше N дней (без давления).

---

## O. Reminder model

- `reminders`: `account_id`, ровно одна из `task_id | event_id | habit_id`,
  `rule` (at_time / offset_before(min) / morning_of / day_before),
  `remind_at timestamptz`, `status` (scheduled / claimed / sent / failed / cancelled / skipped),
  `attempts`, `next_attempt_at`, `dedupe_key` unique.
- **Создание**: только для записей с реальной датой (и временем для точных).
  Без даты — напоминаний нет (правило «не придумывать»). Дефолтные офсеты —
  в `account_settings`, не в коде.
- **Пересчёт** при изменении даты/времени/часового пояса записи или аккаунта
  (в той же транзакции, что и изменение).
- **Диспетчер** (pg_cron каждую минуту → Edge Function): `claim` с
  `FOR UPDATE SKIP LOCKED` → проверка актуальности цели (не выполнена, не удалена —
  идея TAVRO) → тихие часы → запись в `notification_outbox`.
- Повторы: 429 → `retry_after`; 5xx → экспоненциально до 3 попыток;
  403 (бот заблокирован) → `telegram_chats.blocked_at`, дальнейшие отправки
  пропускаются.
- «Один голос за раз» (SEVER v115): напоминание в окне ±N минут от digest
  поглощается digest-сообщением.

---

## P. Digest model

- Типы: `morning`, `evening`, `weekly` (V1). Время — в `account_settings`
  (по умолчанию утро 08:30, вечер 20:30, weekly — воскресенье вечер; всё
  в локальном времени пользователя).
- **Данные** считает SQL-функция `izi_digest_data(account, local_date, kind)` →
  структурированный JSON (задачи дня, встречи с временем, привычки, главное,
  просроченное, Inbox, итоги). Каждый модуль добавляет свой блок (`digestContributor`).
- **Рендер** — детерминированный шаблон (Telegram HTML). «Главное» выбирается
  правилом (важная задача с дедлайном сегодня/завтра → важная на сегодня →
  ближайшая встреча), а не AI. AI-«комментарий дня» — FUTURE/PRO, только по данным.
- **Отправлять ли**: правило SEVER v118 — пустой день не порождает сообщения;
  вечерний итог — только если в дне были записи.
- Идемпотентность: unique(`account_id`, `kind`, `local_date`).
- Масштаб: 100k пользователей × 2 digest = ~200k сообщений/день, пики на 08:30
  локального времени. Исходящий лимит Telegram для ботов ограничен (порядка
  десятков сообщений в секунду, **конкретные значения проверить** в PHASE 10) →
  очередь `notification_outbox` с глобальным rate limiter и разнесением по
  минутам (джиттер ±10 мин, настраиваемый).
- Mini App показывает расширенную версию того же JSON.

---

## Q. Personal Memory foundation

Память — это не «магия модели», а четыре слоя реальных данных:

1. **Записи + `activity_log`** (MVP): «когда я последний раз был у стоматолога?»
   = последний выполненный task/event с совпадением по FTS + дата из журнала.
   «Что я обещал и не сделал?» = открытые задачи старше N дней, `reschedule_count`,
   просроченные `due_date`.
2. **Полнотекстовый поиск** (MVP) + синонимы/нормализация (V1).
3. **Subjects** (V2): люди, места, вещи, темы (`subjects` + `subject_aliases` +
   `subject_links`). «Замена масла» → subject «машина/масло»; «Андрей» → person.
   Извлекаются при capture как *предложение*, подтверждаются пользователем.
4. **Явные факты** (V1, из SEVER `ai_memories`): «запомни, что у меня аллергия на…» —
   видимые, редактируемые, удаляемые; используются только как контекст.
5. **Семантический поиск** (V2, PRO, opt-in): pgvector-эмбеддинги заголовков/текстов;
   удаляются вместе с записью.

Правило ответа: сервер выполняет запрос → строки с ID и датами → ответ строится
по ним (шаблон или AI со ссылками на ID). Нет строк — «записей нет».

Что нужно заложить **уже в PHASE 2**, чтобы память была возможна:
`activity_log` с before/after и локальным временем события; `completed_at` +
`completed_local_date/hour`; история переносов; `source`/`capture_id` у каждой
записи; FTS-индексы; стабильные ID; никакой перезаписи без журнала.

---

## R. Trends foundation

- **Сырьё**: `activity_log` (создано/выполнено/перенесено/удалено, локальные
  дата-время, часовой пояс на момент события), задачи с `plan_*`, `due_*`,
  `importance`, `duration_min`, логи привычек с запланированным временем.
- **Агрегаты**: `daily_stats` (account, local_date): запланировано, выполнено,
  перенесено, просрочено, без даты, распределение выполнений по часам,
  перегрузка (сумма duration vs фактически выполнено), привычки. Пересчёт
  ночным cron для «вчера» + инкрементально.
- **Insight engine** — детерминированные правила с порогами значимости и
  минимальным объёмом выборки, например:
  - «X% задач без даты не закрыты > 7 дней» (n ≥ 20);
  - «по понедельникам запланировано в 1.5× больше, чем выполняется» (≥ 4 недели);
  - «английский выполняется чаще, когда стоит на 18:00» (сравнение долей по слотам);
  - тренд доли выполненных за 4 недели.
- Каждый инсайт хранит `evidence` (числа, период, n) → показывается пользователю.
  AI (опционально) только переформулирует готовый инсайт.
- Weekly review = digest `weekly` + 1–3 инсайта.

---

## S. Telegram bot architecture

```
Telegram ─HTTPS─> izi-telegram-webhook (Edge Function)
                   1. verify secret header (constant-time)
                   2. size limit, JSON parse, update_id
                   3. INSERT inbound_updates (unique update_id) ON CONFLICT DO NOTHING
                   4. 200 OK  (быстро, без AI)
                   5. запуск обработки (фоновая задача функции / pg_net-триггер worker)
izi-worker ─ claim inbound_updates (SKIP LOCKED, порядок per chat)
           ─ route: command | callback | message(text/voice/photo) | payment | my_chat_member
           ─ status: received → processing → done | failed(retry, attempts, next_attempt_at)
           ─ исходящие через TelegramSender (rate limit, 429/403)
pg_cron: reminders, digests, retry stuck updates, housekeeping (очистка окон rate limit, истёкших pending_actions)
```

- Механизм фонового запуска в Edge Runtime (background task / очереди Supabase
  / pgmq) и лимиты времени выполнения функций **проверить** в PHASE 3; архитектура
  не зависит от выбора, т.к. состояние в `inbound_updates`.
- Порядок: сообщения одного чата обрабатываются последовательно (advisory lock
  per chat_id в claim).
- Команды: `/start` (+ deep-link payload), `/today`, `/tomorrow`, `/week`,
  `/inbox`, `/undo`, `/settings`, `/app`, `/help`, `/export`, `/delete_account`.
- `callback_data`: `pa:<short_token>:<op>` или `rec:<short_id>:<op>`; всё
  разрешается сервером через account-scoped lookup.
- Редактирование сообщений вместо новых, где возможно (как в TAVRO).
- `edited_message`: V1 — игнорировать, если нет активного pending_action по
  этому сообщению; иначе — пересобрать предпросмотр.
- `my_chat_member` (kicked) → `telegram_chats.blocked_at`.
- Групповые чаты: MVP — только личные чаты; группы игнорируются.

---

## T. Mini App role

- Назначение: обзор и управление большим объёмом (Digest, Tasks, Notes/Inbox,
  Calendar, Habits, Progress/Trends, Settings; позже Money, Food).
- Не содержит собственной бизнес-логики: всё через `izi-api` (те же сервисы и
  RPC, что у бота). Никаких прямых запросов к Supabase.
- Аутентификация: initData → `POST /session` → короткий токен (1 ч) →
  `Authorization: Bearer`. initData с `auth_date` старше порога отклоняется.
- Мутации из Mini App-форм с явными значениями — без AI и без preview (кнопка
  «Сохранить» и есть подтверждение); AI-ввод в Mini App идёт тем же capture-путём.
- Online-first: локальный кэш только для отображения; никакой офлайн-синхронизации.
- Дизайн, навигация, визуальный язык — **не на этом этапе**.

---

## U. Notification architecture

```
источники: reminders | digests | ответы worker | системные (оплата, экспорт)
      └──> notification_outbox (account, channel, kind, payload, dedupe_key,
                                status, attempts, next_attempt_at, send_after)
                └──> sender (per channel adapter):
                       telegram  — MVP
                       web push  — FUTURE (паттерны SEVER push)
                       email     — FUTURE (экспорт, безопасность)
```

- Политики до записи в outbox: тихие часы, «один голос за раз», отключённые
  типы, заблокированный чат.
- Доставка at-least-once с `dedupe_key`; повтор отправки после таймаута
  возможен → текст идемпотентен по смыслу, кнопки ссылаются на стабильные ID.
- Метрики: очередь, задержка от `send_after`, доля 429/403 — без содержимого.

---

## V. Security architecture

| Область | Мера |
|---|---|
| Trust boundary | Только Edge Functions держат service-role; клиенты — никогда |
| Webhook | Секрет `X-Telegram-Bot-Api-Secret-Token`, constant-time; лимит размера |
| Mini App | initData HMAC (проверить на реальных данных), свежесть, короткая сессия |
| Quick capture | Scoped токен, SHA-256 в БД, отзыв, лимит, только `capture` |
| Client user_id | Никогда; запрещённые поля отвергаются |
| Ownership | Репозиторий + RPC по account + составные FK + RLS deny-all + тесты |
| Idempotency | `inbound_updates.update_id`, `captures` external_id, `pending_actions` статус-машина, платежи по charge_id |
| Replay | Срок initData/сессий/pending_actions; одноразовость confirm |
| Rate limits | Per-account и per-chat окна; глобальный лимит AI-бюджета в день (circuit breaker) |
| Prompt injection | Текст как данные; строгая схема; модель не выбирает ID; evidence-проверка; eval-кейсы с инъекциями |
| Secrets | Edge Function secrets + Vault для cron; secret scan в CI; ничего в git и в клиенте |
| Safe logging | Коды ошибок и метрики, без текста пользователя/транскриптов/имён; `ai_runs` без содержимого |
| Retention | Сырой текст `captures` хранится ограниченно (напр. 30 дней, затем редактируется) — решение владельца; аудио не хранится; фото — только file_id Telegram |
| Export | `/export` → JSON (все сущности, журнал) файлом в чат; формат версионирован |
| Delete | Удаление аккаунта: каскад + очистка `ai_runs`, outbox, identity; предупреждение, что история чата в Telegram у нас не удаляется |
| AI-провайдер | Минимизация данных в запросе; условия хранения данных у провайдера **проверить** и отразить в Privacy Policy |
| Backups | Возможности PITR/бэкапов зависят от тарифа Supabase — **проверить**; дополнительно — регулярный логический дамп критичных таблиц |
| Environments | Отдельные staging и production; тестовый бот для staging |

---

## W. Migration strategy from donor code

### W.1 Размещение (D1 — RESOLVED)

**Решение владельца:** код IZI живёт в этом репозитории в отдельном корне `izi/`,
**база — отдельный Supabase-проект IZI** (сначала staging, затем production).
Staging-проект создаётся отдельным согласованным действием (не в PHASE 2).

Фактическая структура после PHASE 2 (Edge Functions и Mini App появятся в своих фазах):

```
izi/
  package.json, package-lock.json, tsconfig.json, README.md
  src/
    core/        errors, validation, evidence, context, db,
                 datetime/ (calendar, semantics, lexicon), identity/,
                 actions/ (operations), repo/ (единственный доступ к БД)
    modules/     tasks/ events/ notes/ inbox/ + registry
    locales/ru/  temporal (лексикон D5), messages (тексты ошибок)
  supabase/migrations/  001_core.sql, 002_records.sql, 003_actions.sql
  tests/         core/ db/ security/ fakes/
```

Почему так:
- чистая история миграций с 001, никакого взаимодействия с триггерами/данными
  SEVER в production; SEVER-пользователи не рискуют ничем;
- SEVER остаётся как есть до архивации; TAVRO-миграции 018/019 **не
  применяются** (D2 — RESOLVED: владелец проверил подключённый Supabase SEVER,
  таблиц `tavro_*` нет, 018/019 не применены, очистка не нужна);
- перенос в отдельный репозиторий позже = перемещение папки;
- импорт из SEVER через `sever-backup v2` или одноразовый серверный экспорт
  для пользователей, привязавших аккаунт.

**Альтернатива** (если важно использовать один проект Supabase): та же схема
в отдельной Postgres-схеме `izi` в текущем проекте SEVER. Дизайн документа
переносим без изменений; минусы — общий прод-риск, общие лимиты, смешанная
история миграций. Использовать *существующие таблицы SEVER как ядро* **не
рекомендуется** (см. C.3: sync-протокол откатывает незнакомые колонки).

### W.2 Порядок переноса кода

| Шаг | Что | Как |
|---|---|---|
| 1 | `_shared/validation.ts`, `_shared/datetime.ts` | Копия в `izi/.../_core` с сохранением тестов TAVRO, затем изменения (точность дат, дедлайн, part_of_day) — каждое с тестом |
| 2 | `telegram.ts` | Копия + 429/403 + sender; контрактный тест на реальном образце initData (PHASE 3) |
| 3 | `ai/schema.ts`, `ai/prompt.ts` | Переписать на модульную схему + evidence, сохранив негативные тесты TAVRO |
| 4 | `ai/provider.ts`, `ai/speech.ts` | Интерфейсы + fake; OpenAI-адаптер — PHASE 6 |
| 5 | `capture.ts`, `search.ts` | Логика переносится в worker/сервисы; хранение — новые RPC |
| 6 | `reminders.ts` | Переработка под outbox |
| 7 | `quick.ts`, `billing.ts`, `payments.ts` | В соответствующих фазах |
| 8 | `tests/tavro-fakes.mjs`, PGlite-харнес из `sever-ai-sql.test.mjs` | В PHASE 2 |

Правило: «копируем → запускаем старые тесты → меняем» — чтобы видеть, что
именно сломали. Ветка TAVRO не удаляется и не мержится.

---

## X. Test strategy

| Уровень | Что | Инструмент | Где запускается |
|---|---|---|---|
| Unit (чистые функции) | date resolver, DST, evidence-проверка, парсер схемы, preview-рендер, правила digest/insights | `node --test` по `.ts` (как TAVRO) | CI |
| DB | Миграции, RLS deny-all, grants, составные FK, apply-RPC транзакционность, идемпотентность, SKIP LOCKED claims | PGlite (харнес SEVER) + по возможности настоящий Postgres в CI | CI |
| Сервисные сценарии | Бот/worker end-to-end с FakeDb/FakeTelegram/FakeProvider | fakes TAVRO | CI |
| Security | Запрещённые поля, чужие ID/токены, prompt injection, нет секретов/`console` с данными, доступ к данным только через репозиторий | статические + сценарные | CI |
| Контрактные | Реальные образцы initData/update/ответов провайдера (обезличенные) | фикстуры | CI |
| AI eval | ≥150 фраз, метрики точности полей, доля «выдуманных» дат = 0 | реальный OpenAI | вручную/по расписанию, отчёт в repo |
| Staging E2E | Реальный тестовый бот, реальная staging-БД | чек-лист + скрипт | перед релизом |
| Нагрузка | Диспетчер reminders/digest на 100k синтетических аккаунтов | скрипт + staging | перед публичным запуском |
| Mini App | Playwright 320/360/390/desktop (инфраструктура SEVER) | Playwright | CI (PHASE 11) |

Внешние тесты без секретов — **SKIP, а не PASS** (конвенция SEVER).

---

## Y. MVP / V1 / V2 / Future

| Этап | Состав |
|---|---|
| **MVP** (закрытая бета в Telegram) | Аккаунт по Telegram, TZ-онбординг; Tasks, Events, Notes, Inbox; capture текстом и **голосом** с preview/confirm; `/today` `/tomorrow` `/week` `/inbox`; кнопки ✓/→завтра; Undo; напоминания по точному времени; утренний и вечерний digest; Ask: agenda/overdue/search; экспорт и удаление; квоты AI без оплаты |
| **V1** | Mutation engine (массовые переносы/закрытия); Habits/Rituals; Diary/Ideas; повторяющиеся задачи/встречи; weekly review; явные факты памяти; Mini App functional shell; быстрый ввод (Shortcuts/Action Button/Back Tap через quick-токен и deep links); подписка PRO через Stars; импорт SEVER |
| **V2** | Money (операции, категории, бюджеты, регулярные платежи); Food/Water; Goals; Trends с инсайтами; Subjects (люди/места/вещи); семантический поиск; фото-capture |
| **Future** | Health context, Documents, Projects, Locations, Files; web-клиент; web push; «сейф» с клиентским шифрованием; совместные списки; интеграции календарей |

---

## Z. Exact implementation phases

Порядок утверждён владельцем после PHASE 1: **голос сразу после реального
OpenAI** (голос — ключевой вход Telegram-first продукта), затем Ask IZI и
Mutation Engine; **Reminders + Digest + Quick Capture раньше Mini App**.

| Фаза | Содержание | Статус |
|---|---|---|
| 2 | Foundation | IMPLEMENTED + TESTED LOCALLY |
| 3 | Telegram identity + bot shell | — |
| 4 | Core records without AI | — |
| 5 | Capture Engine + Fake AI | — |
| 6 | Real OpenAI integration | — |
| 7 | Voice Capture | — |
| 8 | Ask IZI / Query Engine | — |
| 9 | Mutation Engine | — |
| 10 | Reminders + Digest + Quick Capture | — |
| 11 | Mini App functional shell | — |
| 12 | Habits / Rituals / Diary / recurring | — |
| 13 | Subscriptions | — |
| 14+ | Money / Food / Trends / Memory / SEVER import | — |

Для каждой фазы: *проверка* = минимальный уровень статуса, без которого фаза не закрыта.

### PHASE 2 — Foundation — IMPLEMENTED + TESTED LOCALLY
- **Цель**: скелет `izi/`, ядро схемы, общие модули, тестовый контур. Без деплоя.
- **Файлы**: `izi/src/core/*`, `izi/src/modules/*`, `izi/src/locales/ru/*`,
  `izi/supabase/migrations/001_core.sql` (accounts, identities, account_settings,
  telegram_chats, captures, inbound_updates, rate_limits, ai_runs),
  `002_records.sql` (tasks, events, notes, inbox_items + FTS),
  `003_actions.sql` (pending_actions, activity_log, apply/undo/discard, housekeeping).
- **API**: нет (только repository layer).
- **Тесты**: 139 (core 52, db 66, security 21) — `cd izi && npm ci && npm test`.
- **Acceptance**: `npm test` зелёный (typecheck + все тесты); миграции идемпотентны;
  файлы SEVER/TAVRO не изменены; корневой набор SEVER без изменений.
- **Риски**: PGlite (PostgreSQL 17.5, один connection) ≠ Supabase: конкурентность
  проверена только последовательно; SQL не выполнялся на реальном Supabase.
- **Проверка**: TESTED LOCALLY. Детали — «PHASE 2 — фактические решения» ниже.

### PHASE 3 — Telegram identity + bot shell
- **Цель**: webhook → inbound_updates → worker; `/start`, онбординг TZ, `/help`,
  `/settings`; создание аккаунта; sender с 429/403.
- **Файлы**: `izi-telegram-webhook/`, `izi-worker/`, `_core/telegram/*`.
- **Таблицы**: используются из PHASE 2.
- **API**: webhook endpoint.
- **Тесты**: повтор update_id; сбой после приёма → повтор, а не потеря (T1);
  заблокированный бот; конкурентные update одного чата; initData контракт.
- **Acceptance**: в staging-боте `/start` создаёт ровно один аккаунт; повторная
  доставка не дублирует; выключение БД на время → сообщение обработано после восстановления.
- **Риски**: лимиты Edge Runtime и механизм фоновой обработки (проверить);
  способ подключения сервера к БД (прямое Postgres-соединение через pooler
  рекомендовано, т.к. repository layer — параметризованный SQL; проверить
  поведение пулера и prepared statements); роль подключения должна быть
  владельцем таблиц или `service_role` (BYPASSRLS), иначе RLS вернёт пустые выборки.
- **Проверка**: DEPLOYED (staging) + VERIFIED IN TELEGRAM.

### PHASE 4 — Core records без AI
- **Цель**: сервисы Tasks/Events/Notes/Inbox, apply-RPC, activity_log, Undo;
  детерминированные `/today`, `/tomorrow`, `/week`, `/inbox`, кнопки ✓/→завтра/вернуть;
  `/inbox <текст>`; экспорт и удаление аккаунта.
- **Таблицы**: используются из PHASE 2; кнопки = propose + confirm одним вызовом
  (тот же `izi.apply_pending_action`, чтобы каждое изменение попадало в журнал).
- **Тесты**: транзакционность apply, версия/конфликт, Undo, ownership чужих
  callback, экспорт полный, удаление каскадом.
- **Acceptance**: всё работает в staging-боте без AI-ключа.
- **Проверка**: VERIFIED IN TELEGRAM (staging).

### PHASE 5 — Capture Engine (fake AI)
- **Цель**: полный конвейер capture → preview → confirm/partial/discard →
  apply; уточнения через `chat_sessions`; Inbox-фолбэк при недоступном AI.
- **Файлы**: `_core/ai/schema/*` (модульная схема + evidence), `_core/capture/*`, `modules/*`.
- **Тесты**: эталонная фраза из ТЗ (стоматолог/паста/английский/интернет) с
  fake-ответом; evidence отвергает выдуманное время; дедлайн «до пятницы»;
  двойное нажатие; частичный сбой apply откатывает всё.
- **Acceptance**: 0 выдуманных дат во всех негативных тестах.
- **Проверка**: TESTED WITH MOCKS + VERIFIED IN TELEGRAM (с fake-провайдером на staging).

### PHASE 6 — OpenAI integration
- **Цель**: `OpenAIProvider` со строгой схемой, конфиг моделей, `ai_runs`,
  квоты (per-account lock), глобальный бюджет-предохранитель, eval-набор.
- **Тесты**: адаптер на записанных ответах; eval ≥150 фраз на реальном API.
- **Acceptance**: точность полей и доля выдуманных дат/времени зафиксированы
  в отчёте; целевая доля выдуманных = 0 после evidence-фильтра; стоимость
  фразы измерена.
- **Риски**: подмножество JSON Schema у провайдера; латентность; стоимость.
- **Проверка**: TESTED AGAINST REAL SERVICE.

### PHASE 7 — Voice Capture
- **Цель**: голосовые Telegram → SpeechProvider (OpenAI) → тот же capture-конвейер;
  транскрипт в `captures.raw_text` (`raw_text_kind = transcript`, те же 30 дней);
  аудио не хранится.
- **Тесты**: fake STT + записанные ответы реального провайдера; ограничения длины/размера;
  ошибка STT не теряет сообщение (очередь inbound_updates).
- **Риски**: формат OGG/Opus у выбранного STT (проверить), длина аудио, стоимость.
- **Проверка**: TESTED AGAINST REAL SERVICE + VERIFIED IN TELEGRAM на iPhone и Android.

### PHASE 8 — Ask IZI (Query Engine)
- **Цель**: AI-роутер различает capture/query; интенты agenda/upcoming/overdue/
  search/last_occurrence/count/progress; детерминированные ответы.
- **Тесты**: «Как-нибудь позвонить бабушке» → capture (T8); ответы только из строк;
  чужие данные недоступны.
- **Проверка**: TESTED AGAINST REAL SERVICE + VERIFIED IN TELEGRAM.

### PHASE 9 — Mutation Engine
- **Цель**: MutationPlan, серверный выбор кандидатов, preview со списком,
  «Изменить выбор», apply с проверкой версий, Undo.
- **Тесты**: сценарий «перенеси всё неважное с завтра на субботу»; конкурирующее
  изменение между preview и confirm; пустой селектор; лимит кандидатов.
- **Проверка**: VERIFIED IN TELEGRAM.

### PHASE 10 — Reminders + Digest + Quick Capture
- **Цель**: reminders, notification_outbox, sender с rate limit, pg_cron (включая
  housekeeping-функции PHASE 2: purge raw text, expire actions, redact activity,
  reap stale), morning/evening digest, тихие часы, «один голос за раз»;
  quick-токены, инструкции для iOS Shortcuts / Action Button / Back Tap,
  Android-ярлыки, deep links `t.me/<bot>?start=…`.
- **Тесты**: DST-переходы; смена TZ пересчитывает; 429/403; дедупликация digest;
  синтетическая нагрузка 100k аккаунтов на staging.
- **Риски**: реальные лимиты рассылки Telegram (проверить), пики 08:30.
- **Проверка**: DEPLOYED + VERIFIED IN TELEGRAM + нагрузочный отчёт.

### PHASE 11 — Mini App functional shell
- **Цель**: `izi-api` + сессии; функциональные экраны без финального дизайна.
- **Тесты**: Playwright (инфраструктура SEVER), ownership API.
- **Проверка**: VERIFIED IN TELEGRAM (iOS/Android/Desktop клиенты).

### PHASE 12 — Habits/Rituals, Diary, повторы, weekly review
- **Проверка**: VERIFIED IN TELEGRAM.

### PHASE 13 — Subscriptions (Telegram Stars)
- **Цель**: `plan_catalog`/`entitlements` из конфигурации, invoice, pre-checkout,
  successful_payment, refund, expire (механизмы TAVRO).
- **Риски**: правила Telegram для цифровых товаров и курс Stars (проверить).
- **Проверка**: TESTED AGAINST REAL SERVICE (тестовые платежи) → решение владельца о запуске.

### PHASE 14+ — Money / Food / Trends / Memory / SEVER import

Каждая из фаз 14+ получит такое же детальное описание перед стартом; ядро
к этому моменту не меняется — добавляются модули.

---

## PHASE 2 — фактические решения

Статус: **IMPLEMENTED + TESTED LOCALLY**. Не TESTED AGAINST REAL SERVICE, не
DEPLOYED, не VERIFIED IN TELEGRAM, не PRODUCTION READY.

| Решение | Почему |
|---|---|
| Отдельная схема `izi`, ничего в `public` | На Supabase у `public` есть default privileges для `anon`/`authenticated`; в `izi` клиентские роли не получают ничего. Схема не должна быть открыта через Data API |
| RLS включён на всех 14 таблицах, политик нет, **не FORCE** | Deny-all для клиентских ролей. FORCE влияет только на владельца таблиц, которым будет сам сервер (или `service_role` с BYPASSRLS) — пользы нет, риск пустых выборок есть |
| Identity: `accounts` + `identities(provider, subject)` unique + одна Telegram-identity на аккаунт | Один человек = один аккаунт; один Telegram ID нельзя привязать ко второму аккаунту (constraint + `IDENTITY_TAKEN`). Приватный `telegram_chats.chat_id` обязан совпадать с Telegram-identity аккаунта |
| `AccountContext` выдаётся только `AccountRepo` и проверяется по WeakSet | Контекст нельзя собрать из клиентского `{accountId}`; статические тесты запрещают выдачу контекста и `VerifiedIdentity` вне своих модулей |
| Все записи пишутся только через `pending_actions` → `izi.apply_pending_action` (plpgsql) | Одна транзакция на confirm, независимо от драйвера; повторный confirm возвращает прежний результат; операции неизменяемы после предпросмотра; выбранные индексы применяются, остальные — нет |
| Составные FK `(account_id, …)` для всех связей между записями | Межаккаунтная ссылка невозможна на уровне схемы, даже для `service_role` |
| `version` повышается триггером при любом UPDATE | Оптимистичная конкуренция не обходится ни одним путём записи |
| `activity_log`: только изменённые поля + version, append-only (у сервера нет UPDATE/DELETE), payload с текстом редактируется через 30 дней | Основа Undo/аудита/Trends/Memory без склада личного текста; сырой текст захвата туда не попадает |
| Undo: минимум 10 минут; при изменении любой затронутой записи после действия — `UNDO_CONFLICT`, ничего не откатывается | Новые изменения пользователя не уничтожаются; откат восстанавливает и производные поля (reschedule_count, completed_at) |
| `captures.raw_text` ≤ 30 дней — CHECK-ограничение + `izi.purge_expired_raw_text()` | D4 закреплено в схеме; после очистки захват, метаданные (`raw_text_length`) и созданные записи остаются |
| State machine захвата в триггере; у каждого нетерминального состояния есть выход вперёд и закрытие; зависший `processing` → `failed` → повтор | Нет состояния, из которого нельзя восстановиться |
| `inbound_updates`: unique (provider, update_id), claim с `SKIP LOCKED`, порядок внутри чата, retry → dead, payload удаляется при done и не живёт > 30 дней, коды ошибок только `^[A-Z0-9_]+$` | Исправляет T1/T2; текст сообщения не попадает в поле ошибки. Worker не реализован |
| Rate limit: PK (account_id, bucket, window), без advisory lock, очистка отдельной функцией | Исправляет глобальный lock SEVER и T10 |
| Task: `plan_date` + `plan_precision` (day/week/month) ≠ `due_date`/`due_time`; `part_of_day` взаимоисключается с `plan_time`; точное время требует известного часового пояса | «На следующей неделе» хранится как неделя; «до пятницы» — срок; «вечером» — не время; часовой пояс не угадывается (`TIMEZONE_REQUIRED`), поэтому у `account_settings.timezone` нет значения по умолчанию |
| Event: дата, время, длительность — `null`, пока не названы; нет автопревращения в задачу | Исправляет T4 |
| Лексикон D5 в `src/locales/ru/temporal.ts`; core без кириллицы (статический тест) | D6: русский MVP, локализация добавляется новым каталогом |
| Правила времени: «в 4» → ambiguous (04:00/16:00); «в 4 утра/дня/вечера» → 04:00/16:00/16:00; час 13–23 или «0X» → точно; «9:30» (одна цифра часа) → ambiguous, «09:30»/«10:30» → точно; противоречия («в 16 утра») → ambiguous | Ничего не выбирается за пользователя |
| Правила дат: «в пятницу», сказанное в пятницу → ambiguous; «в следующую пятницу» → пятница следующей ISO-недели; дата без года → ближайшая не прошедшая; «до конца недели» → срок = воскресенье | Продуктовые правила, закреплены тестами; пересматриваются по eval в PHASE 5/6 |
| Evidence: `Extracted<T> = {value, evidence{text,start,end}}`; сервер проверяет подстроку и перечитывает значение лексиконом | Основа исправления T7; confidence не вводился (нет смысла без калибровки) |
| Тестовая БД: PGlite 0.3.14 = PostgreSQL 17.5 (как Supabase); TypeScript 7.0.2 только для typecheck; Node ≥ 22.18; runtime-зависимостей нет | `npm ci && npm test` воспроизводимо внутри `izi/`, не трогая окружение SEVER |

Отклонения от плана PHASE 1: заметки пока без `kind` (idea/diary добавятся в
PHASE 12 миграцией); `003_actions.sql` выделен отдельно от `001`/`002`;
`chat_sessions`, `notification_outbox`, `entitlements` не созданы (их фазы).

Известные ограничения PHASE 2:
- PGlite — одно соединение: «параллельные» тесты фактически последовательны;
  конкурентное поведение держится на `FOR UPDATE`/`SKIP LOCKED` и unique-индексах
  и должно быть перепроверено на настоящем Postgres (PHASE 3).
- Миграции не выполнялись на Supabase; pg_cron-расписания не созданы.
- FTS использует конфигурацию `russian`; для других языков потребуется
  отдельная конфигурация/колонка.
- Лексикон D5 покрывает типовые формы (цифры, числительные 1–12, «утра/дня/
  вечера/ночи», дни недели, месяцы, «через N дней», неделя/месяц); редкие
  формы («в пол пятого», «через неделю») не распознаются и станут уточнением.

---

## Donor Map

| Capability | Current source | SEVER implementation | TAVRO implementation | Use in IZI? | Decision | Reason | Risk | Required changes |
|---|---|---|---|---|---|---|---|---|
| Telegram webhook secret | TAVRO | — | `verifyWebhookSecret`, constant-time | Да | REUSE | Корректно и просто | Низкий | Нет |
| Telegram initData verification | TAVRO | — | `verifyInitData` HMAC WebAppData, свежесть | Да | ADAPT | Механизм верный | Обработка `signature` не проверена на реальных данных (T13) | Контрактный тест на реальном initData; maxAge ↓; обмен на сессию |
| Constant-time compare | TAVRO | — | `safeEqual` | Да | REUSE | | Низкий | Нет |
| update_id idempotency | TAVRO | — | claim до обработки | Да | REWRITE | Потеря сообщений (T1) | Высокий в текущем виде | Очередь `inbound_updates` со статусами |
| Async processing | — | — | нет (синхронно) | Да | REWRITE | T2 | Таймауты | Worker |
| Telegram API client | TAVRO | — | `TelegramApi` | Да | ADAPT | | 429/403 не обработаны | Sender + rate limit |
| Rate limiting | TAVRO/SEVER | per-user count в `sever_claim_ai_quota` + глобальный lock | `tavro_rate_check` fixed window | Да | ADAPT | Идея верная | Очистка в горячем пути (T10); глобальный lock SEVER | Per-account, фоновая очистка |
| AI quota | SEVER/TAVRO | `sever_claim_ai_quota` (глобальный lock) | `tavro_claim_ai_action` (per-account lock, release при сбое) | Да | ADAPT (TAVRO) | | Лимиты зашиты в код | Лимиты из entitlements |
| Validation primitives | TAVRO | `sever-ai/validation.ts` | `_shared/validation.ts` | Да | REUSE | Запрет identity-полей | Низкий | Переименование сообщений |
| Date resolver / TZ / DST | TAVRO | нет (даты строками) | `_shared/datetime.ts` | Да | ADAPT | Сильная основа | `next_week` как точный день (T5) | Точность, дедлайн, part_of_day |
| «AI не придумывает дату» | TAVRO | промпт | промпт + закрытый словарь | Да | ADAPT | Правило ядра | Держится на промпте (T7) | Evidence-спаны + лексикон |
| Strict AI schema | TAVRO | JSON object + ручная проверка | `ai/schema.ts` | Да | ADAPT | Неизвестные ключи = ошибка | Схема не модульная | Модульная union-схема + strict outputs |
| Multi-item extraction | TAVRO | нет (1 команда) | до 12 items + dedupe | Да | ADAPT | Ключевая функция | | Новые типы: inbox, deadline |
| Preview before save | TAVRO | preview для delete/plan | HTML + JSON preview | Да | ADAPT | | | Частичный выбор, Mini App |
| Confirmation | SEVER/TAVRO | HMAC-токен действия | статус capture | Да | REWRITE | Нужна транзакция и массовые операции | T3 | `pending_actions` + apply-RPC |
| Undo / discard | TAVRO/SEVER | Undo на клиенте | discard + restore task | Да | REWRITE | Нужен общий механизм | | `activity_log` before/after |
| Voice pipeline | TAVRO | — | SpeechKit/Whisper, лимиты, аудио не хранится | Да (V1) | ADAPT | | Формат OGG для OpenAI не проверен | OpenAI STT адаптер |
| Typed search | TAVRO | `calendar.get` | query plan → детерминированный ответ | Да | ADAPT | Нет галлюцинаций | Строковые `.or()` фильтры (T15) | Реестр интентов, RPC |
| Reminder scheduling | SEVER/TAVRO | pg_cron + delivery ledger, day_before/15 min | `tavro_reminders` + SKIP LOCKED + проверка цели | Да | ADAPT | Обе части ценны | T9, нет пересчёта при смене TZ | Outbox, ретраи, 403 |
| Day rhythm / digest | SEVER | v115/v118 утро/день/вечер, «один голос» | — | Да | ADAPT | Готовые продуктовые правила | Web Push-специфика | Telegram-канал, настраиваемое время |
| Prompt-injection protection | TAVRO/SEVER | «данные, не инструкции» | фраза как JSON, строгий парсер, тесты | Да | ADAPT | | | + eval-кейсы |
| Server ownership checks | SEVER/TAVRO | RLS `auth.uid()` + `owned()` | фильтр `account_id` в store | Да | ADAPT | | service_role обходит RLS | Repo-слой + составные FK + статический тест |
| RLS / grants | SEVER | 006, 009, deny-политики | force RLS, service-only | Да | REUSE (конвенции) | | | Чек-лист миграций |
| Identity model | SEVER/TAVRO | auth.users + profiles | tavro_accounts по telegram_id | Да | REWRITE | Две идентичности — ошибка | | accounts + identities |
| Tasks model | SEVER/TAVRO | `tasks` (дата+время, без tz/дедлайна) | `tavro_tasks` | Да | REWRITE | Нужны дедлайн, точность, история | | Новая схема, импорт SEVER |
| Events model | TAVRO | нет | `tavro_events` wall clock + instant | Да | ADAPT | Хорошая идея хранения | Дефолт 60 мин (T4) | Без дефолтов, recurrence |
| Notes | SEVER/TAVRO | notes + folders + protected | notes kind note/diary/meal | Да | ADAPT | | | kind note/idea/diary, FTS |
| Protected notes | SEVER | AES-GCM клиентский | — | Нет (V1) | DROP | Несовместимо с серверным AI | | FUTURE «сейф» |
| Habits | SEVER/TAVRO | title + entries | + target_per_week | Да | ADAPT | Слишком бедно | | schedule, target/unit, preferred_time |
| Progress | SEVER | вычисляется из записей | `progress()` | Да | ADAPT | | | daily_stats |
| Inbox | TAVRO | нет | «inbox» = задачи без даты | Да | REWRITE | Нужна отдельная сущность | | `inbox_items` + конвертация |
| Field-version sync | SEVER | 005 + sync-core | — | Нет | DROP | Server-authoritative | Откат незнакомых колонок | — |
| Realtime full pull | SEVER | cloud-runtime | — | Нет | DROP | O(N) | | — |
| AI provider abstraction | SEVER/TAVRO | OpenAI-compatible stream | AIProvider + Yandex + OpenAI-compatible | Да | ADAPT | | | OpenAI strict adapter, модели из конфига |
| AI memory | SEVER | `ai_memories` | — | Да (V1) | ADAPT | Прозрачная явная память | | Слой фактов Memory |
| AI plans (финансы/обучение) | SEVER | `plans.ts` детерминированный расчёт | — | Да (V2) | ADAPT | AI извлекает, код считает | | В модуль Money/Goals |
| Finance domain | SEVER | v111 в `user_settings` JSON | — | Да (V2) | ADAPT правила / DROP хранение | | | Таблицы Money |
| Web Push | SEVER | VAPID, iOS-диагностика | — | Позже | ADAPT (FUTURE) | Не основной канал | | Канал в outbox |
| iPhone diagnostics v120–v126 | SEVER | 4 таблицы + 4 функции | — | Нет | DROP | Одноразовая диагностика | | — |
| Payments Stars | TAVRO | — | invoice, pre-checkout, refund, идемпотентность | Да (PHASE 13) | ADAPT | | Правила платформы не проверены | Каталог в БД |
| Entitlements | TAVRO | role owner/user | `entitlementOf`, terms_version | Да | ADAPT | | Тарифы в коде | `plan_catalog` |
| Quick capture tokens | TAVRO | — | `quick.ts` | Да (V1) | ADAPT | | T14 | Исправить учёт |
| Fake providers | TAVRO | — | `tavro-fakes.mjs` | Да | ADAPT | | | Под новый repo-слой |
| DB tests | SEVER | PGlite + роли + jwt claims | — | Да | REUSE | | PGlite ≠ Supabase | + настоящий Postgres в CI |
| Browser tests | SEVER/TAVRO | Playwright 320/360/390/desktop | tavro-miniapp.spec | Да (PHASE 11) | REUSE (инфра) | | | Новые спеки |
| Secret scan / CI | SEVER | `security.yml` | — | Да | REUSE | | | Отдельный job для `izi/` |
| FastAPI backend | SEVER | dev-only identity header | — | Нет | DROP | | | — |
| UI / темы / Mini App IMPULSE | SEVER/TAVRO | PWA | IMPULSE | Нет | DROP | Дизайн позже | | — |

---

## Самопроверка

**«Если IZI через год получит 100 000 пользователей, останется ли архитектура логичной?»**
Да, при соблюдении следующих условий, заложенных в дизайн:
- приём webhook O(1) и не зависит от AI; обработка горизонтально через SKIP LOCKED;
- все горячие запросы индексированы по `(account_id, …)`; нет глобальных блокировок;
- рассылки идут через outbox с rate limiter — узкое место не БД, а лимиты
  Telegram, которые учитываются разнесением digest;
- AI-стоимость ограничена квотами и глобальным предохранителем;
- очистка служебных таблиц — фоновыми задачами; `activity_log` и `ai_runs`
  при росте партиционируются по месяцу (решение отложено до реальных объёмов).
Пределы, которые придётся пересмотреть: лимиты Edge Functions на длительность
(голос, большой экспорт) и, возможно, вынос worker на отдельный сервис; это
изменение хостинга worker, а не модели данных.

**«Если Money, Food и Memory появятся через полгода, не придётся ли ломать ядро?»**
Нет: capture/query/mutation/confirmation/undo/journal/reminders/digest/export
работают через контракт модуля. Money = новые таблицы + itemSchema + интенты +
digest-блок. Memory опирается на `activity_log`, FTS и `source/capture_id`,
которые закладываются в PHASE 2. Единственное, что нельзя «добавить потом»
без боли, — журнал событий и локальное время событий; поэтому они в ядре с первого дня.

---

## Решения владельца и оставшиеся неопределённости

1. **D1 — RESOLVED.** Отдельный Supabase-проект IZI, сначала staging. База SEVER
   не используется как база IZI. В PHASE 2 реальный проект не создавался:
   работа локально на PGlite.
2. **D2 — RESOLVED.** Текущий подключённый Supabase SEVER проверен владельцем:
   таблиц `tavro_*` нет, миграции 018/019 не применены, очистка не требуется.
3. **D3 — RESOLVED.** Для staging будет отдельный Telegram-бот (создаётся не в PHASE 2).
4. **D4 — RESOLVED.** Сырой текст захвата хранится максимум 30 дней и удаляется
   автоматически; структурированные записи, метаданные и журнал без исходного
   текста сохраняются. Реализовано в схеме (см. «PHASE 2 — фактические решения»).
5. **D5 — RESOLVED.** «утром/днём/вечером/ночью» → `part_of_day`, время `null`;
   «в 4» → требует уточнения; «в 4 утра» → 04:00; «в 4 дня/вечера» → 16:00;
   «в 16», «в 16:00» → 16:00. Реализовано и покрыто тестами.
6. **D6 — RESOLVED.** MVP только на русском; русские строки изолированы в
   `izi/src/locales/ru/`, core и модули — без них (статический тест).
7. **Не проверено** (будет проверено в указанных фазах): реальное поведение
   initData с полем `signature` (PHASE 3), лимиты и фоновые задачи Edge
   Runtime и способ подключения к БД (PHASE 3), актуальные модели/параметры
   Structured Outputs и цены OpenAI (PHASE 6), формат OGG/Opus для STT (PHASE 7),
   лимиты массовой отправки Telegram (PHASE 10), PITR/бэкапы на тарифе Supabase
   (PHASE 10), правила Stars для цифровых товаров и курс (PHASE 13), условия
   хранения данных у AI-провайдера (PHASE 6).
8. **SGX Planner** напрямую не исследовался; продуктовые сравнения основаны
   только на перечне из ТЗ.
