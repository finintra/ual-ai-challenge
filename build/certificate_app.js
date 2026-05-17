(function() {
  'use strict';

  // ===========================================================
  // Build-time substituted
  // ===========================================================
  const SUPABASE_URL = '__SUPABASE_URL__';
  const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';
  const STUDENTS = __STUDENTS_JSON__;
  const SUPABASE_READY = !!(SUPABASE_URL && SUPABASE_ANON_KEY
    && !SUPABASE_URL.startsWith('__') && !SUPABASE_ANON_KEY.startsWith('__'));

  // ===========================================================
  // Inline UAL SVGs into placeholders
  // ===========================================================
  function injectSVG(targetId, sourceId) {
    const src = document.getElementById(sourceId);
    const dst = document.getElementById(targetId);
    if (src && dst) dst.innerHTML = src.textContent;
  }
  injectSVG('ualWordmark', 'ualWordmarkSvg');
  injectSVG('ualShield', 'ualShieldSvg');

  // ===========================================================
  // URL params
  // ===========================================================
  const params = new URLSearchParams(location.search);
  const studentSlug = params.get('student');
  const stateEl = document.getElementById('certState');
  const certEl = document.getElementById('certificate');

  function showError(msg) {
    stateEl.innerHTML = '<p class="cert-error">' + msg + '</p>';
  }

  if (!studentSlug) {
    showError(
      'Потрібен параметр <code>?student=&lt;slug&gt;</code> у URL. ' +
      'Приклади: <a href="?student=oleksiy">?student=oleksiy</a>, ' +
      '<a href="?student=andriy">?student=andriy</a>.'
    );
    return;
  }

  // ===========================================================
  // Fetch helpers
  // ===========================================================
  function supaHeaders() {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
    };
  }

  async function fetchStudent(slug) {
    if (!SUPABASE_READY) return null;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/students?slug=eq.' + encodeURIComponent(slug) + '&select=*',
        { headers: supaHeaders() }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      const r = rows[0];
      if (!r) return null;
      // Compose full name: "Імʼя Прізвище". last_name added in schema v3.2.
      const fullName = [r.name, r.last_name].filter(Boolean).join(' ').trim();
      return Object.assign({}, r, { fullName: fullName || r.name });
    } catch (e) { return null; }
  }

  async function fetchDay7Submission(slug) {
    if (!SUPABASE_READY) return null;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/submissions'
          + '?student_slug=eq.' + encodeURIComponent(slug)
          + '&day_id=eq.day-7&select=*',
        { headers: supaHeaders() }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      return rows[0] || null;
    } catch (e) { return null; }
  }

  // ===========================================================
  // Render
  // ===========================================================
  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('uk-UA', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch (e) { return iso; }
  }

  function renderCertificate(name, dateIso, portfolioUrl) {
    document.getElementById('certStudentName').textContent = name;
    document.getElementById('certDate').textContent = formatDate(dateIso) || formatDate(new Date().toISOString());
    const a = document.getElementById('portfolioUrl');
    if (portfolioUrl) {
      // Display without protocol prefix for cleaner look
      const display = portfolioUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      a.textContent = display;
      a.href = portfolioUrl;
    } else {
      a.textContent = '(посилання буде доступним після здачі Day 7)';
      a.removeAttribute('href');
      a.classList.add('certificate__portfolio-url--missing');
    }

    stateEl.hidden = true;
    certEl.hidden = false;
    document.title = 'Сертифікат · ' + name + ' · УАЛ × AI Challenge 2026';
  }

  // ===========================================================
  // Init
  // ===========================================================
  (async function init() {
    // Try Supabase students table first; fallback to embedded list
    let student = await fetchStudent(studentSlug);
    if (!student) {
      student = STUDENTS.find(s => s.slug === studentSlug) || null;
    }
    if (!student) {
      showError(
        'Студента з slug «' + studentSlug + '» не знайдено. ' +
        'Перевір параметр у URL.'
      );
      return;
    }

    const sub = await fetchDay7Submission(studentSlug);
    let portfolioUrl = null;
    let dateIso = null;
    if (sub) {
      const payload = sub.payload || {};
      portfolioUrl = payload.personal_portfolio_url || payload.portfolio_master_url || null;
      dateIso = sub.updated_at || sub.submitted_at || null;
    }
    // Use full name (first + last) if available; fall back to just first name
    const displayName = student.fullName || student.name;
    renderCertificate(displayName, dateIso, portfolioUrl);
  })();

  // ===========================================================
  // Download button → window.print()
  // ===========================================================
  const downloadBtn = document.getElementById('downloadBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      window.print();
    });
  }

})();
