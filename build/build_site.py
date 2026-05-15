#!/usr/bin/env python3
"""Build the AI Challenge static site with per-day encrypted content.

Reads:
  - content/*.md (source content)
  - passwords.json (per-page passwords for the quest)
  - build/template.html, build/styles.css, build/app.js (UI shell)

Outputs:
  - dist/index.html (single self-contained file)

Each page is encrypted with its own password from passwords.json:
  - "main"      → overview, day-1, journal (always-accessible)
  - "day-N"     → day-N content (locked, unlocked via prior day's code)
  - "supervisor" → supervisor.md (separate access)
"""
import re
import json
import base64
import os
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


def main():
    # Load passwords
    if not PASSWORDS_FILE.exists():
        print(f"⚠ passwords.json not found, using passwords.example.json")
        passwords = json.loads((ROOT / "passwords.example.json").read_text(encoding="utf-8"))
    else:
        passwords = json.loads(PASSWORDS_FILE.read_text(encoding="utf-8"))

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
        html = md_to_html(md_text)
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

    # Bundle JSON
    data_json = json.dumps({
        "pages": pages_list,
        "encrypted": encrypted_map,
    }, ensure_ascii=False, separators=(",", ":"))

    # Read template parts
    template = (BUILD / "template.html").read_text(encoding="utf-8")
    styles = (BUILD / "styles.css").read_text(encoding="utf-8")
    app_js = (BUILD / "app.js").read_text(encoding="utf-8")

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


if __name__ == "__main__":
    main()
