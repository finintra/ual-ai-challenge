# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# AI Challenge · УАЛ-Ужгород

Це методичка для 7-денного AI Challenge, який Арсеній проводить як практику для двох студентів УАЛ-Ужгород. Зараз робота над контентом триває, плюс розгорнута gamified-механіка: кожен день розблоковує наступний через скаут-кодові слова.

## Що тут є

```
.
├── CLAUDE.md              ← цей файл, контекст для Claude Code
├── README.md              ← як працювати з проектом
├── content/               ← джерело правди — markdown по днях
│   ├── overview.md
│   ├── day-1.md … day-7.md
│   ├── journal.md         ← Бортовий журнал (Notion-шаблон)
│   └── supervisor.md      ← внутрішнє для керівника (коди + дашборд)
├── build/
│   ├── build_site.py             ← основний build (markdown → encrypted HTML + portfolio)
│   ├── submissions.py            ← схеми чек-ін форм по днях + список студентів
│   ├── template.html             ← HTML-каркас (login + student picker + sidebar + content)
│   ├── portfolio_template.html   ← HTML каркас публічної сторінки портфоліо
│   ├── styles.css                ← editorial-естетика
│   ├── app.js                    ← логіка login + quest + checkin form + supervisor
│   └── portfolio_app.js          ← логіка публічного портфоліо (fetch з Supabase)
├── supabase/
│   └── schema.sql         ← одноразовий SQL для накатки таблиці submissions
├── passwords.example.json ← шаблон з прикладами
├── passwords.json         ← реальні паролі (gitignored)
├── .github/workflows/
│   └── pages.yml          ← авто-деплой на GitHub Pages при push
└── dist/                  ← вихід білда (gitignored)
    ├── index.html         ← фінальний single-file челендж
    └── portfolio.html     ← публічна сторінка портфоліо
```

## Тех-стек і чому

**Python для білда, vanilla HTML/CSS/JS для рантайму.** Жодних `node_modules`, `npm`, фреймворків. Чому:
- Користувач — нетехнічний, простота > потужність
- Single-file output легко деплоїти будь-куди
- AES-GCM через Web Crypto API працює без зовнішніх бібліотек
- Markdown як джерело — комфортно для редагування

**Шифрування.** Кожен день шифрується власним паролем (з `passwords.json`) через PBKDF2-SHA256 (200k ітерацій) + AES-GCM. Salt і IV випадкові на кожному build. Web Crypto API у браузері декриптує клієнтсайд.

**Стан квесту.** `localStorage.unlocked_days = ["overview","day-1","journal"]` після першого логіну. Кожен код, який юзер вводить, спробує задекриптувати кожен ще не розблокований день. Успішна декрипція → день додається до unlocked_days і стає клікабельним у сайдбарі.

**Submission gate.** Кожен день має чек-ін форму (`{{CHECKIN_FORM}}` у markdown → render з `build/submissions.py`). Без успішного submit-у блок "Завершальний код" не показується (обгорнутий `<div class="completion-code" hidden>`). Submit POST-иться у Supabase `submissions(student_slug, day_id, payload jsonb)`. Upsert через `Prefer: resolution=merge-duplicates`.

**Identity.** Після успішного main-логіну, якщо `localStorage.student_slug` порожній — показується student picker (список з `STUDENTS` у `build/submissions.py`). Supervisor-логін picker пропускає.

**Portfolio.** Окрема публічна сторінка `dist/portfolio.html?student=<slug>` (без логіну). `portfolio_app.js` робить `GET /rest/v1/submissions?student_slug=eq.X` з anon key і рендерить картки по днях. URL шерабельне у LinkedIn.

## Build contract (що з чим пов'язано)

Цей розділ описує невидимі залежності, які білд **не** валідує — їх легко зламати редагуванням контенту.

- **`PAGES` у `build/build_site.py` — єдине джерело правди** про те, які markdown-файли потрапляють у білд, які лейбли показуються у сайдбарі, який ключ з `passwords.json` шифрує кожну сторінку, і чи заблокована вона за замовчуванням. Додати нову сторінку = дописати кортеж сюди.
- **"Завершальний код" у кінці `content/day-N.md` повинен побайтово дорівнювати `passwords.json["day-(N+1)"]`.** Білд НЕ перевіряє це — побачиш помилку лише коли клацнеш на наступний день у браузері і код не підійде. Зміна одного — обов'язково зміна іншого.
- **`section_classes` у `build/build_site.py` — whitelist H3-заголовків**, які отримують semantic-CSS-класи. Якщо додаєш нову `### Назву секції` у контент — додай запис сюди, інакше H3 рендериться без стилю.
- **`passwords.example.json` має ключ `"completion"`**, який не використовується як `pw_key` жодної сторінки у `PAGES`. Його значення підставляється у `content/day-7.md` через `{{UNLOCK_CODE}}` (це фінальний код "Челендж пройдено"). Якщо хочеш окрему сторінку-фініш — додай тупл у `PAGES`.
- **`{{CHECKIN_FORM}}` placeholder у `content/day-N.md` обов'язковий**, якщо хочеш чек-ін форму. `build_site.py` шукає його і вставляє згенерований `<form>`. Без placeholder — день не вимагає здачі (і код наступного дня не буде заблокований формою, але код все одно у hidden-блоці що unhide на submit — отже без `{{CHECKIN_FORM}}` користувач застрягне).
- **`SUBMISSIONS["day-N"]` у `build/submissions.py`** — схема полів для чек-ін форми. Якщо додаєш нове поле — додай key+label+type. `payload` у Supabase — JSONB, схема не мігрує.
- **`{{SUPERVISOR_DASHBOARD}}` у `content/supervisor.md`** — інжектиться через білд як `<div id="supervisor-dashboard">`, app.js фетчить submissions при рендері сторінки.

