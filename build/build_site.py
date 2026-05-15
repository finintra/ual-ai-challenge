#!/usr/bin/env python3
"""Build the AI Challenge static site with per-day encrypted content.

Reads:
  - content/*.md (source content)
  - passwords.json (per-page passwords for the quest)
  - build/template.html, build/styles.css, build/app.js (UI shell)
  - build/submissions.py (per-day checkin form schemas + STUDENTS)
  - build/portfolio_template.html, build/portfolio_app.js (portfolio page)

Outputs:
  - dist/index.html      (single self-contained challenge UI)
  - dist/portfolio.html  (public portfolio view, reads from Supabase)

Each page is encrypted with its own password from passwords.json:
  - "main"       → overview, day-1, journal (always-accessible)
  - "day-N"      → day-N content (locked, unlocked via prior day's code)
  - "supervisor" → supervisor.md (separate access)

Environment variables (injected into app.js + portfolio_app.js):
  - SUPABASE_URL       — e.g. https://abc.supabase.co
  - SUPABASE_ANON_KEY  — public anon key
If unset, the build proceeds and the site shows a graceful "submissions
disabled" message in checkin forms.
"""
import re
import json
import base64
import os
import sys
from pathlib import Path
import markdown
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ============================================================
ITERATIONS = 200000  # PBKDF2 iterations (matches app.js)
ROOT = Path(__file__).parent.parent
CONTENT = ROOT / "content"
BUILD = ROOT / "build"
DIST = ROOT / "dist"
PASSWORDS_FILE = ROOT / "passwords.json"

# Allow importing submissions.py from the build dir
sys.path.insert(0, str(BUILD))
from submissions import SUBMISSIONS, STUDENTS  # noqa: E402
# ============================================================

# Page definitions: (id, filename, label, password_key, locked_by_default, next_code_key)
# next_code_key — passwords.json key whose value substitutes {{UNLOCK_CODE}}
# in this page's markdown. None = no substitution.
PAGES = [
    ("overview",   "overview.md",   "Огляд челенджу",        "main",       False, None),
    ("day-1",      "day-1.md",      "День 1 · Дослідження",  "main",       False, "day-2"),
    ("day-2",      "day-2.md",      "День 2 · Бренд",        "day-2",      True,  "day-3"),
    ("day-3",      "day-3.md",      "День 3 · Сайт",         "day-3",      True,  "day-4"),
    ("day-4",      "day-4.md",      "День 4 · Соцмережі",    "day-4",      True,  "day-5"),
    ("day-5",      "day-5.md",      "День 5 · AI-медіа",     "day-5",      True,  "day-6"),
    ("day-6",      "day-6.md",      "День 6 · Автоматизація","day-6",      True,  "day-7"),
    ("day-7",      "day-7.md",      "День 7 · Пітч",         "day-7",      True,  "completion"),
    ("journal",    "journal.md",    "Бортовий журнал",       "main",       False, None),
    ("supervisor", "supervisor.md", "Керівник",              "supervisor", True,  None),
]


def preprocess_md(md_text):
    """Insert blank lines before lists so markdown parser recognizes them."""
    lines = md_text.split("\n")
    out_lines = []
    for i, line in enumerate(lines):
        out_lines.append(line)
        if i + 1 < len(lines):
            nxt = lines[i + 1]
            is_current_list = bool(re.match(r"^\s*(\d+\.|-|\*)\s", line))
            is_next_list = bool(re.match(r"^\s*(\d+\.|-|\*)\s", nxt))
            if line.strip() and not is_current_list and is_next_list:
                out_lines.append("")
    return "\n".join(out_lines)


