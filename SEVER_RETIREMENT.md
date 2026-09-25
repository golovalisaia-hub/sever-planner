# SEVER retirement — audit report

> Дата: 2026-09-25. Ветка отчёта: `izi/foundation`.
> Документ не содержит секретов, ключей, персональных данных и текстов записей.
> **Ничего не удалялось и не изменялось** ни в GitHub, ни в Supabase.

## Итог

# DELETION READINESS: **BLOCKED**

Главные причины (подробно — раздел 17):

1. **Academy живёт в том же Supabase-проекте.** Опубликованный код Academy
   (`golovalisaia-hub/-`, HEAD `a11d21a`) обращается к `vdhazibkfpgclcwyvvbi`:
   свои таблицы `academy_*`, RPC `academy_claim_ai_quota`, Edge Function
   `academy-tutor`, **и таблицы SEVER `tasks` и `profiles`**. Удаление
   `sever-planner` сломает Academy и уничтожит её данные.
2. **Живой Supabase не проверен.** Сетевая политика этой сессии запрещает доступ
   к `vdhazibkfpgclcwyvvbi.supabase.co` (CONNECT 403), а ключей сервисной роли,
   пароля БД и токена Management API в сессии нет (и не должно быть в GitHub).
   Количество строк, пользователей Auth, Storage, развернутые функции, cron,
   Vault и schema drift **не измерены** — ниже они помечены `НЕ ПРОВЕРЕНО`.
3. **Тег архива не создан на GitHub**: git-прокси сессии отклоняет push тегов
   (разрешены только ветки сессии). Нужна одна команда владельца (раздел 2).

---

## 1. GitHub archive status

Репозиторий `golovalisaia-hub/sever-planner` — **не удалялся, история не
переписывалась, ветки не трогались.** 116 веток, 1 тег до аудита.

