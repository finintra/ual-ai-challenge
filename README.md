# AI Challenge · 7 днів

7-денний AI-челендж для студентів УАЛ-Ужгород, як закритий веб-сайт з квест-механікою.

## Швидкий старт

```bash
# Установи залежності (одноразово)
pip install markdown cryptography playwright
playwright install chromium

# Створи свій passwords.json
cp passwords.example.json passwords.json
# Відредагуй паролі під свої

# Збери сайт
python3 build/build_site.py

# Локальний preview
cd dist && python3 -m http.server 8000
# Відкрий http://localhost:8000 → введи main-пароль

# Деплой
git add -A && git commit -m "update content" && git push
# GitHub Actions автоматично оновить site
```

## Структура файлів

- `content/` — markdown-джерело всіх сторінок (редагуй тут)
- `build/` — Python-скрипти білда + HTML/CSS/JS шаблон
- `passwords.json` — твої паролі (НЕ в git)
- `dist/` — згенерований `index.html` (НЕ в git, автодеплой через CI)

## Як квест працює

1. Учасник заходить на URL → форма пароля
2. Вводить **main** пароль (від керівника) → розблоковує Overview + Day 1 + Бортовий журнал
3. Читає Day 1 → у кінці бачить "Завершальний код" (значення з `passwords.json`)
4. Йде на Day 2, який заблокований → вводить цей код → розблоковує
5. ...і так далі до Day 7
6. Day 7 завершується фінальним кодом (з ключа `completion` у `passwords.json`) — мітка про пройдений челендж

`supervisor` має окремий пароль і бачить усі коди у `supervisor.md`.

## Зміна контенту

Редагуй markdown у `content/`. Перебудуй: `python3 build/build_site.py`.

## Деплой

Push у `main` → GitHub Actions запускає білд → деплой на GitHub Pages.

URL: `https://[user].github.io/[repo]`

## Детально — у [CLAUDE.md](./CLAUDE.md)