def md_to_html(md_text):
    """Convert markdown to HTML with our visual treatments."""
    md_text = preprocess_md(md_text)
    html = markdown.markdown(
        md_text,
        extensions=["extra", "smarty", "fenced_code", "tables"],
    )

    # Tag h3 sections with semantic CSS classes
    section_classes = {
        "Сцена": "scene",
        "Головна задача дня": "main-task",
        "Лекційна частина": "lecture",
        "Місія": "task",
        "Факультативні задачі": "optional",
        "Арсенал": "tools",
        "Покрокова інструкція і шаблони": "howto",
        "Здобутки дня": "output",
        "Розподіл часу": "schedule",
        "Пастки і поради": "pitfalls",
        "Debrief": "reflection",
        "Debrief (мета-рівень за всі 8 днів)": "reflection",
        "Debrief (мета-рівень за всі 7 днів)": "reflection",
    }
    for name, cls in section_classes.items():
        pattern = re.compile(r'<h3>(' + re.escape(name) + r')</h3>')
        html = pattern.sub(rf'<h3 class="section section-{cls}">\1</h3>', html)

    # Prompt template cards
    pattern_prompt = re.compile(
        r'(<p><strong>(Шаблон[^<]*)</strong></p>)\s*(<pre>(?:.*?)</pre>)',
        re.DOTALL,
    )
    def replace_prompt(m):
        return (
            f'<div class="prompt-card">'
            f'<div class="prompt-card__label">⌘ {m.group(2)}</div>'
            f'{m.group(3)}'
            f'</div>'
        )
    html = pattern_prompt.sub(replace_prompt, html)

    # Best practices cards
    pattern_bp = re.compile(
        r'<p><strong>Найкращі практики[^<]*</strong></p>\s*(<ul>(?:.*?)</ul>)',
        re.DOTALL,
    )
    def replace_bp(m):
        return (
            f'<div class="best-practices">'
            f'<div class="best-practices__label">★ найкращі практики</div>'
            f'{m.group(1)}'
            f'</div>'
        )
    html = pattern_bp.sub(replace_bp, html)

    return html


def day_hero_html(page_id, label, total_days=7):
    """Build the magazine-issue hero card injected at top of each day page.

    Replaces the page's first <h1> when present so we don't get duplicate titles.
    Returns empty string for non-day pages.
    """
    if not page_id.startswith("day-"):
        return ""
    try:
        n = int(page_id.split("-", 1)[1])
    except ValueError:
        return ""

    # label looks like "День 7 · Пітч" — extract the theme word after " · "
    parts = label.split(" · ", 1)
    theme = parts[1] if len(parts) > 1 else label

    # Progress dots: 1..total_days; current = n, done = <n, locked = >n
    dots = []
    for i in range(1, total_days + 1):
        cls = "day-hero__dot"
        if i < n:
            cls += " day-hero__dot--done"
        elif i == n:
            cls += " day-hero__dot--current"
        dots.append(f'<span class="{cls}"></span>')

    return (
        '<div class="day-hero">'
        f'<div class="day-hero__eyebrow">Випуск {n:02d} / {total_days:02d}</div>'
        f'<h1 class="day-hero__theme">{theme}</h1>'
        f'<p class="day-hero__tagline">День {n} з {total_days}</p>'
        '<div class="day-hero__progress">'
        f'<span>Прогрес</span>'
        f'<span class="day-hero__dots">{"".join(dots)}</span>'
        '</div>'
        '</div>'
    )


def html_escape(s):
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&#39;")
    )


def render_checkin_form(day_id, schema):
    """Render the per-day checkin form HTML from a schema."""
    fields_html = []
    for f in schema["fields"]:
        key = f["key"]
        label = html_escape(f["label"])
        required = "required" if f.get("required") else ""
        placeholder = html_escape(f.get("placeholder", ""))
        help_text = html_escape(f.get("help", ""))

        if f["type"] == "url":
            input_html = (
                f'<input type="url" id="{day_id}-{key}" name="{key}" '
                f'inputmode="url" autocomplete="off" '
                f'placeholder="{placeholder or "https://"}" {required}>'
            )
        elif f["type"] == "textarea":
            minlen = f.get("min_length")
            min_attr = f'minlength="{minlen}"' if minlen else ""
            input_html = (
                f'<textarea id="{day_id}-{key}" name="{key}" rows="4" '
                f'placeholder="{placeholder}" {min_attr} {required}></textarea>'
            )
        else:  # text
            input_html = (
                f'<input type="text" id="{day_id}-{key}" name="{key}" '
                f'placeholder="{placeholder}" {required}>'
            )

        help_html = f'<div class="checkin__help">{help_text}</div>' if help_text else ""
        fields_html.append(
            f'<div class="checkin__field">'
            f'<label for="{day_id}-{key}" class="checkin__label">{label}</label>'
            f'{input_html}'
            f'{help_html}'
            f'</div>'
        )

    title = html_escape(schema.get("title", "Чек-ін"))
    intro = html_escape(schema.get("intro", ""))

    return (
        f'<form class="checkin" data-day="{day_id}" novalidate>'
        f'<div class="checkin__eyebrow">Журнал · {day_id.upper()}</div>'
        f'<h2 class="checkin__title">{title}</h2>'
        f'<p class="checkin__intro">{intro}</p>'
        f'<div class="checkin__fields">{"".join(fields_html)}</div>'
        f'<div class="checkin__actions">'
        f'<button type="submit" class="checkin__submit">Записати у журнал і отримати код</button>'
        f'<p class="checkin__status" data-role="status" hidden></p>'
        f'</div>'
        f'</form>'
    )


