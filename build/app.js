(function() {
  'use strict';

  // ===========================================================
  // Build-time config (substituted by build_site.py)
  // ===========================================================
  const SUPABASE_URL = '__SUPABASE_URL__';
  const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';
  const STUDENTS = __STUDENTS_JSON__;
  const SUPABASE_READY = !!(SUPABASE_URL && SUPABASE_ANON_KEY
    && !SUPABASE_URL.startsWith('__') && !SUPABASE_ANON_KEY.startsWith('__'));

  // ===========================================================
  // Encrypted data is embedded in <script id="encrypted-data">
  // Structure: { pages, encrypted, master_codes }
  // ===========================================================
  const DATA = JSON.parse(document.getElementById('encrypted-data').textContent);
  const PAGES = DATA.pages; // Ordered list of {id, label, locked_by_default}
  const ENC = DATA.encrypted; // {id: {salt, iv, ct}}

  // Cache decrypted content per session
  const decryptedCache = {};
  // Store password (key derivation material) per page in sessionStorage
  // Format: stored_passwords = {pageId: password}
  let storedPasswords = {};
  try {
    storedPasswords = JSON.parse(sessionStorage.getItem('cp') || '{}');
  } catch(e) { storedPasswords = {}; }

  // Track unlocked days in localStorage (persistent across sessions)
  let unlockedDays = [];
  try {
    unlockedDays = JSON.parse(localStorage.getItem('unlocked') || '[]');
  } catch(e) { unlockedDays = []; }

  // Track which days have been checked in (submitted to Supabase)
  // localStorage cache so we don't refetch on every render
  let submittedDays = [];
  try {
    submittedDays = JSON.parse(localStorage.getItem('submitted') || '[]');
  } catch(e) { submittedDays = []; }

  // Selected student identity (slug)
  let studentSlug = localStorage.getItem('student_slug') || null;
  // Supervisor login skips the picker (set during attemptLogin)
  let isSupervisor = false;

  // ===========================================================
  // Crypto helpers (Web Crypto API)
  // ===========================================================
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(password, saltBytes) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 200000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false, ['decrypt']
    );
  }

  async function tryDecryptBlob(entry, password) {
    if (!entry) return null;
    try {
      const salt = base64ToBytes(entry.salt);
      const iv = base64ToBytes(entry.iv);
      const ct = base64ToBytes(entry.ct);
      const key = await deriveKey(password, salt);
      const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
      return new TextDecoder().decode(ptBuf);
    } catch (e) {
      return null;
    }
  }

  async function tryDecrypt(pageId, password) {
    return tryDecryptBlob(ENC[pageId], password);
  }

  // ===========================================================
  // Login screen
  // ===========================================================
  const loginEl = document.getElementById('login');
  const pickerEl = document.getElementById('studentPicker');
  const appEl = document.getElementById('app');
  const loginForm = document.getElementById('loginForm');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');

  async function attemptLogin(password) {
    // Main password should unlock pages with "locked_by_default: false"
    const baseUnlocks = PAGES.filter(p => !p.locked_by_default).map(p => p.id);
    if (baseUnlocks.length > 0) {
      const testId = baseUnlocks[0];
      const decrypted = await tryDecrypt(testId, password);
      if (decrypted) {
        baseUnlocks.forEach(id => { storedPasswords[id] = password; });
        decryptedCache[testId] = decrypted;
        baseUnlocks.forEach(id => {
          if (!unlockedDays.includes(id)) unlockedDays.push(id);
        });
        persistState();
        return 'student';
      }
    }
    // Supervisor login unlocks the supervisor page AND every other page,
    // by decrypting the master_codes blob (page_id → page password)
    // that was bundled at build time with the supervisor password.
    const supId = 'supervisor';
    if (ENC[supId]) {
      const sup = await tryDecrypt(supId, password);
      if (sup) {
        storedPasswords[supId] = password;
        decryptedCache[supId] = sup;
        if (!unlockedDays.includes(supId)) unlockedDays.push(supId);

        if (DATA.master_codes) {
          const masterJson = await tryDecryptBlob(DATA.master_codes, password);
          if (masterJson) {
            try {
              const creds = JSON.parse(masterJson);
              for (const pid in creds) {
                if (!Object.prototype.hasOwnProperty.call(creds, pid)) continue;
                storedPasswords[pid] = creds[pid];
                if (!unlockedDays.includes(pid)) unlockedDays.push(pid);
              }
            } catch (e) { /* leave supervisor-only access */ }
          }
        }

        persistState();
        return 'supervisor';
      }
    }
    return null;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = passwordInput.value.trim();
    if (!pw) return;
    const btn = loginForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Перевіряю...';
    const role = await attemptLogin(pw);
    btn.disabled = false;
    btn.textContent = 'Увійти';
    if (role === 'supervisor') {
      isSupervisor = true;
      localStorage.setItem('is_supervisor', '1');
      enterApp();
    } else if (role === 'student') {
      isSupervisor = false;
      localStorage.removeItem('is_supervisor');
      // After main-password login, ask which student is sitting at the keyboard
      if (!studentSlug || !STUDENTS.find(s => s.slug === studentSlug)) {
        showStudentPicker();
      } else {
        enterApp();
      }
    } else {
      loginError.hidden = false;
      passwordInput.select();
    }
  });

  // ===========================================================
  // Student picker
  // ===========================================================
  function showStudentPicker() {
    loginEl.hidden = true;
    pickerEl.hidden = false;
    const options = document.getElementById('studentPickerOptions');
    options.innerHTML = '';
    STUDENTS.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'picker__option';
      btn.style.setProperty('--accent', s.color);
      btn.innerHTML = `
        <span class="picker__option-mono">Це я</span>
        <span class="picker__option-name">${escapeHtml(s.name)}</span>
        <span class="picker__option-slug">${escapeHtml(s.slug)}</span>
      `;
      btn.addEventListener('click', () => {
        studentSlug = s.slug;
        localStorage.setItem('student_slug', s.slug);
        pickerEl.hidden = true;
        enterApp();
      });
      options.appendChild(btn);
    });
  }

  function enterApp() {
    loginEl.hidden = true;
    pickerEl.hidden = true;
    appEl.hidden = false;
    renderStudentBadge();
    renderNav();
    // Navigate to first unlocked page (or page from URL hash)
    const hash = location.hash.slice(1);
    const target = hash && unlockedDays.includes(hash) ? hash : (unlockedDays[0] || PAGES[0].id);
    navigate(target);
  }

  function renderStudentBadge() {
    const badge = document.getElementById('studentBadge');
    if (isSupervisor) {
      badge.hidden = false;
      badge.innerHTML = `<span class="student-badge__mono">РЕЖИМ</span><span class="student-badge__name">Керівник</span>`;
      return;
    }
    if (!studentSlug) { badge.hidden = true; return; }
    const s = STUDENTS.find(x => x.slug === studentSlug);
    if (!s) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.style.setProperty('--accent', s.color);
    badge.innerHTML = `<span class="student-badge__mono">Підписано як</span><span class="student-badge__name">${escapeHtml(s.name)}</span>`;
  }

  // ===========================================================
  // Logout
  // ===========================================================
  document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem('cp');
    storedPasswords = {};
    Object.keys(decryptedCache).forEach(k => delete decryptedCache[k]);
    // We intentionally keep student_slug + unlocked + submitted in localStorage —
    // they're not credentials, they're "this is my workbook" state.
    location.reload();
  });

  function persistState() {
    sessionStorage.setItem('cp', JSON.stringify(storedPasswords));
    localStorage.setItem('unlocked', JSON.stringify(unlockedDays));
    localStorage.setItem('submitted', JSON.stringify(submittedDays));
  }

  // ===========================================================
  // Sidebar nav
  // ===========================================================
  const navEl = document.getElementById('nav');
  let currentPage = null;

  function renderNav() {
    navEl.innerHTML = '';

    // Partition pages into 3 groups:
    //   start   — overview, journal (locked_by_default: false)
    //   days    — day-1 … day-7 (id starts with "day-")
    //   internal — supervisor (and anything else)
    const start = [];
    const days = [];
    const internal = [];
    PAGES.forEach(p => {
      if (p.id.startsWith('day-')) days.push(p);
      else if (p.id === 'supervisor') internal.push(p);
      else start.push(p);
    });

    if (start.length) navEl.appendChild(renderGroup('Старт', start.map(renderPlainItem)));
    if (days.length) navEl.appendChild(renderGroup('7 днів', days.map(renderDayRow)));
    // Only show supervisor link if we're actually logged in as supervisor
    if (internal.length && (isSupervisor || localStorage.getItem('is_supervisor') === '1')) {
      navEl.appendChild(renderGroup('Внутрішнє', internal.map(renderPlainItem)));
    }
  }

  function renderGroup(label, items) {
    const group = document.createElement('div');
    group.className = 'nav__group';
    if (label) {
      const lbl = document.createElement('div');
      lbl.className = 'nav__group-label';
      lbl.textContent = label;
      group.appendChild(lbl);
    }
    items.forEach(el => group.appendChild(el));
    return group;
  }

  function renderPlainItem(p) {
    const btn = document.createElement('button');
    btn.className = 'nav__item';
    const isUnlocked = unlockedDays.includes(p.id);
    if (!isUnlocked) btn.classList.add('nav__item--locked');
    if (p.id === currentPage) btn.classList.add('nav__item--active');
    btn.dataset.pageId = p.id;
    btn.innerHTML = `<span class="nav__label">${escapeHtml(p.label)}</span>${!isUnlocked ? '<span class="nav__lock">○</span>' : ''}`;
    btn.addEventListener('click', () => navigate(p.id));
    return btn;
  }

  function renderDayRow(p) {
    // Parse "День N · Theme" → number + theme
    const m = p.label.match(/^День\s+(\d+)\s*·\s*(.+)$/);
    const num = m ? m[1].padStart(2, '0') : '';
    const theme = m ? m[2] : p.label;

    const isUnlocked = unlockedDays.includes(p.id);
    const isCurrent = p.id === currentPage;
    const isLocked = !isUnlocked;
    const isSubmitted = submittedDays.includes(p.id);
    // "Done" means: unlocked AND submitted AND not the currently-viewed day
    const isDone = isUnlocked && isSubmitted && !isCurrent;

    const btn = document.createElement('button');
    btn.className = 'day-row';
    if (isDone)    btn.classList.add('day-row--done');
    if (isCurrent) btn.classList.add('day-row--current');
    if (isLocked)  btn.classList.add('day-row--locked');
    if (isSubmitted && !isCurrent) btn.classList.add('day-row--submitted');
    btn.dataset.pageId = p.id;

    let stateGlyph;
    if (isLocked) stateGlyph = '○';
    else if (isCurrent) stateGlyph = '◉';
    else if (isSubmitted) stateGlyph = '✓';
    else stateGlyph = '●';

    btn.innerHTML = `
      <span class="day-row__state">${stateGlyph}</span>
      <span class="day-row__num">DAY ${escapeHtml(num)}</span>
      <span class="day-row__theme">${escapeHtml(theme)}</span>
    `;
    btn.addEventListener('click', () => navigate(p.id));
    return btn;
  }

  // ===========================================================
  // Page rendering / navigation
  // ===========================================================
  const contentEl = document.getElementById('content');
  const unlockPanel = document.getElementById('unlockPanel');

  async function navigate(pageId) {
    currentPage = pageId;
    location.hash = pageId;
    renderNav();
    const isUnlocked = unlockedDays.includes(pageId);
    if (isUnlocked) {
      await renderPage(pageId);
    } else {
      contentEl.innerHTML = '';
      showUnlockPanel(pageId);
    }
    window.scrollTo(0, 0);
  }

  async function renderPage(pageId) {
    unlockPanel.hidden = true;
    let html = decryptedCache[pageId];
    if (!html) {
      const password = storedPasswords[pageId];
      if (!password) {
        contentEl.innerHTML = '<p>Помилка: пароль для цієї сторінки не знайдено. Спробуй вийти і увійти знову.</p>';
        return;
      }
      contentEl.innerHTML = '<p style="color:var(--text-muted)">Розкодовую...</p>';
      const decrypted = await tryDecrypt(pageId, password);
      if (decrypted) {
        decryptedCache[pageId] = decrypted;
        html = decrypted;
      } else {
        contentEl.innerHTML = '<p>Помилка декрипту. Спробуй вийти і увійти знову.</p>';
        return;
      }
    }
    contentEl.innerHTML = html;

    // Wire up checkin form if present
    const form = contentEl.querySelector('form.checkin');
    if (form) wireCheckinForm(form);

    // If already submitted, reveal completion-code immediately
    if (submittedDays.includes(pageId)) {
      revealCompletion(pageId);
      if (form) lockCheckinForm(form, 'Вже здано — можеш доповнити і зберегти ще раз.');
      await hydrateCheckinForm(form, pageId);
    } else if (form && SUPABASE_READY && studentSlug) {
      // Even if not in local cache, check Supabase — maybe submitted from another device
      await hydrateCheckinForm(form, pageId, /* autoReveal */ true);
    }

    // Supervisor dashboard injection point
    if (pageId === 'supervisor') {
      const slot = contentEl.querySelector('#supervisor-dashboard');
      if (slot) renderSupervisorDashboard(slot);
    }
  }

  function showUnlockPanel(pageId) {
    unlockPanel.hidden = false;
    document.getElementById('unlockInput').value = '';
    document.getElementById('unlockInput').focus();
    document.getElementById('unlockError').hidden = true;
    const hintEl = document.getElementById('unlockHint');
    if (pageId === 'supervisor') {
      hintEl.textContent = 'Цей розділ призначено лише для керівника челенджу. Введи supervisor-пароль.';
      return;
    }
    const prevDay = findPreviousDay(pageId);
    if (prevDay) {
      hintEl.textContent = `Завершальний код для розблокування — у самому низу сторінки "${prevDay.label}", але тільки після того, як ти здаси здобутки попереднього дня у журнал.`;
    } else {
      hintEl.textContent = 'Щоб відкрити, введи завершальний код з попереднього дня.';
    }
  }

  function findPreviousDay(pageId) {
    const idx = PAGES.findIndex(p => p.id === pageId);
    if (idx <= 0) return null;
    return PAGES[idx - 1];
  }

  // ===========================================================
  // Unlock form
  // ===========================================================
  const unlockForm = document.getElementById('unlockForm');
  const unlockInput = document.getElementById('unlockInput');
  const unlockError = document.getElementById('unlockError');

  unlockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = unlockInput.value.trim();
    if (!code) return;
    const btn = unlockForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Перевіряю...';
    const decrypted = await tryDecrypt(currentPage, code);
    btn.disabled = false;
    btn.textContent = 'Розблокувати';
    if (decrypted) {
      decryptedCache[currentPage] = decrypted;
      storedPasswords[currentPage] = code;
      if (!unlockedDays.includes(currentPage)) {
        unlockedDays.push(currentPage);
      }
      persistState();
      renderNav();
      await renderPage(currentPage);
    } else {
      unlockError.hidden = false;
      unlockInput.select();
    }
  });

  // ===========================================================
  // Checkin form (per-day submission gate)
  // ===========================================================
  function wireCheckinForm(form) {
    const dayId = form.dataset.day;
    const statusEl = form.querySelector('[data-role="status"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Native HTML5 validation
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      if (!SUPABASE_READY) {
        showStatus(statusEl, 'error', 'Журнал не налаштовано — зв\'яжись з керівником (SUPABASE_URL / SUPABASE_ANON_KEY).');
        return;
      }
      if (!studentSlug && !isSupervisor) {
        showStatus(statusEl, 'error', 'Не визначено, хто здає. Перезавантаж сторінку.');
        return;
      }
      if (isSupervisor) {
        showStatus(statusEl, 'error', 'Керівник не здає журнал. Увійди як студент.');
        return;
      }

      const payload = {};
      new FormData(form).forEach((v, k) => {
        payload[k] = (typeof v === 'string') ? v.trim() : v;
      });

      const submitBtn = form.querySelector('.checkin__submit');
      submitBtn.disabled = true;
      const origText = submitBtn.textContent;
      submitBtn.textContent = 'Зберігаю у журнал...';
      showStatus(statusEl, 'pending', 'Відправляю у журнал…');

      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer': 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            student_slug: studentSlug,
            day_id: dayId,
            payload: payload,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          showStatus(statusEl, 'error', `Не вдалось зберегти (${res.status}). ${text || 'Спробуй ще раз.'}`);
          submitBtn.disabled = false;
          submitBtn.textContent = origText;
          return;
        }

        // Mark as submitted, reveal completion, lock the form
        if (!submittedDays.includes(dayId)) submittedDays.push(dayId);
        persistState();
        revealCompletion(dayId);
        lockCheckinForm(form, '✓ Записано у журнал. Можеш повернутись пізніше і доповнити — натисни «Зберегти ще раз».');
        renderNav();
        // Smooth scroll to the just-revealed completion block
        const completion = contentEl.querySelector(`.completion-code[data-day="${dayId}"]`);
        if (completion) completion.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        showStatus(statusEl, 'error', `Помилка мережі: ${err.message}. Перевір з'єднання.`);
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }
    });
  }

  function lockCheckinForm(form, message) {
    form.classList.add('checkin--submitted');
    const submitBtn = form.querySelector('.checkin__submit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Зберегти ще раз';
    const statusEl = form.querySelector('[data-role="status"]');
    if (message) showStatus(statusEl, 'success', message);
  }

  function showStatus(el, kind, text) {
    if (!el) return;
    el.hidden = false;
    el.dataset.kind = kind;
    el.textContent = text;
  }

  function revealCompletion(dayId) {
    const block = contentEl.querySelector(`.completion-code[data-day="${dayId}"]`);
    if (block) block.hidden = false;
  }

  async function hydrateCheckinForm(form, dayId, autoReveal) {
    if (!form || !SUPABASE_READY || !studentSlug) return;
    try {
      const url = `${SUPABASE_URL}/rest/v1/submissions`
        + `?student_slug=eq.${encodeURIComponent(studentSlug)}`
        + `&day_id=eq.${encodeURIComponent(dayId)}`
        + `&select=payload,updated_at`;
      const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (!res.ok) return;
      const rows = await res.json();
      if (!rows.length) return;
      const payload = rows[0].payload || {};
      Object.entries(payload).forEach(([k, v]) => {
        const input = form.querySelector(`[name="${CSS.escape(k)}"]`);
        if (input) input.value = v;
      });
      if (!submittedDays.includes(dayId)) {
        submittedDays.push(dayId);
        persistState();
        renderNav();
      }
      if (autoReveal) {
        revealCompletion(dayId);
        lockCheckinForm(form, '✓ Цей день вже здано раніше. Поля заповнено з журналу.');
      }
    } catch (e) { /* ignore — best-effort */ }
  }

  // ===========================================================
  // Supervisor dashboard
  // ===========================================================
  async function renderSupervisorDashboard(slot) {
    if (!SUPABASE_READY) {
      slot.innerHTML = '<p class="supervisor-dashboard__warn">Supabase не налаштовано — дашборд порожній.</p>';
      return;
    }
    slot.innerHTML = '<p style="color:var(--text-muted)">Завантажую submissions…</p>';
    try {
      const url = `${SUPABASE_URL}/rest/v1/submissions?select=*&order=updated_at.desc`;
      const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (!res.ok) {
        slot.innerHTML = `<p class="supervisor-dashboard__warn">Не вдалось завантажити (${res.status}).</p>`;
        return;
      }
      const rows = await res.json();
      const dayIds = PAGES.filter(p => p.id.startsWith('day-')).map(p => p.id);

      // Group by student_slug
      const grouped = {};
      STUDENTS.forEach(s => { grouped[s.slug] = {}; });
      rows.forEach(r => {
        if (!grouped[r.student_slug]) grouped[r.student_slug] = {};
        grouped[r.student_slug][r.day_id] = r;
      });

      let html = '<table class="supervisor-table"><thead><tr><th>Студент</th>';
      dayIds.forEach(d => { html += `<th>${escapeHtml(d.replace('day-', 'D'))}</th>`; });
      html += '<th>Портфоліо</th></tr></thead><tbody>';

      STUDENTS.forEach(s => {
        html += `<tr><td><strong>${escapeHtml(s.name)}</strong><br><span class="supervisor-table__slug">${escapeHtml(s.slug)}</span></td>`;
        dayIds.forEach(d => {
          const row = grouped[s.slug] && grouped[s.slug][d];
          if (row) {
            const dt = new Date(row.updated_at);
            const stamp = dt.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
            html += `<td class="cell--done"><button class="cell-btn" data-student="${escapeHtml(s.slug)}" data-day="${escapeHtml(d)}">✓<span class="cell-stamp">${escapeHtml(stamp)}</span></button></td>`;
          } else {
            html += `<td class="cell--empty">○</td>`;
          }
        });
        html += `<td><a class="supervisor-table__portfolio" href="portfolio.html?student=${encodeURIComponent(s.slug)}" target="_blank">портфоліо ↗</a></td>`;
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '<div id="supervisorDetail" class="supervisor-detail" hidden></div>';
      slot.innerHTML = html;

      // Wire up cell clicks to show submission payload
      slot.querySelectorAll('.cell-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const slug = btn.dataset.student;
          const dayId = btn.dataset.day;
          const row = grouped[slug] && grouped[slug][dayId];
          const detail = slot.querySelector('#supervisorDetail');
          if (!row || !detail) return;
          detail.hidden = false;
          const student = STUDENTS.find(s => s.slug === slug);
          let payloadHtml = '';
          for (const [k, v] of Object.entries(row.payload || {})) {
            const isUrl = typeof v === 'string' && /^https?:\/\//i.test(v);
            const valueHtml = isUrl
              ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener">${escapeHtml(v)}</a>`
              : `<span>${escapeHtml(String(v)).replace(/\n/g, '<br>')}</span>`;
            payloadHtml += `<div class="supervisor-detail__row"><div class="supervisor-detail__key">${escapeHtml(k)}</div><div class="supervisor-detail__val">${valueHtml}</div></div>`;
          }
          detail.innerHTML = `
            <div class="supervisor-detail__head">
              <h3>${escapeHtml(student ? student.name : slug)} · ${escapeHtml(dayId)}</h3>
              <div class="supervisor-detail__meta">${escapeHtml(new Date(row.updated_at).toLocaleString('uk-UA'))}</div>
            </div>
            <div class="supervisor-detail__body">${payloadHtml}</div>
          `;
          detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    } catch (e) {
      slot.innerHTML = `<p class="supervisor-dashboard__warn">Помилка: ${escapeHtml(e.message)}</p>`;
    }
  }

  // ===========================================================
  // Utilities
  // ===========================================================
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ===========================================================
  // Auto-login if we have stored password for any page
  // ===========================================================
  (async function init() {
    isSupervisor = localStorage.getItem('is_supervisor') === '1';
    const hasStored = Object.keys(storedPasswords).length > 0;
    if (hasStored && unlockedDays.length > 0) {
      const firstId = unlockedDays[0];
      const pw = storedPasswords[firstId];
      if (pw) {
        const ok = await tryDecrypt(firstId, pw);
        if (ok) {
          decryptedCache[firstId] = ok;
          if (!isSupervisor && (!studentSlug || !STUDENTS.find(s => s.slug === studentSlug))) {
            showStudentPicker();
            return;
          }
          enterApp();
          return;
        }
      }
    }
  })();

  window.addEventListener('hashchange', () => {
    if (appEl.hidden) return;
    const target = location.hash.slice(1);
    if (target && target !== currentPage) {
      navigate(target);
    }
  });

})();
