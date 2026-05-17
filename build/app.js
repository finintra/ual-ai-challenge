(function() {
  'use strict';

  // ===========================================================
  // Build-time config (substituted by build_site.py)
  // ===========================================================
  const SUPABASE_URL = '__SUPABASE_URL__';
  const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';
  // Build-time embedded students — used as seed if Supabase has none
  // and as fallback when Supabase is unavailable. Mutable at runtime
  // because we replace it with the live list after a successful fetch.
  let STUDENTS = __STUDENTS_JSON__;
  const SUBMISSION_SCHEMAS = __SUBMISSION_SCHEMAS__;
  const SUPABASE_READY = !!(SUPABASE_URL && SUPABASE_ANON_KEY
    && !SUPABASE_URL.startsWith('__') && !SUPABASE_ANON_KEY.startsWith('__'));

  // ===========================================================
  // Supabase REST helpers (students table)
  // ===========================================================
  function supaHeaders(extra) {
    const h = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    };
    if (extra) Object.assign(h, extra);
    return h;
  }

  async function fetchStudents() {
    if (!SUPABASE_READY) return null;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/students?select=*&order=created_at.asc',
        { headers: supaHeaders() }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      // Normalize: rename DB color → in-memory color (already same key); ensure shape
      return rows.map(r => ({
        slug: r.slug,
        name: r.name,
        last_name: r.last_name || '',
        color: r.color || '#FF5A3D',
        unlock_blob: r.unlock_blob || null,
      }));
    } catch (e) {
      return null;
    }
  }

  async function refreshStudents() {
    const live = await fetchStudents();
    if (live && live.length) {
      STUDENTS = live;
      renderStudentBadge();
    }
    return STUDENTS;
  }

  // ===========================================================
  // Theme toggle — initial value already applied in <head> to avoid FOUC.
  // Here we just wire up the buttons and persist user choice.
  // ===========================================================
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) {}
    syncThemeToggle(t);
  }
  function syncThemeToggle(t) {
    document.querySelectorAll('.theme-toggle__btn').forEach(function(btn) {
      btn.setAttribute('aria-pressed', btn.dataset.setTheme === t ? 'true' : 'false');
    });
  }
  document.querySelectorAll('.theme-toggle__btn').forEach(function(btn) {
    btn.addEventListener('click', function() { setTheme(btn.dataset.setTheme); });
  });
  syncThemeToggle(document.documentElement.getAttribute('data-theme') || 'light');

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

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function deriveKey(password, saltBytes, usages) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 200000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false, usages || ['decrypt']
    );
  }

  async function tryDecryptBlob(entry, password) {
    if (!entry) return null;
    try {
      const salt = base64ToBytes(entry.salt);
      const iv = base64ToBytes(entry.iv);
      const ct = base64ToBytes(entry.ct);
      const key = await deriveKey(password, salt, ['decrypt']);
      const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
      return new TextDecoder().decode(ptBuf);
    } catch (e) {
      return null;
    }
  }

  async function encryptBlob(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ['encrypt']);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      new TextEncoder().encode(plaintext)
    );
    return {
      salt: bytesToBase64(salt),
      iv:   bytesToBase64(iv),
      ct:   bytesToBase64(new Uint8Array(ct)),
    };
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

  // Try each student's unlock_blob with the typed password. A successful
  // decrypt yields the recovered `main` password and the student's slug.
  // Returns { slug, mainPwd } or null.
  async function tryStudentLogin(password) {
    if (!SUPABASE_READY) return null;
    const live = await fetchStudents();
    if (!live || !live.length) return null;
    // Update in-memory roster while we're here
    STUDENTS = live;
    for (const s of live) {
      if (!s.unlock_blob) continue;
      const recovered = await tryDecryptBlob(s.unlock_blob, password);
      if (recovered) return { slug: s.slug, mainPwd: recovered };
    }
    return null;
  }

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
    // Personal student password: try each unlock_blob from Supabase.
    // On success, the recovered main pwd unlocks base pages and we
    // remember which student typed it (slug auto-picked, no picker).
    const personal = await tryStudentLogin(password);
    if (personal) {
      studentSlug = personal.slug;
      localStorage.setItem('student_slug', personal.slug);
      const mainPwd = personal.mainPwd;
      for (const id of baseUnlocks) {
        const decrypted = await tryDecrypt(id, mainPwd);
        if (decrypted) {
          storedPasswords[id] = mainPwd;
          decryptedCache[id] = decrypted;
          if (!unlockedDays.includes(id)) unlockedDays.push(id);
        }
      }
      persistState();
      return 'student-personal';
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
    } else if (role === 'student-personal') {
      isSupervisor = false;
      localStorage.removeItem('is_supervisor');
      // Slug was already set by tryStudentLogin — go straight in.
      enterApp();
    } else {
      loginError.hidden = false;
      passwordInput.select();
    }
  });

  // ===========================================================
  // Student picker
  // ===========================================================
  async function showStudentPicker() {
    loginEl.hidden = true;
    pickerEl.hidden = false;
    const options = document.getElementById('studentPickerOptions');
    options.innerHTML = '<p class="picker__loading">Завантажую список…</p>';
    await refreshStudents();
    options.innerHTML = '';
    STUDENTS.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'picker__option';
      btn.style.setProperty('--accent', s.color);
      const fullName = s.last_name ? (s.name + ' ' + s.last_name) : s.name;
      btn.innerHTML = `
        <span class="picker__option-mono">Це я</span>
        <span class="picker__option-name">${escapeHtml(fullName)}</span>
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

    // Drop stale unlocked entries that no longer have a stored password —
    // they survive in localStorage across logouts and were the source of
    // "пароль для цієї сторінки не знайдено" errors. Day pages that user
    // wants again can be reopened via the unlock panel (secret phrase).
    unlockedDays = unlockedDays.filter(id =>
      storedPasswords[id] || decryptedCache[id]
    );
    persistState();

    renderStudentBadge();
    renderNav();
    // Background refresh — keeps badge name in sync if admin renamed us
    refreshStudents().then(() => {
      renderStudentBadge();
      // If our slug got removed from the registry, drop local identity
      if (studentSlug && !STUDENTS.find(s => s.slug === studentSlug) && !isSupervisor) {
        localStorage.removeItem('student_slug');
      }
    });
    navigate(pickInitialTarget());
  }

  function pickInitialTarget() {
    // 1. URL hash if explicitly opened and unlocked
    const hash = location.hash.slice(1);
    if (hash && unlockedDays.includes(hash)) return hash;
    // 2. Highest unlocked day-N
    const dayIds = unlockedDays
      .filter(id => /^day-\d+$/.test(id))
      .sort((a, b) => parseInt(b.split('-')[1], 10) - parseInt(a.split('-')[1], 10));
    if (dayIds.length) return dayIds[0];
    // 3. Overview by default
    if (PAGES.find(p => p.id === 'overview')) return 'overview';
    return PAGES[0].id;
  }

  function renderStudentBadge() {
    const badge = document.getElementById('studentBadge');
    if (isSupervisor) {
      badge.hidden = false;
      badge.innerHTML = `<span class="student-badge__mono">РЕЖИМ</span><span class="student-badge__name">Адміністрування</span>`;
      return;
    }
    if (!studentSlug) { badge.hidden = true; return; }
    const s = STUDENTS.find(x => x.slug === studentSlug);
    if (!s) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.style.setProperty('--accent', s.color);
    badge.innerHTML = `<span class="student-badge__mono">Привіт</span><span class="student-badge__name">${escapeHtml(s.name)}</span>`;
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

  // ===========================================================
  // Mobile sidebar drawer
  // ===========================================================
  const sidebarEl = document.getElementById('sidebar');
  const backdropEl = document.getElementById('sidebarBackdrop');
  const menuBtn = document.getElementById('mobileMenuBtn');

  function setSidebarOpen(open) {
    if (!sidebarEl || !backdropEl || !menuBtn) return;
    sidebarEl.classList.toggle('is-open', open);
    backdropEl.classList.toggle('is-visible', open);
    backdropEl.hidden = !open;
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  if (menuBtn) menuBtn.addEventListener('click', () => {
    setSidebarOpen(!sidebarEl.classList.contains('is-open'));
  });
  if (backdropEl) backdropEl.addEventListener('click', () => setSidebarOpen(false));
  // Esc closes the drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebarEl && sidebarEl.classList.contains('is-open')) {
      setSidebarOpen(false);
    }
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

    // Supervisor sees the admin section first — it's the primary work surface.
    const showAdmin = internal.length && (isSupervisor || localStorage.getItem('is_supervisor') === '1');
    if (showAdmin) {
      navEl.appendChild(renderGroup('Адміністрування', internal.map(renderPlainItem)));
    }
    if (start.length) navEl.appendChild(renderGroup('Старт', start.map(renderPlainItem)));
    if (days.length) navEl.appendChild(renderGroup('7 днів', days.map(renderDayRow)));
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
    // On mobile, close the drawer after picking a page
    setSidebarOpen(false);
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
        // Stale unlock from a past session — degrade to "locked" view so
        // the user gets a friendly prompt instead of a cryptic error.
        unlockedDays = unlockedDays.filter(x => x !== pageId);
        persistState();
        renderNav();
        contentEl.innerHTML = '';
        showUnlockPanel(pageId);
        return;
      }
      contentEl.innerHTML = '<p style="color:var(--text-muted)">Розкодовую...</p>';
      const decrypted = await tryDecrypt(pageId, password);
      if (decrypted) {
        decryptedCache[pageId] = decrypted;
        html = decrypted;
      } else {
        contentEl.innerHTML = '<p>Не вдалось розкодувати сторінку. Перелогінься і спробуй знову.</p>';
        return;
      }
    }
    contentEl.innerHTML = html;

    // Highlight active day-nav item as user scrolls between blocks
    wireDayNav(contentEl);

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
      const studentsSlot = contentEl.querySelector('#students-admin');
      if (studentsSlot) renderStudentsAdmin(studentsSlot);
    }
  }

  let dayNavObserver = null;
  function wireDayNav(root) {
    if (dayNavObserver) { dayNavObserver.disconnect(); dayNavObserver = null; }
    const nav = root.querySelector('.day-nav');
    if (!nav) return;
    const items = Array.from(nav.querySelectorAll('.day-nav__item'));
    if (!items.length) return;
    const blocks = items
      .map(it => document.getElementById(it.dataset.target))
      .filter(Boolean);
    if (!blocks.length) return;

    // Smooth scroll with sticky-nav offset
    items.forEach(it => {
      it.addEventListener('click', (e) => {
        e.preventDefault();
        const tgt = document.getElementById(it.dataset.target);
        if (!tgt) return;
        const rect = tgt.getBoundingClientRect();
        const top = window.scrollY + rect.top - 16;
        window.scrollTo({ top, behavior: 'smooth' });
        history.replaceState(null, '', '#' + it.dataset.target);
      });
    });

    const setActive = (id) => {
      items.forEach(it => it.classList.toggle('is-active', it.dataset.target === id));
    };
    setActive(blocks[0].id);

    dayNavObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '-80px 0px -60% 0px', threshold: 0 });
    blocks.forEach(b => dayNavObserver.observe(b));
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
      hintEl.textContent = `Цю інформацію відкривати ще зарано. Секретне гасло для розблокування — у самому низу сторінки "${prevDay.label}", але тільки після того, як ти здаси здобутки попереднього дня у журнал.`;
    } else {
      hintEl.textContent = 'Цю інформацію відкривати ще зарано. Щоб відкрити, введи секретне гасло з попереднього дня.';
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
    if (block) {
      block.hidden = false;
      // For day-7 — also append a button to open the personal certificate
      // (UAL-branded PDF), once we know the student's slug. Idempotent:
      // checks for existing button before appending.
      if (dayId === 'day-7' && studentSlug && !block.querySelector('.completion-code__certificate')) {
        const wrap = document.createElement('div');
        wrap.className = 'completion-code__certificate';
        wrap.innerHTML = `
          <hr class="completion-code__divider">
          <h3 class="completion-code__cert-title">🏆 Твій сертифікат готовий</h3>
          <p class="completion-code__cert-text">
            УАЛ-брендований PDF-сертифікат із твоїм іменем, датою завершення
            і посиланням на твоє портфоліо. Покажеш роботодавцю, додаси у LinkedIn,
            повісиш на стіну — твій вибір.
          </p>
          <a class="completion-code__cert-link" href="certificate.html?student=${encodeURIComponent(studentSlug)}" target="_blank" rel="noopener">
            Відкрити сертифікат →
          </a>
        `;
        block.appendChild(wrap);
      }
    }
  }

  async function hydrateCheckinForm(form, dayId, autoReveal) {
    if (!form || !SUPABASE_READY || !studentSlug) return;
    try {
      const url = `${SUPABASE_URL}/rest/v1/submissions`
        + `?student_slug=eq.${encodeURIComponent(studentSlug)}`
        + `&day_id=eq.${encodeURIComponent(dayId)}`
        + `&select=payload,updated_at,review_notes,review_status,reviewed_at`;
      const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (!res.ok) return;
      const rows = await res.json();
      if (!rows.length) return;
      const row = rows[0];
      const payload = row.payload || {};
      Object.entries(payload).forEach(([k, v]) => {
        const input = form.querySelector(`[name="${CSS.escape(k)}"]`);
        if (input) input.value = v;
      });
      renderReviewFeedback(form, row);
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

  // Show supervisor feedback inside the student's submitted form:
  //  - banner on top with overall status + general note
  //  - per-field comment block under each field input
  function renderReviewFeedback(form, row) {
    if (!form) return;
    const notes = row.review_notes || {};
    const status = row.review_status || 'pending';
    const generalNote = (notes._general || '').trim();
    const reviewedAt = row.reviewed_at;

    // Top banner — only render when supervisor actually reviewed (status != pending
    // or general note exists, or any per-field note exists)
    const hasFieldNotes = Object.keys(notes).some(k => k !== '_general' && (notes[k] || '').trim());
    const reviewed = status !== 'pending' || generalNote || hasFieldNotes;

    // Clean previous render (safe to call repeatedly)
    form.querySelectorAll('.review-banner, .checkin__review-note').forEach(n => n.remove());

    if (reviewed) {
      const banner = document.createElement('div');
      banner.className = `review-banner review-banner--${status}`;
      const statusLabel = {
        approved: '✓ Прийнято',
        needs_revision: '⟳ Потрібно доопрацювати',
        pending: 'На перевірці',
      }[status] || status;
      const stamp = reviewedAt
        ? new Date(reviewedAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })
        : '';
      banner.innerHTML = `
        <div class="review-banner__head">
          <span class="review-banner__status">${escapeHtml(statusLabel)}</span>
          ${stamp ? `<span class="review-banner__stamp">${escapeHtml(stamp)}</span>` : ''}
        </div>
        ${generalNote ? `<div class="review-banner__note">${escapeHtml(generalNote).replace(/\n/g,'<br>')}</div>` : ''}
      `;
      // Insert right after intro
      const intro = form.querySelector('.checkin__intro');
      if (intro && intro.nextSibling) intro.parentNode.insertBefore(banner, intro.nextSibling);
      else form.insertBefore(banner, form.firstChild);
    }

    // Per-field comments
    form.querySelectorAll('.checkin__field').forEach(fieldEl => {
      const key = fieldEl.dataset.fieldKey;
      if (!key) return;
      const note = (notes[key] || '').trim();
      if (!note) return;
      const block = document.createElement('div');
      block.className = 'checkin__review-note';
      block.innerHTML = `
        <div class="checkin__review-note__label">Коментар керівника</div>
        <div class="checkin__review-note__body">${escapeHtml(note).replace(/\n/g,'<br>')}</div>
      `;
      fieldEl.appendChild(block);
    });
  }

  // ===========================================================
  // Supervisor dashboard
  // Layout:
  //   [overview matrix — клікабельна, скрол до картки]
  //   [filter chips: status × student]
  //   [submission cards — accordion]
  //     ▾ Олексій · День 1 · Дослідження  [status badge] [updated_at]
  //     │ status selector + general comment
  //     │ field row | value | comment textarea
  //     │ ...
  //     │ [Save review]
  // ===========================================================
  const STATUS_LABELS = {
    pending: 'На перевірці',
    approved: '✓ Прийнято',
    needs_revision: '⟳ Потребує доопрацювання',
  };
  let supervisorState = {
    rows: [],         // raw submission rows from Supabase
    filterStatus: 'all',
    filterStudent: 'all',
    openCardId: null, // submission id that's currently expanded
  };

  // ===========================================================
  // Supervisor: students admin (CRUD на public.students)
  // ===========================================================
  // Return the live `main` password the supervisor has in this session,
  // or null if not available. Pulled from storedPasswords for any page
  // whose pw_key in PAGES is 'main' (overview/day-1/journal).
  function getMainPasswordFromSession() {
    const mainBackedPages = ['overview', 'day-1', 'journal'];
    for (const id of mainBackedPages) {
      if (storedPasswords[id]) return storedPasswords[id];
    }
    return null;
  }

  function studentsAdminMarkup() {
    const rows = STUDENTS.map(s => {
      const hasPwd = !!s.unlock_blob;
      const pwdLabel = hasPwd ? '✓ встановлений' : '— не встановлений';
      const pwdCls = hasPwd ? 'students-admin__pwd-on' : 'students-admin__pwd-off';
      return `
      <tr data-slug="${escapeHtml(s.slug)}">
        <td>
          <input class="students-admin__input" data-field="name"
                 type="text" value="${escapeHtml(s.name)}" placeholder="Імʼя" />
        </td>
        <td>
          <input class="students-admin__input" data-field="last_name"
                 type="text" value="${escapeHtml(s.last_name || '')}" placeholder="Прізвище" />
        </td>
        <td>
          <code class="students-admin__slug">${escapeHtml(s.slug)}</code>
        </td>
        <td>
          <span class="${pwdCls}">${pwdLabel}</span>
        </td>
        <td class="students-admin__actions">
          <button type="button" class="students-admin__icon" data-action="save"
                  title="Зберегти зміни" aria-label="Зберегти">✓</button>
          <button type="button" class="students-admin__icon" data-action="set-pwd"
                  title="Встановити або змінити секретне гасло" aria-label="Пароль">🔑</button>
          <button type="button" class="students-admin__icon students-admin__icon--danger"
                  data-action="delete" title="Видалити студента" aria-label="Видалити">🗑</button>
        </td>
      </tr>
    `;
    }).join('');
    return `
      <div class="students-admin__head">
        <h3 class="students-admin__title">Студенти челенджу</h3>
        <p class="students-admin__intro">
          Імʼя і Прізвище — окремі поля, бо такими і потраплять у сертифікат
          в кінці челенджу. Slug — внутрішній ідентифікатор для URL портфоліо
          (<code>portfolio.html?student=&lt;slug&gt;</code>) і submissions,
          міняти не можна. <b>Секретне гасло</b> — особистий код для логіну
          (зберігається лише як AES-blob, plaintext у Supabase не записується).
        </p>
      </div>
      <table class="students-admin__table">
        <thead>
          <tr>
            <th>Імʼя</th>
            <th>Прізвище</th>
            <th>Slug</th>
            <th>Гасло</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" class="students-admin__empty">Поки нікого. Додай нижче.</td></tr>'}</tbody>
      </table>
      <div class="students-admin__add">
        <h4 class="students-admin__subhead">Додати студента</h4>
        <div class="students-admin__add-row">
          <input class="students-admin__input" data-add="name" type="text"
                 placeholder="Імʼя (напр. Олексій)" />
          <input class="students-admin__input" data-add="last_name" type="text"
                 placeholder="Прізвище (напр. Іваненко)" />
          <input class="students-admin__input" data-add="slug" type="text"
                 placeholder="slug (latin, напр. oleksiy)" autocomplete="off" />
          <input class="students-admin__input" data-add="pwd" type="text"
                 placeholder="секретне гасло (опц.)" autocomplete="off" />
          <button type="button" class="students-admin__btn students-admin__btn--primary"
                  data-add-submit>Додати</button>
        </div>
        <p class="students-admin__status" data-role="add-status" hidden></p>
      </div>
    `;
  }

  function renderStudentsAdmin(slot) {
    if (!SUPABASE_READY) {
      slot.innerHTML = '<p class="supervisor-dashboard__warn">Supabase не налаштовано — реєстр студентів недоступний.</p>';
      return;
    }
    slot.innerHTML = '<p style="color:var(--text-muted)">Завантажую…</p>';
    refreshStudents().then(() => {
      slot.innerHTML = studentsAdminMarkup();
      wireStudentsAdmin(slot);
    });
  }

  async function setStudentPassword(slug, personalPwd) {
    const mainPwd = getMainPasswordFromSession();
    if (!mainPwd) {
      alert('Не знайдено main-пароль у поточній сесії. Перелогінься як supervisor і спробуй знову.');
      return false;
    }
    const blob = await encryptBlob(mainPwd, personalPwd);
    return updateStudent(slug, { unlock_blob: blob });
  }

  function wireStudentsAdmin(slot) {
    // Per-row save / delete / pwd
    slot.querySelectorAll('tr[data-slug]').forEach(tr => {
      const slug = tr.dataset.slug;
      tr.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const name = tr.querySelector('[data-field="name"]').value.trim();
        const last_name = tr.querySelector('[data-field="last_name"]').value.trim();
        if (!name) return;
        const btn = tr.querySelector('[data-action="save"]');
        btn.disabled = true; btn.textContent = '…';
        const ok = await updateStudent(slug, { name, last_name });
        btn.textContent = ok ? '✓' : '⚠';
        await refreshStudents();
        renderStudentsAdmin(slot);
      });
      tr.querySelector('[data-action="set-pwd"]').addEventListener('click', async () => {
        const pwd = prompt('Нове секретне гасло для "' + slug + '" (мін. 4 символи). Студент логінитиметься ним замість спільного.');
        if (pwd === null) return;
        if (pwd.length < 4) { alert('Мін. 4 символи'); return; }
        const btn = tr.querySelector('[data-action="set-pwd"]');
        btn.disabled = true; btn.textContent = '…';
        const ok = await setStudentPassword(slug, pwd);
        btn.textContent = ok ? '✓' : '⚠';
        if (ok) alert('Секретне гасло для "' + slug + '" встановлено. Передай його студенту.');
        await refreshStudents();
        renderStudentsAdmin(slot);
      });
      tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm('Видалити студента "' + slug + '"? Submissions його залишаться, але без імені у picker-і.')) return;
        const ok = await deleteStudent(slug);
        if (!ok) { alert('Не вдалось видалити'); return; }
        await refreshStudents();
        renderStudentsAdmin(slot);
      });
    });
    // Add new
    const addBtn = slot.querySelector('[data-add-submit]');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        const name = slot.querySelector('[data-add="name"]').value.trim();
        const last_name = slot.querySelector('[data-add="last_name"]').value.trim();
        const slug = slot.querySelector('[data-add="slug"]').value.trim().toLowerCase();
        const pwd = slot.querySelector('[data-add="pwd"]').value;
        const status = slot.querySelector('[data-role="add-status"]');
        const showStatus = (msg, ok) => {
          status.textContent = msg;
          status.hidden = false;
          status.dataset.ok = ok ? '1' : '0';
        };
        if (!name || !slug) { showStatus('Заповни імʼя і slug', false); return; }
        if (!/^[a-z0-9-]+$/.test(slug)) { showStatus('Slug — лише latin, цифри і "-"', false); return; }
        if (pwd && pwd.length < 4) { showStatus('Секретне гасло — мін. 4 символи (або лиши порожнім)', false); return; }
        addBtn.disabled = true;
        let rec = { slug, name, last_name };
        if (pwd) {
          const mainPwd = getMainPasswordFromSession();
          if (!mainPwd) {
            addBtn.disabled = false;
            showStatus('Немає main-пароля в сесії — перелогінься як supervisor', false);
            return;
          }
          rec.unlock_blob = await encryptBlob(mainPwd, pwd);
        }
        const ok = await insertStudent(rec);
        addBtn.disabled = false;
        if (!ok) { showStatus('Не вдалось додати (можливо slug вже існує)', false); return; }
        showStatus(pwd ? 'Додано. Передай студенту пароль для логіну.' : 'Додано', true);
        await refreshStudents();
        renderStudentsAdmin(slot);
      });
    }
  }

  async function insertStudent(rec) {
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/students', {
        method: 'POST',
        headers: supaHeaders({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify(rec),
      });
      return res.ok;
    } catch (e) { return false; }
  }
  async function updateStudent(slug, patch) {
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/students?slug=eq.' + encodeURIComponent(slug),
        {
          method: 'PATCH',
          headers: supaHeaders({ 'Prefer': 'return=minimal' }),
          body: JSON.stringify(patch),
        }
      );
      return res.ok;
    } catch (e) { return false; }
  }
  async function deleteStudent(slug) {
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/students?slug=eq.' + encodeURIComponent(slug),
        { method: 'DELETE', headers: supaHeaders() }
      );
      return res.ok;
    } catch (e) { return false; }
  }

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
      supervisorState.rows = await res.json();
      renderSupervisorView(slot);
    } catch (e) {
      slot.innerHTML = `<p class="supervisor-dashboard__warn">Помилка: ${escapeHtml(e.message)}</p>`;
    }
  }

  function renderSupervisorView(slot) {
    const dayIds = PAGES.filter(p => p.id.startsWith('day-')).map(p => p.id);
    const rows = supervisorState.rows;

    // Group by student → day for the matrix
    const grouped = {};
    STUDENTS.forEach(s => { grouped[s.slug] = {}; });
    rows.forEach(r => {
      if (!grouped[r.student_slug]) grouped[r.student_slug] = {};
      grouped[r.student_slug][r.day_id] = r;
    });

    // === Top: overview matrix (click cell → expand that card) ===
    let matrix = '<table class="supervisor-table"><thead><tr><th>Студент</th>';
    dayIds.forEach(d => { matrix += `<th>${escapeHtml(d.replace('day-', 'D'))}</th>`; });
    matrix += '<th>Портфоліо</th></tr></thead><tbody>';
    STUDENTS.forEach(s => {
      matrix += `<tr><td><strong>${escapeHtml(s.name)}</strong><br><span class="supervisor-table__slug">${escapeHtml(s.slug)}</span></td>`;
      dayIds.forEach(d => {
        const row = grouped[s.slug] && grouped[s.slug][d];
        if (row) {
          const status = row.review_status || 'pending';
          const glyph = status === 'approved' ? '✓' : (status === 'needs_revision' ? '⟳' : '●');
          matrix += `<td class="cell--${status}"><button class="cell-btn cell-btn--${status}" data-submission-id="${escapeHtml(row.id)}">${glyph}</button></td>`;
        } else {
          matrix += `<td class="cell--empty">○</td>`;
        }
      });
      matrix += `<td><a class="supervisor-table__portfolio" href="portfolio.html?student=${encodeURIComponent(s.slug)}" target="_blank">портфоліо ↗</a></td>`;
      matrix += '</tr>';
    });
    matrix += '</tbody></table>';

    // === Filters ===
    const statusCounts = { all: rows.length, pending: 0, approved: 0, needs_revision: 0 };
    rows.forEach(r => { statusCounts[r.review_status || 'pending']++; });
    const filterChip = (key, label, count, group, current) => {
      const active = current === key ? ' supervisor-filter__chip--active' : '';
      return `<button class="supervisor-filter__chip${active}" data-group="${group}" data-value="${key}">${escapeHtml(label)} <span class="supervisor-filter__count">${count}</span></button>`;
    };
    let filters = '<div class="supervisor-filter">';
    filters += '<div class="supervisor-filter__group"><span class="supervisor-filter__title">Статус</span>';
    filters += filterChip('all', 'усі', statusCounts.all, 'status', supervisorState.filterStatus);
    filters += filterChip('pending', 'на перевірці', statusCounts.pending, 'status', supervisorState.filterStatus);
    filters += filterChip('needs_revision', 'доопрацювати', statusCounts.needs_revision, 'status', supervisorState.filterStatus);
    filters += filterChip('approved', 'прийнято', statusCounts.approved, 'status', supervisorState.filterStatus);
    filters += '</div>';
    filters += '<div class="supervisor-filter__group"><span class="supervisor-filter__title">Студент</span>';
    filters += filterChip('all', 'усі', rows.length, 'student', supervisorState.filterStudent);
    STUDENTS.forEach(s => {
      const c = rows.filter(r => r.student_slug === s.slug).length;
      filters += filterChip(s.slug, s.name, c, 'student', supervisorState.filterStudent);
    });
    filters += '</div></div>';

    // === Cards (filtered) ===
    let cards = '<div class="supervisor-cards">';
    const visible = rows.filter(r => {
      if (supervisorState.filterStatus !== 'all' && (r.review_status || 'pending') !== supervisorState.filterStatus) return false;
      if (supervisorState.filterStudent !== 'all' && r.student_slug !== supervisorState.filterStudent) return false;
      return true;
    });
    if (!visible.length) {
      cards += '<p class="supervisor-cards__empty">Нічого не знайдено за поточними фільтрами.</p>';
    } else {
      visible.forEach(r => { cards += renderSubmissionCard(r); });
    }
    cards += '</div>';

    slot.innerHTML = matrix + filters + cards;

    // Wire cell clicks → expand + scroll
    slot.querySelectorAll('.cell-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.submissionId;
        supervisorState.openCardId = id;
        renderSupervisorView(slot);
        const card = slot.querySelector(`.supervisor-card[data-id="${id}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Wire filters
    slot.querySelectorAll('.supervisor-filter__chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const group = chip.dataset.group;
        const value = chip.dataset.value;
        if (group === 'status') supervisorState.filterStatus = value;
        else if (group === 'student') supervisorState.filterStudent = value;
        renderSupervisorView(slot);
      });
    });

    // Wire card heads (toggle expand)
    slot.querySelectorAll('.supervisor-card__head').forEach(head => {
      head.addEventListener('click', () => {
        const card = head.closest('.supervisor-card');
        const id = card.dataset.id;
        supervisorState.openCardId = (supervisorState.openCardId === id) ? null : id;
        renderSupervisorView(slot);
      });
    });

    // Wire save buttons
    slot.querySelectorAll('.supervisor-card__save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = btn.closest('.supervisor-card');
        await saveReview(card, slot);
      });
    });
  }

  function renderSubmissionCard(row) {
    const student = STUDENTS.find(s => s.slug === row.student_slug);
    const studentName = student ? student.name : row.student_slug;
    const studentColor = student ? student.color : 'var(--coral)';
    const page = PAGES.find(p => p.id === row.day_id);
    const dayLabel = page ? page.label : row.day_id;
    const schema = SUBMISSION_SCHEMAS[row.day_id];
    const status = row.review_status || 'pending';
    const notes = row.review_notes || {};
    const generalNote = notes._general || '';
    const isOpen = supervisorState.openCardId === row.id;
    const stamp = new Date(row.updated_at).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
    const reviewedStamp = row.reviewed_at
      ? new Date(row.reviewed_at).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })
      : '';

    let fieldsHtml = '';
    if (schema && schema.fields) {
      schema.fields.forEach(f => {
        const val = (row.payload || {})[f.key];
        const note = notes[f.key] || '';
        fieldsHtml += `
          <div class="supervisor-card__field">
            <div class="supervisor-card__field-label">${escapeHtml(f.label)}</div>
            <div class="supervisor-card__field-value">${renderFieldValue(val, f.type)}</div>
            <div class="supervisor-card__field-comment">
              <label class="supervisor-card__comment-label">Коментар до поля</label>
              <textarea class="supervisor-card__comment" data-field-key="${escapeHtml(f.key)}" rows="2" placeholder="Що варто доопрацювати або похвалити...">${escapeHtml(note)}</textarea>
            </div>
          </div>
        `;
      });
    } else {
      // Fallback — no schema (e.g. legacy data with old keys)
      Object.entries(row.payload || {}).forEach(([k, v]) => {
        const note = notes[k] || '';
        fieldsHtml += `
          <div class="supervisor-card__field">
            <div class="supervisor-card__field-label">${escapeHtml(k)}</div>
            <div class="supervisor-card__field-value">${renderFieldValue(v, null)}</div>
            <div class="supervisor-card__field-comment">
              <label class="supervisor-card__comment-label">Коментар до поля</label>
              <textarea class="supervisor-card__comment" data-field-key="${escapeHtml(k)}" rows="2">${escapeHtml(note)}</textarea>
            </div>
          </div>
        `;
      });
    }

    const statusOptions = ['pending', 'approved', 'needs_revision'].map(s =>
      `<option value="${s}"${s === status ? ' selected' : ''}>${escapeHtml(STATUS_LABELS[s])}</option>`
    ).join('');

    return `
      <div class="supervisor-card supervisor-card--${status}${isOpen ? ' supervisor-card--open' : ''}" data-id="${escapeHtml(row.id)}" style="--student-color: ${studentColor}">
        <button class="supervisor-card__head" type="button">
          <div class="supervisor-card__head-main">
            <span class="supervisor-card__student">${escapeHtml(studentName)}</span>
            <span class="supervisor-card__day">${escapeHtml(dayLabel)}</span>
          </div>
          <div class="supervisor-card__head-meta">
            <span class="supervisor-card__badge supervisor-card__badge--${status}">${escapeHtml(STATUS_LABELS[status])}</span>
            <span class="supervisor-card__stamp">здано: ${escapeHtml(stamp)}</span>
            ${reviewedStamp ? `<span class="supervisor-card__stamp">переглянуто: ${escapeHtml(reviewedStamp)}</span>` : ''}
            <span class="supervisor-card__chevron">${isOpen ? '▾' : '▸'}</span>
          </div>
        </button>
        ${isOpen ? `
        <div class="supervisor-card__body">
          <div class="supervisor-card__controls">
            <label class="supervisor-card__control">
              <span class="supervisor-card__control-label">Статус</span>
              <select class="supervisor-card__status">${statusOptions}</select>
            </label>
            <label class="supervisor-card__control supervisor-card__control--wide">
              <span class="supervisor-card__control-label">Загальний коментар</span>
              <textarea class="supervisor-card__general" rows="3" placeholder="Що загалом — основні думки про здачу...">${escapeHtml(generalNote)}</textarea>
            </label>
          </div>
          <div class="supervisor-card__fields">${fieldsHtml}</div>
          <div class="supervisor-card__actions">
            <button class="supervisor-card__save" type="button">Зберегти ревʼю</button>
            <span class="supervisor-card__save-status" data-role="save-status" hidden></span>
          </div>
        </div>` : ''}
      </div>
    `;
  }

  function renderFieldValue(val, type) {
    if (val == null || val === '') return '<span class="supervisor-card__field-empty">— порожньо —</span>';
    const s = String(val);
    if (type === 'url' || /^https?:\/\//i.test(s)) {
      return `<a href="${escapeHtml(s)}" target="_blank" rel="noopener" class="supervisor-card__link">${escapeHtml(s)}</a>`;
    }
    // For long text — show in a scrollable pre-like block
    const long = s.length > 200 || s.includes('\n');
    if (long) {
      return `<div class="supervisor-card__longtext">${escapeHtml(s).replace(/\n/g, '<br>')}</div>`;
    }
    return `<span>${escapeHtml(s)}</span>`;
  }

  async function saveReview(card, slot) {
    if (!card) return;
    const id = card.dataset.id;
    const status = card.querySelector('.supervisor-card__status').value;
    const general = card.querySelector('.supervisor-card__general').value.trim();
    const review_notes = {};
    if (general) review_notes._general = general;
    card.querySelectorAll('.supervisor-card__comment').forEach(t => {
      const key = t.dataset.fieldKey;
      const v = t.value.trim();
      if (v) review_notes[key] = v;
    });

    const statusEl = card.querySelector('[data-role="save-status"]');
    const saveBtn = card.querySelector('.supervisor-card__save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Зберігаю…';
    statusEl.hidden = false;
    statusEl.dataset.kind = 'pending';
    statusEl.textContent = 'Зберігаю…';

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/submissions?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            review_notes,
            review_status: status,
            reviewed_at: new Date().toISOString(),
          }),
        }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        statusEl.dataset.kind = 'error';
        statusEl.textContent = `Не вдалось (${res.status}). ${text || ''}`;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Зберегти ревʼю';
        return;
      }
      const updated = await res.json();
      if (Array.isArray(updated) && updated.length) {
        // Update in-memory row
        const idx = supervisorState.rows.findIndex(r => r.id === id);
        if (idx >= 0) supervisorState.rows[idx] = updated[0];
      }
      statusEl.dataset.kind = 'success';
      statusEl.textContent = '✓ Збережено';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Зберегти ревʼю';
      // Re-render so badge + matrix reflect new status
      setTimeout(() => renderSupervisorView(slot), 400);
    } catch (err) {
      statusEl.dataset.kind = 'error';
      statusEl.textContent = `Помилка мережі: ${err.message}`;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Зберегти ревʼю';
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