| Ref | HEAD | Назначение |
|---|---|---|
| `main` | `4f722eb505cd003091902460efc29663ecd4e5f6` | Финальный SEVER (merge PR #76, v126, 2026-09-17) |
| `claude/hopeful-hawking-gljtn8` | `ce52149865ae867cc90b955e0178f00d615aa4df` | TAVRO (донор) |
| `claude/gallant-feynman-lsqj0j` | `f009eb1687fa2d5d0190d34bd030228b1cab1b18` | IZI PHASE 1 (план) |
| `izi/foundation` | `aa79d5f61041fdc8f11438cfd34cfc25c7326111` до этого отчёта | IZI Foundation + 2.1 |
| tag `backup-before-smart-calendar-2026-09-03` | `eb831ec` | существовал ранее, не изменялся |

## 2. Final SEVER commit / tag

- Финальный коммит SEVER: **`4f722eb`** (`main`).
- Тег `sever-final-archive` на GitHub **не существовал** и **не создан**:
  push тега отклонён прокси этой сессии. Обходов не делалось.
- Команда для владельца (локально, безопасно, не меняет ветки):

  ```bash
  git fetch origin main
  git tag -a sever-final-archive 4f722eb505cd003091902460efc29663ecd4e5f6 \
    -m "SEVER final archive: main at retirement; donor/archive only"
  git push origin refs/tags/sever-final-archive
  ```

  Либо GitHub → Releases → Draft new release → tag `sever-final-archive`,
  target: commit `4f722eb`.

## 3. Supabase project

| Поле | Значение | Источник |
|---|---|---|
| Project ref | `vdhazibkfpgclcwyvvbi` | публичный `supabase-config.js` на `main` (URL, не секрет) |
| Имя | `sever-planner` (со слов владельца) | НЕ ПРОВЕРЕНО |
| Статус | НЕ ПРОВЕРЕНО | нет доступа |

## 4. PostgreSQL version

НЕ ПРОВЕРЕНО. Запрос для владельца — раздел 20.

## 5–6. Table inventory и row counts

Ниже — **ожидаемый** список из миграций GitHub (SEVER 001–017) и из кода
Academy. Фактический список и числа строк нужно снять запросами раздела 20.

| Table | Rows | Purpose | Personal data? | Needed for IZI? | Need backup? | Safe to delete with SEVER? |
|---|---|---|---|---|---|---|
| `profiles` | НЕ ПРОВЕРЕНО | роль owner/user, email | да (email) | нет | архив по решению владельца | **нет — используется Academy** |
| `tasks` | НЕ ПРОВЕРЕНО | задачи SEVER; **Academy пишет сюда задачи уроков** (`IT · День …`) | да | нет (IZI — своя схема; импорт позже по желанию) | да, если нужны | **нет — используется Academy** |
| `habits`, `habit_entries` | НЕ ПРОВЕРЕНО | привычки | да | нет | по решению владельца | да, после backup-решения |
| `note_folders`, `notes` | НЕ ПРОВЕРЕНО | заметки (в т.ч. зашифрованные) | да | нет | по решению владельца | да, после backup-решения |
| `focus_sessions` | НЕ ПРОВЕРЕНО | фокус-сессии | да | нет | маловероятно | да |
| `user_settings` | НЕ ПРОВЕРЕНО | настройки + **финансы v111 (JSON)** | да | нет | по решению владельца (финансы) | да, после backup-решения |
| `ai_memories`, `ai_plans` | НЕ ПРОВЕРЕНО | память/планы SEVER AI | да | нет | по решению владельца | да, после backup-решения |
| `ai_usage` | НЕ ПРОВЕРЕНО | учёт AI | метаданные | нет | нет | да |
| `push_subscriptions` | НЕ ПРОВЕРЕНО | web push endpoints | да (endpoint/ключи устройства) | нет | **нет** (не переносить) | да |
| `push_deliveries`, `push_rhythm_deliveries` | НЕ ПРОВЕРЕНО | журналы доставки | метаданные | нет | нет | да |
| `push_probe_attempts_v120`, `push_iphone_retry_v121`, `push_iphone_topic_recovery_v122`, `push_iphone_live_check_v126` | НЕ ПРОВЕРЕНО | диагностика iPhone | нет | нет | нет | да |
| `academy_path_progress` | НЕ ПРОВЕРЕНО | прогресс Academy | да | нет | **да** | **нет — Academy** |
| `academy_reading` | НЕ ПРОВЕРЕНО | дневник чтения Academy | да | нет | **да** | **нет — Academy** |
| `academy_blocks`, `academy_sessions` | НЕ ПРОВЕРЕНО | расписание/сессии Academy | да | нет | **да** | **нет — Academy** |
| `academy_calendar_links` | НЕ ПРОВЕРЕНО | связь уроков с задачами SEVER | да | нет | **да** | **нет — Academy** |
| `academy_ai_usage` | НЕ ПРОВЕРЕНО | квота AI-тьютора Academy | метаданные | нет | нет | **нет — Academy** |

## 7. Auth

- Количество пользователей: **НЕ ПРОВЕРЕНО** (запрос в разделе 20 возвращает
  только число, без email и токенов).
- **Auth SEVER не является основой IZI**: у IZI собственная модель `accounts` +
  `identities`, в коде `izi/` нет ссылок на `auth.users` (проверено тестом).
- **Но Auth нужен Academy**: вход в Academy (`sever-academy-auth-v1`) идёт через
  Supabase Auth этого проекта.

## 8. Storage

НЕ ПРОВЕРЕНО. В коде SEVER, TAVRO и Academy нет вызовов `storage.from(...)` —
buckets не ожидаются, но это нужно подтвердить запросом раздела 20.

## 9. Edge Functions

Список из GitHub. Совпадение развернутых версий с GitHub **НЕ ПРОВЕРЕНО**
(нужен `supabase functions list` / Dashboard → Edge Functions).

| Name | Purpose | Used by IZI? | Donor value | Safe to lose after GitHub archive? |
|---|---|---|---|---|
| `sever-ai` | AI-ассистент SEVER | нет | да (идеи; код в GitHub) | да, если deployed = GitHub |
| `sever-push-dispatch` | отправка web push по cron | нет | средняя (паттерн ledger) | да, если deployed = GitHub |
| `sever-push-health` | проверка VAPID | нет | нет | да |
| `sever-push-probe`, `sever-push-iphone-retry`, `sever-push-iphone-topic-recovery`, `sever-push-iphone-live-check` | диагностика iPhone push | нет | нет | да |
| `academy-tutor` | AI-тьютор Academy (код в `golovalisaia-hub/-`) | нет | — | **нет — Academy** |
| `tavro-*` | TAVRO (018/019) | нет | — | по коду не развёртывались; D2: не применялись |

Любая развернутая функция, которой нет в списке, или чей код отличается от
GitHub, — **критическая находка** (deployment-only code).

## 10. Migrations inventory

- **SEVER (`sever-planner/supabase/migrations`, `main`)**: 001–017
  (`001_initial_cloud_sync` … `017_iphone_live_check_v126`).
- **TAVRO**: 018, 019 — только в ветке `claude/hopeful-hawking-gljtn8`; по D2
  (проверка владельца) **не применены**.
- **Academy (`golovalisaia-hub/-/supabase/migrations`)**:
  `20260920142217_academy_three_stage_assessment`, `20260921090000_academy_ai_quota`.
- **Известно из README Academy, но отсутствует в обоих репозиториях**:
  миграция `academy_qa_english_calendar_atomic_sync` (создаёт
  `academy_calendar_links`), функция/триггер `academy_progress_to_sever_calendar`,
  создание таблиц `academy_path_progress`, `academy_reading`, `academy_blocks`,
  `academy_sessions`. → см. раздел 15.
- Фактическая история `supabase_migrations.schema_migrations`: НЕ ПРОВЕРЕНО.

## 11. Cron / infrastructure inventory

Ожидается по миграциям SEVER (значения секретов не приводятся):

- расширения: `pgcrypto`, `pg_cron`, `pg_net`;
- cron job `sever-task-push-dispatch` (каждую минуту → `sever-push-dispatch`);
- Vault-секреты **по именам**: `sever_project_url`, `sever_push_cron_token`,
  `sever_push_vapid_public`, `sever_push_vapid_private`;
- функции-хелперы `sever_push_runtime_secrets`, `sever_claim_due_pushes(_v96)`,
  `sever_claim_due_rhythm_pushes_v115`.

Фактический список `cron.job`, расширений и имён Vault: НЕ ПРОВЕРЕНО.

## 12. Academy dependency check — **BLOCKED FOR DELETION**

| Объект | Используется сейчас | Откуда | Данные | Активный код |
|---|---|---|---|---|
| `academy_path_progress` | да | вне миграций GitHub (drift) + `20260920142217` | ожидаются | `home.js`, `path.js` |
| `academy_reading` | да | вне миграций GitHub | ожидаются | `home.js`, `library.js` |
| `academy_blocks`, `academy_sessions` | да | вне миграций GitHub | ожидаются | `studio.js`, `roadmap.js` |
| `academy_calendar_links`, `academy_progress_to_sever_calendar` | да | миграция из README, нет в репозиториях | ожидаются | SQL-триггер |
| `academy_ai_usage`, `academy_claim_ai_quota` | да | `20260921090000_academy_ai_quota` | ожидаются | `ai.js`, `academy-tutor` |
| Edge Function `academy-tutor` | да | `golovalisaia-hub/-` | — | `ai.js`, `mentor.js` |
| SEVER `tasks` (запись задач уроков), `profiles` (роль) | да | SEVER | общие | `app.js`, `studio.js`, `home.js`… |
| Supabase Auth проекта | да | — | пользователи | все страницы входа Academy |

Файлы Academy с URL проекта: `ai.js`, `app.js`, `home.js`, `library.js`,
`path.js`, `studio.js`, `index.html`, `ai.html`, `courses.html`,
`library.html`, `path.html`, `roadmap.html`, `studio.html`, `ACADEMY-TUTOR-REVIEW.md`.

**Вывод:** пока Academy не переведена на отдельный Supabase-проект (или
владелец явно не решил закрыть Academy и её данные), удалять `sever-planner` нельзя.

## 13. TAVRO check

- Код TAVRO (`claude/hopeful-hawking-gljtn8`) ссылается на проект только через
  унаследованные файлы SEVER и `019_tavro_reminder_cron.sql` (использует Vault по
  имени). TAVRO не развёрнут и не является продуктом.
- Наличие `tavro_*` в базе: по D2 владелец проверил — **нет**. В этом аудите
  повторно НЕ ПРОВЕРЕНО (нет доступа).
- Удаление проекта TAVRO не вредит: его код остаётся в ветке.

## 14. IZI dependency check — **нет зависимостей**

Поиск по `izi/` в `izi/foundation`: нет project ref `vdhazibkfpgclcwyvvbi`,
нет `supabase.co`, нет ключей SEVER, нет `public.tasks`, нет `auth.users`, нет
ссылок на функции `sever-*`. Это же закреплено тестами
(`izi/tests/db/migrations.test.mjs`, `izi/tests/security/static.test.mjs`).
Схема `izi.*` в базе SEVER: по D2 не применялась; повторно НЕ ПРОВЕРЕНО.

## 15. Schema drift findings

Подтверждено по коду (без доступа к базе): **drift есть**.

- Таблицы `academy_path_progress`, `academy_reading`, `academy_blocks`,
  `academy_sessions`, `academy_calendar_links` и функция
  `academy_progress_to_sever_calendar` используются, но их `create` нет ни в
  миграциях SEVER, ни в миграциях Academy (там только `alter` и `academy_ai_usage`).
  Их DDL нужно выгрузить из базы в архив до любого удаления (раздел 20, запрос 6).
- Остальной drift (ручные объекты вне миграций) — НЕ ПРОВЕРЕНО.

## 16. Data backup recommendation

- **Резервная копия данных в этом аудите не создана** (нет доступа к базе).
- Рекомендация:
  1. снять только числа (раздел 20) и решить, какие данные ценны;
  2. если нужны — выгрузить **локально/приватно**:
     `supabase db dump --data-only --schema public -f sever_data.sql` и
     `supabase db dump --schema public -f sever_schema.sql` (Supabase CLI с вашим
     доступом) или Dashboard → Database → Backups;
  3. **не коммитить** дампы в GitHub, хранить в приватном месте;
  4. данные Academy выгружать отдельно — они нужны живому проекту.

## 17. Blocking issues

| # | Блокер | Что снимает блок |
|---|---|---|
| B1 | Academy использует этот проект (таблицы, Auth, Edge Function, SEVER `tasks`/`profiles`) | перенос Academy в отдельный Supabase-проект **или** явное решение владельца закрыть Academy |
| B2 | Живая база не проверена (строки, Auth, Storage, функции, cron, Vault, drift) | прогнать раздел 20 в SQL Editor и сверить функции в Dashboard; либо разрешить сессии доступ к хосту и выдать временный read-only доступ |
| B3 | Drift Academy: DDL таблиц `academy_*` нет в Git | выгрузить DDL (раздел 20, запрос 6) в архив |
| B4 | Тег `sever-final-archive` не создан | команда владельца из раздела 2 |
| B5 | Нет решения о пользовательских данных SEVER | владелец решает: backup или «не нужны» |

## 18. Recovery plan

| Что | Как восстановить |
|---|---|
| **Код** | GitHub: `main` @ `4f722eb` (+ тег `sever-final-archive` после создания), ветки TAVRO и IZI сохранены |
| **Схема SEVER** | миграции 001–017 на `main`; ручные объекты — только если выгружены (раздел 20) |
| **Схема Academy** | миграции в `golovalisaia-hub/-` + выгруженный DDL `academy_*` (сейчас в Git отсутствует) |
| **Данные пользователей** | только из приватного backup, если он будет сделан; иначе **невосстановимы** |
| **Секреты** | в GitHub не хранятся и не будут; при восстановлении — выпустить заново (VAPID, cron-токен, ключи AI) |
| **Supabase-проект** | после удаления — только новый проект с новым ref; URL в клиентах придётся заменить |

## 19. Final deletion readiness

**BLOCKED** — B1 (Academy) и B2 (живая база не проверена) являются
самостоятельными причинами. Даже после снятия блокеров удаление выполняется
только по отдельной явной команде владельца.

---

## 20. Read-only queries for the owner (Supabase → SQL Editor)

Все запросы только читают и возвращают числа/имена, без содержимого записей.

```sql
-- 1. Версия и схемы
select version();
select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1;

-- 2. Таблицы public/izi и точное число строк (только числа)
select table_schema, table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as rows
  from information_schema.tables
 where table_schema in ('public', 'izi') and table_type = 'BASE TABLE'
 order by 1, 2;

-- 3. TAVRO / IZI объекты
select table_schema, table_name from information_schema.tables
 where table_name like 'tavro\_%' or table_schema = 'izi';

-- 4. Auth и Storage (только числа)
select count(*) as auth_users from auth.users;
select b.name, b.public, count(o.id) as objects
  from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by b.name, b.public;

-- 5. Расширения, cron, имена Vault-секретов (без значений), история миграций
select extname, extversion from pg_extension order by 1;
select jobname, schedule, active from cron.job order by 1;
select name from vault.secrets order by 1;
select version, name from supabase_migrations.schema_migrations order by 1;

-- 6. Drift: DDL таблиц и функций academy_* (для архива, без данных)
select p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'academy%';
-- Для таблиц надёжнее: supabase db dump --schema public -f schema.sql (CLI), затем взять academy_* из файла.

-- 7. RLS по таблицам
select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and relkind = 'r' order by 1;
```

Edge Functions (Dashboard → Edge Functions или `supabase functions list`):
сверить список с разделом 9 и дату/версию деплоя с последними коммитами.