## Gamification: квест-механіка

7 днів утворюють лінійний квест. Кожен день закінчується "Завершальним кодом" — скаут-словом з тематичної прогресії:

| День | Розблоковується кодом | Тема коду     |
|------|------------------------|---------------|
| 1    | (головний пароль)      | старт         |
| 2    | (з `passwords.json`)   | стежка        |
| 3    | (з `passwords.json`)   | ватра         |
| 4    | (з `passwords.json`)   | компас        |
| 5    | (з `passwords.json`)   | мапа          |
| 6    | (з `passwords.json`)   | багаття       |
| 7    | (з `passwords.json`)   | похід         |
| —    | (з `passwords.json`)   | вершина (фініш)|

Реальні коди лежать у локальному `passwords.json` (gitignored) або у GitHub secret `PASSWORDS_JSON`. У публічному репо коди ніде не показані плейн-текстом.

У markdown-контенті використовуються плейсхолдери, які `build_site.py` підставляє на білді:
- `{{UNLOCK_CODE}}` — у кінці кожного `day-N.md` (підставляється кодом наступного дня)
- `{{CODE:<key>}}` — універсальний (наприклад, `{{CODE:day-3}}` у `supervisor.md`)
- `{{CHECKIN_FORM}}` — у `day-N.md` перед "Завершальний код"; підставляється чек-ін формою
- `{{SUPERVISOR_DASHBOARD}}` — у `supervisor.md`; підставляється контейнером дашборду

Flow з submission-gating: учасник дочитує день → бачить чек-ін форму → здає артефакти (Google Doc URLs, рефлексії) → submit POSTиться у Supabase → form замінюється на блок з кодом наступного дня → юзер копіює і вводить у сайдбарі → розблоковує наступний день. `supervisor.md` має повний список кодів + дашборд submissions.

## Як редагувати контент

Всі тексти у `content/*.md`. Звичайний markdown. Підтримуються:

- Кодові блоки (fenced ```...```)
- Списки (numbered → coral 01/02/03 нумерація автоматично)
- Заголовки h2/h3 → з semantic-класами через білд (для стилізації)
- Шаблони промптів — рендеряться як card-блоки з coral border
- Best practices — рендеряться як gold-card блоки

Спецсемантика секцій (для візуального розрізнення h3):
- `### Сцена` → coral-border
- `### Головна задача дня` → coral, bold border
- `### Місія` → coral
- `### Факультативні задачі` → dashed gray border
- `### Здобутки дня` → coral
- `### Пастки і поради` → deep-coral
- `### Debrief` → double-border

Якщо додаєш нову секцію — додай у `section_classes` dict у `build/build_site.py`.

## Команди

**Білд сайту:**
```bash
python3 build/build_site.py
# → dist/index.html
```

**Локальний preview:**
```bash
cd dist && python3 -m http.server 8000
# → http://localhost:8000
```

**Залежності (одноразово):**
```bash
pip install markdown cryptography
```

**Локальний preview з submissions:** треба експортувати Supabase env-и до білда, інакше форми покажуть "журнал не налаштовано":
```bash
export SUPABASE_URL='https://xxx.supabase.co'
export SUPABASE_ANON_KEY='eyJ...'
python3 build/build_site.py
```

**Deploy.** Push у main → GitHub Actions автоматично деплоїть `dist/` на GitHub Pages. Workflow у `.github/workflows/pages.yml`.

**Тести / лінт.** Відсутні. Сайт перевіряється вручну: збираємо, відкриваємо preview, проходимо квест-ланцюг кодами.

## Supabase setup (одноразово, для submissions)

