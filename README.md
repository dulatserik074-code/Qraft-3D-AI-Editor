# Qraft 3D AI Editor 1.0

Local-first веб‑редактор React + Three.js с Supabase Auth/PostgreSQL и защищёнными OpenAI API. Гость может моделировать и сохранять проекты локально. Облачная синхронизация и AI требуют входа и внешней конфигурации.

AI создаёт приблизительную редактируемую 3D‑композицию. Невидимые стороны изображения оцениваются автоматически. Это не профессиональный скульптированный mesh.

## Быстрый запуск

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run dev
```

Откройте `http://localhost:5173`. Backend: `http://localhost:8790`. Без ключей работают ручной редактор, IndexedDB‑сохранение, шаблоны и экспорт. AI честно показывает «AI не настроен» и не меняет сцену.

## Архитектура

- `client`: React, TypeScript, Three.js, IndexedDB, Supabase browser SDK.
- `server`: Express, Supabase token verification/service role, OpenAI Responses API, image analysis и transcription.
- `supabase/migrations`: projects, ai_usage, RLS и атомарная RPC `consume_ai_usage`.
- Production: один Express Web Service раздаёт `/api/*` и `client/dist`.

ScenePatch валидируется Zod на сервере и клиенте. Locked‑объекты сохраняются при replace и игнорируют append‑обновления. Duplicate ID отклоняются. Ошибка AI не меняет сцену.

## Возможности

- примитивы, Move/Rotate/Scale, свойства, материалы, lock/visibility;
- 50 операций Undo/Redo и горячие клавиши W/E/R, Delete, Escape, Ctrl/Cmd+Z/Y/D;
- Shift multi-select, группировка и групповая трансформация;
- perspective/orthographic, raycasting, WebGL context recovery и Error Boundary;
- local-first проекты в IndexedDB, v1→v2 migration и recovery повреждённых данных;
- экран локальных/облачных проектов и optimistic revision conflict;
- Supabase email/password: регистрация, вход, выход, восстановление пароля;
- text AI, consent‑protected PNG/JPEG/WebP analysis и voice transcription;
- JSON v2, PNG и бинарный GLB;
- мобильные Add/Scene/Properties/Projects/Account панели.

## Supabase

1. Создайте Supabase project.
2. В SQL Editor выполните `supabase/migrations/20260901150000_qraft_v1.sql`.
3. В Authentication включите Email provider и задайте Site URL/redirect URLs.
4. Добавьте frontend значения `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
5. Добавьте server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

RLS разрешает CRUD только для `auth.uid() = user_id`. Клиент может читать собственную статистику AI, но не изменять её. Service role вызывает защищённую атомарную RPC лимитов и никогда не передаётся frontend.

## OpenAI

Server-only переменные:

- `OPENAI_API_KEY`;
- `OPENAI_MODEL` (по умолчанию `gpt-4o-mini`);
- `OPENAI_TRANSCRIBE_MODEL` (по умолчанию `gpt-4o-mini-transcribe`).

Все AI endpoints требуют `Authorization: Bearer <Supabase access token>`. Ответы Responses API используют Structured Outputs, `store: false`, timeout, ограниченные retries и `max_output_tokens`. Аудио и Base64 изображения не сохраняются и не логируются.

## Переменные окружения

Обязательны для полной production‑версии:

- `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — server-only;
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — безопасная публичная конфигурация frontend;
- `ALLOWED_ORIGINS` — один или несколько origins через запятую.

Необязательны: модели, `PORT`, `AI_RATE_LIMIT_PER_MINUTE`, `AI_DAILY_TEXT_LIMIT`, `AI_DAILY_IMAGE_LIMIT`, `AI_DAILY_VOICE_LIMIT`, `AI_GLOBAL_DAILY_LIMIT`.

Никогда не используйте `VITE_` для OpenAI или service role ключа.

## Проверки

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
npm.cmd audit --audit-level=high
```

GitHub Actions устанавливает Chromium и выполняет весь набор. Unit/API тесты mock‑ируют пользователей/usage и не обращаются к реальным OpenAI или Supabase.

## Render

1. Создайте Blueprint из `render.yaml`.
2. Заполните все Supabase/OpenAI env values и `ALLOWED_ORIGINS` публичным Render URL.
3. Build: `npm ci && npm run build`; start: `npm run start`; health: `/api/health`.

API routes объявлены до SPA fallback. Неизвестный `/api/*` всегда возвращает JSON 404.

## Ограничения

- Live OpenAI/Supabase нельзя проверить без аккаунтов и ключей владельца.
- AI image analysis строит композицию из примитивов, не sculpted mesh.
- Импорт GLTF оставлен следующим этапом; экспорт GLB поддерживается.
- Групповая трансформация использует общие delta/ratio, но отдельный group pivot gizmo пока отсутствует.
- Удаление облачного проекта через UI будет расширено после live‑проверки Supabase policies.

MIT License.
