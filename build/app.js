(function() {
  'use strict';

  // ===========================================================
  // Encrypted data is embedded in <script id="encrypted-data">
  // Structure: { days: { id: { salt, iv, ct, label, password_hint? }, ... } }
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
  const appEl = document.getElementById('app');
  const loginForm = document.getElementById('loginForm');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');

  async function attemptLogin(password) {
    // Main password should unlock pages with "locked_by_default: false"
    const baseUnlocks = PAGES.filter(p => !p.locked_by_default).map(p => p.id);
    // Test by trying to decrypt the first base page
    if (baseUnlocks.length === 0) return false;
    const testId = baseUnlocks[0];
    const decrypted = await tryDecrypt(testId, password);
    if (decrypted) {
      // Store password for these pages
      baseUnlocks.forEach(id => { storedPasswords[id] = password; });
      // Also try to decrypt supervisor with same password (in case main == supervisor)
      // Otherwise skip
      decryptedCache[testId] = decrypted;
      // Mark base pages as unlocked
      baseUnlocks.forEach(id => {
        if (!unlockedDays.includes(id)) unlockedDays.push(id);
      });
      persistState();
      return true;
    }
    // Also try as supervisor password.
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
        return true;
      }
    }
    return false;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = passwordInput.value.trim();
    if (!pw) return;
    const btn = loginForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Перевіряю...';
    const ok = await attemptLogin(pw);
    btn.disabled = false;
    btn.textContent = 'Увійти';
    if (ok) {
      enterApp();
    } else {
      loginError.hidden = false;
      passwordInput.select();
    }
  });

  function enterApp() {
    loginEl.hidden = true;
    appEl.hidden = false;
    renderNav();
    // Navigate to first unlocked page (or page from URL hash)
    const hash = location.hash.slice(1);
    const target = hash && unlockedDays.includes(hash) ? hash : (unlockedDays[0] || PAGES[0].id);
    navigate(target);
  }

  // ===========================================================
  // Logout
  // ===========================================================
  document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem('cp');
    storedPasswords = {};
    Object.keys(decryptedCache).forEach(k => delete decryptedCache[k]);
    location.reload();
  });

  function persistState() {
    sessionStorage.setItem('cp', JSON.stringify(storedPasswords));
    localStorage.setItem('unlocked', JSON.stringify(unlockedDays));
  }

  // ===========================================================
  // Sidebar nav
  // ===========================================================
  const navEl = document.getElementById('nav');
  let currentPage = null;

  function renderNav() {
    navEl.innerHTML = '';
    PAGES.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'nav__item';
      const isUnlocked = unlockedDays.includes(p.id);
      const isLocked = !isUnlocked;
      if (isLocked) btn.classList.add('nav__item--locked');
      if (p.id === currentPage) btn.classList.add('nav__item--active');
      btn.dataset.pageId = p.id;
      btn.innerHTML = `<span class="nav__label">${escapeHtml(p.label)}</span>${isLocked ? '<span class="nav__lock">🔒</span>' : ''}`;
      btn.addEventListener('click', () => navigate(p.id));
      navEl.appendChild(btn);
    });
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
        // Shouldn't happen if unlocked logic is right
        contentEl.innerHTML = '<p>Помилка: пароль для цієї сторінки не знайдено. Спробуй вийти і увійти знову.</p>';
        return;
      }
      contentEl.innerHTML = '<p style="color:var(--muted)">Розкодовую...</p>';
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
  }

  function showUnlockPanel(pageId) {
    unlockPanel.hidden = false;
    const page = PAGES.find(p => p.id === pageId);
    const hintEl = document.getElementById('unlockHint');
    if (pageId === 'supervisor') {
      hintEl.textContent = 'Цей розділ призначено лише для керівника челенджу. Введи supervisor-пароль.';
    } else {
      // Find previous day to hint
      const prevDay = findPreviousDay(pageId);
      if (prevDay) {
        hintEl.textContent = `Завершальний код для розблокування — у самому низу сторінки "${prevDay.label}". Дочитай день до кінця і знайдеш його.`;
      } else {
        hintEl.textContent = 'Щоб відкрити, введи завершальний код з попереднього дня.';
      }
    }
    document.getElementById('unlockInput').value = '';
    document.getElementById('unlockInput').focus();
    document.getElementById('unlockError').hidden = true;
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
  // Utilities
  // ===========================================================
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ===========================================================
  // Auto-login if we have stored password for any page
  // ===========================================================
  (async function init() {
    // If we have any stored password, try to enter app
    const hasStored = Object.keys(storedPasswords).length > 0;
    if (hasStored && unlockedDays.length > 0) {
      // Verify by re-decrypting first unlocked page
      const firstId = unlockedDays[0];
      const pw = storedPasswords[firstId];
      if (pw) {
        const ok = await tryDecrypt(firstId, pw);
        if (ok) {
          decryptedCache[firstId] = ok;
          enterApp();
          return;
        }
      }
    }
    // Stay on login screen
  })();

  // Listen to hash changes for direct linking
  window.addEventListener('hashchange', () => {
    if (appEl.hidden) return;
    const target = location.hash.slice(1);
    if (target && target !== currentPage) {
      navigate(target);
    }
  });

})();