1. Створи проект на [app.supabase.com](https://app.supabase.com) (Free tier OK).
2. SQL Editor → постав вміст `supabase/schema.sql` → Run.
3. Project Settings → API → скопіюй `Project URL` і `anon public` ключ.
4. У GitHub repo → Settings → Secrets and variables → Actions → додай:
   - `SUPABASE_URL` = `https://xxx.supabase.co`
   - `SUPABASE_ANON_KEY` = `eyJ...` (anon key, не service role!)
5. Push → workflow збере сайт з ендоінтом і ключем, інжекченими у app.js / portfolio_app.js.

Якщо secrets відсутні — білд проходить, але checkin форми показують помилку про "журнал не налаштовано", а portfolio сторінка — повідомлення про конфіг.

Schema проста: одна таблиця `submissions(student_slug, day_id, payload jsonb)` з `unique(student_slug, day_id)`. Upsert через `Prefer: resolution=merge-duplicates`. RLS — open для anon (закритий челендж на 2 студентів; якщо потрібен жорсткіший контроль — переключи policy у `supabase/schema.sql`).

## Зміна паролів

`passwords.json` — НЕ комітиться в git (у `.gitignore`). Структура (приклади в `passwords.example.json`):

```json
{
  "main": "<пароль для Overview + Day 1 + Журналу>",
  "day-2": "<код, що відкриває День 2>",
  "day-3": "<код, що відкриває День 3>",
  "...": "...",
  "day-7": "<код, що відкриває День 7>",
  "completion": "<фінальний код 'вершина'>",
  "supervisor": "<окремий пароль для сторінки керівника>"
}
```

`main` дає доступ до Overview + Day 1 + Журналу. Решта кожен на свій день. `supervisor` — окремий, не входить у квест-ланцюг.

Для production-деплою через GitHub Actions додай passwords як secret:
- Repo Settings → Secrets and variables → Actions → New repository secret
- Name: `PASSWORDS_JSON`, Value: вміст твого `passwords.json` (JSON-рядок)
- Workflow прочитає його замість файлу в репо

CI шукає паролі за ланцюгом fallback (`.github/workflows/pages.yml`): GitHub Secret `PASSWORDS_JSON` → закомічений у репо `passwords.json` → `passwords.example.json` як last-resort. У продакшні має бути перший варіант, інші — лише страховка.

Після зміни паролів — перезбираємо `build_site.py` і пушимо. Workflow перебудує сайт автоматично.

⚠️ Якщо змінив пароль для дня N — треба також оновити `Завершальний код` у попередньому дні N-1 у `content/day-(N-1).md`.

## Стиль і tone of voice

- **Українська мова, без англіцизмів без потреби.** "Дедлайн" — норм. "По фасту зробимо роадмеп" — переписати.
- **Мінімум emoji.** Один на 5+ параграфів максимум.
- **Конкретика > абстракції.** Не "багато людей", а "73% опитаних" (якщо є джерело).
- **Без літературних метафор.** "AI як другий мозок" — ОК. "Магічний помічник" — ні.
- **Менш категоричні формулювання.** "Іноді спрацьовує" замість "це працює завжди".
- **Не вигадуй фактів.** Якщо щось перевіряєш для контенту і не впевнений — лиши placeholder для Арсенія перевірити.

## Скаут-словник челенджу

Це не одноразова косметика — терміни консистентні скрізь:

- **Сходини** — ранкова зустріч (09:00-09:30)
- **Перехід** — основна робоча фаза (УАЛ-місія, особиста місія)
- **Привал** — обідня перерва
- **Ватра** — вечірня зустріч з керівником (15:30-17:00, show & tell)
- **Польовий рапорт** — короткий звіт у WhatsApp увечері
- **Бортовий журнал** — щоденник челенджера (Notion-шаблон)
- **Пілот / Навігатор** — пара-ролі, міняються щодня
- **Сцена** — наративна підводка до головної задачі дня
- **Місія** — основні задачі (УАЛ-трек + особистий трек)
- **Факультативні задачі** — опціональні харднькі виклики
- **Арсенал** — інструменти дня
- **Здобутки дня** — фінальні артефакти
- **Debrief** — підсумкові запитання

## Що НЕ змінювати без обговорення з Арсенієм

- **Структура 7 днів** — фінальна, не повертайся до 8
- **WhatsApp як месенджер команди** (Telegram — лише як технічний приклад у Дні 6)
- **Без бюджету у студентських документах** — це задача керівника, не їх
- **Пара-ролі (Пілот/Навігатор)** — концепція, що проходить наскрізно
- **Анна Бондаренко** як обов'язкове джерело для Дня 1 УАЛ-треку
- **KitWorks брендинг** — не додавай, навіть в коментарі скрипта

## Контекст автора (Арсеній)

- BA at KitWorks Systems, Uzhhorod
- Викладає в УАЛ і KitWorks Academy
- Нетехнічний користувач (працює через AI-tools), розуміється на бізнес-аналізі
- Активний у єврейській громаді Ужгорода
- Веде facebook-сторінку про настільні ігри #ігримишьяка

## Куди звертатися за допомогою

Якщо щось у проекті незрозуміло — спочатку:
1. Перечитай цей CLAUDE.md
2. Подивись `README.md` для типових команд
3. Подивись `build/build_site.py` — там вся логіка білда
4. Якщо все одно не зрозуміло — питай Арсенія напряму

При роботі з контентом — пріоритет: 1) точність і факти, 2) український тон голосу, 3) сумісність зі скаут-словником. Естетику можна підкоригувати потім.