def encrypt_content(plaintext_str, password):
    """Encrypt content with PBKDF2-derived AES-GCM key.

    Returns dict with base64-encoded salt, iv, ct (ciphertext+tag).
    """
    salt = os.urandom(16)
    iv = os.urandom(12)

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=ITERATIONS,
    )
    key = kdf.derive(password.encode("utf-8"))

    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(iv, plaintext_str.encode("utf-8"), None)

    return {
        "salt": base64.b64encode(salt).decode("ascii"),
        "iv":   base64.b64encode(iv).decode("ascii"),
        "ct":   base64.b64encode(ct).decode("ascii"),
    }


def wrap_completion_section(html, day_id):
    """Wrap the closing "Завершальний код" / "Ти досяг вершини" section in a
    hidden div that JS unhides after a successful checkin submit.
    """
    pattern = re.compile(r'(<h2>(?:Завершальний код|Ти досяг вершини)</h2>)')
    match = pattern.search(html)
    if not match:
        return html
    start = match.start()
    return (
        html[:start]
        + f'<div class="completion-code" data-day="{day_id}" hidden>'
        + html[start:]
        + '</div>'
    )


def inject_supabase_config(js_text, supabase_url, supabase_anon_key, students):
    """Replace placeholders in app.js / portfolio_app.js with config values."""
    js_text = js_text.replace("__SUPABASE_URL__", supabase_url or "")
    js_text = js_text.replace("__SUPABASE_ANON_KEY__", supabase_anon_key or "")
    js_text = js_text.replace(
        "__STUDENTS_JSON__",
        json.dumps(students, ensure_ascii=False),
    )
    return js_text


def build_portfolio_page(supabase_url, supabase_anon_key, students):
    """Generate dist/portfolio.html — public portfolio viewer."""
    tpl = (BUILD / "portfolio_template.html").read_text(encoding="utf-8")
    styles = (BUILD / "styles.css").read_text(encoding="utf-8")
    pjs = (BUILD / "portfolio_app.js").read_text(encoding="utf-8")

    pjs = inject_supabase_config(pjs, supabase_url, supabase_anon_key, students)
    # Pass submission schemas so portfolio knows field labels per day.
    pages_meta = [{"id": pid, "label": label} for pid, _, label, _, _, _ in PAGES if pid.startswith("day-")]
    pjs = pjs.replace(
        "__SUBMISSION_SCHEMAS__",
        json.dumps(SUBMISSIONS, ensure_ascii=False),
    )
    pjs = pjs.replace(
        "__PAGES_META__",
        json.dumps(pages_meta, ensure_ascii=False),
    )

    output = tpl.replace("__STYLES__", styles)
    output = output.replace("__PORTFOLIO_JS__", pjs)

    out = DIST / "portfolio.html"
    out.write_text(output, encoding="utf-8")
    size_kb = out.stat().st_size // 1024
    print(f"✓ Built {out} ({size_kb} KB)")


