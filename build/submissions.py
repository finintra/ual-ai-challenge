"""Per-day submission schemas. Single source of truth for checkin forms.

Each day_id maps to:
  - title    : heading shown above the form
  - intro    : short paragraph explaining what's submitted
  - fields   : ordered list of fields
      - key        : column name in the JSON payload (snake_case)
      - label      : human-readable label
      - type       : 'url' | 'textarea' | 'text'
      - required   : bool
      - placeholder: optional input hint
      - min_length : optional, for textarea
      - rows       : optional, textarea visible row count (default 4)
      - help       : optional one-line note shown below the input

URLs are validated as http(s) by HTML5 type=url. Textareas use minlength.
The build script renders one <form> per day from this dict.

Принцип: URL — тільки коли артефакт справді великий (PDF, відео, лого-файли,
жива сторінка, диск-папка, транскрипт). Усе, що раніше було Google Doc-ом на
1-3 сторінки, тепер inline textarea — щоб керівнику не треба було відкривати
п'ять документів на день.
"""

STUDENTS = [
    {"slug": "oleksiy", "name": "Олексій", "color": "#FF5A3D"},
    {"slug": "andriy",  "name": "Андрій",  "color": "#F5C24A"},
]


SUBMISSIONS = {
    "day-1": {
        "title": "Чек-ін: дослідження",
        "intro": "Здай артефакти Дня 1 — після цього отримаєш код для розблокування Дня 2. УАЛ-артефакти — спільні з парою: домовтесь хто пастить і вставте однакові посилання обидва.",
        "fields": [
            {"key": "claude_project_ual_url", "label": "URL твого Claude Project (УАЛ)", "type": "url", "required": True, "placeholder": "https://claude.ai/project/..."},
            {"key": "claude_project_personal_url", "label": "URL твого Claude Project (особистий трек)", "type": "url", "required": True},
            {"key": "interview_doc_url", "label": "Транскрипт або конспект інтерв'ю з Анною (Google Doc)", "type": "url", "required": True, "help": "Документ із ключовими цитатами — лишаємо як посилання, бо обсяг великий"},
            {"key": "ual_brief", "label": "УАЛ-бриф (постав сюди весь текст брифу)", "type": "textarea", "required": True, "rows": 16, "min_length": 800, "help": "3-4 сторінки: проблема, аудиторія, цілі, обмеження, гіпотези"},
            {"key": "personal_brief", "label": "Особистий бриф (повний текст)", "type": "textarea", "required": True, "rows": 16, "min_length": 800},
            {"key": "naming_options", "label": "Варіанти назв (3-5 шт) з перевіркою домена", "type": "table", "required": False, "rows": 5, "columns": [
                {"key": "name",   "label": "Назва",          "placeholder": "Brand name"},
                {"key": "domain", "label": "Можливий домен", "placeholder": "example.com"},
            ], "help": "Заповнюй стільки рядків, скільки потрібно. Пусті — пропускаються."},
            {"key": "research_tools_note", "label": "Нотатка «Claude Research vs Perplexity vs Gemini»", "type": "textarea", "required": True, "rows": 10, "min_length": 400, "help": "Власні висновки: що для чого, де хто сильніший, де слабше"},
            {"key": "open_questions", "label": "Список відкритих питань після інтерв'ю", "type": "textarea", "required": True, "rows": 8, "min_length": 120, "help": "Твоя дорожня карта подальшого ресерчу"},
            {"key": "biggest_insight", "label": "Найнесподіваніший інсайт дня (один абзац)", "type": "textarea", "required": True, "rows": 4, "min_length": 120},
        ],
    },

    "day-2": {
        "title": "Чек-ін: бренд",
        "intro": "Здай артефакти Дня 2 — після цього отримаєш код для розблокування Дня 3. УАЛ-артефакти (Brand Guidelines, лого, mockup) — спільні з парою: домовтесь і вставте однакові посилання.",
        "fields": [
            {"key": "ual_brand_pdf_url", "label": "Brand Guidelines PDF — УАЛ", "type": "url", "required": True, "help": "1-2 сторінки: лого, палітра, шрифти, mood board"},
            {"key": "personal_brand_pdf_url", "label": "Brand Guidelines PDF — особистий трек", "type": "url", "required": True},
            {"key": "ual_logo_files_url", "label": "Лого УАЛ (Google Drive: PNG + SVG)", "type": "url", "required": True},
            {"key": "personal_logo_files_url", "label": "Лого особисте (Google Drive: PNG + SVG)", "type": "url", "required": True},
            {"key": "ual_mockup_url", "label": "UI-мокап головної сторінки — УАЛ", "type": "url", "required": True},
            {"key": "personal_mockup_url", "label": "UI-мокап головної сторінки — особисте", "type": "url", "required": True},
            {"key": "image_gen_note", "label": "Нотатка «Який image gen для якої задачі»", "type": "textarea", "required": True, "rows": 8, "min_length": 300, "help": "Власні висновки: Midjourney / DALL-E / Imagen / Ideogram — сильні і слабкі сторони"},
            {"key": "biggest_insight", "label": "Який інструмент дав найкращий лого і чому? (абзац)", "type": "textarea", "required": True, "rows": 4, "min_length": 120},
        ],
    },

    "day-3": {
        "title": "Чек-ін: сайт",
        "intro": "Здай артефакти Дня 3 — після цього отримаєш код для розблокування Дня 4. УАЛ-сайт і Lighthouse — спільні з парою: однакові посилання у обох.",
        "fields": [
            {"key": "ual_site_url", "label": "Жива URL сайту — УАЛ", "type": "url", "required": True, "help": "Відкривається на телефоні і десктопі"},
            {"key": "personal_site_url", "label": "Жива URL сайту — особисте", "type": "url", "required": True},
            {"key": "ual_lighthouse_url", "label": "Скрін Lighthouse — УАЛ", "type": "url", "required": True, "help": "Бажано 80+ за всіма параметрами"},
            {"key": "personal_lighthouse_url", "label": "Скрін Lighthouse — особисте", "type": "url", "required": True},
            {"key": "builder_comparison", "label": "Порівняння «Lovable vs Claude Code vs Jules»", "type": "textarea", "required": True, "rows": 10, "min_length": 400, "help": "Власні висновки: швидкість, гнучкість, де гальмує"},
            {"key": "biggest_insight", "label": "Який тип сайту для якого інструмента? (правило, абзац)", "type": "textarea", "required": True, "rows": 4, "min_length": 120},
        ],
    },

    "day-4": {
        "title": "Чек-ін: соцмережі",
        "intro": "Здай артефакти Дня 4 — після цього отримаєш код для розблокування Дня 5. УАЛ-акаунти, TOV, контент-план і пости — спільні з парою: однакові посилання у обох.",
        "fields": [
            {"key": "ual_social_accounts", "label": "Посилання на акаунти УАЛ-треку (1 URL у рядку, мін. 2 платформи)", "type": "textarea", "required": True, "rows": 4, "min_length": 30, "help": "Facebook, IG, LinkedIn, TikTok — як домовились"},
            {"key": "personal_social_accounts", "label": "Посилання на акаунти особистого треку", "type": "textarea", "required": True, "rows": 4, "min_length": 30},
            {"key": "ual_tov", "label": "Tone of voice — УАЛ (повний текст)", "type": "textarea", "required": True, "rows": 12, "min_length": 400, "help": "Принципи, слова-маркери, заборонені формулювання, приклади «до/після»"},
            {"key": "personal_tov", "label": "Tone of voice — особисте (повний текст)", "type": "textarea", "required": True, "rows": 12, "min_length": 400},
            {"key": "content_plan_url", "label": "Контент-план на 2 тижні (Sheets / Notion)", "type": "url", "required": True, "help": "Структурована таблиця — лишаємо як посилання"},
            {"key": "ual_posts_drive_url", "label": "Drive з 10-14 готовими постами — УАЛ", "type": "url", "required": True},
            {"key": "personal_posts_drive_url", "label": "Drive з 10-14 готовими постами — особисте", "type": "url", "required": True},
            {"key": "adaptation_note", "label": "Один меседж — три платформи (приклад адаптації)", "type": "textarea", "required": True, "rows": 12, "min_length": 400, "help": "Один інсайт → пост у LinkedIn, IG-кепшн, TikTok-скрипт"},
            {"key": "biggest_insight", "label": "Де AI-копірайт «горить» і що рятує? (абзац)", "type": "textarea", "required": True, "rows": 4, "min_length": 120},
        ],
    },

    "day-5": {
        "title": "Чек-ін: AI-медіа",
        "intro": "Здай артефакти Дня 5 — після цього отримаєш код для розблокування Дня 6. УАЛ-ролик і допоміжні файли — спільні з парою: однакові посилання у обох.",
        "fields": [
            {"key": "ual_video_url", "label": "Промо-ролик УАЛ (16:9, 30-60 сек, MP4)", "type": "url", "required": True, "help": "Drive / YouTube unlisted"},
            {"key": "personal_video_url", "label": "Промо-ролик особистий (9:16, 30-60 сек, MP4)", "type": "url", "required": True},
            {"key": "storyboards_url", "label": "Storyboards (папка з обома)", "type": "url", "required": True},
            {"key": "voiceover_files_url", "label": "Voiceover-аудіо (папка)", "type": "url", "required": True},
            {"key": "transcripts_url", "label": "Транскрипти voiceover-ів (Google Doc)", "type": "url", "required": True, "help": "Великий обсяг — лишаємо як посилання"},
            {"key": "biggest_insight", "label": "Який крок pipeline-у виявився найскладнішим? (абзац)", "type": "textarea", "required": True, "rows": 4, "min_length": 120},
        ],
    },

    "day-6": {
        "title": "Чек-ін: автоматизація",
        "intro": "Здай артефакти Дня 6 — після цього отримаєш код для розблокування Дня 7. УАЛ n8n workflow — спільний з парою (однакове посилання). Claude Code-задача — особиста, у кожного своя.",
        "fields": [
            {"key": "n8n_workflow_url", "label": "n8n workflow JSON (Drive)", "type": "url", "required": True, "help": "Експортований, можна імпортувати в інший n8n"},
            {"key": "workflow_demo_url", "label": "Скріни або відео роботи workflow", "type": "url", "required": True},
            {"key": "claude_code_doc", "label": "Документація Claude Code-задачі", "type": "textarea", "required": True, "rows": 10, "min_length": 300, "help": "Команда, що зробив, що отримав на виході, де довелось редагувати руками"},
            {"key": "automation_ideas", "label": "Як я автоматизую свою рутину (3-5 ідей)", "type": "textarea", "required": True, "rows": 10, "min_length": 400, "help": "Кожна ідея: тригер, дія, очікувана економія часу/тижд"},
            {"key": "biggest_insight", "label": "Де у твоєму житті автоматизація зекономила б 1+ год/тижд? (абзац)", "type": "textarea", "required": True, "rows": 4, "min_length": 120},
        ],
    },

    "day-7": {
        "title": "Чек-ін: портфоліо і публічна презентація",
        "intro": "Здай фінальні артефакти — після цього отримаєш код «вершина» і твій персональний сертифікат у PDF. УАЛ pitch deck — спільний з парою (однакове посилання у обох). Особистий портфоліо-сайт, особистий deck, рефлексія — у кожного свої.",
        "fields": [
            {"key": "personal_portfolio_url", "label": "Особистий портфоліо-сайт (live URL — головний deliverable дня)", "type": "url", "required": True, "help": "Multi-page сайт через Claude Code, який покажеш роботодавцю. Має бути у твоєму імені сертифіката"},
            {"key": "ual_deck_url", "label": "Спільний УАЛ pitch deck (Gamma / NotebookLM / PDF)", "type": "url", "required": True, "help": "Один на пару — однакове посилання у обох"},
            {"key": "personal_deck_url", "label": "Особистий pitch deck (Gamma / NotebookLM / PDF)", "type": "url", "required": True},
            {"key": "ual_presentation_recording_url", "label": "Запис живої УАЛ-презентації (опціонально)", "type": "url", "required": False, "help": "Якщо хтось записав з кутка кімнати — YouTube unlisted / Drive"},
            {"key": "personal_presentation_recording_url", "label": "Запис особистої живої презентації (опціонально)", "type": "url", "required": False},
            {"key": "final_reflection", "label": "Фінальна рефлексія (1-2 сторінки тексту)", "type": "textarea", "required": True, "rows": 16, "min_length": 600, "help": "Що 3 інструменти залишаються назавжди? Що змінилось у розумінні професії?"},
        ],
    },
}
