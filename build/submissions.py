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
      - help       : optional one-line note shown below the input

URLs are validated as http(s) by HTML5 type=url. Textareas use minlength.
The build script renders one <form> per day from this dict.
"""

STUDENTS = [
    {"slug": "oleksiy", "name": "Олексій", "color": "#FF5A3D"},
    {"slug": "andriy",  "name": "Андрій",  "color": "#F5C24A"},
]


SUBMISSIONS = {
    "day-1": {
        "title": "Чек-ін: дослідження",
        "intro": "Здай артефакти Дня 1 — після цього отримаєш код для розблокування Дня 2.",
        "fields": [
            {"key": "claude_project_ual_url", "label": "URL твого Claude Project (УАЛ)", "type": "url", "required": True, "placeholder": "https://claude.ai/project/..."},
            {"key": "claude_project_personal_url", "label": "URL твого Claude Project (особистий трек)", "type": "url", "required": True},
            {"key": "interview_doc_url", "label": "Транскрипт або конспект інтерв'ю з Анною", "type": "url", "required": True, "help": "Google Doc з ключовими цитатами"},
            {"key": "ual_brief_url", "label": "УАЛ-бриф (3-4 сторінки, Google Doc)", "type": "url", "required": True},
            {"key": "personal_brief_url", "label": "Особистий бриф (3-4 сторінки, Google Doc)", "type": "url", "required": True},
            {"key": "naming_doc_url", "label": "Документ з варіантами назв (3-5 шт, з перевіркою домена)", "type": "url", "required": True},
            {"key": "research_tools_note_url", "label": "Нотатка «Claude Research vs Perplexity vs Gemini»", "type": "url", "required": True, "help": "1 сторінка з власних висновків"},
            {"key": "open_questions", "label": "Список відкритих питань після інтерв'ю", "type": "textarea", "required": True, "min_length": 120, "help": "Твоя дорожня карта подальшого ресерчу"},
            {"key": "biggest_insight", "label": "Найнесподіваніший інсайт дня (один абзац)", "type": "textarea", "required": True, "min_length": 120},
        ],
    },

    "day-2": {
        "title": "Чек-ін: бренд",
        "intro": "Здай артефакти Дня 2 — після цього отримаєш код для розблокування Дня 3.",
        "fields": [
            {"key": "ual_brand_pdf_url", "label": "Brand Guidelines PDF — УАЛ", "type": "url", "required": True, "help": "1-2 сторінки: лого, палітра, шрифти, mood board"},
            {"key": "personal_brand_pdf_url", "label": "Brand Guidelines PDF — особистий трек", "type": "url", "required": True},
            {"key": "ual_logo_files_url", "label": "Лого УАЛ (Google Drive: PNG + SVG)", "type": "url", "required": True},
            {"key": "personal_logo_files_url", "label": "Лого особисте (Google Drive: PNG + SVG)", "type": "url", "required": True},
            {"key": "ual_mockup_url", "label": "UI-мокап головної сторінки — УАЛ", "type": "url", "required": True},
            {"key": "personal_mockup_url", "label": "UI-мокап головної сторінки — особисте", "type": "url", "required": True},
            {"key": "image_gen_note_url", "label": "Нотатка «Який image gen для якої задачі»", "type": "url", "required": True},
            {"key": "biggest_insight", "label": "Який інструмент дав найкращий лого і чому? (абзац)", "type": "textarea", "required": True, "min_length": 120},
        ],
    },

    "day-3": {
        "title": "Чек-ін: сайт",
        "intro": "Здай артефакти Дня 3 — після цього отримаєш код для розблокування Дня 4.",
        "fields": [
            {"key": "ual_site_url", "label": "Жива URL сайту — УАЛ", "type": "url", "required": True, "help": "Відкривається на телефоні і десктопі"},
            {"key": "personal_site_url", "label": "Жива URL сайту — особисте", "type": "url", "required": True},
            {"key": "ual_lighthouse_url", "label": "Скрін Lighthouse — УАЛ", "type": "url", "required": True, "help": "Бажано 80+ за всіма параметрами"},
            {"key": "personal_lighthouse_url", "label": "Скрін Lighthouse — особисте", "type": "url", "required": True},
            {"key": "builder_comparison_url", "label": "Документ «Lovable vs Claude Code vs Jules»", "type": "url", "required": True, "help": "1 сторінка з власних висновків"},
            {"key": "biggest_insight", "label": "Який тип сайту для якого інструмента? (правило, абзац)", "type": "textarea", "required": True, "min_length": 120},
        ],
    },

    "day-4": {
        "title": "Чек-ін: соцмережі",
        "intro": "Здай артефакти Дня 4 — після цього отримаєш код для розблокування Дня 5.",
        "fields": [
            {"key": "ual_social_accounts", "label": "Посилання на акаунти УАЛ-треку (1 URL у рядку, мін. 2 платформи)", "type": "textarea", "required": True, "min_length": 30, "help": "Facebook, IG, LinkedIn, TikTok — як домовились"},
            {"key": "personal_social_accounts", "label": "Посилання на акаунти особистого треку", "type": "textarea", "required": True, "min_length": 30},
            {"key": "ual_tov_url", "label": "Tone of voice документ — УАЛ", "type": "url", "required": True},
            {"key": "personal_tov_url", "label": "Tone of voice документ — особисте", "type": "url", "required": True},
            {"key": "content_plan_url", "label": "Контент-план на 2 тижні (Sheets / Notion)", "type": "url", "required": True},
            {"key": "ual_posts_drive_url", "label": "Drive з 10-14 готовими постами — УАЛ", "type": "url", "required": True},
            {"key": "personal_posts_drive_url", "label": "Drive з 10-14 готовими постами — особисте", "type": "url", "required": True},
            {"key": "adaptation_doc_url", "label": "Документ «Один меседж — три платформи»", "type": "url", "required": True},
            {"key": "biggest_insight", "label": "Де AI-копірайт «горить» і що рятує? (абзац)", "type": "textarea", "required": True, "min_length": 120},
        ],
    },

    "day-5": {
        "title": "Чек-ін: AI-медіа",
        "intro": "Здай артефакти Дня 5 — після цього отримаєш код для розблокування Дня 6.",
        "fields": [
            {"key": "ual_video_url", "label": "Промо-ролик УАЛ (16:9, 30-60 сек, MP4)", "type": "url", "required": True, "help": "Drive / YouTube unlisted"},
            {"key": "personal_video_url", "label": "Промо-ролик особистий (9:16, 30-60 сек, MP4)", "type": "url", "required": True},
            {"key": "storyboards_url", "label": "Storyboards (папка з обома)", "type": "url", "required": True},
            {"key": "voiceover_files_url", "label": "Voiceover-аудіо (папка)", "type": "url", "required": True},
            {"key": "transcripts_url", "label": "Транскрипти voiceover-ів (текст)", "type": "url", "required": True},
            {"key": "biggest_insight", "label": "Який крок pipeline-у виявився найскладнішим? (абзац)", "type": "textarea", "required": True, "min_length": 120},
        ],
    },

    "day-6": {
        "title": "Чек-ін: автоматизація",
        "intro": "Здай артефакти Дня 6 — після цього отримаєш код для розблокування Дня 7.",
        "fields": [
            {"key": "n8n_workflow_url", "label": "n8n workflow JSON (Drive)", "type": "url", "required": True, "help": "Експортований, можна імпортувати в інший n8n"},
            {"key": "workflow_demo_url", "label": "Скріни або відео роботи workflow", "type": "url", "required": True},
            {"key": "claude_code_doc_url", "label": "Документація Claude Code-задачі (команда, що зробив, що отримав)", "type": "url", "required": True},
            {"key": "automation_ideas_url", "label": "Документ «Як я автоматизую свою рутину» (3-5 ідей)", "type": "url", "required": True},
            {"key": "biggest_insight", "label": "Де у твоєму житті автоматизація зекономила б 1+ год/тижд? (абзац)", "type": "textarea", "required": True, "min_length": 120},
        ],
    },

    "day-7": {
        "title": "Чек-ін: пітч і фінальне портфоліо",
        "intro": "Здай фінальні артефакти — після цього отримаєш код «вершина».",
        "fields": [
            {"key": "ual_deck_url", "label": "Pitch deck УАЛ (Gamma / PDF)", "type": "url", "required": True},
            {"key": "personal_deck_url", "label": "Pitch deck особистий (Gamma / PDF)", "type": "url", "required": True},
            {"key": "ual_loom_url", "label": "Loom-запис 5 хв — УАЛ", "type": "url", "required": True},
            {"key": "personal_loom_url", "label": "Loom-запис 5 хв — особисте", "type": "url", "required": True},
            {"key": "portfolio_master_url", "label": "Portfolio Master Document (Notion / Google Doc)", "type": "url", "required": True, "help": "Зібрані посилання на всі результати усіх 7 днів"},
            {"key": "final_reflection", "label": "Фінальна рефлексія (1-2 сторінки тексту)", "type": "textarea", "required": True, "min_length": 600, "help": "Що 3 інструменти залишаються назавжди? Що змінилось у розумінні професії?"},
        ],
    },
}