def main():
    # Load passwords
    if not PASSWORDS_FILE.exists():
        print(f"⚠ passwords.json not found, using passwords.example.json")
        passwords = json.loads((ROOT / "passwords.example.json").read_text(encoding="utf-8"))
    else:
        passwords = json.loads(PASSWORDS_FILE.read_text(encoding="utf-8"))

    # Read Supabase config from env (optional — site degrades gracefully)
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if supabase_url and supabase_anon_key:
        print(f"✓ Supabase: {supabase_url[:40]}…")
    else:
        print("⚠ Supabase not configured (SUPABASE_URL / SUPABASE_ANON_KEY env unset). "
              "Site builds but submissions will show an error.")

    # Build encrypted map and pages list for JS
    encrypted_map = {}
    pages_list = []

    print("Building encrypted content:")
    for page_id, fname, label, pw_key, locked, next_code_key in PAGES:
        path = CONTENT / fname
        if not path.exists():
            print(f"  ⚠ missing: {fname} (skipping)")
            continue
        md_text = path.read_text(encoding="utf-8")
        # Generic {{CODE:<key>}} substitution — used by supervisor.md and any
        # page that needs to render an arbitrary password from passwords.json.
        for k, v in passwords.items():
            md_text = md_text.replace("{{CODE:" + k + "}}", v)
        # Page-specific {{UNLOCK_CODE}} → the code that unlocks the next page
        # in the quest chain (defined by PAGES[…].next_code_key).
        if next_code_key:
            next_code = passwords.get(next_code_key)
            if not next_code:
                print(f"  ⚠ no password for '{next_code_key}' (needed by {fname}); "
                      f"leaving {{{{UNLOCK_CODE}}}} unresolved")
            else:
                md_text = md_text.replace("{{UNLOCK_CODE}}", next_code)

        # Day pages: inject checkin form HTML where {{CHECKIN_FORM}} marker sits.
        # Markdown lets raw HTML pass through, so the form survives md→html.
        if page_id in SUBMISSIONS:
            form_html = render_checkin_form(page_id, SUBMISSIONS[page_id])
            md_text = md_text.replace("{{CHECKIN_FORM}}", form_html)

        # Supervisor dashboard placeholder
        if page_id == "supervisor":
            md_text = md_text.replace(
                "{{SUPERVISOR_DASHBOARD}}",
                '<div id="supervisor-dashboard" class="supervisor-dashboard"></div>',
            )

        html = md_to_html(md_text)

        # Wrap the "Завершальний код" / "Ти досяг вершини" tail in a hidden div
        if page_id in SUBMISSIONS:
            html = wrap_completion_section(html, page_id)

        # Inject the magazine-issue hero card at the top of every day page.
        # Replaces the first <h1> so we don't render a duplicate title.
        hero = day_hero_html(page_id, label)
        if hero:
            html_with_hero, n_subs = re.subn(r"<h1>.*?</h1>", hero, html, count=1)
            html = html_with_hero if n_subs else hero + html
        password = passwords.get(pw_key)
        if not password:
            print(f"  ⚠ no password for key '{pw_key}', skipping {fname}")
            continue
        encrypted_map[page_id] = encrypt_content(html, password)
        pages_list.append({
            "id": page_id,
            "label": label,
            "locked_by_default": locked,
        })
        size_kb = len(html) // 1024
        print(f"  ✓ {fname} → {page_id} (key: {pw_key}, {size_kb} KB plaintext)")

    # Master codes bundle: page_id → password, encrypted with supervisor password.
    # Lets supervisor unlock everything in one login instead of per-page code entry.
    master_codes = None
    sup_password = passwords.get("supervisor")
    if sup_password:
        page_creds = {}
        for page_id, _, _, pw_key, _, _ in PAGES:
            page_pw = passwords.get(pw_key)
            if page_pw and page_id in encrypted_map:
                page_creds[page_id] = page_pw
        if page_creds:
            master_codes = encrypt_content(json.dumps(page_creds), sup_password)
            print(f"  ✓ master_codes blob ({len(page_creds)} entries, encrypted with supervisor key)")

    # Bundle JSON
    data_json = json.dumps({
        "pages": pages_list,
        "encrypted": encrypted_map,
        "master_codes": master_codes,
    }, ensure_ascii=False, separators=(",", ":"))

    # Read template parts
    template = (BUILD / "template.html").read_text(encoding="utf-8")
    styles = (BUILD / "styles.css").read_text(encoding="utf-8")
    app_js = (BUILD / "app.js").read_text(encoding="utf-8")

    # Inject Supabase + students into app.js
    app_js = inject_supabase_config(app_js, supabase_url, supabase_anon_key, STUDENTS)

    # Inject
    output = template.replace("__STYLES__", styles)
    output = output.replace("__APP_JS__", app_js)
    output = output.replace("__ENCRYPTED_DATA__", data_json)

    # Write
    DIST.mkdir(exist_ok=True)
    out_path = DIST / "index.html"
    out_path.write_text(output, encoding="utf-8")

    size_kb = out_path.stat().st_size // 1024
    print(f"\n✓ Built {out_path} ({size_kb} KB)")
    print(f"  Pages: {len(pages_list)}")
    print(f"  Main password: '{passwords.get('main', '(not set)')}'")

    # Portfolio page (separate output)
    build_portfolio_page(supabase_url, supabase_anon_key, STUDENTS)


if __name__ == "__main__":
    main()
