(function() {
  'use strict';

  // ===========================================================
  // Build-time config
  // ===========================================================
  const SUPABASE_URL = '__SUPABASE_URL__';
  const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';
  const STUDENTS = __STUDENTS_JSON__;
  const SCHEMAS = __SUBMISSION_SCHEMAS__;   // { "day-1": {title, intro, fields:[...]}, ... }
  const PAGES_META = __PAGES_META__;        // [{id, label}, ...]
  const READY = !!(SUPABASE_URL && SUPABASE_ANON_KEY
    && !SUPABASE_URL.startsWith('__') && !SUPABASE_ANON_KEY.startsWith('__'));

  const root = document.getElementById('portfolio-root');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function getStudentSlug() {
    const params = new URLSearchParams(location.search);
    return params.get('student');
  }

  function renderEmpty(slug) {
    root.innerHTML = `
      <div class="portfolio__empty">
        <div class="portfolio__eyebrow">Portfolio</div>
        <h1>Студента «${escapeHtml(slug || '?')}» не знайдено</h1>
        <p>Перевір посилання. Очікуваний формат:<br><code>portfolio.html?student=oleksiy</code></p>
        <p>Доступні слаги: ${STUDENTS.map(s => `<code>${escapeHtml(s.slug)}</code>`).join(', ')}</p>
      </div>
    `;
  }

  function renderError(message) {
    root.innerHTML = `<div class="portfolio__empty"><h1>Помилка</h1><p>${escapeHtml(message)}</p></div>`;
  }

  function dayTheme(dayId) {
    const m = (PAGES_META.find(p => p.id === dayId) || {}).label;
    if (!m) return '';
    const parts = m.split(' · ');
    return parts.length > 1 ? parts[1] : m;
  }

  function fieldLabel(dayId, key) {
    const schema = SCHEMAS[dayId];
    if (!schema) return key;
    const f = schema.fields.find(x => x.key === key);
    return f ? f.label : key;
  }

  function fieldType(dayId, key) {
    const schema = SCHEMAS[dayId];
    if (!schema) return 'text';
    const f = schema.fields.find(x => x.key === key);
    return f ? f.type : 'text';
  }

  function renderValue(dayId, key, value) {
    if (value == null || value === '') return '<span class="portfolio__missing">—</span>';
    const t = fieldType(dayId, key);
    if (t === 'url') {
      const safe = escapeHtml(value);
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe} ↗</a>`;
    }
    // textarea / text: preserve newlines
    return `<div class="portfolio__text">${escapeHtml(value).replace(/\n/g, '<br>')}</div>`;
  }

  function renderDayCard(dayId, row) {
    const num = dayId.replace('day-', '').padStart(2, '0');
    const theme = dayTheme(dayId);
    const schema = SCHEMAS[dayId];

    if (!row) {
      return `
        <article class="portfolio-day portfolio-day--missing">
          <div class="portfolio-day__head">
            <div class="portfolio-day__num">DAY ${num}</div>
            <h2 class="portfolio-day__theme">${escapeHtml(theme)}</h2>
            <div class="portfolio-day__status">Ще не пройдено</div>
          </div>
        </article>
      `;
    }

    const payload = row.payload || {};
    const fieldOrder = schema ? schema.fields.map(f => f.key) : Object.keys(payload);
    const fieldsHtml = fieldOrder.map(key => {
      if (!(key in payload)) return '';
      return `
        <div class="portfolio-day__field">
          <div class="portfolio-day__label">${escapeHtml(fieldLabel(dayId, key))}</div>
          <div class="portfolio-day__value">${renderValue(dayId, key, payload[key])}</div>
        </div>
      `;
    }).join('');

    const stamp = new Date(row.updated_at).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' });

    return `
      <article class="portfolio-day">
        <div class="portfolio-day__head">
          <div class="portfolio-day__num">DAY ${num}</div>
          <h2 class="portfolio-day__theme">${escapeHtml(theme)}</h2>
          <div class="portfolio-day__status portfolio-day__status--done">Здано · ${escapeHtml(stamp)}</div>
        </div>
        <div class="portfolio-day__body">${fieldsHtml}</div>
      </article>
    `;
  }

  async function loadPortfolio(slug) {
    if (!READY) {
      renderError("Supabase не налаштовано — портфоліо порожнє. Зв'яжись з керівником.");
      return;
    }
    const student = STUDENTS.find(s => s.slug === slug);
    if (!student) {
      renderEmpty(slug);
      return;
    }

    try {
      const url = `${SUPABASE_URL}/rest/v1/submissions`
        + `?student_slug=eq.${encodeURIComponent(slug)}`
        + `&select=*&order=day_id.asc`;
      const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (!res.ok) {
        renderError(`Не вдалось завантажити (${res.status}).`);
        return;
      }
      const rows = await res.json();
      const byDay = {};
      rows.forEach(r => { byDay[r.day_id] = r; });

      const dayIds = PAGES_META.filter(p => p.id.startsWith('day-')).map(p => p.id);
      const submittedCount = dayIds.filter(d => byDay[d]).length;

      const daysHtml = dayIds.map(d => renderDayCard(d, byDay[d])).join('');

      root.innerHTML = `
        <header class="portfolio__head" style="--accent: ${escapeHtml(student.color)}">
          <div class="portfolio__eyebrow">PORTFOLIO · AI CHALLENGE 2026</div>
          <h1 class="portfolio__title">${escapeHtml(student.name)}</h1>
          <p class="portfolio__subtitle">7-денний AI-челендж · УАЛ × 2026 · травень 2026</p>
          <div class="portfolio__progress">
            <strong>${submittedCount} / 7</strong>
            <span>днів здано у журнал</span>
          </div>
        </header>
        <main class="portfolio__main">${daysHtml}</main>
        <footer class="portfolio__foot">
          AI Challenge · УАЛ-Ужгород · ${new Date().getFullYear()}
        </footer>
      `;
      document.title = `${student.name} · Portfolio · AI Challenge`;
    } catch (e) {
      renderError(`Мережева помилка: ${e.message}`);
    }
  }

  const slug = getStudentSlug();
  if (!slug) {
    renderEmpty('');
  } else {
    loadPortfolio(slug);
  }

})();
