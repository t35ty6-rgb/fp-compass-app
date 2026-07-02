// FP顧客管理ツール デモ メインスクリプト
// シングルページ。ダッシュボード / 顧客一覧 / タイムライン / 顧客詳細モーダル。

(function () {

  const TODAY = window.LifeEvents.TODAY;
  const LS_KEY = 'fp-crm-state-v1';
  const LS_REAL_MODE = 'fp-crm-real-mode';
  const LS_REAL_CLIENTS = 'fp-crm-real-clients-v1';

  // ============================
  // ★ 2026-06-26 重さ解消 Phase 5: 再render 削減ユーティリティ
  // ============================
  // (a) debounce: 入力イベントを wait ms 間隔に間引く
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }
  // (b) clients データ署名 — 変わってない時は再render しない
  function clientsSignature() {
    try {
      const arr = (typeof clients !== 'undefined' && clients) ? clients : [];
      let h = arr.length + ':';
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        h += (c.id || '') + (c.lastContact || '') + (c.status || '') + ((c.lineHistory || []).length) + '|';
      }
      const ld = window.LineAppLiveData || {};
      h += 'L' + ((ld.line_messages || []).length) + 'A' + ((ld.ai_results || []).length) + 'B' + ((ld.bookings || []).length);
      return h;
    } catch (_) { return String(Date.now()); }
  }
  let _lastClientsSig = '';
  // (c) 顧客モーダルが開いている間は 一覧の再render を保留 (ユーザー視野外)
  function isClientModalOpen() {
    try {
      const ov = document.getElementById('modal-overlay');
      if (!ov) return false;
      const d = ov.style.display;
      return d && d !== 'none';
    } catch (_) { return false; }
  }
  let _pendingBgRender = false;
  // (d) 背景polling 由来の再render を 1.5秒 coalesce
  const scheduleBgRenderClients = debounce(function () {
    if (isClientModalOpen()) { _pendingBgRender = true; return; }
    const sig = clientsSignature();
    if (sig === _lastClientsSig) return; // データ変化なし → skip
    _lastClientsSig = sig;
    try { renderClients(); } catch (e) { console.warn('scheduleBgRenderClients fail:', e); }
  }, 1500);
  window._fpScheduleBgRenderClients = scheduleBgRenderClients;
  // モーダル close 時に保留分を消化
  window._fpFlushPendingBgRender = function () {
    if (!_pendingBgRender) return;
    _pendingBgRender = false;
    scheduleBgRenderClients();
  };

  // ★ 2026-06-25 軽量化 Phase 3: localStorage 蓄積 診断 + 自動 cleanup
  //   起動時 1回 全key size 計測 + over-quota 警告 + 古い fp-ai-backup-* 削除 (>7日)
  //   quota 5MB 超で setItem silent fail → モーダル / cache 全部死ぬ 真因対策
  (function lsAudit() {
    try {
      const keys = Object.keys(localStorage);
      let total = 0;
      const sizes = [];
      keys.forEach(k => {
        const v = localStorage.getItem(k) || '';
        // UTF-16 で 1文字 2byte 換算 (実 quota も 同じ計測)
        const bytes = (k.length + v.length) * 2;
        total += bytes;
        sizes.push({ k, bytes });
      });
      sizes.sort((a, b) => b.bytes - a.bytes);
      const fmt = b => (b / 1024).toFixed(1) + 'KB';
      console.log('[ls-audit] total', fmt(total), '/', keys.length, 'keys (quota 5120KB)');
      console.log('[ls-audit] top 5:', sizes.slice(0, 5).map(s => s.k + '=' + fmt(s.bytes)).join(', '));
      // 80% 超で警告 / 95% 超で 強制 cleanup
      if (total > 5120 * 1024 * 0.8) {
        console.warn('[ls-audit] WARN over 80% quota:', fmt(total), '— cleanup を 推奨');
      }
      // ① fp-ai-backup-* の 古いの 削除 (>7日)
      const NOW = Date.now();
      const WEEK = 7 * 24 * 3600 * 1000;
      let purged = 0, purgedBytes = 0;
      keys.forEach(k => {
        if (!k.startsWith('fp-ai-backup-')) return;
        // key 末尾 は `-${Date.now()}` (line-app.js 3361行 persistKey 形式)
        const m = k.match(/-(\d{13})$/);
        if (!m) return;
        const created = parseInt(m[1], 10);
        if (NOW - created > WEEK) {
          const v = localStorage.getItem(k) || '';
          purgedBytes += (k.length + v.length) * 2;
          localStorage.removeItem(k);
          purged++;
        }
      });
      if (purged > 0) console.log('[ls-audit] purged', purged, 'old fp-ai-backup-* keys (', fmt(purgedBytes), ')');
      // ② 95% 超なら LIVE_CACHE_KEY 投棄 (次回 fetch で再生成、 transcript stripped 版で軽くなる)
      if (total > 5120 * 1024 * 0.95) {
        try {
          localStorage.removeItem('fp-livedata-cache-v1');
          console.warn('[ls-audit] over 95% → fp-livedata-cache-v1 投棄 (次回 fetch で再生成)');
        } catch (_) {}
      }
    } catch (e) { console.warn('[ls-audit] fail:', e); }
  })();

  // ★ 顧客台帳 保存時 lineHistory が 巨大なら 末尾 N件 だけ in-memory に残し
  //   全件は fp-line-history-{id} の 独立キー に 保持 (既存 ensureLineHistory_ で hydrate)
  //   これで fp-crm-clients-v1 1個 で 数MB 食う事象 を 構造的に 防ぐ
  function trimLineHistoryForSave(arr) {
    if (!Array.isArray(arr)) return arr;
    const KEEP_INLINE = 50; // 直近50件のみ inline
    return arr.map(c => {
      if (!c || !Array.isArray(c.lineHistory) || c.lineHistory.length <= KEEP_INLINE) return c;
      try {
        // 全件 を 独立キー へ ミラー (重複 ts は除去)
        const key = 'fp-line-history-' + c.id;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        const seenTs = new Set(existing.map(m => m.ts).filter(Boolean));
        c.lineHistory.forEach(m => {
          if (!m.ts || !seenTs.has(m.ts)) { existing.push(m); seenTs.add(m.ts); }
        });
        existing.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
        // ★ Critical-C: cap 500件 (古いから drop) — localStorage quota 突破 防止
        const capped = existing.length > 500 ? existing.slice(-500) : existing;
        localStorage.setItem(key, JSON.stringify(capped));
      } catch (_) {}
      const trimmed = Object.assign({}, c);
      trimmed.lineHistory = c.lineHistory.slice(-KEEP_INLINE);
      return trimmed;
    });
  }
  window.__fpTrimLineHistoryForSave = trimLineHistoryForSave;

  // ★ 全 setItem を 一括 intercept (個別 save site を 全部 書き換えるのは 退化リスク 高い)
  //   - fp-crm-clients-v1: lineHistory >50件 を 独立キー へ 移して inline は 末尾50件 だけ保存
  //   - fp-livedata-cache-v1: ai_results[].transcript を strip (server lite=1 と 同じ整形)
  //   どちらも UI 表示には 影響なし (モーダル open 時 customer-detail で hydrate)
  try {
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      try {
        if (k === 'fp-crm-clients-v1' && typeof v === 'string' && v.length > 200 * 1024) {
          const arr = JSON.parse(v);
          if (Array.isArray(arr)) {
            const trimmed = trimLineHistoryForSave(arr);
            v = JSON.stringify(trimmed);
          }
        } else if (k === 'fp-livedata-cache-v1' && typeof v === 'string' && v.length > 200 * 1024) {
          const live = JSON.parse(v);
          if (live && Array.isArray(live.ai_results)) {
            live.ai_results = live.ai_results.map(r => {
              if (!r) return r;
              const lite = Object.assign({}, r);
              // 重い field を 削除 (モーダル open 時 GAS から再fetch される)
              delete lite.transcript;
              delete lite.full_transcript;
              return lite;
            });
            v = JSON.stringify(live);
          }
        }
      } catch (_) {}
      return origSetItem(k, v);
    };
  } catch (_) {}

  // 客リスト = デモ客 (DUMMY_CLIENTS) + 実モード切替
  const demoClients = (window.DUMMY_CLIENTS || []).slice();
  function getRealClients() {
    try {
      const raw = localStorage.getItem(LS_REAL_CLIENTS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveRealClients(arr) {
    try { localStorage.setItem(LS_REAL_CLIENTS, JSON.stringify(arr)); } catch (e) {}
  }
  function isRealMode() {
    return localStorage.getItem(LS_REAL_MODE) === '1';
  }
  function setRealMode(on) {
    localStorage.setItem(LS_REAL_MODE, on ? '1' : '0');
  }
  function rebuildClients() {
    // 実モード = 実客のみ / デモモード = デモ客 + 実客
    const real = getRealClients();
    const list = isRealMode() ? real : demoClients.concat(real);
    window.DUMMY_CLIENTS = list;
    return list;
  }
  let clients = rebuildClients();

  // localStorage に保存済みの「編集中」顧客があれば差し替え (旧キー、互換のため残す)
  try {
    const raw = localStorage.getItem('fp-crm-clients-v1');
    if (raw && !isRealMode()) {
      const stored = JSON.parse(raw);
      if (Array.isArray(stored) && stored.length > 0) {
        clients.length = 0;
        stored.forEach(c => clients.push(c));
        window.DUMMY_CLIENTS = clients;
      }
    }
  } catch (e) {}
  // ★ オーナーfb「全員41歳」 birth='1985-01-01' (LINE経由クライアント生成のデフォルト) を空に
  //   注: localStorage ゲートは廃止 (新規LINE客が追加される度に必ず実行) — オーナー再発防止
  try {
    let changed = 0;
    clients.forEach(c => { if (c.birth === '1985-01-01') { c.birth = ''; changed++; } });
    if (changed > 0) {
      try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(clients)); } catch (_) {}
      console.log('[birth-clean] cleared default 1985-01-01 on', changed, 'clients');
    }
  } catch (e) {}

  // ★ オーナーfb「[テスト] xxx dummy 削除 + 同名顧客の自動統合」
  // 1回限り migration
  try {
    if (!localStorage.getItem('fp-dedup-migrated-v1')) {
      let removedTest = 0;
      let mergedDup = 0;
      // (1) [テスト] で始まる名前を削除
      for (let i = clients.length - 1; i >= 0; i--) {
        const n = String(clients[i].name || '');
        if (/^\[テスト\]/.test(n) || /^\[test\]/i.test(n)) {
          clients.splice(i, 1);
          removedTest++;
        }
      }
      // (2) 同名で複数いる場合、lineFriendId 持ってる方に統合
      const byNorm = {};
      clients.forEach((c, idx) => {
        const norm = String(c.name || '').replace(/\s+/g, '').toLowerCase();
        if (!norm) return;
        if (!byNorm[norm]) byNorm[norm] = [];
        byNorm[norm].push(idx);
      });
      const toRemove = new Set();
      Object.keys(byNorm).forEach(norm => {
        const idxs = byNorm[norm];
        if (idxs.length < 2) return;
        // lineFriendId 持ってる方を主、無い方を統合先 (dummy)
        const groups = idxs.map(i => clients[i]);
        const winner = groups.find(c => c.lineFriendId) || groups[0];
        groups.forEach(c => {
          if (c === winner) return;
          // 統合: lineHistory merge / lastContact 新しい方 / familyなど winner 既存優先
          if (!Array.isArray(winner.lineHistory)) winner.lineHistory = [];
          if (Array.isArray(c.lineHistory)) {
            c.lineHistory.forEach(m => {
              const ts = String(m.ts || '').slice(0, 19);
              const seen = winner.lineHistory.some(h => String(h.ts || '').slice(0, 19) === ts && (h.text || h.message) === (m.text || m.message));
              if (!seen) winner.lineHistory.push(m);
            });
          }
          // 補完: 空欄のみ dummy 値で埋める
          if (!winner.occupation && c.occupation) winner.occupation = c.occupation;
          if (!winner.birth && c.birth) winner.birth = c.birth;
          if (!winner.family || winner.family.length === 0) winner.family = c.family || [];
          if (!winner.aum && c.aum) winner.aum = c.aum;
          if (!winner.lastContact && c.lastContact) winner.lastContact = c.lastContact;
          else if (c.lastContact && String(c.lastContact).localeCompare(winner.lastContact) > 0) winner.lastContact = c.lastContact;
          // 旧 lineHistory 独立キーも merge
          try {
            const oldKey = 'fp-line-history-' + c.id;
            const newKey = 'fp-line-history-' + winner.id;
            const oldArr = JSON.parse(localStorage.getItem(oldKey) || '[]');
            const newArr = JSON.parse(localStorage.getItem(newKey) || '[]');
            oldArr.forEach(m => {
              const ts = String(m.ts || '').slice(0, 19);
              const seen = newArr.some(h => String(h.ts || '').slice(0, 19) === ts && (h.text || h.message) === (m.text || m.message));
              if (!seen) newArr.push(m);
            });
            if (oldArr.length > 0) {
              // ★ Critical-C: cap 500件 (古いから drop)
              const _cappedNewArr = newArr.length > 500 ? newArr.slice(-500) : newArr;
              localStorage.setItem(newKey, JSON.stringify(_cappedNewArr));
            }
            localStorage.removeItem(oldKey);
          } catch (_) {}
          toRemove.add(c.id);
          mergedDup++;
        });
      });
      // 削除実行
      for (let i = clients.length - 1; i >= 0; i--) {
        if (toRemove.has(clients[i].id)) clients.splice(i, 1);
      }
      if (removedTest > 0 || mergedDup > 0) {
        try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(clients)); } catch (_) {}
        console.log('[dedup] removed', removedTest, 'test dummy / merged', mergedDup, 'dup-name clients');
      }
      localStorage.setItem('fp-dedup-migrated-v1', '1');
    }
  } catch (e) { console.warn('dedup migration fail:', e); }

  const state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : { activeTab: 'dashboard', search: '', statusFilter: 'all', contactFilter: 'all', sortBy: 'contact-asc' };
    } catch (e) {
      return { activeTab: 'dashboard', search: '', statusFilter: 'all', contactFilter: 'all', sortBy: 'contact-asc' };
    }
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 100_000_000) return (n / 100_000_000).toFixed(2).replace(/\.?0+$/, '') + '億';
    if (n >= 10_000) return Math.round(n / 10_000).toLocaleString() + '万';
    return Number(n).toLocaleString();
  }
  function fmtDate(d) {
    if (typeof d === 'string') d = new Date(d);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }
  function daysSince(d) {
    // ★ NaN日前 / undefined 表示防止: 不正な日付なら null を返し、 呼出側で '—' 等 fallback
    if (!d) return null;
    const t = new Date(d).getTime();
    if (isNaN(t)) return null;
    return Math.round((TODAY - t) / (1000 * 60 * 60 * 24));
  }
  function statusLabel(s) {
    return { active: '管理中', important: '重点', new: '新規', dormant: '休眠' }[s] || s;
  }
  function priorityClass(p) {
    if (p >= 85) return 'high';
    if (p >= 65) return 'mid';
    return 'low';
  }
  function priorityLabel(p) {
    if (p >= 85) return '至急';
    if (p >= 65) return '今週';
    return '今月';
  }

  // ============================
  // タブ切替
  // ============================
  // ★ URLルーティング: 全 view を `?view={name}` で 表現
  //   - tab click → activateTab(name) → URL pushState → URL更新
  //   - ブラウザ back / forward → popstate → URL読取 → activateTab(name, {fromPopstate:true})
  //   - リロード / 直アクセス → 初期 URL 読取 → activateTab で 復元
  //   メリット: F5でも 同じ画面戻る / Playwright E2E URL直アクセス / Bug再現が URL共有 だけで済む
  const VALID_VIEWS = ['dashboard','clients','timeline','meetingHistory','leadHub','distributionHub','birthdayTab','calendarTab','settingsHub','dormantFollowup','tagsHub','kpi'];
  function activateTab(name, options) {
    options = options || {};
    state.activeTab = name;
    saveState();
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.dataset.view === name);
    });
    if (name === 'dashboard') renderDashboard();
    if (name === 'clients') renderClients();
    if (name === 'timeline') renderGlobalTimeline();
    if (name === 'meetingHistory') {
      if (window.LineApp && window.LineApp.renderMeetingHistory) {
        if (!window._lineInited) { window.LineApp.init(); window._lineInited = true; }
        window.LineApp.renderMeetingHistory();
      }
    }
    if (['leadHub', 'distributionHub', 'birthdayTab', 'calendarTab', 'settingsHub', 'dormantFollowup', 'tagsHub'].indexOf(name) >= 0) {
      if (window.LineApp) {
        if (!window._lineInited) {
          window.LineApp.init();
          window._lineInited = true;
        }
        window.LineApp.activateSubview(name);
      } else {
        // ★ 2026-06-26 perf: line-app.js deferred ロード中なら ペンディング保存→ロード後 リプレイ
        window._pendingLineView = name;
      }
    }
    // ★ URL更新 (popstate由来でない時 = ユーザclick / 初期化 など)
    if (!options.fromPopstate && VALID_VIEWS.indexOf(name) >= 0) {
      try {
        const url = new URL(window.location);
        if (url.searchParams.get('view') !== name) {
          url.searchParams.set('view', name);
          // モーダル系の customer/tab パラメータ も view 切替時はクリア
          url.searchParams.delete('customer');
          url.searchParams.delete('tab');
          history.pushState({ view: name }, '', url.pathname + url.search);
        }
      } catch (e) { console.warn('[router] pushState fail:', e); }
    }
  }
  // popstate (ブラウザ back/forward) listener
  window.addEventListener('popstate', () => { applyUrlState({ fromPopstate: true }); });
  // 初期URL → 該当 view 復元 (リロード時 同じ画面に戻る)
  function routeFromUrl() { applyUrlState({ fromPopstate: true }); }
  // URLの ?view= / ?customer= / ?tab= を 読み取って UI状態に反映
  // - view: メインタブ
  // - customer: 顧客モーダルID (あれば 開く / なければ 閉じる)
  // - tab: モーダル内タブ (overview/line/timeline/proposals/meetings/family)
  function applyUrlState(options) {
    options = options || {};
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const customer = params.get('customer');
    const subtab = params.get('tab');
    // 1. view 同期
    if (view && VALID_VIEWS.indexOf(view) >= 0 && view !== state.activeTab) {
      activateTab(view, { fromPopstate: true });
    }
    // 2. customer モーダル 同期
    const overlay = document.getElementById('modal-overlay');
    const overlayOpen = overlay && overlay.style.display === 'flex';
    if (customer) {
      // URL に customer 指定あり → モーダル開く
      try {
        if (typeof openClientModal === 'function' && (!overlayOpen || window._fpCurrentClient?.id !== customer)) {
          openClientModal(customer, { fromPopstate: true });
        }
        // 3. モーダル内タブ 同期
        if (subtab) {
          setTimeout(() => {
            const tabBtn = document.querySelector('[data-cdtab="' + subtab + '"]');
            if (tabBtn && !tabBtn.classList.contains('cd-tab-active')) tabBtn.click();
          }, 150);
        }
      } catch (e) { console.warn('[router] openClientModal fail:', e); }
    } else if (overlayOpen && !options.skipModalClose) {
      // URL に customer 指定なし → モーダル閉じる (popstateで戻った時)
      try { closeModal({ fromPopstate: true }); } catch (_) {}
    }
  }
  // モーダル URL push helper (openClientModal/closeModal/タブclick から呼ぶ)
  function pushModalUrl(customerId, subtab) {
    try {
      const url = new URL(window.location);
      if (customerId) {
        url.searchParams.set('view', 'clients');
        url.searchParams.set('customer', customerId);
        if (subtab) url.searchParams.set('tab', subtab);
        else url.searchParams.delete('tab');
      } else {
        url.searchParams.delete('customer');
        url.searchParams.delete('tab');
      }
      const target = url.pathname + url.search;
      if (window.location.pathname + window.location.search !== target) {
        history.pushState({ view: 'clients', customer: customerId, tab: subtab }, '', target);
      }
    } catch (e) { console.warn('[router] pushModalUrl fail:', e); }
  }
  window.FPRouter = { activateTab, routeFromUrl, applyUrlState, pushModalUrl, VALID_VIEWS };

  // ============================
  // ダッシュボード
  // ============================
  // ★ オーナーfb: ホームに「LINE 要返信」 を 大きく表示。顧客台帳の赤バッジより目立つ位置に
  function renderUnreadLinesOnHome(clients) {
    const area = document.getElementById('home-unread-area');
    if (!area) return;
    const unreadList = [];
    (clients || []).forEach(c => {
      const lastRead = parseInt(localStorage.getItem('fp-line-read-' + c.id) || '0', 10);
      const unread = (c.lineHistory || []).filter(m => {
        const isUser = (m.from === 'user' || m.direction === 'in');
        const ts = new Date(m.ts || m.date || 0).getTime();
        return isUser && ts > lastRead;
      });
      if (unread.length > 0) {
        const latest = unread[unread.length - 1];
        unreadList.push({
          client: c,
          count: unread.length,
          latestText: (latest.text || '').slice(0, 80),
          latestTs: latest.ts || latest.date || '',
        });
      }
    });
    if (unreadList.length === 0) { area.innerHTML = ''; return; }
    area.innerHTML = `
      <section class="fp-home-unread" style="background:linear-gradient(135deg,#FEF2F2,#FEE2E2);border:1px solid #FCA5A5;border-radius:14px;padding:22px 26px;margin-bottom:26px;box-shadow:0 8px 24px rgba(220,38,38,0.12);">
        <header style="display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:16px;">
          <div>
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#DC2626;margin-bottom:5px;">⚠ ACTION REQUIRED</div>
            <h2 style="font-family:'Noto Serif JP',serif;font-weight:700;font-size:20px;letter-spacing:-0.01em;color:#7F1D1D;margin:0;">LINE で返信を待っている方 <span style="color:#DC2626;">${unreadList.length}名</span></h2>
          </div>
          <span style="font-size:11px;color:#991B1B;font-weight:700;">放置すると 信頼を 損ねます</span>
        </header>
        <div style="display:grid;gap:8px;">
          ${unreadList.slice(0, 5).map(u => `
            <button class="fp-home-unread-row" data-client-id="${escapeHtml(u.client.id)}" style="display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;background:#fff;border:1px solid #FCA5A5;border-radius:10px;padding:12px 16px;cursor:pointer;font-family:inherit;text-align:left;transition:all 0.15s ease;">
              <div style="width:38px;height:38px;border-radius:50%;background:hsl(${(u.client.name.charCodeAt(0)*7)%360},55%,90%);color:hsl(${(u.client.name.charCodeAt(0)*7)%360},60%,30%);display:flex;align-items:center;justify-content:center;font-family:'Noto Serif JP',serif;font-weight:700;font-size:16px;">${escapeHtml(u.client.name.charAt(0))}</div>
              <div style="min-width:0;">
                <div style="font-family:'Noto Serif JP',serif;font-weight:700;font-size:14.5px;color:#1F1A12;line-height:1.3;">${escapeHtml(u.client.name)} <span style="font-size:11px;color:#8B7D5D;font-weight:400;">さん</span></div>
                <div style="font-size:11.5px;color:#5E5648;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.5;">💬 「${escapeHtml(u.latestText)}${u.latestText.length >= 80 ? '…' : ''}」</div>
              </div>
              <span style="background:linear-gradient(135deg,#DC2626,#991B1B);color:#fff;font-size:10.5px;font-weight:900;padding:5px 11px;border-radius:11px;letter-spacing:0.04em;box-shadow:0 4px 10px rgba(220,38,38,0.32);">${u.count}件 未読</span>
              <span style="font-size:18px;color:#DC2626;font-weight:700;">→</span>
            </button>
          `).join('')}
          ${unreadList.length > 5 ? `<div style="text-align:center;font-size:11px;color:#991B1B;margin-top:6px;">他 ${unreadList.length - 5}名 が返信待ち — 顧客台帳 で全件確認</div>` : ''}
        </div>
      </section>
      <style>
        .fp-home-unread-row:hover { background:#FFF5F5 !important; border-color:#DC2626 !important; transform:translateX(3px); box-shadow:0 4px 14px rgba(220,38,38,0.15); }
      </style>
    `;
    area.querySelectorAll('.fp-home-unread-row').forEach(row => {
      row.addEventListener('click', () => openClientModal(row.dataset.clientId));
    });
  }

  function renderDashboard() {
    const totalClients = clients.length;
    const importantCount = clients.filter(c => c.status === 'important').length;
    const totalAum = clients.reduce((s, c) => s + (c.aum || 0), 0);

    // 3ヶ月以内の重要イベント数
    let upcoming3m = 0;
    clients.forEach(c => {
      const evs = window.LifeEvents.generate(c);
      evs.forEach(ev => {
        const days = (ev.date - TODAY) / (1000 * 60 * 60 * 24);
        if (days >= 0 && days <= 90 && ev.major) upcoming3m++;
      });
    });

    // 半年以上未接触
    const staleCount = clients.filter(c => daysSince(c.lastContact) >= 180).length;

    // 確定待ち件数 (LIVE → demo 補完)
    let surveys = [];
    try {
      // Cloud Run /api/bookings の cache from line-app (CRM ホームでも候補日確定待ちを案内)
      const liveSurveys = (window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [];
      const hasLive = liveSurveys.some(s => s.q6_候補1 || s.q7_候補2 || s.q8_候補3);
      surveys = hasLive ? liveSurveys : (liveSurveys.concat(window.SURVEY_DEMO || []));
    } catch (e) {}
    const isRealLineUidH = (uid) => /^U[a-f0-9]{32}$/i.test(String(uid || ''));
    const pendingConfirms = surveys.filter(s => !s.confirmedSlot && (s.q6_候補1 || s.q7_候補2 || s.q8_候補3) && isRealLineUidH(s.userId)).length;

    const noticeArea = document.getElementById('notice-area');
    if (noticeArea) {
      if (pendingConfirms > 0) {
        noticeArea.innerHTML = `
          <a href="#" data-jump="leadHub" style="display:block;background:linear-gradient(135deg,#fff8e1,#fff);border:2px solid #f0d36b;border-radius:12px;padding:18px 22px;margin-bottom:22px;text-decoration:none;color:inherit;box-shadow:var(--shadow-sm);">
            <div style="display:flex;align-items:center;gap:18px;">
              <div style="font-size:38px;line-height:1;">📅</div>
              <div style="flex:1;">
                <div style="font-family:'Noto Sans JP',sans-serif;font-size:15.5px;font-weight:700;color:#8a6f1e;letter-spacing:0.02em;">候補日確定待ち ${pendingConfirms} 件</div>
                <div style="font-size:12.5px;color:var(--ink-2);margin-top:3px;letter-spacing:0.01em;">公式LINEからアンケート+候補日3つを回答くれたお客様。「🆕 新規相談」タブで1つタップで確定 → Zoom URL自動発行 + LINE通知 + カレンダー登録 が一括で動きます。</div>
              </div>
              <div style="color:#8a6f1e;font-size:22px;font-weight:700;">→</div>
            </div>
          </a>`;
        noticeArea.querySelector('[data-jump]').addEventListener('click', (e) => {
          e.preventDefault();
          activateTab('leadHub');
        });
      } else {
        noticeArea.innerHTML = '';
      }
    }

    // SVG icons (line-art, currentColor)
    const icoUsers = '<svg class="kpi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    const icoCalendar = '<svg class="kpi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    const icoAlert = '<svg class="kpi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    const icoCoin = '<svg class="kpi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';

    document.getElementById('kpi-area').innerHTML = `
      <div class="kpi" data-tone="neutral">
        <div class="kpi-label">${icoUsers}<span>顧客総数</span><span class="kpi-delta kpi-delta-up">+2</span></div>
        <div class="kpi-value">${totalClients}<span class="unit">名</span></div>
        <div class="kpi-sub">うち重点 ${importantCount} 名</div>
        <canvas class="kpi-spark" data-spark="clients"></canvas>
      </div>
      <div class="kpi" data-tone="${upcoming3m > 0 ? 'warn' : 'neutral'}">
        <div class="kpi-label">${icoCalendar}<span>直近3ヶ月のイベント</span></div>
        <div class="kpi-value">${upcoming3m}<span class="unit">件</span></div>
        <div class="kpi-sub">大学入学 / 退職 / 相続 ほか</div>
        <canvas class="kpi-spark" data-spark="events"></canvas>
      </div>
      <div class="kpi" data-tone="${staleCount > 5 ? 'critical' : (staleCount > 0 ? 'warn' : 'positive')}">
        <div class="kpi-label">${icoAlert}<span>半年以上未接触</span><span class="kpi-delta kpi-delta-down">要対応</span></div>
        <div class="kpi-value">${staleCount}<span class="unit">名</span></div>
        <div class="kpi-sub">フォロー対象</div>
        <canvas class="kpi-spark" data-spark="stale"></canvas>
      </div>
      <div class="kpi" data-tone="neutral">
        <div class="kpi-label">${icoCoin}<span>管理資産総額</span><span class="kpi-delta kpi-delta-up">+3.2%</span></div>
        <div class="kpi-value">¥${fmtMoney(totalAum)}</div>
        <div class="kpi-sub">平均 ¥${fmtMoney(Math.round(totalAum / totalClients))}/名</div>
        <canvas class="kpi-spark" data-spark="aum"></canvas>
      </div>
    `;
    if (window.FPCharts && window.FPCharts.renderSparklines) window.FPCharts.renderSparklines();

    // ★ オーナーfb (v AL): ホームに「LINE 要返信」 を最上部に出す。緊急度が高いので顧客台帳の赤バッジより前面に
    renderUnreadLinesOnHome(clients);

    // 今日 話すべき客 — priority >= 65 (今週以上) に絞った上で top 8
    const tops = window.Recommender.topAcrossClients(clients, 30)
      .filter(t => t.topAction.priority >= 65)
      .slice(0, 8);
    const list = document.getElementById('action-list');
    if (tops.length === 0) {
      // ★ オーナーfb: 空の時の表示を整える (急ぎが無いことを明示 + 次の打ち手の導線)
      const todayDateE = window.LifeEvents.TODAY;
      const dormantCount = clients.filter(c => c.lineFriendId && c.lastContact && Math.floor((todayDateE - new Date(c.lastContact)) / 86400000) >= 21).length;
      const upcomingEvCount = (function(){
        let n = 0;
        clients.forEach(c => {
          (window.LifeEvents.generate(c) || []).forEach(ev => {
            const d = (ev.date - todayDateE) / 86400000;
            if (d >= 0 && d <= 30) n++;
          });
        });
        return n;
      })();
      list.innerHTML = `
        <div style="background:linear-gradient(135deg,#F0FDF4,#DCFCE7);border:1px solid #10B981;border-radius:14px;padding:32px 28px;text-align:center;font-family:'Noto Sans JP',sans-serif;">
          <div style="font-size:42px;margin-bottom:10px;">🌿</div>
          <h3 style="margin:0 0 8px 0;font-size:20px;font-weight:900;color:#065F46;letter-spacing:-0.01em;">今日は急ぎ対応すべき方はいません</h3>
          <p style="margin:0 0 22px 0;font-size:13.5px;color:#047857;line-height:1.7;">全 ${clients.length} 名と 直近 21日以内 に接触できています。<br>余裕のあるうちに、次の打ち手をどうぞ。</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button class="fp-empty-cta" data-go="dormantFollowup" style="background:#10B981;color:#fff;border:none;padding:11px 22px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.04em;box-shadow:0 4px 14px rgba(16,185,129,0.35);">🔔 ご無沙汰フォロー${dormantCount > 0 ? ` (${dormantCount}名)` : ''}</button>
            <button class="fp-empty-cta" data-go="timeline" style="background:#fff;color:#0F172A;border:1px solid #CBD5E1;padding:11px 22px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">📅 ライフイベント先取り${upcomingEvCount > 0 ? ` (${upcomingEvCount}件)` : ''}</button>
            <button class="fp-empty-cta" data-go="clients" style="background:#fff;color:#0F172A;border:1px solid #CBD5E1;padding:11px 22px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">👥 顧客台帳を見る</button>
          </div>
        </div>
      `;
      list.querySelectorAll('.fp-empty-cta').forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.go;
          document.querySelector(`.tab[data-tab="${tab}"]`)?.click();
        });
      });
      return;
    }

    const todayDate = window.LifeEvents.TODAY;
    const fmtMoneyAum = (v) => v >= 100000000 ? `¥${(v/100000000).toFixed(2)}億` : `¥${Math.round(v/10000).toLocaleString()}万`;

    // 各客に該当する KPI を判定
    function getClientKpis(c) {
      const days = Math.floor((todayDate - new Date(c.lastContact)) / 86400000);
      const kpis = [];
      // キャンセル後フォロー (30日以内)
      const lastCancel = (c.cancellations || []).slice().sort((a,b) => new Date(b.date) - new Date(a.date))[0];
      if (lastCancel && Math.floor((todayDate - new Date(lastCancel.date)) / 86400000) <= 30) {
        kpis.push({ id: 'cancel', label: 'キャンセル後フォロー', tone: 'critical' });
      }
      // 提案検討中 (30日以上)
      const stalled = (c.proposals || []).slice().reverse().find(p => (p.result === '検討中' || p.result === '提案中') && Math.floor((todayDate - new Date(p.date)) / 86400000) >= 30);
      if (stalled) {
        kpis.push({ id: 'stalled', label: '提案クロージング', tone: 'warn' });
      }
      // イベント先取り (60日以内 major)
      const evs = window.LifeEvents.generate(c) || [];
      const nearMajor = evs.find(ev => {
        const d = (ev.date - todayDate) / 86400000;
        return ev.major && d >= 0 && d <= 60;
      });
      if (nearMajor && days >= 21) {
        kpis.push({ id: 'event', label: 'イベント先取り', tone: 'warn' });
      }
      // 休眠
      if (c.status === 'dormant' || days >= 180) {
        kpis.push({ id: 'dormant', label: '休眠の再エンゲージ', tone: 'critical' });
      }
      // 月1接触 (30日以上未接触・非休眠)
      if (kpis.length === 0 && days >= 30 && c.status !== 'dormant') {
        kpis.push({ id: 'untouched', label: '月1接触', tone: 'warn' });
      }
      return kpis;
    }

    const briefCardHtml = (t, rank) => {
      const c = t.client;
      const p = t.topAction.priority;
      const initial = (c.name || '?').replace(/\s+/g, '').slice(0, 1);
      const days = Math.max(0, Math.floor((todayDate - new Date(c.lastContact)) / 86400000));
      const age = window.LifeEvents.currentAge(c);

      // Find next upcoming event
      const evs = window.LifeEvents.generate(c);
      const futureEv = evs.find(ev => new Date(ev.date) >= todayDate);
      const nextEvent = futureEv ? {
        title: futureEv.title || futureEv.kind || futureEv.name || 'イベント',
        rel: window.LifeEvents.formatRelative(new Date(futureEv.date))
      } : null;

      const priorityLabelText = priorityLabel(p);
      const priorityCls = priorityClass(p);

      const kpis = getClientKpis(c);
      const kpiBadgeHtml = kpis.map(k => `<span class="senior-kpi-badge senior-kpi-${k.tone}"><i data-lucide="target"></i>${escapeHtml(k.label)}</span>`).join('');

      const isTop = rank === 0;

      return `
        <div class="senior-card ${isTop ? 'senior-card-top' : ''}" data-client-id="${c.id}">
          <div class="senior-card-rank">${rank + 1}</div>
          <div class="senior-card-head">
            <div class="senior-card-avatar">${initial}</div>
            <div class="senior-card-id">
              <div class="senior-card-name">${escapeHtml(c.name)} <span class="senior-card-honor">様</span></div>
              <div class="senior-card-sub">${age}歳 ・ ${escapeHtml(c.occupation || '—')} ・ AUM ${fmtMoneyAum(c.aum)}</div>
              ${(function(){
                // ★ オーナーfb (v AR): ホームの今日のお客様カードでも タグを 表示
                const master = (typeof getTagsMaster === 'function') ? getTagsMaster() : [];
                const ids = (typeof getClientTags === 'function') ? getClientTags(c.id) : [];
                if (!ids.length) return '';
                const tags = ids.map(id => master.find(t => t.id === id)).filter(Boolean);
                return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${tags.map(t => { const col = validColor(t.color); return `<span style="background:${col}1A;color:${col};border:1px solid ${col}55;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:700;line-height:1.6;">${escapeHtml(t.label)}</span>`; }).join('')}</div>`;
              })()}
            </div>
          </div>

          <div class="senior-card-kpi">
            <div class="senior-kpi-label">この方に必要なフォロー</div>
            <div class="senior-kpi-badges">${kpiBadgeHtml || '<span class="senior-kpi-badge senior-kpi-info"><i data-lucide="info"></i>定期フォロー</span>'}</div>
          </div>

          <div class="senior-card-action">
            <div class="senior-action-label">やる事</div>
            <div class="senior-action-text">${escapeHtml(t.topAction.action)}</div>
            <div class="senior-action-reason">${escapeHtml(t.topAction.reason)}</div>
            ${nextEvent ? `<div class="senior-action-event">📅 次のイベント: <strong>${escapeHtml(nextEvent.title)}</strong> (${escapeHtml(nextEvent.rel)})</div>` : ''}
            <div class="senior-action-contact">⏰ 最終接触: <strong>${days == null ? '未記録' : days + '日前'}</strong></div>
          </div>

          ${(function(){
            // 状況に応じたすぐ送れるLINE文案を生成
            const fpHandleName = ((window.__fp?.tenantName || '').match(/^[^\s—\-]+/) || ['先生'])[0];
            let quickMsg = '';
            const kpi = kpis[0];
            if (kpi?.id === 'cancel') {
              quickMsg = `${c.name}さん、先日はご予定が合わず失礼しました。\nよろしければ改めてお時間を作れますか？\n候補日を3つご連絡いただければ調整いたします 🙏\n— ${fpHandleName}`;
            } else if (kpi?.id === 'stalled') {
              const prop = (c.proposals || []).slice().reverse().find(p => p.result === '検討中' || p.result === '提案中');
              quickMsg = `${c.name}さん、お世話になっております。\n先日ご提案した「${prop?.title || '件'}」について、\n何かご不明点はございますか？\n気軽にご連絡ください😊\n— ${fpHandleName}`;
            } else if (kpi?.id === 'event' && nextEvent) {
              quickMsg = `${c.name}さん、いつもありがとうございます。\n${nextEvent.title}が近づいてまいりましたね。\nお役に立てることがあればぜひご相談ください！\n— ${fpHandleName}`;
            } else if (kpi?.id === 'dormant') {
              quickMsg = `${c.name}さん、ご無沙汰しております 😊\nお元気でいらっしゃいますか？\n最近お伝えしたい情報がいくつかございます。\n30分ほどお時間はありますか？\n— ${fpHandleName}`;
            } else {
              quickMsg = `${c.name}さん、こんにちは！\nいつもありがとうございます。\n何かお役に立てることがあればお気軽にご連絡ください😊\n— ${fpHandleName}`;
            }
            return `
          <div class="senior-card-quick-msg" style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:9px;padding:11px 14px;margin:12px 0 14px;">
            <div style="font-size:10px;font-weight:900;color:#065F46;letter-spacing:0.08em;margin-bottom:5px;">💬 すぐ送れる文案</div>
            <div style="font-size:12px;color:#0F172A;line-height:1.7;white-space:pre-wrap;">${escapeHtml(quickMsg)}</div>
          </div>`;
          })()}
          <div class="senior-card-buttons">
            <button class="senior-btn senior-btn-primary" data-brief-open="${c.id}">
              <i data-lucide="message-square-text"></i>
              <span>文面を作って送る</span>
            </button>
            <button class="senior-btn senior-btn-secondary" data-brief-detail="${c.id}">
              <i data-lucide="user-round"></i>
              <span>詳細を見る</span>
            </button>
          </div>
        </div>`;
    };

    list.innerHTML = `
      <div class="senior-stack">
        ${tops.map((t, i) => briefCardHtml(t, i)).join('')}
      </div>
    `;
    const cnt = document.getElementById('senior-counter');
    if (cnt) cnt.textContent = tops.length + ' 名';

    // Wire actions
    list.querySelectorAll('[data-brief-open], [data-brief-detail]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.briefOpen || btn.dataset.briefDetail;
        openClientModal(id);
      });
    });
    list.querySelectorAll('[data-brief-snooze]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.brief-card, .brief-compact');
        if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; }
      });
    });
    list.querySelectorAll('.brief-card, .brief-compact').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openClientModal(card.dataset.clientId);
      });
    });
    list.querySelectorAll('.action-item').forEach(el => {
      el.addEventListener('click', () => openClientModal(el.dataset.clientId));
    });
  }

  // ============================
  // 顧客フォーム (新規/編集)
  // ============================
  function openClientForm(clientId) {
    const isNew = !clientId;
    const c = isNew ? {
      id: 'c' + String(Date.now()).slice(-5),
      name: '', kana: '', birth: '', gender: 'M',
      occupation: '', family: [], source: '',
      status: 'new', aum: 0, lastContact: TODAY.toISOString().slice(0, 10),
      proposals: [], note: '',
      lineFriendId: '', lineSubscribed: false,
    } : JSON.parse(JSON.stringify(clients.find(x => x.id === clientId)));

    function familyRowHtml(m, idx) {
      return `
        <div class="family-row" data-fidx="${idx}">
          <select data-f="rel">
            <option value="spouse" ${m.rel === 'spouse' ? 'selected' : ''}>配偶者</option>
            <option value="child" ${m.rel === 'child' ? 'selected' : ''}>お子様</option>
            <option value="parent" ${m.rel === 'parent' ? 'selected' : ''}>親</option>
          </select>
          <input type="text" placeholder="お名前" data-f="name" value="${escapeHtml(m.name || '')}">
          <input type="date" data-f="birth" value="${m.birth || ''}">
          <button class="ghost del-family">×</button>
        </div>
      `;
    }

    const html = `
      <div class="modal-header">
        <h2>${isNew ? '新規顧客の登録' : '顧客情報の編集'}</h2>
        <button class="modal-close" id="form-close-btn">×</button>
      </div>
      <div class="modal-body">
        <div class="form-section">
          <h3>基本情報</h3>
          <div class="form-grid">
            <div class="form-row"><label>お名前 *</label><input type="text" id="f-name" value="${escapeHtml(c.name)}" placeholder="例: 田中 健一"></div>
            <div class="form-row"><label>フリガナ</label><input type="text" id="f-kana" value="${escapeHtml(c.kana)}" placeholder="たなか けんいち"></div>
            <div class="form-row"><label>生年月日 *</label><input type="date" id="f-birth" value="${c.birth || ''}"></div>
            <div class="form-row"><label>性別</label>
              <select id="f-gender">
                <option value="M" ${c.gender === 'M' ? 'selected' : ''}>男性</option>
                <option value="F" ${c.gender === 'F' ? 'selected' : ''}>女性</option>
                <option value="O" ${c.gender === 'O' ? 'selected' : ''}>その他</option>
              </select>
            </div>
            <div class="form-row"><label>職業</label><input type="text" id="f-occupation" value="${escapeHtml(c.occupation)}" placeholder="例: 会社員 (IT)"></div>
            <div class="form-row"><label>流入経路</label><input type="text" id="f-source" value="${escapeHtml(c.source)}" placeholder="例: 紹介・セミナー・Instagram"></div>
            <div class="form-row"><label>ステータス</label>
              <select id="f-status">
                <option value="new" ${c.status === 'new' ? 'selected' : ''}>新規</option>
                <option value="active" ${c.status === 'active' ? 'selected' : ''}>管理中</option>
                <option value="important" ${c.status === 'important' ? 'selected' : ''}>重点</option>
                <option value="dormant" ${c.status === 'dormant' ? 'selected' : ''}>休眠</option>
              </select>
            </div>
            <div class="form-row"><label>管理資産 (円)</label><input type="number" id="f-aum" value="${c.aum || 0}" step="100000"></div>
            <div class="form-row"><label>最終接触日</label><input type="date" id="f-last-contact" value="${c.lastContact || ''}"></div>
          </div>
        </div>

        <div class="form-section">
          <h3>家族構成 <button class="ghost" id="add-family-btn" style="margin-left:8px;">+ 追加</button></h3>
          <div id="family-list">
            ${(c.family || []).map((m, i) => familyRowHtml(m, i)).join('')}
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:6px;">家族の生年月日を入れると、進学・退職などのライフイベントが自動でタイムラインに展開されます。</div>
        </div>

        <div class="form-section">
          <h3>住宅ローン (任意)</h3>
          <div class="form-grid">
            <div class="form-row"><label>残り年数</label><input type="number" id="f-mort-years" value="${c.mortgage ? c.mortgage.remainingYears : ''}" placeholder="例: 25"></div>
            <div class="form-row"><label>月返済額 (円)</label><input type="number" id="f-mort-monthly" value="${c.mortgage ? c.mortgage.monthly : ''}" step="1000" placeholder="例: 95000"></div>
          </div>
        </div>

        <div class="form-section">
          <h3>LINE公式連携</h3>
          <div class="form-grid">
            <div class="form-row"><label>LINE friend ID</label><input type="text" id="f-line-id" value="${escapeHtml(c.lineFriendId || '')}" placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div>
            <div class="form-row"><label>連携状態</label>
              <label class="toggle-switch" style="margin-top:4px;">
                <input type="checkbox" id="f-line-sub" ${c.lineSubscribed ? 'checked' : ''}><span></span>
              </label>
              <div style="font-size:11px;color:var(--muted);margin-top:3px;">ONで配信対象に含まれます</div>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h3>メモ</h3>
          <textarea id="f-note" rows="3" style="width:100%;resize:vertical;">${escapeHtml(c.note || '')}</textarea>
        </div>

        <div style="display:flex;gap:8px;margin-top:18px;">
          <button class="primary" id="form-save-btn">${isNew ? '登録' : '保存'}</button>
          <button id="form-cancel-btn">キャンセル</button>
          ${!isNew ? '<button id="form-delete-btn" style="margin-left:auto;border-color:var(--red);color:var(--red);">削除</button>' : ''}
        </div>
      </div>
    `;
    document.getElementById('form-content').innerHTML = html;
    document.getElementById('form-overlay').style.display = 'flex';

    let familyList = (c.family || []).slice();

    function rerenderFamily() {
      document.getElementById('family-list').innerHTML =
        familyList.map((m, i) => familyRowHtml(m, i)).join('');
      bindFamilyEvents();
    }
    function bindFamilyEvents() {
      document.querySelectorAll('.family-row').forEach(row => {
        const idx = parseInt(row.dataset.fidx, 10);
        row.querySelectorAll('[data-f]').forEach(input => {
          input.addEventListener('change', () => {
            familyList[idx][input.dataset.f] = input.value;
          });
        });
        row.querySelector('.del-family').addEventListener('click', () => {
          familyList.splice(idx, 1);
          rerenderFamily();
        });
      });
    }
    bindFamilyEvents();

    document.getElementById('add-family-btn').addEventListener('click', () => {
      familyList.push({ rel: 'child', name: '', birth: '' });
      rerenderFamily();
    });

    function close() { document.getElementById('form-overlay').style.display = 'none'; }
    document.getElementById('form-close-btn').addEventListener('click', close);
    document.getElementById('form-cancel-btn').addEventListener('click', close);

    document.getElementById('form-save-btn').addEventListener('click', async () => {
      const name = document.getElementById('f-name').value.trim();
      const birth = document.getElementById('f-birth').value;
      if (!name || !birth) {
        alert('お名前と生年月日は必須です');
        return;
      }
      c.name = name;
      c.kana = document.getElementById('f-kana').value;
      c.birth = birth;
      c.gender = document.getElementById('f-gender').value;
      c.occupation = document.getElementById('f-occupation').value;
      c.source = document.getElementById('f-source').value;
      c.status = document.getElementById('f-status').value;
      c.aum = parseInt(document.getElementById('f-aum').value, 10) || 0;
      c.lastContact = document.getElementById('f-last-contact').value;
      c.note = document.getElementById('f-note').value;
      c.lineFriendId = document.getElementById('f-line-id').value;
      c.lineSubscribed = document.getElementById('f-line-sub').checked;
      const mortYears = parseInt(document.getElementById('f-mort-years').value, 10);
      const mortMonthly = parseInt(document.getElementById('f-mort-monthly').value, 10);
      if (mortYears && mortMonthly) {
        c.mortgage = { remainingYears: mortYears, monthly: mortMonthly };
      } else {
        delete c.mortgage;
      }
      c.family = familyList.filter(f => f.name && f.birth);

      if (isNew) {
        clients.push(c);
      } else {
        const idx = clients.findIndex(x => x.id === clientId);
        if (idx >= 0) clients[idx] = c;
      }
      saveClientsToLS();
      // 2026-07-02 persist-fix: 編集を Firestore に同期 (再ログイン/別端末で消える bug 対応)
      try { await persistClientToFirestore(c); }
      catch (e) { console.warn('[persist] Firestore sync fail:', e); }
      close();
      // モーダルが開いていれば閉じる
      document.getElementById('modal-overlay').style.display = 'none';
      activateTab(state.activeTab);
    });

    const delBtn = document.getElementById('form-delete-btn');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('この顧客を削除しますか?')) return;
      const idx = clients.findIndex(x => x.id === clientId);
      const target = idx >= 0 ? clients[idx] : null;
      if (idx >= 0) clients.splice(idx, 1);
      saveClientsToLS();
      if (target) {
        try { await persistClientDeleteToFirestore(target); }
        catch (e) { console.warn('[persist] Firestore delete fail:', e); }
      }
      close();
      document.getElementById('modal-overlay').style.display = 'none';
      activateTab(state.activeTab);
    });
  }

  function saveClientsToLS() {
    try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(clients)); } catch (e) {}
  }

  // 2026-07-02 persist-fix: 顧客編集/新規/削除 を Firestore と 同期
  //   経緯: openClientForm の save は localStorage のみ書込 → 再ログイン/別端末で消失。
  //   実顧客 (福田様 tenants/fukuda) の 2026-07-02 07:22 報告 が発端。
  //   memory: feedback_demo_to_prod_save_path_audit.md
  async function _persistLoadFirebase() {
    const [{ getFirestore, doc, setDoc, deleteDoc, serverTimestamp }, { initializeApp, getApps }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
    ]);
    const app = getApps()[0] || initializeApp({
      apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
      authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
      projectId: 'skeleton-fp-compass-632026',
    });
    return { db: getFirestore(app), doc, setDoc, deleteDoc, serverTimestamp };
  }
  function _persistTenantId() {
    return (window.__fp && window.__fp.tenantId)
      || (window.AccountInfo && window.AccountInfo.tenantId)
      || localStorage.getItem('fp-tenantId')
      || '';
  }
  function _persistFsDocId(c) {
    // Firestore 由来 → 手動作成 id (fs- prefix は Firestore 側 docId に落とす)
    if (c._fsCustomerId) return c._fsCustomerId;
    if (c.docId) return c.docId;
    if (c.id && String(c.id).startsWith('fs-')) return String(c.id).slice(3);
    return c.id || '';
  }
  async function persistClientToFirestore(c) {
    const tenantId = _persistTenantId();
    if (!tenantId) return;
    const fsId = _persistFsDocId(c);
    if (!fsId) return;
    const { db, doc, setDoc, serverTimestamp } = await _persistLoadFirebase();
    const payload = {
      name: c.name || '',
      kana: c.kana || '',
      birth: c.birth || '',
      gender: c.gender || '',
      occupation: c.occupation || '',
      source: c.source || 'manual',
      status: c.status || 'new',
      aum: c.aum || 0,
      lastContact: c.lastContact || '',
      note: c.note || '',
      lineFriendId: c.lineFriendId || '',
      lineSubscribed: !!c.lineSubscribed,
      family: c.family || [],
      updatedAt: serverTimestamp(),
    };
    if (c.mortgage) payload.mortgage = c.mortgage;
    await setDoc(doc(db, 'tenants', tenantId, 'customers', fsId), payload, { merge: true });
    console.log('[persist] Firestore write OK', tenantId, fsId);
  }
  async function persistClientDeleteToFirestore(c) {
    const tenantId = _persistTenantId();
    if (!tenantId) return;
    const fsId = _persistFsDocId(c);
    if (!fsId) return;
    const { db, doc, deleteDoc } = await _persistLoadFirebase();
    await deleteDoc(doc(db, 'tenants', tenantId, 'customers', fsId));
    console.log('[persist] Firestore delete OK', tenantId, fsId);
  }
  function loadClientsFromLS() {
    try {
      const raw = localStorage.getItem('fp-crm-clients-v1');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  // LINE 実アクション (lastActionAt + pictureUrl) で顧客のフィールドを上書き
  // + LINE 友だちで まだ clients に居ない人 を自動で顧客一覧に追加
  // + line_messages を各 client.lineHistory にマージ (オーナーfb「客返信反映されない」)
  function mergeLineActivity() {
    const liveData = window.LineAppLiveData || {};
    const liveUsers = liveData.users || [];
    const liveMsgs = liveData.line_messages || [];
    // ★ STEP 0: liveData.users から displayName 一致 client の lineFriendId を実値に補正
    if (liveUsers.length > 0) {
      liveUsers.forEach(u => {
        if (!u.userId || !u.displayName) return;
        const c = clients.find(x => String(x.name || '').trim() === u.displayName.trim());
        if (c && c.lineFriendId !== u.userId) {
          console.log('[mergeLine] lineFriendId 補正', c.name, ':', c.lineFriendId, '→', u.userId);
          c.lineFriendId = u.userId;
        }
      });
    }
    // ★ STEP 0.5: line_messages を各 client.lineHistory に重複除去マージ
    if (liveMsgs.length > 0) {
      let merged = 0;
      liveMsgs.forEach(m => {
        if (!m.userId || !m.text) return;
        let c = clients.find(x => x.lineFriendId === m.userId);
        if (!c && m.name) {
          // Fallback: match by display name, then fix lineFriendId for future matching
          c = clients.find(x => String(x.name || '').trim() === String(m.name || '').trim());
          if (c && m.userId) c.lineFriendId = m.userId;
        }
        if (!c) return;
        if (!Array.isArray(c.lineHistory)) c.lineHistory = [];
        const ts = String(m.ts || '').slice(0, 19);
        const seen = c.lineHistory.some(h => String(h.ts || '').slice(0, 19) === ts && (h.text || h.message) === m.text);
        if (seen) return;
        const entry = { from: 'user', direction: 'in', text: m.text, message: m.text, ts: m.ts, date: String(m.ts || '').slice(0, 10), source: 'gas-webhook' };
        c.lineHistory.push(entry);
        try {
          const key = 'fp-line-history-' + c.id;
          const arr = JSON.parse(localStorage.getItem(key) || '[]');
          arr.push(entry);
          // ★ Critical-C: cap 500件 (古いから drop) — quota 突破 防止
          const _capped = arr.length > 500 ? arr.slice(-500) : arr;
          localStorage.setItem(key, JSON.stringify(_capped));
        } catch (_) {}
        merged++;
      });
      if (merged > 0) {
        try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS || clients)); } catch (_) {}
        console.log('[mergeLine] line_messages merged', merged, 'msgs');
      }
    }
    if (liveUsers.length === 0) return;
    const byUid = {};
    liveUsers.forEach(u => { if (u.userId) byUid[u.userId] = u; });
    // 既存 client 更新
    clients.forEach(c => {
      const u = byUid[c.lineFriendId];
      if (!u) return;
      const liveTs = u.lastActionAt || u.addedAt;
      if (liveTs) {
        const liveDate = String(liveTs).slice(0, 10);
        if (!c.lastContact || liveDate > c.lastContact) {
          c.lastContact = liveDate;
          c.lastActionType = u.lastActionType || '';
        }
      }
      if (u.pictureUrl) c.linePictureUrl = u.pictureUrl;
    });
    // 新規 LINE 友だちを clients に追加 (未管理顧客として)
    const isRealUid = (uid) => /^U[a-f0-9]{32}$/i.test(String(uid || ''));
    const knownUids = new Set(clients.map(c => c.lineFriendId).filter(Boolean));
    const knownNames = new Set(clients.map(c => String(c.name || '').trim()).filter(Boolean));
    liveUsers.forEach(u => {
      if (!isRealUid(u.userId)) return;
      if (knownUids.has(u.userId)) return;
      const name = (u.displayName || '').trim();
      if (name && knownNames.has(name)) {
        // 同名既存 client があれば 実 LINE userId に上書き (架空のdummy lineFriendId を実値で置換)
        // 真因: dummy-data の架空 lineFriendId (U5b483...) と GAS Webhook の実 userId (Ub85fb...) が違って merge 失敗してた
        const c = clients.find(x => String(x.name || '').trim() === name);
        if (c) {
          if (c.lineFriendId !== u.userId) {
            console.log('[mergeLine] overwrite lineFriendId for', name, ':', c.lineFriendId, '→', u.userId);
            c.lineFriendId = u.userId;
          }
          if (u.pictureUrl) c.linePictureUrl = u.pictureUrl;
        }
        return;
      }
      // 完全新規 → クライアント追加
      const newC = {
        id: 'c-line-' + u.userId.slice(1, 9),
        name: name || ('LINE友だち ' + u.userId.slice(1, 7)),
        kana: '',
        birth: '',  // ★ 全員41歳問題の元凶。 アンケート q10_生年月日 受信時に自動補完
        gender: 'O',
        occupation: '',
        family: [],
        proposals: [],
        aum: 0,
        status: 'new',
        source: 'LINE友だち追加',
        lineFriendId: u.userId,
        linePictureUrl: u.pictureUrl || '',
        lastContact: String(u.lastActionAt || u.addedAt || new Date().toISOString()).slice(0, 10),
        lastActionType: u.lastActionType || '',
        autoFromLine: true,  // 自動取込フラグ (識別用)
      };
      clients.push(newC);
      knownUids.add(u.userId);
      if (name) knownNames.add(name);
    });
  }

  // ============================
  // 顧客一覧
  // ============================
  // line-app.js から呼ばれる: 顧客台帳の再描画
  // ★ 2026-06-26 重さ解消 Phase 5: 背景polling 由来の連打は debounce/dedup する
  //   options.immediate = true で 即時 render (ユーザー操作 直後 等)
  window.FPCrmRefreshClients = function(options) {
    options = options || {};
    if (options.immediate) {
      _lastClientsSig = clientsSignature();
      try { renderClients(); } catch (e) { console.warn('FPCrmRefreshClients immediate fail:', e); }
    } else {
      scheduleBgRenderClients();
    }
    // ★ Firestore 顧客 (line_survey + 候補日待ち) を line-app の lead hub に 反映
    if (window.refreshFirestoreCustomers) {
      try { window.refreshFirestoreCustomers(); } catch (_) {}
    }
  };

  function renderContactFilterTabs(buckets) {
    let bar = document.getElementById('contact-filter-bar');
    if (!bar) {
      // 顧客台帳のトップに動的に挿入
      const toolbar = document.querySelector('.client-toolbar');
      if (!toolbar) return;
      bar = document.createElement('div');
      bar.id = 'contact-filter-bar';
      bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;background:linear-gradient(135deg,#fafbfc,#f1f5f9);border:1px solid var(--line);border-radius:10px;align-items:center;';
      bar.innerHTML = '<span style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-right:6px;">📞 最終接触</span>';
      toolbar.parentNode.insertBefore(bar, toolbar);
    }
    const tabs = [
      { v: 'all', label: '全て', count: buckets.all, color: '' },
      { v: 'lt30', label: '〜30日', count: buckets.lt30, color: '#06c755' },
      { v: 'lt90', label: '31〜90日', count: buckets.lt90, color: '#0ea5e9' },
      { v: 'lt180', label: '91〜180日', count: buckets.lt180, color: '#f59e0b' },
      { v: 'lt365', label: '181〜365日', count: buckets.lt365, color: '#f97316' },
      { v: 'gt365', label: '1年以上 未接触', count: buckets.gt365, color: '#d9264c' },
    ];
    bar.innerHTML = '<span style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-right:6px;">📞 最終接触</span>' +
      tabs.map(t => {
        const active = (state.contactFilter || 'all') === t.v;
        const bg = active ? (t.color || '#1f2937') : '#fff';
        const fg = active ? '#fff' : (t.color || '#374151');
        const bd = active ? bg : '#e5e7eb';
        return `<button data-cfilter="${t.v}" style="font-size:12px;padding:6px 12px;border-radius:18px;background:${bg};color:${fg};border:1.5px solid ${bd};cursor:pointer;font-weight:${active?'700':'500'};font-family:inherit;transition:all 0.15s;">${t.label} <span style="font-size:11px;opacity:0.85;margin-left:2px;">(${t.count})</span></button>`;
      }).join('');
    bar.querySelectorAll('[data-cfilter]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.contactFilter = btn.dataset.cfilter;
        saveState();
        renderClients();
      });
    });
  }

  // ★ 王道金融商品 マスタ (CRM全体で共通利用)
  window.FP_PRODUCTS_DEF = [
    { key: 'NISA',      short: 'NISA',     pattern: /NISA/i },
    { key: 'iDeCo',     short: 'iDeCo',    pattern: /iDeCo|企業型|個人型|DC/i },
    { key: '投資信託',  short: '投信',     pattern: /投信|投資信託/ },
    { key: '個別株',    short: '株',       pattern: /個別株|株式|個株/ },
    { key: '定期預金',  short: '預金',     pattern: /定期預金|預金/ },
    { key: '生命保険',  short: '生保',     pattern: /生命保険|終身|定期保険|学資/ },
    { key: '医療保険',  short: '医療',     pattern: /医療保険|がん保険|共済/ },
    { key: '不動産',    short: '不動産',   pattern: /不動産/ },
    { key: '住宅ローン', short: '住宅',    pattern: /住宅ローン|住宅ロ|住宅L/ },
    { key: '個人年金',  short: '個人年金', pattern: /個人年金/ },
  ];

  // ★ 列カスタマイズ: localStorage 保存式
  const COL_PREF_KEY = 'fp-crm-cols-v1';
  const COL_DEFS = [
    { id: 'col-occ',      label: '職業',           default: true },
    { id: 'col-family',   label: '家族',           default: true },
    { id: 'col-urgency',  label: '緊急度',         default: true },
    { id: 'col-worry',    label: '一番の悩み',     default: false },
    { id: 'col-goal',     label: '5-10年後の希望', default: false },
    { id: 'col-products', label: '保有商品 (NISA/iDeCo/保険等)', default: true },
    { id: 'col-aum',      label: '管理資産',       default: true },
  ];
  function getColPrefs() {
    try {
      const stored = JSON.parse(localStorage.getItem(COL_PREF_KEY) || '{}');
      const merged = {};
      COL_DEFS.forEach(c => { merged[c.id] = stored[c.id] !== undefined ? stored[c.id] : c.default; });
      return merged;
    } catch (_) { return Object.fromEntries(COL_DEFS.map(c => [c.id, c.default])); }
  }
  function saveColPrefs(prefs) { try { localStorage.setItem(COL_PREF_KEY, JSON.stringify(prefs)); } catch (_) {} }
  function applyColPrefs() {
    const prefs = getColPrefs();
    COL_DEFS.forEach(c => {
      document.querySelectorAll('.' + c.id).forEach(el => {
        el.style.display = prefs[c.id] ? '' : 'none';
      });
    });
  }
  function openColConfigPopover(anchor) {
    const existing = document.getElementById('col-config-pop');
    if (existing) { existing.remove(); return; }
    const prefs = getColPrefs();
    const rect = anchor.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.id = 'col-config-pop';
    pop.style.cssText = `position:fixed;top:${rect.bottom + 6}px;right:${window.innerWidth - rect.right}px;background:#fff;border:1px solid #e3e7ee;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.18);padding:12px 14px;z-index:10010;min-width:220px;font-family:inherit;`;
    pop.innerHTML = `
      <div style="font-size:11.5px;color:#7b8499;font-weight:700;letter-spacing:0.08em;margin-bottom:8px;">列の表示</div>
      ${COL_DEFS.map(c => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;font-size:13px;">
          <input type="checkbox" data-col="${c.id}" ${prefs[c.id] ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:#1B3A5C;">
          ${c.label}
        </label>
      `).join('')}
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid #f0f2f7;font-size:10.5px;color:#7b8499;">アンケート回答が無いお客様は「-」表示</div>
    `;
    document.body.appendChild(pop);
    pop.querySelectorAll('input[data-col]').forEach(cb => {
      cb.addEventListener('change', () => {
        const p = getColPrefs();
        p[cb.dataset.col] = cb.checked;
        saveColPrefs(p);
        applyColPrefs();
      });
    });
    setTimeout(() => {
      document.addEventListener('click', function onOut(e) {
        if (!pop.contains(e.target) && e.target !== anchor) {
          pop.remove();
          document.removeEventListener('click', onOut);
        }
      });
    }, 0);
  }

  function renderClients() {
    const searchEl = document.getElementById('client-search');
    const filterEl = document.getElementById('status-filter');
    if (searchEl.value !== state.search) searchEl.value = state.search;
    if (filterEl.value !== state.statusFilter) filterEl.value = state.statusFilter;

    mergeLineActivity();
    // ★ 全 client に 議事録 自動タグ を 一括 反映 (顧客一覧でも 出るように)
    try { autoTagAllClients(); } catch (e) { console.warn('autoTagAllClients:', e); }
    // ★ 2026-06-22 roundI: タグ filter UI を 動的描画
    try { renderClientTagSegmentBar(); } catch (e) { console.warn('tagSegmentBar:', e); }
    const q = state.search.trim().toLowerCase();
    let list = clients.slice();
    if (state.statusFilter !== 'all') {
      list = list.filter(c => c.status === state.statusFilter);
    }
    // ★ タグ filter (state.tagFilter は タグID配列、 OR マッチ = どれか1つでもタグついてる)
    state.tagFilter = state.tagFilter || [];
    if (state.tagFilter.length > 0) {
      list = list.filter(c => {
        const myTags = (typeof getClientTags === 'function') ? getClientTags(c.id) : [];
        return state.tagFilter.some(t => myTags.includes(t));
      });
    }
    if (q) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.kana.includes(q) ||
        (c.occupation || '').toLowerCase().includes(q)
      );
    }
    // 最終接触フィルタ
    if (state.contactFilter && state.contactFilter !== 'all') {
      list = list.filter(c => {
        const d = daysSince(c.lastContact);
        if (state.contactFilter === 'lt30') return d <= 30;
        if (state.contactFilter === 'lt90') return d > 30 && d <= 90;
        if (state.contactFilter === 'lt180') return d > 90 && d <= 180;
        if (state.contactFilter === 'lt365') return d > 180 && d <= 365;
        if (state.contactFilter === 'gt365') return d > 365;
        return true;
      });
    }
    // 並び替え
    const statusRank = { important: 0, active: 1, new: 2, dormant: 3 };
    const sortMode = state.sortBy || 'contact-asc';
    const sorter = {
      'contact-desc': (a, b) => daysSince(b.lastContact) - daysSince(a.lastContact),
      'contact-asc':  (a, b) => daysSince(a.lastContact) - daysSince(b.lastContact),
      'aum-desc':     (a, b) => (b.aum || 0) - (a.aum || 0),
      'aum-asc':      (a, b) => (a.aum || 0) - (b.aum || 0),
      'age-desc':     (a, b) => window.LifeEvents.currentAge(b) - window.LifeEvents.currentAge(a),
      'age-asc':      (a, b) => window.LifeEvents.currentAge(a) - window.LifeEvents.currentAge(b),
      'name-asc':     (a, b) => String(a.kana || a.name || '').localeCompare(String(b.kana || b.name || ''), 'ja'),
      'status':       (a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9),
      'event-near':   (a, b) => {
        const ea = window.LifeEvents.generate(a)[0];
        const eb = window.LifeEvents.generate(b)[0];
        const da = ea ? new Date(ea.date).getTime() : Infinity;
        const db = eb ? new Date(eb.date).getTime() : Infinity;
        return da - db;
      },
    }[sortMode] || ((a, b) => 0);
    list.sort(sorter);
    // sortBy セレクトに現状値反映
    const sortEl = document.getElementById('sort-by');
    if (sortEl && sortEl.value !== sortMode) sortEl.value = sortMode;

    // 各バケットのカウント (フィルタ前の母集団から)
    const buckets = { all: clients.length, lt30: 0, lt90: 0, lt180: 0, lt365: 0, gt365: 0 };
    clients.forEach(c => {
      const d = daysSince(c.lastContact);
      if (d <= 30) buckets.lt30++;
      else if (d <= 90) buckets.lt90++;
      else if (d <= 180) buckets.lt180++;
      else if (d <= 365) buckets.lt365++;
      else buckets.gt365++;
    });
    renderContactFilterTabs(buckets);

    document.getElementById('client-count').textContent = `${list.length} / ${clients.length} 名`;

    const tbody = document.getElementById('client-tbody');
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">該当する顧客がいません</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(c => {
      const dslRaw = daysSince(c.lastContact);
      const isUncontacted = dslRaw == null;  // ★ null日前 バグ修正: 未接触は 専用バッジ
      const dsl = isUncontacted ? 99999 : Math.max(0, dslRaw); // 未接触は 計算上 1年超扱い
      const contactCls = (isUncontacted || dsl >= 365) ? 'contact-stale' : (dsl >= 180 ? 'contact-warn' : '');
      // 接触経過のラベル
      const contactBg = isUncontacted ? '#F1F5F9' : (dsl <= 30 ? '#dcfce7' : (dsl <= 90 ? '#dbeafe' : (dsl <= 180 ? '#fef3c7' : (dsl <= 365 ? '#fed7aa' : '#fecaca'))));
      const contactFg = isUncontacted ? '#64748B' : (dsl <= 30 ? '#166534' : (dsl <= 90 ? '#1e40af' : (dsl <= 180 ? '#92400e' : (dsl <= 365 ? '#9a3412' : '#991b1b'))));
      const contactLabel = isUncontacted ? '未接触' : (dsl <= 30 ? '直近' : (dsl <= 90 ? '3ヶ月以内' : (dsl <= 180 ? '半年以内' : (dsl <= 365 ? '1年以内' : '1年超'))));
      const dayDisplay = isUncontacted ? '記録なし' : (dslRaw < 0 ? `${Math.abs(dslRaw)}日後 予定` : (dslRaw === 0 ? '今日' : `${dslRaw}日前`));
      // localStorage に保存されたタスク件数
      const taskCount = (JSON.parse(localStorage.getItem('fp-tasks-' + (c.lineFriendId || c.id)) || '[]')).length;
      const childCount = (c.family || []).filter(m => m.rel === 'child').length;
      const familyTxt = childCount > 0 ? `配偶者+子${childCount}` :
        ((c.family || []).find(m => m.rel === 'spouse') ? '夫婦' : '単身');
      const initial = (c.name || '?').replace(/\s+/g, '').slice(0, 1);
      const hue = (initial.charCodeAt(0) || 0) % 360;
      return `
        <tr data-client-id="${c.id}">
          <td>
            <div class="client-row-name">
              ${c.linePictureUrl
                ? `<span class="avatar avatar-sm" style="position:relative;padding:0;background:none;border:1.5px solid #06c755;overflow:visible;"><img src="${escapeHtml(c.linePictureUrl)}" data-fallback-initial="${escapeHtml(initial)}" data-fallback-hue="${hue}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"><span title="LINE友だち" style="position:absolute;bottom:-3px;right:-3px;background:#06c755;color:#fff;width:14px;height:14px;border-radius:50%;font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-family:inherit;">L</span></span>`
                : `<span class="avatar avatar-sm" style="--avh:${hue};position:relative;">${escapeHtml(initial)}${c.lineFriendId ? '<span title="LINE友だち" style="position:absolute;bottom:-3px;right:-3px;background:#06c755;color:#fff;width:14px;height:14px;border-radius:50%;font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-family:inherit;">L</span>' : ''}</span>`}
              <div>
                <strong>${escapeHtml(c.name)}</strong>${c.lineFriendId ? '<span style="font-size:9.5px;color:#06c755;font-weight:700;margin-left:5px;background:#dcfce7;padding:1px 5px;border-radius:6px;letter-spacing:0.05em;">LINE</span>' : ''}${c.source === 'line_follow' ? '<span title="友だち追加済みだが 事前アンケート 未回答" style="font-size:9.5px;color:#9A3412;font-weight:700;margin-left:5px;background:#FFEDD5;padding:1px 5px;border-radius:6px;letter-spacing:0.05em;">アンケ未回答</span>' : ''}
                <div style="font-size:11px;color:var(--muted);letter-spacing:0.02em;">${escapeHtml(c.kana)}</div>
                ${(function(){
                  const master = getTagsMaster();
                  const myTagIds = getClientTags(c.id);
                  const myTags = myTagIds.map(id => master.find(t => t.id === id)).filter(Boolean);
                  // ★ 議事録から AI が拾った 自動タグ (NISA/iDeCo/保険 等) を 末尾に 出す
                  const autoTags = Array.isArray(c.autoTags) ? c.autoTags : [];
                  if (myTags.length === 0 && autoTags.length === 0) return '';
                  // 重複除去 (label一致)
                  const seenLabels = new Set(myTags.map(t => t.label));
                  const autoUniq = autoTags.filter(t => !seenLabels.has(t.label));
                  const manualHtml = myTags.map(t => { const col = validColor(t.color); return `<span style="background:${col};color:#fff;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;line-height:1.4;letter-spacing:0.03em;box-shadow:0 2px 6px ${col}66;">${escapeHtml(t.label)}</span>`; }).join('');
                  const autoHtml = autoUniq.map(t => { const col = validColor(t.color); return `<span title="議事録から AI 自動抽出" style="background:${col}1A;color:${col};border:1.5px dashed ${col}80;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:800;line-height:1.4;letter-spacing:0.03em;">${escapeHtml(t.label)}<span style="font-size:8px;margin-left:3px;opacity:0.7;">AI</span></span>`; }).join('');
                  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${manualHtml}${autoHtml}</div>`;
                })()}
              </div>
            </div>
          </td>
          <td>${window.LifeEvents.currentAge(c) ?? '<span style="color:var(--muted);">-</span>'}</td>
          <td class="hide-mobile col-occ">${escapeHtml(c.occupation)}</td>
          <td class="col-family">${familyTxt}</td>
          ${(function(){
            // ★ アンケート q15_緊急度 / q9_悩み / q14_理想 を列挿入 (列設定でON時のみ表示)
            const surveys = (window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [];
            const s = surveys.find(x => (x.userId && x.userId === c.lineFriendId) || (x.name && x.name === c.name)) || {};
            const trim = (v, n) => { v = String(v || '').trim(); return v.length > n ? v.slice(0, n) + '…' : v; };
            const urgencyTxt = s.q15_緊急度 || '';
            const urgencyBg = /すぐ/.test(urgencyTxt) ? '#fee2e2' : /数ヶ月/.test(urgencyTxt) ? '#fef3c7' : /情報/.test(urgencyTxt) ? '#e0e7ff' : '#f3f4f6';
            const urgencyFg = /すぐ/.test(urgencyTxt) ? '#991b1b' : /数ヶ月/.test(urgencyTxt) ? '#92400e' : /情報/.test(urgencyTxt) ? '#3730a3' : '#6b7280';
            // 保有商品: q7_保有 (アンケート) + q14_既存商品 (自由記述) + FP手動追加 を統合
            // クリックでON/OFFトグル可能 → c.productsManual[] に保存
            const PRODUCTS = window.FP_PRODUCTS_DEF;
            const ownedRaw = String(s.q7_保有 || '') + ' ' + String(s.q14_既存商品 || '') + ' ' + (c.mortgage ? '住宅ローン' : '');
            const manualSet = new Set(c.productsManual || []);
            const removedSet = new Set(c.productsRemoved || []);
            const productChips = PRODUCTS.map(p => {
              const fromSurvey = p.pattern.test(ownedRaw);
              const has = (fromSurvey || manualSet.has(p.key)) && !removedSet.has(p.key);
              return `<span data-prod-toggle="${escapeHtml(c.id)}" data-prod-key="${escapeHtml(p.key)}" title="クリックで ${has ? '未加入' : '加入済'} に変更" style="display:inline-block;font-size:9.5px;font-weight:${has ? 800 : 600};padding:2px 6px;border-radius:8px;letter-spacing:0.02em;background:${has ? '#dcfce7' : '#f3f4f6'};color:${has ? '#166534' : '#9ca3af'};border:1px solid ${has ? '#86efac' : '#e5e7eb'};margin:1px 2px 1px 0;cursor:pointer;user-select:none;">${has ? '✓' : '–'} ${p.short}</span>`;
            }).join('');
            const hasAnyData = !!(s.q7_保有 || s.q14_既存商品 || c.mortgage || (c.productsManual && c.productsManual.length));
            return `
              <td class="col-urgency" style="display:none;">${urgencyTxt ? `<span style="background:${urgencyBg};color:${urgencyFg};padding:3px 9px;border-radius:11px;font-size:11px;font-weight:700;letter-spacing:0.02em;white-space:nowrap;">${escapeHtml(trim(urgencyTxt, 12))}</span>` : '<span style="color:var(--muted);font-size:11px;">-</span>'}</td>
              <td class="col-worry" style="display:none;font-size:12px;color:var(--ink-2);max-width:240px;">${s.q9_悩み ? escapeHtml(trim(s.q9_悩み, 60)) : '<span style="color:var(--muted);">-</span>'}</td>
              <td class="col-goal" style="display:none;font-size:12px;color:var(--ink-2);max-width:240px;">${s.q14_理想 ? escapeHtml(trim(s.q14_理想, 60)) : '<span style="color:var(--muted);">-</span>'}</td>
              <td class="col-products" style="display:none;max-width:320px;">${hasAnyData ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:0;line-height:1.6;">${productChips}</div>` : '<span style="color:var(--muted);font-size:11px;">アンケート未回答</span>'}</td>
            `;
          })()}
          <td>${(function(){
            // ★ オーナーfb「客返信あったら赤バッジ」: 未読カウント
            const lastRead = parseInt(localStorage.getItem('fp-line-read-' + c.id) || '0', 10);
            const unreadCount = (c.lineHistory || []).filter(m => {
              const isUser = (m.from === 'user' || m.direction === 'in');
              const ts = new Date(m.ts || m.date || 0).getTime();
              return isUser && ts > lastRead;
            }).length;
            const unreadBadge = unreadCount > 0
              ? `<span class="fp-unread-badge" style="display:inline-flex;align-items:center;justify-content:center;gap:4px;background:linear-gradient(135deg,#DC2626,#991B1B);color:#fff;font-size:10px;font-weight:900;padding:3px 9px;border-radius:11px;margin-right:6px;box-shadow:0 4px 12px rgba(220,38,38,0.55),0 0 0 2px rgba(255,255,255,0.5);animation:fp-unread-pulse 1.4s ease-in-out infinite;letter-spacing:0.06em;white-space:nowrap;">⚠ 要返事 ${unreadCount > 99 ? '99+' : unreadCount}</span>`
              : '';
            return `${unreadBadge}<span class="status-pill ${c.status}">${statusLabel(c.status)}</span>${taskCount > 0 ? `<button class="fp-task-badge" data-task-cid="${escapeHtml(c.lineFriendId || c.id)}" data-task-name="${escapeHtml(c.name)}" style="display:inline-block;margin-left:6px;font-size:10px;background:#fff8e1;color:#a08537;padding:2px 7px;border-radius:9px;font-weight:700;border:1px solid #f0d36b;cursor:pointer;font-family:inherit;" title="タスク一覧を見る">📝${taskCount}</button>` : ''}`;
          })()}</td>
          <td class="num">¥${fmtMoney(c.aum)}</td>
          <td class="${contactCls}"><div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;"><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${contactBg};color:${contactFg};">${contactLabel}</span><span style="font-size:11px;color:var(--muted);">${dayDisplay}</span>${c.lastActionType ? `<span style="font-size:9.5px;color:var(--accent);font-weight:600;">📱 LINE: ${escapeHtml((c.lastActionType||'').split(':')[0])}</span>` : ''}</div></td>
        </tr>
      `;
    }).join('');
    // ★ XSS fix (2026-06-25): inline onerror= を廃止し addEventListener('error') へ移管
    //   顧客名/initial を文字列連結で属性に焼き付ける旧実装は 顧客名に '" を入れると JS実行可能だった
    tbody.querySelectorAll('img[data-fallback-initial]').forEach(img => {
      img.addEventListener('error', () => {
        const parent = img.parentNode;
        if (!parent) return;
        const initial = img.dataset.fallbackInitial || '?';
        const hueVal = parseInt(img.dataset.fallbackHue || '0', 10) || 0;
        // textContent を使うので innerHTML 連結より安全
        parent.textContent = initial;
        parent.style.background = 'hsl(' + hueVal + ',60%,55%)';
        parent.style.color = '#fff';
      }, { once: true });
    });
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.fp-task-badge')) return; // バッジクリックは別処理
        openClientModal(tr.dataset.clientId);
      });
    });
    tbody.querySelectorAll('.fp-task-badge').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTasksListModal(btn.dataset.taskCid, btn.dataset.taskName);
      });
    });
    // ★ 保有商品チップ クリックトグル
    tbody.querySelectorAll('[data-prod-toggle]').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = chip.dataset.prodToggle;
        const key = chip.dataset.prodKey;
        const target = clients.find(x => x.id === cid);
        if (!target) return;
        const surveys = (window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [];
        const sv = surveys.find(x => (x.userId && x.userId === target.lineFriendId) || (x.name && x.name === target.name)) || {};
        const ownedRaw = String(sv.q7_保有 || '') + ' ' + String(sv.q14_既存商品 || '') + ' ' + (target.mortgage ? '住宅ローン' : '');
        const PRODUCTS = window.FP_PRODUCTS_DEF;
        const def = PRODUCTS.find(p => p.key === key);
        if (!def) return;
        const fromSurvey = def.pattern.test(ownedRaw);
        target.productsManual = Array.isArray(target.productsManual) ? target.productsManual : [];
        target.productsRemoved = Array.isArray(target.productsRemoved) ? target.productsRemoved : [];
        const inManual = target.productsManual.includes(key);
        const inRemoved = target.productsRemoved.includes(key);
        const currentlyHas = (fromSurvey || inManual) && !inRemoved;
        if (currentlyHas) {
          // 加入済 → 未加入 にする
          target.productsManual = target.productsManual.filter(k => k !== key);
          if (fromSurvey && !inRemoved) target.productsRemoved.push(key);
        } else {
          // 未加入 → 加入済 にする
          target.productsRemoved = target.productsRemoved.filter(k => k !== key);
          if (!fromSurvey && !inManual) target.productsManual.push(key);
        }
        try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(clients)); } catch (_) {}
        renderClients();
      });
    });
    // 列カスタマイズボタン (一度だけバインド) + 初期適用
    const colBtn = document.getElementById('client-col-config');
    if (colBtn && !colBtn._bound) {
      colBtn._bound = true;
      colBtn.addEventListener('click', (e) => { e.stopPropagation(); openColConfigPopover(colBtn); });
    }
    applyColPrefs();
  }

  // 顧客のタスク一覧を表示
  function openTasksListModal(customerKey, customerName) {
    const tasksKey = 'fp-tasks-' + customerKey;
    const tasks = JSON.parse(localStorage.getItem(tasksKey) || '[]');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;width:min(720px,100%);max-height:90vh;overflow-y:auto;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);">
        <div style="padding:20px 24px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:baseline;">
          <h2 style="margin:0;font-family:'Noto Serif JP',serif;font-size:20px;">📝 ${escapeHtml(customerName)}様 のタスク一覧 (${tasks.length}件)</h2>
          <button id="fp-tl-close" style="font-size:18px;width:32px;height:32px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;color:#6b7280;font-family:inherit;">✕</button>
        </div>
        <div style="padding:18px 24px;">
          ${tasks.length === 0 ? '<div style="text-align:center;color:#9ca3af;padding:30px;">タスクなし</div>' :
            '<div style="display:grid;gap:8px;">' + tasks.sort((a,b) => (a.due||'').localeCompare(b.due||'')).map((t,i) => `
              <div style="display:grid;grid-template-columns:36px 90px 1fr 130px 32px;gap:10px;align-items:center;padding:10px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
                <span style="font-size:18px;">${t.icon || '✅'}</span>
                <span style="font-size:10.5px;font-weight:700;background:${t.priority==='至急'?'#fef2f2;color:#b91c3c':(t.priority==='今週'||t.priority==='2週間以内')?'#fff7ed;color:#c2410c':'#f0f9ff;color:#075985'};padding:4px 9px;border-radius:11px;text-align:center;">${t.priority||'-'}</span>
                <span style="font-size:13px;">${escapeHtml(t.task||'')}</span>
                <span style="font-size:11px;color:#6b7280;text-align:right;">${t.due||'-'}</span>
                <button class="fp-task-del" data-idx="${i}" title="削除" style="background:#fff;border:1px solid #fecaca;color:#b91c3c;width:26px;height:26px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;">✕</button>
              </div>
            `).join('') + '</div>'
          }
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#fp-tl-close').addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('.fp-task-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const arr = JSON.parse(localStorage.getItem(tasksKey) || '[]');
        arr.splice(idx, 1);
        localStorage.setItem(tasksKey, JSON.stringify(arr));
        overlay.remove();
        openTasksListModal(customerKey, customerName);
        renderClients();
      });
    });
  }

  // ============================
  // 全体タイムライン (月別グループ縦リスト)
  function renderGlobalTimeline() {
    const rangeOpt = state.timelineRange || '12m';
    const catOpt = state.timelineCat || 'all';

    const RANGE_MS = {
      '6m': 180 * 86400 * 1000,
      '12m': 365 * 86400 * 1000,
      '36m': 365 * 86400 * 1000 * 3,
      '120m': 365 * 86400 * 1000 * 10,
      'all': 365 * 86400 * 1000 * 60, // ★ 30年→60年 (29歳客でも 80歳節目まで 全部出るように)
    };
    const horizonMs = RANGE_MS[rangeOpt] || RANGE_MS['12m'];
    const horizonDate = new Date(TODAY.getTime() + horizonMs);

    // 全顧客のイベントを1つの配列に集める (休眠も含む)
    const allEvents = [];
    clients.forEach(c => {
      const evs = window.LifeEvents.generate(c);
      evs.forEach(ev => {
        if (ev.date <= horizonDate && (catOpt === 'all' || ev.cat === catOpt)) {
          allEvents.push({ ...ev, client: c });
        }
      });
    });
    allEvents.sort((a, b) => a.date - b.date);

    // カテゴリピル
    const cats = [
      { key: 'all', label: 'すべて' },
      { key: 'education', label: '教育' },
      { key: 'retirement', label: '退職・年金' },
      { key: 'health', label: '医療・介護' },
      { key: 'inherit', label: '相続' },
      { key: 'finance', label: '金融' },
      { key: 'family', label: '家族' },
    ];
    const ranges = [
      { key: '6m', label: '半年以内' },
      { key: '12m', label: '1年以内' },
      { key: '36m', label: '3年以内' },
      { key: '120m', label: '10年以内' },
      { key: 'all', label: '全期間' },
    ];

    const toolbarHtml = `
      <div class="tl-toolbar">
        <div class="tl-toolbar-row">
          <span class="tl-label">期間:</span>
          ${ranges.map(r => `<button class="tl-pill ${r.key === rangeOpt ? 'on' : ''}" data-range="${r.key}">${r.label}</button>`).join('')}
        </div>
        <div class="tl-toolbar-row">
          <span class="tl-label">分類:</span>
          ${cats.map(c => `<button class="tl-pill cat-${c.key} ${c.key === catOpt ? 'on' : ''}" data-cat="${c.key}">${c.label}</button>`).join('')}
          <span class="tl-count">該当 ${allEvents.length} 件</span>
        </div>
      </div>
    `;

    // 月別グループ
    const byMonth = {};
    allEvents.forEach(ev => {
      const key = `${ev.date.getFullYear()}-${String(ev.date.getMonth() + 1).padStart(2, '0')}`;
      (byMonth[key] = byMonth[key] || []).push(ev);
    });

    const monthsHtml = Object.keys(byMonth).sort().map(key => {
      const [y, m] = key.split('-');
      const monthEvents = byMonth[key];
      const cardsHtml = monthEvents.map(ev => `
        <div class="tl-card" data-client-id="${ev.client.id}">
          <div class="tl-card-bar cat-${ev.cat}${ev.major ? ' major' : ''}"></div>
          <div class="tl-card-body">
            <div class="tl-card-head">
              <span class="tl-card-date">${ev.date.getMonth() + 1}/${ev.date.getDate()}</span>
              <span class="tl-card-label">${escapeHtml(ev.label)}${ev.major ? ' <span class="tl-major-tag">重要</span>' : ''}</span>
            </div>
            <div class="tl-card-sub">
              <span class="tl-card-client">${escapeHtml(ev.client.name)} (${window.LifeEvents.currentAge(ev.client)}歳)</span>
              <span class="tl-card-who">対象: ${escapeHtml(ev.who)}</span>
            </div>
          </div>
          <div class="tl-card-cta">→</div>
        </div>
      `).join('');

      const monthLabel = `${y}年${parseInt(m, 10)}月`;
      const rel = monthRelative(parseInt(y, 10), parseInt(m, 10));
      return `
        <div class="tl-month-group">
          <div class="tl-month-header">
            <span class="tl-month-title">${monthLabel}</span>
            <span class="tl-month-sub">${rel}</span>
            <span class="tl-month-count">${monthEvents.length} 件</span>
          </div>
          <div class="tl-card-list">${cardsHtml}</div>
        </div>
      `;
    }).join('');

    document.getElementById('timeline-area').innerHTML = `
      ${toolbarHtml}
      ${monthsHtml || '<div class="empty">該当するイベントがありません。期間や分類を広げてみてください。</div>'}
    `;

    // ピル
    document.querySelectorAll('#timeline-area [data-range]').forEach(b => {
      b.addEventListener('click', () => {
        state.timelineRange = b.dataset.range;
        saveState();
        renderGlobalTimeline();
      });
    });
    document.querySelectorAll('#timeline-area [data-cat]').forEach(b => {
      b.addEventListener('click', () => {
        state.timelineCat = b.dataset.cat;
        saveState();
        renderGlobalTimeline();
      });
    });
    // カードクリック
    document.querySelectorAll('#timeline-area .tl-card').forEach(card => {
      card.addEventListener('click', () => openClientModal(card.dataset.clientId));
    });
  }

  function monthRelative(y, m) {
    const target = new Date(y, m - 1, 1);
    const cur = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    const diffMonths = (target.getFullYear() - cur.getFullYear()) * 12 + (target.getMonth() - cur.getMonth());
    if (diffMonths === 0) return '今月';
    if (diffMonths === 1) return '来月';
    if (diffMonths < 12) return `${diffMonths}ヶ月後`;
    const years = Math.floor(diffMonths / 12);
    const remMonths = diffMonths % 12;
    return remMonths === 0 ? `${years}年後` : `${years}年${remMonths}ヶ月後`;
  }

  // Event category label
  function catLabel(cat) {
    return {
      'education':  '教育',
      'retirement': '退職',
      'pension':    '年金',
      'mortgage':   '住宅',
      'inheritance':'相続',
      'elder':      '介護',
      'health':     '健康',
      'general':    'その他',
    }[cat] || cat || 'その他';
  }

  // ============================
  // 統合タイムライン: LINE文面 + アンケート + Zoom予約 + 候補日確定 + 議事録 + キャンセル + 配布資料
  // ============================
  // ★ オーナーfb (v 20260610J): LINEタブを「文面のみ」 → 「お客様との全コミュニケーション」 に。
  //   booking.candidates は raw に無い → survey_answers の q6/q7/q8_候補X が SSOT (line-app.js:2525参照)
  function buildUnifiedLineTimeline(c) {
    const out = [];
    const liveData = window.LineAppLiveData || {};
    const myUid = c.lineFriendId;
    const myName = c.name;

    // 1) LINE 文面 (既存 c.lineHistory)
    (c.lineHistory || []).forEach(m => out.push({
      type: 'line',
      ts: m.ts || m.date || '',
      direction: m.direction || m.from || 'out',
      text: m.text || m.message || '',
      label: m.label || '',
    }));

    // 2-4) アンケート + 候補日提示 + 候補日確定 (全て survey_answers が source)
    (liveData.survey_answers || [])
      .filter(s => (s.userId && s.userId === myUid) || (s.name && s.name === myName) || (s.displayName && s.displayName === myName))
      .forEach(s => {
        // 2) アンケート回答
        out.push({
          type: 'survey',
          ts: s.ts || s.createdAt || '',
          summary: {
            年代: s.q2_年代 || s.q1_年代 || '',
            職業: s.q9_職業 || s.q2_職業 || '',
            家族: s.q3_家族 || '',
            年収: s.q4_年収 || '',
            住居: s.q10_住居 || s.q5_住居 || '',
            悩み: s.q9_悩み || s.q5_悩み || '',
            理想: s.q14_理想 || '',
            緊急度: s.q15_緊急度 || '',
            既存商品: s.q14_既存商品 || s.q7_保有 || '',
            生年月日: s.q11_生年月日 || s.q10_生年月日 || '',
            テーマ: s.q1_テーマ || s.q8_テーマ || '',
          },
        });
        // 3) 候補日提示 (q6/q7/q8_候補X が 1つでもあれば)
        const cands = [s.q6_候補1, s.q7_候補2, s.q8_候補3].filter(Boolean);
        if (cands.length > 0) {
          out.push({
            type: 'booking_request',
            ts: s.ts || s.createdAt || '',
            candidates: cands,
          });
        }
        // 4) 候補日確定
        if (s.confirmedSlot) {
          out.push({
            type: 'booking_confirmed',
            ts: s.confirmedAt || s.confirmedSlot || s.ts || '',
            slot: s.confirmedSlot,
            zoomUrl: s.zoomUrl || '',
          });
        }
      });

    // 5) AI 議事録
    (liveData.ai_results || [])
      .filter(r => (r.userId && r.userId === myUid) || (r.customerName && r.customerName === myName))
      .forEach(r => out.push({
        type: 'ai_minutes',
        ts: r.ts || r.createdAt || '',
        summary: r.summary || '',
        key_concerns: Array.isArray(r.key_concerns) ? r.key_concerns : (typeof r.key_concerns === 'string' ? (function(){ try { return JSON.parse(r.key_concerns); } catch(_) { return []; } })() : []),
      }));

    // 6) キャンセル
    (c.cancellations || []).forEach(cc => out.push({
      type: 'cancellation',
      ts: cc.date || cc.ts || '',
      reason: cc.reason || '',
    }));
    (liveData.bookings || [])
      .filter(b => ((b.userId && b.userId === myUid) || (b.name && b.name === myName)) && b.status === 'cancelled')
      .forEach(b => out.push({
        type: 'cancellation',
        ts: b.cancelledAt || b.ts || '',
        reason: b.cancelReason || '',
      }));

    // 7) 配布資料 (localStorage)
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('fp-deliv-edit-' + c.id + '-'))
        .forEach(k => {
          try {
            const v = localStorage.getItem(k) || '';
            // 編集HTML文字列なので savedAt 等メタなし → key から type 推測
            const parts = k.replace('fp-deliv-edit-' + c.id + '-', '').split('-');
            const kind = parts[0] || 'custom';
            const title = parts.slice(1).join('-') || kind;
            if (v.length > 100) out.push({
              type: 'deliverable',
              ts: '', // メタなし → 末尾配置
              kind, title,
            });
          } catch (_) {}
        });
    } catch (_) {}

    // 時系列 昇順 (古→新、 既存 cd-line-chat と同じ向き)
    out.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
    return out;
  }

  function renderTimelineEntry(entry) {
    // ★ entry.ts は string | Firestore Timestamp ({seconds, nanoseconds}) | Date のいずれか — 全部 string に正規化
    function tsToStr(t) {
      if (!t) return '';
      if (typeof t === 'string') return t;
      if (t instanceof Date) return t.toISOString();
      if (typeof t.toDate === 'function') { try { return t.toDate().toISOString(); } catch (_) {} }
      if (typeof t.seconds === 'number') return new Date(t.seconds * 1000 + (t.nanoseconds || 0) / 1e6).toISOString();
      try { return String(t); } catch (_) { return ''; }
    }
    const ts = tsToStr(entry.ts).slice(0, 19).replace('T', ' ');
    const safeTs = escapeHtml(ts);
    if (entry.type === 'line') {
      const cls = entry.direction === 'in' ? 'cd-line-in' : 'cd-line-out';
      const labelHtml = entry.label ? `<div class="cd-line-label">${escapeHtml(entry.label)}</div>` : '';
      return `
        <div class="cd-line-msg ${cls}">
          ${labelHtml}
          <div class="cd-line-bubble">${escapeHtml(entry.text || '').replace(/\n/g, '<br>')}</div>
          <div class="cd-line-ts">${safeTs}</div>
        </div>`;
    }
    if (entry.type === 'survey') {
      const s = entry.summary || {};
      const headLine = ['悩み', 'テーマ', '年代'].map(k => s[k] ? `${k}: ${s[k]}` : '').filter(Boolean).slice(0, 2).join(' / ');
      const rows = Object.entries(s).filter(([k, v]) => v).map(([k, v]) => `<div style="display:flex;gap:8px;font-size:12px;margin:3px 0;"><span style="color:#92400e;min-width:64px;font-weight:600;">${escapeHtml(k)}</span><span style="color:#0F172A;">${escapeHtml(v)}</span></div>`).join('');
      return `
        <details class="cd-line-msg cd-tl-entry cd-tl-survey" style="align-self:stretch;max-width:100%;background:#FEF9C3;border:1px solid #FDE68A;border-left:4px solid #EAB308;border-radius:8px;padding:10px 14px;margin:4px 0;">
          <summary style="cursor:pointer;font-weight:700;font-size:12.5px;color:#854D0E;letter-spacing:0.01em;list-style:none;">
            📝 事前アンケート回答 ${headLine ? `<span style="font-weight:400;color:#78350F;margin-left:6px;">— ${escapeHtml(headLine)}</span>` : ''}
            <span style="float:right;font-weight:400;font-size:11px;opacity:0.65;">${safeTs}</span>
          </summary>
          <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #FCD34D;">${rows || '<span style="color:#92400e;font-size:11px;">回答なし</span>'}</div>
        </details>`;
    }
    if (entry.type === 'booking_request') {
      const list = (entry.candidates || []).map(c => `<div style="font-size:12px;margin:3px 0;">・${escapeHtml(c)}</div>`).join('');
      return `
        <details class="cd-line-msg cd-tl-entry cd-tl-booking" style="align-self:stretch;max-width:100%;background:#F3E8FF;border:1px solid #DDD6FE;border-left:4px solid #A855F7;border-radius:8px;padding:10px 14px;margin:4px 0;">
          <summary style="cursor:pointer;font-weight:700;font-size:12.5px;color:#6B21A8;letter-spacing:0.01em;list-style:none;">
            📅 Zoom 候補日 ${entry.candidates.length}件 提示
            <span style="float:right;font-weight:400;font-size:11px;opacity:0.65;">${safeTs}</span>
          </summary>
          <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #C4B5FD;color:#581C87;">${list}</div>
        </details>`;
    }
    if (entry.type === 'booking_confirmed') {
      const zoomBtn = entry.zoomUrl ? `<a href="${escapeHtml(entry.zoomUrl)}" target="_blank" rel="noopener" style="display:inline-block;margin-left:8px;background:#2563EB;color:#fff;text-decoration:none;padding:3px 10px;border-radius:5px;font-size:11px;font-weight:700;">🎥 Zoom URL</a>` : '';
      return `
        <div class="cd-line-msg cd-tl-entry cd-tl-confirmed" style="align-self:stretch;max-width:100%;background:#DBEAFE;border:1px solid #BFDBFE;border-left:4px solid #2563EB;border-radius:8px;padding:10px 14px;margin:4px 0;font-size:12.5px;color:#1E3A8A;font-weight:600;">
          ✅ 候補日 確定 — ${escapeHtml(entry.slot || '')}${zoomBtn}
          <span style="float:right;font-weight:400;font-size:11px;opacity:0.65;">${safeTs}</span>
        </div>`;
    }
    if (entry.type === 'ai_minutes') {
      const sum = String(entry.summary || '').slice(0, 400);
      const ellipsis = String(entry.summary || '').length > 400 ? '…' : '';
      const concernChips = (entry.key_concerns || []).slice(0, 5).map(k => `<span style="display:inline-block;background:#FED7AA;color:#7C2D12;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:600;margin:2px 3px 2px 0;">${escapeHtml(k)}</span>`).join('');
      return `
        <details class="cd-line-msg cd-tl-entry cd-tl-minutes" style="align-self:stretch;max-width:100%;background:#FFEDD5;border:1px solid #FED7AA;border-left:4px solid #F97316;border-radius:8px;padding:10px 14px;margin:4px 0;">
          <summary style="cursor:pointer;font-weight:700;font-size:12.5px;color:#9A3412;letter-spacing:0.01em;list-style:none;">
            🎙 議事録 (AI要約)
            <span style="float:right;font-weight:400;font-size:11px;opacity:0.65;">${safeTs}</span>
          </summary>
          <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #FDBA74;font-size:12px;color:#7C2D12;white-space:pre-wrap;line-height:1.65;">${escapeHtml(sum)}${ellipsis}</div>
          ${concernChips ? `<div style="margin-top:8px;">${concernChips}</div>` : ''}
        </details>`;
    }
    if (entry.type === 'cancellation') {
      return `
        <div class="cd-line-msg cd-tl-entry cd-tl-cancel" style="align-self:stretch;max-width:100%;background:#FEE2E2;border:1px solid #FECACA;border-left:4px solid #DC2626;border-radius:8px;padding:10px 14px;margin:4px 0;font-size:12.5px;color:#991B1B;font-weight:600;">
          ❌ キャンセル ${entry.reason ? `— ${escapeHtml(entry.reason)}` : ''}
          <span style="float:right;font-weight:400;font-size:11px;opacity:0.65;">${safeTs}</span>
        </div>`;
    }
    if (entry.type === 'deliverable') {
      return `
        <div class="cd-line-msg cd-tl-entry cd-tl-deliv" style="align-self:stretch;max-width:100%;background:#E0F2FE;border:1px solid #BAE6FD;border-left:4px solid #0284C7;border-radius:8px;padding:10px 14px;margin:4px 0;font-size:12.5px;color:#075985;font-weight:600;">
          📎 配布資料: ${escapeHtml(entry.title || '')} <span style="color:#0369A1;font-weight:400;">(${escapeHtml(entry.kind || 'custom')})</span>
          <span style="float:right;font-weight:400;font-size:11px;opacity:0.65;">${safeTs}</span>
        </div>`;
    }
    return '';
  }

  // ============================
  // 顧客詳細モーダル
  // ============================
  // Fallback LINE history (in case dummy-data.js is cached old)
  const LINE_HISTORY_FALLBACK = {
    c000: [
      { direction: 'in',  ts: '2026-04-18 10:00', text: 'お世話になっております。資産運用のご相談したく、ご連絡しました。' },
      { direction: 'out', ts: '2026-04-18 10:30', text: 'サンプル様\n\nご連絡ありがとうございます、FPの福田です。お話伺うのが楽しみです。アンケートよろしくお願いいたします。', label: '初回返信' },
    ],
    c001: [
      { direction: 'in',  ts: '2025-12-04 10:23', text: 'ご連絡ありがとうございます、初めての相談で緊張しています。' },
      { direction: 'out', ts: '2025-12-04 10:35', text: '田中様\n\nお問い合わせありがとうございます。FP福田です。緊張なさらず、率直なお話ができればと思います。アンケートのご回答お待ちしております。', label: '初回返信' },
      { direction: 'in',  ts: '2025-12-14 21:08', text: 'アンケートを回答しました。子供の大学資金が一番気になっています。' },
      { direction: 'out', ts: '2025-12-15 09:42', text: '田中様\n\nアンケートありがとうございました。大翔様の大学進学(教育費ピーク)について資料をまとめました。下記候補で面談いかがでしょうか。', label: '面談案内' },
      { direction: 'in',  ts: '2025-12-19 12:11', text: '候補日3で予約します。' },
      { direction: 'out', ts: '2025-12-19 12:12', text: '✅ ご予約承りました 6/1 14:00〜15:00 Zoom URL: https://zoom.us/...', label: '予約確定 (自動)' },
      { direction: 'out', ts: '2026-04-18 11:00', text: '田中様\n\n先日ご提案させていただいた「iDeCo拠出額の見直し」、その後ご検討状況はいかがでしょうか。ご質問やご懸念があれば、お気軽にお聞かせください。', label: 'フォローアップ' },
      { direction: 'in',  ts: '2026-05-25 19:30', text: '6/5の面談キャンセルさせてください。' },
      { direction: 'out', ts: '2026-05-25 19:35', text: '田中様\n\nキャンセル承りました。またご都合つけば日程ご相談ください。', label: 'キャンセル対応 (自動)' },
    ],
    c002: [
      { direction: 'in',  ts: '2025-04-28 14:08', text: 'セミナーありがとうございました。個人年金について詳しく聞きたいです。' },
      { direction: 'out', ts: '2025-04-28 18:30', text: '佐藤様\n\nセミナーへのご参加ありがとうございました。個人年金保険、看護師の方の退職時期に合わせたプランをご提案できます。', label: '初回返信' },
      { direction: 'out', ts: '2025-04-28 18:31', text: '【ご提案】個人年金保険プラン_佐藤様向け.pdf', label: '資料送付' },
      { direction: 'in',  ts: '2026-02-22 21:15', text: '退職金準備プラン、内容まだ少し検討中です。' },
      { direction: 'out', ts: '2026-02-22 22:00', text: '佐藤様\n\nお返事ありがとうございます。じっくりご検討ください。ご不明な点があればいつでもお声がけください。', label: 'フォローアップ' },
      { direction: 'out', ts: '2026-04-07 10:00', text: '佐藤様\n\n6/2 14:00 で承りました。当日はよろしくお願いします。Zoom URL: https://zoom.us/...', label: '予約確定 (自動)' },
      { direction: 'in',  ts: '2026-04-07 13:50', text: '申し訳ない、急用が入ってしまいキャンセルさせてください。' },
      { direction: 'out', ts: '2026-04-07 14:00', text: '佐藤様\n\nキャンセル承りました。また別日でも改めてご案内させてください。', label: 'キャンセル対応 (自動)' },
    ],
  };
  function ensureLineHistory_(c) {
    // ★ オーナーfb「リロードで履歴 0件」: 独立キーから常に補完
    // 顧客台帳が何かで壊れても、fp-line-history-{id} に保存した送信履歴は残してマージ
    try {
      const histKey = 'fp-line-history-' + c.id;
      const standalone = JSON.parse(localStorage.getItem(histKey) || '[]');
      if (standalone.length > 0) {
        if (!Array.isArray(c.lineHistory)) c.lineHistory = [];
        // 重複除去 (ts ベース)
        const seenTs = new Set(c.lineHistory.map(m => m.ts).filter(Boolean));
        standalone.forEach(m => {
          if (!m.ts || !seenTs.has(m.ts)) { c.lineHistory.push(m); seenTs.add(m.ts); }
        });
        // 時系列ソート
        c.lineHistory.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
        console.log('[ensureLineHistory] merged standalone for', c.name, '+', standalone.length, '→ total', c.lineHistory.length);
      }
    } catch (_) {}
    if (!c.lineHistory || c.lineHistory.length === 0) {
      const fb = LINE_HISTORY_FALLBACK[c.id];
      if (fb) c.lineHistory = fb;
    }
  }

  function openClientModal(id, options) {
    options = options || {};
    const c = clients.find(x => x.id === id);
    if (!c) return;
    window._fpCurrentClient = c;  // AI議事録モーダルの LINE 送信 fallback 用
    // ★ オーナーfb「リロードでトップに戻る」: 最後に開いてた顧客IDを localStorage
    try {
      localStorage.setItem('fp-last-open-client', id);
      localStorage.setItem('fp-last-open-mode', 'client');
    } catch (_) {}
    // ★ URL routing: ?view=clients&customer={id} に更新 (popstate由来でない時)
    if (!options.fromPopstate) {
      try { pushModalUrl(id, null); } catch (_) {}
    }
    // AI BRIEF で拡大した modal-content の幅を通常に戻す
    try { document.getElementById('modal-content').style.maxWidth = ''; } catch (_) {}
    ensureLineHistory_(c);
    // ★ オーナーfb 2026-06-24 (重さ解消): 初回ロード は LINE 履歴 20件 だけ →
    // 顧客モーダル を 開いた時に フル履歴 を lazy load
    if (c._lineHistoryPartial && typeof window.fetchFullLineHistory === 'function' && !c._lineHistoryLoading) {
      c._lineHistoryLoading = true;
      window.fetchFullLineHistory(c._fsCustomerId || c.id).then(full => {
        if (full && full.length > (c.lineHistory || []).length) {
          c.lineHistory = full;
          c._lineHistoryPartial = false;
          // モーダル開いてる間 に LINE タブ が active なら再描画
          try {
            const lineTab = document.querySelector('.cd-tab.cd-tab-active[data-cdtab="line"]');
            if (lineTab && typeof openClientModal === 'function') openClientModal(c.id, { fromPopstate: true });
          } catch (_) {}
        }
        c._lineHistoryLoading = false;
      }).catch(() => { c._lineHistoryLoading = false; });
    }
    // ★ オーナーfb 2026-06-25 (重さ解消 Phase 4 lite mode):
    // 初期fetchは ai_results の transcript を strip + 最新60件のみ → ここで full data を hydrate
    // 同じ顧客を再度開いた時 は スキップ (cache)
    try {
      // ★ ai_result.userId は Firestore 顧客ID(=c.id) に揃ってる。 lineFriendId は LINE側 と Firestore側で別物。
      // /api/customer-detail は backend で `x.userId === uid || x.lineFriendId === uid` で 両方マッチ
      const detailUid = c._fsCustomerId || c.id;
      if (detailUid && window.LineAppLiveData?._lite && typeof window.getCustomerDetailApi === 'function' && !c._fullHydrated && !c._fullHydrating) {
        c._fullHydrating = true;
        (async () => {
          const h = window.getFpAuthHeaders ? await window.getFpAuthHeaders() : { 'Content-Type': 'application/json' };
          return fetch(window.getCustomerDetailApi(detailUid), { headers: h });
        })()
          .then(r => r.ok ? r.json() : null)
          .then(detail => {
            if (!detail) return;
            try {
              const live = window.LineAppLiveData;
              if (!live) return;
              // ai_results を merge (同じbookingTsは backend版で上書き = transcript復元)
              if (Array.isArray(detail.ai_results)) {
                const existingKeyset = new Set();
                (live.ai_results || []).forEach(a => existingKeyset.add(a.bookingTs || a.ts || a.createdAt));
                detail.ai_results.forEach(a => {
                  const key = a.bookingTs || a.ts || a.createdAt;
                  const idx = (live.ai_results || []).findIndex(x => (x.bookingTs || x.ts || x.createdAt) === key);
                  if (idx >= 0) live.ai_results[idx] = a;       // upgrade lite → full
                  else (live.ai_results = live.ai_results || []).push(a);   // 新規追加 (lite cap で 落ちてた古いやつ)
                });
              }
              if (Array.isArray(detail.line_messages)) {
                const seen = new Set((live.line_messages || []).map(m => (m.userId || '') + '|' + (m.ts || '') + '|' + (m.text || '').slice(0, 50)));
                detail.line_messages.forEach(m => {
                  const k = (m.userId || '') + '|' + (m.ts || '') + '|' + (m.text || '').slice(0, 50);
                  if (!seen.has(k)) (live.line_messages = live.line_messages || []).push(m);
                });
              }
              c._fullHydrated = true;
              // ★ 2026-06-27 速度改善: 議事録タブ active時のみ 再描画。 他タブなら 全DOM rebuild スキップ (遅さの主因)
              //   次に議事録タブ open した時 表示される (ai_results は live merge済)
              const meetingsTab = document.querySelector('.cd-tab.cd-tab-active[data-cdtab="meetings"]');
              const lineTabActive = document.querySelector('.cd-tab.cd-tab-active[data-cdtab="line"]');
              if (meetingsTab && typeof openClientModal === 'function' && !lineTabActive) {
                // 議事録panel のみ 差分更新 (全modal rebuild 回避)
                try {
                  const panel = document.querySelector('[data-cdpanel="meetings"]');
                  if (panel && typeof renderMeetingRecordsBlock === 'function') {
                    panel.innerHTML = renderMeetingRecordsBlock(c) || '<div class="cd-empty">面談録なし</div>';
                  }
                } catch (_) {
                  openClientModal(c.id, { fromPopstate: true });
                }
              }
            } catch (e) { console.warn('[customer-detail hydrate] merge fail', e); }
            c._fullHydrating = false;
          })
          .catch(() => { c._fullHydrating = false; });
      }
    } catch (_) {}
    // ★ 議事録 → 自動タグ抽出 (NISA/iDeCo/保険/相続 等を 議事録本文から regex で キャッチ → c.autoTags)
    //   オーナーfb 2026-06-20: 重さ対策 → 議事録 数 が 同じなら 前回結果 再利用 (キャッシュ)
    try {
      const liveAi2 = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
      const _aiSig = liveAi2.length + ':' + (liveAi2[liveAi2.length-1]?.ts || '');
      if (c._autoTagSig === _aiSig && Array.isArray(c.autoTags)) {
        // cache hit → skip regex 全件
      } else { c._autoTagSig = _aiSig;
      const productPatterns = [
        { key: 'nisa',        re: /NISA|ニーサ|つみたて/i,                              label: 'NISA',     color: '#3B82F6' },
        { key: 'ideco',       re: /iDeCo|イデコ|個人型確定拠出/i,                       label: 'iDeCo',    color: '#6366F1' },
        { key: 'life_ins',    re: /生命保険|終身保険|定期保険|死亡保険/,               label: '生命保険',  color: '#EF4444' },
        { key: 'med_ins',     re: /医療保険|がん保険|ガン保険|入院保険/,               label: '医療保険',  color: '#F59E0B' },
        { key: 'mortgage',    re: /住宅ローン|フラット35|変動金利|固定金利/,           label: '住宅ローン', color: '#84CC16' },
        { key: 'inheritance', re: /相続|遺言|信託|生前贈与/,                           label: '相続',     color: '#A855F7' },
        { key: 'edu_fund',    re: /教育(資金|費)|学資保険|大学費用|進学費/,           label: '教育資金',  color: '#06B6D4' },
        { key: 'business',    re: /開業|起業|個人事業主|法人化/,                       label: '開業',     color: '#EC4899' },
        { key: 'retire_fund', re: /老後資金|退職金|年金繰下げ|繰り上げ返済/,           label: '老後資金',  color: '#0EA5E9' },
        { key: 'real_estate', re: /不動産投資|マンション投資|REIT/,                    label: '不動産',   color: '#14B8A6' },
        { key: 'stock',       re: /個別株|株式投資|高配当株/,                          label: '株式',     color: '#EAB308' },
        { key: 'fx',          re: /FX|外貨預金|外貨建て/,                              label: '外貨',     color: '#F97316' },
      ];
      const cConfMs2 = c.confirmedSlot ? new Date(String(c.confirmedSlot).replace(' ', 'T')).getTime() : NaN;
      const detected = new Set();
      liveAi2.forEach(r => {
        const strictMatch = (r.userId && c.lineFriendId && r.userId === c.lineFriendId)
                         || (r.customerName && r.customerName !== 'お客様' && r.customerName === c.name);
        let rescued = false;
        if (!strictMatch && !isNaN(cConfMs2) && (!r.customerName || r.customerName === 'お客様') && !r.userId) {
          const rMs = new Date(String(r.ts || r.createdAt || r.bookingTs || '').replace(' ', 'T')).getTime();
          if (!isNaN(rMs) && Math.abs(rMs - cConfMs2) < 6 * 60 * 60 * 1000) rescued = true;
        }
        if (!strictMatch && !rescued) return;
        const text = String(r.summary || '') + '\n' + String(r.transcript || '') + '\n' + (Array.isArray(r.key_concerns) ? r.key_concerns.join(' ') : String(r.key_concerns || ''));
        productPatterns.forEach(p => { if (p.re.test(text)) detected.add(p.key); });
      });
      if (detected.size > 0) {
        c.autoTags = Array.from(detected).map(k => productPatterns.find(p => p.key === k)).filter(Boolean);
        console.log('[autoTag]', c.name, ':', c.autoTags.map(t => t.label).join(', '));
      }
      }  // end cache miss branch
    } catch (e) { console.warn('autoTag fail:', e); }
    // ★ 議事録 → タイムライン 自動キャッチアップ
    //   録画時 autoSaveAIResult が走った時 client が未sync なら lifeEventCandidates の customEvents merge を 取りこぼす
    //   モーダル開く度に GAS ai_results + localStorage fp-ai-backup 両方 走査して 救済 merge
    try {
      const liveAi = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
      const lsBackupKeys = Object.keys(localStorage).filter(k => k.startsWith('fp-ai-backup-'));
      const lsBackupEntries = [];
      lsBackupKeys.forEach(k => {
        try {
          const data = JSON.parse(localStorage.getItem(k) || '{}');
          if (data && data.entry) lsBackupEntries.push(data.entry);
        } catch (_) {}
      });
      const allAi = liveAi.concat(lsBackupEntries);
      const cConfirmedMs = c.confirmedSlot ? new Date(String(c.confirmedSlot).replace(' ', 'T')).getTime() : NaN;
      let lifeMerged = 0;
      allAi.forEach(r => {
        const strictMatch = (r.userId && c.lineFriendId && r.userId === c.lineFriendId)
                         || (r.customerName && r.customerName !== 'お客様' && r.customerName === c.name);
        // 救済: customerName='お客様'+uid空 で confirmedSlot ±6h 以内
        let rescued = false;
        if (!strictMatch && !isNaN(cConfirmedMs) && (!r.customerName || r.customerName === 'お客様') && !r.userId) {
          const rMs = new Date(String(r.ts || r.createdAt || r.bookingTs || '').replace(' ', 'T')).getTime();
          if (!isNaN(rMs) && Math.abs(rMs - cConfirmedMs) < 6 * 60 * 60 * 1000) rescued = true;
        }
        if (!strictMatch && !rescued) return;
        let cands = r.lifeEventCandidates;
        if (typeof cands === 'string') { try { cands = JSON.parse(cands); } catch (_) { cands = []; } }
        if (!Array.isArray(cands) || cands.length === 0) return;
        if (!Array.isArray(c.customEvents)) c.customEvents = [];
        cands.forEach(ev => {
          if (!ev || typeof ev !== 'object') return;
          const key = (ev.date || '') + '|' + (ev.label || '');
          if (!ev.label) return;
          if (c.customEvents.some(x => (x.date || '') + '|' + (x.label || '') === key)) return;
          c.customEvents.push({
            date: ev.date || '',
            label: ev.label || '',
            who: ev.who || c.name,
            cat: ev.cat || 'family',
            source: 'Zoom ' + (r.date || String(r.ts || '').slice(0, 10)),
            confidence: ev.confidence || 0.5,
            addedAt: new Date().toISOString(),
          });
          lifeMerged++;
        });
      });
      if (lifeMerged > 0) {
        try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS)); } catch (_) {}
        console.log('[lifeEvent catchup]', lifeMerged, 'events → customEvents on', c.name);
      }
    } catch (e) { console.warn('lifeEvent catchup fail:', e); }
    console.log('[client modal]', c.id, c.name, 'lineHistory:', (c.lineHistory || []).length, 'DUMMY_CLIENTS_VERSION:', window.DUMMY_CLIENTS_VERSION || '(missing)');
    let events = window.LifeEvents.generate(c);
    const pureLifeEventCount = events.length; // ★ CTA条件 用: 議事録 events 追加前 の 純粋ライフイベント数
    // 面談AI議事録をタイムラインに追加 (localStorage + GAS 両方)
    try {
      const liveBks = (window.LineAppLiveData && window.LineAppLiveData.bookings) || [];
      const myBks = liveBks.filter(b => b.userId === c.lineFriendId || b.name === c.name);
      const aiKeys = new Set();
      if (c.lineFriendId) aiKeys.add('fp-ai-' + c.lineFriendId);
      if (c.id)           aiKeys.add('fp-ai-' + c.id);
      if (c.name)         aiKeys.add('fp-ai-' + c.name);
      myBks.forEach(b => { if (b.userId) aiKeys.add('fp-ai-' + b.userId); if (b.ts) aiKeys.add('fp-ai-' + b.ts); if (b.name) aiKeys.add('fp-ai-' + b.name); });
      const meetingEvents = [];
      // ★ オーナーfb 2026-06-23: 議事録の日付が1日ずれる → UTC を Asia/Tokyo で日付化
      const toJstDateStr = (raw) => {
        if (!raw) return null;
        const d = new Date(raw);
        if (isNaN(d.getTime())) return null;
        return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      };
      const collectFromEntry = (a) => {
        if (!a || (!a.summary && !a.key_concerns && !(typeof a.key_concerns === 'string'))) return;
        let dateStr = (typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a.date))
          ? a.date.slice(0, 10)
          : (toJstDateStr(a.bookingTs) || toJstDateStr(a.createdAt) || toJstDateStr(a.ts) || toJstDateStr(new Date()));
        let kc = a.key_concerns;
        if (typeof kc === 'string') { try { kc = JSON.parse(kc); } catch (_) { kc = []; } }
        const concerns = (kc || []).slice(0, 3).join(' / ');
        const label = '面談実施' + (concerns ? ' — ' + concerns : '');
        // dateStr "YYYY-MM-DD" を ローカル noon でDate化 (UTC midnightだと前日表示される)
        const [yy, mm, dd] = dateStr.split('-').map(Number);
        meetingEvents.push({
          date: new Date(yy, mm - 1, dd, 12, 0, 0),
          kind: 'meeting',
          cat: 'meeting',
          label,
          title: '面談',
          major: true,
        });
      };
      // 1) localStorage 全 fp-ai-* から徳佐拓朗系を吸う
      aiKeys.forEach(k => {
        try { JSON.parse(localStorage.getItem(k) || '[]').forEach(collectFromEntry); } catch (_) {}
      });
      // さらに 全 fp-ai-* キー走査 (★ genericFallback 撤去 — 厳密一致のみ)
      const allLsKeys = Object.keys(localStorage).filter(k => k.startsWith('fp-ai-'));
      allLsKeys.forEach(k => {
        if (aiKeys.has(k)) return;
        try {
          JSON.parse(localStorage.getItem(k) || '[]').forEach(a => {
            const ownMatch = (a.userId && a.userId === c.lineFriendId) || (a.customerName && a.customerName === c.name);
            if (ownMatch) collectFromEntry(a);
          });
        } catch (_) {}
      });
      // 2) GAS 永続化シート ai_results からも吸う (★ genericFallback 撤去)
      const liveAi = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
      // ★ 救済lookup: customerName='お客様'+uid空 で c.confirmedSlot ±6h 以内なら 該当客とみなす
      //   (renderMeetingRecordsBlock の救済lookup と 同じ条件 → カード表示と タイムライン entry が 一致)
      const cConfMsTL = c.confirmedSlot ? new Date(String(c.confirmedSlot).replace(' ','T')).getTime() : NaN;
      liveAi.forEach(r => {
        const strictMatch = (r.userId && r.userId === c.lineFriendId) ||
                            (r.customerName && r.customerName !== 'お客様' && r.customerName === c.name) ||
                            myBks.some(b => b.ts === r.bookingTs || b.userId === r.userId);
        let rescued = false;
        if (!strictMatch && !isNaN(cConfMsTL) && (!r.customerName || r.customerName === 'お客様') && !r.userId) {
          const rMs = new Date(String(r.ts || r.createdAt || r.bookingTs || '').replace(' ','T')).getTime();
          if (!isNaN(rMs) && Math.abs(rMs - cConfMsTL) < 6 * 60 * 60 * 1000) rescued = true;
        }
        if (strictMatch || rescued) collectFromEntry(r);
      });
      // ④ タイムライン細分化: AI議事録から抽出したタスク (due日) を中間イベント化
      //    ★ 品質改善 (オーナーfb「ただ書いてるだけで実用的でない」):
      //      - ヒアリング内容 (「〜したい」「歳」「子供が」等) は除外
      //      - 動詞 (作成・送付・確認・面談・連絡・提案) が無いものは除外
      //      - 類似タスク (教育資金資料 系) は1つに統合
      //      - 過去日タスクは「⏰ 期限超過」マーク
      //      - 優先度は実残日数から再計算
      try {
        const taskKeysTL = new Set();
        if (c.lineFriendId) taskKeysTL.add('fp-tasks-' + c.lineFriendId);
        if (c.id)           taskKeysTL.add('fp-tasks-' + c.id);
        if (c.name)         taskKeysTL.add('fp-tasks-' + c.name);
        myBks.forEach(b => { if (b.userId) taskKeysTL.add('fp-tasks-' + b.userId); if (b.ts) taskKeysTL.add('fp-tasks-' + b.ts); if (b.name) taskKeysTL.add('fp-tasks-' + b.name); });
        // ★ 全 fp-tasks-* スキャン廃止 — この顧客に紐づく key だけ読む

        // タスク収集 (フィルタ前)
        const rawTasks = [];
        taskKeysTL.forEach(k => {
          try { JSON.parse(localStorage.getItem(k) || '[]').forEach(t => { if (t.due && t.task) rawTasks.push(t); }); } catch (_) {}
        });
        ((window.LineAppLiveData && window.LineAppLiveData.ai_tasks) || []).forEach(t => {
          // ★ genericFallback 撤去 — 厳密一致のみ
          const match = (t.userId && t.userId === c.lineFriendId) ||
                        (t.customerName && t.customerName === c.name) ||
                        myBks.some(b => b.ts === t.bookingTs || b.userId === t.userId);
          if (match && t.due && t.task) rawTasks.push(t);
        });

        // ★ フィルタ1: ヒアリング系を除外 (タスクではなく事実/希望)
        const isHearingNoise = (txt) => {
          const s = String(txt || '').trim();
          if (s.length < 5) return true;
          // 「〜したい/〜である/〜です」+ 動作主が顧客 = ヒアリング内容
          if (/(したい|やりたい|なりたい|あります|あった|になる|である|です。|だ。)$/.test(s)) return true;
          // 「年齢は●歳」「子供が●歳」「収入が●」等の状態描写
          if (/^(年齢は|子供が|子どもが|収入が|貯金が|資産が|現在|今は|今の|私は|私が|妻は|夫は)/.test(s)) return true;
          // 数字+歳/万円 だけの記述
          if (/^(\d+歳|\d+万円|\d+円|約\d)/.test(s) && s.length < 30) return true;
          return false;
        };
        // ★ フィルタ2: 動詞 (アクション) を含まないものは除外
        const hasActionVerb = (txt) => /(作成|送付|送信|送る|確認|連絡|架電|電話|面談|相談|提案|準備|手配|登録|申込|契約|配送|納品|納入|シミュ|レポート|提示|案内|フォロー|ヒアリング|見直し)/.test(txt);

        const filtered = rawTasks.filter(t => !isHearingNoise(t.task) && hasActionVerb(t.task));

        // ★ 重複統合: 類似タスク (キーワード単位) を 最も早い due に統合
        const groupKey = (txt) => {
          const s = String(txt || '');
          if (/教育/.test(s) && /(資料|シミュ|プラン|試算)/.test(s)) return 'edu_doc';
          if (/老後/.test(s) && /(資料|プラン|シミュ|提案|iDeCo|小規模)/.test(s)) return 'retire_doc';
          if (/(家計|収支)/.test(s) && /(ヒアリング|シート|資料)/.test(s)) return 'household_doc';
          if (/(ライフプラン|ライフ\s*プラン)/.test(s)) return 'lifeplan_doc';
          if (/(節税|所得控除)/.test(s)) return 'tax_doc';
          if (/(保険|事業用保険)/.test(s) && /(見直|確認|提案)/.test(s)) return 'insurance_doc';
          if (/(開業|事業資金)/.test(s)) return 'biz_doc';
          if (/(NISA)/i.test(s)) return 'nisa_doc';
          return 'task_' + s.slice(0, 12);
        };

        const grouped = {};
        filtered.forEach(t => {
          const k = groupKey(t.task);
          if (!grouped[k] || new Date(t.due) < new Date(grouped[k].due)) grouped[k] = t;
        });

        // 優先度を実残日数から再計算
        const TODAY_MS = Date.now();
        const recalcPriority = (dueStr) => {
          const days = Math.ceil((new Date(dueStr).getTime() - TODAY_MS) / 86400000);
          if (days < 0) return '⏰期限超過';
          if (days <= 3) return '至急';
          if (days <= 7) return '今週';
          if (days <= 14) return '2週間以内';
          if (days <= 30) return '今月';
          if (days <= 90) return '3ヶ月以内';
          return '来期以降';
        };

        Object.values(grouped).forEach(t => {
          const pri = recalcPriority(t.due);
          const isOverdue = pri === '⏰期限超過';
          meetingEvents.push({
            date: new Date(t.due),
            kind: 'task',
            cat: isOverdue ? 'critical' : 'contact',
            label: (isOverdue ? '⏰ ' : '📋 ') + t.task + ' [' + pri + ']',
            title: 'タスク',
            major: pri === '至急' || pri === '今週' || isOverdue,
          });
        });
      } catch (e) { console.warn('task timeline merge skipped:', e); }

      // 同 date 重複除去
      const seenDate = new Set();
      const dedup = meetingEvents.filter(e => {
        const k = e.date.toISOString().slice(0, 10) + '|' + (e.label || '');
        if (seenDate.has(k)) return false;
        seenDate.add(k);
        return true;
      });
      // ★ 議事録 連番付け: 時系列 (古→新) 順に「議事録1, 議事録2, ...」 を ラベル先頭に
      const sortedMeetings = dedup.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      sortedMeetings.forEach((e, idx) => {
        const n = idx + 1;
        // 既存 label が「面談実施 — concerns」 → 「議事録N — concerns」 に置き換え
        const tailMatch = String(e.label || '').match(/^面談実施(.*)$/);
        e.label = '議事録' + n + (tailMatch ? tailMatch[1] : '');
        e.title = '議事録' + n;
        e.meetingIndex = n;
      });
      events = sortedMeetings.concat(events).sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (e) { console.warn('meeting events skipped:', e); }

    // ③ 「次の一手」ブロック用データ抽出 (最新 AI 議事録 + 未完了タスク 上位3件)
    // ★ latestAi は try ブロック外でも使う (line 1950 等) → block scope 罠回避のため 外に宣言
    let latestAi = null;
    let nextActionHtml = '';
    try {
      const allFpAi = Object.keys(localStorage).filter(k => k.startsWith('fp-ai-'));
      allFpAi.forEach(k => {
        const arr = JSON.parse(localStorage.getItem(k) || '[]');
        arr.forEach(a => {
          // ★ オーナーfb: NEXT ACTION が全顧客で同一に。genericFallback 撤去、厳密一致のみ
          const match = (a.userId && a.userId === c.lineFriendId) || (a.customerName && a.customerName === c.name);
          if (!match) return;
          if (!latestAi || new Date(a.createdAt || 0) > new Date(latestAi.createdAt || 0)) latestAi = a;
        });
      });
      ((window.LineAppLiveData && window.LineAppLiveData.ai_results) || []).forEach(r => {
        const match = (r.userId && r.userId === c.lineFriendId) || (r.customerName && r.customerName === c.name);
        if (!match) return;
        if (!latestAi || new Date(r.ts || r.createdAt || 0) > new Date(latestAi.createdAt || 0)) {
          latestAi = { summary: r.summary, next_meeting_suggestion: r.next_meeting_suggestion, createdAt: r.ts };
        }
      });
      const taskCandidates = [];
      // ★ オーナーfb: タスク leak 修正。この顧客に紐づく key だけを読む (全 fp-tasks-* スキャンは廃止)
      const tkeys = new Set();
      if (c.lineFriendId) tkeys.add('fp-tasks-' + c.lineFriendId);
      if (c.id) tkeys.add('fp-tasks-' + c.id);
      if (c.name) tkeys.add('fp-tasks-' + c.name);
      const seenT = new Set();
      tkeys.forEach(k => {
        try {
          JSON.parse(localStorage.getItem(k) || '[]').forEach(t => {
            const id = (t.due || '') + '|' + (t.task || '');
            if (seenT.has(id)) return; seenT.add(id);
            taskCandidates.push(t);
          });
        } catch (_) {}
      });
      ((window.LineAppLiveData && window.LineAppLiveData.ai_tasks) || []).forEach(t => {
        // ★ オーナーfb: タスク leak 修正、厳密一致のみ
        const match = (t.userId && t.userId === c.lineFriendId) || (t.customerName && t.customerName === c.name);
        if (!match) return;
        const id = (t.due || '') + '|' + (t.task || '');
        if (seenT.has(id)) return; seenT.add(id);
        taskCandidates.push(t);
      });
      // 上位3件 (日付近い順)
      const topTasks = taskCandidates
        .filter(t => t.task)
        .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')))
        .slice(0, 3);
      if (latestAi || topTasks.length > 0) {
        const sugg = latestAi && (latestAi.next_meeting_suggestion || (latestAi.summary || '').split('\n')[0]);
        nextActionHtml = `
          <div class="fp-next-action">
            <div class="fp-next-action-eyebrow" style="display:flex;justify-content:space-between;align-items:center;">
              <span style="display:flex;align-items:center;gap:8px;"><i data-lucide="zap" style="width:14px;height:14px;"></i>NEXT ACTION — この方への次の一手</span>
              <button data-open-hearing="${escapeHtml(c.id)}" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);color:#fff;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.04em;">📋 ヒアリングシート</button>
            </div>
            ${sugg ? `<div class="fp-next-action-title">${escapeHtml(sugg)}</div>` : '<div class="fp-next-action-title">優先タスク</div>'}
            ${latestAi && latestAi.summary ? `<div class="fp-next-action-body">${escapeHtml(latestAi.summary.split('\n').slice(0, 3).join('\n'))}</div>` : ''}
            ${topTasks.length > 0 ? `<div class="fp-next-action-tasks">
              ${topTasks.map(t => `
                <div class="fp-next-action-task">
                  <span class="fp-next-action-task-icon">${t.icon || '✅'}</span>
                  <span class="fp-next-action-task-title">${escapeHtml(t.task || '')}</span>
                  <span class="fp-next-action-task-due">${escapeHtml(t.due || '期日未定')}</span>
                  <button class="fp-next-action-task-make" data-make-deliverable="${escapeHtml(t.task || '')}" data-client-id="${escapeHtml(c.id)}">📎 資料を作成</button>
                </div>
              `).join('')}
            </div>` : ''}
          </div>
        `;
      }
    } catch (e) { console.warn('next-action block skipped:', e); }
    // ★ オーナーfb「返信なかったら追撃ラインを見える化」
    // localStorage の fp-draft-tracking から「この客で送信済 + 返信待ち」を判定
    try {
      const tracking = JSON.parse(localStorage.getItem('fp-draft-tracking') || '{}');
      const t = tracking[c.id];
      if (t && t.awaitingReply && t.lastSentAt) {
        const daysSinceSent = Math.floor((Date.now() - new Date(t.lastSentAt).getTime()) / 86400000);
        // 客から返信あったかチェック (lineHistory で送信時刻以降に from='user' があれば返信あり)
        const replied = (c.lineHistory || []).some(m => {
          const isUser = (m.from === 'user' || m.direction === 'in');
          return isUser && m.ts && new Date(m.ts).getTime() > new Date(t.lastSentAt).getTime();
        });
        if (replied) {
          // ★ オーナーfb「客返信あり FP未返信 → 赤い目立つバナー + 自動で Jobs が返信案生成」
          tracking[c.id].awaitingReply = false;
          tracking[c.id].repliedAt = new Date().toISOString();
          try { localStorage.setItem('fp-draft-tracking', JSON.stringify(tracking)); } catch (_) {}
          // 最新の客返信内容を抽出
          const lastReply = (c.lineHistory || []).slice().reverse().find(m => (m.from === 'user' || m.direction === 'in'));
          const replyText = lastReply ? (lastReply.text || lastReply.message || '') : '';
          const replyBanner = `
            <div style="background:linear-gradient(135deg,#DC2626,#991B1B);color:#fff;padding:16px 18px;border-radius:12px;margin-bottom:14px;box-shadow:0 8px 28px rgba(220,38,38,0.45),0 0 0 4px rgba(255,255,255,0.5);">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                <div style="font-size:28px;">⚠️</div>
                <div style="flex:1;">
                  <div style="font-size:11px;font-weight:800;letter-spacing:0.18em;opacity:0.9;text-transform:uppercase;">客返信あり / FP 未返信</div>
                  <div style="font-size:15px;font-weight:900;margin-top:2px;letter-spacing:0.02em;">この方への返事がまだです</div>
                </div>
              </div>
              ${replyText ? `<div style="background:rgba(255,255,255,0.18);border-left:3px solid #fff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px;line-height:1.55;">💬 ${escapeHtml(replyText.slice(0, 200))}${replyText.length > 200 ? '…' : ''}</div>` : ''}
              <button id="fp-track-next" data-cid="${escapeHtml(c.id)}" style="width:100%;background:#fff;color:#991B1B;border:none;padding:12px 18px;border-radius:8px;font-weight:900;cursor:pointer;font-size:14px;font-family:inherit;letter-spacing:0.04em;box-shadow:0 4px 14px rgba(0,0,0,0.15);">✨ Jobs と返信案を一緒に作る → 即送信</button>
            </div>
            <style>@keyframes fp-reply-pulse{0%,100%{box-shadow:0 8px 28px rgba(220,38,38,0.45),0 0 0 4px rgba(255,255,255,0.5)}50%{box-shadow:0 14px 38px rgba(220,38,38,0.65),0 0 0 8px rgba(255,255,255,0.55)}}</style>
          `;
          nextActionHtml = replyBanner + (nextActionHtml || '');
        } else if (daysSinceSent >= 3) {
          // 3日以上経過で返信なし → 追撃提案バナー
          const urgency = daysSinceSent >= 7 ? '🔥 1週間以上' : '⏰ ' + daysSinceSent + '日';
          const bg = daysSinceSent >= 7 ? 'linear-gradient(135deg,#dc2626,#991b1b)' : 'linear-gradient(135deg,#F97316,#EA580C)';
          const followupBanner = `
            <div style="background:${bg};color:#fff;padding:12px 16px;border-radius:10px;margin-bottom:12px;display:flex;align-items:center;gap:10px;">
              <div style="font-size:22px;">📨</div>
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:800;">${urgency}前送信 — 返信なし (追撃 ${t.followupCount}回目)</div>
                <div style="font-size:11.5px;opacity:0.92;margin-top:2px;line-height:1.45;">「${escapeHtml(t.lastSentText.slice(0, 60))}…」<br>${daysSinceSent >= 7 ? '関係維持リスク — 別アプローチの追撃推奨' : '柔らかい追撃で返信率UP'}</div>
              </div>
              <button id="fp-track-followup" data-cid="${escapeHtml(c.id)}" style="background:#fff;color:${daysSinceSent >= 7 ? '#dc2626' : '#EA580C'};border:none;padding:8px 14px;border-radius:6px;font-weight:800;cursor:pointer;font-size:12px;font-family:inherit;white-space:nowrap;">✨ 追撃ライン 作成</button>
            </div>
            <style>@keyframes fp-followup-pulse{0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,0.5)}50%{box-shadow:0 0 0 8px rgba(249,115,22,0)}}</style>
          `;
          nextActionHtml = followupBanner + (nextActionHtml || '');
        }
      }
    } catch (e) { console.warn('tracking banner skipped:', e); }
    // ★ オーナーfb「Jobs 候補のワークフロー + 今動いてるワークフローも表示」
    try {
      // 同日複数 AI議事録 を 1 meeting に dedup (KPI ステージと整合)
      const _wfDedup = (arr) => {
        const seen = new Set(); const out = [];
        arr.forEach(e => { const k = new Date(e.date).toISOString().slice(0, 10); if (!seen.has(k)) { seen.add(k); out.push(e); } });
        return out;
      };
      const pastMs = _wfDedup(events.filter(e => e.kind === 'meeting' && new Date(e.date) <= TODAY)).length;
      const futureMs = _wfDedup(events.filter(e => e.kind === 'meeting' && new Date(e.date) > TODAY)).length;
      const stages = [
        { key: 'lead',    label: '初回接触', icon: '👋' },
        { key: 'first',   label: '1回目 Zoom', icon: '💻' },
        { key: 'second',  label: '2回目 Zoom', icon: '🔄' },
        { key: 'propose', label: '3回目 提案', icon: '📊' },
        { key: 'close',   label: 'クロージング', icon: '🎯' },
      ];
      const currentStageIdx = Math.min(pastMs + (futureMs > 0 ? 0 : 0), stages.length - 1);
      const nextStageIdx = Math.min(currentStageIdx + 1, stages.length - 1);
      // いま動いてるアクション抽出 (進行中 = 「最近メール送った/録画した/AI生成した」)
      const _lineMsgs = (c.lineHistory || []);
      const recentMs = _lineMsgs.slice(-3).reverse();
      const activeActions = [];
      if (futureMs > 0) activeActions.push({ icon: '📅', label: '次回 Zoom 確定済', tone: 'done' });
      if (latestAi && latestAi.summary) activeActions.push({ icon: '🤖', label: 'AI議事録 生成済', tone: 'done' });
      const ongoingAiPills = document.querySelectorAll('[id^="fp-ai-pill-"]');
      if (ongoingAiPills.length > 0) activeActions.push({ icon: '⚡', label: 'Jobs が資料生成中 (' + ongoingAiPills.length + '件)', tone: 'active' });
      if (recentMs.length > 0) {
        const lastMsg = recentMs[0];
        if (lastMsg && lastMsg.from === 'fp') activeActions.push({ icon: '📨', label: 'LINE 送信 (返信待ち)', tone: 'wait' });
        else if (lastMsg && lastMsg.from === 'user') activeActions.push({ icon: '💬', label: 'お客様 返信あり (要対応)', tone: 'todo' });
      }
      // Jobs 候補 = 未達成 KPI 上位
      const jobsCandidates = [];
      const stageMap = { 0: '0->1', 1: '1->2', 2: '2->3', 3: '3->close' };
      const stageKey = stageMap[Math.min(pastMs, 3)] || '3->close';
      const kpiHintsMap = {
        '0->1': ['日程確定 LINE 送付', '事前アンケート確認', 'Zoom URL 発行'],
        '1->2': ['お礼/感想ヒアリング LINE', '2回目候補日 提示', '初回議事録から資料3点作成'],
        '2->3': ['ライフプラン作成', 'シミュ3パターン', '提案商品 絞込'],
        '3->close': ['提案資料 送付', '契約意向 確認', '次回見直し設定'],
      };
      (kpiHintsMap[stageKey] || []).forEach(h => jobsCandidates.push(h));
      // ★ オーナーfb 2026-06-20: 「使い方分からん、 消すか シンプルに」 → 「いま動いてる」「Jobs候補」 2box 削除、 stepper のみ ライト版
      const workflowHtml = `
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px 18px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="font-size:11.5px;font-weight:800;color:#475569;letter-spacing:0.02em;">📍 進捗 — 現在 <strong style="color:#0F172A;">${escapeHtml(stages[currentStageIdx].label)}</strong></div>
            <div style="font-size:11px;color:#64748B;font-weight:600;">面談 ${pastMs}回 / 次予約 ${futureMs}件</div>
          </div>
          <div style="display:flex;gap:4px;align-items:center;overflow-x:auto;">
            ${stages.map((s, i) => `
              <div style="flex:1;min-width:80px;text-align:center;padding:8px 6px;border-radius:8px;background:${i < currentStageIdx ? '#DCFCE7' : i === currentStageIdx ? 'linear-gradient(135deg,#FB923C,#EA580C)' : '#fff'};border:1.5px solid ${i < currentStageIdx ? '#86EFAC' : i === currentStageIdx ? '#EA580C' : '#E2E8F0'};color:${i === currentStageIdx ? '#fff' : '#0F172A'};">
                <div style="font-size:18px;">${i < currentStageIdx ? '✓' : s.icon}</div>
                <div style="font-size:10.5px;font-weight:700;margin-top:3px;${i > currentStageIdx ? 'opacity:0.5;' : ''}">${escapeHtml(s.label)}</div>
              </div>
              ${i < stages.length - 1 ? '<div style="font-size:12px;color:#CBD5E1;">→</div>' : ''}
            `).join('')}
          </div>
        </div>
      `;
      nextActionHtml = workflowHtml + nextActionHtml;
    } catch (e) { console.warn('workflow block skipped:', e); }
    window._fpNextActionHtml = nextActionHtml;
    const recs = window.Recommender.forClient(c, events);

    const familyHtml = (c.family || []).length === 0
      ? '<li style="color:var(--muted)">単身</li>'
      : (c.family || []).map(m => {
          const relCls = m.rel === 'spouse' ? 'spouse' : (m.rel === 'child' ? 'child' : '');
          const relLabel = m.rel === 'spouse' ? '配偶者' : (m.rel === 'child' ? 'お子様' : m.rel);
          const age = window.LifeEvents.currentAge({ birth: m.birth });
          return `<li><span><span class="rel-tag ${relCls}">${relLabel}</span>${escapeHtml(m.name)}</span><span style="color:var(--muted);font-size:12px;">${age}歳 (${m.birth})</span></li>`;
        }).join('');

    const proposalsHtml = (c.proposals || []).length === 0
      ? '<li class="empty">提案履歴なし</li>'
      : (c.proposals || []).slice().reverse().map(p => `
          <li>
            <span class="pdate">${p.date}</span>
            <span>${escapeHtml(p.title)}</span>
            <span class="presult ${p.result}">${p.result}</span>
          </li>
        `).join('');

    // ★ ライフイベント 空状態 CTA: 生年月日+配偶者+子の生年月日 を即入力 → 30年タイムライン自動展開
    //   議事録 events が 入った後の events.length ではなく、 純粋ライフイベント数 で判定
    const needsBirth = !c.birth || c.birth === '1985-01-01';
    const needsFamily = !((c.family || []).length);
    const showLifeCta = pureLifeEventCount === 0 && (needsBirth || needsFamily);
    const lifeCtaCard = showLifeCta ? `
        <div style="background:linear-gradient(135deg,#faf5ff,#fff);border:2px solid #c084fc;border-radius:14px;padding:22px 24px;margin:6px 0;box-shadow:0 4px 12px rgba(192,132,252,0.15);">
          <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:14px;">
            <div style="font-size:30px;line-height:1;">🗓️</div>
            <div style="flex:1;">
              <div style="font-size:15px;font-weight:800;color:#581c87;letter-spacing:0.02em;margin-bottom:4px;">この方の30年タイムラインを 今すぐ展開</div>
              <div style="font-size:12.5px;color:#6b21a8;line-height:1.6;">下記3項目を埋めると、 退職金準備期 (55歳) / 定年 (60歳) / 年金受給開始 (65歳) / お子様の進学費用ピーク (18歳) 等の節目が 自動で表示されます。</div>
            </div>
          </div>
          <div id="life-cta-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#fff;border-radius:10px;padding:14px 16px;border:1px solid #e9d5ff;">
            <div>
              <label style="display:block;font-size:11px;color:#7b8499;font-weight:700;margin-bottom:4px;letter-spacing:0.06em;">本人 生年月日 ★</label>
              <input type="date" id="life-cta-birth" value="${escapeHtml(needsBirth ? '' : c.birth)}" style="width:100%;padding:9px 11px;border:1.5px solid #e3e7ee;border-radius:7px;font-size:14px;font-family:inherit;">
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#7b8499;font-weight:700;margin-bottom:4px;letter-spacing:0.06em;">配偶者 生年月日 (任意)</label>
              <input type="date" id="life-cta-spouse-birth" style="width:100%;padding:9px 11px;border:1.5px solid #e3e7ee;border-radius:7px;font-size:14px;font-family:inherit;">
            </div>
            <div style="grid-column:1 / -1;">
              <label style="display:block;font-size:11px;color:#7b8499;font-weight:700;margin-bottom:4px;letter-spacing:0.06em;">お子様 生年月日 (複数可・任意)</label>
              <div id="life-cta-children" style="display:flex;flex-direction:column;gap:6px;"></div>
              <button type="button" id="life-cta-add-child" style="margin-top:6px;background:#fff;color:#7c3aed;border:1.5px dashed #c4b5fd;padding:7px 12px;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer;letter-spacing:0.04em;font-family:inherit;">+ お子様を追加</button>
            </div>
            <div style="grid-column:1 / -1;display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
              <button type="button" id="life-cta-cancel" style="background:#fff;color:#6b7280;border:1px solid #e5e7eb;padding:9px 18px;border-radius:7px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;">あとで</button>
              <button type="button" id="life-cta-save" style="background:linear-gradient(135deg,#9333ea,#7c3aed);color:#fff;border:none;padding:9px 22px;border-radius:7px;font-size:12.5px;font-weight:800;cursor:pointer;letter-spacing:0.04em;font-family:inherit;box-shadow:0 3px 10px rgba(124,58,237,0.3);">💫 タイムラインを展開する</button>
            </div>
          </div>
        </div>` : '';
    const timelineHtml = lifeCtaCard + (events.length === 0
      ? (showLifeCta ? '' : '<div class="empty">向こう30年に予測イベントなし</div>')
      : events.map(ev => `
          <div class="client-timeline-item">
            <div class="when">${fmtDate(ev.date)}<span class="relative">${window.LifeEvents.formatRelative(ev.date)}</span></div>
            <div class="ev-label">
              <span class="timeline-event ${ev.cat}${ev.major ? ' major' : ''}" style="position:static;display:inline-block;">${escapeHtml(ev.label)}</span>
              <span class="ev-who">${escapeHtml(ev.who)}</span>
            </div>
          </div>
        `).join(''));

    const actionsHtml = recs.length === 0
      ? '<div class="empty">直近の推奨アクションなし</div>'
      : recs.slice(0, 6).map(r => {
          const cls = r.priority >= 85 ? '' : (r.priority >= 65 ? 'mid' : 'low');
          return `
            <div class="a-item">
              <div><span class="p-tag ${cls}">${priorityLabel(r.priority)}</span></div>
              <div>
                <strong>${escapeHtml(r.action)}</strong>
                <div class="a-reason">${escapeHtml(r.reason)}</div>
              </div>
            </div>
          `;
        }).join('');

    const mortgageHtml = c.mortgage
      ? `<dt>住宅ローン</dt><dd>残${c.mortgage.remainingYears}年 / 月¥${c.mortgage.monthly.toLocaleString()}</dd>`
      : '';

    // ====== NEW PREMIUM 2-COLUMN MODAL ======
    const initial = (c.name || '?').replace(/\s+/g, '').slice(0, 1);
    const age = window.LifeEvents.currentAge(c);
    const childCount = (c.family || []).filter(m => m.rel === 'child').length;
    const familyShort = childCount > 0 ? `配偶者 + 子${childCount}` :
      ((c.family || []).find(m => m.rel === 'spouse') ? '夫婦' : '単身');
    const days = daysSince(c.lastContact);
    const aumDisp = c.aum >= 100000000 ? `¥${(c.aum/100000000).toFixed(2)}億` : `¥${Math.round(c.aum/10000).toLocaleString()}万`;
    const topRec = recs[0] || null;
    const futureEvs = events.filter(ev => new Date(ev.date) >= TODAY);
    const nextEv = futureEvs[0];
    const eventsByCat = events.reduce((acc, ev) => { acc[ev.cat] = (acc[ev.cat] || 0) + 1; return acc; }, {});

    // Family avatar + meta list
    const familyHtml2 = (c.family || []).length === 0
      ? '<div class="cd-empty">単身</div>'
      : (c.family || []).map(m => {
          const relLabel = m.rel === 'spouse' ? '配偶者' : (m.rel === 'child' ? 'お子様' : m.rel);
          const mAge = window.LifeEvents.currentAge({ birth: m.birth });
          const mInit = (m.name || '?').replace(/\s+/g, '').slice(0, 1);
          return `<div class="cd-family-row">
            <span class="cd-family-avatar">${escapeHtml(mInit)}</span>
            <div class="cd-family-body">
              <div class="cd-family-name">${escapeHtml(m.name)}</div>
              <div class="cd-family-meta">${relLabel} · ${mAge}歳</div>
            </div>
          </div>`;
        }).join('');

    // Timeline (次Zoom繋ぎ KPI 達成率方式 — オーナーfb「1回目→2回目に繋ぐKPI / 2回目→3回目に繋ぐKPI」)
    const timelineHtml2 = (function () {
      const TODAY = new Date(); TODAY.setHours(0,0,0,0);
      // ★ オーナーfb「1回目Zoomしかしてないのに 2回目議事録 KPI 出る」バグ修正:
      //    同じ日に AI議事録 が 複数 (label違い) あると別 meeting として cnt されてた
      //    → 「同じ日 = 1回の面談」として dedup
      const _futM = events.filter(e => e.kind === 'meeting' && new Date(e.date) > TODAY);
      const _pastM = events.filter(e => e.kind === 'meeting' && new Date(e.date) <= TODAY)
                           .sort((a,b)=> new Date(b.date) - new Date(a.date));
      const _dedupByDate = (arr) => {
        const seen = new Set();
        return arr.filter(e => {
          const k = new Date(e.date).toISOString().slice(0, 10);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      };
      const futureMeetings = _dedupByDate(_futM);
      const pastMeetings   = _dedupByDate(_pastM);
      const lastMeeting    = pastMeetings[0];
      const meetingsSoFar  = pastMeetings.length;

      // ★ KPIエンジン: ステージ別の「次回に繋ぐ」達成指標を定義
      // 評価軸:
      //  - status: 'done'(達成) / 'progress'(進行中) / 'todo'(未着手) / 'risk'(期限超過)
      //  - howTo: 達成方法 (FPがやること)
      const hasAiResult = ((window.LineAppLiveData && window.LineAppLiveData.ai_results) || [])
        .some(r => (r.userId === c.lineFriendId) || (r.customerName === c.name));
      const lineMsgs = (c.lineHistory || []);
      const fpMsgsAfterLast = lastMeeting
        ? lineMsgs.filter(m => m.from === 'fp' && new Date(m.ts || m.date) > new Date(lastMeeting.date))
        : [];
      const userReplyAfterLast = lastMeeting
        ? lineMsgs.some(m => m.from === 'user' && new Date(m.ts || m.date) > new Date(lastMeeting.date))
        : false;
      const hasFutureBooking = futureMeetings.length > 0;
      const hasRecentProposal = (c.proposals || []).some(p => new Date(p.date) > new Date(Date.now() - 30*86400000));
      const aiResultsForC = ((window.LineAppLiveData && window.LineAppLiveData.ai_results) || [])
        .filter(r => (r.userId === c.lineFriendId) || (r.customerName === c.name));
      const latestAi = aiResultsForC.sort((a,b)=> new Date(b.ts||0) - new Date(a.ts||0))[0];
      const hearingDepth = latestAi ? ((typeof latestAi.key_concerns === 'string' ? JSON.parse(latestAi.key_concerns || '[]') : (latestAi.key_concerns || [])).length) : 0;

      // ★ ステージ判定
      let stage, stageLabel, nextStageLabel, stageColor;
      if (meetingsSoFar === 0) {
        stage = '0->1'; stageLabel = '初回 Zoom 前'; nextStageLabel = '初回 Zoom 実施'; stageColor = '#7c3aed';
      } else if (meetingsSoFar === 1) {
        stage = '1->2'; stageLabel = '1回目 終了'; nextStageLabel = '2回目 Zoom'; stageColor = '#0ea5e9';
      } else if (meetingsSoFar === 2) {
        stage = '2->3'; stageLabel = '2回目 終了'; nextStageLabel = '3回目 (提案プレゼン)'; stageColor = '#f59e0b';
      } else {
        stage = '3->close'; stageLabel = (meetingsSoFar) + '回目 終了'; nextStageLabel = 'クロージング/契約'; stageColor = '#10b981';
      }

      // ★ KPI 定義 (ステージ毎)
      const kpiSets = {
        '0->1': [
          { name: '日程確定', status: hasFutureBooking ? 'done' : 'todo', howTo: 'LINE で候補日3つ送って → お客様タップで自動確定' },
          { name: '事前アンケート回収', status: ((c.surveys && c.surveys.length > 0) || (window.LineAppLiveData && (window.LineAppLiveData.survey_answers || []).some(s => s.userId === c.lineFriendId))) ? 'done' : 'todo', howTo: '公式LINE登録時に自動配信 → 5項目回答' },
          { name: 'Zoom URL 発行', status: hasFutureBooking ? 'done' : 'todo', howTo: '候補日確定と同時に自動発行 (S2S OAuth)' },
          { name: '事前リマインド', status: hasFutureBooking && fpMsgsAfterLast.length > 0 ? 'done' : 'todo', howTo: '前日に LINE で「明日XX時 Zoom です」自動送信' },
        ],
        '1->2': [
          { name: '初回 議事録 生成', status: hasAiResult ? 'done' : 'todo', howTo: 'Zoom録画 → ■停止 → AI議事録自動生成' },
          { name: 'お礼/感想ヒアリング LINE', status: fpMsgsAfterLast.some(m => /ありがとう|お礼|感想|いかが/.test(m.text||'')) ? 'done' : 'todo', howTo: '面談終了2-3h以内に「本日はありがとうございました」+感想質問' },
          { name: 'お客様からの返信あり', status: userReplyAfterLast ? 'done' : (fpMsgsAfterLast.length > 0 ? 'progress' : 'todo'), howTo: '返信なければ3日後にもう一度短文 LINE で繋ぐ' },
          { name: '2回目 候補日 提示', status: hasFutureBooking ? 'done' : 'todo', howTo: 'LINE で候補日3つ → お客様タップで自動確定' },
          { name: 'ヒアリング深掘り (3項目以上)', status: hearingDepth >= 3 ? 'done' : (hearingDepth >= 1 ? 'progress' : 'todo'), howTo: 'AI議事録の key_concerns が 3個以上抽出されてればOK' },
        ],
        '2->3': [
          { name: '2回目 議事録 生成', status: aiResultsForC.length >= 2 ? 'done' : 'todo', howTo: 'Zoom録画 → ■停止 → AI議事録自動生成' },
          { name: 'ライフプラン作成', status: (c.deliverables || []).some(d => /ライフプラン/.test(d.title||'')) ? 'done' : 'todo', howTo: '成果物タブ → ライフプラン テンプレ → AI下書き → 送付' },
          { name: 'シミュレーション 3パターン', status: (c.deliverables || []).filter(d => /シミュ|試算/.test(d.title||'')).length >= 1 ? 'progress' : 'todo', howTo: '保守的/標準/積極の3パターン → 提案プレゼンの主役' },
          { name: '提案商品 候補絞り込み', status: hasRecentProposal ? 'done' : 'todo', howTo: 'NISA/iDeCo/保険 から お客様に最適な 1-3商品を選定' },
          { name: '3回目 (提案) 日程確定', status: hasFutureBooking ? 'done' : 'todo', howTo: 'LINE で候補日 → 提案資料は前日までに送付' },
        ],
        '3->close': [
          { name: '提案資料 送付済', status: hasRecentProposal ? 'done' : 'todo', howTo: '提案プレゼン前日までに PDF を LINE で先出し' },
          { name: '質問対応 完了', status: userReplyAfterLast ? 'progress' : 'todo', howTo: 'お客様の懸念事項を1つ1つ潰す (LINE or 短時間 Zoom)' },
          { name: '契約意向 確認', status: 'todo', howTo: '「次のステップ」を明示 (申込書送付 / 比較検討期間)' },
          { name: '契約 or 次回 見直し設定', status: 'todo', howTo: '契約 → 申込手続き / 検討 → 1ヶ月後 再面談セット' },
        ],
      };
      const kpis = kpiSets[stage] || [];
      const doneCount = kpis.filter(k => k.status === 'done').length;
      const progressCount = kpis.filter(k => k.status === 'progress').length;
      const pct = kpis.length === 0 ? 0 : Math.round((doneCount + progressCount * 0.5) / kpis.length * 100);

      // ★ マイルストーン日 (次の Zoom 予定 or 推定)
      let msDate = null, msIsActual = false;
      if (futureMeetings.length > 0) { msDate = new Date(futureMeetings[0].date); msIsActual = true; }
      else if (lastMeeting) {
        const offset = stage === '2->3' ? 14 : (stage === '3->close' ? 30 : 14);
        msDate = new Date(lastMeeting.date); msDate.setDate(msDate.getDate() + offset);
      }
      const daysToMs = msDate ? Math.ceil((msDate - TODAY) / 86400000) : null;

      // ★ KPI カード レンダリング
      const statusBadge = (s) => {
        if (s === 'done')     return '<span style="background:#10b981;color:#fff;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:800;letter-spacing:0.04em;">✓ 達成</span>';
        if (s === 'progress') return '<span style="background:#f59e0b;color:#fff;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:800;letter-spacing:0.04em;">⏳ 進行中</span>';
        if (s === 'risk')     return '<span style="background:#dc2626;color:#fff;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:800;letter-spacing:0.04em;">⚠ 要対応</span>';
        return '<span style="background:#e5e7eb;color:#6b7280;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:800;letter-spacing:0.04em;">○ 未着手</span>';
      };

      // KPI 名 → アクション ID マッピング (未着手なら「→ 今やる」ボタンで対応操作起動)
      const kpiActionMap = {
        '日程確定': 'open-line-slot',
        '事前アンケート回収': 'send-survey-line',
        'Zoom URL 発行': 'open-line-slot',
        '事前リマインド': 'send-reminder-line',
        '初回 議事録 生成': 'open-recording-tab',
        'お礼/感想ヒアリング LINE': 'send-thanks-line',
        'お客様からの返信あり': 'send-followup-line',
        '2回目 候補日 提示': 'send-slot-line',
        'ヒアリング深掘り (3項目以上)': 'open-hearing-sheet',
        '2回目 議事録 生成': 'open-recording-tab',
        'ライフプラン作成': 'make-deliv-lifeplan',
        'シミュレーション 3パターン': 'make-deliv-cashflow',
        '提案商品 候補絞り込み': 'make-deliv-nisa',
        '3回目 (提案) 日程確定': 'send-slot-line',
        '提案資料 送付済': 'make-deliv-custom',
        '質問対応 完了': 'send-followup-line',
        '契約意向 確認': 'send-followup-line',
        '契約 or 次回 見直し設定': 'send-slot-line',
      };
      const kpiRows = kpis.map(k => {
        const action = kpiActionMap[k.name];
        const isPending = k.status === 'todo' || k.status === 'risk' || k.status === 'progress';
        const actionBtn = (action && isPending) ? `<button class="fp-kpi-do" data-kpi-action="${action}" data-kpi-name="${escapeHtml(k.name)}" data-client-id="${escapeHtml(c.id)}" style="font-size:11px;padding:6px 12px;background:#5B5BF0;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:800;font-family:inherit;letter-spacing:0.02em;margin-top:4px;">→ 今やる</button>` : '';
        return `
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--ink);margin-bottom:3px;">${escapeHtml(k.name)}</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.5;">↳ ${escapeHtml(k.howTo)}</div>
            ${actionBtn}
          </div>
          <div style="align-self:flex-start;">${statusBadge(k.status)}</div>
        </div>
      `;
      }).join('');

      const headerHtml = `
        <div style="background:linear-gradient(135deg,${stageColor},#1b2845);color:#fff;border-radius:10px;padding:14px 18px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-size:10.5px;font-weight:700;letter-spacing:0.14em;opacity:0.75;">STAGE: ${escapeHtml(stageLabel)} → ${escapeHtml(nextStageLabel)}</div>
              <div style="font-size:16px;font-weight:800;margin-top:2px;">繋ぎ KPI 達成率 ${pct}%</div>
            </div>
            ${msDate ? `<div style="text-align:right;">
              <div style="font-size:10.5px;opacity:0.75;font-weight:700;letter-spacing:0.08em;">${msIsActual ? 'NEXT ZOOM' : '目安日'}</div>
              <div style="font-size:14px;font-weight:800;">${fmtDate(msDate)}</div>
              <div style="font-size:11px;opacity:0.85;">あと ${daysToMs} 日</div>
            </div>` : ''}
          </div>
          <div style="background:rgba(255,255,255,0.18);border-radius:99px;height:6px;overflow:hidden;">
            <div style="background:#fff;height:100%;width:${pct}%;transition:width 0.4s;"></div>
          </div>
          <div style="margin-top:8px;font-size:11px;opacity:0.85;">${doneCount}/${kpis.length} 達成 ${progressCount > 0 ? ' · ' + progressCount + ' 進行中' : ''}</div>
        </div>
      `;

      const kpiHtml = `
        <div style="background:#fff;border:1px solid var(--line);border-radius:10px;padding:6px 14px 10px;margin-bottom:14px;">
          ${kpiRows}
        </div>
      `;

      // ★ オーナーfb「フォロータスクとタイムライン統合」+「優先順位を色とポップで」
      const taskEvents = events.filter(e => e.kind === 'task').slice(0, 8);
      // 優先度判定: 残日数で 5段階
      const calcPri = (date) => {
        const days = Math.ceil((new Date(date) - TODAY) / 86400000);
        if (days < 0)   return { tier: 'overdue', label: '🔥 期限超過', bg: 'linear-gradient(135deg,#dc2626,#991b1b)', border: '#dc2626', textColor: '#fff', days };
        if (days <= 7)  return { tier: 'now',     label: '🔥 NOW (今週)', bg: 'linear-gradient(135deg,#f97316,#ea580c)', border: '#f97316', textColor: '#fff', days };
        if (days <= 21) return { tier: 'next',    label: '⏭ NEXT (2-3週)', bg: '#fef3c7', border: '#fbbf24', textColor: '#92400e', days };
        if (days <= 60) return { tier: 'soon',    label: '📅 SOON (来月)', bg: '#dbeafe', border: '#60a5fa', textColor: '#1e40af', days };
        return { tier: 'later', label: '📌 LATER', bg: '#f1f5f9', border: '#cbd5e1', textColor: '#475569', days };
      };
      const renderTaskRow = (ev, idx) => {
        const pri = calcPri(ev.date);
        const rel = window.LifeEvents.formatRelative(ev.date);
        const rawLabel = String(ev.label || '').replace(/^[📋⏰]\s*/, '').replace(/\s*\[[^\]]+\]$/, '');
        let dt = 'custom';
        if (/教育|進学|学費|大学|高校/.test(rawLabel)) dt = 'education';
        else if (/ライフプラン/.test(rawLabel)) dt = 'lifeplan';
        else if (/キャッシュフロー|収支|家計/.test(rawLabel)) dt = 'cashflow';
        else if (/NISA|つみたて|積立投資|配分|iDeCo/i.test(rawLabel)) dt = 'nisa';
        else if (/保険|保障/.test(rawLabel)) dt = 'insurance';
        else if (/老後|退職|年金/.test(rawLabel)) dt = 'retire';
        else if (/相続|贈与|遺産/.test(rawLabel)) dt = 'inherit';
        else if (/ヒアリング/.test(rawLabel)) dt = 'hearing';
        const isTop = idx === 0;
        const isHot = pri.tier === 'now' || pri.tier === 'overdue';
        const ringStyle = isHot ? `box-shadow:0 0 0 3px ${pri.border}33,0 8px 22px ${pri.border}44;` : '';
        const pulseStyle = '';
        return `<div style="background:#fff;border:2px solid ${pri.border};border-radius:10px;padding:12px 14px;margin-bottom:8px;${ringStyle}${pulseStyle}position:relative;">
          ${isTop ? `<div style="position:absolute;top:-10px;right:14px;background:${isHot ? pri.bg : '#5B5BF0'};color:#fff;font-size:10px;font-weight:900;padding:3px 10px;border-radius:10px;letter-spacing:0.08em;box-shadow:0 4px 10px rgba(0,0,0,0.18);">⚡ 最優先で着手</div>` : ''}
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
            <div style="background:${pri.bg};color:${pri.textColor};font-size:10px;font-weight:900;padding:4px 10px;border-radius:10px;letter-spacing:0.06em;white-space:nowrap;">${escapeHtml(pri.label)}</div>
            <div style="font-size:11px;color:var(--muted);font-family:'Inter',sans-serif;font-weight:700;">#${idx + 1}位</div>
            <div style="margin-left:auto;font-size:11px;color:var(--muted);white-space:nowrap;">${fmtDate(ev.date)} · ${rel}</div>
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--ink);line-height:1.45;margin-bottom:10px;">${escapeHtml(rawLabel)}</div>
          <button class="fp-task-make-deliv" data-task="${escapeHtml(rawLabel)}" data-type="${dt}" data-client-id="${escapeHtml(c.id||'')}" style="font-size:11.5px;padding:7px 14px;background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:800;font-family:inherit;letter-spacing:0.02em;box-shadow:0 4px 10px rgba(91,91,240,0.25);">✨ Jobs に資料作成依頼 → 編集 → LINE送信</button>
        </div>`;
      };
      // 段階別件数
      const tierCounts = { overdue: 0, now: 0, next: 0, soon: 0, later: 0 };
      taskEvents.forEach(e => tierCounts[calcPri(e.date).tier]++);
      const tierSummary = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;font-size:11px;">
          ${tierCounts.overdue > 0 ? `<span style="background:#dc2626;color:#fff;padding:4px 10px;border-radius:10px;font-weight:800;">🔥 期限超過 ${tierCounts.overdue}</span>` : ''}
          ${tierCounts.now > 0 ?     `<span style="background:#f97316;color:#fff;padding:4px 10px;border-radius:10px;font-weight:800;">🔥 NOW ${tierCounts.now}</span>` : ''}
          ${tierCounts.next > 0 ?    `<span style="background:#fef3c7;color:#92400e;padding:4px 10px;border-radius:10px;font-weight:800;border:1px solid #fbbf24;">⏭ NEXT ${tierCounts.next}</span>` : ''}
          ${tierCounts.soon > 0 ?    `<span style="background:#dbeafe;color:#1e40af;padding:4px 10px;border-radius:10px;font-weight:800;border:1px solid #60a5fa;">📅 SOON ${tierCounts.soon}</span>` : ''}
          ${tierCounts.later > 0 ?   `<span style="background:#f1f5f9;color:#475569;padding:4px 10px;border-radius:10px;font-weight:700;border:1px solid #cbd5e1;">📌 LATER ${tierCounts.later}</span>` : ''}
        </div>
      `;
      const taskListHtml = taskEvents.length === 0 ? '' : `
        <style>@keyframes fp-task-pulse{0%,100%{transform:translateY(0);box-shadow:0 0 0 3px rgba(249,115,22,0.22),0 8px 22px rgba(249,115,22,0.3)}50%{transform:translateY(-1px);box-shadow:0 0 0 5px rgba(249,115,22,0.3),0 12px 28px rgba(249,115,22,0.45)}}</style>
        <div style="background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
            <span>📋 議事録から抽出された具体タスク (優先度順)</span>
            <span style="font-size:10.5px;color:#94a3b8;text-transform:none;letter-spacing:0;">フォロータスクと統合</span>
          </div>
          ${tierSummary}
          ${taskEvents.slice().sort((a,b) => new Date(a.date) - new Date(b.date)).map((e,i) => renderTaskRow(e,i)).join('')}
        </div>
      `;

      // ★ オーナーfb: 全体タイムラインと同じカード形式に統一 (月別グループ → カード並び)
      const allEvents = events.slice(0, 60);
      const byMonth = {};
      allEvents.forEach(ev => {
        const d = ev.date instanceof Date ? ev.date : new Date(ev.date);
        if (isNaN(d)) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        (byMonth[key] = byMonth[key] || []).push({ ...ev, _d: d });
      });
      const monthRelLocal = (y, m) => {
        const target = new Date(y, m - 1, 1);
        const todayD = window.LifeEvents.TODAY;
        const cur = new Date(todayD.getFullYear(), todayD.getMonth(), 1);
        const dm = (target.getFullYear() - cur.getFullYear()) * 12 + (target.getMonth() - cur.getMonth());
        if (dm === 0) return '今月';
        if (dm === 1) return '来月';
        if (dm > 0 && dm < 12) return `${dm}ヶ月後`;
        if (dm < 0 && dm > -12) return `${-dm}ヶ月前`;
        if (dm >= 12) return `${(dm/12).toFixed(1)}年後`;
        return `${(-dm/12).toFixed(1)}年前`;
      };
      const monthsHtml = Object.keys(byMonth).sort().map(key => {
        const [y, m] = key.split('-');
        const monthEvents = byMonth[key];
        const cardsHtml = monthEvents.map(ev => `
          <div style="display:flex;align-items:stretch;gap:0;background:#fff;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;overflow:hidden;">
            <div style="width:5px;background:${ev.major ? '#DC2626' : (ev.cat === 'finance' ? '#5B5BF0' : ev.cat === 'education' ? '#0EA5E9' : ev.cat === 'retirement' ? '#EA580C' : ev.cat === 'family' ? '#CA8A04' : ev.cat === 'health' ? '#10B981' : '#94A3B8')};flex-shrink:0;"></div>
            <div style="flex:1;padding:12px 16px;display:flex;align-items:center;gap:14px;min-width:0;">
              <span style="font-family:'Inter',sans-serif;font-weight:800;font-size:12px;color:#475569;font-variant-numeric:tabular-nums;flex-shrink:0;width:42px;">${ev._d.getMonth()+1}/${ev._d.getDate()}</span>
              <span style="flex:1;font-size:13.5px;font-weight:700;color:#0F172A;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.label)}${ev.major ? ' <span style="background:#DC2626;color:#fff;font-size:9.5px;font-weight:900;padding:2px 7px;border-radius:8px;letter-spacing:0.06em;margin-left:6px;">重要</span>' : ''}</span>
              ${ev.who && ev.who !== c.name ? `<span style="font-size:11px;color:#64748B;flex-shrink:0;">対象: ${escapeHtml(ev.who)}</span>` : ''}
            </div>
          </div>
        `).join('');
        const monthLabel = `${y}年${parseInt(m, 10)}月`;
        const rel = monthRelLocal(parseInt(y, 10), parseInt(m, 10));
        return `
          <div style="margin-bottom:18px;">
            <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #E2E8F0;">
              <span style="font-family:'Noto Serif JP',serif;font-weight:800;font-size:15px;color:#0F172A;letter-spacing:-0.01em;">${monthLabel}</span>
              <span style="font-size:10.5px;color:#5B5BF0;background:#EEF2FF;padding:2px 8px;border-radius:10px;font-weight:700;">${rel}</span>
              <span style="margin-left:auto;font-size:11px;color:#94A3B8;font-weight:600;">${monthEvents.length} 件</span>
            </div>
            ${cardsHtml}
          </div>
        `;
      }).join('');
      const eventsFold = allEvents.length === 0 ? '' : `
        <div style="background:linear-gradient(180deg,#FAFBFC,#F1F5F9);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-top:8px;">
          <div style="font-size:11px;color:var(--muted);font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
            <span>📅 ライフイベント・タイムライン</span>
            <span style="font-family:'Inter',sans-serif;letter-spacing:0.04em;color:#5B5BF0;text-transform:none;font-size:11px;">${allEvents.length} 件 (最大60件)</span>
          </div>
          ${monthsHtml}
        </div>
      `;

      // ★ シンプル化: 「繋ぎKPI 達成率」(定型ステップ) + 「議事録抽出タスク」(NEXT ACTION と重複) 削除
      // → headerHtml (面談記録カウント) + eventsFold (全イベント折りたたみ) のみ表示
      return headerHtml + eventsFold;
    })();

    // Proposals
    const proposalsHtml2 = (c.proposals || []).length === 0
      ? '<div class="cd-empty">提案履歴なし</div>'
      : (c.proposals || []).slice().reverse().map(p => `
          <div class="cd-prop-row">
            <span class="cd-prop-date">${p.date}</span>
            <span class="cd-prop-title">${escapeHtml(p.title)}</span>
            <span class="cd-prop-result cd-prop-result-${p.result}">${p.result}</span>
          </div>
        `).join('');

    // Action recs (filtered top 4)
    const actionsHtml2 = recs.length === 0
      ? '<div class="cd-empty">直近の推奨アクションなし</div>'
      : recs.slice(0, 4).map(r => `
          <div class="cd-action-row">
            <div class="cd-action-bullet"></div>
            <div class="cd-action-body">
              <div class="cd-action-text">${escapeHtml(r.action)}</div>
              <div class="cd-action-reason">${escapeHtml(r.reason)}</div>
            </div>
            <span class="cd-action-pri">${priorityLabel(r.priority)}</span>
          </div>
        `).join('');

    document.getElementById('modal-content').innerHTML = `
      <div class="cd-modal">
        <button class="cd-close" id="modal-close-btn" aria-label="閉じる"><i data-lucide="x"></i></button>

        <!-- ============= LEFT: Profile column ============= -->
        <aside class="cd-left">
          <div class="cd-profile-head">
            <div class="cd-profile-avatar" style="${c.linePictureUrl ? 'background:none;padding:0;border:2px solid #06c755;overflow:hidden;' : ''}">${c.linePictureUrl
              ? `<img src="${escapeHtml(c.linePictureUrl)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`
              : escapeHtml(initial)}</div>
            <div class="cd-profile-name">${escapeHtml(c.name)} <span class="cd-profile-honor">様</span></div>
            <div class="cd-profile-kana">${escapeHtml(c.kana)}</div>
            <div class="cd-profile-pills">
              <span class="status-pill ${c.status}">${statusLabel(c.status)}</span>
              ${c.lineFriendId ? '<span class="cd-line-pill"><i data-lucide="message-circle"></i>LINE連携</span>' : ''}
              ${(function(){
                // ★ オーナーfb: ステータスpill 並びにタグも表示
                const master = getTagsMaster();
                const myTagIds = getClientTags(c.id);
                const myTags = myTagIds.map(id => master.find(t => t.id === id)).filter(Boolean);
                return myTags.map(t => { const col = validColor(t.color); return `<span style="display:inline-flex;align-items:center;background:${col};color:#fff;padding:4px 12px;border-radius:999px;font-size:11.5px;font-weight:800;letter-spacing:0.04em;line-height:1.4;">${escapeHtml(t.label)}</span>`; }).join('');
              })()}
            </div>
          </div>

          <!-- ★ オーナーfb 2026-06-20: 「今すぐ Zoom 開始」 + 「日時指定 Zoom 予約」 — 顧客名直下、 Zoom 公式アイコン -->
          ${c.lineFriendId ? `
            <div class="cd-zoom-pair" style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button id="cd-instant-zoom-btn" data-client-id="${escapeHtml(c.id)}" style="background:#fff;color:#0F172A;border:2px solid #2D8CFF;padding:12px 14px;border-radius:14px;font-size:14.5px;font-weight:900;cursor:pointer;font-family:'Noto Sans JP',sans-serif;letter-spacing:0.005em;box-shadow:0 6px 18px rgba(45,140,255,0.22);display:flex;align-items:center;justify-content:flex-start;gap:10px;min-height:66px;transition:transform .12s,box-shadow .12s;">
                <svg width="34" height="34" viewBox="0 0 100 100" style="flex-shrink:0;border-radius:10px;box-shadow:0 2px 6px rgba(45,140,255,0.30);">
                  <defs><linearGradient id="zg-inst-${escapeHtml(c.id)}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#4A9BFF"/><stop offset="100%" stop-color="#2D8CFF"/></linearGradient></defs>
                  <rect width="100" height="100" rx="22" fill="url(#zg-inst-${escapeHtml(c.id)})"/>
                  <text x="50" y="62" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="28" fill="#fff" letter-spacing="-1">zoom</text>
                </svg>
                <span style="text-align:left;line-height:1.3;">⚡ 今すぐ 開始<br><span style="font-size:10.5px;font-weight:700;color:#475569;">LINE 自動送付</span></span>
              </button>
              <button id="cd-schedule-zoom-btn" data-client-id="${escapeHtml(c.id)}" style="background:#fff;color:#0F172A;border:2px solid #2D8CFF;padding:12px 14px;border-radius:14px;font-size:14.5px;font-weight:900;cursor:pointer;font-family:'Noto Sans JP',sans-serif;letter-spacing:0.005em;box-shadow:0 6px 18px rgba(45,140,255,0.22);display:flex;align-items:center;justify-content:flex-start;gap:10px;min-height:66px;transition:transform .12s,box-shadow .12s;">
                <svg width="34" height="34" viewBox="0 0 100 100" style="flex-shrink:0;border-radius:10px;box-shadow:0 2px 6px rgba(45,140,255,0.30);">
                  <defs><linearGradient id="zg-sch-${escapeHtml(c.id)}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#4A9BFF"/><stop offset="100%" stop-color="#2D8CFF"/></linearGradient></defs>
                  <rect width="100" height="100" rx="22" fill="url(#zg-sch-${escapeHtml(c.id)})"/>
                  <text x="50" y="62" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="28" fill="#fff" letter-spacing="-1">zoom</text>
                </svg>
                <span style="text-align:left;line-height:1.3;">📅 日時指定 予約<br><span style="font-size:10.5px;font-weight:700;color:#475569;">数日後 / 指定時刻</span></span>
              </button>
            </div>
            <div id="cd-instant-zoom-status" style="font-size:12px;font-weight:700;margin-top:8px;text-align:center;"></div>
          ` : ''}

          <!-- ★ オーナーfb 2026-06-20: タグ管理 を 顧客名 直下、 オリジナル タグ アイコン (ピンク+紺) -->
          <div class="cd-profile-section" id="cd-tags-section" data-client-id="${escapeHtml(c.id)}" style="margin-top:16px;padding:16px 18px;background:#F8FAFC;border:2px solid #E2E8F0;border-radius:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <span style="font-size:18px;font-weight:900;color:#0F172A;letter-spacing:-0.01em;display:inline-flex;align-items:center;gap:10px;">
                <svg width="30" height="30" viewBox="0 0 32 32" fill="none" style="flex-shrink:0;">
                  <path d="M15 9 L24 9 C25.1 9 26 9.9 26 11 L26 19 C26 19.5 25.8 20 25.4 20.4 L18.4 27.4 C17.6 28.2 16.3 28.2 15.5 27.4 L8.5 20.4 C7.7 19.6 7.7 18.3 8.5 17.5 L15 11 Z" fill="#E58FAE"/>
                  <circle cx="20.5" cy="14.5" r="2" fill="#14213D"/>
                  <path d="M11 5 L20 5 C21.1 5 22 5.9 22 7 L22 15 C22 15.5 21.8 16 21.4 16.4 L14.4 23.4 C13.6 24.2 12.3 24.2 11.5 23.4 L4.5 16.4 C3.7 15.6 3.7 14.3 4.5 13.5 L11 7 Z" fill="#fff" stroke="#14213D" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
                  <circle cx="16.5" cy="10.5" r="1.6" fill="#14213D"/>
                </svg>
                タグ
              </span>
              <button id="cd-tags-edit" style="background:#5B5BF0;border:none;color:#fff;font-size:13.5px;font-weight:800;padding:9px 18px;border-radius:9px;cursor:pointer;font-family:inherit;letter-spacing:0.02em;box-shadow:0 4px 12px rgba(91,91,240,0.25);">＋ 追加 / 編集</button>
            </div>
            <div id="cd-tags-list" style="display:flex;flex-wrap:wrap;gap:7px;min-height:28px;"></div>
          </div>

          ${(function () {
            const _days = daysSince(c.lastContact);
            const _kpis = [];
            const _lc = (c.cancellations || []).slice().sort((a,b) => new Date(b.date) - new Date(a.date))[0];
            if (_lc && daysSince(_lc.date) <= 30) _kpis.push({ label: 'キャンセル後フォロー', tone: 'critical' });
            const _stalled = (c.proposals || []).slice().reverse().find(p => (p.result === '検討中' || p.result === '提案中') && daysSince(p.date) >= 30);
            if (_stalled) _kpis.push({ label: '提案クロージング', tone: 'warn' });
            const _evs = window.LifeEvents.generate(c) || [];
            const _ne = _evs.find(ev => { const d = (ev.date - TODAY) / 86400000; return ev.major && d >= 0 && d <= 60; });
            if (_ne && _days >= 21) _kpis.push({ label: 'イベント先取り', tone: 'warn' });
            if (c.status === 'dormant' || _days >= 180) _kpis.push({ label: '休眠の再エンゲージ', tone: 'critical' });
            if (_kpis.length === 0 && _days >= 30 && c.status !== 'dormant') _kpis.push({ label: '月1接触', tone: 'warn' });
            if (_kpis.length === 0) _kpis.push({ label: '緊急対応なし', tone: 'good' });
            return `
            <div class="cd-kpi-section">
              <div class="cd-kpi-label">この方に必要なフォロー</div>
              <div class="cd-kpi-badges">
                ${_kpis.map(k => `<span class="senior-kpi-badge senior-kpi-${k.tone}"><i data-lucide="target"></i>${escapeHtml(k.label)}</span>`).join('')}
              </div>
            </div>
            `;
          })()}

          <details class="cd-qa-collapse">
            <summary class="cd-qa-summary">
              <i data-lucide="zap"></i>
              <span>その他の連絡手段</span>
              <i data-lucide="chevron-down" class="cd-qa-chev"></i>
            </summary>
            <div class="cd-qa-inner">
              <button class="cd-qa-btn" id="cd-action-line"><i data-lucide="message-square-text"></i><span>LINE</span></button>
              <button class="cd-qa-btn" id="cd-action-call"><i data-lucide="phone"></i><span>電話</span></button>
              <button class="cd-qa-btn" id="cd-action-meet"><i data-lucide="video"></i><span>Zoom</span></button>
              <button class="cd-qa-btn" id="cd-action-mail"><i data-lucide="mail"></i><span>メール</span></button>
            </div>
          </details>

          <div style="margin:14px 0 8px;display:flex;gap:8px;flex-wrap:wrap;">
            <button data-open-hearing="${escapeHtml(c.id)}" style="background:#1B3A5C;color:#fff;border:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">📋 アンケート</button>
          </div>

          <div class="cd-profile-stats">
            <div class="cd-stat">
              <div class="cd-stat-label">管理資産</div>
              <div class="cd-stat-value">${aumDisp}</div>
            </div>
            <div class="cd-stat">
              <div class="cd-stat-label">最終接触</div>
              <div class="cd-stat-value">${days == null ? '—' : days}<span class="cd-stat-unit">${days == null ? '' : '日前'}</span></div>
              <div class="cd-stat-sub">${escapeHtml(c.lastContact || '未記録')}</div>
            </div>
            <div class="cd-stat">
              <div class="cd-stat-label">年齢 / 性別</div>
              <div class="cd-stat-value">${age != null && age >= 0 ? age : '—'}<span class="cd-stat-unit">${age != null && age >= 0 ? '歳' : ''}</span></div>
              <div class="cd-stat-sub">${c.gender === 'F' ? '女性' : '男性'} · ${c.birth || '生年月日 未記録'}</div>
            </div>
          </div>

          <div class="cd-profile-section">
            <div class="cd-section-label">プロフィール</div>
            <dl class="cd-dl">
              <dt>職業</dt><dd>${escapeHtml(c.occupation || '—')}</dd>
              <dt>流入経路</dt><dd>${escapeHtml(c.source || '—')}</dd>
              <dt>家族</dt><dd>${familyShort}</dd>
              ${c.mortgage ? `<dt>住宅ローン</dt><dd>残${c.mortgage.remainingYears}年 / 月¥${c.mortgage.monthly.toLocaleString()}</dd>` : ''}
            </dl>
          </div>

          <div class="cd-profile-section">
            <div class="cd-section-label">家族構成</div>
            <div class="cd-family-list">${familyHtml2}</div>
          </div>

          ${(c.cancellations && c.cancellations.length) ? `
          <div class="cd-profile-section">
            <div class="cd-section-label cd-section-label-warn">
              <i data-lucide="alert-triangle"></i>
              <span>キャンセル履歴 (${c.cancellations.length})</span>
            </div>
            <div class="cd-cancel-list">
              ${c.cancellations.slice().reverse().map(cc => {
                const d = new Date(cc.date);
                const daysFromCancel = Math.max(0, Math.floor((TODAY - d) / 86400000));
                return `<div class="cd-cancel-row">
                  <div class="cd-cancel-date">${cc.date}<span class="cd-cancel-rel">${daysFromCancel}日前</span></div>
                  <div class="cd-cancel-slot">${escapeHtml(cc.slot || '')}</div>
                  <div class="cd-cancel-reason"><i data-lucide="message-square"></i><span>${escapeHtml(cc.reason || '理由なし')}</span></div>
                </div>`;
              }).join('')}
            </div>
          </div>` : ''}

          ${c.note ? `
          <div class="cd-profile-section">
            <div class="cd-section-label">メモ</div>
            <div class="cd-note">${escapeHtml(c.note)}</div>
          </div>` : ''}
        </aside>

        <!-- ============= RIGHT: Activity column ============= -->
        <main class="cd-right">

          <!-- AI Next Best Action — オーナーfb 2026-06-20: 2列バランス + Zoom/タグ クイック内包 -->
          ${topRec ? `
          <div class="cd-flow">
            <div class="cd-flow-eyebrow">
              <span class="cd-flow-eyebrow-pill"><i data-lucide="sparkles"></i>AI 推奨</span>
              <span class="cd-flow-eyebrow-pri">${priorityLabel(topRec.priority)}</span>
            </div>
            <div class="cd-flow-title">${escapeHtml(topRec.action)}</div>
            <div class="cd-flow-reason">${escapeHtml(topRec.reason)}</div>

            <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:14px;">
              <!-- 左: AI下書き 大ボタン (primary) -->
              <button class="cd-flow-step cd-flow-step-active fp-draft-cta" id="modal-draft-btn" style="margin:0;">
                <span class="cd-flow-step-no">1</span>
                <span class="cd-flow-step-body">
                  <span class="cd-flow-step-label">✨ AI で 下書き</span>
                  <span class="cd-flow-step-sub">AI が LINE 文面 自動 生成</span>
                </span>
                <i data-lucide="wand-2" class="cd-flow-step-icon"></i>
              </button>
              <!-- ★ 2026-06-22 roundN: 3列×2行 横長レイアウト + 文言短縮 -->
              <div class="fp-qa-grid">
                ${c.lineFriendId ? `
                  <button class="fp-qa-pop" data-accent="zoom" data-quick-instant="${escapeHtml(c.id)}">
                    <span class="fp-qa-tip">＼ 1クリック開始 ／</span>
                    <span class="fp-qa-capsule">
                      <span class="fp-qa-dot"></span>
                      <span class="fp-qa-label">
                        <span class="fp-qa-label-main">⚡ 今すぐ Zoom</span>
                        <span class="fp-qa-label-sub">URL 自動送付</span>
                      </span>
                      <span class="fp-qa-arrow">→</span>
                    </span>
                  </button>
                  <button class="fp-qa-pop" data-accent="schedule" data-quick-schedule="${escapeHtml(c.id)}">
                    <span class="fp-qa-tip">＼ 候補日 確定 ／</span>
                    <span class="fp-qa-capsule">
                      <span class="fp-qa-dot"></span>
                      <span class="fp-qa-label">
                        <span class="fp-qa-label-main">📅 日時指定</span>
                        <span class="fp-qa-label-sub">日付を 決めて 予約</span>
                      </span>
                      <span class="fp-qa-arrow">→</span>
                    </span>
                  </button>
                  <button class="fp-qa-pop" data-accent="slots" data-quick-slots="${escapeHtml(c.id)}">
                    <span class="fp-qa-tip">＼ LINE 送信 ／</span>
                    <span class="fp-qa-capsule">
                      <span class="fp-qa-dot"></span>
                      <span class="fp-qa-label">
                        <span class="fp-qa-label-main">🗓 候補日 3つ</span>
                        <span class="fp-qa-label-sub">お客様 タップ</span>
                      </span>
                      <span class="fp-qa-arrow">→</span>
                    </span>
                  </button>
                ` : ''}
                <button class="fp-qa-pop" data-accent="tag" data-quick-tag="${escapeHtml(c.id)}">
                  <span class="fp-qa-tip">＼ セグメント ／</span>
                  <span class="fp-qa-capsule">
                    <span class="fp-qa-dot"></span>
                    <span class="fp-qa-label">
                      <span class="fp-qa-label-main">🏷 タグ</span>
                      <span class="fp-qa-label-sub">分類 / 絞込</span>
                    </span>
                    <span class="fp-qa-arrow">→</span>
                  </span>
                </button>
                <button class="modal-brief-btn fp-qa-pop" data-accent="brief" data-line-brief="${c.id}">
                  <span class="fp-qa-tip">＼ 自由文 ／</span>
                  <span class="fp-qa-capsule">
                    <span class="fp-qa-dot"></span>
                    <span class="fp-qa-label">
                      <span class="fp-qa-label-main">✍ 自分で書く</span>
                      <span class="fp-qa-label-sub">手入力 LINE</span>
                    </span>
                    <span class="fp-qa-arrow">→</span>
                  </span>
                </button>
                <button class="cd-flow-edit fp-qa-pop" data-accent="info" id="modal-edit-btn">
                  <span class="fp-qa-tip">＼ 編集 ／</span>
                  <span class="fp-qa-capsule">
                    <span class="fp-qa-dot"></span>
                    <span class="fp-qa-label">
                      <span class="fp-qa-label-main">✏ 顧客情報</span>
                      <span class="fp-qa-label-sub">名前/家族 編集</span>
                    </span>
                    <span class="fp-qa-arrow">→</span>
                  </span>
                </button>
              </div>
              <style>
                @keyframes fp-draft-cta-pulse{0%,100%{transform:translateY(0) scale(1);box-shadow:0 8px 24px rgba(249,115,22,0.55),0 0 0 4px rgba(255,255,255,0.5)}50%{transform:translateY(-2.5px) scale(1.025);box-shadow:0 16px 36px rgba(249,115,22,0.72),0 0 0 7px rgba(255,255,255,0.6)}}
                @keyframes fp-draft-cta-gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
                /* ★ 2026-06-22 roundK: gold CTA 統一 (元: bg白+青/緑border、 新: white+gold-border capsule) */
                .fp-quick-act {
                  background: #fff !important;
                  border: 1.5px solid #C19A3A !important;
                  color: #1F2A3F !important;
                  padding: 11px 14px !important;
                  border-radius: 12px !important;
                  font-size: 12.5px !important;
                  font-weight: 700 !important;
                  cursor: pointer;
                  font-family: 'Hiragino Sans','Noto Sans JP',sans-serif !important;
                  display: flex !important;
                  align-items: center !important;
                  gap: 10px !important;
                  min-height: 56px !important;
                  text-align: left !important;
                  transition: background .12s, border-color .12s, transform .12s, box-shadow .15s;
                  box-shadow: 0 2px 6px rgba(193,154,58,0.12);
                  letter-spacing: 0.02em;
                }
                .fp-quick-act:hover {
                  background: #FBF5E3 !important;
                  border-color: #9A5A18 !important;
                  transform: translateY(-1px);
                  box-shadow: 0 6px 14px rgba(193,154,58,0.22);
                }
                .fp-quick-act:active { transform: translateY(0); }
                .fp-qa-icon {
                  flex-shrink: 0; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;
                  background: #FBF5E3; color: #9A5A18; border-radius: 10px;
                  font-size: 16px;
                }
                .fp-qa-label {
                  display: flex; flex-direction: column; gap: 2px; line-height: 1.3; flex: 1;
                }
                .fp-qa-sub {
                  font-size: 10.5px; color: #6B7280; font-weight: 600; letter-spacing: 0.02em;
                }
              </style>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;justify-content:flex-end;">
              <button id="modal-delete-btn" style="background:transparent;color:#94A3B8;border:none;padding:6px 8px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:underline;">この顧客を削除</button>
            </div>
          </div>` : `
          <div class="cd-flow cd-flow-empty">
            <div class="cd-flow-eyebrow"><span class="cd-flow-eyebrow-pill">AI推奨</span></div>
            <div class="cd-flow-title">直近の推奨アクションなし</div>
            <div class="cd-flow-reason">この方のライフイベントや接触状況からは、特に緊急のアクションはありません。</div>
            <div class="cd-flow-steps">
              <button class="cd-flow-step cd-flow-step-active fp-draft-cta" id="modal-draft-btn">
                <span class="cd-flow-step-no" style="color:#fff;background:rgba(255,255,255,0.25);"><i data-lucide="wand-2"></i></span>
                <span class="cd-flow-step-body">
                  <span class="cd-flow-step-label" style="color:#fff !important;font-weight:900;letter-spacing:0.04em;">👉 ✨ AI返信下書きを作る</span>
                  <span class="cd-flow-step-sub" style="color:rgba(255,255,255,0.95) !important;font-weight:600;">挨拶や定期連絡を起案 — 押すと自動で生成</span>
                </span>
              </button>
              <style>@keyframes fp-draft-cta-pulse{0%,100%{transform:translateY(0) scale(1);box-shadow:0 8px 24px rgba(249,115,22,0.55),0 0 0 4px rgba(255,255,255,0.5)}50%{transform:translateY(-2.5px) scale(1.025);box-shadow:0 16px 36px rgba(249,115,22,0.72),0 0 0 7px rgba(255,255,255,0.6)}}@keyframes fp-draft-cta-gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}</style>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="modal-brief-btn" data-line-brief="${c.id}" style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none;padding:9px 16px;border-radius:7px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;letter-spacing:0.04em;box-shadow:0 4px 12px rgba(16,185,129,0.32);">✍ 伝えたいことから 下書き</button>
              <button id="modal-deliv-btn" style="background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;border:none;padding:9px 16px;border-radius:7px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;letter-spacing:0.04em;box-shadow:0 4px 12px rgba(91,91,240,0.32);">📎 資料パッケージを ダウンロード</button>
              <button class="cd-flow-edit ghost-btn" id="modal-edit-btn"><i data-lucide="pencil"></i><span>顧客情報を編集</span></button>
              <button id="modal-delete-btn" style="background:#fff;color:#dc2626;border:1px solid #fecaca;padding:8px 14px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;"><i data-lucide="trash-2" style="width:14px;height:14px;"></i><span>この顧客を削除</span></button>
            </div>
          </div>`}

          <!-- Tabs -->
          <div class="cd-tabs" role="tablist" style="font-size:15px !important;">
            <button class="cd-tab cd-tab-active" data-cdtab="overview" style="font-size:15px !important;font-weight:700 !important;">概観</button>
            <button class="cd-tab" data-cdtab="line" style="font-size:15px !important;font-weight:700 !important;">LINE <span class="cd-tab-count">${(c.lineHistory || []).length}</span>${(function(){
              const lr = parseInt(localStorage.getItem('fp-line-read-' + c.id) || '0', 10);
              const uc = (c.lineHistory || []).filter(m => {
                const isU = (m.from === 'user' || m.direction === 'in');
                const ts = new Date(m.ts || m.date || 0).getTime();
                return isU && ts > lr;
              }).length;
              return uc > 0 ? `<span style="display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#DC2626,#B91C1C);color:#fff;font-size:10px;font-weight:900;min-width:18px;height:18px;padding:0 5px;border-radius:9px;margin-left:5px;box-shadow:0 2px 6px rgba(220,38,38,0.45);animation:fp-unread-pulse 1.6s ease-in-out infinite;letter-spacing:0;">${uc > 99 ? '99+' : uc}</span>` : '';
            })()}</button>
            <button class="cd-tab" data-cdtab="timeline" style="font-size:15px !important;font-weight:700 !important;">履歴 <span class="cd-tab-count">${events.length}</span></button>
            <button class="cd-tab" data-cdtab="meetings" style="font-size:15px !important;font-weight:700 !important;">議事録 <span class="cd-tab-count" id="cd-meetings-count">…</span></button>
            <button class="cd-tab" data-cdtab="qa" style="font-size:15px !important;font-weight:700 !important;">Q&A <span class="cd-tab-count" id="cd-qa-count">—</span></button>
            <button class="cd-tab" data-cdtab="family" style="font-size:15px !important;font-weight:700 !important;">家族 <span class="cd-tab-count">${(c.family || []).length + 1}</span></button>
          </div>

          <div class="cd-tabpanels">
            <!-- OVERVIEW (オーナーfb 2026-06-20: WORKFLOW/次にやること/直近のイベント/イベント分類 を全削除し、 最終議事録サマリー 1枚 のみ) -->
            <div class="cd-tabpanel" data-cdpanel="overview">
              ${(function(){
                if (latestAi && latestAi.summary && String(latestAi.summary).trim()) {
                  const date = latestAi.ts ? new Date(latestAi.ts).toLocaleDateString('ja-JP') : '';
                  return `
                  <div class="cd-card" style="border:1px solid #E2E8F0;border-radius:12px;padding:18px 20px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                      <span style="font-size:14px;font-weight:900;color:#0F172A;">📝 最終 Zoom 議事録</span>
                      ${date ? `<span style="font-size:11.5px;color:#64748B;font-weight:600;">${escapeHtml(date)}</span>` : ''}
                    </div>
                    <div style="font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHtml(String(latestAi.summary).slice(0, 600))}</div>
                  </div>`;
                }
                return `
                <div style="padding:32px 24px;text-align:center;color:#64748B;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:12px;">
                  <div style="font-size:32px;margin-bottom:8px;">📋</div>
                  <div style="font-size:14px;font-weight:700;color:#0F172A;margin-bottom:6px;">まだ 議事録 が ありません</div>
                  <div style="font-size:12.5px;line-height:1.6;">上の <strong>LINE</strong> / <strong>履歴</strong> / <strong>議事録</strong> / <strong>家族</strong> タブ から詳細をご覧ください</div>
                </div>`;
              })()}
            </div>

            <!-- LINE HISTORY (統合タイムライン v 20260610J) -->
            ${(function(){
              // ★ 統合タイムライン entries を 事前計算 (stats行 / chat内 両方で使う)
              const _tlEntries = buildUnifiedLineTimeline(c);
              const _cnt = (t) => _tlEntries.filter(e => e.type === t).length;
              const _stats = {
                line: _tlEntries.filter(e => e.type === 'line').length,
                survey: _cnt('survey'),
                booking: _cnt('booking_request') + _cnt('booking_confirmed'),
                minutes: _cnt('ai_minutes'),
                cancel: _cnt('cancellation'),
              };
              // 後段で 同じ entries を chat に使うため グローバルに 一時保存
              window._fpCurrentTlEntries = _tlEntries;
              return ''; // この IIFE はサイドエフェクトのみ
            })()}
            <div class="cd-tabpanel" data-cdpanel="line" hidden>
              <div class="cd-line-head">
                <div class="cd-line-stats">
                  <span class="cd-line-stat"><i data-lucide="message-square"></i><strong id="cd-line-total">${(c.lineHistory || []).length}</strong>件</span>
                  <span class="cd-line-stat"><i data-lucide="arrow-down-left"></i>受信 <strong id="cd-line-in">${(c.lineHistory || []).filter(m => m.direction === 'in').length}</strong></span>
                  <span class="cd-line-stat"><i data-lucide="arrow-up-right"></i>送信 <strong id="cd-line-out">${(c.lineHistory || []).filter(m => m.direction === 'out').length}</strong></span>
                  ${(function(){
                    const _e = window._fpCurrentTlEntries || [];
                    const _cnt = (t) => _e.filter(x => x.type === t).length;
                    const surveyN = _cnt('survey');
                    const bookingN = _cnt('booking_request') + _cnt('booking_confirmed');
                    const minutesN = _cnt('ai_minutes');
                    const cancelN = _cnt('cancellation');
                    const pill = (icon, n, color) => n > 0 ? `<span class="cd-line-stat" style="color:${color};"><span style="font-size:13px;">${icon}</span> <strong>${n}</strong></span>` : '';
                    return pill('📅', bookingN, '#A855F7') + pill('📝', surveyN, '#B45309') + pill('🎙', minutesN, '#C2410C') + pill('❌', cancelN, '#DC2626');
                  })()}
                </div>
                <button class="cd-line-new" data-line-ai="${c.id}"><i data-lucide="wand-2"></i><span>AI下書き (Jobs提案)</span></button>
                <button class="cd-line-new" data-line-brief="${c.id}" style="background:#10B981;color:#fff;margin-left:6px;"><i data-lucide="edit-3"></i><span>✍ 伝えたいことから下書き</span></button>
                <button class="cd-line-new" data-line-slots="${c.id}" style="background:#5B5BF0;color:#fff;margin-left:6px;"><i data-lucide="calendar-plus"></i><span>📅 候補日 3つ 送る</span></button>
              </div>
              ${(function(){
                // ★ オーナーfb「客返信に対する AI 生成 ボタンが分かりづらい」: LINE履歴タブ内に大きな AI返信案ボタン
                const lastMsg = (c.lineHistory || []).slice().reverse()[0];
                const lastIsUser = lastMsg && (lastMsg.direction === 'in' || lastMsg.from === 'user');
                if (!lastIsUser) return '';
                return `
                  <div style="background:linear-gradient(135deg,#DC2626,#991B1B);color:#fff;padding:14px 18px;border-radius:12px;margin:10px 0 14px;box-shadow:0 8px 28px rgba(220,38,38,0.45),0 0 0 4px rgba(255,255,255,0.5);">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                      <div style="font-size:24px;">⚠️</div>
                      <div style="flex:1;">
                        <div style="font-size:11px;font-weight:800;letter-spacing:0.16em;opacity:0.9;text-transform:uppercase;">最新が客返信 / FP 未返信</div>
                        <div style="font-size:14px;font-weight:900;margin-top:2px;">この方への返事がまだです — Jobs と一緒に作りましょう</div>
                      </div>
                    </div>
                    <button class="fp-line-tab-reply" data-cid="${escapeHtml(c.id)}" style="width:100%;background:#fff;color:#991B1B;border:none;padding:13px 18px;border-radius:8px;font-weight:900;cursor:pointer;font-size:14px;font-family:inherit;letter-spacing:0.04em;box-shadow:0 4px 14px rgba(0,0,0,0.18);">✨ Jobs と返信案を作る → 編集 → 送信</button>
                  </div>
                `;
              })()}
              <div class="cd-line-chat" id="cd-line-chat">
                ${(function(){
                  const entries = window._fpCurrentTlEntries || buildUnifiedLineTimeline(c);
                  if (entries.length === 0) return '<div class="cd-line-empty">まだ やりとり がありません</div>';
                  return entries.map(renderTimelineEntry).join('');
                })()}
              </div>
              <div class="cd-line-composer">
                ${!c.lineFriendId ? `
                  <!-- ★ 未紐付け 時 は CTA 入力欄を 上 に置く (紐付けないと LINE 送れない) -->
                  <div style="background:#FBF5E3;border:1.5px solid #C19A3A;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                    <div style="font-size:11px;font-weight:800;color:#9A5A18;letter-spacing:0.12em;margin-bottom:6px;">🔗 LINE 友だち ID を 後から 紐付け</div>
                    <p style="font-size:11.5px;color:#5e4d1a;line-height:1.65;margin:0 0 10px;">先に Zoom などで お会いした お客様。 後で 公式LINE を 友だち追加してもらったら、 ここで <strong>LINE userId</strong> を 入れて 紐付けてください。 LINE 履歴も 紐付きます。 取得方法 は LINE連携済 顧客 を 開くと 「📋 ID をコピー」 ボタン が 出ます。</p>
                    <div style="display:flex;gap:8px;align-items:stretch;">
                      <input type="text" id="cd-lineid-attach-input" placeholder="U+32文字 の LINE userId" style="flex:1;padding:8px 12px;font-size:12px;font-family:'JetBrains Mono',monospace;border:1.5px solid #E8D9A8;border-radius:7px;background:#fff;">
                      <button id="cd-lineid-attach-btn" data-cid="${escapeHtml(c.id)}" class="btn-cta-primary" style="padding:8px 18px;font-size:12.5px;border-radius:7px;justify-content:center;"><span>紐付ける</span></button>
                    </div>
                    <div id="cd-lineid-attach-msg" style="font-size:11px;color:#9A5A18;margin-top:8px;min-height:14px;"></div>
                  </div>
                ` : ''}
                <textarea id="cd-line-input" placeholder="メッセージを入力... (Cmd+Enter で送信)"></textarea>
                <div class="cd-line-composer-foot">
                  <span class="cd-line-composer-meta">${c.lineFriendId ? '✓ LINE連携済' : '⚠ LINE friend ID 未登録 (上の枠で 紐付け)'}</span>
                  <button class="cd-line-ai-quick btn-mini-action" id="cd-line-ai-quick" data-cid="${escapeHtml(c.id)}" title="AI が直近の履歴から返信案を生成 → textarea に挿入 → 編集して送信" style="margin-right:8px;"><span class="icon">✨</span>AI で返信案</button>
                  <button class="cd-line-send-btn" id="cd-line-send"${c.lineFriendId ? '' : ' disabled'}>
                    <i data-lucide="send"></i><span>送信</span>
                  </button>
                </div>
                <div id="cd-line-msg" class="cd-line-msg-status"></div>
                ${c.lineFriendId ? `
                  <!-- ★ オーナーfb 2026-06-25: LINE連携済の userId 表示+マージ ボタンは 送信box の下 に移動 (重要度低) -->
                  <details style="margin-top:14px;padding:8px 12px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:7px;">
                    <summary style="font-size:11px;font-weight:700;color:#065F46;cursor:pointer;letter-spacing:0.06em;list-style:none;">🔗 LINE userId / 既存客マージ</summary>
                    <div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      <code id="cd-lineid-show" style="font-size:10.5px;font-family:'JetBrains Mono',monospace;color:#0F172A;background:#fff;padding:3px 7px;border-radius:4px;border:1px solid #BBF7D0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${escapeHtml(c.lineFriendId)}</code>
                      <button id="cd-lineid-copy" data-uid="${escapeHtml(c.lineFriendId)}" style="background:#06C755;color:#fff;border:none;padding:5px 10px;border-radius:5px;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0;">📋 コピー</button>
                      <button id="cd-merge-existing" data-cid="${escapeHtml(c.id)}" data-uid="${escapeHtml(c.lineFriendId)}" style="background:#fff;color:#065F46;border:1px solid #06C755;padding:5px 10px;border-radius:5px;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0;">→ 既存客に マージ</button>
                    </div>
                  </details>
                ` : ''}
              </div>
            </div>

            <!-- TIMELINE -->
            <!-- ★ 2026-06-29 速度改善: lazy render — overview/line のみ初期render、他はタブ click時に build -->
            <div class="cd-tabpanel" data-cdpanel="timeline" hidden data-lazy-render="timeline">
              <div class="cd-empty" style="padding:24px;color:#94A3B8;font-size:12px;">読込中…</div>
            </div>

            <!-- MEETINGS -->
            <div class="cd-tabpanel" data-cdpanel="meetings" hidden data-lazy-render="meetings">
              <div class="cd-empty" style="padding:24px;color:#94A3B8;font-size:12px;">読込中…</div>
            </div>

            <!-- Q&A (Phase 2: LINE質問 自動分類) -->
            <div class="cd-tabpanel" data-cdpanel="qa" hidden>
              <div id="cd-qa-content" data-client-id="${escapeHtml(c.id)}">
                <div style="padding:32px 24px;text-align:center;color:#94A3B8;font-size:13px;">
                  Q&A 分析 — 「Q&A」タブを開くと自動分析
                </div>
              </div>
            </div>

            <!-- FAMILY 家系図 -->
            <div class="cd-tabpanel" data-cdpanel="family" hidden data-lazy-render="family">
              <div class="cd-empty" style="padding:24px;color:#94A3B8;font-size:12px;">読込中…</div>
            </div>
          </div>

          ${renderReferralBlock(c)}
        </main>
      </div>
    `;
    document.getElementById('modal-overlay').style.display = 'flex';
    // ★ オーナーfb 2026-06-25: cd-line-chat が 出現 / 再描画 されたら 必ず 最新へ scroll
    // (タブclick だけだと URL ?tab=line 復元 / hydrate 再render の時 漏れる)
    const _scrollLineChatBottom = () => {
      const el = document.getElementById('cd-line-chat');
      if (el && el.offsetParent !== null) el.scrollTop = el.scrollHeight;
    };
    setTimeout(_scrollLineChatBottom, 50);
    setTimeout(_scrollLineChatBottom, 250);
    setTimeout(_scrollLineChatBottom, 800);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    // ★ 顧客削除ボタン
    const delBtn = document.getElementById('modal-delete-btn');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('⚠ ' + c.name + ' さんを削除します。\n\nこの顧客に関連するすべてのデータ:\n・LINE 履歴 / 客返信\n・Zoom 予約\n・AI 議事録 / タスク\n・成果物 編集中\n・アンケート回答\n\nを削除します。元に戻せません。\n\n本当に削除しますか?')) return;
      delBtn.disabled = true; delBtn.innerHTML = '削除中…';
      // ★ 削除統一 (2026-06-25): Cloud Function callable + GAS + localStorage の3点同時実行
      //   どれか欠けると Firestore / GAS / ブラウザ で 状態がズレ「消したのに残る」事故。
      //   3経路全部 await し、 1個でも失敗したらロールバック方法を showCenterToast で出す。
      const cid = c.id;
      const lfid = c.lineFriendId;
      const cname = c.name;
      const results = { callable: null, gas: null, local: null };
      try {
        // ① Cloud Function callable (deleteCustomer) — Firestore tenant 側の正本削除
        let callablePromise = Promise.resolve({ skipped: 'no-fp' });
        if (window.__fp && window.__fp.functions) {
          callablePromise = (async () => {
            const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
            const fn = httpsCallable(window.__fp.functions, 'deleteCustomer');
            return await fn({ customerId: cid, clientId: cid, lineFriendId: lfid || null, name: cname });
          })();
        }
        // ② GAS proxy (Cloud Run /api/delete-customer) — legacy 側の関連シート削除
        let gasPromise = Promise.resolve({ skipped: 'no-lineFriendId' });
        if (lfid) {
          gasPromise = (async () => {
            const h = window.getFpAuthHeaders ? await window.getFpAuthHeaders() : { 'Content-Type': 'application/json' };
            return fetch('https://fp-compass-webhook-527726449426.asia-northeast1.run.app/api/delete-customer?userId=' + encodeURIComponent(lfid), { method: 'POST', headers: h })
              .then(r => r.ok ? r.json().catch(() => ({ ok: true })) : Promise.reject(new Error('HTTP ' + r.status)));
          })();
        }
        // ③ localStorage cleanup — bookingTs lookup で fp-ai-backup-* も全消し
        const localPromise = (async () => {
          // c.bookings から bookingTs を集めて fp-ai-backup-{bookingTs} を全消し対象に
          const bookingTsList = [];
          try {
            const bks = Array.isArray(c.bookings) ? c.bookings : [];
            bks.forEach(b => {
              if (b && b.ts) bookingTsList.push(String(b.ts));
              if (b && b.bookingTs) bookingTsList.push(String(b.bookingTs));
            });
          } catch (_) {}
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (k === 'fp-line-history-' + cid ||
                (lfid && k === 'fp-line-history-' + lfid) ||
                k === 'fp-line-read-' + cid ||
                k.startsWith('fp-deliv-edit-' + cid + '-') ||
                (lfid && k.startsWith('fp-deliv-edit-' + lfid + '-')) ||
                k === 'fp-ai-' + cid ||
                (lfid && k === 'fp-ai-' + lfid) ||
                k === 'fp-ai-' + cname ||
                k === 'fp-tasks-' + cid ||
                (lfid && k === 'fp-tasks-' + lfid) ||
                k === 'fp-tasks-' + cname) {
              keysToRemove.push(k);
              continue;
            }
            // fp-ai-backup-{bookingTs} — bookingTs lookup で全消し
            if (k.startsWith('fp-ai-backup-') && bookingTsList.some(ts => k === 'fp-ai-backup-' + ts || k.startsWith('fp-ai-backup-' + ts + '-'))) {
              keysToRemove.push(k);
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
          // tracking 内 該当客削除
          try {
            const tr = JSON.parse(localStorage.getItem('fp-draft-tracking') || '{}');
            delete tr[cid];
            localStorage.setItem('fp-draft-tracking', JSON.stringify(tr));
          } catch (_) {}
          return { removedKeys: keysToRemove.length };
        })();

        // 3経路 並行 + allSettled で 失敗特定可能に
        const [r1, r2, r3] = await Promise.allSettled([callablePromise, gasPromise, localPromise]);
        results.callable = r1; results.gas = r2; results.local = r3;
        const failed = [];
        if (r1.status === 'rejected') failed.push('Firestore (callable): ' + (r1.reason && r1.reason.message || r1.reason));
        if (r2.status === 'rejected') failed.push('GAS (/api/delete-customer): ' + (r2.reason && r2.reason.message || r2.reason));
        if (r3.status === 'rejected') failed.push('localStorage: ' + (r3.reason && r3.reason.message || r3.reason));

        // clients から除外 + 永続化 (3経路が完全成功でなくても UI からは消す。残ったデータは reimport で復活)
        const idx = clients.findIndex(x => x.id === cid);
        if (idx >= 0) clients.splice(idx, 1);
        try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS || clients)); } catch (_) {}
        closeModal();
        if (window.FPCrmRefreshClients) window.FPCrmRefreshClients({ immediate: true });

        if (failed.length === 0) {
          const removedN = (r3.value && r3.value.removedKeys) || 0;
          alert('✓ ' + cname + ' さん を削除しました。\n(Firestore + GAS + localStorage ' + removedN + '件)');
        } else {
          // 部分失敗 → ロールバック手順 を toast で出す (showCenterToast は line-app.js に存在)
          const msg = '一部経路で削除失敗:\n' + failed.join('\n') + '\n\nロールバック方法:\n1) 「設定 → 実モード」で 実客 再登録\n2) 失敗経路を CEO室_Jobs/引き継ぎ/事業別/FP-Compass.md に記録して Jobs へ報告';
          if (typeof window.showCenterToast === 'function') {
            window.showCenterToast('削除 部分失敗', msg, { tone: 'success', duration: 0 });
          } else {
            alert('⚠ ' + cname + ' さん の削除は 部分失敗\n\n' + msg);
          }
        }
      } catch (e) {
        alert('削除失敗: ' + e.message);
        delBtn.disabled = false;
        delBtn.innerHTML = '<i data-lucide="trash-2" style="width:14px;height:14px;"></i><span>この顧客を削除</span>';
      }
    });
    document.getElementById('modal-edit-btn').addEventListener('click', () => {
      closeModal();
      openClientForm(c.id);
    });
    // ★ オーナーfb (v AP): 「📎 資料を作成」 ボタンを常に表示 (NEXT ACTIONなくても押せる)
    const delivBtnHeader = document.getElementById('modal-deliv-btn');
    if (delivBtnHeader) delivBtnHeader.addEventListener('click', () => openQuickDeliverablePicker(c));
    // ★ タグ機能: render + 編集ボタン
    renderClientTags(c.id);
    const tagsEditBtn = document.getElementById('cd-tags-edit');
    if (tagsEditBtn) tagsEditBtn.addEventListener('click', () => openTagEditor(c.id));
    const draftBtn = document.getElementById('modal-draft-btn');
    if (draftBtn) draftBtn.addEventListener('click', () => {
      openDraftReplyModal(c, events, recs);
    });
    // ★ 追撃ライン作成 / 次の提案作成 ボタン (返信トラッキング)
    const followupBtn = document.getElementById('fp-track-followup');
    if (followupBtn) followupBtn.addEventListener('click', () => {
      window._fpDraftLoopMode = true; // 追撃モード = 既送信履歴を踏まえる
      try {
        const tracking = JSON.parse(localStorage.getItem('fp-draft-tracking') || '{}');
        if (tracking[c.id]) {
          tracking[c.id].followupCount = (tracking[c.id].followupCount || 0) + 1;
          localStorage.setItem('fp-draft-tracking', JSON.stringify(tracking));
        }
      } catch (_) {}
      openDraftReplyModal(c, events, recs);
    });
    const nextBtn = document.getElementById('fp-track-next');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      window._fpDraftLoopMode = true;
      openDraftReplyModal(c, events, recs);
    });
    // LINE 履歴タブ内の AI 返信案ボタン
    document.querySelectorAll('.fp-line-tab-reply').forEach(btn => {
      btn.addEventListener('click', () => {
        window._fpDraftLoopMode = true;
        openDraftReplyModal(c, events, recs);
      });
    });
    // ⑤ 「📎 資料を作成」ボタン → AIで成果物draft (キャッシュフロー表/シミュ等)
    document.querySelectorAll('[data-make-deliverable]').forEach(btn => {
      btn.addEventListener('click', () => {
        const taskTitle = btn.dataset.makeDeliverable;
        openDeliverableDraftModal(c, taskTitle);
      });
    });
    // 📋 ヒアリングシートボタン
    document.querySelectorAll('[data-open-hearing]').forEach(btn => {
      btn.addEventListener('click', () => openHearingSheetModal(c));
    });
    // ★ ライフイベント空状態 CTA ウィザード
    if (document.getElementById('life-cta-form')) {
      const childrenWrap = document.getElementById('life-cta-children');
      // 既存 family[child] あれば 初期表示
      let childInputs = (c.family || []).filter(m => m.rel === 'child').map(m => ({ name: m.name || '', birth: m.birth || '' }));
      if (childInputs.length === 0) childInputs = [{ name: '', birth: '' }]; // 初期1行
      function renderChildren() {
        childrenWrap.innerHTML = childInputs.map((ch, i) => `
          <div style="display:grid;grid-template-columns:1fr 1fr 36px;gap:6px;align-items:center;">
            <input type="text" placeholder="お子様 お名前 (任意)" value="${escapeHtml(ch.name || '')}" data-child-idx="${i}" data-child-field="name" style="padding:8px 10px;border:1.5px solid #e3e7ee;border-radius:6px;font-size:13px;font-family:inherit;">
            <input type="date" value="${escapeHtml(ch.birth || '')}" data-child-idx="${i}" data-child-field="birth" style="padding:8px 10px;border:1.5px solid #e3e7ee;border-radius:6px;font-size:13px;font-family:inherit;">
            <button type="button" data-child-rm="${i}" title="削除" style="background:#fff;border:1.5px solid #fecaca;color:#dc2626;border-radius:6px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;">×</button>
          </div>
        `).join('');
        childrenWrap.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
          const i = parseInt(inp.dataset.childIdx, 10);
          const f = inp.dataset.childField;
          childInputs[i][f] = inp.value;
        }));
        childrenWrap.querySelectorAll('[data-child-rm]').forEach(btn => btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.childRm, 10);
          childInputs.splice(i, 1);
          renderChildren();
        }));
      }
      renderChildren();
      document.getElementById('life-cta-add-child').addEventListener('click', () => {
        childInputs.push({ name: '', birth: '' });
        renderChildren();
      });
      document.getElementById('life-cta-cancel').addEventListener('click', () => {
        const f = document.getElementById('life-cta-form');
        if (f) f.parentElement.style.display = 'none';
      });
      document.getElementById('life-cta-save').addEventListener('click', () => {
        const birthVal = document.getElementById('life-cta-birth').value;
        const spouseBirth = document.getElementById('life-cta-spouse-birth').value;
        if (!birthVal) { alert('本人 生年月日 は必須です'); return; }
        // 既存 family を保持しつつ 更新
        const existing = Array.isArray(c.family) ? c.family.slice() : [];
        // 配偶者 update or push
        if (spouseBirth) {
          const sp = existing.find(m => m.rel === 'spouse');
          if (sp) sp.birth = spouseBirth;
          else existing.push({ rel: 'spouse', name: '', birth: spouseBirth });
        }
        // 既存の child 全削除 → 入力分で置換 (空欄はスキップ)
        const others = existing.filter(m => m.rel !== 'child');
        const newChildren = childInputs.filter(ch => ch.birth).map(ch => ({ rel: 'child', name: ch.name || '', birth: ch.birth }));
        c.birth = birthVal;
        c.family = others.concat(newChildren);
        try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(clients)); } catch (_) {}
        // モーダル再描画 (ライフイベント自動展開を見せる)
        openClientModal(c.id);
      });
    }

    // ★ 議事録タブ count = 実際の カード数 (メイン + orphan) に同期
    //   lazy-render 導入で panel が modal open 時 空 → count 0 バグ対策として、
    //   panel が既に render 済 なら DOM カウント、 未render なら data から 推定 (ai_results + bookings 名寄せ)
    try {
      const cntEl = document.getElementById('cd-meetings-count');
      if (cntEl) {
        const meetingsPanel = document.querySelector('[data-cdpanel="meetings"]');
        let count = meetingsPanel ? meetingsPanel.querySelectorAll('.fp-meeting-card').length : 0;
        if (count === 0 && meetingsPanel && meetingsPanel.dataset.cacheHasContent !== '1') {
          // 未render — data source から count 推定
          const live = window.LineAppLiveData || {};
          const aiForC = (live.ai_results || []).filter(a =>
            (a.userId && (a.userId === c.id || a.userId === c.lineFriendId)) ||
            (a.customerName && a.customerName === c.name)
          );
          const bkForC = (live.bookings || []).filter(b =>
            b.userId === c.lineFriendId || b.name === c.name
          );
          // 名寄せ: ai_results と bookings の bookingTs で dedup
          const seen = new Set();
          bkForC.forEach(b => seen.add(b.ts || ''));
          let total = bkForC.length;
          aiForC.forEach(a => { if (!seen.has(a.bookingTs || '')) total++; });
          count = total;
        }
        cntEl.textContent = count;
      }
    } catch (_) {}

    // ★ 議事録 編集 / 保存 (CLOUD_RUN_BASE/api/save-ai-result 経由で GAS sheet 上書き)
    document.querySelectorAll('[data-minutes-editor]').forEach(wrap => {
      const editBtn = wrap.querySelector('.fp-minutes-edit');
      const viewEl = wrap.querySelector('.fp-minutes-view');
      const editWrap = wrap.querySelector('.fp-minutes-edit-wrap');
      const textarea = wrap.querySelector('.fp-minutes-textarea');
      const cancelBtn = wrap.querySelector('.fp-minutes-cancel');
      const saveBtn = wrap.querySelector('.fp-minutes-save');
      const msgEl = wrap.querySelector('.fp-minutes-msg');
      const bookingTs = wrap.dataset.bookingTs;
      editBtn.addEventListener('click', () => {
        viewEl.style.display = 'none';
        editWrap.style.display = 'block';
        editBtn.style.display = 'none';
        textarea.focus();
      });
      cancelBtn.addEventListener('click', () => {
        viewEl.style.display = '';
        editWrap.style.display = 'none';
        editBtn.style.display = '';
        msgEl.textContent = '';
        textarea.value = viewEl.textContent.startsWith('議事録 未生成') ? '' : viewEl.textContent;
      });
      saveBtn.addEventListener('click', async () => {
        const newSummary = textarea.value.trim();
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中…';
        msgEl.textContent = '';
        try {
          // 既存 ai_result から transcript/key_concerns etc を 維持 して summary だけ上書き
          const liveAi3 = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
          const existing = liveAi3.find(r => r.bookingTs === bookingTs) || {};
          const entry = {
            bookingTs,
            userId: existing.userId || c.lineFriendId || '',
            customerName: existing.customerName || c.name || '',
            date: existing.date || '',
            transcript: existing.transcript || '',
            summary: newSummary,
            transcript_summary: existing.transcript_summary || '',
            key_concerns: existing.key_concerns || [],
            next_meeting_suggestion: existing.next_meeting_suggestion || '',
            lifeEventCandidates: existing.lifeEventCandidates || [],
          };
          const res = await fetch('https://fp-compass-webhook-527726449426.asia-northeast1.run.app/api/save-ai-result', {
            method: 'POST',
            headers: await (window.getFpAuthHeaders ? window.getFpAuthHeaders() : Promise.resolve({ 'Content-Type': 'application/json' })),
            body: JSON.stringify({ entry, tasks: [] }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'unknown');
          // UI更新
          viewEl.textContent = newSummary;
          viewEl.style.display = '';
          viewEl.style.color = '';
          viewEl.style.fontStyle = '';
          editWrap.style.display = 'none';
          editBtn.style.display = '';
          msgEl.style.color = '#059669';
          msgEl.textContent = '✓ 保存 完了';
          // 既存 liveAi3 array も 更新 (再 fetch せず次回 開いた時 反映)
          if (existing && Object.keys(existing).length > 0) existing.summary = newSummary;
          else liveAi3.push(entry);
          setTimeout(() => { msgEl.textContent = ''; }, 3000);
        } catch (e) {
          msgEl.style.color = '#B91C1C';
          msgEl.textContent = '保存失敗: ' + (e.message || e).slice(0, 60);
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 保存';
        }
      });
    });

    // ★ 家系図 タブ: AI 抽出 / 追加 / 編集 / 保存
    function persistFamily() {
      try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS || [])); } catch (_) {}
      // ★ Firestore docId は 20文字 英数字。 c._fsCustomerId or c.id (Firestore docId format) で fallback
      const fsDocId = c._fsCustomerId || (typeof c.id === 'string' && /^[A-Za-z0-9]{20}$/.test(c.id) ? c.id : null);
      if (fsDocId && window.__fp?.db && window.__fp?.tenantId) {
        (async () => {
          try {
            const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
            await updateDoc(doc(window.__fp.db, 'tenants', window.__fp.tenantId, 'customers', fsDocId), { family: c.family || [] });
            console.log('[persistFamily] Firestore 同期 OK', c.family?.length, '名 docId=', fsDocId);
          } catch (e) { console.warn('[persistFamily] Firestore sync fail:', e.message, e.code); }
        })();
      } else {
        console.log('[persistFamily] localStorage only', { fsDocId, hasDb: !!window.__fp?.db, hasTid: !!window.__fp?.tenantId, cid: c.id });
      }
    }
    function refreshFamilyPanel() {
      const panel = document.querySelector('[data-cdpanel="family"]');
      if (panel) panel.innerHTML = renderFamilyTreeBlock(c);
      bindFamilyHandlers();
      // tab count 更新
      const tab = document.querySelector('[data-cdtab="family"] .cd-tab-count');
      if (tab) tab.textContent = (c.family || []).length + 1;
    }
    function openFamilyEditModal(memberIdx) {
      const m = memberIdx == null ? { rel: 'child', name: '', birth: '', note: '' } : (c.family || [])[memberIdx] || { rel: 'other', name: '', birth: '', note: '' };
      const isNew = memberIdx == null;
      // ★ 2段プルダウン: 世代グループ → 細部 (50-60代 FP の 操作迷い 解消)
      // グループ 色: 上=パープル / 同=ティール / 下=オレンジ / その他=グレー
      // 細分化: 父/母 別、 兄/姉/弟/妹 別、 長男/長女/次男/次女 別 (家系図 仕組み準拠)
      const REL_TREE = {
        upper:    { label: '上の世代', color: '#A855F7', bg: '#FAF5FF', items: [
          { v: 'grandfather_p', ja: '祖父 (父方)' },
          { v: 'grandmother_p', ja: '祖母 (父方)' },
          { v: 'grandfather_m', ja: '祖父 (母方)' },
          { v: 'grandmother_m', ja: '祖母 (母方)' },
          { v: 'father',         ja: '父' },
          { v: 'mother',         ja: '母' },
          { v: 'father_in_law',  ja: '義父 (配偶者の父)' },
          { v: 'mother_in_law',  ja: '義母 (配偶者の母)' },
          { v: 'uncle_p',        ja: 'おじ (父方)' },
          { v: 'aunt_p',         ja: 'おば (父方)' },
          { v: 'uncle_m',        ja: 'おじ (母方)' },
          { v: 'aunt_m',         ja: 'おば (母方)' },
        ] },
        same:     { label: '同世代',   color: '#0D9488', bg: '#F0FDFA', items: [
          { v: 'spouse',           ja: '配偶者' },
          { v: 'elder_brother',    ja: '兄' },
          { v: 'elder_sister',     ja: '姉' },
          { v: 'younger_brother',  ja: '弟' },
          { v: 'younger_sister',   ja: '妹' },
          { v: 'brother_in_law',   ja: '義兄弟 (配偶者の兄弟)' },
          { v: 'sister_in_law',    ja: '義姉妹 (配偶者の姉妹)' },
          { v: 'cousin',           ja: 'いとこ' },
        ] },
        lower:    { label: '下の世代', color: '#EA580C', bg: '#FFF7ED', items: [
          { v: 'son_1st',       ja: '長男' },
          { v: 'daughter_1st',  ja: '長女' },
          { v: 'son_2nd',       ja: '次男' },
          { v: 'daughter_2nd',  ja: '次女' },
          { v: 'son_3rd',       ja: '三男' },
          { v: 'daughter_3rd',  ja: '三女' },
          { v: 'child_other',   ja: 'お子様 (その他)' },
          { v: 'child_in_law',  ja: '子の配偶者' },
          { v: 'nephew',        ja: '甥' },
          { v: 'niece',         ja: '姪' },
          { v: 'grandson',      ja: '孫 (男)' },
          { v: 'granddaughter', ja: '孫 (女)' },
        ] },
        other:    { label: 'その他',   color: '#64748B', bg: '#F8FAFC', items: [
          { v: 'other', ja: 'その他' },
        ] },
      };
      // 現在の rel から グループ 推定
      const findGroup = (relV) => {
        for (const [g, def] of Object.entries(REL_TREE)) {
          if (def.items.find(it => it.v === relV)) return g;
        }
        return 'other';
      };
      const curGroup = findGroup(m.rel);
      // 生年月日 → year/month/day 分解
      const bDate = m.birth ? new Date(m.birth + 'T00:00:00') : null;
      const bYear = bDate && !isNaN(bDate) ? bDate.getFullYear() : '';
      const bMonth = bDate && !isNaN(bDate) ? bDate.getMonth() + 1 : '';
      const bDay = bDate && !isNaN(bDate) ? bDate.getDate() : '';
      const thisYear = new Date().getFullYear();
      const yearOpts = ['<option value="">—</option>'];
      for (let y = thisYear; y >= thisYear - 110; y--) yearOpts.push(`<option value="${y}" ${y === bYear ? 'selected' : ''}>${y} 年</option>`);
      const monthOpts = ['<option value="">—</option>'];
      for (let mo = 1; mo <= 12; mo++) monthOpts.push(`<option value="${mo}" ${mo === bMonth ? 'selected' : ''}>${mo} 月</option>`);
      const dayOpts = ['<option value="">—</option>'];
      for (let d = 1; d <= 31; d++) dayOpts.push(`<option value="${d}" ${d === bDay ? 'selected' : ''}>${d} 日</option>`);
      // グループ プルダウン
      const grpOpts = Object.entries(REL_TREE).map(([g, def]) => `<option value="${g}" ${g === curGroup ? 'selected' : ''}>${def.label}</option>`).join('');
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);z-index:10100;display:flex;align-items:center;justify-content:center;padding:20px;';
      overlay.innerHTML = `
        <div id="fp-fam-modal-box" style="background:#fff;width:min(480px,100%);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.32);padding:26px 28px;font-family:'Noto Sans JP',sans-serif;border-top:6px solid ${REL_TREE[curGroup].color};transition:border-color .2s;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
            <div style="font-size:19px;font-weight:900;color:#0F172A;letter-spacing:-0.01em;">${isNew ? '＋ 家族 を 追加' : '✏ 家族 を 編集'}</div>
            <button id="fp-fam-modal-close" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:#64748B;">✕</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:16px;">
            <!-- STEP 1: 世代グループ -->
            <label style="display:block;">
              <div style="font-size:13px;font-weight:800;color:#475569;margin-bottom:8px;letter-spacing:0.01em;"><span style="background:${REL_TREE[curGroup].color};color:#fff;font-size:11px;font-weight:900;padding:2px 9px;border-radius:5px;margin-right:8px;letter-spacing:0.06em;">STEP 1</span>世代</div>
              <select id="fp-fam-grp" style="width:100%;padding:14px 14px;border:2px solid #E2E8F0;border-radius:11px;font-size:17px;font-weight:700;font-family:inherit;background:#fff;min-height:56px;color:#0F172A;">${grpOpts}</select>
            </label>
            <!-- STEP 2: 関係 細部 (グループに応じて 更新) -->
            <label style="display:block;">
              <div style="font-size:13px;font-weight:800;color:#475569;margin-bottom:8px;letter-spacing:0.01em;"><span style="background:${REL_TREE[curGroup].color};color:#fff;font-size:11px;font-weight:900;padding:2px 9px;border-radius:5px;margin-right:8px;letter-spacing:0.06em;">STEP 2</span>関係</div>
              <select id="fp-fam-rel" style="width:100%;padding:14px 14px;border:2px solid #E2E8F0;border-radius:11px;font-size:17px;font-weight:700;font-family:inherit;background:#fff;min-height:56px;color:#0F172A;"></select>
            </label>
            <!-- 名前 -->
            <label style="display:block;">
              <div style="font-size:13px;font-weight:800;color:#475569;margin-bottom:8px;">お名前</div>
              <input id="fp-fam-name" type="text" value="${escapeHtml(m.name || '')}" placeholder="例: 太郎 / 長女" style="width:100%;padding:14px 14px;border:2px solid #E2E8F0;border-radius:11px;font-size:17px;font-weight:600;font-family:inherit;box-sizing:border-box;min-height:56px;">
            </label>
            <!-- 生年月日 (3プルダウン) -->
            <div>
              <div style="font-size:13px;font-weight:800;color:#475569;margin-bottom:8px;">生年月日 <span style="font-weight:500;color:#94A3B8;font-size:11.5px;margin-left:6px;">(誕生日タブに 自動反映)</span></div>
              <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px;">
                <select id="fp-fam-byear" style="padding:14px 8px;border:2px solid #E2E8F0;border-radius:11px;font-size:16px;font-weight:700;font-family:inherit;background:#fff;min-height:56px;color:#0F172A;">${yearOpts.join('')}</select>
                <select id="fp-fam-bmonth" style="padding:14px 8px;border:2px solid #E2E8F0;border-radius:11px;font-size:16px;font-weight:700;font-family:inherit;background:#fff;min-height:56px;color:#0F172A;">${monthOpts.join('')}</select>
                <select id="fp-fam-bday" style="padding:14px 8px;border:2px solid #E2E8F0;border-radius:11px;font-size:16px;font-weight:700;font-family:inherit;background:#fff;min-height:56px;color:#0F172A;">${dayOpts.join('')}</select>
              </div>
            </div>
            <!-- メモ -->
            <label style="display:block;">
              <div style="font-size:13px;font-weight:800;color:#475569;margin-bottom:8px;">メモ <span style="font-weight:500;color:#94A3B8;font-size:11.5px;margin-left:6px;">(任意 — 職業 / 学年 等)</span></div>
              <input id="fp-fam-note" type="text" value="${escapeHtml(m.note || '')}" placeholder="例: 中学2年 / 公務員" style="width:100%;padding:14px 14px;border:2px solid #E2E8F0;border-radius:11px;font-size:16px;font-weight:500;font-family:inherit;box-sizing:border-box;min-height:56px;">
            </label>
          </div>
          <div style="display:flex;gap:10px;justify-content:space-between;margin-top:24px;">
            ${isNew ? '<div></div>' : '<button id="fp-fam-delete" style="background:#fef2f2;color:#b91c1c;border:1.5px solid #fecaca;padding:14px 18px;border-radius:11px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;">🗑 削除</button>'}
            <div style="display:flex;gap:10px;">
              <button id="fp-fam-cancel" style="background:#fff;color:#475569;border:1.5px solid #E2E8F0;padding:14px 22px;border-radius:11px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;">キャンセル</button>
              <button id="fp-fam-save" style="background:linear-gradient(135deg,${REL_TREE[curGroup].color},${REL_TREE[curGroup].color}DD);color:#fff;border:none;padding:14px 28px;border-radius:11px;font-size:14.5px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px ${REL_TREE[curGroup].color}40;">💾 保存</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const box = overlay.querySelector('#fp-fam-modal-box');
      const grpSel = overlay.querySelector('#fp-fam-grp');
      const relSel = overlay.querySelector('#fp-fam-rel');
      const saveBtn = overlay.querySelector('#fp-fam-save');
      // STEP2 細部 select を STEP1 グループ に応じて 更新 + 全体の色を更新
      const refreshRelOpts = () => {
        const g = grpSel.value;
        const def = REL_TREE[g] || REL_TREE.other;
        relSel.innerHTML = def.items.map(it => `<option value="${it.v}" ${it.v === m.rel ? 'selected' : ''}>${it.ja}</option>`).join('');
        // 色を group color に切替
        box.style.borderTopColor = def.color;
        saveBtn.style.background = `linear-gradient(135deg,${def.color},${def.color}DD)`;
        saveBtn.style.boxShadow = `0 4px 14px ${def.color}40`;
        // STEPバッジ色も更新
        box.querySelectorAll('span[style*="background:"][style*="STEP"]').forEach(s => {
          s.style.background = def.color;
        });
        // 当該 グループ の バッジ も
        Array.from(box.querySelectorAll('span')).forEach(s => {
          if (s.textContent.startsWith('STEP ')) s.style.background = def.color;
        });
      };
      grpSel.addEventListener('change', refreshRelOpts);
      refreshRelOpts();
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      overlay.querySelector('#fp-fam-modal-close').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#fp-fam-cancel').addEventListener('click', () => overlay.remove());
      saveBtn.addEventListener('click', () => {
        // birth: 3プルダウン → YYYY-MM-DD 復元
        const y = overlay.querySelector('#fp-fam-byear').value;
        const mo = overlay.querySelector('#fp-fam-bmonth').value;
        const da = overlay.querySelector('#fp-fam-bday').value;
        const birth = (y && mo && da) ? `${y}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}` : '';
        const updated = {
          rel: relSel.value,
          name: overlay.querySelector('#fp-fam-name').value.trim(),
          birth: birth,
          note: overlay.querySelector('#fp-fam-note').value.trim() || '',
        };
        if (!Array.isArray(c.family)) c.family = [];
        if (isNew) c.family.push(updated);
        else c.family[memberIdx] = updated;
        persistFamily();
        overlay.remove();
        refreshFamilyPanel();
      });
      const delBtn = overlay.querySelector('#fp-fam-delete');
      if (delBtn) delBtn.addEventListener('click', () => {
        if (!confirm('この家族を削除しますか?')) return;
        c.family.splice(memberIdx, 1);
        persistFamily();
        overlay.remove();
        refreshFamilyPanel();
      });
    }
    async function extractFamilyFromMinutes() {
      const msgEl = document.getElementById('fp-fam-msg');
      const btn = document.getElementById('fp-fam-ai');
      btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = '✨ AI 抽出中…';
      if (msgEl) { msgEl.style.color = '#475569'; msgEl.textContent = '議事録 + アンケート を 解析中 (10-20秒)…'; }
      try {
        // 議事録 集約
        const ar = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
        const cConfMs = c.confirmedSlot ? new Date(String(c.confirmedSlot).replace(' ','T')).getTime() : NaN;
        const mine = ar.filter(r => {
          const strict = (r.userId && c.lineFriendId && r.userId === c.lineFriendId)
                      || (r.customerName && r.customerName !== 'お客様' && r.customerName === c.name);
          if (strict) return true;
          if (!isNaN(cConfMs) && (!r.customerName || r.customerName === 'お客様') && !r.userId) {
            const rMs = new Date(String(r.ts || r.bookingTs || '').replace(' ','T')).getTime();
            if (!isNaN(rMs) && Math.abs(rMs - cConfMs) < 6 * 60 * 60 * 1000) return true;
          }
          return false;
        });
        if (mine.length === 0) {
          if (msgEl) { msgEl.style.color = '#92400e'; msgEl.textContent = '⚠ 議事録 が 見つかりません。 Zoom 録画 後 再試行してください'; }
          btn.disabled = false; btn.style.opacity = ''; btn.textContent = '✨ 議事録 から AI 抽出';
          return;
        }
        const ctxText = mine.map(r => 'summary: ' + (r.summary || '') + '\ntranscript: ' + (r.transcript || '').slice(0, 1500)).join('\n\n---\n\n');
        const survey = ((window.LineAppLiveData && window.LineAppLiveData.survey_answers) || []).find(s => (s.userId && s.userId === c.lineFriendId) || (s.name && s.name === c.name));
        const surveyTxt = survey ? '\n\nアンケート: ' + JSON.stringify({ family: survey.q3_家族, occupation: survey.q2_職業 }) : '';
        const prompt = `あなたはFP事務所の家族構成抽出AIです。下記のZoom議事録(複数) + アンケート から ${c.name || 'お客様'} 様 の 家族構成 を 抽出してください。

【出力フォーマット 厳守 — JSONのみ、 マークダウン や 説明文 一切なし】
{
  "family": [
    { "rel": "<下記 rel 種別 から 必ず ひとつ>",
      "name": "名前(または続柄: 妻/長女/長男/母 等)",
      "birth": "YYYY-MM-DD or 空",
      "note": "学年 / 職業 / 推定年齢 等" }
  ]
}

【rel 種別 — 細分化 34区分 / 必ず この値 を 使う】
祖父母世代: grandfather_p (祖父・父方) / grandmother_p (祖母・父方) / grandfather_m (祖父・母方) / grandmother_m (祖母・母方)
親世代: father (父) / mother (母) / father_in_law (義父) / mother_in_law (義母) / uncle_p (おじ・父方) / aunt_p (おば・父方) / uncle_m (おじ・母方) / aunt_m (おば・母方)
本人世代: spouse (配偶者) / elder_brother (兄) / elder_sister (姉) / younger_brother (弟) / younger_sister (妹) / brother_in_law (義兄弟) / sister_in_law (義姉妹) / cousin (いとこ)
子世代: son_1st (長男) / daughter_1st (長女) / son_2nd (次男) / daughter_2nd (次女) / son_3rd (三男) / daughter_3rd (三女) / child_other (お子様その他) / child_in_law (子の配偶者) / nephew (甥) / niece (姪)
孫世代: grandson (孫・男) / granddaughter (孫・女)
その他: other

【ルール】
- 本人 (${c.name || 'お客様'} 様) は family に含めない (別途扱う)
- 父/母 を 区別 (議事録から 性別 / 続柄判明時)、 不明なら parent では なく 父 か 母 推測
- 兄/姉/弟/妹 は 年齢関係から 判別 (本人より上=elder_, 下=younger_, 性別 で 兄/弟・姉/妹)
- 長男/長女/次男/次女 は 議事録 の 順序 + 性別 で 判別 (上 の 子から 順に)
- birth は 議事録に YYYY/MM/DD や 生年月日明示があれば YYYY-MM-DD で 抽出 (例: 「妻は1972年5月生まれ」 → "1972-05-01")
- birth が議事録から推定できない場合は空、 年齢ヒントがあれば note に「○歳」 と書く
- 学年 / 職業 / 居住地 等の 補足情報 は note に
- 議事録に出てこない人は推測しない
- name は議事録に出てる呼称 (例: 「妻」「長女」「弟」「兄」 等) でも OK、 不明なら 続柄 をそのまま

【議事録 + アンケート】
${ctxText}${surveyTxt}`;
        if (!window.__fp?.functions) throw new Error('Firebase functions 未初期化');
        const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
        const fn = httpsCallable(window.__fp.functions, 'generateBriefDraft');
        const res = await fn({ prompt });
        const reply = (res.data && res.data.reply) || '';
        const m = reply.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('AI から JSON 形式 で 返ってこなかった');
        const data = JSON.parse(m[0]);
        const newFam = Array.isArray(data.family) ? data.family : [];
        if (newFam.length === 0) {
          if (msgEl) { msgEl.style.color = '#92400e'; msgEl.textContent = '⚠ 議事録 から 家族情報 を 抽出 できませんでした'; }
        } else {
          // 既存 family と merge (rel+name で 重複除外)
          if (!Array.isArray(c.family)) c.family = [];
          let added = 0;
          newFam.forEach(nm => {
            const key = (nm.rel || '') + '|' + (nm.name || '');
            const exists = c.family.some(ex => ((ex.rel||'') + '|' + (ex.name||'')) === key);
            if (!exists) { c.family.push(nm); added++; }
          });
          persistFamily();
          if (msgEl) { msgEl.style.color = '#059669'; msgEl.textContent = `✓ ${added}名 を 抽出 + 追加 (既存と重複は スキップ)`; }
          refreshFamilyPanel();
        }
      } catch (e) {
        console.error('[extractFamily]', e);
        if (msgEl) { msgEl.style.color = '#b91c1c'; msgEl.textContent = '⚠ 抽出失敗: ' + (e.message || e).slice(0, 80); }
      } finally {
        btn.disabled = false; btn.style.opacity = ''; btn.textContent = '✨ 議事録 から AI 抽出';
      }
    }
    function bindFamilyHandlers() {
      const aiBtn = document.getElementById('fp-fam-ai');
      if (aiBtn) aiBtn.addEventListener('click', extractFamilyFromMinutes);
      const addBtn = document.getElementById('fp-fam-add');
      if (addBtn) addBtn.addEventListener('click', () => openFamilyEditModal(null));
      document.querySelectorAll('.fp-fam-edit, .fp-fam-card[data-fam-idx]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const idxStr = el.dataset.famEditIdx ?? el.dataset.famIdx;
          if (idxStr === 'self' || idxStr == null) return;
          const idx = parseInt(idxStr, 10);
          if (!isNaN(idx)) openFamilyEditModal(idx);
        });
      });
    }
    bindFamilyHandlers();
    // Tab switching inside new modal
    document.querySelectorAll('.cd-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.cdtab;
        document.querySelectorAll('.cd-tab').forEach(b => b.classList.toggle('cd-tab-active', b === btn));
        document.querySelectorAll('.cd-tabpanel').forEach(p => {
          if (p.dataset.cdpanel === key) p.removeAttribute('hidden');
          else p.setAttribute('hidden', '');
        });
        // ★ 2026-06-29: lazy render — タブclick時 初めて panel 中身 build
        try {
          const panel = document.querySelector(`[data-cdpanel="${key}"]`);
          if (panel && panel.dataset.lazyRender) {
            if (key === 'meetings' && typeof renderMeetingRecordsBlock === 'function') {
              const live = window.LineAppLiveData || {};
              const aiCount = (live.ai_results || []).filter(a =>
                a.userId === c.id || a.userId === c.lineFriendId || a.customerName === c.name
              ).length;
              const cacheKey = `${c.id}|${aiCount}|${(c.lineHistory||[]).length}`;
              if (panel.dataset.cacheKey !== cacheKey || panel.dataset.cacheHasContent !== '1') {
                panel.innerHTML = renderMeetingRecordsBlock(c) || '<div class="cd-empty">面談録なし</div>';
                panel.dataset.cacheKey = cacheKey;
                panel.dataset.cacheHasContent = '1';
              }
              // ★ 2026-07-02 fix: lazy-render 後に count badge 同期 (直接 meetings タブ 開いた時 0 表示バグ)
              try {
                const cntEl = document.getElementById('cd-meetings-count');
                if (cntEl) cntEl.textContent = panel.querySelectorAll('.fp-meeting-card').length;
              } catch (_) {}
            } else if (key === 'timeline' && panel.dataset.cacheHasContent !== '1') {
              panel.innerHTML = `${lifeCtaCard}<div class="cd-tl-list">${timelineHtml2}</div>${events.length > 12 ? `<div class="cd-tl-more">他 ${events.length - 12} 件...</div>` : ''}`;
              panel.dataset.cacheHasContent = '1';
            } else if (key === 'family' && typeof renderFamilyTreeBlock === 'function' && panel.dataset.cacheHasContent !== '1') {
              panel.innerHTML = renderFamilyTreeBlock(c);
              panel.dataset.cacheHasContent = '1';
              // family は内部で bindFamilyHandlers 必要なので 再bind
              if (typeof bindFamilyHandlers === 'function') bindFamilyHandlers();
            }
          }
        } catch (_) {}
        // ★ URL routing Phase3: モーダル内タブ → ?tab=key
        try {
          const cur = window._fpCurrentClient;
          if (cur && cur.id && typeof pushModalUrl === 'function' && !btn.dataset.fromPopstate) {
            pushModalUrl(cur.id, key);
          }
        } catch (_) {}
        // ★ LINE 履歴タブ開いたら「既読」マーク + 最新へ自動スクロール (オーナーfb 2026-06-25)
        if (key === 'line') {
          try {
            localStorage.setItem('fp-line-read-' + c.id, Date.now().toString());
            // タブ内の赤バッジを消す
            btn.querySelectorAll('span').forEach(s => {
              if (s.textContent && /^\d+$/.test(s.textContent.trim()) && s.style.background && s.style.background.includes('DC2626')) {
                s.remove();
              }
            });
          } catch(_) {}
          // 最新メッセを 一番下 に スクロール (毎回 タブ開時 確実に底)
          setTimeout(() => {
            const chatEl = document.getElementById('cd-line-chat');
            if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
          }, 80);
        }
        // ★ Phase 2: Q&A タブ 初回開時 自動 分析
        if (key === 'qa') {
          loadQATabForClient(c);
        }
      });
    });
    // Quick action stubs
    const qaStub = (id, label) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => alert(label + ': まだ実装してないけど、ここから ' + label + ' を起動します'));
    };
    qaStub('cd-action-line', 'LINE送信');
    qaStub('cd-action-call', '電話発信');
    qaStub('cd-action-meet', 'Zoom起動');
    qaStub('cd-action-mail', 'メール作成');
    // 「AI下書き」 → AI Action Brief を開く
    document.querySelectorAll('[data-line-ai]').forEach(btn => {
      btn.addEventListener('click', () => openDraftReplyModal(c, events, recs));
    });
    // ★ 「✍ 伝えたいことから下書き」 → 簡易ブリーフ Modal
    document.querySelectorAll('[data-line-brief]').forEach(btn => {
      btn.addEventListener('click', () => openBriefDraftModal(c));
    });
    // ★ オーナーfb 2026-06-20: 「候補日 3つ 送る」 → AI下書き 経由不要、 直接 Flex Carousel で 送れる
    document.querySelectorAll('[data-line-slots]').forEach(btn => {
      btn.addEventListener('click', () => openSlotsSendModal(c));
    });
    // ★ オーナーfb 2026-06-20: 「📅 日時指定 Zoom 予約」 — 単一日時 指定 → scheduleZoomDirect Cloud Function
    const scheduleBtn = document.getElementById('cd-schedule-zoom-btn');
    if (scheduleBtn) {
      scheduleBtn.addEventListener('click', () => openScheduleZoomModal(c));
    }
    // ★ クイックアクション (AI推奨ブロック内 内包)
    document.querySelectorAll('[data-quick-instant]').forEach(b => b.addEventListener('click', () => document.getElementById('cd-instant-zoom-btn')?.click()));
    document.querySelectorAll('[data-quick-schedule]').forEach(b => b.addEventListener('click', () => openScheduleZoomModal(c)));
    document.querySelectorAll('[data-quick-slots]').forEach(b => b.addEventListener('click', () => openSlotsSendModal(c)));
    document.querySelectorAll('[data-quick-tag]').forEach(b => b.addEventListener('click', () => document.getElementById('cd-tags-edit')?.click()));
    // ★ オーナーfb 2026-06-20: 「⚡ 今すぐ Zoom 開始」 — Zoom Instant Meeting 作成 → LINE 自動送付 → host URL を 新タブで開く
    const instantBtn = document.getElementById('cd-instant-zoom-btn');
    if (instantBtn) {
      instantBtn.addEventListener('click', async () => {
        const status = document.getElementById('cd-instant-zoom-status');
        if (!confirm(c.name + ' 様 に 「今すぐ Zoom 開始」 します。\n\n・Zoom Instant Meeting が 作成されます\n・URL が LINE で 即送信されます\n・ FP の Zoom が この後 新タブで 開きます (録画ON)\n\nよろしいですか?')) return;
        const origHtml = instantBtn.innerHTML;
        instantBtn.disabled = true;
        instantBtn.style.opacity = '0.7';
        instantBtn.style.cursor = 'wait';
        status.style.color = '#2D8CFF'; status.textContent = '⏳ Zoom Meeting 作成中 + LINE 送信中…';
        try {
          const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
          const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
          const fbApp = getApps()[0] || initializeApp({
            apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
            authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
            projectId: 'skeleton-fp-compass-632026',
          });
          const fns = getFunctions(fbApp, 'asia-northeast1');
          const fn = httpsCallable(fns, 'startInstantZoom');
          const fsCustomerId = c._fsCustomerId || c.id;
          const res = await fn({ customerId: fsCustomerId, lineFriendId: c.lineFriendId || null });
          const data = (res && res.data) || {};
          if (data.startUrl) {
            window.open(data.startUrl, '_blank');
            status.style.color = '#059669';
            status.textContent = data.lineSent
              ? '✅ LINE 送付完了 / FP の Zoom を 別タブ で 開きました (Meeting ID: ' + (data.meetingId || '?') + ')'
              : '⚠ Meeting 作成成功 だが LINE 送信失敗 (' + (data.error || '') + ')';
            // ★ Firestore データ即refresh → leadHub/Zoom予定 リスト 即反映
            try {
              if (window.refreshFirestoreCustomers) await window.refreshFirestoreCustomers();
              c.zoomUrl = data.joinUrl;
              c.zoomMeetingId = String(data.meetingId || '');
            } catch (_) {}
            instantBtn.style.background = '#ECFDF5';
            instantBtn.style.borderColor = '#10B981';
            instantBtn.style.opacity = '1';
            instantBtn.style.cursor = 'default';
          } else {
            throw new Error('startUrl が 返ってこなかった');
          }
        } catch (e) {
          console.error('[instantZoom]', e);
          status.style.color = '#DC2626'; status.textContent = '❌ 失敗: ' + (e.message || e).slice(0, 200);
          instantBtn.disabled = false; instantBtn.innerHTML = origHtml;
          instantBtn.style.opacity = '1'; instantBtn.style.cursor = 'pointer';
        }
      });
    }
    // ★ オーナーfb 2026-06-23: 「この LINE客 は 既に登録済」 → 既存客 list pick → マージ
    const mergeBtn = document.getElementById('cd-merge-existing');
    if (mergeBtn) {
      mergeBtn.addEventListener('click', async () => {
        const sourceCid = mergeBtn.dataset.cid;      // この LINE 客 (削除予定)
        const uid = mergeBtn.dataset.uid;
        const allClients = (window.DUMMY_CLIENTS || []).filter(x => x.id !== sourceCid && !x.lineFriendId);
        if (allClients.length === 0) {
          alert('マージ先 候補 (LINE 未連携 の既存客) が ありません。 先に 「+ 新規 顧客」 で 登録してください。');
          return;
        }
        // 簡易 picker: prompt で 名前選択
        const list = allClients.map((c, i) => `${i + 1}. ${c.name}${c.kana ? ' (' + c.kana + ')' : ''}`).join('\n');
        const sel = prompt(`どの既存客に マージ しますか? (番号で 入力)\n\n${list}\n\nキャンセル: 空 or × を 入力`);
        if (!sel || sel === '×') return;
        const idx = parseInt(sel, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= allClients.length) {
          alert('番号が 不正です'); return;
        }
        const target = allClients[idx];
        if (!confirm(`「${target.name}」 に この LINE 客 を マージします。\n\n・「${target.name}」 に LINE userId 紐付け\n・現在開いてる LINE 客レコード を 削除\n\nよろしいですか?`)) return;
        try {
          const { doc, updateDoc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
          const tid = window.__fp.tenantId;
          await updateDoc(doc(window.__fp.db, `tenants/${tid}/customers/${target.id}`), {
            lineFriendId: uid, userId: uid, lineLinkedAt: new Date(),
          });
          target.lineFriendId = uid; target.userId = uid;
          await deleteDoc(doc(window.__fp.db, `tenants/${tid}/customers/${sourceCid}`));
          const i2 = (window.DUMMY_CLIENTS || []).findIndex(x => x.id === sourceCid);
          if (i2 >= 0) window.DUMMY_CLIENTS.splice(i2, 1);
          alert(`✓ マージ完了 — 「${target.name}」 に LINE 連携を 紐付けました。`);
          if (typeof window.refreshFirestoreCustomers === 'function') await window.refreshFirestoreCustomers();
          if (typeof renderClients === 'function') renderClients();
          // 元モーダル 閉じて マージ先 を 開く
          try { document.getElementById('modal-overlay').style.display = 'none'; } catch (_) {}
          setTimeout(() => openClientModal(target.id), 600);
        } catch (e) {
          alert('✗ マージ失敗: ' + (e.message || e));
        }
      });
    }
    // ★ オーナーfb 2026-06-23: LINE userId コピー (LINE連携済客)
    const lineidCopyBtn = document.getElementById('cd-lineid-copy');
    if (lineidCopyBtn) {
      lineidCopyBtn.addEventListener('click', async () => {
        const uid = lineidCopyBtn.dataset.uid || '';
        try {
          await navigator.clipboard.writeText(uid);
          const orig = lineidCopyBtn.innerHTML;
          lineidCopyBtn.innerHTML = '✓ コピー済';
          lineidCopyBtn.style.background = '#065F46';
          setTimeout(() => { lineidCopyBtn.innerHTML = orig; lineidCopyBtn.style.background = '#06C755'; }, 1500);
        } catch (e) {
          // fallback: select the code element
          const code = document.getElementById('cd-lineid-show');
          if (code) {
            const range = document.createRange();
            range.selectNodeContents(code);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            try { document.execCommand('copy'); } catch (_) {}
            sel.removeAllRanges();
          }
          alert('LINE userId: ' + uid);
        }
      });
    }
    // ★ 2026-06-22 roundK: LINE ID 後付け 紐付け
    const lineidBtn = document.getElementById('cd-lineid-attach-btn');
    if (lineidBtn) {
      lineidBtn.addEventListener('click', async () => {
        const input = document.getElementById('cd-lineid-attach-input');
        const msg = document.getElementById('cd-lineid-attach-msg');
        const cid = lineidBtn.dataset.cid;
        const val = (input.value || '').trim();
        if (!/^U[a-f0-9]{32}$/i.test(val)) {
          msg.textContent = '✗ LINE userId の 形式が違います (U+ 32文字 の英数)';
          msg.style.color = '#B91C1C';
          return;
        }
        msg.textContent = '⏳ Firestore に 紐付け中…';
        msg.style.color = '#9A5A18';
        lineidBtn.disabled = true;
        try {
          if (!window.__fp?.functions) throw new Error('functions 未初期化');
          const { doc, updateDoc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
          const tid = window.__fp.tenantId;
          // ★ オーナーfb 2026-06-23: 紐付け時に 同じ userId の 自動作成 LINE 客 (重複) を 削除する
          const dupes = (window._fpFirestoreCustomers || []).filter(x => x.lineFriendId === val && x.docId !== cid);
          if (dupes.length > 0) {
            const confirmMsg = `この LINE userId は 既に「${dupes[0].name || '(名無し)'}」 として 別行 に 自動登録されてます。\n\nこちらの 「${(window.DUMMY_CLIENTS || []).find(x => x.id === cid)?.name || cid}」 に 統合 (自動登録分を 削除) しますか?\n\n※ LINE 履歴 は 紐付くだけなので 失われません。 自動登録分の メモ/タスク は 残ります (元客id ベースなので)。`;
            if (!confirm(confirmMsg)) {
              msg.textContent = '✗ キャンセルされました';
              msg.style.color = '#9A5A18';
              lineidBtn.disabled = false;
              return;
            }
          }
          // 1. 元客 に lineFriendId をセット
          await updateDoc(doc(window.__fp.db, `tenants/${tid}/customers/${cid}`), {
            lineFriendId: val,
            userId: val,
            lineLinkedAt: new Date(),
          });
          const lc = (window.DUMMY_CLIENTS || []).find(x => x.id === cid);
          if (lc) { lc.lineFriendId = val; lc.userId = val; }
          // 2. 重複 LINE 客 を削除
          for (const d of dupes) {
            try {
              await deleteDoc(doc(window.__fp.db, `tenants/${tid}/customers/${d.docId}`));
              const idx = (window.DUMMY_CLIENTS || []).findIndex(x => x.id === d.docId);
              if (idx >= 0) window.DUMMY_CLIENTS.splice(idx, 1);
            } catch (delErr) { console.warn('[merge] delete dup fail', d.docId, delErr); }
          }
          msg.textContent = dupes.length > 0
            ? `✓ 紐付け完了 + 重複 ${dupes.length} 件 を 統合しました。`
            : '✓ LINE ID 紐付け完了。 これで LINE 送受信できます。';
          msg.style.color = '#065F46';
          // 顧客一覧 強制 refresh
          try {
            if (window.refreshFirestoreCustomers) await window.refreshFirestoreCustomers();
            if (typeof renderClients === 'function') renderClients();
          } catch (_) {}
          setTimeout(() => { try { openClientModal(cid); } catch (_) {} }, 1500);
        } catch (e) {
          msg.textContent = '✗ 紐付け失敗: ' + (e.message || e);
          msg.style.color = '#B91C1C';
          lineidBtn.disabled = false;
        }
      });
    }

    // ★ AI で返信案 を 1 クリック生成 (textarea に挿入、 編集して送信)
    const aiQuickBtn = document.getElementById('cd-line-ai-quick');
    if (aiQuickBtn) {
      aiQuickBtn.addEventListener('click', async () => {
        const tArea = document.getElementById('cd-line-input');
        const status = document.getElementById('cd-line-msg');
        const origLabel = aiQuickBtn.innerHTML;
        aiQuickBtn.disabled = true;
        aiQuickBtn.innerHTML = '✨ 生成中…';
        if (status) { status.className = 'cd-line-msg-status'; status.textContent = ''; }
        try {
          if (!window.__fp?.functions) throw new Error('functions 未初期化');
          const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
          const fn = httpsCallable(window.__fp.functions, 'generateLineReply');
          // 顧客コンテキスト組み立て
          const ctxParts = [];
          if (c.birth) ctxParts.push(`生年: ${c.birth}`);
          if (c.occupation) ctxParts.push(`職業: ${c.occupation}`);
          if (c.family?.length) ctxParts.push(`家族: ${c.family.map(f => f.rel + ' ' + (f.name||'')).join(' / ')}`);
          if (c.aum) ctxParts.push(`AUM: ¥${(c.aum/10000).toFixed(0)}万`);
          if (c.note) ctxParts.push(`メモ: ${c.note.slice(0,200)}`);
          const result = await fn({
            customerId: c.id,
            customerName: c.name || 'お客様',
            customerContext: ctxParts.join(' / '),
            lineHistory: (c.lineHistory || []).slice(-12),
            hint: (tArea && tArea.value.trim()) || null,  // textarea に何か書いてあれば 意図ヒントとして使う
          });
          const reply = result.data?.reply;
          if (!reply) throw new Error('AI 応答が空です');
          if (tArea) {
            tArea.value = reply;
            tArea.focus();
            tArea.setSelectionRange(reply.length, reply.length);
          }
          if (status) { status.className = 'cd-line-msg-status ok'; status.textContent = '✓ AI 返信案を生成しました (編集して送信してください)'; }
        } catch (e) {
          console.error('[generateLineReply]', e);
          // ★ 残高切れ等 paid API 失敗時 → 簡易プロンプト clipboard コピー + Claude Code 案内
          const msg = String(e.message || e.code || '');
          if (/credit balance|billing|low|api key|not_found_error|401|403|429|insufficient/i.test(msg)) {
            const ctxParts = [];
            if (c.birth) ctxParts.push(`生年: ${c.birth}`);
            if (c.occupation) ctxParts.push(`職業: ${c.occupation}`);
            if (c.family?.length) ctxParts.push(`家族: ${c.family.map(f => f.rel + ' ' + (f.name||'')).join(' / ')}`);
            const hist = (c.lineHistory || []).slice(-12).map(m => `[${m.direction === 'in' ? '客' : 'FP'}] ${m.text}`).join('\n');
            const hintTxt = (tArea && tArea.value.trim()) || '';
            const prompt = `あなたは FP の文章コーチです。下記の LINE やりとり履歴 と 顧客情報 を 踏まえて、 FP から ${c.name || 'お客様'} 様への 自然な LINE 返信を 1通 (200-400字、 文面のみ、 前置き不要) で 作成してください。\n\n【顧客情報】\n${ctxParts.join(' / ')}\n\n【直近 LINE 履歴 (古→新)】\n${hist}\n\n${hintTxt ? `【FP の意図】\n${hintTxt}\n\n` : ''}LINE 文面 のみ 出力してください。`;
            try { await navigator.clipboard.writeText(prompt); } catch (_) {}
            if (status) { status.className = 'cd-line-msg-status err'; status.innerHTML = '⚠ 残高切れ — プロンプトをコピー済。 <a href="https://claude.ai/new" target="_blank" style="color:#4338CA;font-weight:700;">claude.ai で生成 →</a> 戻って textarea に貼付け'; }
          } else {
            if (status) { status.className = 'cd-line-msg-status err'; status.textContent = '生成失敗: ' + msg; }
          }
        } finally {
          aiQuickBtn.disabled = false;
          aiQuickBtn.innerHTML = origLabel;
        }
      });
    }

    // LINE 直接送信 (composer)
    const sendBtn = document.getElementById('cd-line-send');
    const input = document.getElementById('cd-line-input');
    const statusEl = document.getElementById('cd-line-msg');
    const chatEl = document.getElementById('cd-line-chat');
    function appendLocalMessage(text) {
      const ts = new Date();
      const tsStr = ts.getFullYear() + '-' + String(ts.getMonth()+1).padStart(2,'0') + '-' + String(ts.getDate()).padStart(2,'0') + ' ' + String(ts.getHours()).padStart(2,'0') + ':' + String(ts.getMinutes()).padStart(2,'0');
      c.lineHistory = c.lineHistory || [];
      c.lineHistory.push({ direction: 'out', ts: tsStr, text: text, label: 'CRM直接送信' });
      // empty placeholder remove
      const empty = chatEl.querySelector('.cd-line-empty');
      if (empty) empty.remove();
      const div = document.createElement('div');
      div.className = 'cd-line-msg cd-line-out';
      div.innerHTML = `<div class="cd-line-label">CRM直接送信</div><div class="cd-line-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div><div class="cd-line-ts">${tsStr}</div>`;
      chatEl.appendChild(div);
      chatEl.scrollTop = chatEl.scrollHeight;
      // Update stats
      document.getElementById('cd-line-total').textContent = c.lineHistory.length;
      document.getElementById('cd-line-out').textContent = c.lineHistory.filter(m => m.direction === 'out').length;
    }
    if (sendBtn && input) {
      const doSend = async () => {
        const text = input.value.trim();
        if (!text) return;
        const userId = c.lineFriendId;
        if (!userId) {
          statusEl.textContent = '⚠ LINE friend ID 未登録のため送信できません';
          statusEl.style.color = 'var(--critical)';
          return;
        }
        sendBtn.disabled = true;
        const orig = sendBtn.innerHTML;
        sendBtn.innerHTML = '<span>送信中...</span>';
        statusEl.textContent = '';
        try {
          // ★ 旧 GAS 経路 (Cloud Run) → Firebase Cloud Function (sendLineMessage) に 切替
          //   旧: https://fp-compass-webhook-527726449426.../api/line/send (multi-tenant 非対応 + 認証なし + 「不明なエラー」 多発)
          //   新: tenant.line.channelAccessToken を 使って 直 LINE API push
          const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
          const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
          const fbApp = getApps()[0] || initializeApp({
            apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
            authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
            projectId: 'skeleton-fp-compass-632026',
          });
          const fns = getFunctions(fbApp, 'asia-northeast1');
          const fn = httpsCallable(fns, 'sendLineMessage');
          const res = await fn({ customerId: c.id, text, lineFriendId: userId });
          if (res?.data?.ok) {
            statusEl.textContent = '✓ 送信完了';
            statusEl.style.color = 'var(--positive)';
            appendLocalMessage(text);
            input.value = '';
          } else {
            statusEl.textContent = '✕ 送信失敗: 戻り値異常';
            statusEl.style.color = 'var(--critical)';
          }
        } catch (e) {
          // HttpsError は e.message に 親切な文言 (友だち未追加 等) が 入ってる
          statusEl.textContent = '✕ 送信失敗: ' + (e.message || e.code || '不明なエラー');
          statusEl.style.color = 'var(--critical)';
        } finally {
          sendBtn.disabled = false;
          sendBtn.innerHTML = orig;
          if (window.lucide) window.lucide.createIcons();
          setTimeout(() => { statusEl.textContent = ''; }, 6000);
        }
      };
      sendBtn.addEventListener('click', doSend);
      input.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doSend(); }
      });
    }
    // タスクの「LINEで送信」 ボタン
    document.querySelectorAll('.fp-task-do-now').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const msg = btn.dataset.msg;
        if (!uid) { alert('このお客様は LINE 連携が確認できないため、自動送信できません'); return; }
        const finalMsg = prompt('LINEで送るメッセージ (編集可)', msg);
        if (!finalMsg) return;
        btn.disabled = true; btn.textContent = '送信中...';
        try {
          const r = await fetch('https://fp-compass-webhook-527726449426.asia-northeast1.run.app/api/send-line', {
            method: 'POST',
            headers: await (window.getFpAuthHeaders ? window.getFpAuthHeaders() : Promise.resolve({ 'Content-Type': 'application/json' })),
            body: JSON.stringify({ userId: uid, text: finalMsg }),
          });
          const data = await r.json();
          if (data.ok) { btn.textContent = '✓ 送信済'; btn.style.background = '#94a3b8'; }
          else { alert('失敗: ' + (data.error || '')); btn.disabled = false; btn.textContent = '→ LINEで送信'; }
        } catch (e) { alert('失敗: ' + e.message); btn.disabled = false; btn.textContent = '→ LINEで送信'; }
      });
    });
    // ★ 生成済 資料 の「再開 / 削除」 ボタン
    document.querySelectorAll('.fp-deliv-open').forEach(btn => {
      btn.addEventListener('click', () => {
        const clientId = btn.dataset.clientId;
        const target = clients.find(x => String(x.id) === String(clientId)) || c;
        const type = btn.dataset.type || 'custom';
        const title = btn.dataset.title || '';
        openDeliverableDraftModal(target, title, type);
      });
    });
    document.querySelectorAll('.fp-deliv-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.delivKey;
        if (!confirm('この生成済成果物を削除しますか? (元に戻せません)')) return;
        try { localStorage.removeItem(key); } catch (_) {}
        const row = btn.closest('div[style*="background:#fff"]');
        if (row) row.remove();
      });
    });
    // ★ オーナーfb「成果物もJobsが作って一緒に送る + こっちで編集」 ワンクリック導線
    document.querySelectorAll('.fp-task-make-deliv').forEach(btn => {
      btn.addEventListener('click', () => {
        const clientId = btn.dataset.clientId;
        const targetClient = clients.find(x => String(x.id) === String(clientId)) || c;
        const type = btn.dataset.type || 'custom';
        const taskTitle = btn.dataset.task || '';
        openDeliverableDraftModal(targetClient, taskTitle, type);
      });
    });
    // ★ オーナーfb「未着手KPIもタイムラインから操作できるように」
    document.querySelectorAll('.fp-kpi-do').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.kpiAction;
        const kpiName = btn.dataset.kpiName;
        const clientId = btn.dataset.clientId;
        const target = clients.find(x => String(x.id) === String(clientId)) || c;
        const uid = target.lineFriendId;
        // ----- 個別アクション ハンドラ -----
        if (action === 'send-thanks-line') {
          if (!uid) { alert('LINE 連携未完了'); return; }
          const msg = `${target.name}様\n\n本日はお時間いただきありがとうございました。\n\n面談でお話した内容を整理して、次回までに必要な資料を準備してお持ちします。\n\nお忙しいところ恐縮ですが、本日の面談の感想や、追加でご質問あれば このトークから気軽にお聞かせください 🙏`;
          openLineSendModal(target, msg, kpiName);
        } else if (action === 'send-followup-line') {
          if (!uid) { alert('LINE 連携未完了'); return; }
          const msg = `${target.name}様\n\nその後いかがお過ごしでしょうか。\n\n先日お送りした資料、ご家族でご確認いただけましたか?\n\nご不明点や追加のご質問があれば、お気軽にお聞かせください。`;
          openLineSendModal(target, msg, kpiName);
        } else if (action === 'send-reminder-line') {
          if (!uid) { alert('LINE 連携未完了'); return; }
          const msg = `${target.name}様\n\n明日の Zoom 面談のリマインドです。\n\n📅 明日 時間: ●●:●●〜\n🔗 Zoom URL: (本番では予約済URLが自動挿入されます)\n\n変更ありましたらお早めにお知らせください。`;
          openLineSendModal(target, msg, kpiName);
        } else if (action === 'send-survey-line') {
          if (!uid) { alert('LINE 連携未完了'); return; }
          const msg = `${target.name}様\n\n事前アンケート(全5問・3分)のご記入をお願いします:\n\n(本番ではLIFFフォームURLが自動挿入されます)\n\nご記入後、候補日3つを自動でお送りします。`;
          openLineSendModal(target, msg, kpiName);
        } else if (action === 'send-slot-line') {
          if (!uid) { alert('LINE 連携未完了'); return; }
          const msg = `${target.name}様\n\n次回 Zoom 面談の候補日3つです:\n\n📅 候補1: ●月●日 (●) 14:00-15:00\n📅 候補2: ●月●日 (●) 19:00-20:00\n📅 候補3: ●月●日 (●) 10:00-11:00\n\nご都合の良い日時を1つお選びください。タップ確定で Zoom URL + カレンダー登録が自動で完了します。`;
          openLineSendModal(target, msg, kpiName);
        } else if (action === 'open-line-slot') {
          // 公式LINE 候補日3つ送付 (上と同じテンプレ)
          if (!uid) { alert('LINE 連携未完了'); return; }
          const msg = `${target.name}様\n\nご相談ありがとうございます。\n\n初回 Zoom 面談の候補日3つです:\n\n📅 候補1: ●月●日 (●) 14:00-15:00\n📅 候補2: ●月●日 (●) 19:00-20:00\n📅 候補3: ●月●日 (●) 10:00-11:00\n\nご都合の良い日時を1つお選びください。タップ確定で Zoom URL が自動発行されます。`;
          openLineSendModal(target, msg, kpiName);
        } else if (action === 'open-recording-tab') {
          alert('「面談記録・AI議事録」タブで該当 Zoom予約の[● 録画ONでZoom開始]ボタンから開始してください。');
          // タブ自動切替
          const tlTab = document.querySelector('[data-cdtab="aimeeting"]') || document.querySelector('[data-cdtab="meeting"]');
          if (tlTab) tlTab.click();
        } else if (action === 'open-hearing-sheet') {
          if (typeof openHearingSheetModal === 'function') {
            openHearingSheetModal(target);
          } else {
            alert('ヒアリングシート機能はまだ実装されていません');
          }
        } else if (action && action.startsWith('make-deliv-')) {
          const type = action.replace('make-deliv-', '');
          openDeliverableDraftModal(target, kpiName, type);
        }
      });
    });
    const refCopy = document.getElementById('ref-copy-url');
    if (refCopy) {
      refCopy.addEventListener('click', () => {
        const url = `https://line.me/R/ti/p/@511thleq?ref=${c.id}`;
        navigator.clipboard.writeText(url);
        refCopy.textContent = '✓ コピーしました';
        setTimeout(() => { refCopy.textContent = '📋 URLをコピー'; }, 2200);
      });
    }
  }

  // 日付・時刻の堅牢な整形 (Sheets が "1899-12-30T18:00:00.000Z" 形式で返す time セル対策)
  function fmtTimeRobust(raw) {
    if (!raw) return '';
    const s = String(raw);
    const isoMatch = s.match(/T(\d{1,2}):(\d{2})/);
    if (isoMatch) return isoMatch[1].padStart(2, '0') + ':' + isoMatch[2];
    const hmMatch = s.match(/^(\d{1,2}):(\d{2})/);
    if (hmMatch) return hmMatch[1].padStart(2, '0') + ':' + hmMatch[2];
    return '';
  }
  function fmtDateRobust(raw) {
    if (!raw) return '';
    const s = String(raw);
    // ★ オーナーfb 2026-06-23: 「T...」 を含む 全 ISO 文字列 (Z 有無問わず) は JST に 変換 (1日ずれ防止)
    if (s.includes('T') && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      }
    }
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  // ★ オーナーfb 2026-06-23: 録画開始時刻 (Zoom開始 = ai.ts/createdAt) を HH:MM JST で表示
  function fmtJstTime(raw) {
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  }

  // ============================
  // 面談記録ブロック (顧客詳細モーダル内 / 録画URL + メモ + タスク)
  // ============================
  // ============================
  // 👨‍👩‍👧‍👦 家系図 ブロック (議事録 から AI 自動抽出 + 編集可)
  // ============================
  // ============================
  // ★ Phase 2 (オーナーfb 2026-06-24): Q&A タブ — LINE 質問 自動分類 + 予測
  // 開いた時に Claude Haiku で 分類 → 顧客 ごとの Q&A サマリ表示
  // ============================
  async function loadQATabForClient(client) {
    const root = document.getElementById('cd-qa-content');
    if (!root) return;
    if (root.dataset.loaded === '1' && !root.dataset.refresh) return; // 一度ロードしたら 再分析ボタン以外 再実行しない
    const lh = (client.lineHistory || []).filter(m => (m.from === 'user' || m.direction === 'in') && m.text);
    if (lh.length === 0) {
      root.innerHTML = '<div style="padding:32px 24px;text-align:center;color:#94A3B8;font-size:13px;">LINE 履歴 が ないので Q&A 分析 できません</div>';
      const tabBadge = document.getElementById('cd-qa-count');
      if (tabBadge) tabBadge.textContent = '0';
      return;
    }
    root.innerHTML = `<div style="padding:32px 24px;text-align:center;color:#94A3B8;font-size:13px;">
      <div style="font-size:24px;margin-bottom:8px;">🔍</div>
      Q&A 分析中 (AI が ${lh.length} 件の メッセージ を 分類しています…)
    </div>`;
    try {
      const ctx = (function(){
        const parts = [];
        if (client.age) parts.push(client.age + '歳');
        if (client.occupation) parts.push(client.occupation);
        if (client.aum) parts.push('AUM¥' + (client.aum/10000) + '万');
        return parts.join(' / ');
      })();
      const messages = lh.slice(-50).map(m => ({
        text: m.text || '',
        ts: m.ts || m.date || '',
      }));
      const r = await fetch('https://fp-compass-webhook-527726449426.asia-northeast1.run.app/api/classify-questions', {
        method: 'POST', headers: await (window.getFpAuthHeaders ? window.getFpAuthHeaders() : Promise.resolve({ 'Content-Type': 'application/json' })),
        body: JSON.stringify({
          messages, customerName: client.name,
          customerContext: ctx,
          tenantId: (window.__fp && window.__fp.tenantId) || '',
          userId: client.lineFriendId || client.id || '',
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        root.innerHTML = `<div style="padding:24px;color:#B91C1C;font-size:13px;">分析失敗: ${escapeHtml(data.error || '')}</div>`;
        return;
      }
      renderQAContent(root, data, client);
      root.dataset.loaded = '1';
      delete root.dataset.refresh;
      const tabBadge = document.getElementById('cd-qa-count');
      if (tabBadge) tabBadge.textContent = String(data.totalQuestions || 0);
    } catch (e) {
      root.innerHTML = `<div style="padding:24px;color:#B91C1C;font-size:13px;">分析 例外: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }
  function renderQAContent(root, data, client) {
    const cats = data.categories || [];
    const pred = data.predictedNext || data.predicted_next_questions || [];
    const catColor = {
      'NISA・iDeCo': '#5B5BF0',
      '教育資金': '#06b6d4',
      '住宅ローン': '#f59e0b',
      '老後資金': '#8b5cf6',
      '保険': '#ec4899',
      '相続・贈与': '#10b981',
      '税金': '#dc2626',
      'その他': '#64748b',
    };
    const html = `
      <div style="padding:18px 16px 80px;">
        <!-- summary header -->
        <div style="margin-bottom:18px;padding:14px 16px;background:linear-gradient(135deg,#FBF5E3,#FFFBF1);border:1px solid #E8D9A8;border-left:4px solid #C19A3A;border-radius:8px;">
          <div style="font-size:11px;font-weight:800;color:#8B7D5D;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:4px;">Q&A 自動分析</div>
          <div style="font-size:17px;font-weight:800;color:#1F2A3F;">${data.totalQuestions || 0} 件の質問</div>
          ${data.topCategories && data.topCategories.length > 0 ? `<div style="font-size:12px;color:#5e4d1a;margin-top:4px;">頻出: ${data.topCategories.slice(0,3).map(c => escapeHtml(c)).join(' · ')}</div>` : ''}
          <button id="cd-qa-refresh" style="margin-top:10px;background:#fff;color:#8B6F26;border:1px solid #C19A3A;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">🔄 再分析</button>
        </div>

        <!-- predicted next questions -->
        ${pred.length > 0 ? `
        <div style="margin-bottom:18px;padding:14px 16px;background:#F8FAFC;border:1px solid #CBD5E1;border-left:4px solid #5B5BF0;border-radius:8px;">
          <div style="font-size:11px;font-weight:800;color:#5B5BF0;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:8px;">🔮 次に 聞かれそうな 質問</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#1F2A3F;line-height:1.85;">
            ${pred.slice(0, 6).map(q => `<li style="margin-bottom:4px;">${escapeHtml(q)}</li>`).join('')}
          </ul>
          <div style="font-size:10.5px;color:#64748B;margin-top:8px;line-height:1.55;">↑ AI が お客様の 質問パターン から 予測。 次回 面談の 事前準備 や 先回り LINE 返信 に。</div>
        </div>
        ` : ''}

        <!-- categorized questions -->
        ${cats.length === 0 ? '<div style="padding:24px;text-align:center;color:#94A3B8;font-size:13px;">分類対象の 質問 が 抽出できませんでした (会話が短い or 質問でない)</div>' : ''}
        ${cats.map(cat => {
          const color = catColor[cat.name] || '#64748B';
          const qs = cat.questions || [];
          return `
          <div style="margin-bottom:14px;background:#fff;border:1px solid #E2E8F0;border-left:4px solid ${color};border-radius:8px;overflow:hidden;">
            <div style="padding:11px 14px;background:${color}08;display:flex;align-items:center;justify-content:space-between;">
              <div style="font-size:13px;font-weight:800;color:#1F2A3F;">${escapeHtml(cat.name)}</div>
              <div style="font-size:11px;font-weight:800;color:${color};background:${color}1F;padding:2px 9px;border-radius:99px;letter-spacing:0.04em;">${cat.count || qs.length} 件</div>
            </div>
            <div style="padding:10px 14px;">
              ${qs.slice(0, 8).map(q => `
                <div style="padding:7px 0;border-bottom:1px solid #F1F5F9;font-size:12.5px;color:#334155;line-height:1.65;">
                  <span style="color:${color};font-weight:700;margin-right:4px;">Q.</span>
                  ${escapeHtml(q.q || q)}
                  ${q.ts ? `<span style="font-size:10px;color:#94A3B8;margin-left:6px;">${escapeHtml(String(q.ts).slice(0,10))}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`;
    root.innerHTML = html;
    document.getElementById('cd-qa-refresh')?.addEventListener('click', () => {
      root.dataset.refresh = '1';
      delete root.dataset.loaded;
      loadQATabForClient(client);
    });
  }

  function renderFamilyTreeBlock(client) {
    const fam = Array.isArray(client.family) ? client.family : [];
    // 関係 → ラベル + 色 (細分化 13→34区分: 父/母別、 長男/長女/次男/次女別、 兄/姉/弟/妹別)
    // legacy rel (parent/child/sibling/grandparent/parent_in_law/uncle/child_in_law/nephew/grandchild) も 後方互換
    const relMeta = {
      self:            { label: '本人',         color: '#5B5BF0' },
      // 祖父母世代
      grandfather_p:   { label: '祖父(父方)',   color: '#7C3AED' },
      grandmother_p:   { label: '祖母(父方)',   color: '#7C3AED' },
      grandfather_m:   { label: '祖父(母方)',   color: '#7C3AED' },
      grandmother_m:   { label: '祖母(母方)',   color: '#7C3AED' },
      grandparent:     { label: '祖父母',       color: '#7C3AED' },  // legacy
      // 親世代
      father:          { label: '父',           color: '#A855F7' },
      mother:          { label: '母',           color: '#A855F7' },
      parent:          { label: '親',           color: '#A855F7' },  // legacy
      father_in_law:   { label: '義父',         color: '#C084FC' },
      mother_in_law:   { label: '義母',         color: '#C084FC' },
      parent_in_law:   { label: '義父母',       color: '#C084FC' },  // legacy
      uncle_p:         { label: 'おじ(父方)',   color: '#D8B4FE' },
      aunt_p:          { label: 'おば(父方)',   color: '#D8B4FE' },
      uncle_m:         { label: 'おじ(母方)',   color: '#D8B4FE' },
      aunt_m:          { label: 'おば(母方)',   color: '#D8B4FE' },
      uncle:           { label: 'おじ・おば',   color: '#D8B4FE' },  // legacy
      // 本人世代
      spouse:          { label: '配偶者',       color: '#EF4444' },
      elder_brother:   { label: '兄',           color: '#84CC16' },
      elder_sister:    { label: '姉',           color: '#84CC16' },
      younger_brother: { label: '弟',           color: '#84CC16' },
      younger_sister:  { label: '妹',           color: '#84CC16' },
      sibling:         { label: 'ご兄弟',       color: '#84CC16' },  // legacy
      brother_in_law:  { label: '義兄弟',       color: '#A3E635' },
      sister_in_law:   { label: '義姉妹',       color: '#A3E635' },
      sibling_in_law:  { label: '義兄弟姉妹',   color: '#A3E635' },  // legacy
      cousin:          { label: 'いとこ',       color: '#22C55E' },
      // 子世代
      son_1st:         { label: '長男',         color: '#EA580C' },
      daughter_1st:    { label: '長女',         color: '#EA580C' },
      son_2nd:         { label: '次男',         color: '#EA580C' },
      daughter_2nd:    { label: '次女',         color: '#EA580C' },
      son_3rd:         { label: '三男',         color: '#EA580C' },
      daughter_3rd:    { label: '三女',         color: '#EA580C' },
      child_other:     { label: 'お子様',       color: '#EA580C' },
      child:           { label: 'お子様',       color: '#06B6D4' },  // legacy
      child_in_law:    { label: '子の配偶者',   color: '#FB923C' },
      nephew:          { label: '甥',           color: '#0EA5E9' },
      niece:           { label: '姪',           color: '#0EA5E9' },
      // 孫世代
      grandson:        { label: '孫(男)',       color: '#F59E0B' },
      granddaughter:   { label: '孫(女)',       color: '#F59E0B' },
      grandchild:      { label: 'お孫さん',     color: '#F59E0B' },  // legacy
      other:           { label: 'その他',       color: '#6B7280' },
    };
    // 世代マップ: gen1=祖父母 / gen2=親 / gen3=本人 / gen4=子 / gen5=孫 / other
    const GEN_OF = {
      grandfather_p:'gen1', grandmother_p:'gen1', grandfather_m:'gen1', grandmother_m:'gen1', grandparent:'gen1',
      father:'gen2', mother:'gen2', parent:'gen2', father_in_law:'gen2', mother_in_law:'gen2', parent_in_law:'gen2',
      uncle_p:'gen2', aunt_p:'gen2', uncle_m:'gen2', aunt_m:'gen2', uncle:'gen2',
      spouse:'gen3', elder_brother:'gen3', elder_sister:'gen3', younger_brother:'gen3', younger_sister:'gen3', sibling:'gen3',
      brother_in_law:'gen3', sister_in_law:'gen3', sibling_in_law:'gen3', cousin:'gen3',
      son_1st:'gen4', daughter_1st:'gen4', son_2nd:'gen4', daughter_2nd:'gen4', son_3rd:'gen4', daughter_3rd:'gen4',
      child_other:'gen4', child:'gen4', child_in_law:'gen4', nephew:'gen4', niece:'gen4',
      grandson:'gen5', granddaughter:'gen5', grandchild:'gen5',
      other:'other',
    };
    const GEN_DEF = {
      gen1: { label: '祖父母世代', color: '#7C3AED', bg: '#FAF5FF' },
      gen2: { label: '親世代',     color: '#A855F7', bg: '#FAF5FF' },
      gen3: { label: '本人世代',   color: '#0D9488', bg: '#F0FDFA' },
      gen4: { label: '子世代',     color: '#EA580C', bg: '#FFF7ED' },
      gen5: { label: '孫世代',     color: '#F59E0B', bg: '#FFFBEB' },
      other:{ label: 'その他',     color: '#6B7280', bg: '#F8FAFC' },
    };
    const age = (birth) => {
      if (!birth) return null;
      const b = new Date(birth);
      if (isNaN(b.getTime())) return null;
      const now = new Date();
      let a = now.getFullYear() - b.getFullYear();
      const m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
      return a;
    };
    // ★ 木構造表示: 世代ごとに 横並び (gen1 祖父母 → gen2 親 → gen3 本人+配偶者+兄弟 → gen4 子 → gen5 孫)
    // 関係を 世代 でグループ化
    const byGen = { gen1: [], gen2: [], gen3: [], gen4: [], gen5: [], other: [] };
    fam.forEach((m, idx) => {
      const r = (m.rel || 'other').toLowerCase();
      const gen = GEN_OF[r] || 'other';
      byGen[gen].push({ ...m, _idx: idx, _meta: relMeta[r] || relMeta.other });
    });
    // 各世代内 の 並び順 (兄→姉→弟→妹、 長男→長女→次男→次女 等 自然な順)
    const REL_ORDER = [
      'grandfather_p','grandmother_p','grandfather_m','grandmother_m','grandparent',
      'father','mother','parent','father_in_law','mother_in_law','parent_in_law',
      'uncle_p','aunt_p','uncle_m','aunt_m','uncle',
      'spouse','elder_brother','elder_sister','younger_brother','younger_sister','sibling',
      'brother_in_law','sister_in_law','sibling_in_law','cousin',
      'son_1st','daughter_1st','son_2nd','daughter_2nd','son_3rd','daughter_3rd','child_other','child',
      'child_in_law','nephew','niece',
      'grandson','granddaughter','grandchild','other',
    ];
    Object.keys(byGen).forEach(g => {
      byGen[g].sort((a, b) => REL_ORDER.indexOf(a.rel) - REL_ORDER.indexOf(b.rel));
    });
    const cardHtml = (m, meta, isSelf) => {
      const color = isSelf ? '#5B5BF0' : meta.color;
      return `<div class="fp-fam-card" data-fam-idx="${isSelf ? 'self' : m._idx}" style="background:${color}10;border:2px solid ${color};cursor:${isSelf?'default':'pointer'};">
        <div class="fp-fam-rel" style="color:${color};">${isSelf ? '👤 本人' : meta.label}</div>
        <div class="fp-fam-name">${escapeHtml(isSelf ? (client.name || 'お客様') : (m.name || '(未設定)'))}</div>
        <div class="fp-fam-age">${age(isSelf ? client.birth : m.birth) ?? '?'}歳${(isSelf ? client.occupation : m.note) ? ' / ' + escapeHtml(String(isSelf ? client.occupation : m.note)).slice(0,20) : ''}</div>
        ${isSelf ? '' : `<button class="fp-fam-edit" data-fam-edit-idx="${m._idx}" title="編集">✏</button>`}
      </div>`;
    };
    const renderGenRow = (genKey, customSelfInsert) => {
      const list = byGen[genKey] || [];
      if (list.length === 0 && !customSelfInsert) return '';
      const def = GEN_DEF[genKey];
      const cards = list.map(m => cardHtml(m, m._meta)).join('');
      const selfCardHtml = customSelfInsert ? cardHtml(null, null, true) : '';
      return `<div class="fp-fam-gen-row" style="background:${def.bg};border-left:4px solid ${def.color};">
        <div class="fp-fam-gen-label" style="color:${def.color};">${def.label}</div>
        <div class="fp-fam-gen-cards">${customSelfInsert
          ? [...list.filter(m => m.rel === 'elder_brother' || m.rel === 'elder_sister'),
             { _self: true }].filter(Boolean).map(x => x._self ? selfCardHtml : cardHtml(x, x._meta)).join('') +
            list.filter(m => m.rel === 'spouse').map(m => cardHtml(m, m._meta)).join('') +
            list.filter(m => !['elder_brother','elder_sister','spouse'].includes(m.rel)).map(m => cardHtml(m, m._meta)).join('')
          : cards}</div>
      </div>`;
    };
    return `
      <div class="detail-section">
        <h3>👨‍👩‍👧‍👦 家系図 <span class="count-badge">${fam.length + 1}名</span></h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
          <button id="fp-fam-ai" data-client-id="${escapeHtml(client.id)}" style="background:#5B5BF0;color:#fff;border:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;">✨ 議事録から自動</button>
          <button id="fp-fam-add" data-client-id="${escapeHtml(client.id)}" style="background:#fff;border:1.5px solid #CBD5E1;color:#475569;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">＋ 追加</button>
        </div>
        <div id="fp-fam-msg" style="font-size:11.5px;font-weight:700;margin-bottom:10px;"></div>
        <style>
          /* 家計図 — 世代縦積み + カード型 + SVG接続線風CSS */
          .fp-fam-tree{display:flex;flex-direction:column;gap:0;font-family:'Noto Sans JP',sans-serif;}
          .fp-fam-gen-row{position:relative;padding:16px 18px 18px;border-radius:12px;margin-bottom:0;}
          .fp-fam-gen-row + .fp-fam-gen-row{margin-top:2px;}
          .fp-fam-gen-row::before{content:'';display:block;width:2px;height:20px;background:linear-gradient(180deg,#CBD5E1,#94A3B8);margin:0 auto -2px;position:relative;left:0;}
          .fp-fam-gen-row:first-child::before{display:none;}
          .fp-fam-gen-label{font-size:10px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:6px;}
          .fp-fam-gen-label::after{content:'';flex:1;height:1px;background:#E2E8F0;}
          .fp-fam-gen-cards{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;position:relative;}
          .fp-fam-gen-cards::before{content:'';position:absolute;left:50%;top:-16px;width:2px;height:16px;background:#CBD5E1;display:none;}
          .fp-fam-card{position:relative;min-width:140px;padding:13px 16px 11px;border-radius:12px;font-family:'Noto Sans JP',sans-serif;transition:transform 0.15s ease,box-shadow 0.15s ease;}
          .fp-fam-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,0.12);}
          .fp-fam-card .fp-fam-rel{font-size:10px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:4px;}
          .fp-fam-card .fp-fam-name{font-size:15.5px;font-weight:900;color:#0F172A;margin-bottom:4px;line-height:1.3;letter-spacing:-0.01em;}
          .fp-fam-card .fp-fam-age{font-size:12px;color:#475569;line-height:1.4;font-weight:600;}
          .fp-fam-card .fp-fam-edit{position:absolute;top:8px;right:8px;background:rgba(255,255,255,0.85);border:1px solid rgba(0,0,0,0.1);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px;padding:0;}
          .fp-fam-card .fp-fam-edit:hover{background:#fff;border-color:rgba(0,0,0,0.22);}
        </style>
        <div class="fp-fam-tree">
          ${renderGenRow('gen1')}
          ${renderGenRow('gen2')}
          ${renderGenRow('gen3', true)}
          ${renderGenRow('gen4')}
          ${renderGenRow('gen5')}
          ${byGen.other.length > 0 ? renderGenRow('other') : ''}
        </div>
        ${fam.length === 0 ? '<div style="padding:24px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px;text-align:center;color:#64748B;font-size:12.5px;margin-top:10px;">まだ家族情報が登録されていません。<br>「✨ 議事録から自動」 で 過去の Zoom 議事録 から 自動 で 家族構成 を 取り込めます。</div>' : ''}
      </div>`;
  }
  function renderMeetingRecordsBlock(client) {
    // この顧客に関連する bookings を liveData から探す
    const liveBookings = (window.LineAppLiveData && window.LineAppLiveData.bookings) || [];
    // ★ multi-tenant Firestore 確定済 顧客 を bookings 同等 で 追加
    //   (legacy のみ だと 「お」 等 Firestore 顧客 は myBookings 0件 → 早期 return → 面談記録 セクション 出ない)
    const fsMyBookings = (window._fpFirestoreConfirmed || [])
      .filter(c => c.docId === client._fsCustomerId
                  || (c.lineFriendId && c.lineFriendId === client.lineFriendId)
                  || (c.name && c.name === client.name))
      .map(c => ({
        ts: c.confirmedAt?.toDate?.()?.toISOString?.() || '',
        date: String(c.confirmedSlot || '').split(' ')[0] || '',
        time: String(c.confirmedSlot || '').split(' ')[1] || '',
        name: c.name,
        userId: c.lineFriendId || ('fs:' + c.docId),
        zoomUrl: c.zoomUrl,
        zoomMeetingId: c.zoomMeetingId || '',
      }));
    // ★ 顧客doc 直接の zoomMeetingId/zoomUrl (instantZoom 後の最新値 が _fpFirestoreConfirmed sync より早い場合の救済)
    if (client.zoomMeetingId || client.zoomUrl) {
      const exists = fsMyBookings.some(b => b.zoomMeetingId === client.zoomMeetingId);
      if (!exists) {
        fsMyBookings.push({
          ts: '', date: String(client.confirmedSlot||'').split(' ')[0] || '',
          time: String(client.confirmedSlot||'').split(' ')[1] || '',
          name: client.name, userId: client.lineFriendId,
          zoomUrl: client.zoomUrl, zoomMeetingId: client.zoomMeetingId || '',
        });
      }
    }
    const myBookings = liveBookings.filter(b => b.userId === client.lineFriendId || b.name === client.name).concat(fsMyBookings);

    // localStorage から この顧客のメモ + タスクを取得
    // タスクも localStorage + GAS の両方から集約
    const taskKeys = new Set();
    if (client.lineFriendId) taskKeys.add('fp-tasks-' + client.lineFriendId);
    if (client.id)           taskKeys.add('fp-tasks-' + client.id);
    if (client.name)         taskKeys.add('fp-tasks-' + client.name);
    myBookings.forEach(b => {
      if (b.userId) taskKeys.add('fp-tasks-' + b.userId);
      if (b.ts)     taskKeys.add('fp-tasks-' + b.ts);
      if (b.name)   taskKeys.add('fp-tasks-' + b.name);
    });
    let tasks = [];
    taskKeys.forEach(k => {
      try { tasks = tasks.concat(JSON.parse(localStorage.getItem(k) || '[]')); } catch (_) {}
    });
    // GAS 永続化シートからも
    const liveTasks = (window.LineAppLiveData && window.LineAppLiveData.ai_tasks) || [];
    liveTasks.forEach(t => {
      // ★ genericFallback 撤去 — 厳密一致のみ
      const match = (t.userId && t.userId === client.lineFriendId) ||
                    (t.customerName && t.customerName === client.name) ||
                    myBookings.some(b => b.ts === t.bookingTs || b.userId === t.userId);
      if (!match) return;
      tasks.push({
        task: t.task, due: t.due, priority: t.priority, icon: t.icon,
        recommendedAction: t.recommendedAction, actionTemplate: t.actionTemplate,
        bookingTs: t.bookingTs, customerName: t.customerName,
      });
    });
    // 重複排除 (task+bookingTs 単位)
    const seenTask = new Set();
    tasks = tasks.filter(t => {
      const k = (t.bookingTs || '') + '|' + (t.task || '');
      if (seenTask.has(k)) return false;
      seenTask.add(k);
      return true;
    });
    // 各 booking ごとにメモを取得
    const bookingsWithMemo = myBookings.map(b => {
      const memo = localStorage.getItem('fp-memo-' + b.ts) || '';
      return { ...b, memo };
    });

    // ★ 2026-06-27: bookings+tasks 0件 でも ai_results あれば render (新規顧客の orphan 議事録 反映漏れ fix)
    const liveAiCheck = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
    const hasAnyAi = liveAiCheck.some(r => {
      const rUid = String(r.userId || '');
      const rName = String(r.customerName || '').replace(/様/g, '').replace(/[\s　]/g, '').toLowerCase();
      const cId = String(client.id || '');
      const cLfid = String(client.lineFriendId || '');
      const cName = String(client.name || '').replace(/様/g, '').replace(/[\s　]/g, '').toLowerCase();
      return (rUid && cId && rUid === cId) ||
             (rUid && cLfid && rUid === cLfid) ||
             (rName && cName && rName === cName);
    });
    if (bookingsWithMemo.length === 0 && tasks.length === 0 && !hasAnyAi) return ''; // 全部ゼロの時のみ skip

    // AI 議事録データ (localStorage + GAS 永続化シートの両方から集約)
    const aiCandidateKeys = new Set();
    if (client.lineFriendId) aiCandidateKeys.add('fp-ai-' + client.lineFriendId);
    if (client.id)           aiCandidateKeys.add('fp-ai-' + client.id);
    if (client.name)         aiCandidateKeys.add('fp-ai-' + client.name);
    myBookings.forEach(b => {
      if (b.userId) aiCandidateKeys.add('fp-ai-' + b.userId);
      if (b.ts)     aiCandidateKeys.add('fp-ai-' + b.ts);
      if (b.name)   aiCandidateKeys.add('fp-ai-' + b.name);
    });
    let aiResults = [];
    aiCandidateKeys.forEach(k => {
      try { aiResults = aiResults.concat(JSON.parse(localStorage.getItem(k) || '[]')); } catch (_) {}
    });
    // 全 localStorage の fp-ai-* を走査し、エントリ内 userId / customerName / bookingTs が
    // この顧客にマッチするものを吸収 (キー名が予期せぬ形式でも救済)
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith('fp-ai-'));
    const myUids = new Set([client.lineFriendId].concat(myBookings.map(b => b.userId).filter(Boolean)));
    const myTs = new Set(myBookings.map(b => b.ts).filter(Boolean));
    const myNames = new Set([client.name].concat(myBookings.map(b => b.name).filter(Boolean)));
    // 「fp-ai-お客様」 等の汎用 fallback キー → 録画時に客を特定できなかった分。
    // ★ 旧仕様: LINE 連携客なら無条件で吸収 → A様の議事録が全員に表示される 重大データ漏れ
    // ★ 新仕様: userId / bookingTs / customerName のいずれか strict 一致のみ吸収 (= 紐付け失敗時は表示しない)
    allKeys.forEach(k => {
      if (aiCandidateKeys.has(k)) return;  // 既出
      try {
        const arr = JSON.parse(localStorage.getItem(k) || '[]');
        arr.forEach(a => {
          const matchUser = a.userId       && myUids.has(a.userId);
          const matchTs   = a.bookingTs    && myTs.has(a.bookingTs);
          const matchName = a.customerName && a.customerName !== 'お客様' && myNames.has(a.customerName);
          if (matchUser || matchTs || matchName) {
            aiResults.push(a);
          }
        });
      } catch (_) {}
    });
    // GAS 永続化シートからも取得 (別ブラウザで保存された分)
    const liveAiResults = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
    // ★ 全 myBookings から zoomMeetingId set
    const myMeetingIds = new Set(myBookings.map(b => String(b.zoomMeetingId || '')).filter(Boolean));
    if (client.zoomMeetingId) myMeetingIds.add(String(client.zoomMeetingId));
    // ★ オーナーfb 2026-06-26: lookup を broadly 化 (新規顧客/アンケート客 で モーダルに 反映されない 退化 fix)
    //   match パターン: (1) lineFriendId 一致 / (2) Firestore docId 一致 / (3) docId プレフィクス 含む (quick-*) /
    //                  (4) 名前正規化 一致 (様/空白吸収) / (5) booking ts/userId 一致 / (6) zoomMeetingId
    const normName = (n) => String(n || '').replace(/様/g, '').replace(/[\s　]/g, '').toLowerCase().trim();
    const cNameNorm = normName(client.name);
    const cId = String(client.id || '');
    const cLfid = String(client.lineFriendId || '');
    liveAiResults.forEach(r => {
      const rZoomMid = String(r.zoomMeetingId || r.meetingId || '');
      const rUid = String(r.userId || '');
      const rNameNorm = normName(r.customerName);
      const match = (
        (rUid && cLfid && rUid === cLfid) ||
        (rUid && cId && rUid === cId) ||
        (rUid && cId && rUid.indexOf(cId) >= 0) ||
        (rUid && cLfid && rUid.indexOf(cLfid) >= 0) ||
        (rNameNorm && cNameNorm && rNameNorm === cNameNorm && rNameNorm !== 'お客様' && rNameNorm !== '') ||
        myBookings.some(b => (b.ts && b.ts === r.bookingTs) || (b.userId && rUid && b.userId === rUid)) ||
        (rZoomMid && myMeetingIds.has(rZoomMid))
      );
      if (!match) return;
      // key_concerns は文字列で来てるので JSON.parse
      let kc = r.key_concerns;
      if (typeof kc === 'string') { try { kc = JSON.parse(kc); } catch (_) { kc = []; } }
      // bookingTs 空なら myBookings の最新 ts で補完 (orphan filter を通すため)
      let bookingTs = r.bookingTs;
      if (!bookingTs && myBookings.length > 0) {
        const latest = myBookings.slice().sort((a,b) => String(b.ts).localeCompare(String(a.ts)))[0];
        bookingTs = (latest && latest.ts) || ('gas-' + (r.ts || r.createdAt || Date.now()));
      }
      if (!bookingTs) bookingTs = 'gas-' + (r.ts || r.createdAt || Date.now());
      // 2026-07-02 persist-fix: 録音日 fallback を強化。
      //   r.date / r.ts / r.createdAt が空でも、 bookingTs から 「gas-<ISO>」 系の日付を拾い、
      //   最終的に 現在日 まで fallback して 「日付未定」バケット行きを回避。
      const _pickIsoDay = (v) => {
        if (!v) return '';
        const s = String(v);
        const m = s.match(/(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : '';
      };
      const rDate = r.date || _pickIsoDay(r.ts) || _pickIsoDay(r.createdAt) || _pickIsoDay(bookingTs) || new Date().toISOString().slice(0,10);
      aiResults.push({
        bookingTs,
        ts: r.ts || r.createdAt || '', // ★ 録画時刻 を 保持 (dedup/orphan filter用)
        createdAt: r.createdAt || r.ts || '',
        userId: r.userId || client.lineFriendId,
        customerName: r.customerName || client.name,
        date: rDate,
        transcript: r.transcript || '',
        summary: r.summary || '',
        transcript_summary: r.transcript_summary || '',
        key_concerns: kc || [],
        next_meeting_suggestion: r.next_meeting_suggestion || '',
      });
    });
    // ★ 救済 lookup: customerName='お客様' / userId 空 の orphan ai_result を
    //   client.confirmedSlot ± 6h以内 の time-window マッチ で 救済表示
    //   (旧 ver で booking lookup 失敗時 'お客様' default で 保存された 議事録 を 救済)
    //   退化リスク: 同FP同時刻 別顧客 確定時の 混入 → multi-tenant SaaS 性質上 低リスク + dedupe seenTs で重複弾く
    if (client.confirmedSlot) {
      const confirmedMs = new Date(String(client.confirmedSlot).replace(' ', 'T')).getTime();
      if (!isNaN(confirmedMs)) {
        liveAiResults.forEach(r => {
          const noName = !r.customerName || r.customerName === 'お客様';
          const noUid = !r.userId;
          if (!(noName && noUid)) return; // 完全orphan のみ救済対象
          const rTsStr = r.ts || r.createdAt || r.bookingTs;
          if (!rTsStr) return;
          const rMs = new Date(String(rTsStr).replace(' ', 'T')).getTime();
          if (isNaN(rMs)) return;
          if (Math.abs(rMs - confirmedMs) > 6 * 60 * 60 * 1000) return; // ±6h
          let kc = r.key_concerns;
          if (typeof kc === 'string') { try { kc = JSON.parse(kc); } catch (_) { kc = []; } }
          // ★ 救済議事録 の bookingTs を 該当 booking (= 同じ confirmedSlot の myBookings entry) の ts に揃える
          //   → 上のMEETING RECORD カードに 直接 表示 → 議事録 だけの「録画ベース」 別カードが 出ない (1枚統合)
          const matchedBk = myBookings.find(b => {
            const bDt = String(b.date || '') + 'T' + String(b.time || '00:00');
            const bMs = new Date(bDt).getTime();
            return !isNaN(bMs) && Math.abs(bMs - confirmedMs) < 60 * 60 * 1000;
          });
          const rescueBookingTs = (matchedBk && matchedBk.ts) || r.bookingTs || ('rescue-' + rTsStr);
          aiResults.push({
            bookingTs: rescueBookingTs,
            ts: r.ts || r.createdAt || rTsStr, // ★ 録画時刻 を 保持 (dedup/orphan filter用)
            createdAt: r.createdAt || r.ts || rTsStr,
            userId: client.lineFriendId,
            customerName: client.name,
            date: r.date || String(rTsStr).slice(0,10),
            transcript: r.transcript || '',
            summary: r.summary || '',
            transcript_summary: r.transcript_summary || '',
            key_concerns: kc || [],
            next_meeting_suggestion: r.next_meeting_suggestion || '',
            rescued: true,
          });
        });
      }
    }
    // ★ 同 bookingTs+録画時刻ts で 区別 (同 confirmedSlot で 複数録画 した時 別entry として 残す)
    //   旧コード: bookingTs だけで dedup → 同 confirmedSlot の2回目 録画 が 消えてた
    const seenTs = new Set();
    aiResults = aiResults.filter(a => {
      const key = (a.bookingTs || '') + '|' + (a.ts || a.createdAt || '');
      if (seenTs.has(key)) return false;
      seenTs.add(key);
      return true;
    });

    return `
      <div class="detail-section">
        <h3>面談記録・AI議事録 <span class="count-badge">${bookingsWithMemo.length} 回</span></h3>
        ${window.FP_DEBUG ? `
        <details style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-family:Menlo,monospace;font-size:11px;">
          <summary style="cursor:pointer;color:#475569;font-weight:700;font-family:inherit;">🔧 デバッグ (AI議事録 lookup)</summary>
          <div style="margin-top:10px;line-height:1.7;color:#334155;">
            <div><strong>client.lineFriendId:</strong> ${escapeHtml(client.lineFriendId || '(空)')}</div>
            <div><strong>client.name:</strong> ${escapeHtml(client.name || '')}</div>
            <div><strong>myBookings:</strong> ${myBookings.length} 件</div>
            ${myBookings.slice(0,5).map((b,i) => `<div style="padding-left:12px;color:#64748b;">[${i}] ts=${escapeHtml(String(b.ts||'').slice(0,19))} userId=${escapeHtml(b.userId||'')} name=${escapeHtml(b.name||'')}</div>`).join('')}
            <div style="margin-top:6px;"><strong>lookup したキー (${aiCandidateKeys.size}):</strong></div>
            ${[...aiCandidateKeys].map(k => `<div style="padding-left:12px;color:${localStorage.getItem(k) ? '#16a34a' : '#94a3b8'};">${localStorage.getItem(k) ? '✓ ' : '× '}${escapeHtml(k)} (${(JSON.parse(localStorage.getItem(k)||'[]')).length}件)</div>`).join('')}
            <div style="margin-top:6px;"><strong>localStorage に実在する fp-ai-* キー全部 (${allKeys.length}):</strong></div>
            ${allKeys.map(k => {
              const arr = JSON.parse(localStorage.getItem(k)||'[]');
              return `<div style="padding-left:12px;color:#0f172a;margin-top:4px;">
                <strong>${escapeHtml(k)} (${arr.length}件)</strong>
                ${arr.map((a, i) => `<div style="padding-left:14px;color:#475569;border-left:2px solid #cbd5e1;margin:2px 0;">
                  [${i}] userId=<code>${escapeHtml(a.userId || '(空)')}</code> customerName=<code>${escapeHtml(a.customerName || '(空)')}</code> bookingTs=<code>${escapeHtml(String(a.bookingTs || '').slice(0,19))}</code> summary=<code>${escapeHtml(String(a.summary || '').slice(0,40))}...</code>
                </div>`).join('')}
              </div>`;
            }).join('') || '<div style="padding-left:12px;color:#dc2626;">(無し — 録画/AI処理が走ってないか保存失敗)</div>'}
            <div style="margin-top:6px;"><strong>救済lookup 結果:</strong> aiResults ${aiResults.length}件</div>
            ${aiResults.slice(0,3).map((a,i) => `<div style="padding-left:12px;color:#16a34a;">[${i}] bookingTs=${escapeHtml(String(a.bookingTs||'').slice(0,19))} summary=${escapeHtml(String(a.summary||'').slice(0,60))}</div>`).join('')}
            <div style="margin-top:6px;"><strong>cache-bust 確認:</strong> ${escapeHtml((document.querySelector('script[src*="app.js"]')||{}).src||'').split('?')[1] || '(不明)'}</div>
          </div>
        </details>` : ''}
        ${bookingsWithMemo.length === 0 ? '' :
          (function(){
            // ★ Zoom 連番 — ai_results を ts昇順 で 並べ 1, 2, 3... を 振る (orphan と統一)
            const aiSortedAll = aiResults.slice().sort((a, b) => String(a.ts || a.createdAt || '').localeCompare(String(b.ts || b.createdAt || '')));
            const aiZoomMap = new Map();
            aiSortedAll.forEach((a, i) => aiZoomMap.set((a.bookingTs || '') + '|' + (a.ts || a.createdAt || ''), i + 1));
            // メインカード = bookingsWithMemo (legacy / fs 顧客) を ts順 で 並べる
            const sortedBks = bookingsWithMemo.slice().sort((a, b) => {
              const da = new Date(String(a.date || '') + 'T' + String(a.time || '00:00')).getTime();
              const db = new Date(String(b.date || '') + 'T' + String(b.time || '00:00')).getTime();
              return (isNaN(da) ? 0 : da) - (isNaN(db) ? 0 : db);
            });
            // ★ オーナーfb 2026-06-24: 「議事録」 タブには 実際に録画/メモが ある booking だけ表示
            // (旧: 全 booking 表示 → 未来の予約だけの 空カード が 先頭に並ぶ「意味不明日付」 バグ)
            const sortedBksFiltered = sortedBks.filter(b => {
              const ai = aiResults.find(a => a.bookingTs === b.ts) || {};
              const hasAi = !!(ai.transcript || ai.summary || (ai.key_concerns && ai.key_concerns.length > 0));
              const hasMemo = !!(b.memo && String(b.memo).trim());
              return hasAi || hasMemo;
            });
            if (sortedBksFiltered.length === 0) return '';
            return '<div style="display:grid;gap:14px;margin-bottom:18px;">' +
            sortedBksFiltered.slice().reverse().map(b => {
            const aiData = aiResults.find(a => a.bookingTs === b.ts) || {};
            // ★ メインカードの Zoom連番 は aiData の zoom連番 を使う (orphanと整合)
            const zKey = (aiData.bookingTs || '') + '|' + (aiData.ts || aiData.createdAt || '');
            const zN = aiZoomMap.get(zKey) || '?';
            return `
            <div class="fp-meeting-card">
              <div class="fp-meeting-card-head">
                <div>
                  <div class="fp-meeting-card-eyebrow" style="font-size:13px !important;font-weight:900 !important;color:#1B3A5C !important;letter-spacing:0 !important;">📹 Zoom ${zN}回目 ${aiData.ts || aiData.createdAt ? `<span style="font-size:11px;color:#9CA3AF;font-weight:700;margin-left:8px;font-family:Menlo,monospace;">#${(()=>{ const d=new Date(aiData.ts || aiData.createdAt); return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'-'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0'); })()}</span>` : ''}</div>
                  <div class="fp-meeting-card-date" style="font-size:14px;font-weight:700;">${escapeHtml(fmtDateRobust(aiData.ts || aiData.createdAt) || fmtDateRobust(b.date))} ${escapeHtml(fmtJstTime(aiData.ts || aiData.createdAt) || fmtTimeRobust(b.time))} 面談</div>
                  ${aiData.ts || aiData.createdAt ? `<div class="fp-meeting-card-recstart" style="font-size:11.5px;color:#6B7280;font-weight:600;margin-top:3px;">録画開始: ${escapeHtml(fmtJstTime(aiData.ts || aiData.createdAt))} (${escapeHtml(fmtDateRobust(aiData.ts || aiData.createdAt))})</div>` : ''}
                </div>
                <div class="fp-meeting-card-actions" style="display:flex;gap:6px;flex-wrap:wrap;">
                  ${b.driveUrl ? `<a href="${escapeHtml(b.driveUrl)}" target="_blank" class="fp-btn fp-btn-sm fp-btn-gold">🎥 録画を見る</a>` : ''}
                </div>
              </div>
              ${aiData.transcript ? `
                <div class="fp-meeting-block">
                  <div class="fp-meeting-block-label">AI 文字起こし (Whisper)</div>
                  <details style="background:#fff;border:1px solid var(--fp-line);">
                    <summary style="padding:11px 16px;cursor:pointer;font-size:12px;color:var(--fp-ink);font-weight:700;background:var(--fp-paper);border-bottom:1px solid var(--fp-line);font-family:Manrope,sans-serif;letter-spacing:0.04em;">全文を見る (${(aiData.transcript||'').length}文字)</summary>
                    <div style="padding:14px 18px;font-size:12.5px;line-height:1.95;white-space:pre-wrap;max-height:320px;overflow-y:auto;color:var(--fp-ink);">${escapeHtml(aiData.transcript)}</div>
                  </details>
                </div>` : ''}
              <div class="fp-meeting-block" data-minutes-editor data-booking-ts="${escapeHtml(b.ts || '')}" data-client-id="${escapeHtml(client.id)}">
                <div class="fp-meeting-block-label" style="display:flex;justify-content:space-between;align-items:center;">
                  <span>AI 議事録 (Claude) <span style="font-size:10px;color:#9CA3AF;font-weight:600;margin-left:6px;">編集・追記可</span></span>
                  <button class="fp-minutes-edit" style="background:#fff;border:1px solid #E2E8F0;color:#475569;font-size:11px;font-weight:700;padding:4px 10px;border-radius:5px;cursor:pointer;font-family:inherit;">✏ 編集</button>
                </div>
                <div class="fp-meeting-body fp-minutes-view" style="${aiData.summary ? '' : 'color:#9CA3AF;font-style:italic;'}">${aiData.summary ? escapeHtml(aiData.summary) : '議事録 未生成 — 「✏ 編集」 から手動追記 可'}</div>
                <div class="fp-minutes-edit-wrap" style="display:none;">
                  <textarea class="fp-minutes-textarea" rows="10" style="width:100%;padding:12px 14px;border:1.5px solid #BFDBFE;border-radius:8px;font-size:13px;font-family:inherit;line-height:1.9;resize:vertical;box-sizing:border-box;">${escapeHtml(aiData.summary || '')}</textarea>
                  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
                    <button class="fp-minutes-cancel" style="background:#fff;border:1px solid #E2E8F0;color:#475569;font-size:12px;font-weight:700;padding:7px 14px;border-radius:6px;cursor:pointer;font-family:inherit;">キャンセル</button>
                    <button class="fp-minutes-save" style="background:linear-gradient(135deg,#3B82F6,#2563EB);border:none;color:#fff;font-size:12.5px;font-weight:800;padding:7px 18px;border-radius:6px;cursor:pointer;font-family:inherit;box-shadow:0 3px 10px rgba(59,130,246,0.3);">💾 保存</button>
                  </div>
                  <div class="fp-minutes-msg" style="margin-top:6px;font-size:11.5px;font-weight:700;text-align:right;"></div>
                </div>
              </div>
              ${aiData.key_concerns && aiData.key_concerns.length > 0 ? `
                <div class="fp-meeting-block">
                  <div class="fp-meeting-block-label">お客様の関心事</div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${aiData.key_concerns.map(k => `<span class="fp-concern-chip">${escapeHtml(k)}</span>`).join('')}
                  </div>
                </div>` : ''}
              ${aiData.predicted_next_questions && aiData.predicted_next_questions.length > 0 ? `
                <div class="fp-meeting-block">
                  <div class="fp-meeting-block-label" style="display:flex;align-items:center;gap:6px;">
                    🔮 次回 聞かれそうな 質問
                    <span style="font-size:9.5px;font-weight:600;color:#94A3B8;background:#F1F5F9;padding:1px 6px;border-radius:99px;">AI 予測</span>
                  </div>
                  <ul style="margin:0;padding-left:18px;font-size:13px;color:#1F2A3F;line-height:1.85;">
                    ${aiData.predicted_next_questions.slice(0, 6).map(q => `<li style="margin-bottom:3px;">${escapeHtml(q)}</li>`).join('')}
                  </ul>
                  <div style="font-size:10.5px;color:#64748B;margin-top:6px;line-height:1.55;">次の LINE 連絡 や 次回 面談 の 事前 準備 で 先回り 対応 してください。</div>
                </div>` : ''}
              ${b.memo ? `
                <div class="fp-meeting-block">
                  <div class="fp-meeting-block-label">手書きメモ</div>
                  <div class="fp-meeting-body">${escapeHtml(b.memo)}</div>
                </div>` : ''}
            </div>
          `;
          }).join('') + '</div>';
          })()
        }

        ${(() => {
          // ★ 同 bookingTs に 複数 ai_result (2回目以降 録画) を 別カードで 表示
          //   メインカード で 紐付けたのは booking別 に 1件のみ (時系列で最古の ai_result)
          //   残り ai_result は orphan として 別カード表示 (タブcount=ai_result数と整合)
          const usedKey = new Set();
          bookingsWithMemo.forEach(b => {
            const hit = aiResults.find(a => a.bookingTs === b.ts);
            if (hit) usedKey.add((hit.bookingTs || '') + '|' + (hit.ts || hit.createdAt || ''));
          });
          // 旧仕様 (bookingTs だけで「使用済」 マークしてた) を 置き換え
          const orphan = aiResults.filter(a => {
            const key = (a.bookingTs || '') + '|' + (a.ts || a.createdAt || '');
            if (usedKey.has(key)) return false;
            return (a.summary || a.transcript || (a.key_concerns||[]).length);
          });
          if (orphan.length === 0) return '';
          // ★ 全 ai_results (メイン紐付け済 + orphan) を 時系列 で 「Zoom N回目」 連番
          //   メインカード で「Zoom 1回目」 既に使ってる → orphan は「Zoom 2回目」 から始める
          const allChronological = aiResults.slice().sort((a, b) => String(a.ts || a.createdAt || '').localeCompare(String(b.ts || b.createdAt || '')));
          const aiZoomIdx = new Map();
          allChronological.forEach((a, i) => {
            const key = (a.bookingTs || '') + '|' + (a.ts || a.createdAt || '');
            aiZoomIdx.set(key, i + 1);
          });
          // ★ 2026-06-27: 議事録 並び順 を 新→旧 (newest first) で明示 sort
          return '<div style="display:grid;gap:14px;margin-bottom:18px;">' +
            orphan.slice()
              .sort((a, b) => String(b.ts || b.createdAt || '').localeCompare(String(a.ts || a.createdAt || '')))
              .map(a => {
              const zKey = (a.bookingTs || '') + '|' + (a.ts || a.createdAt || '');
              const zN = aiZoomIdx.get(zKey) || '?';
              return `
              <div class="fp-meeting-card">
                <div class="fp-meeting-card-head">
                  <div>
                    <div class="fp-meeting-card-eyebrow" style="font-size:13px !important;font-weight:900 !important;color:#1B3A5C !important;letter-spacing:0 !important;">📹 Zoom ${zN}回目 ${a.ts || a.createdAt ? `<span style="font-size:11px;color:#9CA3AF;font-weight:700;margin-left:8px;font-family:Menlo,monospace;">#${(()=>{ const d=new Date(a.ts || a.createdAt); return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'-'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0'); })()}</span>` : ''}</div>
                    <div class="fp-meeting-card-date" style="font-size:14px;font-weight:700;">${escapeHtml(fmtDateRobust(a.ts || a.createdAt) || fmtDateRobust(a.date))} ${escapeHtml(fmtJstTime(a.ts || a.createdAt))} 面談</div>
                    ${a.ts || a.createdAt ? `<div class="fp-meeting-card-recstart" style="font-size:11.5px;color:#6B7280;font-weight:600;margin-top:3px;">録画開始: ${escapeHtml(fmtJstTime(a.ts || a.createdAt))} (${escapeHtml(fmtDateRobust(a.ts || a.createdAt))})</div>` : ''}
                  </div>
                </div>
                ${a.transcript ? `
                  <div class="fp-meeting-block">
                    <div class="fp-meeting-block-label">AI 文字起こし (Whisper)</div>
                    <details style="background:#fff;border:1px solid var(--fp-line);">
                      <summary style="padding:11px 16px;cursor:pointer;font-size:12px;color:var(--fp-ink);font-weight:700;background:var(--fp-paper);border-bottom:1px solid var(--fp-line);font-family:Manrope,sans-serif;letter-spacing:0.04em;">全文を見る (${(a.transcript||'').length}文字)</summary>
                      <div style="padding:14px 18px;font-size:12.5px;line-height:1.95;white-space:pre-wrap;max-height:320px;overflow-y:auto;color:var(--fp-ink);">${escapeHtml(a.transcript)}</div>
                    </details>
                  </div>` : ''}
                ${a.summary ? `
                  <div class="fp-meeting-block">
                    <div class="fp-meeting-block-label">AI 議事録 (Claude)</div>
                    <div class="fp-meeting-body">${escapeHtml(a.summary)}</div>
                  </div>` : ''}
                ${a.key_concerns && a.key_concerns.length > 0 ? `
                  <div class="fp-meeting-block">
                    <div class="fp-meeting-block-label">お客様の関心事</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                      ${a.key_concerns.map(k => `<span class="fp-concern-chip">${escapeHtml(k)}</span>`).join('')}
                    </div>
                  </div>` : ''}
                ${a.predicted_next_questions && a.predicted_next_questions.length > 0 ? `
                  <div class="fp-meeting-block">
                    <div class="fp-meeting-block-label" style="display:flex;align-items:center;gap:6px;">
                      🔮 次回 聞かれそうな 質問
                      <span style="font-size:9.5px;font-weight:600;color:#94A3B8;background:#F1F5F9;padding:1px 6px;border-radius:99px;">AI 予測</span>
                    </div>
                    <ul style="margin:0;padding-left:18px;font-size:13px;color:#1F2A3F;line-height:1.85;">
                      ${a.predicted_next_questions.slice(0, 6).map(q => `<li style="margin-bottom:3px;">${escapeHtml(q)}</li>`).join('')}
                    </ul>
                  </div>` : ''}
              </div>
            `;
            }).join('') + '</div>';
        })()}

        ${(function(){
          // ★ オーナーfb「終了後どこに保存されてるかわかりづらい」 → 生成済成果物 一覧
          const delivPrefix = `fp-deliv-edit-${client.id || client.lineFriendId || client.name}-`;
          const delivKeys = Object.keys(localStorage).filter(k => k.startsWith(delivPrefix));
          if (delivKeys.length === 0) return '';
          const items = delivKeys.map(k => {
            const rest = k.substring(delivPrefix.length); // type-taskTitle
            const dash = rest.indexOf('-');
            const type = dash > 0 ? rest.substring(0, dash) : rest;
            const title = dash > 0 ? rest.substring(dash + 1) : '';
            const content = localStorage.getItem(k) || '';
            const sizeKb = (content.length / 1024).toFixed(1);
            return { key: k, type, title, sizeKb };
          });
          return `
            <h3 style="margin-top:18px;">📁 ${escapeHtml(client.name)} 様 専用 生成済 資料 <span class="count-badge">${items.length}</span></h3>
            <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:8px;padding:8px 12px;font-size:11px;color:#4338CA;margin-bottom:8px;">
              💾 編集済成果物はブラウザに自動保存され、いつでも再オープン・LINE再送信できます
            </div>
            <div style="display:grid;gap:6px;">
              ${items.map(it => `
                <div style="background:#fff;border:1px solid var(--line);border-radius:7px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:700;color:var(--ink);">${escapeHtml(it.title || it.type)}</div>
                    <div style="font-size:10.5px;color:var(--muted);">タイプ: ${escapeHtml(it.type)} · サイズ: ${it.sizeKb}KB</div>
                  </div>
                  <div style="display:flex;gap:5px;">
                    <button class="fp-deliv-open" data-deliv-key="${escapeHtml(it.key)}" data-type="${escapeHtml(it.type)}" data-title="${escapeHtml(it.title)}" data-client-id="${escapeHtml(client.id)}" style="font-size:11px;padding:6px 12px;background:#5B5BF0;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;font-family:inherit;">📝 再開</button>
                    <button class="fp-deliv-del" data-deliv-key="${escapeHtml(it.key)}" style="font-size:11px;padding:6px 10px;background:#fff;color:#dc2626;border:1px solid #fecaca;border-radius:5px;cursor:pointer;font-weight:700;font-family:inherit;">🗑</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `;
        })()}
        ${tasks.length === 0 ? '' : `
          <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:8px;padding:10px 14px;margin-top:14px;font-size:12px;color:#4338CA;display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">↗️</span>
            <span><strong>フォロータスク は タイムラインタブに統合されました</strong> — 「📋 議事録から抽出された具体タスク」セクションで操作してください</span>
          </div>
          <div style="display:none;">
            ${tasks.slice().sort((a,b) => (a.due||'').localeCompare(b.due||'')).map((t, i) => {
              const priColor = '#f0f9ff;color:#075985';
              const taskTxt = t.task || '';
              return `<div data-legacy-task="1"></div>`;
            }).join('')}
          </div>`
        }
      </div>
    `;
  }

  // ============================
  // 紹介プログラム (顧客詳細モーダル内のブロック)
  // ============================
  function renderReferralBlock(client) {
    // この顧客が紹介で連れてきた人数を source 文字列からカウント
    const lastName = (client.name || '').split(/\s+/)[0];
    const referredByMe = clients.filter(c =>
      c.id !== client.id && (c.source || '').includes(lastName + '様')
    );
    const referralUrl = `https://line.me/R/ti/p/@511thleq?ref=${client.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(referralUrl)}`;

    const referredList = referredByMe.length === 0
      ? `<div style="font-size:12.5px;color:var(--muted);padding:14px;text-align:center;background:#fafbfc;border-radius:6px;">まだ ${escapeHtml(client.name)} 様経由のご紹介はありません</div>`
      : `<ul style="list-style:none;padding:0;margin:0;display:grid;gap:6px;">
          ${referredByMe.map(c => `
            <li style="padding:10px 14px;background:#fafbfc;border:1px solid var(--line);border-radius:7px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;">
              <span><strong>${escapeHtml(c.name)}</strong> <span style="font-size:11px;color:var(--muted);">${window.LifeEvents.currentAge(c)}歳 / AUM ¥${fmtMoney(c.aum)}</span></span>
              <span class="status-pill ${c.status}">${statusLabel(c.status)}</span>
            </li>
          `).join('')}
        </ul>`;

    return `
      <div class="detail-section">
        <h3>🌱 紹介プログラム <span class="count-badge">${referredByMe.length} 名 ご紹介</span></h3>
        <div style="display:grid;grid-template-columns:200px 1fr;gap:16px;background:linear-gradient(135deg,#fbf4e6,#fff);border:1px solid #f0d36b;border-radius:10px;padding:18px;align-items:start;">
          <div style="text-align:center;">
            <img src="${qrUrl}" alt="referral QR" style="width:180px;height:180px;background:#fff;padding:6px;border:1px solid var(--line);border-radius:8px;">
            <div style="font-size:10.5px;color:var(--muted);margin-top:6px;letter-spacing:0.05em;font-weight:600;">${escapeHtml(client.name)} 様 専用QR</div>
          </div>
          <div>
            <div style="font-size:12.5px;color:var(--ink-2);line-height:1.7;margin-bottom:10px;">
              この方が新しいお客様をご紹介してくださる時、上のQRコードを共有していただきます。<br>
              スキャンで友だち追加されると <strong>自動で紹介者が ${escapeHtml(client.name)} 様 と紐付き</strong>、お礼メッセージも自動送信されます。
            </div>
            <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
              <button class="ghost" id="ref-copy-url" style="font-size:12px;">📋 URLをコピー</button>
              <a class="ghost" href="${qrUrl}" download="referral-${client.id}.png" style="font-size:12px;text-decoration:none;display:inline-block;padding:7px 12px;border:1px solid var(--line-2);border-radius:7px;color:var(--ink);">📥 QRをダウンロード</a>
            </div>
            <div style="font-size:11px;color:var(--muted);font-family:ui-monospace,Menlo,monospace;background:#fff;padding:6px 10px;border-radius:5px;border:1px solid var(--line);word-break:break-all;">${escapeHtml(referralUrl)}</div>
          </div>
        </div>
        <div style="margin-top:14px;">
          <h4 style="font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px;font-weight:700;">この方からのご紹介</h4>
          ${referredList}
        </div>
      </div>
    `;
  }

  // ============================
  // AI返信下書き (LINE文面 自動生成)
  // ============================
  // ⑥ ヒアリングシート モーダル (アンケート回答 + 顧客台帳情報をまとめた印刷用シート)
  function openHearingSheetModal(client) {
    const existing = document.getElementById('fp-hearing-modal');
    if (existing) existing.remove();
    // ★ 顧客の survey_answers を取得 — multi-tenant では Firestore customer.surveyAnswers 直接アクセス、 legacy では liveData から検索
    const surveys = (window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [];
    let s = surveys.find(x => x.userId === client.lineFriendId || x.name === client.name) || {};
    // ★ Firestore customer は client.surveyAnswers を 持ってる → そっち優先
    if (client.surveyAnswers && typeof client.surveyAnswers === 'object') {
      s = { ...client.surveyAnswers, ...s }; // legacy あれば 上書き、 無ければ Firestore を使う
    }
    const age = window.LifeEvents.currentAge(client);
    const overlay = document.createElement('div');
    overlay.id = 'fp-hearing-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:20px;';
    const row = (label, val) => `<tr><th style="text-align:left;padding:9px 14px;background:#F8FAFC;font-size:11.5px;color:#475569;font-weight:700;letter-spacing:0.04em;width:38%;border-bottom:1px solid #E2E8F0;">${label}</th><td style="padding:9px 14px;font-size:13px;color:#0F172A;border-bottom:1px solid #E2E8F0;">${val || '<span style="color:#94A3B8;">未回答</span>'}</td></tr>`;
    const familyTxt = (client.family || []).map(m => {
      const r = m.rel === 'spouse' ? '配偶者' : (m.rel === 'child' ? 'お子様' : m.rel);
      const a = window.LifeEvents.currentAge({ birth: m.birth });
      return `${r} ${escapeHtml(m.name)} (${a}歳)`;
    }).join(' / ') || '単身';
    overlay.innerHTML = `
      <div style="background:#fff;width:min(720px,100%);max-height:90vh;overflow-y:auto;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);font-family:'Noto Sans JP',sans-serif;">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#0EA5E9,#22D3EE);color:#fff;display:flex;justify-content:space-between;align-items:start;">
          <div>
            <div style="font-family:Manrope,sans-serif;font-size:10.5px;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;opacity:0.9;">📋 HEARING SHEET</div>
            <div style="font-size:19px;font-weight:800;margin-top:4px;letter-spacing:-0.01em;">FP相談 事前ヒアリングシート</div>
            <div style="font-size:12px;opacity:0.92;margin-top:3px;">${escapeHtml(client.name)} 様 / ${age}歳 / 作成 ${new Date().toISOString().slice(0,10)}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="fp-hearing-print" title="印刷 / PDF" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);color:#fff;width:36px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;">🖨</button>
            <button id="fp-hearing-close" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);color:#fff;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:16px;">✕</button>
          </div>
        </div>
        <div id="fp-hearing-body" style="padding:24px 28px;">
          <table style="width:100%;border-collapse:collapse;border-top:1px solid #E2E8F0;">
            <tbody>
              ${row('お名前', escapeHtml(client.name) + ' 様')}
              ${row('年代', escapeHtml(s.q1_年代 || ''))}
              ${row('ご職業', escapeHtml(s.q2_職業 || client.occupation || ''))}
              ${row('ご家族構成', escapeHtml(s.q3_家族 || familyTxt))}
              ${row('世帯年収', escapeHtml(s.q4_年収 || ''))}
              ${row('住居形態', escapeHtml(s.q5_住居 || ''))}
              ${row('金融資産', escapeHtml(s.q6_資産 || ''))}
              ${row('保有商品', escapeHtml(s.q7_保有 || ''))}
              ${row('相談テーマ', escapeHtml(s.q8_テーマ || ''))}
              ${row('具体的な相談内容', escapeHtml(s.q9_悩み || ''))}
              ${s.q10_生年月日 ? row('生年月日', escapeHtml(s.q10_生年月日)) : ''}
              ${s.q14_理想 ? row('5〜10年後のご希望', escapeHtml(s.q14_理想)) : ''}
              ${s.q15_緊急度 ? row('ご相談の緊急度', escapeHtml(s.q15_緊急度)) : ''}
              ${row('面談候補日 ①', escapeHtml(s.q11_候補1 || ''))}
              ${row('面談候補日 ②', escapeHtml(s.q12_候補2 || ''))}
              ${row('面談候補日 ③', escapeHtml(s.q13_候補3 || ''))}
            </tbody>
          </table>
          <div style="margin-top:18px;font-size:11px;color:#94A3B8;text-align:right;">© Skeleton Inc. / FP Compass</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('fp-hearing-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('fp-hearing-print').addEventListener('click', () => {
      const html = document.getElementById('fp-hearing-body').outerHTML;
      const w = window.open('', '_blank');
      w.document.write(`<!doctype html><html><head><title>ヒアリングシート ${client.name}</title><style>body{font-family:'Noto Sans JP',sans-serif;padding:30px;}</style></head><body>${html}</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 300);
    });
  }

  // ⑤ 成果物 draft モーダル (キャッシュフロー表 / シミュ表 等)
  // preselectedType: タスクから推定した type を渡すと、即 AI生成まで一気に走る (ワンクリック導線)
  function openDeliverableDraftModal(client, taskTitle, preselectedType) {
    const existing = document.getElementById('fp-deliv-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'fp-deliv-modal';
    // ★ オーナーfb「編集画面が小さくて編集しづらい」 → 画面のほぼ全域に拡大 (1280px / 96vh)
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:12px;';
    overlay.innerHTML = `
      <div style="background:#fff;width:min(1280px,100%);height:96vh;overflow-y:auto;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);font-family:'Noto Sans JP',sans-serif;">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;display:flex;justify-content:space-between;align-items:start;">
          <div>
            <div style="font-family:Manrope,sans-serif;font-size:10.5px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;">📎 成果物 ドラフト</div>
            <div style="font-size:17px;font-weight:800;margin-top:4px;letter-spacing:-0.01em;">${escapeHtml(taskTitle)}</div>
            <div style="font-size:12px;opacity:0.85;margin-top:3px;">${escapeHtml(client.name)} 様 専用</div>
          </div>
          <button id="fp-deliv-close" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);color:#fff;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:16px;">✕</button>
        </div>
        <div style="padding:22px 24px;">
          ${(function(){
            // ★ オーナーfb「Jobsが必要な複数資料を判断して作れるように」
            // タスク文 + 顧客台帳 から 関連性の高い type 複数を推奨
            const t = String(taskTitle || '');
            const recs = [];
            const add = (type, ico, label, reason) => { if (!recs.find(r => r.type === type)) recs.push({type, ico, label, reason}); };
            // 主推奨 (preselectedType)
            if (preselectedType) {
              const labelMap = {hearing:['📋','ヒアリングシート'], cashflow:['📊','キャッシュフロー表'], lifeplan:['📈','ライフプラン表'], education:['🎒','教育費シミュ'], nisa:['💹','NISA/iDeCo配分'], insurance:['🛡','保険見直し'], retire:['🏖','老後資金計算'], inherit:['👴','相続控除計算'], mortgage:['🏡','住宅ローン判定'], kakei:['🏠','家計診断'], custom:['✏️','カスタム']};
              const m = labelMap[preselectedType] || ['📄', preselectedType];
              add(preselectedType, m[0], m[1], 'タスク文からの自動判定 (主)');
            }
            // 関連推奨 (キーワード連鎖)
            if (/家計|収支|貯蓄|貯金/.test(t)) { add('kakei','🏠','家計診断シート','「家計収支」関連 → 固定費見直し前提'); add('cashflow','📊','キャッシュフロー表','「貯蓄状況」関連 → 10年先まで可視化'); }
            if (/ヒアリング/.test(t))  { add('hearing','📋','ヒアリングシート','「ヒアリング」関連 → 10問テンプレ'); }
            if (/教育|進学|学費|大学/.test(t)) { add('education','🎒','教育費シミュ','「教育」関連 → 進路別必要総額'); add('lifeplan','📈','ライフプラン表','教育費ピーク + 退職タイミング可視化'); }
            if (/老後|退職|年金/.test(t)) { add('retire','🏖','老後資金計算','「老後」関連'); add('nisa','💹','NISA/iDeCo配分','老後準備に直結'); }
            if (/NISA|iDeCo|配分|積立/i.test(t)) { add('nisa','💹','NISA/iDeCo配分','「投資」関連 → 3パターン提示'); add('risk','🎯','リスク許容度診断','配分前のヒアリング'); }
            if (/保険|保障/.test(t))    { add('insurance','🛡','保険見直し','「保険」関連'); add('hoshougaku','💉','必要保障額','遺族生活費まで'); }
            if (/相続|贈与|遺産/.test(t)) { add('inherit','👴','相続控除計算','「相続」関連'); add('zoyo','🎁','生前贈与シミュ','年110万×7年加算'); }
            if (/住宅|繰上|ローン/.test(t)) { add('mortgage','🏡','住宅ローン判定','「住宅」関連'); }
            if (/節税|所得控除|確定申告/.test(t)) { add('kakutei','📄','確定申告チェック','「節税」関連 (自営)'); }
            if (/自営|個人事業/.test(client.occupation || '')) { add('kakutei','📄','確定申告チェック','顧客台帳: 自営業 → 青色控除/iDeCo提案'); add('emergency','🆘','緊急予備資金','自営は収入変動リスク大'); }
            if (recs.length === 0) return '';
            const main = recs[0];
            const subs = recs.slice(1, 5);
            return `
              <div style="background:linear-gradient(135deg,#EEF2FF,#FAFBFF);border:2px solid #5B5BF0;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
                <div style="font-size:10.5px;font-weight:800;letter-spacing:0.12em;color:#3730A3;margin-bottom:8px;text-transform:uppercase;">💡 Jobs からの提案 — このタスクには複数の資料が役立ちます</div>
                <div style="font-size:12.5px;color:#1F2937;line-height:1.6;margin-bottom:10px;">
                  タスク「<strong>${escapeHtml(t.slice(0, 40))}${t.length>40?'…':''}</strong>」に対して、<strong style="color:#5B5BF0;">${recs.length}つの資料</strong>を推奨します。
                </div>
                <div style="display:grid;gap:6px;">
                  <button class="fp-deliv-rec" data-type="${escapeHtml(main.type)}" style="background:#5B5BF0;color:#fff;border:none;padding:10px 14px;border-radius:8px;cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;gap:10px;font-weight:800;">
                    <span style="font-size:18px;">${main.ico}</span>
                    <div style="flex:1;">
                      <div style="font-size:13px;">${escapeHtml(main.label)} <span style="background:rgba(255,255,255,0.25);font-size:9.5px;padding:2px 7px;border-radius:8px;margin-left:6px;letter-spacing:0.06em;">主推奨</span></div>
                      <div style="font-size:10.5px;opacity:0.85;font-weight:500;margin-top:1px;">${escapeHtml(main.reason)}</div>
                    </div>
                  </button>
                  ${subs.map(s => `
                    <button class="fp-deliv-rec" data-type="${escapeHtml(s.type)}" style="background:#fff;color:#1F2937;border:1.5px solid #C7D2FE;padding:9px 12px;border-radius:7px;cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;gap:10px;font-weight:600;">
                      <span style="font-size:16px;">${s.ico}</span>
                      <div style="flex:1;">
                        <div style="font-size:12.5px;font-weight:700;">${escapeHtml(s.label)}</div>
                        <div style="font-size:10.5px;color:#64748B;font-weight:500;margin-top:1px;">${escapeHtml(s.reason)}</div>
                      </div>
                    </button>
                  `).join('')}
                </div>
                <div style="font-size:10.5px;color:#6B7280;margin-top:10px;line-height:1.55;">↑ 上を押すと該当テンプレが選択され、AI生成までジャンプ。下の全テンプレリストからも選べます</div>
              </div>
            `;
          })()}
          <div style="font-size:12.5px;color:#475569;line-height:1.7;margin-bottom:14px;">
            または以下から手動選択:
          </div>
          ${renderDeliverableMenu()}
          <div id="fp-deliv-result" style="margin-top:14px;display:none;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('fp-deliv-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    // ★ Jobs 提案バッジから直接タイプ選択
    overlay.querySelectorAll('.fp-deliv-rec').forEach(b => {
      b.addEventListener('click', () => {
        const type = b.dataset.type;
        const target = overlay.querySelector(`.fp-deliv-type[data-type="${type}"]`);
        if (target) {
          target.click();
          // 該当ボタンまで自動スクロール
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
    // ★ preselectedType 指定時はワンクリック導線: 該当タイプを自動選択 → AI生成まで一気に発火
    let _delivAutoFire = !!preselectedType;
    overlay.querySelectorAll('.fp-deliv-type').forEach(b => {
      b.addEventListener('click', () => {
        const type = b.dataset.type;
        // ★ オーナーfb「選んだやつが分かるように色変える」: active 状態を見せる
        overlay.querySelectorAll('.fp-deliv-type').forEach(o => {
          o.style.borderColor = '#E2E8F0';
          o.style.background = '#fff';
          o.style.boxShadow = 'none';
          o.style.opacity = '0.55';
          o.querySelectorAll('div').forEach(d => { d.style.color = ''; });
        });
        b.style.borderColor = '#5B5BF0';
        b.style.background = 'linear-gradient(135deg,#5B5BF0,#6D6DEF)';
        b.style.boxShadow = '0 8px 22px rgba(91,91,240,0.35)';
        b.style.opacity = '1';
        b.querySelectorAll('div').forEach(d => { d.style.color = '#fff'; });
        const result = document.getElementById('fp-deliv-result');
        result.style.display = 'block';
        result.innerHTML = renderDeliverablePreview(type, client);
        // 2) 「✨ AIで このお客様用に個別作成」 ボタンを追加
        const aiBar = document.createElement('div');
        aiBar.style.cssText = 'margin-top:10px;display:flex;gap:8px;align-items:center;background:#EEF1FE;border:1px solid #C7D2FE;border-radius:8px;padding:10px 14px;';
        aiBar.innerHTML = `
          <span style="font-size:11.5px;color:#3730A3;flex:1;">↑ これは汎用テンプレ。<strong>議事録 + 台帳データ</strong> からこのお客様用にカスタムする?</span>
          <button id="fp-deliv-ai" style="background:#5B5BF0;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:800;cursor:pointer;letter-spacing:0.04em;font-family:inherit;">✨ AIで個別作成</button>
        `;
        result.appendChild(aiBar);
        document.getElementById('fp-deliv-ai').addEventListener('click', async () => {
          await generateDeliverableWithAI(type, taskTitle, client, result);
        });
        // 印刷ボタン
        const printBtn = result.querySelector('[data-deliv-print]');
        if (printBtn) printBtn.addEventListener('click', () => {
          const html = result.querySelector('.fp-deliv-content').outerHTML;
          const w = window.open('', '_blank');
          w.document.write(`<!doctype html><html><head><title>${escapeHtml(taskTitle)} - ${escapeHtml(client.name)}</title><style>body{font-family:'Noto Sans JP',sans-serif;padding:30px;color:#0F172A;}table{border-collapse:collapse;width:100%;}th,td{padding:8px 12px;border:1px solid #E2E8F0;font-size:12px;text-align:left;}th{background:#F8FAFC;}</style></head><body>${html}</body></html>`);
          w.document.close();
          setTimeout(() => w.print(), 300);
        });
        // 📤 LINE送信ボタン
        const sendBtn = result.querySelector('[data-deliv-send]');
        if (sendBtn) sendBtn.addEventListener('click', () => {
          openDeliverableSendModal(client, type, taskTitle);
        });
      });
    });
    // ワンクリック導線: preselectedType に対応するボタンを自動クリックして AI 生成までジャンプ
    if (preselectedType) {
      setTimeout(() => {
        const target = overlay.querySelector(`.fp-deliv-type[data-type="${preselectedType}"]`);
        if (target) {
          target.click();
          // 続けて AI生成ボタンも自動発火
          setTimeout(() => {
            const aiBtn = document.getElementById('fp-deliv-ai');
            if (aiBtn) aiBtn.click();
          }, 300);
        }
      }, 100);
    }
  }

  // ★ KPI 操作用: シンプルな LINE 送信モーダル (テンプレ prefill + 編集 + 送信)
  function openLineSendModal(client, prefillText, contextLabel) {
    const uid = client.lineFriendId;
    if (!uid) { alert('この方は LINE 連携未完了'); return; }
    const ex = document.getElementById('fp-line-send-modal');
    if (ex) ex.remove();
    const ov = document.createElement('div');
    ov.id = 'fp-line-send-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:10020;display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML = `
      <div style="background:#fff;width:min(520px,100%);border-radius:14px;font-family:'Noto Sans JP',sans-serif;overflow:hidden;">
        <div style="padding:16px 22px;background:#06C755;color:#fff;display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:14px;">📨 LINE 送信 — ${escapeHtml(contextLabel || 'KPI 達成アクション')}</strong>
          <button id="fp-lsm-close" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;width:28px;height:28px;border-radius:5px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:18px 22px;">
          <div style="font-size:12px;color:#64748B;margin-bottom:10px;">送信先: <strong>${escapeHtml(client.name)} 様</strong></div>
          <div style="font-size:10.5px;color:#5B5BF0;background:#EEF2FF;border:1px solid #C7D2FE;border-radius:6px;padding:8px 12px;margin-bottom:10px;line-height:1.55;">💡 テンプレを編集してご送信ください。送信後、このKPIは自動で「✓ 達成」になります</div>
          <textarea id="fp-lsm-msg" style="width:100%;min-height:240px;border:1.5px solid #E2E8F0;border-radius:8px;padding:12px;font-family:inherit;font-size:13px;line-height:1.75;">${escapeHtml(prefillText)}</textarea>
          <div style="display:flex;gap:10px;margin-top:14px;">
            <button id="fp-lsm-cancel" style="flex:1;padding:11px;background:#fff;border:1.5px solid #CBD5E1;color:#475569;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;">キャンセル</button>
            <button id="fp-lsm-send" style="flex:2;padding:11px;background:#06C755;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer;font-family:inherit;">📤 LINE 送信</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    document.getElementById('fp-lsm-close').addEventListener('click', () => ov.remove());
    document.getElementById('fp-lsm-cancel').addEventListener('click', () => ov.remove());
    document.getElementById('fp-lsm-send').addEventListener('click', async () => {
      const text = document.getElementById('fp-lsm-msg').value.trim();
      if (!text) { alert('本文を入力してください'); return; }
      const btn = document.getElementById('fp-lsm-send');
      btn.disabled = true; btn.textContent = '送信中…';
      try {
        const r = await fetch('https://fp-compass-webhook-527726449426.asia-northeast1.run.app/api/send-line', {
          method: 'POST', headers: await (window.getFpAuthHeaders ? window.getFpAuthHeaders() : Promise.resolve({ 'Content-Type': 'application/json' })),
          body: JSON.stringify({ userId: uid, text }),
        });
        const d = await r.json();
        if (d.ok) {
          // ★ lineHistory 二重保存 (顧客台帳 + 独立キー)
          try {
            if (!Array.isArray(client.lineHistory)) client.lineHistory = [];
            const iso = new Date().toISOString();
            const newMsg = { from: 'fp', direction: 'out', text: text, message: text, ts: iso, date: iso.slice(0,10), source: 'fp-crm-kpi' };
            client.lineHistory.push(newMsg);
            client.lastContact = iso.slice(0, 10);
            localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS || []));
            const histKey = 'fp-line-history-' + client.id;
            const existHist = JSON.parse(localStorage.getItem(histKey) || '[]');
            existHist.push(newMsg);
            localStorage.setItem(histKey, JSON.stringify(existHist));
          } catch (_) {}
          ov.remove();
          const t = document.createElement('div');
          t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #06C755;border-radius:10px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:10030;';
          t.innerHTML = `<strong style="font-size:14px;">✓ ${escapeHtml(client.name)} 様 に送信完了</strong><div style="font-size:12px;color:#6b7280;margin-top:4px;">LINE 履歴に追加済 — 次の提案で Jobs が参照します</div>`;
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 4000);
        } else { alert('失敗: ' + (d.error || '')); btn.disabled = false; btn.textContent = '📤 LINE 送信'; }
      } catch (e) { alert('失敗: ' + e.message); btn.disabled = false; btn.textContent = '📤 LINE 送信'; }
    });
  }

  // 成果物 → LINE送信モーダル (本文 prefill + 編集 + 送信)
  // finalHtml: 編集後の成果物 HTML (添付プレビュー表示用)
  function openDeliverableSendModal(client, type, taskTitle, finalHtml) {
    const uid = client.lineFriendId;
    if (!uid) { alert('この方は LINE 友だち追加が完了してないので送信できません。'); return; }
    const typeName = ({cashflow:'キャッシュフロー表', lifeplan:'ライフプラン表', nisa:'NISA/iDeCo配分シミュ', insurance:'保険見直しレポート', hearing:'ヒアリングシート', custom:'資料'}[type]) || '資料';
    const hasAttachment = !!(finalHtml && finalHtml.length > 100);
    const prefill = `${client.name}様\n\nお世話になっております。FP Compass の${(window.LineAppLiveData?.users?.[0]?.displayName) || '担当'}です。\n\n面談でお話した「${taskTitle}」に関する${typeName}をお送りします。\n\nご家族でご確認いただき、不明点があれば このトークから気軽にお問い合わせください 🙏${hasAttachment ? `\n\n📎 添付: ${typeName} (編集後の最終版)` : ''}`;
    const ex = document.getElementById('fp-deliv-send-modal');
    if (ex) ex.remove();
    const ov = document.createElement('div');
    ov.id = 'fp-deliv-send-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:10020;display:flex;align-items:center;justify-content:center;padding:20px;';
    // ★ 大きい二段組レイアウト: 左=添付資料プレビュー(編集可) / 右=LINE本文
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.7);z-index:10020;display:flex;align-items:center;justify-content:center;padding:16px;';
    const attachmentBlock = hasAttachment ? `
      <div style="flex:1.6;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;min-width:0;">
        <div style="padding:10px 14px;background:#5B5BF0;color:#fff;font-size:11.5px;font-weight:800;letter-spacing:0.06em;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
          <span>📎 添付資料プレビュー <span style="opacity:0.85;font-weight:600;font-size:10.5px;margin-left:8px;">直接クリックで編集可</span></span>
          <span style="opacity:0.85;font-weight:600;" id="fp-ds-size">${(finalHtml.length / 1000).toFixed(1)}KB</span>
        </div>
        <div id="fp-ds-preview" contenteditable="true" style="flex:1;overflow:auto;padding:18px 22px;font-size:13px;background:#fff;line-height:1.75;outline:none;">${finalHtml}</div>
        <div style="padding:8px 14px;background:#FAFBFC;border-top:1px solid #E2E8F0;font-size:10.5px;color:#64748B;display:flex;justify-content:space-between;flex-shrink:0;">
          <span>✏️ クリック → 編集 → 自動保存 → そのまま送信</span>
          <span id="fp-ds-edit-status">編集モード ON</span>
        </div>
      </div>
    ` : '';
    ov.innerHTML = `
      <div style="background:#fff;width:min(1400px,98vw);height:min(900px,94vh);border-radius:14px;font-family:'Noto Sans JP',sans-serif;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 28px 70px rgba(15,23,42,0.45);">
        <div style="padding:16px 24px;background:#06C755;color:#fff;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
          <strong style="font-size:15px;">📤 ${escapeHtml(typeName)} を LINEで送信${hasAttachment ? ' (本文+資料同梱)' : ''}</strong>
          <div style="display:flex;align-items:center;gap:14px;font-size:12.5px;opacity:0.95;">
            <span>送信先: <strong>${escapeHtml(client.name)} 様</strong></span>
            <button id="fp-ds-close" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;width:30px;height:30px;border-radius:5px;cursor:pointer;font-size:14px;">✕</button>
          </div>
        </div>
        <div style="padding:18px 22px;flex:1;display:flex;gap:18px;min-height:0;${hasAttachment ? '' : 'flex-direction:column;'}">
          ${attachmentBlock}
          <div style="flex:1;display:flex;flex-direction:column;min-width:0;${hasAttachment ? 'max-width:420px;' : ''}">
            <div style="font-size:11px;font-weight:700;color:#64748B;letter-spacing:0.06em;margin-bottom:6px;text-transform:uppercase;">💬 LINE本文 (編集可)</div>
            <textarea id="fp-ds-msg" style="flex:1;width:100%;min-height:280px;border:1.5px solid #E2E8F0;border-radius:8px;padding:14px;font-family:inherit;font-size:13.5px;line-height:1.85;resize:none;">${escapeHtml(prefill)}</textarea>
          </div>
        </div>
        <div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#FAFBFC;display:flex;gap:12px;flex-shrink:0;">
          <button id="fp-ds-cancel" style="flex:1;padding:13px;background:#fff;border:1.5px solid #CBD5E1;color:#475569;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;font-size:13.5px;">キャンセル</button>
          <button id="fp-ds-send" style="flex:3;padding:13px;background:#06C755;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer;font-family:inherit;font-size:13.5px;">📤 ${hasAttachment ? '本文+(編集後の)資料を ' : ''}LINEで送信</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    document.getElementById('fp-ds-close').addEventListener('click', () => ov.remove());
    document.getElementById('fp-ds-cancel').addEventListener('click', () => ov.remove());
    // 編集後の HTML を保持する変数 + プレビューでの編集を自動キャプチャ
    let editedHtml = finalHtml;
    const previewEl = document.getElementById('fp-ds-preview');
    const editStatus = document.getElementById('fp-ds-edit-status');
    const sizeEl = document.getElementById('fp-ds-size');
    if (previewEl) {
      previewEl.addEventListener('input', () => {
        editedHtml = previewEl.innerHTML;
        if (sizeEl) sizeEl.textContent = (editedHtml.length / 1000).toFixed(1) + 'KB';
        if (editStatus) { editStatus.textContent = '✓ 編集中…'; editStatus.style.color = '#16A34A'; }
        // localStorage に自動保存 (同じ顧客 + type で開いた時 復元)
        try { localStorage.setItem('fp-deliv-edit-' + client.id + '-' + type, editedHtml); } catch (_) {}
      });
      // 過去の編集 復元
      try {
        const saved = localStorage.getItem('fp-deliv-edit-' + client.id + '-' + type);
        if (saved && saved.length > 100 && saved !== finalHtml) {
          if (confirm('前回の編集内容が保存されています。 復元しますか?\n\n(キャンセル = AI生成の最新版を使う)')) {
            previewEl.innerHTML = saved;
            editedHtml = saved;
            if (sizeEl) sizeEl.textContent = (editedHtml.length / 1000).toFixed(1) + 'KB';
          }
        }
      } catch (_) {}
    }
    document.getElementById('fp-ds-send').addEventListener('click', async () => {
      const text = document.getElementById('fp-ds-msg').value.trim();
      if (!text) { alert('本文を入力してください'); return; }
      const btn = document.getElementById('fp-ds-send');
      btn.disabled = true; btn.textContent = '送信中…';
      try {
        const r = await fetch('https://fp-compass-webhook-527726449426.asia-northeast1.run.app/api/send-line', {
          method: 'POST', headers: await (window.getFpAuthHeaders ? window.getFpAuthHeaders() : Promise.resolve({ 'Content-Type': 'application/json' })),
          body: JSON.stringify({ userId: uid, text, deliverableHtml: hasAttachment ? editedHtml : undefined, deliverableType: type, deliverableTitle: taskTitle, customerName: client.name }),
        });
        const d = await r.json();
        if (d.ok) {
          ov.remove();
          const t = document.createElement('div');
          t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #06C755;border-radius:10px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:10030;';
          t.innerHTML = `<strong style="font-size:14px;">✓ ${escapeHtml(client.name)} 様 に送信完了</strong>`;
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 4000);
        } else { alert('失敗: ' + (d.error || '')); btn.disabled = false; btn.textContent = '📤 LINEで送信'; }
      } catch (e) { alert('失敗: ' + e.message); btn.disabled = false; btn.textContent = '📤 LINEで送信'; }
    });
  }

  // AI個別生成: 議事録 + 顧客台帳 → Claude → このお客様用 HTML
  // ★ 進捗フローティングピル: モーダル閉じても進行状況が見える + 完了時にクリックで復元
  function showAiProgressPill(client, type, taskTitle, onClickWhenDone) {
    const jobId = `fp-ai-pill-${client.id || client.lineFriendId || client.name}-${type}`;
    let pill = document.getElementById(jobId);
    if (pill) pill.remove();
    pill = document.createElement('div');
    pill.id = jobId;
    // ★ z-index 10100: モーダル overlay (10010-10030) の更に上に出す (オーナーfb「後ろに隠れて読めない」対策)
    pill.style.cssText = 'position:fixed;right:18px;bottom:18px;background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;padding:14px 20px;border-radius:14px;box-shadow:0 16px 40px rgba(91,91,240,0.55),0 0 0 4px #fff,0 0 0 6px #5B5BF0;z-index:10100;font-family:inherit;min-width:310px;cursor:default;';
    pill.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;border:3px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:fp-ai-spin 0.9s linear infinite;flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Inter',sans-serif;font-size:10px;font-weight:800;letter-spacing:0.22em;opacity:0.85;">AI 生成中</div>
          <div style="font-size:13px;font-weight:800;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(client.name)} 様 / ${escapeHtml(type)}</div>
          <div style="font-size:11px;opacity:0.85;margin-top:2px;"><span class="fp-pill-timer" style="font-family:'Inter',sans-serif;font-variant-numeric:tabular-nums;">0</span> 秒経過 — 別作業 続けて OK</div>
        </div>
      </div>
    `;
    if (!document.getElementById('fp-ai-spin-style')) {
      const s = document.createElement('style');
      s.id = 'fp-ai-spin-style';
      s.textContent = '@keyframes fp-ai-spin{to{transform:rotate(360deg)}}@keyframes fp-pill-done-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(pill);
    const startMs = Date.now();
    const timerEl = pill.querySelector('.fp-pill-timer');
    const timerId = setInterval(() => {
      const s = Math.floor((Date.now() - startMs) / 1000);
      if (timerEl) timerEl.textContent = String(s);
    }, 500);
    pill._fpTimerId = timerId;
    pill._fpDone = (ok, err) => {
      clearInterval(timerId);
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      if (ok) {
        pill.style.background = 'linear-gradient(135deg,#10B981,#059669)';
        pill.style.cursor = 'pointer';
        pill.style.animation = 'fp-pill-done-pulse 1.4s ease-in-out infinite';
        pill.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:36px;height:36px;background:rgba(255,255,255,0.22);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">✓</div>
            <div style="flex:1;min-width:0;">
              <div style="font-family:'Inter',sans-serif;font-size:10px;font-weight:800;letter-spacing:0.22em;opacity:0.9;">AI 生成 完了 (${elapsed}秒)</div>
              <div style="font-size:13px;font-weight:800;margin-top:2px;">${escapeHtml(client.name)} 様 / ${escapeHtml(type)}</div>
              <div style="font-size:11px;opacity:0.92;margin-top:2px;">→ クリックで開いて編集 (📁 顧客モーダル > 面談記録タブ にも保管)</div>
            </div>
            <button style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;width:24px;height:24px;border-radius:5px;cursor:pointer;font-size:13px;" data-pill-close>✕</button>
          </div>
        `;
        pill.addEventListener('click', (ev) => {
          if (ev.target.dataset.pillClose !== undefined) { pill.remove(); return; }
          if (typeof onClickWhenDone === 'function') onClickWhenDone();
          pill.remove();
        });
      } else {
        pill.style.background = 'linear-gradient(135deg,#DC2626,#B91C1C)';
        pill.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:22px;flex-shrink:0;">⚠</div>
            <div style="flex:1;min-width:0;">
              <div style="font-family:'Inter',sans-serif;font-size:10px;font-weight:800;letter-spacing:0.22em;opacity:0.9;">AI 生成 失敗</div>
              <div style="font-size:13px;font-weight:800;margin-top:2px;">${escapeHtml(client.name)} 様 / ${escapeHtml(type)}</div>
              <div style="font-size:11px;opacity:0.92;margin-top:2px;">${escapeHtml(err || '不明エラー')}</div>
            </div>
            <button style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;width:24px;height:24px;border-radius:5px;cursor:pointer;font-size:13px;" data-pill-close>✕</button>
          </div>
        `;
        pill.querySelector('[data-pill-close]').addEventListener('click', () => pill.remove());
        setTimeout(() => { if (document.body.contains(pill)) pill.remove(); }, 12000);
      }
    };
    return pill;
  }

  // ★ 「📎 資料を作成」 ヘッダーボタン → 資料タイプ選択モーダル
  function openQuickDeliverablePicker(client) {
    const types = [
      { id: 'cashflow', emoji: '📊', title: 'キャッシュフロー表', sub: '60歳まで 5年刻み / 収入支出貯蓄' },
      { id: 'education', emoji: '🎓', title: '教育費シミュレーション', sub: '公立/私立/医学部 別 試算' },
      { id: 'retire', emoji: '🏖', title: '退職金 受取シミュ', sub: '一時金 vs 年金型 比較' },
      { id: 'insurance', emoji: '🛡', title: '保険見直し 提案', sub: '現状 vs 削減提案' },
      { id: 'inherit', emoji: '👵', title: '相続対策 基礎', sub: '暦年贈与 / 生前対策 効果額' },
      { id: 'custom', emoji: '✏', title: 'その他 (自由記述)', sub: '依頼内容を 自分で書く' },
    ];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10080;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:580px;width:100%;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;">
        <div style="background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;padding:22px 26px;display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.2em;opacity:0.88;text-transform:uppercase;margin-bottom:5px;">📎 DELIVERABLE</div>
            <h3 style="margin:0;font-family:'Noto Serif JP',serif;font-weight:700;font-size:18px;">${escapeHtml(client.name)} さん の 資料を 作成</h3>
            <p style="margin:6px 0 0;font-size:11.5px;opacity:0.88;line-height:1.6;">JSON + プロンプト の 2ファイル を ダウンロード → 自分の Claude Code で 生成 (コスト $0)</p>
          </div>
          <button id="fp-qdp-close" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:18px;">✕</button>
        </div>
        <div style="padding:22px 26px;">
          <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.14em;color:#8B7D5D;text-transform:uppercase;margin-bottom:12px;">タイプを選ぶ</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            ${types.map(t => `
              <button class="fp-qdp-type" data-type="${t.id}" style="display:flex;align-items:flex-start;gap:12px;background:#fff;border:1.5px solid #E8E2D4;border-radius:10px;padding:14px;cursor:pointer;text-align:left;font-family:inherit;transition:all 0.15s ease;">
                <div style="font-size:24px;line-height:1;flex-shrink:0;">${t.emoji}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-family:'Noto Serif JP',serif;font-weight:700;font-size:13.5px;color:#1F1A12;margin-bottom:3px;">${escapeHtml(t.title)}</div>
                  <div style="font-size:11px;color:#8B7D5D;line-height:1.5;">${escapeHtml(t.sub)}</div>
                </div>
              </button>
            `).join('')}
          </div>
          <div id="fp-qdp-custom-wrap" style="display:none;margin-top:18px;padding-top:18px;border-top:1px dashed #E8E2D4;">
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.14em;color:#8B7D5D;text-transform:uppercase;margin-bottom:8px;">どんな資料?</div>
            <input id="fp-qdp-custom" type="text" placeholder="例: 新NISA配分の説明資料" style="width:100%;padding:12px 14px;border:1.5px solid #E8E2D4;border-radius:8px;font-size:13px;font-family:inherit;box-sizing:border-box;">
            <button id="fp-qdp-custom-go" style="margin-top:10px;background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;border:none;padding:11px 22px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">この内容で 作成 →</button>
          </div>
        </div>
      </div>
      <style>
        .fp-qdp-type:hover { border-color:#5B5BF0 !important; background:linear-gradient(135deg,#EEF1FE,#fff) !important; transform:translateY(-2px); box-shadow:0 6px 16px rgba(91,91,240,0.18); }
      </style>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#fp-qdp-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('.fp-qdp-type').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        if (type === 'custom') {
          overlay.querySelector('#fp-qdp-custom-wrap').style.display = 'block';
          overlay.querySelector('#fp-qdp-custom').focus();
          return;
        }
        overlay.remove();
        const titleMap = { cashflow: 'キャッシュフロー表', education: '教育費シミュレーション', retire: '退職金受取シミュ', insurance: '保険見直し提案', inherit: '相続対策の基礎' };
        triggerDeliverable(client, type, titleMap[type] || type);
      });
    });
    overlay.querySelector('#fp-qdp-custom-go').addEventListener('click', () => {
      const taskTitle = overlay.querySelector('#fp-qdp-custom').value.trim();
      if (!taskTitle) { alert('依頼内容を 入力してください'); return; }
      overlay.remove();
      triggerDeliverable(client, 'custom', taskTitle);
    });
  }

  // ★ オーナーfb (v AR): Mac mini 経由廃止 → JSON + プロンプト の 2 ファイル DL のみ。
  // FP事業者 が 自分の Claude Code に 貼り付けて生成する流れに変更
  async function triggerDeliverable(client, type, taskTitle) {
    // データ収集
    const age = window.LifeEvents.currentAge(client);
    const family = (client.family || []).map(m => {
      const r = m.rel === 'spouse' ? '配偶者' : (m.rel === 'child' ? 'お子様' : m.rel);
      return { relation: r, name: m.name, age: window.LifeEvents.currentAge({ birth: m.birth }), birth: m.birth };
    });
    // ★ オーナーfb (v AU): Zoom 複数回 対応 — 過去 全 議事録 (最大 5回 / 古い順) を JSON に入れる
    const allMeetings = ((window.LineAppLiveData && window.LineAppLiveData.ai_results) || [])
      .filter(r => (r.userId && r.userId === client.lineFriendId) || (r.customerName && r.customerName === client.name))
      .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''))
      .slice(-5)
      .map((r, idx, arr) => ({
        meetingNumber: idx + 1,
        totalMeetings: arr.length,
        recordedAt: r.ts || '',
        date: r.ts ? r.ts.slice(0, 10) : '',
        summary: r.summary || '',
        transcript: r.transcript || '',
      }));
    const fpName = (window.__fp?.tenantName || 'FP事務所').replace(/ — DEMO ビュー/, '');

    // ★ 事前アンケート (proxy/index.js 本番スキーマ q1_年代〜q15_緊急度) を JSON に埋め込み
    const surveys = ((window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [])
      .filter(s => (s.userId && s.userId === client.lineFriendId) || (s.displayName && s.displayName === client.name) || (s.name && s.name === client.name))
      .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    const latestSurvey = surveys[0] || null;
    const surveyAnswers = latestSurvey ? {
      年代: latestSurvey.q1_年代 || '',
      職業: latestSurvey.q2_職業 || client.occupation || '',
      家族構成: latestSurvey.q3_家族 || '',
      世帯年収: latestSurvey.q4_年収 || '',
      住居形態: latestSurvey.q5_住居 || '',
      金融資産: latestSurvey.q6_資産 || '',
      保有商品: latestSurvey.q7_保有 || '',
      相談テーマ: latestSurvey.q8_テーマ || '',
      具体的悩み: latestSurvey.q9_悩み || '',
      生年月日: latestSurvey.q10_生年月日 || client.birth || '',
      'こうなりたい(5-10年後)': latestSurvey.q14_理想 || '',
      緊急度: latestSurvey.q15_緊急度 || '',
    } : null;

    // JSON ペイロード
    const jsonPayload = {
      meta: {
        generatedAt: new Date().toISOString(),
        fpName,
        deliverableType: type,
        taskTitle,
      },
      customer: {
        name: client.name,
        kana: client.kana || '',
        age,
        gender: client.gender === 'F' ? '女性' : (client.gender === 'M' ? '男性' : '不明'),
        occupation: client.occupation || '',
        family,
        aum: client.aum || 0,
        mortgage: client.mortgage || null,
        source: client.source || '',
        status: client.status || '',
        lastContact: client.lastContact || '',
      },
      surveyAnswers,
      meetingNotes: allMeetings,
      proposals: (client.proposals || []).map(p => ({ date: p.date, title: p.title, result: p.result })),
      lineHistoryRecent: (client.lineHistory || []).slice(-10).map(m => ({ direction: m.direction || m.from, ts: m.ts, text: (m.text || '').slice(0, 200) })),
    };

    // ★ オーナーfb (v AT): prompt.txt 単体で完結するよう JSON を 中に 埋め込む。
    // (FP事業者 が ファイル を Claude Code に渡すだけで そのまま動く)
    const prompt = `あなたは 経験豊富な FP (ファイナンシャル・プランナー) 兼 編集デザイナー です。
下記 「顧客データ JSON」 を 元に お客様 1人 だけ のために 作り込んだ A4 1枚 の HTML 資料 を 作成してください。

═══════════════════════════════════════════════
【顧客データ JSON】
═══════════════════════════════════════════════
\`\`\`json
${JSON.stringify(jsonPayload, null, 2)}
\`\`\`
═══════════════════════════════════════════════

═══════════════════════════════════════════════
【STEP 1 — JSON を よく 読む】
═══════════════════════════════════════════════
- meta.deliverableType: 何を作るか (cashflow / education / retire / insurance / inherit / custom)
- meta.taskTitle: タイトル として 使う候補
- customer: 年齢 / 職業 / 家族構成 / AUM / 住宅ローン / ステータス
- surveyAnswers: ★ お客様 初回 LINE アンケート 回答 (LSTEP)。 **資料 の 出発点**
  - テーマ / 一番の悩み / こうなりたい / 緊急度 / 既存商品 を 必ず 反映。
  - 「事前アンケートで『教育費が不安』と お聞きしておりました」 のように 引用 して 信頼感 を 出す。
- meetingNotes: 過去の議事録 配列 (古い順、 最大 5 回)。 各要素に summary / transcript / date / meetingNumber。
  **必ず 全 議事録 を 読み 流れ を 把握** して 反映。 最新だけでなく 過去の発言の継続/変化 も 拾う。
  例: 「初回 (1回目) に お話頂いた『教育費の不安』 → 3回目で『プラン定まってきた』 と 進展」
- proposals: 過去の提案履歴 (重複しないよう 配慮)
- lineHistoryRecent: 直近 LINE のやりとり

═══════════════════════════════════════════════
【STEP 2 — タイプ別 構成】
═══════════════════════════════════════════════
- **cashflow**: 30〜90歳 5年刻み キャッシュフロー表 (収入/支出/貯蓄残高/年金) + 注目ポイント 3 つ
- **education**: お子様 進路別 (公立/私立/医学部) 教育費総額 + 月額 積立 必要額 + ピーク年
- **retire**: 退職金 受取 一時金 vs 年金型 シミュ + 税引後 手取り 比較 + 推奨パターン
- **insurance**: 現契約 棚卸し → 過不足 診断 → 月額 ¥X 削減 試算
- **inherit**: 課税対象資産 試算 + 暦年贈与 / 生前対策 効果額 + 優先順位
- **custom**: taskTitle に従って 自由に構成 (議事録から課題を 拾う)

═══════════════════════════════════════════════
【STEP 3 — プロ品質 のデザイン】
═══════════════════════════════════════════════
- フォント: 'Noto Serif JP' (見出し), 'Hiragino Sans' (本文) / 印刷用に Google Fonts も link
- 色: ベース #1F1A12 (墨色) / アクセント #C19A3A (品のある金) / 背景 #FDFCF7 (アイボリー)
- レイアウト: 上品な余白 / 罫線 hairline (#E8E2D4) / 数表は 偶数行 グレー帯
- 印刷見せ可能。 銀行/証券 のレポートに 近い 質感
- グラフ は CSS で書ける 棒/円のみ (Chart.js などは NG / インラインCSS で完結)

═══════════════════════════════════════════════
【STEP 4 — 個別化 (これが最重要)】
═══════════════════════════════════════════════
- お客様の名前 を **タイトル + 本文 1箇所** に 入れる
- 議事録 (summary, transcript) で 出てきた キーワード や 発言 を 必ず 1〜2箇所 引用
  例: 「先日お話に出てた『○○』 の件、 試算 してみました」
- 家族構成 から 出てくる 具体名 (お子様の名前 等) も 反映
- 一般論 ($A → 数値) は 避ける、 お客様固有の数字 を 必ず 含める
- 末尾 必ず:「次の打ち合わせで 一緒に確認したい点」 3項目 (議事録 と 紐づく内容)

═══════════════════════════════════════════════
【STEP 5 — A4 1ページ 厳守】
═══════════════════════════════════════════════
A4 297mm × 210mm に 1ページ で収まる量に 必ず する。 はみ出し 禁止。
- タイトル + 顧客名: 14pt 1行 (12mm)
- セクション 3-4 個 (各 50-60mm = 7-8行)
- 数表: 5行 × 3-4列 が上限 (合計 50mm)
- 末尾「次回確認」: 10pt × 3項目 (25mm)
- 合計 約 250-270mm 以内

═══════════════════════════════════════════════
【STEP 6 — 必須 CSS】
═══════════════════════════════════════════════
<style> 内 必ず:
@page { size: A4 portrait; margin: 15mm; }
html, body { font-family: 'Noto Serif JP', 'Hiragino Mincho ProN', serif; font-size: 11pt; line-height: 1.55; color: #1F1A12; background: #FDFCF7; }
body { width: 180mm; height: 267mm; max-height: 267mm; overflow: hidden; box-sizing: border-box; }
h1, h2, h3 { font-family: 'Noto Serif JP', serif; font-weight: 700; letter-spacing: -0.01em; }
.accent { color: #C19A3A; }
table { width: 100%; border-collapse: collapse; font-size: 10pt; }
table th, table td { padding: 4px 8px; border-bottom: 1px solid #E8E2D4; }
table tbody tr:nth-child(even) { background: #F7F5EE; }

═══════════════════════════════════════════════
【出力フォーマット 厳守 — PDFファイル を 直接 作る】
═══════════════════════════════════════════════
**最終成果物は HTML ではなく PDF ファイル**。 以下 3ステップを 全て あなた (Claude Code) が 実行してください:

STEP A: HTML 文書 を 一時ファイル として 書き出し
  - ファイル名: \`/tmp/${(client.name||'customer').replace(/[\/\\\\\s]+/g, '_')}_${type}_${new Date().toISOString().slice(0,10)}.html\`
  - 内容: 上記 STEP1〜6 に従って 作った 完全な HTML (<!DOCTYPE html> から </html>)

STEP B: HTML → PDF 変換 (どちらか 使えるもの で)
  オプション1 (推奨): Chrome headless
    \`/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="<同名 .pdf>" "<同 .html>"\`
  オプション2: wkhtmltopdf があれば
    \`wkhtmltopdf --enable-local-file-access "<.html>" "<.pdf>"\`
  オプション3: weasyprint があれば
    \`weasyprint "<.html>" "<.pdf>"\`

STEP C: 結果報告
  - 生成された PDF の パス を 1行 で 報告
  - 例: \`✓ 生成完了: /tmp/田中健一_cashflow_2026-06-10.pdf\`
  - その後、 \`open "<PDFパス>"\` で FP のマシン で 自動表示

【注意】
- HTML を そのまま テキストで 返さない (FP は PDFしか欲しくない)
- code fence で コードブロック 出さない
- 説明文 不要、 ファイル生成と PDF 変換 を 実行 → パス報告 のみ

それでは 作成してください。`;

    // ★ オーナーfb (v AT): クリップボードに自動コピー + claude.ai 新タブで開く で「貼り付けるだけ」 にする
    let copied = false;
    try { await navigator.clipboard.writeText(prompt); copied = true; } catch (_) {}

    // バックアップ DL (上級者用)
    const customerSlug = (client.name || 'customer').replace(/[\/\\\s]+/g, '_');
    const stamp = new Date().toISOString().slice(0, 10);
    downloadAsFile(`${customerSlug}_${type}_${stamp}_prompt.txt`, prompt, 'text/plain');

    // 完了モーダル — 超シンプル 1ステップ
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.7);backdrop-filter:blur(6px);z-index:10080;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:520px;width:100%;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;">
        <div style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;padding:26px 28px;text-align:center;">
          <div style="font-size:42px;margin-bottom:6px;">✓</div>
          <h3 style="margin:0;font-family:'Noto Serif JP',serif;font-weight:700;font-size:20px;">${copied ? '指示文を コピーしました' : 'ダウンロード しました'}</h3>
          <p style="margin:6px 0 0;font-size:12.5px;opacity:0.92;line-height:1.6;">この後、 やることは <strong>2つだけ</strong></p>
        </div>
        <div style="padding:24px 28px;">
          <div style="background:linear-gradient(135deg,#FDFBF4,#FAF6E8);border:1px solid #E8C56F;border-radius:10px;padding:18px;margin-bottom:14px;">
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.16em;color:#C19A3A;margin-bottom:8px;">STEP 1</div>
            <p style="margin:0;font-size:14px;font-weight:700;color:#1F1A12;line-height:1.65;">下のボタンを 押す → Claude が 開きます</p>
            <button id="fp-open-claude" style="margin-top:12px;width:100%;background:#1F1A12;color:#FFE9A8;border:none;padding:14px;border-radius:8px;font-size:14px;font-weight:900;cursor:pointer;font-family:inherit;letter-spacing:0.06em;">🌐 Claude を 開く →</button>
          </div>
          <div style="background:linear-gradient(135deg,#FDFBF4,#FAF6E8);border:1px solid #E8C56F;border-radius:10px;padding:18px;">
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.16em;color:#C19A3A;margin-bottom:8px;">STEP 2</div>
            <p style="margin:0;font-size:14px;font-weight:700;color:#1F1A12;line-height:1.65;">Claude の 入力欄で <strong style="background:#1F1A12;color:#FFE9A8;padding:2px 8px;border-radius:4px;">Cmd + V</strong> を 押して 貼り付け → Enter</p>
            <p style="margin:8px 0 0;font-size:11.5px;color:#5E5648;line-height:1.7;">(指示文は すでに クリップボードに 入っています)</p>
          </div>
          <div style="margin-top:14px;padding:10px 14px;background:#F8FAFC;border-radius:8px;font-size:11.5px;color:#5E5648;line-height:1.7;">
            💡 1〜2分で HTML が 出来上がります。 そのまま Chrome で 印刷 → PDF 保存 で 完成。
          </div>
        </div>
        <div style="padding:12px 28px;background:#FDFBF4;border-top:1px solid #E8E2D4;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:10.5px;color:#8B7D5D;">バックアップで .txt ファイルも DL 済み</span>
          <button id="fp-dl-done" style="background:transparent;color:#8B7D5D;border:1px solid #D6CDB6;padding:8px 18px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">閉じる</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#fp-open-claude').addEventListener('click', () => {
      // claude.ai を 新タブで開く (オーナーが Claude Code 使ってる場合は そっち、 ない場合は claude.ai)
      window.open('https://claude.ai/new', '_blank');
    });
    overlay.querySelector('#fp-dl-done').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function downloadAsFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  // (旧版 進捗トースト + Mac mini 経由 — v AR で廃止、 参考のため remained as comment)
  async function _oldTriggerDeliverable(client, type, taskTitle) {
    // 進捗トースト (右下に常駐)
    const toast = document.createElement('div');
    toast.id = 'fp-deliv-toast-' + Date.now();
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;padding:18px 22px;border-radius:12px;box-shadow:0 16px 40px rgba(91,91,240,0.4);z-index:10200;font-family:"Noto Sans JP",sans-serif;min-width:320px;';
    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:fp-deliv-spin 0.9s linear infinite;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10px;letter-spacing:0.18em;opacity:0.85;">📎 ${escapeHtml(taskTitle)}</div>
          <div style="font-size:13px;font-weight:800;margin-top:2px;">${escapeHtml(client.name)}さん の 資料を 作成中</div>
          <div style="font-size:11px;opacity:0.85;margin-top:2px;">Mac mini で生成中... <span class="fp-deliv-timer" style="font-variant-numeric:tabular-nums;">0</span>秒</div>
        </div>
      </div>
    `;
    if (!document.getElementById('fp-deliv-spin-style')) {
      const s = document.createElement('style'); s.id = 'fp-deliv-spin-style';
      s.textContent = '@keyframes fp-deliv-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(toast);
    const startMs = Date.now();
    const timer = setInterval(() => {
      const t = toast.querySelector('.fp-deliv-timer'); if (t) t.textContent = String(Math.floor((Date.now() - startMs) / 1000));
    }, 500);

    // 議事録+台帳データ集める
    const age = window.LifeEvents.currentAge(client);
    const family = (client.family || []).map(m => {
      const r = m.rel === 'spouse' ? '配偶者' : (m.rel === 'child' ? 'お子様' : m.rel);
      return `${r}${m.name}(${window.LifeEvents.currentAge({ birth: m.birth })}歳)`;
    }).join('/') || '単身';
    const clientCtx = `${age}歳 / ${client.occupation || '職業不明'} / 家族: ${family} / 管理資産¥${(client.aum || 0).toLocaleString()}`;
    let latestAi = null;
    ((window.LineAppLiveData && window.LineAppLiveData.ai_results) || []).forEach(r => {
      const match = (r.userId && r.userId === client.lineFriendId) || (r.customerName && r.customerName === client.name);
      if (!match) return;
      if (!latestAi || (r.ts || '') > (latestAi.createdAt || '')) latestAi = { summary: r.summary, transcript: r.transcript, createdAt: r.ts };
    });
    const sanitize = (s) => typeof s !== 'string' ? s : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1').replace(/[ -]/g, '');
    try {
      const result = await generateDeliverableViaMacMini({ type, client, clientCtx, taskTitle, latestAi, sanitize });
      const d = await result.json();
      clearInterval(timer);
      if (d.ok) {
        toast.style.background = 'linear-gradient(135deg,#10B981,#059669)';
        toast.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:32px;height:32px;background:rgba(255,255,255,0.22);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;">✓</div>
            <div style="flex:1;">
              <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10px;letter-spacing:0.18em;opacity:0.92;">DELIVERABLE READY</div>
              <div style="font-size:13px;font-weight:800;margin-top:2px;">${escapeHtml(client.name)}さん 資料完成</div>
              ${d.driveUrl ? `<a href="${d.driveUrl}" target="_blank" style="display:inline-block;margin-top:6px;background:#fff;color:#065F46;text-decoration:none;padding:6px 14px;border-radius:6px;font-size:11px;font-weight:800;">📎 PDF を開く</a>` : `<div style="font-size:11px;opacity:0.92;margin-top:2px;">Mac mini の ~/.skeleton-fp-deliverable/output/${d.macMiniReqId}.pdf</div>`}
            </div>
            <button onclick="this.parentElement.parentElement.remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:26px;height:26px;border-radius:5px;cursor:pointer;">✕</button>
          </div>
        `;
        setTimeout(() => toast.remove(), 60 * 1000);
      } else {
        toast.style.background = 'linear-gradient(135deg,#DC2626,#991B1B)';
        toast.innerHTML = `<div style="font-size:13px;font-weight:700;">❌ 失敗: ${escapeHtml(d.error || '不明')}</div><button onclick="this.parentElement.remove()" style="margin-top:8px;background:rgba(255,255,255,0.2);border:none;color:#fff;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:11px;">閉じる</button>`;
      }
    } catch (e) {
      clearInterval(timer);
      toast.style.background = 'linear-gradient(135deg,#DC2626,#991B1B)';
      toast.innerHTML = `<div style="font-size:13px;">❌ ${escapeHtml(e.message)}</div>`;
      setTimeout(() => toast.remove(), 8000);
    }
  }

  // ★ Mac mini Claude Code 経由で資料生成 (Firestore deliverable_requests を経由)
  // 既存の fetch API と 同じ shape ({ ok, html, error }) を返す
  async function generateDeliverableViaMacMini({ type, client, clientCtx, taskTitle, latestAi, sanitize }) {
    const { doc, collection, addDoc, serverTimestamp, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
    const db = window.__fp.db;
    // 1) リクエスト作成
    const payload = {
      status: 'pending',
      type,
      clientName: sanitize(client.name),
      clientCtx: sanitize(clientCtx),
      summary: sanitize((latestAi && latestAi.summary) || ''),
      transcript: sanitize((latestAi && latestAi.transcript) || ''),
      taskTitle: sanitize(taskTitle),
      fpName: window.__fp.tenantName || 'FP事務所',
      tenantId: window.__fp.tenantId,
      requestedBy: window.__fp.userEmail,
      createdAt: serverTimestamp(),
    };
    const docRef = await addDoc(collection(db, 'deliverable_requests'), payload);
    console.log('[macmini] request submitted:', docRef.id);

    // 2) 完了 or 失敗 まで onSnapshot で待機 (最大 3分)
    return new Promise((resolve) => {
      let timeoutId = setTimeout(() => {
        unsub(); resolve({ json: async () => ({ ok: false, error: 'Mac mini で3分以内に完了しませんでした (Mac mini が起動しているか確認してください)' }) });
      }, 3 * 60 * 1000);
      const unsub = onSnapshot(docRef, (snap) => {
        const data = snap.data();
        if (!data) return;
        if (data.status === 'completed') {
          clearTimeout(timeoutId); unsub();
          // HTML を読み戻すには Mac mini 上の output ファイルにアクセスする必要があるが、
          // 現状は driveUrl (Firebase Storage の token URL) を経由する
          // V1: HTML フィールドが Firestore に書き戻されてれば それを使う、 なければ URL リダイレクト
          resolve({ json: async () => ({
            ok: true,
            html: data.html || `<div style="padding:30px;text-align:center;font-family:'Noto Serif JP',serif;"><h2 style="color:#10B981;">✓ Mac mini で 生成完了</h2><p style="font-size:13px;color:#5E5648;margin-top:12px;">PDF は <code style="background:#F1ECDF;padding:2px 6px;border-radius:4px;">~/.skeleton-fp-deliverable/output/${snap.id}.pdf</code> に保存されました</p>${data.driveUrl ? `<p style="margin-top:18px;"><a href="${data.driveUrl}" target="_blank" style="display:inline-block;background:#06C755;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:800;font-size:13px;">📎 PDF をダウンロード</a></p>` : ''}</div>`,
            macMiniReqId: snap.id,
            driveUrl: data.driveUrl,
          }) });
        } else if (data.status === 'failed') {
          clearTimeout(timeoutId); unsub();
          resolve({ json: async () => ({ ok: false, error: 'Mac mini 生成失敗: ' + (data.errorMessage || '不明') }) });
        }
        // processing 中は 何もしない (subscription 継続)
      });
    });
  }

  async function generateDeliverableWithAI(type, taskTitle, client, resultEl) {
    const btn = document.getElementById('fp-deliv-ai');
    const useMacMini = localStorage.getItem('fp-deliv-via-macmini') !== '0';
    if (btn) { btn.disabled = true; btn.textContent = useMacMini ? '✨ Mac mini で生成中… (1〜2分)' : '✨ Claude 生成中… (30〜60秒)'; }
    // ★ オーナーfb「生成中ピルが overlay の後ろに隠れて見えない」+ 「緑タップで再生成バグ」
    // → 生成開始と同時にモーダルを即 hide。pill だけ前面に。完了クリックは display:flex で復元のみ (新規生成しない)
    const dModal = document.getElementById('fp-deliv-modal');
    if (dModal) dModal.style.display = 'none';
    const progressPill = showAiProgressPill(client, type, taskTitle, () => {
      // 完了 pill クリック: 既存モーダルの display を戻すだけ (再生成しない)
      const m = document.getElementById('fp-deliv-modal');
      if (m) {
        m.style.display = 'flex';
        // resultEl まで自動スクロール (結果が見えるように)
        setTimeout(() => { try { resultEl.scrollIntoView({behavior:'smooth', block:'start'}); } catch(_){} }, 100);
      }
    });
    // 議事録+台帳データ集める
    const myBks = ((window.LineAppLiveData && window.LineAppLiveData.bookings) || []).filter(b => b.userId === client.lineFriendId || b.name === client.name);
    let latestAi = null;
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith('fp-ai-'));
    allKeys.forEach(k => {
      try {
        JSON.parse(localStorage.getItem(k) || '[]').forEach(a => {
          // ★ genericFallback 撤去 — 厳密一致のみ
          const match = (a.userId && a.userId === client.lineFriendId) || (a.customerName && a.customerName === client.name);
          if (match && (!latestAi || new Date(a.createdAt || 0) > new Date(latestAi.createdAt || 0))) latestAi = a;
        });
      } catch (_) {}
    });
    ((window.LineAppLiveData && window.LineAppLiveData.ai_results) || []).forEach(r => {
      // ★ genericFallback 撤去 — 厳密一致のみ
      const match = (r.userId && r.userId === client.lineFriendId) || (r.customerName && r.customerName === client.name);
      if (!match) return;
      if (!latestAi || (r.ts || '') > (latestAi.createdAt || '')) {
        latestAi = { summary: r.summary, transcript: r.transcript, createdAt: r.ts };
      }
    });
    const age = window.LifeEvents.currentAge(client);
    const family = (client.family || []).map(m => {
      const r = m.rel === 'spouse' ? '配偶者' : (m.rel === 'child' ? 'お子様' : m.rel);
      const a = window.LifeEvents.currentAge({ birth: m.birth });
      return `${r}${m.name}(${a}歳)`;
    }).join('/') || '単身';
    const clientCtx = `${age}歳 / ${client.occupation || '職業不明'} / 家族: ${family} / 管理資産¥${(client.aum || 0).toLocaleString()}`;
    // ★ Claude API "invalid high surrogate" 対策: lone surrogate を除去 + 非可印字 制御文字を除去
    // 議事録/transcript に半端な絵文字 or 制御文字が混入してると Claude が JSON parse 失敗で 400 返す
    const sanitizeForJson = (s) => {
      if (typeof s !== 'string') return s;
      return s
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '') // lone high surrogate
        .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1') // lone low surrogate
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); // 非可印字制御文字 (改行/タブは温存)
    };
    // ★ v BG (20260610C): 資料作成は デフォルトで Anthropic 有料API を 一切 使わず、
    //   triggerDeliverable (JSON + プロンプト DL + clipboard + claude.ai/new) で
    //   FP事業者自身の Claude Code 購読版に流す。
    if (progressPill && progressPill._fpDone) progressPill._fpDone(true, '📋 プロンプトをコピーしてClaude起動');
    try { triggerDeliverable(client, type, taskTitle); }
    catch (e) { console.warn('triggerDeliverable fail:', e); }
    return;
  }

  // 16種テンプレ メニュー (6カテゴリ)
  function renderDeliverableMenu() {
    const cats = [
      { name: '💰 資産・収支', items: [
        ['cashflow', '📊', 'キャッシュフロー表 (10年)', '年齢×収入×支出×貯蓄'],
        ['emergency', '🆘', '緊急予備資金 計算書', '失職時に必要な最低資金 (生活費6ヶ月)'],
        ['kakei', '🏠', '家計診断シート', '固定費/変動費の最適化判定'],
      ]},
      { name: '🎓 ライフプラン・教育', items: [
        ['lifeplan', '📈', 'ライフプラン表', '主要イベント+コスト時系列'],
        ['education', '🎒', '教育費シミュレーション', '進路別 (公立〜私立) 必要総額'],
        ['mortgage', '🏡', '住宅ローン 繰上 vs 運用 判定', '3軸 (金利/残期間/控除残)'],
      ]},
      { name: '💹 投資・資産運用', items: [
        ['nisa', '💹', 'NISA / iDeCo 配分シミュ', '3パターン (積極/標準/安定)'],
        ['risk', '🎯', 'リスク許容度 診断シート', '15問で投資スタンス判定'],
      ]},
      { name: '🛡 保険・リスク管理', items: [
        ['insurance', '🛡', '保険 見直しレポート', '必要vs現状ギャップ'],
        ['hoshougaku', '💉', '必要保障額 詳細計算', '末子独立まで遺族生活費'],
      ]},
      { name: '👴 老後・退職', items: [
        ['retire', '🏖', '老後資金 必要額計算書', '月額×老後年数−年金見込'],
        ['taishokukin', '💼', '退職金 受取最適化シミュ', '一時金vs年金 税金比較'],
        ['kaigo', '🏥', '老後の医療・介護費 試算', '介護度別の月額負担'],
      ]},
      { name: '👨‍👩‍👧 相続・税金', items: [
        ['inherit', '👴', '相続 基礎控除 計算書', '3000万+600万×法定相続人'],
        ['zoyo', '🎁', '生前贈与 簡易シミュ', '年110万×7年加算ルール反映'],
        ['kakutei', '📄', '確定申告 簡易チェック (自営)', '青色控除/小規模共済/iDeCo'],
      ]},
      { name: '✏️ その他', items: [
        ['hearing', '📋', 'ヒアリングシート', 'アンケート10問まとめ'],
        ['custom', '✏️', '自由入力', 'タスク内容で AI が独自作成'],
      ]},
    ];
    return cats.map(cat => `
      <div style="margin-bottom:14px;">
        <div style="font-family:Manrope,sans-serif;font-size:10.5px;font-weight:800;letter-spacing:0.15em;color:#64748B;margin-bottom:6px;text-transform:uppercase;">${cat.name}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          ${cat.items.map(([t, ico, ttl, sub]) => `
            <button class="fp-deliv-type" data-type="${t}" style="background:#fff;border:1.5px solid #E2E8F0;border-radius:8px;padding:11px 14px;text-align:left;cursor:pointer;font-family:inherit;display:flex;align-items:flex-start;gap:9px;transition:border-color 0.15s,background 0.15s;">
              <span style="font-size:18px;line-height:1;">${ico}</span>
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:12px;color:#0F172A;line-height:1.3;">${ttl}</div>
                <div style="font-size:10.5px;color:#94A3B8;margin-top:2px;line-height:1.4;">${sub}</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  // 成果物プレビュー HTML 生成 (タイプ別)
  function renderDeliverablePreview(type, client) {
    const baseYear = new Date().getFullYear();
    const age = window.LifeEvents.currentAge(client);
    const surveys = (window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [];
    const s = surveys.find(x => x.userId === client.lineFriendId || x.name === client.name) || {};
    const inc = (s.q4_年収 || '').includes('1000') ? 900 : (s.q4_年収 || '').includes('700') ? 700 : 500;
    const hd = `<div style="background:linear-gradient(135deg,#10B981,#34D399);color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;">
      <div><strong style="font-size:14px;letter-spacing:0.04em;">{TITLE}</strong><div style="font-size:11px;opacity:0.9;margin-top:2px;">${escapeHtml(client.name)} 様 / ${age}歳 / 作成 ${new Date().toISOString().slice(0,10)}</div></div>
      <div style="display:flex;gap:6px;"><button data-deliv-print style="background:rgba(255,255,255,0.22);border:1px solid rgba(255,255,255,0.4);color:#fff;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;">🖨 印刷/PDF</button><button data-deliv-send style="background:#06C755;border:1px solid #06C755;color:#fff;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:800;cursor:pointer;">📤 LINE送信</button></div>
    </div>`;
    if (type === 'cashflow') {
      const rows = [];
      for (let i = 0; i <= 10; i++) {
        const y = baseYear + i;
        const a = age + i;
        const income = Math.round(inc * (a >= 65 ? 0.4 : 1));  // 65以降は年金想定
        const expense = Math.round(income * 0.7);
        const save = income - expense;
        rows.push(`<tr><td>${y}</td><td>${a}</td><td>¥${income}万</td><td>¥${expense}万</td><td style="color:${save>0?'#047857':'#B91C1C'};font-weight:700;">¥${save}万</td></tr>`);
      }
      return `<div class="fp-deliv-content" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
        ${hd.replace('{TITLE}', '📊 キャッシュフロー表 (向こう10年)')}
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#F8FAFC;"><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">西暦</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">年齢</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">年収</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">支出</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">貯蓄</th></tr></thead>
          <tbody>${rows.map(r => r.replace(/<td>/g, '<td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;">')).join('')}</tbody>
        </table>
        <div style="padding:12px 18px;background:#F8FAFC;font-size:11px;color:#64748B;border-top:1px solid #E2E8F0;">⚠ ドラフト: 年収/支出は概算。次フェーズで Claude が顧客データから精緻化。</div>
      </div>`;
    }
    if (type === 'lifeplan') {
      const evs = (window.LifeEvents.generate(client) || []).slice(0, 12);
      return `<div class="fp-deliv-content" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
        ${hd.replace('{TITLE}', '📈 ライフプラン表 (主要イベント12件)')}
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#F8FAFC;"><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">時期</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">イベント</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">対象</th></tr></thead>
          <tbody>${evs.map(e => `<tr><td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;">${new Date(e.date).toISOString().slice(0,10)}</td><td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;">${escapeHtml(e.label)}</td><td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;color:#64748B;">${escapeHtml(e.who || '—')}</td></tr>`).join('') || '<tr><td colspan="3" style="padding:16px;text-align:center;color:#94A3B8;">予測イベントなし</td></tr>'}</tbody>
        </table>
      </div>`;
    }
    if (type === 'nisa') {
      const propA = { 株式: 70, 債券: 20, REIT: 10 }, propB = { 株式: 50, 債券: 40, REIT: 10 }, propC = { 株式: 30, 債券: 60, REIT: 10 };
      const bar = (lbl, p, c) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11.5px;"><span style="width:60px;color:#475569;">${lbl}</span><div style="flex:1;height:18px;background:#F1F5F9;border-radius:4px;overflow:hidden;"><div style="width:${p}%;height:100%;background:${c};"></div></div><span style="width:36px;text-align:right;font-weight:700;">${p}%</span></div>`;
      return `<div class="fp-deliv-content" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
        ${hd.replace('{TITLE}', '💹 NISA / iDeCo 配分シミュレーション')}
        <div style="padding:18px;">
          ${[['積極型 (年齢40未満)', propA, '#EF4444'], ['標準型 (年齢40-55)', propB, '#5B5BF0'], ['安定型 (年齢55以降)', propC, '#10B981']].map(([t, p, c]) =>
            `<div style="margin-bottom:14px;"><div style="font-weight:800;font-size:12.5px;margin-bottom:6px;color:#0F172A;">${t}</div>${bar('株式', p.株式, c)}${bar('債券', p.債券, '#94A3B8')}${bar('REIT', p.REIT, '#F59E0B')}</div>`
          ).join('')}
        </div>
      </div>`;
    }
    if (type === 'insurance') {
      const rows = [['死亡保障', '5,000万', '3,000万', '-2,000万', '不足'], ['医療保障 (日額)', '15,000円', '8,000円', '-7,000円', '不足'], ['就業不能保障', '20万/月', '0', '-20万', '完全不足'], ['がん保障 (一時金)', '300万', '100万', '-200万', '不足']];
      return `<div class="fp-deliv-content" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
        ${hd.replace('{TITLE}', '🛡 保険 見直しレポート (必要 vs 現状)')}
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#F8FAFC;"><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">保障項目</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">必要</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">現状</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">差分</th><th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">判定</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;">${r[0]}</td><td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;text-align:right;">${r[1]}</td><td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;text-align:right;">${r[2]}</td><td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;text-align:right;color:#B91C1C;font-weight:700;">${r[3]}</td><td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;text-align:right;"><span style="background:#FEF2F2;color:#B91C1C;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;">${r[4]}</span></td></tr>`).join('')}</tbody>
        </table>
      </div>`;
    }
    // ---- 追加 11 種 ----
    const wrap = (title, inner) => `<div class="fp-deliv-content" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">${hd.replace('{TITLE}', title)}<div style="padding:18px;">${inner}</div></div>`;
    const tbl = (head, rows) => `<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#F8FAFC;">${head.map(h => `<th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:left;">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td style="padding:7px 10px;border-bottom:1px solid #F1F5F9;">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    if (type === 'emergency') {
      const monthlyExp = Math.round(inc * 0.55 / 12);  // 月支出推定
      const recommend = monthlyExp * 6;
      return wrap('🆘 緊急予備資金 計算書',
        `<div style="font-size:13px;line-height:1.85;margin-bottom:14px;">失職・病気・災害時、生活を維持する最低限資金 (推奨: 月支出×6ヶ月)</div>
         ${tbl(['項目','金額'],[['推定月支出',`¥${monthlyExp}万`],['推奨残高 (6ヶ月)',`<strong style="color:#5B5BF0;">¥${recommend}万</strong>`],['推奨残高 (安心 12ヶ月)',`¥${recommend*2}万`],['預入推奨先','普通預金 50% / 1年定期 50%']])}`);
    }
    if (type === 'kakei') {
      return wrap('🏠 家計診断シート',
        `${tbl(['カテゴリ','月額目安','収入比','判定'],[
          ['住居費 (家賃/ローン)','15万','25%','適正'],
          ['食費','7万','12%','適正'],
          ['通信費','2万','3%','削減余地'],
          ['保険料','3万','5%','適正'],
          ['交通費','2万','3%','適正'],
          ['趣味・交際','5万','8%','過剰'],
          ['貯蓄・投資','12万','20%','理想25%'],
        ])}<div style="margin-top:12px;background:#FEF3C7;border:1px solid #FBBF24;border-radius:6px;padding:10px 14px;font-size:12px;color:#78350F;">💡 通信費削減 + 趣味交際見直しで月5万浮かせます</div>`);
    }
    if (type === 'education') {
      return wrap('🎒 教育費シミュレーション (進路別)',
        tbl(['進路パターン','幼〜大学 総額','中受時必要貯金','備考'],[
          ['すべて公立','¥1,000万','¥0','王道'],
          ['高校から私立','¥1,500万','¥100万',''],
          ['中受 (私立中高一貫)','¥2,500万','¥500万','学費年100万'],
          ['小受 (私立小→私立大)','¥3,500万','¥1,000万',''],
          ['海外留学 (大学)','¥4,000万〜','¥1,500万','円安リスク'],
        ]));
    }
    if (type === 'mortgage') {
      return wrap('🏡 住宅ローン 繰上 vs 運用 判定',
        `${tbl(['判定軸','繰上有利','運用有利'],[
          ['金利水準','1%超 →繰上','1%未満 →運用'],
          ['ローン残期間','長い (20年+)','短い (10年-)'],
          ['住宅ローン控除 残期間','5年未満','10年以上'],
          ['手元現金','十分 (6ヶ月+)','少ない'],
        ])}<div style="margin-top:12px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px;padding:10px 14px;font-size:12px;color:#065F46;">✓ 判定: 3軸中 2軸が運用優位 → <strong>NISAつみたて投資推奨</strong></div>`);
    }
    if (type === 'risk') {
      return wrap('🎯 リスク許容度 診断シート',
        `<div style="font-size:13px;line-height:1.85;margin-bottom:12px;">下記15問でリスク許容度判定 (1問1〜5点で計算)</div>
         ${tbl(['No','質問','現在の点'],[
          ['1','投資経験 (0/1年/3年/5年+/10年+)','3'],
          ['2','元本割れ許容範囲 (0/-10/-20/-30/-50%)','3'],
          ['3','投資期間 (1年/3/5/10/20年+)','4'],
          ['4','収入の安定性','4'],
          ['5','緊急予備資金の有無','3'],
        ])}<div style="margin-top:12px;background:#EEF1FE;border:1px solid #C7D2FE;border-radius:6px;padding:10px 14px;font-size:12px;color:#3730A3;">合計17点 → <strong>標準型 (株式50% / 債券40% / REIT 10%)</strong></div>`);
    }
    if (type === 'hoshougaku') {
      return wrap('💉 必要保障額 詳細計算',
        tbl(['項目','金額','算出根拠'],[
          ['遺族生活費 (末子独立まで)','¥6,000万','月25万×20年'],
          ['住宅費 (団信なし想定)','¥2,000万',''],
          ['教育費 (公立想定)','¥1,500万','子2人'],
          ['葬儀費','¥300万',''],
          ['小計 (必要保障額)','<strong>¥9,800万</strong>',''],
          ['遺族年金 見込','-¥3,500万','月15万×20年'],
          ['配偶者就労収入','-¥4,800万','月20万×20年'],
          ['<strong>純必要保障</strong>','<strong style="color:#B91C1C;">¥1,500万</strong>','現契約と差分確認'],
        ]));
    }
    if (type === 'retire') {
      const yearsRetire = 30; const monthly = 25;
      const needed = monthly * 12 * yearsRetire;
      const pension = 2400;
      return wrap('🏖 老後資金 必要額計算書',
        `${tbl(['項目','金額'],[
          ['毎月の必要額',`月¥${monthly}万`],
          ['老後年数',`${yearsRetire}年`],
          ['総必要額',`¥${needed}万`],
          ['公的年金 見込',`-¥${pension}万`],
          ['<strong>不足額</strong>',`<strong style="color:#B91C1C;">¥${needed-pension}万</strong>`],
        ])}<div style="margin-top:12px;background:#FEF3C7;border:1px solid #FBBF24;border-radius:6px;padding:10px 14px;font-size:12px;color:#78350F;">💡 30代から月3万積立 (年利4%) で達成可能</div>`);
    }
    if (type === 'taishokukin') {
      return wrap('💼 退職金 受取最適化シミュ',
        `${tbl(['受取方法','手取り','税負担','備考'],[
          ['全額一時金','¥1,950万','¥50万','退職所得控除フル活用'],
          ['全額年金','¥1,750万','¥250万','公的年金等控除のみ'],
          ['一時金70% + 年金30%','<strong>¥1,920万</strong>','¥80万','<strong>推奨</strong>'],
        ])}<div style="margin-top:12px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px;padding:10px 14px;font-size:12px;color:#065F46;">✓ 一時金主体が税優遇大。年金枠を一部使い 控除上限まで取る</div>`);
    }
    if (type === 'kaigo') {
      return wrap('🏥 老後の医療・介護費 試算',
        tbl(['想定','月額負担','年負担','備考'],[
          ['健康な高齢期','¥3万','¥36万','医療費のみ'],
          ['要介護1〜2 (在宅)','¥10万','¥120万','訪問介護+デイ'],
          ['要介護3〜5 (施設)','¥15〜25万','¥180〜300万','特養 or 有料老人ホーム'],
          ['認知症 (グループホーム)','¥15万','¥180万','+食費光熱費'],
        ]));
    }
    if (type === 'inherit') {
      const heirs = (client.family || []).filter(m => m.rel !== 'self').length || 2;
      const base = 3000 + 600 * heirs;
      return wrap('👴 相続 基礎控除 計算書',
        `${tbl(['項目','金額'],[
          ['基礎控除額','¥3,000万 + 600万×法定相続人数'],
          ['法定相続人数 (推定)',`${heirs}名`],
          ['<strong>当家 基礎控除</strong>',`<strong style="color:#5B5BF0;">¥${base}万</strong>`],
          ['配偶者控除','¥1.6億 or 法定相続分'],
        ])}<div style="margin-top:12px;background:#EEF1FE;border:1px solid #C7D2FE;border-radius:6px;padding:10px 14px;font-size:12px;color:#3730A3;">💡 ¥${base}万以下なら相続税ゼロ。超える分は10〜55%課税</div>`);
    }
    if (type === 'zoyo') {
      return wrap('🎁 生前贈与 簡易シミュ',
        `${tbl(['制度','非課税枠','備考'],[
          ['暦年贈与','年110万/人','7年加算ルール (2024〜)'],
          ['相続時精算課税','2,500万累計','その後の暦年×'],
          ['教育資金一括','1,500万/孫','30歳まで'],
          ['結婚・子育て一括','1,000万','50歳まで'],
          ['住宅取得資金','500〜1,000万',''],
        ])}<div style="margin-top:12px;background:#FEF3C7;border:1px solid #FBBF24;border-radius:6px;padding:10px 14px;font-size:12px;color:#78350F;">💡 配偶者+子2人 → 暦年贈与年330万を10年で<strong>3,300万非課税移転</strong>可能</div>`);
    }
    if (type === 'kakutei') {
      return wrap('📄 確定申告 簡易チェック (自営業)',
        `<div style="font-size:13px;line-height:1.85;margin-bottom:12px;">事業所得 ¥800万の場合の節税余地</div>
         ${tbl(['節税策','年間節税額','加入難易度'],[
          ['青色申告特別控除','¥10〜21万','★'],
          ['小規模企業共済 (満額)','¥21万','★★'],
          ['iDeCo (月6.8万)','¥18万','★★'],
          ['倒産防止共済 (月20万)','¥36万','★★★'],
          ['国民年金基金','¥8万','★★'],
          ['<strong>合計</strong>','<strong style="color:#5B5BF0;">約¥80〜100万</strong>','—'],
        ])}`);
    }
    if (type === 'hearing') {
      return wrap('📋 ヒアリングシート (アンケート総括)',
        `<div style="font-size:13px;color:#64748B;margin-bottom:14px;">「📋ヒアリングシート」ボタンから 印刷可能版が開きます</div>
         ${tbl(['項目','回答'],[
          ['年代', s.q1_年代 || '—'],
          ['職業', s.q2_職業 || '—'],
          ['家族', s.q3_家族 || '—'],
          ['年収', s.q4_年収 || '—'],
          ['資産', s.q6_資産 || '—'],
          ['テーマ', s.q8_テーマ || '—'],
          ['悩み', s.q9_悩み || '—'],
        ])}`);
    }
    // custom
    return `<div class="fp-deliv-content" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
      ${hd.replace('{TITLE}', '✏️ カスタム資料')}
      <div style="padding:18px;">
        <textarea style="width:100%;min-height:200px;font-family:'Noto Sans JP',sans-serif;font-size:13px;line-height:1.7;padding:12px;border:1px solid #E2E8F0;border-radius:6px;" placeholder="このお客様向けに作成したい資料の内容を記入..."></textarea>
      </div>
    </div>`;
  }

  // ============================
  // ✍ 「伝えたいことから下書き」 — FP が短く意図を書く → AI が LINE 下書きに整える
  // generateLineReply(hint=brief) を流用
  // ============================
  // ★ v 20260610J: Claude Code フロー化 — paid API (generateLineReply) は呼ばない。
  //   triggerDeliverable と同じパターン: JSON+プロンプト構築 → clipboard 自動コピー → claude.ai/new 別タブ open
  // ★ オーナーfb 2026-06-20: 「日時指定 Zoom 予約」 — 1スロット 指定 → scheduleZoomDirect → Zoom予約 + LINE 送付
  function openScheduleZoomModal(client) {
    if (!client.lineFriendId) {
      alert('このお客様は LINE 未連携 です');
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);z-index:10200;display:flex;align-items:center;justify-content:center;padding:20px;';
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const defaultDate = tomorrow.toISOString().slice(0, 10);
    overlay.innerHTML = `
      <div style="background:#fff;width:min(540px,100%);max-height:92vh;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.35);font-family:'Noto Sans JP',sans-serif;overflow:hidden;display:flex;flex-direction:column;">
        <div style="background:linear-gradient(135deg,#2D8CFF,#1E6FE0);color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:14px;">
            <svg width="42" height="42" viewBox="0 0 100 100" style="border-radius:11px;box-shadow:0 4px 10px rgba(0,0,0,0.18);">
              <rect width="100" height="100" rx="22" fill="#fff"/>
              <text x="50" y="62" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="28" fill="#2D8CFF" letter-spacing="-1">zoom</text>
            </svg>
            <div>
              <div style="font-size:10.5px;font-weight:800;letter-spacing:0.16em;opacity:0.85;">SCHEDULE ZOOM</div>
              <div style="font-size:17.5px;font-weight:900;margin-top:2px;">📅 ${escapeHtml(client.name)} 様 と Zoom 予約</div>
            </div>
          </div>
          <button id="fp-sch-close" style="background:rgba(255,255,255,0.18);color:#fff;border:none;font-size:18px;cursor:pointer;width:36px;height:36px;border-radius:8px;font-family:inherit;">✕</button>
        </div>
        <div style="padding:24px 26px;overflow-y:auto;">
          <div style="font-size:11.5px;font-weight:800;letter-spacing:0.06em;color:#5B5BF0;margin-bottom:10px;">STEP 1 — 日時 を 1つ 指定</div>
          <div style="background:#F8FAFC;border:2px solid #E2E8F0;border-radius:12px;padding:16px 18px;margin-bottom:16px;">
            <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:10px;">
              <div>
                <div style="font-size:11px;font-weight:800;color:#64748B;letter-spacing:0.04em;margin-bottom:5px;">📆 日付</div>
                <input type="date" id="fp-sch-date" value="${defaultDate}" style="width:100%;padding:13px 12px;border:2px solid #E2E8F0;border-radius:10px;font-size:15.5px;font-weight:700;font-family:inherit;background:#fff;min-height:52px;">
              </div>
              <div>
                <div style="font-size:11px;font-weight:800;color:#64748B;letter-spacing:0.04em;margin-bottom:5px;">🕐 時刻</div>
                <input type="time" id="fp-sch-time" value="14:00" style="width:100%;padding:13px 12px;border:2px solid #E2E8F0;border-radius:10px;font-size:15.5px;font-weight:700;font-family:inherit;background:#fff;min-height:52px;">
              </div>
              <div>
                <div style="font-size:11px;font-weight:800;color:#64748B;letter-spacing:0.04em;margin-bottom:5px;">⏱ 時間 (分)</div>
                <select id="fp-sch-dur" style="width:100%;padding:13px 12px;border:2px solid #E2E8F0;border-radius:10px;font-size:15.5px;font-weight:700;font-family:inherit;background:#fff;min-height:52px;">
                  <option value="30">30分</option>
                  <option value="60" selected>60分</option>
                  <option value="90">90分</option>
                  <option value="120">120分</option>
                </select>
              </div>
            </div>
          </div>
          <div style="font-size:11.5px;font-weight:800;letter-spacing:0.06em;color:#5B5BF0;margin-bottom:10px;">STEP 2 — 添える 一言 (任意)</div>
          <textarea id="fp-sch-msg" rows="5" placeholder="お客様への一言 — 空欄で 標準メッセージ" style="width:100%;padding:14px 16px;border:2px solid #E2E8F0;border-radius:10px;font-size:14.5px;font-family:inherit;box-sizing:border-box;resize:vertical;line-height:1.7;min-height:120px;background:#fff;">${escapeHtml(client.name)}様\n\nZoom 面談の日時を確定しました。\n下記URLからご参加ください。</textarea>
          <div id="fp-sch-status" style="margin-top:14px;font-size:13.5px;font-weight:800;text-align:center;"></div>
        </div>
        <div style="background:#F8FAFC;padding:16px 24px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:10px;">
          <button id="fp-sch-cancel" style="background:#fff;color:#475569;border:2px solid #E2E8F0;padding:14px 24px;border-radius:11px;font-size:14.5px;font-weight:800;cursor:pointer;font-family:inherit;">キャンセル</button>
          <button id="fp-sch-send" style="background:linear-gradient(135deg,#2D8CFF,#1E6FE0);color:#fff;border:none;padding:14px 34px;border-radius:11px;font-size:15.5px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:0 8px 22px rgba(45,140,255,0.36);display:inline-flex;align-items:center;gap:8px;">📅 予約 + LINE 送信</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#fp-sch-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#fp-sch-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#fp-sch-send').addEventListener('click', async () => {
      const status = overlay.querySelector('#fp-sch-status');
      const sendBtn = overlay.querySelector('#fp-sch-send');
      const date = overlay.querySelector('#fp-sch-date').value;
      const time = overlay.querySelector('#fp-sch-time').value;
      const dur = parseInt(overlay.querySelector('#fp-sch-dur').value, 10);
      const msg = overlay.querySelector('#fp-sch-msg').value.trim();
      if (!date || !time) {
        status.style.color = '#DC2626'; status.textContent = '⚠ 日付 + 時刻 を 入力してください';
        return;
      }
      const confirmedSlot = `${date} ${time}`;
      sendBtn.disabled = true; sendBtn.textContent = '予約中…';
      status.style.color = '#2D8CFF'; status.textContent = '⏳ Zoom 予約 + LINE 送付中…';
      try {
        const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
        const fbApp = getApps()[0] || initializeApp({
          apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
          authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
          projectId: 'skeleton-fp-compass-632026',
        });
        const fns = getFunctions(fbApp, 'asia-northeast1');
        const fn = httpsCallable(fns, 'scheduleZoomDirect');
        const fsCustomerId = client._fsCustomerId || client.id;
        const res = await fn({ customerId: fsCustomerId, confirmedSlot, customMessage: msg, durationMin: dur });
        const data = (res && res.data) || {};
        if (data.ok) {
          status.style.color = '#059669';
          status.textContent = data.lineSent
            ? '✅ Zoom 予約完了 + LINE 送付済 (Meeting ID: ' + (data.zoomMeetingId || '?') + ')'
            : '⚠ Zoom 予約成功 だが LINE 送信失敗';
          sendBtn.textContent = '✓ 予約完了';
          // ★ Firestore データ即refresh → leadHub/Zoom予定 リスト 即反映
          try {
            if (window.refreshFirestoreCustomers) await window.refreshFirestoreCustomers();
            // 顧客ローカル更新 (zoomMeetingId が モーダル内 lookup で 使える ように)
            client.confirmedSlot = confirmedSlot;
            client.zoomUrl = data.zoomUrl;
            client.zoomMeetingId = String(data.zoomMeetingId || '');
          } catch (_) {}
          setTimeout(() => overlay.remove(), 2200);
        } else {
          throw new Error('応答 ok=false');
        }
      } catch (e) {
        console.error('[scheduleZoomDirect]', e);
        status.style.color = '#DC2626'; status.textContent = '❌ 失敗: ' + (e.message || e).slice(0, 200);
        sendBtn.disabled = false; sendBtn.textContent = '📅 予約 + LINE 送信';
      }
    });
  }

  // ★ オーナーfb 2026-06-20: 候補日 3つ を AI下書き と 同じ 2ペイン (入力 + iPhone live preview) で 送信
  function openSlotsSendModal(client) {
    if (!client.lineFriendId && !client._fsCustomerId) {
      alert('このお客様は LINE 未連携 です (lineFriendId 未登録)');
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);z-index:10200;display:flex;align-items:center;justify-content:center;padding:20px;';
    // default: 翌日〜3日後 の 10:00 11:00 13:00
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const defaults = [0, 1, 2].map(off => {
      const d = new Date(tomorrow); d.setDate(d.getDate() + off);
      return d.toISOString().slice(0, 10);
    });
    const defaultTimes = ['10:00', '14:00', '19:00'];
    const wdayJa = ['日','月','火','水','木','金','土'];
    const defaultMsg = `${client.name || 'お客様'}様\n\n次回 Zoom 面談 の 候補日 を 3つ お送りします。\nお好きな日を タップ してください。`;
    const companyName = (window.AccountInfo && window.AccountInfo.companyName) || 'FP Compass';

    overlay.innerHTML = `
      <div style="background:#fff;width:min(1100px,100%);max-height:92vh;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.35);font-family:'Noto Sans JP',sans-serif;overflow:hidden;display:flex;flex-direction:column;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#5B5BF0,#4242C9);color:#fff;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:10.5px;font-weight:800;letter-spacing:0.16em;opacity:0.85;">SEND CANDIDATE DATES</div>
            <div style="font-size:18px;font-weight:900;margin-top:2px;">📅 ${escapeHtml(client.name)} 様 へ 候補日 3つ を 送る</div>
          </div>
          <button id="fp-slots-close" style="background:rgba(255,255,255,0.18);color:#fff;border:none;font-size:18px;cursor:pointer;width:36px;height:36px;border-radius:8px;font-family:inherit;">✕</button>
        </div>
        <!-- 2 ペイン -->
        <div style="display:grid;grid-template-columns:1fr 380px;gap:0;flex:1;min-height:0;overflow:hidden;">
          <!-- 左: 入力 -->
          <div style="padding:24px 26px;overflow-y:auto;border-right:1px solid #E2E8F0;background:#F8FAFC;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:#5B5BF0;margin-bottom:10px;">STEP 1 — 候補日 3つ を 選ぶ</div>
            ${[1,2,3].map(i => `
              <div style="background:#fff;border:2px solid #E2E8F0;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
                <div style="font-size:12px;font-weight:900;color:#5B5BF0;letter-spacing:0.05em;margin-bottom:8px;">候補 ${i}</div>
                <div style="display:flex;gap:10px;align-items:center;">
                  <input type="date" id="fp-slot-d${i}" value="${defaults[i-1]}" style="flex:1.4;padding:13px 12px;border:2px solid #E2E8F0;border-radius:9px;font-size:15px;font-weight:700;font-family:inherit;min-height:50px;">
                  <input type="time" id="fp-slot-t${i}" value="${defaultTimes[i-1]}" style="flex:1;padding:13px 12px;border:2px solid #E2E8F0;border-radius:9px;font-size:15px;font-weight:700;font-family:inherit;min-height:50px;">
                </div>
              </div>
            `).join('')}
            <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:#5B5BF0;margin:24px 0 10px;">STEP 2 — 添える 一言</div>
            <textarea id="fp-slots-msg" rows="5" placeholder="お客様への一言..." style="width:100%;padding:14px 16px;border:2px solid #E2E8F0;border-radius:10px;font-size:14.5px;font-family:inherit;box-sizing:border-box;resize:vertical;line-height:1.7;min-height:120px;background:#fff;">${escapeHtml(defaultMsg)}</textarea>
          </div>
          <!-- 右: iPhone LIVE PREVIEW (Flex Carousel) -->
          <div style="padding:20px 18px 22px;background:linear-gradient(180deg,#475569,#1E293B);overflow-y:auto;">
            <div style="text-align:center;font-size:10.5px;font-weight:800;letter-spacing:0.16em;color:#fff;opacity:0.7;text-transform:uppercase;margin-bottom:12px;">LIVE PREVIEW · お客様 の iPhone</div>
            <div id="fp-slots-phone" style="position:relative;background:#8AB1D2;border-radius:28px;border:3px solid #0F172A;overflow:hidden;min-height:540px;display:flex;flex-direction:column;">
              <!-- Notch -->
              <div style="position:absolute;top:6px;left:50%;transform:translateX(-50%);width:90px;height:18px;background:#0F172A;border-radius:0 0 14px 14px;z-index:3;"></div>
              <!-- Status bar -->
              <div style="background:rgba(255,255,255,0.92);height:28px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-family:-apple-system,sans-serif;font-size:11px;font-weight:700;color:#0F172A;z-index:2;">
                <span>21:30</span>
                <span>●●● 5G</span>
              </div>
              <!-- LINE Header -->
              <div style="background:linear-gradient(180deg,#06C755,#05B14C);color:#fff;padding:10px 14px 9px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;font-weight:700;opacity:0.95;">‹</span>
                <div style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;">FP</div>
                <div>
                  <div style="font-size:13.5px;font-weight:800;">${escapeHtml(companyName)}</div>
                  <div style="font-size:10px;opacity:0.8;">公式アカウント</div>
                </div>
              </div>
              <!-- チャット -->
              <div id="fp-slots-chat" style="flex:1;background:linear-gradient(180deg,#8AB1D2,#A5C2DC);padding:14px 12px 18px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;">
                <!-- 動的に bubble + carousel が 描画される -->
              </div>
            </div>
          </div>
        </div>
        <!-- Footer (送信) -->
        <div style="background:#fff;padding:16px 24px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;gap:14px;">
          <div id="fp-slots-status" style="font-size:13.5px;font-weight:800;flex:1;"></div>
          <button id="fp-slots-cancel" style="background:#fff;color:#475569;border:2px solid #E2E8F0;padding:14px 24px;border-radius:11px;font-size:14.5px;font-weight:800;cursor:pointer;font-family:inherit;">キャンセル</button>
          <button id="fp-slots-send" style="background:linear-gradient(135deg,#06C755,#04A045);color:#fff;border:none;padding:14px 34px;border-radius:11px;font-size:15.5px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:0 8px 22px rgba(6,199,85,0.36);display:inline-flex;align-items:center;gap:8px;">📤 この内容で LINE 送信</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#fp-slots-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#fp-slots-cancel').addEventListener('click', () => overlay.remove());

    // === LIVE PREVIEW 更新 ===
    const updatePreview = () => {
      const chat = overlay.querySelector('#fp-slots-chat');
      const text = overlay.querySelector('#fp-slots-msg').value.trim();
      const slots = [1,2,3].map(i => ({
        date: overlay.querySelector('#fp-slot-d'+i).value,
        time: overlay.querySelector('#fp-slot-t'+i).value,
      }));
      let html = '';
      if (text) {
        html += `<div style="background:#fff;color:#0F172A;font-family:'Noto Sans JP',sans-serif;font-size:13px;line-height:1.65;padding:10px 14px;border-radius:4px 18px 18px 18px;white-space:pre-wrap;max-width:78%;box-shadow:0 1px 2px rgba(0,0,0,0.10);align-self:flex-start;">${escapeHtml(text)}</div>`;
      }
      const validSlots = slots.filter(s => s.date && s.time);
      if (validSlots.length > 0) {
        html += `<div style="display:flex;gap:8px;overflow-x:auto;margin-top:4px;padding-bottom:4px;align-self:stretch;">`;
        validSlots.forEach((s, i) => {
          const d = new Date(s.date + 'T00:00:00');
          const wday = wdayJa[d.getDay()];
          html += `
            <div style="flex-shrink:0;width:140px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.14);font-family:'Noto Sans JP',sans-serif;">
              <div style="background:#5B5BF0;color:#fff;padding:8px 12px;font-size:10.5px;font-weight:800;letter-spacing:0.08em;">候補 ${i+1}</div>
              <div style="padding:12px 14px;">
                <div style="font-size:22px;font-weight:900;color:#0F172A;line-height:1.1;letter-spacing:-0.025em;">${d.getMonth()+1}月${d.getDate()}日</div>
                <div style="font-size:12px;color:#64748B;font-weight:700;margin-top:2px;">(${wday})</div>
                <div style="border-top:1px solid #F1F5F9;margin-top:8px;padding-top:8px;display:flex;align-items:center;gap:5px;">
                  <span style="font-size:11px;">🕐</span>
                  <span style="font-size:14px;font-weight:800;color:#0F172A;">${s.time}</span>
                </div>
                <button style="margin-top:8px;width:100%;background:#5B5BF0;color:#fff;border:none;padding:7px 6px;border-radius:6px;font-size:11.5px;font-weight:800;font-family:inherit;cursor:default;">この日でお願いします</button>
              </div>
            </div>`;
        });
        html += `</div>`;
      }
      if (!html) {
        html = `<div style="background:rgba(255,255,255,0.6);color:#475569;font-size:11.5px;padding:10px 14px;border-radius:10px;font-style:italic;text-align:center;">日付 + 時刻 を入力すると ここに プレビュー が出ます</div>`;
      }
      chat.innerHTML = html;
    };
    overlay.querySelectorAll('input,textarea').forEach(el => {
      el.addEventListener('input', updatePreview);
      el.addEventListener('change', updatePreview);
    });
    updatePreview();

    overlay.querySelector('#fp-slots-send').addEventListener('click', async () => {
      const status = overlay.querySelector('#fp-slots-status');
      const sendBtn = overlay.querySelector('#fp-slots-send');
      const slots = [1,2,3].map(i => ({
        date: overlay.querySelector('#fp-slot-d'+i).value,
        time: overlay.querySelector('#fp-slot-t'+i).value,
      })).filter(s => s.date && s.time);
      if (slots.length < 3) {
        status.style.color = '#DC2626'; status.textContent = '⚠ 3つの 日付 + 時刻 全部 ご入力ください';
        return;
      }
      const text = overlay.querySelector('#fp-slots-msg').value.trim();
      const flex = {
        type: 'carousel',
        contents: slots.map((s, i) => {
          const d = new Date(s.date + 'T00:00:00');
          const wday = wdayJa[d.getDay()];
          const time = s.time;
          const replyTxt = `候補${i+1} (${(d.getMonth()+1)}月${d.getDate()}日 ${time}) でお願いします`;
          return {
            type: 'bubble', size: 'kilo',
            header: { type: 'box', layout: 'vertical', backgroundColor: '#5B5BF0', paddingAll: '12px', contents: [
              { type: 'text', text: `候補 ${i+1}`, color: '#ffffff', size: 'sm', weight: 'bold' },
            ] },
            body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: [
              { type: 'text', text: `${(d.getMonth()+1)}月${d.getDate()}日`, size: 'xxl', weight: 'bold', color: '#0F172A' },
              { type: 'text', text: `(${wday})`, size: 'md', color: '#64748B', weight: 'bold' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'baseline', margin: 'md', contents: [
                { type: 'text', text: '🕐', size: 'sm', flex: 0 },
                { type: 'text', text: time, size: 'lg', weight: 'bold', color: '#0F172A', margin: 'sm' },
              ] },
            ] },
            footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: [
              { type: 'button', style: 'primary', color: '#5B5BF0', height: 'sm',
                action: { type: 'message', label: 'この日でお願いします', text: replyTxt } },
            ] },
          };
        }),
      };
      sendBtn.disabled = true; sendBtn.textContent = '送信中…';
      status.style.color = '#5B5BF0'; status.textContent = '送信中…';
      try {
        const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
        const fbApp = getApps()[0] || initializeApp({
          apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
          authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
          projectId: 'skeleton-fp-compass-632026',
        });
        const fns = getFunctions(fbApp, 'asia-northeast1');
        const sendFn = httpsCallable(fns, 'sendLineMessage');
        const fsCustomerId = client._fsCustomerId || client.id;
        const callRes = await sendFn({
          customerId: fsCustomerId,
          lineFriendId: client.lineFriendId || null,
          text,
          flex,
        });
        const data = (callRes && callRes.data) || {};
        if (data.ok || data.success) {
          status.style.color = '#059669'; status.textContent = '✅ 送信完了 — ' + client.name + ' 様 の LINE に 届きました';
          sendBtn.textContent = '✓ 送信済';
          setTimeout(() => overlay.remove(), 2000);
        } else {
          status.style.color = '#DC2626'; status.textContent = '送信応答 ok=false';
          sendBtn.disabled = false; sendBtn.textContent = '📤 この内容で LINE 送信';
        }
      } catch (e) {
        console.error('[slots-send]', e);
        status.style.color = '#DC2626'; status.textContent = '送信失敗: ' + (e.message || e).slice(0, 200);
        sendBtn.disabled = false; sendBtn.textContent = '📤 この内容で LINE 送信';
      }
    });
  }

  function openBriefDraftModal(client) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10060;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:640px;width:100%;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;">
        <div style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:10px;font-weight:800;letter-spacing:0.22em;opacity:0.85;">FP → CUSTOMER</div>
            <h3 style="margin:4px 0 0 0;font-size:16px;font-weight:900;">✍ ${escapeHtml(client.name)}様 への LINE 下書き</h3>
          </div>
          <button id="fp-brief-close" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:34px;height:34px;border-radius:6px;cursor:pointer;font-size:18px;">✕</button>
        </div>
        <div style="padding:22px 24px;">
          <div id="fp-brief-step1">
            <div style="font-size:11px;font-weight:800;color:#475569;letter-spacing:0.06em;margin-bottom:8px;">📝 伝えたいことを 1-2 行で書く</div>
            <textarea id="fp-brief-input" rows="3" placeholder="例: 相続のテーマで来月会いたい / 新NISAの配分見直しを提案したい / お子様の進学費用シミュ作ってある旨を伝えたい" style="width:100%;padding:12px 14px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:13.5px;font-family:inherit;line-height:1.7;resize:vertical;box-sizing:border-box;"></textarea>
            <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div style="font-size:10.5px;color:#94A3B8;">${escapeHtml(client.name)}様の 家族 / 議事録 / LINE履歴 / アンケート回答 を Claude が 踏まえて 整えます</div>
              <button id="fp-brief-gen" style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none;padding:11px 22px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.04em;box-shadow:0 4px 14px rgba(16,185,129,0.35);">✨ AI で 下書き 生成</button>
            </div>
          </div>

          <div id="fp-brief-after" style="display:none;">
            <div style="background:linear-gradient(135deg,#F0FDF4,#fff);border:1px solid #BBF7D0;border-radius:10px;padding:14px 16px;margin-bottom:12px;font-size:12.5px;color:#065F46;">
              ✅ プロンプトを <strong>クリップボードに自動コピー</strong> しました。 prompt.txt も 念のため ダウンロード済。
            </div>
            <div style="background:#1F1A12;color:#FFE9A8;border-radius:10px;padding:18px;margin-bottom:10px;">
              <div style="font-family:'Inter',sans-serif;font-size:10px;letter-spacing:0.22em;color:#C5A268;font-weight:700;margin-bottom:4px;">STEP 1</div>
              <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:700;margin-bottom:10px;">Claude を開きます</div>
              <button id="fp-brief-open-claude" style="background:#FFE9A8;color:#1F1A12;border:none;padding:11px 22px;border-radius:7px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">🌐 Claude を開く</button>
            </div>
            <div style="background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:16px;margin-bottom:10px;">
              <div style="font-family:'Inter',sans-serif;font-size:10px;letter-spacing:0.22em;color:#94A3B8;font-weight:700;margin-bottom:4px;">STEP 2</div>
              <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:700;color:#1F1A12;margin-bottom:6px;">Cmd + V → Enter</div>
              <div style="font-size:12px;color:#475569;line-height:1.7;">Claude の 入力欄 に 貼り付け (Cmd+V) → Enter で 送信。 <strong>${escapeHtml(client.name)}様 専用</strong> の 自然な LINE 文面 が 出ます。</div>
            </div>
            <div style="background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:16px;">
              <div style="font-family:'Inter',sans-serif;font-size:10px;letter-spacing:0.22em;color:#94A3B8;font-weight:700;margin-bottom:4px;">STEP 3</div>
              <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:700;color:#1F1A12;margin-bottom:6px;">Claude の 出力 を コピー → LINE に 貼って 送信</div>
              <div style="font-size:12px;color:#475569;line-height:1.7;">Claude が 出した 文面 を コピー → このモーダルを閉じて、 LINE 履歴 タブの 下の <strong>送信欄</strong> に 貼って 「送信」 ボタンで お送り下さい。</div>
            </div>
            <div id="fp-brief-msg" style="margin-top:10px;font-size:12px;font-weight:700;text-align:center;"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#fp-brief-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    function buildBriefPrompt(c, brief, refineHistory) {
      const surveys = ((window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [])
        .filter(s => (s.userId && s.userId === c.lineFriendId) || (s.name && s.name === c.name) || (s.displayName && s.displayName === c.name))
        .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      const latestSurvey = surveys[0] || null;
      const allMeetings = ((window.LineAppLiveData && window.LineAppLiveData.ai_results) || [])
        .filter(r => (r.userId && r.userId === c.lineFriendId) || (r.customerName && r.customerName === c.name))
        .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''))
        .slice(-3)
        .map(r => ({ date: (r.ts || '').slice(0, 10), summary: (r.summary || '').slice(0, 600), key_concerns: r.key_concerns || [], predicted_next_questions: r.predicted_next_questions || [] }));
      const recentLine = (c.lineHistory || []).slice(-12)
        .map(m => ({ direction: m.direction || m.from || 'out', ts: m.ts, text: (m.text || '').slice(0, 240) }));
      const family = (c.family || []).map(m => {
        const r = m.rel === 'spouse' ? '配偶者' : (m.rel === 'child' ? 'お子様' : m.rel);
        const a = window.LifeEvents ? window.LifeEvents.currentAge({ birth: m.birth }) : null;
        return { relation: r, name: m.name, age: a, birth: m.birth };
      });
      const age = window.LifeEvents ? window.LifeEvents.currentAge(c) : null;
      const fpName = (window.__fp && window.__fp.tenantName ? String(window.__fp.tenantName) : 'FP事務所').replace(/ — DEMO ビュー/, '');

      // ★ Phase A 強化 (オーナーfb 2026-06-24):
      // [1] FP 過去送信文 (out 方向のみ 直近10通) → トーン 学習
      const fpToneSamples = (c.lineHistory || [])
        .filter(m => (m.direction === 'out' || m.from === 'fp' || m.from === 'system') && m.text)
        .slice(-10)
        .map(m => String(m.text).slice(0, 240));
      // [2] 客 過去質問 (Q&A archive cache: customer_qa_summary より優先、 無ければ lineHistory in から推定)
      const pastQuestions = (function(){
        try {
          const cs = (window._fpQACache && window._fpQACache[c.id]) || null;
          if (cs && cs.categories) {
            return cs.categories.flatMap(cat => (cat.questions || []).slice(0, 3).map(q => ({
              category: cat.name, q: typeof q === 'string' ? q : (q.q || '')
            }))).slice(0, 12);
          }
        } catch (_) {}
        return (c.lineHistory || [])
          .filter(m => (m.direction === 'in' || m.from === 'user') && /[?？]/.test(m.text || ''))
          .slice(-6)
          .map(m => ({ category: '不明', q: String(m.text).slice(0, 160) }));
      })();
      // [3] 提案 / キャンセル ステータス (触れていい/タブー 判断)
      const stalledProp = (c.proposals || []).slice().reverse().find(p => p.result === '提案中' || p.result === '検討中');
      const lastCancel = (c.cancellations || []).slice().sort((a,b) => new Date(b.date) - new Date(a.date))[0];
      const proposalStatus = {
        stalled: stalledProp ? { title: stalledProp.title, daysSince: Math.floor((Date.now() - new Date(stalledProp.date).getTime())/86400000) } : null,
        lastSuccess: (c.proposals || []).slice().reverse().find(p => p.result === '成約') || null,
        lastCancel: lastCancel ? { reason: lastCancel.reason, daysSince: Math.floor((Date.now() - new Date(lastCancel.date).getTime())/86400000) } : null,
      };
      // [4] タグ (FPが手動で つけた) + 自動タグ (議事録 AI 抽出)
      const tagsMaster = (typeof getTagsMaster === 'function') ? getTagsMaster() : [];
      const myTagIds = (typeof getClientTags === 'function') ? getClientTags(c.id) : [];
      const manualTags = myTagIds.map(id => tagsMaster.find(t => t.id === id)).filter(Boolean).map(t => t.label);
      const autoTags = Array.isArray(c.autoTags) ? c.autoTags.map(t => t.label) : [];

      const jsonPayload = {
        meta: { generatedAt: new Date().toISOString(), fpName, mode: 'line_reply_from_brief' },
        customer: {
          name: c.name,
          age,
          gender: c.gender === 'F' ? '女性' : (c.gender === 'M' ? '男性' : '不明'),
          occupation: c.occupation || '',
          family,
          aum: c.aum || 0,
          lastContact: c.lastContact || '',
          manualTags, autoTags,
        },
        surveyAnswers: latestSurvey ? {
          年代: latestSurvey.q2_年代 || latestSurvey.q1_年代 || '',
          職業: latestSurvey.q9_職業 || latestSurvey.q2_職業 || '',
          家族: latestSurvey.q3_家族 || '',
          年収: latestSurvey.q4_年収 || '',
          住居: latestSurvey.q10_住居 || latestSurvey.q5_住居 || '',
          悩み: latestSurvey.q9_悩み || latestSurvey.q5_悩み || '',
          理想: latestSurvey.q14_理想 || '',
          緊急度: latestSurvey.q15_緊急度 || '',
          相談テーマ: latestSurvey.q1_テーマ || latestSurvey.q8_テーマ || '',
        } : null,
        recentMeetings: allMeetings,
        recentLineHistory: recentLine,
        proposalStatus,
        pastQuestions,           // ★ 新規: 客が 過去 LINE で 聞いた 質問
        fpToneSamples,           // ★ 新規: FP の 過去 LINE 送信文 (トーン参考)
        fpBrief: brief,
        refineHistory: refineHistory || [], // ★ Phase C: 添削履歴 (前回 draft + FP の修正指示)
      };
      const refineSection = (refineHistory && refineHistory.length > 0) ? `

【★ 重要: 添削モード】
前回 生成した 下書き と FP からの修正指示が refineHistory にあります。
最新の修正指示に従って 文面を 練り直してください。
過去の指示 も 累積で 反映してください (例: 「丁寧に」 → 「もっとフランクに」 と来たら 中間の 親しみ易い丁寧 が 正解)。
` : '';

      return `あなたは 経験豊富な FP の 文章コーチ です。
下記 JSON の fpBrief (FP が ${escapeHtml(c.name)}様 に 伝えたい意図) を、
LINE 1通分 (200-400字、 顧客の家族/議事録/過去質問/直近やりとり を 踏まえた 個別感のある 文面) に 整えてください。
${refineSection}

【出力フォーマット 厳守】
- LINE文面 のみ。 前置き不要、 code fence 不要、 解説不要。
- 改行は自然に (LINE プレビューを意識)、 顧客の呼称は「${escapeHtml(c.name)}様」。
- 文末は柔らかく(「お時間あるときに 一言いただけたら嬉しいです」 等)。

【個別感を出すコツ (品質基準)】
- fpToneSamples を 参考に、 この FP らしい 文体・絵文字使い・改行リズム に 寄せる
- pastQuestions に ある カテゴリ を 1つ 自然に 触れる ("先日のご質問の○○の件…" 等)
- proposalStatus.stalled が ある なら 「先日の○○のご検討」 に 軽く触れる (押し売り NG)
- proposalStatus.lastCancel が 30日以内 なら キャンセル理由 を 暗黙に 配慮 (「お忙しい中」 等)
- recentMeetings.key_concerns の 1個 を 自然に 拾う (議事録の キーワード 引用)
- 議事録の predicted_next_questions が ある なら 客が 次に 聞きたい事に 先回りで 軽く触れる
- manualTags / autoTags は FP が この客に 持ってる 属性 (「教育資金AI」 等) → 該当テーマに 寄せる

【NG】
- 「お疲れ様でした」 「ありがとうございます」 だけの 定型挨拶 で 始めない
- 全顧客に 当てはまる 一般論 で 終わらせない (固有情報 最低2個 引用 必須)
- 強引なクロージング / 提案押し付け
- pastQuestions / fpToneSamples が 空でも 嘘の 過去質問 を 創作しない

【顧客データ JSON】
\`\`\`json
${JSON.stringify(jsonPayload, null, 2)}
\`\`\`

それでは 自然な LINE 1通分 を 作成してください。`;
    }

    function downloadAsFile(filename, content, mime) {
      try {
        const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      } catch (e) { console.warn('download fail:', e); }
    }

    // ★ Phase C: 添削履歴 (refine 用の state)
    const refineHistory = []; // [{ draft, instruction }]

    // ★ Phase A: Q&A archive cache を 先に 取得 (個別感UP)
    (async () => {
      try {
        if (!window._fpQACache) window._fpQACache = {};
        if (window._fpQACache[client.id] || !client.lineFriendId) return;
        const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
        const fs = getFirestore(window.__fp.app || window.__fp.firebaseApp || undefined);
        const tid = (window.__fp && window.__fp.tenantId) || '';
        if (!tid) return;
        const ref = doc(fs, 'customer_qa_summary', `${tid}__${client.lineFriendId}`);
        const snap = await getDoc(ref);
        if (snap.exists()) window._fpQACache[client.id] = snap.data();
      } catch (e) { /* silent */ }
    })();

    // ★ オーナーfb 2026-06-24: Sonnet / Groq 切替 state (デフォルト Groq=速度優先)
    let modelPref = 'groq'; // 'groq' | 'sonnet'

    async function runGenerate(brief, refineInstruction) {
      const genBtn = overlay.querySelector('#fp-brief-gen');
      const origLabel = genBtn ? genBtn.innerHTML : '';
      if (genBtn) { genBtn.disabled = true; genBtn.innerHTML = '✨ AI 生成中…'; }
      if (refineInstruction) {
        const prev = (overlay.querySelector('#fp-brief-result') || {}).value || '';
        refineHistory.push({ draft: prev, instruction: refineInstruction });
      }
      const prompt = buildBriefPrompt(client, brief, refineHistory);
      try {
        let reply = '';
        let usedModelLabel = '';
        let elapsedMs = 0;
        try {
          const r = await fetch('https://fp-compass-webhook-527726449426.asia-northeast1.run.app/api/generate-line-draft', {
            method: 'POST',
            headers: await (window.getFpAuthHeaders ? window.getFpAuthHeaders() : Promise.resolve({ 'Content-Type': 'application/json' })),
            body: JSON.stringify({
              prompt,
              model: modelPref === 'sonnet' ? 'sonnet' : 'groq',
              tenantId: (window.__fp && window.__fp.tenantId) || '',
              userId: client.lineFriendId || '',
              customerName: client.name || '',
            }),
          });
          const d = await r.json();
          if (r.ok && d.ok && d.reply) {
            reply = d.reply;
            usedModelLabel = d.modelLabel || (modelPref === 'sonnet' ? 'Claude Sonnet' : 'Groq Llama 70B');
            elapsedMs = d.elapsedMs || 0;
            console.log('[draft]', usedModelLabel, elapsedMs + 'ms', d.inputTokens + '/' + d.outputTokens + ' tok');
          } else {
            console.warn('[draft] endpoint fail → fallback Claude Haiku:', d.error || r.status);
          }
        } catch (e) { console.warn('[draft] fetch fail → fallback Claude Haiku:', e.message); }
        if (!reply) {
          if (!window.__fp?.functions) throw new Error('functions 未初期化');
          const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
          const fn = httpsCallable(window.__fp.functions, 'generateBriefDraft');
          const res = await fn({ prompt });
          reply = (res.data && res.data.reply) || '';
          usedModelLabel = 'Claude Haiku (fallback)';
        }
        if (!reply) throw new Error('AI 応答 が 空');
        renderResultUI(brief, reply, usedModelLabel, elapsedMs);
      } catch (e) {
        console.error('[generateBriefDraft]', e);
        try { await navigator.clipboard.writeText(prompt); } catch (_) {}
        const errMsg = String(e.message || e);
        const msgEl = overlay.querySelector('#fp-brief-msg');
        if (msgEl) {
          msgEl.style.color = '#B91C1C';
          msgEl.textContent = '⚠ AI生成失敗 (' + errMsg.slice(0,80) + ')。 プロンプト クリップボード コピー済';
        }
      } finally {
        if (genBtn && genBtn.innerHTML.includes('生成中')) { genBtn.disabled = false; genBtn.innerHTML = origLabel; }
      }
    }

    function renderResultUI(brief, reply, modelLabel, elapsedMs) {
      overlay.querySelector('#fp-brief-step1').style.display = 'none';
      const after = overlay.querySelector('#fp-brief-after');
      after.style.display = 'block';
      const refineBadge = refineHistory.length > 0
        ? `<span style="background:#5B5BF0;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;margin-left:8px;letter-spacing:0.04em;">${refineHistory.length} 回 添削</span>` : '';
      const modelTag = modelLabel
        ? `<span style="margin-left:auto;font-size:10px;font-weight:700;color:#475569;background:#F1F5F9;padding:2px 8px;border-radius:99px;">${escapeHtml(modelLabel)}${elapsedMs ? ' / ' + (elapsedMs/1000).toFixed(1) + '秒' : ''}</span>` : '';
      after.innerHTML = `
        <div style="background:linear-gradient(135deg,#F0FDF4,#fff);border:1px solid #BBF7D0;border-radius:10px;padding:14px 16px;margin-bottom:14px;font-size:12.5px;color:#065F46;font-weight:700;display:flex;align-items:center;">
          ✅ AI下書き 生成 完了 ${refineBadge} ${modelTag}
        </div>
        <!-- ★ Model toggle (Sonnet で 再生成 ボタン) -->
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11.5px;">
          <span style="color:#64748B;font-weight:700;">🎚 質をあげる:</span>
          <button id="fp-model-sonnet" style="background:${modelPref === 'sonnet' ? 'linear-gradient(135deg,#C19A3A,#8B6F26)' : '#fff'};color:${modelPref === 'sonnet' ? '#fff' : '#1F2A3F'};border:1px solid ${modelPref === 'sonnet' ? '#C19A3A' : '#CBD5E1'};padding:5px 12px;border-radius:99px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">🌟 Sonnet (3-5秒/質高)</button>
          <button id="fp-model-groq" style="background:${modelPref === 'groq' ? 'linear-gradient(135deg,#3F6B4C,#2C4D38)' : '#fff'};color:${modelPref === 'groq' ? '#fff' : '#1F2A3F'};border:1px solid ${modelPref === 'groq' ? '#3F6B4C' : '#CBD5E1'};padding:5px 12px;border-radius:99px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">⚡ Groq (1秒/速度)</button>
          <span style="color:#94A3B8;font-size:10.5px;">↑ ボタンで モデル切替 → 「再生成」 で 別モデル比較</span>
        </div>
        <div style="background:#fff;border:1.5px solid #BBF7D0;border-radius:12px;padding:18px 20px;margin-bottom:14px;">
          <div style="font-family:'Inter',sans-serif;font-size:10px;letter-spacing:0.18em;color:#059669;font-weight:800;margin-bottom:8px;">📝 LINE 下書き 案</div>
          <textarea id="fp-brief-result" rows="9" style="width:100%;padding:12px 14px;border:1px solid #E2E8F0;border-radius:8px;font-size:13.5px;font-family:inherit;line-height:1.85;resize:vertical;box-sizing:border-box;">${escapeHtml(reply)}</textarea>
        </div>
        <!-- ★ Phase C: 添削チャット UI -->
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-left:3px solid #5B5BF0;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
          <div style="font-size:11px;font-weight:800;color:#5B5BF0;letter-spacing:0.12em;margin-bottom:6px;">🔁 AI に 直してもらう</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
            <button class="fp-refine-quick" data-q="もっとフランクに" style="background:#fff;border:1px solid #CBD5E1;color:#475569;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">もっとフランクに</button>
            <button class="fp-refine-quick" data-q="もっと丁寧に" style="background:#fff;border:1px solid #CBD5E1;color:#475569;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">もっと丁寧に</button>
            <button class="fp-refine-quick" data-q="もっと短く (100字以内)" style="background:#fff;border:1px solid #CBD5E1;color:#475569;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">短く</button>
            <button class="fp-refine-quick" data-q="数字を入れてもっと具体的に" style="background:#fff;border:1px solid #CBD5E1;color:#475569;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">数字 入れる</button>
            <button class="fp-refine-quick" data-q="絵文字を1-2個 入れて 柔らかく" style="background:#fff;border:1px solid #CBD5E1;color:#475569;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">絵文字</button>
            <button class="fp-refine-quick" data-q="押し売り感を消して もっと相手のペースに寄せて" style="background:#fff;border:1px solid #CBD5E1;color:#475569;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">押し売り感 消す</button>
          </div>
          <div style="display:flex;gap:6px;">
            <input id="fp-refine-input" type="text" placeholder="例: お子様の名前を 入れて / 結論を先に / etc" style="flex:1;padding:8px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:12.5px;font-family:inherit;">
            <button id="fp-refine-go" style="background:#5B5BF0;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;">🔁 直す</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
          <button id="fp-brief-back" style="background:#fff;border:1px solid #E2E8F0;color:#475569;padding:10px 18px;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;">← 入力に戻る</button>
          <button id="fp-brief-copy" style="background:#fff;border:1px solid #10B981;color:#059669;padding:10px 18px;border-radius:8px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;">📋 コピー</button>
          <button id="fp-brief-send-line" style="background:linear-gradient(135deg,#06c755,#04a045);color:#fff;border:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px rgba(6,199,85,0.4);">📤 LINE で 送信</button>
        </div>
        <div id="fp-brief-msg" style="margin-top:10px;font-size:11.5px;font-weight:700;text-align:center;color:#059669;"></div>`;
      bindResultButtons(brief);
    }

    function bindResultButtons(brief) {
      const after = overlay.querySelector('#fp-brief-after');
      // ★ Model toggle
      after.querySelector('#fp-model-sonnet')?.addEventListener('click', () => {
        modelPref = 'sonnet';
        runGenerate(brief, '前回と同じ意図で 別モデル (Claude Sonnet) で 再生成 してください');
      });
      after.querySelector('#fp-model-groq')?.addEventListener('click', () => {
        modelPref = 'groq';
        runGenerate(brief, '前回と同じ意図で 速度優先モデル (Groq Llama) で 再生成 してください');
      });
      after.querySelectorAll('.fp-refine-quick').forEach(btn => {
        btn.addEventListener('click', () => runGenerate(brief, btn.dataset.q));
      });
      after.querySelector('#fp-refine-go').addEventListener('click', () => {
        const inp = after.querySelector('#fp-refine-input');
        const v = (inp.value || '').trim();
        if (!v) { inp.focus(); return; }
        inp.value = '';
        runGenerate(brief, v);
      });
      after.querySelector('#fp-refine-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') after.querySelector('#fp-refine-go').click();
      });
      after.querySelector('#fp-brief-back').addEventListener('click', () => {
        overlay.querySelector('#fp-brief-step1').style.display = 'block';
        after.style.display = 'none';
        refineHistory.length = 0;
        const genBtn = overlay.querySelector('#fp-brief-gen');
        if (genBtn) { genBtn.disabled = false; genBtn.innerHTML = '✨ AI で 下書き 生成'; }
      });
      after.querySelector('#fp-brief-copy').addEventListener('click', async () => {
        const t = after.querySelector('#fp-brief-result').value;
        try { await navigator.clipboard.writeText(t); after.querySelector('#fp-brief-msg').textContent = '✓ コピー しました'; } catch (_) {}
      });
      bindSendLine(after);
    }

    function bindSendLine(after) {
      after.querySelector('#fp-brief-send-line').addEventListener('click', async () => {
        const sendBtn = after.querySelector('#fp-brief-send-line');
        const msgEl = after.querySelector('#fp-brief-msg');
        const text = after.querySelector('#fp-brief-result').value.trim();
        if (!text) { msgEl.style.color = '#B91C1C'; msgEl.textContent = '⚠ 本文が空です'; return; }
        if (!client.lineFriendId) { msgEl.style.color = '#B91C1C'; msgEl.textContent = '⚠ この客は LINE 未連携'; return; }
        if (!confirm(`${client.name || 'お客様'} 様 に この文面で LINE を送信します。 よろしいですか?\n\n${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`)) return;
        sendBtn.disabled = true; sendBtn.textContent = '送信中…';
        msgEl.style.color = '#9A5A18'; msgEl.textContent = '⏳ LINE 送信中…';
        try {
          const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
          const fn = httpsCallable(window.__fp.functions, 'sendLineMessage');
          const res = await fn({ lineFriendId: client.lineFriendId, text, customerId: client._fsCustomerId || client.id });
          if (res.data && res.data.ok) {
            msgEl.style.color = '#059669'; msgEl.textContent = '✓ 送信完了';
            sendBtn.textContent = '✓ 送信済'; sendBtn.style.background = '#065F46';
            try { client.lineHistory = client.lineHistory || []; client.lineHistory.push({ direction: 'out', text, ts: new Date().toISOString(), via: 'brief-draft' }); } catch (_) {}
            setTimeout(() => overlay.remove(), 1500);
          } else { throw new Error((res.data && res.data.error) || 'LINE送信失敗'); }
        } catch (e) {
          console.error('[brief send line]', e);
          msgEl.style.color = '#B91C1C'; msgEl.textContent = '❌ 送信失敗: ' + (e.message || String(e)).slice(0, 100);
          sendBtn.disabled = false; sendBtn.textContent = '📤 LINE で 送信';
        }
      });
    }

    overlay.querySelector('#fp-brief-gen').addEventListener('click', async () => {
      const brief = overlay.querySelector('#fp-brief-input').value.trim();
      if (!brief) { alert('伝えたいこと を 入力してください'); return; }
      refineHistory.length = 0;
      await runGenerate(brief);
    });

    overlay.querySelector('#fp-brief-after').addEventListener('click', (e) => {
      if (e.target.closest('#fp-brief-open-claude')) {
        window.open('https://claude.ai/new', '_blank');
      }
    });
    setTimeout(() => overlay.querySelector('#fp-brief-input').focus(), 100);
  }

  function openDraftReplyModal(client, events, recs) {
    const draft = generateDraftReply(client, events, recs);
    const topRec = recs[0];
    const initial = (client.name || '?').replace(/\s+/g, '').slice(0, 1);
    const days = daysSince(client.lastContact);
    const futureEvs = events.filter(ev => new Date(ev.date) >= TODAY);
    const nextEv = futureEvs[0];

    // Build context bullets
    const contextItems = [];
    contextItems.push({ icon: 'clock', text: `最終接触 ${days == null ? '<strong>未記録</strong>' : `<strong>${days}日前</strong> (${escapeHtml(client.lastContact || '')})`}` });
    if (nextEv) {
      contextItems.push({ icon: 'calendar', text: `次のライフイベント: <strong>${escapeHtml(nextEv.label)}</strong> (${window.LifeEvents.formatRelative(nextEv.date)})` });
    }
    contextItems.push({ icon: 'briefcase', text: `${escapeHtml(client.occupation || '—')} / AUM <strong>¥${fmtMoney(client.aum)}</strong>` });
    const lastProp = (client.proposals || []).slice(-1)[0];
    if (lastProp) {
      contextItems.push({ icon: 'file-text', text: `直近提案: <strong>${escapeHtml(lastProp.title)}</strong> (${lastProp.result})` });
    }
    if (client.cancellations && client.cancellations.length) {
      const recent = client.cancellations[client.cancellations.length - 1];
      const daysFromCancel = Math.max(0, Math.floor((TODAY - new Date(recent.date)) / 86400000));
      contextItems.push({ icon: 'alert-triangle', text: `<strong>直近キャンセル ${daysFromCancel}日前</strong> (理由: ${escapeHtml(recent.reason || '不明')})` });
    }

    // Post-send task queue
    const postSendTasks = [
      { icon: 'check-circle-2', text: `「${escapeHtml(topRec ? topRec.action : draft.intent)}」を <strong>対応中</strong> に変更` },
      { icon: 'bell', text: `<strong>7日後</strong>未返信なら自動リマインド` },
      { icon: 'history', text: `顧客タイムラインに <strong>「${escapeHtml(draft.intent)} 送信」</strong> を記録` },
    ];

    const html = `
      <div class="aib-modal">
        <button class="cd-close" id="draft-close" aria-label="閉じる"><i data-lucide="x"></i></button>

        <div class="aib-header">
          <div class="aib-header-left">
            <span class="aib-eyebrow"><i data-lucide="sparkles"></i>AI ACTION BRIEF</span>
            <h2 class="aib-title">${escapeHtml(client.name)} 様 への対応プラン</h2>
            <div class="aib-sub">AI がこの方の状況を分析して、いま送るべき文面まで一気に用意しました。</div>
          </div>
          <div class="aib-client-chip">
            <span class="aib-client-avatar">${escapeHtml(initial)}</span>
            <div>
              <div class="aib-client-name">${escapeHtml(client.name)}</div>
              <div class="aib-client-meta">${window.LifeEvents.currentAge(client)}歳 / ${escapeHtml(client.occupation || '—')}</div>
            </div>
          </div>
        </div>

        <div class="aib-body" style="display:grid !important;grid-template-columns:400px 1fr !important;gap:18px;align-items:start;padding:24px 28px 28px !important;">
          <!-- 左カラム: 議事録ペイン (常時表示・自然スクロール) -->
          <aside id="aib-minutes-pane" style="background:linear-gradient(180deg,#F8FAFC,#FFFFFF);border:2px solid #5B5BF0;border-radius:12px;padding:16px 18px;font-size:12px;line-height:1.6;color:#0F172A;box-shadow:0 8px 24px rgba(91,91,240,0.15);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #C7D2FE;">
              <span style="font-size:20px;">📋</span>
              <div style="flex:1;">
                <strong style="font-size:13.5px;letter-spacing:0.02em;color:#3730A3;display:block;">議事録 (左) を見ながら LINE (右) を編集</strong>
                <span style="font-size:10.5px;color:#64748B;">Jobs の提案が議事録に合ってるか この場で確認</span>
              </div>
            </div>
            <div id="aib-minutes-body" style="font-size:12px;color:#475569;">
              <div style="text-align:center;padding:20px;color:#94A3B8;">📡 議事録 読み込み中…</div>
            </div>
          </aside>
          <div class="aib-body-right" style="display:flex;flex-direction:column;gap:18px;min-width:0;">

          <!-- STEP 1: AI Analysis -->
          <section class="aib-step">
            <div class="aib-step-head">
              <span class="aib-step-no">1</span>
              <div>
                <div class="aib-step-title">AI が状況を分析</div>
                <div class="aib-step-sub">優先度・タイミング・直近の動きから「いま動くべき」と判定</div>
              </div>
              <span class="aib-step-status aib-step-done"><i data-lucide="check"></i>完了</span>
            </div>
            <div class="aib-step-body">
              <div class="aib-verdict">
                <div class="aib-verdict-label">推奨アクション</div>
                <div class="aib-verdict-action">${escapeHtml(topRec ? topRec.action : draft.intent)}</div>
                <div class="aib-verdict-reason"><i data-lucide="lightbulb"></i><span>${escapeHtml(topRec ? topRec.reason : draft.reason)}</span></div>
              </div>
              <ul class="aib-context">
                ${contextItems.map(c => `<li><i data-lucide="${c.icon}"></i><span>${c.text}</span></li>`).join('')}
              </ul>
            </div>
          </section>

          <!-- STEP 2: AI Generated Draft -->
          <section class="aib-step">
            <div class="aib-step-head">
              <span class="aib-step-no">2</span>
              <div>
                <div class="aib-step-title">AI が文面を生成</div>
                <div class="aib-step-sub">そのまま送れる LINE 文面。編集できます。</div>
              </div>
              <span class="aib-step-status aib-step-done"><i data-lucide="check"></i>生成済</span>
            </div>
            <div class="aib-step-body">
              <div class="aib-draft-meta" style="flex-wrap:wrap;gap:8px;">
                <span class="aib-intent">${escapeHtml(draft.intent)}</span>
                <span class="aib-tone-label">トーン: 丁寧</span>
                <button class="aib-tone-btn" id="draft-regen"><i data-lucide="refresh-cw"></i>別のトーンで再生成</button>
                <button class="aib-tone-btn" id="draft-claude-regen" style="background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;border-color:#5B5BF0;font-weight:800;letter-spacing:0.04em;">✨ Claude で この方専用に超個別化生成</button>
              </div>
              <div class="aib-textarea-wrap" style="position:relative;">
                <div id="draft-claude-overlay" style="display:none;position:absolute;inset:0;background:rgba(255,255,255,0.92);z-index:5;align-items:center;justify-content:center;flex-direction:column;gap:14px;border-radius:8px;">
                  <div style="width:46px;height:46px;border:4px solid #C7D2FE;border-top-color:#5B5BF0;border-radius:50%;animation:fp-ai-spin 0.9s linear infinite;"></div>
                  <div style="font-weight:800;color:#5B5BF0;font-size:14px;">✨ Claude が ${escapeHtml(client.name)} 様 専用に下書きを生成中</div>
                  <div style="font-size:11px;color:#64748B;text-align:center;line-height:1.6;">家族構成・最終接触・議事録・提案履歴・LINE 履歴・<br>ライフイベント を全て読み込んで、本気の下書きを生成しています (10-20秒)</div>
                </div>
                <textarea id="draft-text" class="aib-textarea">${escapeHtml(draft.body)}</textarea>
              </div>
              <div class="aib-attach">
                <label class="aib-attach-item"><input type="checkbox" id="aib-attach-slots" checked> <i data-lucide="calendar-clock"></i><span>次回面談候補日3つを「予約カード」で送る</span></label>
                <label class="aib-attach-item"><input type="checkbox" id="aib-attach-pdf"> <i data-lucide="paperclip"></i><span>関連資料 PDF を添付 (${escapeHtml(client.name || 'お客様')}様向け)</span></label>
              </div>

              <!-- FP-side: Google Calendar suggested slots + week view -->
              <div class="aib-cal" id="aib-cal">
                <div class="aib-cal-head">
                  <span class="aib-cal-eyebrow">
                    <i data-lucide="calendar-check"></i>
                    <span>あなたのカレンダーから空きを抽出</span>
                    <span class="aib-cal-source">Google Calendar 連携中</span>
                  </span>
                  <div class="aib-cal-actions">
                    <button class="aib-cal-btn" id="aib-cal-regen"><i data-lucide="refresh-cw"></i><span>別の3つ</span></button>
                    <button class="aib-cal-btn" id="aib-cal-add"><i data-lucide="plus"></i><span>手動で追加</span></button>
                  </div>
                </div>
                <div class="aib-cal-split">
                  <div class="aib-cal-left">
                    <div class="aib-cal-subhead">お客様に提示する候補</div>
                    <div class="aib-cal-grid" id="aib-cal-grid"></div>
                    <div class="aib-cal-confirm">
                      <i data-lucide="info"></i>
                      <span>上記でお客様にアポを取ります。よろしければ <strong>STEP 3 で送信</strong>。</span>
                    </div>
                  </div>
                  <div class="aib-cal-right">
                    <div class="aib-cal-subhead">
                      <i data-lucide="calendar"></i><span>あなたの予定 (次の7日)</span>
                      <button class="aib-gcal-btn" id="aib-gcal-toggle"><i data-lucide="external-link"></i><span>Google Calendar を開く</span></button>
                    </div>
                    <div class="aib-week" id="aib-week"></div>
                    <details class="aib-gcal-embed">
                      <summary><i data-lucide="monitor"></i><span>本物の Google Calendar を埋め込み表示</span></summary>
                      <div class="aib-gcal-iframe-wrap">
                        <iframe src="https://calendar.google.com/calendar/embed?showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=0&height=400&wkst=2&bgcolor=%23ffffff&src=ja.japanese%23holiday%40group.v.calendar.google.com&ctz=Asia%2FTokyo" style="border-width:0" width="100%" height="380" frameborder="0" scrolling="no"></iframe>
                        <div class="aib-gcal-note">サンプル表示 (日本の祝日カレンダー)。本番では FP のメインカレンダーに切替。</div>
                      </div>
                    </details>
                  </div>
                </div>
              </div>

              <!-- LINE preview (iPhone風 Flex Message ライブビュー) -->
              <div class="aib-preview" id="aib-preview-area">
                <div class="aib-preview-head">
                  <i data-lucide="smartphone"></i>
                  <span>LIVE PREVIEW — お客様 の iPhone</span>
                </div>
                <div class="aib-preview-phone" id="aib-preview-phone">
                  <div class="aib-line-header">
                    <span class="aib-line-back">‹</span>
                    <div class="aib-line-avatar">FP</div>
                    <div>
                      <div class="aib-line-name">${escapeHtml((window.AccountInfo && window.AccountInfo.companyName) || 'FP Compass')}</div>
                      <div class="aib-line-sub">公式アカウント</div>
                    </div>
                  </div>
                  <div class="aib-line-chat">
                    <div class="aib-preview-bubble" id="aib-preview-text"></div>
                    <div class="aib-preview-carousel" id="aib-preview-carousel"></div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 送信エリア (オーナーfb 2026-06-20: 「送信→タスク自動化」 説明 全削除、 送信ボタンのみ) -->
          <section class="aib-step aib-step-final">
            <div class="aib-step-body" style="padding-top:14px;">
              <div class="aib-cta-row">
                <button class="primary aib-send" id="draft-send"><i data-lucide="send"></i><span>この内容で LINE 送信</span></button>
                <button class="ghost-btn" id="draft-copy"><i data-lucide="copy"></i><span>文面コピー</span></button>
                <button class="ghost-btn" id="draft-close-btn"><i data-lucide="x"></i><span>キャンセル</span></button>
              </div>
              <div id="draft-msg" class="aib-msg"></div>
            </div>
          </section>

          </div><!-- /aib-body-right -->
        </div>
      </div>
    `;
    const mc = document.getElementById('modal-content');
    mc.innerHTML = html;
    // AI BRIEF だけ幅広 (議事録 + LINE 編集の2カラム用)
    mc.style.maxWidth = '1500px';
    document.getElementById('modal-overlay').style.display = 'flex';
    // ★ リロード復元用: AI BRIEF 開いてることを記録
    try { localStorage.setItem('fp-last-open-mode', 'brief'); localStorage.setItem('fp-last-open-client', client.id); } catch (_) {}

    // ★ オーナーfb「議事録を横に広げて確認しながら LINE 編集」
    // 左ペインに 全fp-ai-* + ai_results から見つかる議事録を強力 fallback で表示
    (function() {
      const body = document.getElementById('aib-minutes-body');
      if (!body) return;
      const myUids = new Set([client.lineFriendId].filter(Boolean));
      const myBks = ((window.LineAppLiveData && window.LineAppLiveData.bookings) || [])
        .filter(b => (b.userId && b.userId === client.lineFriendId) || (b.name && b.name === client.name));
      myBks.forEach(b => { if (b.userId) myUids.add(b.userId); });
      const myTs = new Set(myBks.map(b => b.ts).filter(Boolean));
      const myNames = new Set([client.name].concat(myBks.map(b => b.name).filter(Boolean)));
      const found = [];
      const consider = (a, srcKey) => {
        if (!a || (!a.summary && !a.transcript)) return;
        // ★ strict match のみ (汎用 fallback 廃止: 「お客様」名義は他客へ漏れるためAI prompt にも使わない)
        const matchUser = a.userId && client.lineFriendId && a.userId === client.lineFriendId;
        const matchTs   = a.bookingTs && myTs.has(a.bookingTs);
        const matchName = a.customerName && a.customerName !== 'お客様' && a.customerName === client.name;
        const score = matchUser ? 3 : matchTs ? 3 : matchName ? 2 : 0;
        if (score > 0) {
          let kc = a.key_concerns;
          if (typeof kc === 'string') { try { kc = JSON.parse(kc); } catch (_) { kc = []; } }
          found.push({ source: srcKey, score, summary: a.summary || '', concerns: kc || [], ts: a.createdAt || a.ts || a.bookingTs || '', cust: a.customerName || '(空)' });
        }
      };
      Object.keys(localStorage).filter(k => k.startsWith('fp-ai-')).forEach(k => {
        try { JSON.parse(localStorage.getItem(k) || '[]').forEach(a => consider(a, k)); } catch (_) {}
      });
      ((window.LineAppLiveData && window.LineAppLiveData.ai_results) || []).forEach(r => consider(r, 'GAS:ai_results'));
      // 重複除去 + 最新順
      const seen = new Set();
      const uniq = found.filter(f => {
        const k = (f.summary || '').slice(0, 100);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).sort((a, b) => b.score - a.score || String(b.ts).localeCompare(String(a.ts)));
      window._fpDraftMinutesFound = uniq;
      if (uniq.length === 0) {
        body.innerHTML = `
          <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:10px 12px;color:#7F1D1D;font-size:11.5px;line-height:1.6;">
            <strong>議事録 見つかりません</strong><br>
            この顧客 (${escapeHtml(client.name)}) の lineFriendId = "${escapeHtml(client.lineFriendId || '空')}" でマッチする AI議事録が無いです。<br><br>
            <strong>localStorage 全 fp-ai-* キー:</strong><br>
            ${Object.keys(localStorage).filter(k => k.startsWith('fp-ai-')).map(k => `<code style="font-size:10px;background:#fff;padding:1px 4px;border-radius:3px;display:inline-block;margin:1px;">${escapeHtml(k)}</code>`).join('') || '<em>(なし)</em>'}
          </div>
        `;
        return;
      }
      body.innerHTML = uniq.map((f, i) => `
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:10.5px;font-weight:800;color:#5B5BF0;letter-spacing:0.04em;">議事録 #${i + 1}${f.score >= 3 ? ' (確定)' : f.score >= 2 ? ' (名前一致)' : ' (推定)'}</span>
            <span style="font-size:10px;color:#94A3B8;">${escapeHtml(String(f.ts).slice(0, 16))}</span>
          </div>
          ${f.concerns.length > 0 ? `
          <div style="margin-bottom:6px;">
            ${f.concerns.slice(0, 5).map(k => `<span style="display:inline-block;background:#EEF2FF;color:#4338CA;font-size:10.5px;padding:2px 7px;border-radius:9px;margin:1px;font-weight:600;">${escapeHtml(k)}</span>`).join('')}
          </div>
          ` : ''}
          <div style="font-size:12px;color:#334155;line-height:1.55;white-space:pre-line;">${escapeHtml(String(f.summary).slice(0, 500))}${f.summary.length > 500 ? '…' : ''}</div>
        </div>
      `).join('');
      console.log('[minutes-pane] found', uniq.length, 'minutes for', client.name);
    })();
    let toneIndex = 0;
    document.getElementById('draft-close').addEventListener('click', () => openClientModal(client.id));
    document.getElementById('draft-close-btn').addEventListener('click', () => openClientModal(client.id));
    document.getElementById('draft-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('draft-text').value);
      document.getElementById('draft-msg').textContent = '✓ クリップボードにコピーしました';
    });
    document.getElementById('draft-send').addEventListener('click', async () => {
      const baseText = document.getElementById('draft-text').value;
      const userId = client.lineFriendId || client.userId;
      const sendBtn = document.getElementById('draft-send');
      const msg = document.getElementById('draft-msg');
      if (!userId) {
        msg.textContent = '⚠ LINE friend ID が未設定のため送信できません (顧客編集で登録してください)';
        msg.style.color = 'var(--red)';
        return;
      }
      if (!confirm(client.name + ' 様 へ この内容で LINE 送信します。よろしいですか?')) return;
      // Compose: 本文(text) + 候補日(Flex Carousel) + pdf
      const slotsOn = document.getElementById('aib-attach-slots')?.checked;
      const pdfOn = document.getElementById('aib-attach-pdf')?.checked;
      let text = baseText.trimEnd();
      if (pdfOn) {
        text += '\n\n────────\n◆ 添付資料\n📎 ' + (client.name || 'お客様') + '様向け_資料.pdf\n────────';
      }
      sendBtn.disabled = true;
      sendBtn.textContent = '送信中...';
      // ★ オーナーfb「資料も並列生成 → 送信時に自動添付」: window._fpReadyDeliverable があれば添付
      const ready = window._fpReadyDeliverable;
      const hasAutoDeliv = ready && ready.clientId === client.id && ready.html && ready.html.length > 100;
      try {
        // ★ オーナーfb 2026-06-20: 候補日 を LINE Flex Carousel で 送る (テキストベタ送りNG)
        let flexCarousel = null;
        let combinedText = text;
        if (slotsOn && slotsData.length) {
          // 上部 案内 1行 だけ text に 残す (Flex は カード)
          combinedText = text + '\n\n📅 ご希望の日時を 下記カード から ご返信ください。';
          flexCarousel = {
            type: 'carousel',
            contents: slotsData.slice(0, 10).map((s, i) => {
              const md = (s.iso || '').slice(5).replace('-', '/');
              const replyTxt = `候補${i+1} (${s.month}月${s.day}日 ${s.time}) でお願いします`;
              return {
                type: 'bubble', size: 'kilo',
                header: { type: 'box', layout: 'vertical', backgroundColor: '#5B5BF0', paddingAll: '12px', contents: [
                  { type: 'text', text: `候補 ${i+1}`, color: '#ffffff', size: 'sm', weight: 'bold' },
                ] },
                body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: [
                  { type: 'text', text: `${s.month}月${s.day}日`, size: 'xxl', weight: 'bold', color: '#0F172A' },
                  { type: 'text', text: `(${s.wday})`, size: 'md', color: '#64748B', weight: 'bold' },
                  { type: 'separator', margin: 'md' },
                  { type: 'box', layout: 'baseline', margin: 'md', contents: [
                    { type: 'text', text: '🕐', size: 'sm', flex: 0 },
                    { type: 'text', text: s.time, size: 'lg', weight: 'bold', color: '#0F172A', margin: 'sm' },
                  ] },
                ] },
                footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: [
                  { type: 'button', style: 'primary', color: '#5B5BF0', height: 'sm',
                    action: { type: 'message', label: 'この日でお願いします', text: replyTxt } },
                ] },
              };
            }),
          };
        }
        const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
        const fbApp = getApps()[0] || initializeApp({
          apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
          authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
          projectId: 'skeleton-fp-compass-632026',
        });
        const fns = getFunctions(fbApp, 'asia-northeast1');
        const sendFn = httpsCallable(fns, 'sendLineMessage');
        const fsCustomerId = client._fsCustomerId || (client.id && client.id.startsWith('fs-') ? client.id.slice(3) : null) || client.id;
        const callRes = await sendFn({
          customerId: fsCustomerId,
          lineFriendId: client.lineFriendId || null,
          text: combinedText,
          flex: flexCarousel || undefined,
        });
        const data = (callRes && callRes.data) || {};
        if (data.ok || data.success || data.messageId) {
          msg.style.color = 'var(--green)';
          msg.textContent = '✅ 送信完了 — ' + client.name + ' 様の LINE に届きました';
          sendBtn.textContent = '✓ 送信済';
          // ★ オーナーfb「送信後また Claude が次の最適提案 (ループ)」
          // 送信履歴に append + Claude に再投入
          if (!window._fpDraftConversation) window._fpDraftConversation = [];
          const sentText = document.getElementById('draft-text')?.value || text;
          const nowIso = new Date().toISOString();
          window._fpDraftConversation.push({ role: 'fp', text: sentText, ts: nowIso, clientId: client.id });
          // ★ オーナーfb「LINE 送ったのに lineHistory 反映されない + リロードで履歴消える」
          // 真因: 旧コードは stored=[] で開始 → 1人だけ含めて保存 → 全 DUMMY_CLIENTS 消失
          // 修正: window.DUMMY_CLIENTS 全体を localStorage に保存
          try {
            if (!Array.isArray(client.lineHistory)) client.lineHistory = [];
            const newMsg = {
              from: 'fp',
              direction: 'out',
              text: sentText,
              message: sentText,
              ts: nowIso,
              date: nowIso.slice(0, 10),
              source: 'fp-crm-draft',
            };
            client.lineHistory.push(newMsg);
            client.lastContact = nowIso.slice(0, 10);
            // ★ 二重保存: ①顧客台帳全体 ②lineHistory を顧客毎の独立キーに (顧客台帳が壊れても LINE 履歴は残す)
            localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS || []));
            const histKey = 'fp-line-history-' + client.id;
            const existHist = JSON.parse(localStorage.getItem(histKey) || '[]');
            existHist.push(newMsg);
            localStorage.setItem(histKey, JSON.stringify(existHist));
            console.log('[lineHistory] saved →', client.name, 'len:', client.lineHistory.length, '/ standalone key:', histKey, '→', existHist.length);
          } catch (he) { console.warn('lineHistory append fail:', he); }
          // ★ 客毎の追撃トラッキング (localStorage に保存 → 返信待ちダッシュボード表示)
          try {
            const trackKey = 'fp-draft-tracking';
            const tracking = JSON.parse(localStorage.getItem(trackKey) || '{}');
            tracking[client.id] = {
              clientId: client.id,
              clientName: client.name,
              lineFriendId: client.lineFriendId || '',
              lastSentText: sentText.slice(0, 120),
              lastSentAt: nowIso,
              awaitingReply: true,
              followupCount: (tracking[client.id]?.followupCount || 0),
            };
            localStorage.setItem(trackKey, JSON.stringify(tracking));
          } catch (_) {}
          // 「お客様の返信を待つ → 次の提案」UI
          const nextLoopUi = document.createElement('div');
          nextLoopUi.style.cssText = 'margin-top:14px;padding:14px 18px;background:linear-gradient(135deg,#EEF2FF,#FAFBFF);border:2px solid #5B5BF0;border-radius:10px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;';
          nextLoopUi.innerHTML = `
            <div style="flex:1;min-width:200px;">
              <div style="font-size:13px;font-weight:800;color:#3730A3;">📨 送信完了 → 次のステップ</div>
              <div style="font-size:11.5px;color:#475569;margin-top:3px;line-height:1.5;">お客様から返信があったら自動で次の最適提案を生成 / または「今すぐ次の提案」で先に下書きを準備</div>
            </div>
            <button id="aib-next-loop" style="background:#5B5BF0;color:#fff;border:none;padding:10px 18px;border-radius:8px;cursor:pointer;font-weight:800;font-size:12px;font-family:inherit;letter-spacing:0.04em;">✨ 今すぐ 次の提案を生成</button>
          `;
          msg.parentElement.appendChild(nextLoopUi);
          document.getElementById('aib-next-loop').addEventListener('click', () => {
            // 自動再生成: Claude regen をループモードで発火
            window._fpDraftLoopMode = true;
            sendBtn.disabled = false; sendBtn.textContent = '📨 この内容で LINE 送信';
            msg.textContent = '';
            nextLoopUi.remove();
            document.getElementById('draft-claude-regen').click();
          });
        } else {
          msg.style.color = 'var(--red)';
          msg.textContent = '❌ 送信失敗: ' + (data.error || '原因不明');
          sendBtn.disabled = false;
          sendBtn.textContent = '📨 この内容で LINE 送信';
        }
      } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = '❌ 送信失敗: ' + e.message;
        sendBtn.disabled = false;
        sendBtn.textContent = '📨 この内容で LINE 送信';
      }
    });
    document.getElementById('draft-regen').addEventListener('click', () => {
      toneIndex = (toneIndex + 1) % 3;
      const newDraft = generateDraftReply(client, events, recs, toneIndex);
      currentBaseBody = newDraft.body;
      try { renderPreview(); } catch(_){}
    });

    // ★ オーナーfb「AI下書きをめちゃくちゃ強化、この人に最適化」
    // Claude に顧客の全文脈を渡して本気の下書き生成
    document.getElementById('draft-claude-regen').addEventListener('click', async () => {
      const btn = document.getElementById('draft-claude-regen');
      const overlay = document.getElementById('draft-claude-overlay');
      btn.disabled = true; btn.style.opacity = '0.6';
      overlay.style.display = 'flex';
      // 全文脈収集
      const ageDisp = window.LifeEvents.currentAge(client);
      const familyDisp = (client.family || []).map(m => {
        const r = m.rel === 'spouse' ? '配偶者' : (m.rel === 'child' ? 'お子様' : m.rel);
        const a = window.LifeEvents.currentAge({ birth: m.birth });
        return `${r}${m.name}(${a || '-'}歳)`;
      }).join(' / ') || '単身';
      const dsl = daysSince(client.lastContact);
      const lastProps = (client.proposals || []).slice(-3).map(p => `${p.date} ${p.title}(${p.result})`).join(' / ') || 'なし';
      const lastCancels = (client.cancellations || []).slice(-2).map(c => `${c.date}キャンセル(${c.reason || '理由不明'})`).join(' / ') || 'なし';
      const recentLine = (client.lineHistory || []).slice(-6).map(m => `${m.direction === 'in' ? '客' : 'FP'}: ${(m.text || '').slice(0, 80)}`).join('\n') || 'なし';
      const upcomingEvs = (events || []).filter(ev => new Date(ev.date) >= TODAY).slice(0, 4).map(ev => `${(new Date(ev.date)).toLocaleDateString('ja-JP')} ${ev.label}`).join(' / ') || 'なし';
      // ★ 議事録 lookup: 左ペインで判定済の _fpDraftMinutesFound を使う (同じロジック)
      let aiCtx = '';
      try {
        const found = window._fpDraftMinutesFound || [];
        if (found.length > 0) {
          const top = found[0];
          aiCtx = `最新議事録 (${found.length}件中の最上位 / 信頼度 score ${top.score}/3): \n${top.summary.slice(0, 1000)}\n\n関心事: ${(top.concerns || []).join(', ')}`;
          if (found.length > 1) {
            aiCtx += `\n\n--- 追加議事録 ---\n` + found.slice(1, 3).map((f, i) => `[#${i+2}] ${String(f.summary).slice(0, 300)}`).join('\n');
          }
        }
      } catch (_) {}

      // ★ 会話ループ履歴 (送信済 + 返信受信) を時系列で merge
      // - FP 送信: window._fpDraftConversation (この客分のみ)
      // - 客返信: c.lineHistory の from='user' / direction='in'
      const fpSent = (window._fpDraftConversation || [])
        .filter(m => !m.clientId || m.clientId === client.id)
        .map(m => ({ role: 'fp', text: m.text, ts: m.ts }));
      const userReplies = (client.lineHistory || [])
        .filter(m => m.direction === 'in' || m.from === 'user')
        .map(m => ({ role: 'user', text: m.text || m.message || '', ts: m.ts || m.date || '' }));
      const allMsgs = fpSent.concat(userReplies)
        .filter(m => m.text && m.ts)
        .sort((a, b) => new Date(a.ts) - new Date(b.ts))
        .slice(-10);
      const convHist = allMsgs.length === 0 ? 'なし (初回)' : allMsgs.map(m =>
        `${m.role === 'fp' ? '【FP送信】' : '【お客様返信】'} (${String(m.ts).slice(0,10)}) ${(m.text || '').slice(0, 200)}`
      ).join('\n');
      const isLoop = window._fpDraftLoopMode === true || allMsgs.length > 0;
      const today = new Date().toISOString().slice(0, 10);
      const taskTitle = `LINE 個別下書き 生成 — 以下は全文脈です:

【顧客プロファイル】
${client.name}様 / ${ageDisp || '?'}歳 / ${client.occupation || '職業不明'} / 家族: ${familyDisp}
管理資産: ¥${(client.aum || 0).toLocaleString()} / 最終接触: ${dsl == null ? '未記録' : dsl + '日前 (' + (client.lastContact || '') + ')'}

【会話ループ履歴 (※あれば、これに続けて自然に次の一手を生成)】
${convHist}

【提案履歴】
${lastProps}

【キャンセル/トラブル】
${lastCancels}

【直近 LINE 会話】
${recentLine}

【今後のライフイベント (90日以内)】
${upcomingEvs}

【面談議事録】
${aiCtx || 'なし'}

【現在のインテント (AI 判定)】
${draft.intent} — ${draft.reason}

【依頼】
${isLoop
  ? `上記の会話ループ履歴の **直近のお客様返信** を読み、その意図を汲み取って次の一手 LINE 下書きを 1つ 生成。

  【お客様返信への応答 必須ルール】
  - お客様返信が「① ② ③」等の選択肢回答なら、その選択に応じた **具体的なネクストアクション** を提示
    例: 客返信「① 2人で相談したい」→ 応答「奥様にも分かりやすいよう図解多めの資料を月内に作ります。ご相談しやすいタイミングで」
    例: 客返信「② 自分主導」→ 応答「では本気の試算 PDF を週内にお送りします。ご質問は LINE でいつでも」
  - 客返信が短くても、必ず **具体的な次行動 + 提供価値** を含める
  - NG: 「ご返信ありがとうございます」「承知しました」だけの礼文
  - NG: 同じ選択肢をもう一度繰り返し聞く (返事もらった選択肢は捨てて次の論点へ)
  - 質問するなら **次の論点** の選択肢に進む (例: 主役確定 → 次は意思決定スタイル or 緊急度)`
  : `${client.name}様に "いま" 送るべき LINE 下書きを 1つ 生成。`
}

【🎯 最終ゴール】
LINE のやり取りは **「次の Zoom 面談予約を獲得する」** ためだけにある。
質問繰り返しでヒアリングを LINE で深掘るな。ヒアリングは Zoom 面談で。
1〜2通の LINE で **次の Zoom 日程を確定** に持っていく。

【🔥 絶対 NG (これをやったら不採用)】
1. ❌ 既知情報の単純羅列 NG →「41歳で自営業のあなたは / 3歳と0歳のお子様が」
2. ❌ お世辞 NG →「素晴らしい / 見事 / さすが / 立派 / 視野が広い」
3. ❌ 絵文字 過剰 NG → 1通 最大2個まで (😊 🗓 📋 ✨ など。✅🔥💪 はビジネス感ありすぎNG)
4. ❌ 質問の繰り返し連発 NG → 客に「① ② ③ どれですか?」を毎回投げて答えさせるな。客は疲れる
4-2. ❌ 「○○について確認させてください」「気になるのは?」テンプレ事務的フレーズ禁止 → 「ちょっと聞かせてください!」「いま いちばん気になってるの どれですか?」など親しみある言い方
5. ❌ "ヒアリングシート送ります" だけの予告 NG → 必ず Zoom 日程提示までセット
6. ❌ 三人称化 NG →「41歳単身の方の場合〜」「自営業の方には〜」
7. ❌ 統計風煽り NG →「8割が」「ケースが多い」
8. ❌ 数字記入を求める NG → 「ざっくり何万?」「年収はいくら?」全部禁止
9. ❌ オープン質問 NG → 「どう思いますか?」「不安は?」
10. ❌ "用語列挙" NG →「教育/老後/iDeCo/共済」を1通に並べない
11. ❌ "了解しました/承知しました" の礼文 NG
12. ❌ "ご都合の良い時にお返事ください" の柔らかさ NG → 期限つきで Zoom 日程3つ提示

【✅ フェーズ別の正しい動き】

LINE は **2 段階で Zoom 予約を取る** ことだけ考える。それ以外は省く。

═══════════════════════════════════════════
【フェーズ1 = 初回 LINE (まだ客返信なし)】 ${isLoop ? '※今は該当しない' : '※今はこのフェーズ'}
═══════════════════════════════════════════

目的: 議事録から読み取った **具体的な提案** で 次の Zoom を取りに行く。 質問形式は最終手段。

✅ 推奨パターン (議事録から仕入れた情報を活かす):
**A. 提案型 (議事録から論点が明確な場合 = 推奨)**
  「議事録で○○の話が出てたので、 △△の試算を作って 次の Zoom で一緒に見ませんか」
  → 具体名詞・数値・固有事情を盛り込む (一般論禁止)

**B. 一点絞り型 (論点が複数ある場合だけ)**
  「○○ / △△ / □□ の中で 今いちばん気になるのは?」と 短く絞り込み

NG: 議事録に触れず テンプレ質問だけ (= 客は「ちゃんと聞いてもらってない」 と感じる)
NG: 「① ② ③ から選んで」 ばかりを毎回繰り返す
長さ: 100-180字 (短いほど良い)

✅ 例 1 (提案型 — 推奨):
${client.name}さん、お疲れさまでした!

先日お話に出てた「お子様 3歳・0歳の進路 (公立/私立/医学部)」
の試算、 A4 1枚にまとめて 次の Zoom で一緒に見ませんか? 😊

候補日は別カードでお送りしますね 🗓

✅ 例 2 (一点絞り型 — 論点が散ってる時のみ):
${client.name}さん、ちょっとだけ聞かせてください!

教育費 / 老後資金 / 奥様の事業の中で
いま いちばん気になってるの どれですか?

それに絞った資料 作って 次の Zoom でお見せしますね 😊

═══════════════════════════════════════════
【フェーズ2 = 客返信あり後の LINE】 ${isLoop ? '※今はこのフェーズ' : '※今は該当しない'}
═══════════════════════════════════════════

目的: **成果物は既に作って添付した前提** + Zoom 日程は別添カードで送る。
本文は超短くシンプルに。質問は厳禁。

✅ 必須 (本文構成):
1行目: 「${client.name}さん、ありがとうございます。」
2-3行目: **資料を既に "作りました"** (時制: 完了形必須)
   例: 「①の教育費、お子様 (3歳・0歳) の進路パターン別試算 A4 1枚、作って添付しました」
   例: 「②の老後資金、自営業の年金不足額シミュ 3パターン、作って添付しました」
4-5行目: 「内容を30分の Zoom で一緒に見ながら整理しませんか? 候補日は別添カードでお送りします」

⚠ 絶対 NG:
- 「○月○日までに作ります」「来週送ります」← 未来形は遅すぎる
- LINE 本文内に「① 6/8 14:00 ② 6/10 19:30 ③ 6/15 10:00」みたいに **日程を文章で列挙** ← 別添カードで送るので不要
- 質問追加 (もう客は ①と答えた、これ以上質問しない)

✅ OK 例 (短く、完了形、日程はカード):
${client.name}さん、ありがとうございます。

①の教育費、お子様 (3歳・0歳) の進路別試算
(公立/私立/医学部) を A4 1枚にまとめました。
資料添付しています。

これを 30分 Zoom で一緒に整理しませんか?
候補日3つを別カードでお送りします。
タップで選んでください。

═══════════════════════════════════════════
【共通絶対ルール】
═══════════════════════════════════════════
- 本文に日時を**書かない** (別添カードで送るので)
- 「作ります (未来形)」絶対禁止 → 「作りました (完了形)」
- フェーズ1で **既に1回質問** している ⇒ フェーズ2で 2回目の質問は絶対しない
- 本文長さ: 80-150字 (短いほど良い)

【📐 文章の構成 (フレキシブル — 議事録の中身に合わせて選ぶ)】

**A型 (提案型 = 強く推奨): 議事録に具体ネタがある時はこっち**
- 1行目: 親しい呼びかけ (例: 「${client.name}さん、お疲れさまでした!」「${client.name}さん、ありがとうございました 😊」)
- 1行空ける
- 2-3行目: 議事録ネタを1つ拾って、それに対する具体提案 (例: 「先日お話に出てた○○の件、△△の試算 A4 1枚にまとめて 次の Zoom で一緒に見ませんか?」)
- 1行空ける
- 最終行: Zoom 候補日を別カードで送る予告 (例: 「候補日は別カードでお送りしますね 🗓」)

**B型 (一点絞り型 = 論点が散ってる時だけ): ①②③ を使うのはここだけ**
- 1行目: 親しい呼びかけ + ライトな前置き (例: 「${client.name}さん、ちょっとだけ聞かせてください!」)
- 質問本文 (柔らかく — 例: 「いま いちばん気になってるの どれですか?」)
- ① ② ③ ④ を 縦並びで (各15-30字)
- 最終行: 返信後の動き

**B型を使うのは「議事録に複数論点が並列で出てて優先順位が不明」な時のみ**。
議事録に具体ネタが1つでもあれば A型を選ぶ。

【📐 文体・量】
- 冒頭: 「${client.name}様、お世話になっております」「先日はありがとうございました」では始めない (硬すぎ)
- 二人称: 必ず「${client.name}さん」(様じゃなく さん で親近感)
- ✅ 「!」(感嘆符) を 1-2個 使ってOK (例: 「お疲れさまでした!」「楽しみにしてます!」)
- ✅ 絵文字 1-2個 までOK (😊 🗓 📋 ✨ など FP らしい控えめなもの。✅, 🔥, 💪 はNG)
- ❌ 「確認させてください」「気になるのは?」のような事務的・教科書的フレーズ禁止
- ❌ 「気になってるの どれですか?」「いちばん引っかかってるの どこですか?」など 親しみある聞き方にする
- 長さ: A型なら 80-150字 / B型なら 120-200字 (選択肢含む)
- 統計/煽り/お世辞 排除

【出力形式 (厳密に以下の JSON のみ、code fence ・前置き禁止)】
{
  "lineBody": "LINE 本文 (改行は実改行で。①②③ 縦並び。固有名詞は議事録から)",
  "questionCategory": "優先順位|意思決定スタイル|緊急度|過去の失敗体験 のどれか",
  "jobsAdvice": "Jobs からのワンポイントアドバイス: なぜこのカテゴリの質問か / 返信で何を判断したいか (60-120字)",
  "intent": "戦略意図 1単語 (例: 主役確定 / 合意形成方針 / スケジュール調整 / リスク許容度判定)",
  "qualityCheck": {
    "hasNumberedChoices": true/false,
    "choicesFromContext": true/false,
    "noFlattery": true/false,
    "noNumberRequest": true/false,
    "underWordLimit": true/false
  }
}`;

      try {
        const r = await fetch('https://fp-compass-webhook-527726449426.asia-northeast1.run.app/api/generate-deliverable', {
          method: 'POST', headers: await (window.getFpAuthHeaders ? window.getFpAuthHeaders() : Promise.resolve({ 'Content-Type': 'application/json' })),
          body: JSON.stringify({ type: 'custom', clientName: client.name, clientCtx: `${ageDisp || '?'}歳 / ${client.occupation || ''} / ${familyDisp}`, summary: aiCtx, transcript: '', taskTitle }),
        });
        const d = await r.json();
        overlay.style.display = 'none';
        btn.disabled = false; btn.style.opacity = '1';
        // ★ 残高/billing 切れ時 → プロンプト+顧客情報 を clipboard コピー
        if (!d.ok && /credit balance|billing|low|api key|not_found_error|401|403|429/i.test(d.error || '')) {
          const promptTxt = (typeof aiCtx === 'string' ? aiCtx : '') + '\n\n--- 元タスク ---\n' + (taskTitle || '');
          try { await navigator.clipboard.writeText(promptTxt); } catch (_) {}
          alert('Anthropic API 残高切れ。 \n下書き生成プロンプトを クリップボードに コピーしました。\nご自身の Claude Code に貼り付けて 返信下書きを 作成してください。');
          return;
        }
        if (d.ok && d.html) {
          // ★ オーナーfb「HTMLタグがそのまま出る」: Claude の返答から JSON 抽出
          let parsed = null;
          try {
            // 1) 直接 JSON.parse 試行
            const raw = d.html.replace(/^```(?:json|html)?\s*/i, '').replace(/```\s*$/, '').trim();
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          } catch (_) {}
          // フォールバック: <p> 内テキストを改行付きで結合
          if (!parsed || !parsed.lineBody) {
            const tmp = document.createElement('div'); tmp.innerHTML = d.html;
            const ps = tmp.querySelectorAll('p');
            const bodyText = ps.length > 0
              ? Array.from(ps).map(p => p.textContent.trim()).filter(Boolean).join('\n\n')
              : (tmp.textContent || '').trim();
            // markdown code fence 残骸除去
            const cleaned = bodyText.replace(/^```(?:html|json)?\s*/gi, '').replace(/```\s*$/g, '').trim();
            parsed = { lineBody: cleaned, jobsAdvice: '', intent: '' };
          }
          if (parsed.lineBody && parsed.lineBody.length > 20) {
            document.getElementById('draft-text').value = parsed.lineBody;
            currentBaseBody = parsed.lineBody;
            // ★ オーナーfb「資料も並列で先に作って添付」: フェーズ2なら客返信から type 推定して成果物を裏で並列生成
            if (isLoop) {
              try {
                const lastReply = ((client.lineHistory || []).slice().reverse().find(m => (m.from === 'user' || m.direction === 'in')) || {}).text || '';
                let autoType = null;
                if (/教育|進学|学費|大学|公立|私立|医学/.test(lastReply)) autoType = 'education';
                else if (/老後|退職|年金|iDeCo|共済/i.test(lastReply)) autoType = 'retire';
                else if (/開業|事業|奥様.*開業|家計/.test(lastReply)) autoType = 'cashflow';
                else if (/NISA|つみたて|配分|積立/i.test(lastReply)) autoType = 'nisa';
                else if (/保険|保障/.test(lastReply)) autoType = 'insurance';
                else if (/相続|贈与/.test(lastReply)) autoType = 'inherit';
                if (autoType && !window._fpAutoDelivStarted) {
                  window._fpAutoDelivStarted = true;
                  // バックグラウンドで成果物生成 (進捗ピル → 完了時に自動添付)
                  console.log('[autoDeliv] starting for type:', autoType, 'based on reply:', lastReply.slice(0, 80));
                  setTimeout(() => {
                    try {
                      const taskTitle = `客返信「${lastReply.slice(0, 50)}」を踏まえた成果物`;
                      openDeliverableDraftModal(client, taskTitle, autoType);
                      // 1秒後にモーダルを即 hide してフローティングピルで継続
                      setTimeout(() => { const dm = document.getElementById('fp-deliv-modal'); if (dm) dm.style.display = 'none'; }, 1500);
                    } catch (_) {}
                  }, 800);
                }
              } catch (_) {}
            }
            // Jobs ワンポイントアドバイス 表示
            let adviceEl = document.getElementById('jobs-advice-box');
            if (!adviceEl) {
              adviceEl = document.createElement('div');
              adviceEl.id = 'jobs-advice-box';
              adviceEl.style.cssText = 'margin:10px 0 14px;padding:12px 16px;background:linear-gradient(135deg,#FFFBEB,#FEF3C7);border:2px solid #F59E0B;border-radius:10px;font-family:inherit;';
              const wrap = document.querySelector('.aib-textarea-wrap');
              if (wrap && wrap.parentElement) wrap.parentElement.insertBefore(adviceEl, wrap);
            }
            // ★ クオリティチェック 視覚化
            const qc = parsed.qualityCheck || {};
            const qcBadge = (label, ok) => `<span style="background:${ok ? '#10B981' : '#94A3B8'};color:#fff;font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:8px;letter-spacing:0.04em;margin-right:4px;">${ok ? '✓' : '○'} ${label}</span>`;
            const qcRow = `
              <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:3px;">
                ${qcBadge('①②③選択肢', qc.hasNumberedChoices)}
                ${qcBadge('議事録から具体化', qc.choicesFromContext)}
                ${qcBadge('数字非要求', qc.noNumberRequest)}
                ${qcBadge('お世辞なし', qc.noFlattery)}
                ${qcBadge('文字数OK', qc.underWordLimit)}
              </div>
              ${parsed.questionCategory ? `<div style="margin-top:6px;font-size:10px;color:#92400E;font-weight:700;">📌 質問カテゴリ: ${escapeHtml(parsed.questionCategory)}</div>` : ''}`;
            if (parsed.jobsAdvice) {
              adviceEl.innerHTML = `
                <div style="display:flex;align-items:flex-start;gap:10px;">
                  <div style="font-size:22px;flex-shrink:0;">💡</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:10.5px;font-weight:800;letter-spacing:0.1em;color:#92400E;text-transform:uppercase;margin-bottom:4px;">JOBS の ワンポイントアドバイス${parsed.intent ? ' · 戦略意図: ' + escapeHtml(parsed.intent) : ''}</div>
                    <div style="font-size:13px;color:#78350F;line-height:1.65;font-weight:600;">${escapeHtml(parsed.jobsAdvice)}</div>
                    ${qcRow}
                  </div>
                </div>
              `;
              adviceEl.style.display = 'block';
            } else {
              adviceEl.style.display = 'none';
            }
            try { renderPreview(); } catch(_){}
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #5B5BF0;border-radius:10px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:99999;font-family:inherit;';
            t.innerHTML = `<strong style="font-size:14px;color:#5B5BF0;">✨ ${escapeHtml(client.name)} 様 専用 下書き 生成完了</strong><div style="font-size:11.5px;color:#6b7280;margin-top:3px;">議事録・家族・LINE履歴 すべてを踏まえた本気の下書き</div>`;
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 5000);
          } else {
            alert('Claude の返答が空でした。もう一度お試しください。');
          }
        } else {
          alert('生成失敗: ' + (d.error || '不明'));
        }
      } catch (e) {
        overlay.style.display = 'none';
        btn.disabled = false; btn.style.opacity = '1';
        alert('通信失敗: ' + e.message);
      }
    });

    // ===== Slot pool: simulate FP's Google Calendar free slots =====
    const TIME_POOL = [
      { label: '10:00〜11:00', icon: 'sunrise' },
      { label: '11:00〜12:00', icon: 'sunrise' },
      { label: '13:00〜14:00', icon: 'sun' },
      { label: '14:00〜15:00', icon: 'sun' },
      { label: '15:00〜16:00', icon: 'sun' },
      { label: '16:00〜17:00', icon: 'sun' },
      { label: '18:00〜19:00', icon: 'moon' },
      { label: '19:00〜20:00', icon: 'moon' },
    ];
    let slotPoolOffset = 2; // start offset from TODAY
    let slotsData = []; // current 3 active slots
    const wDayJp = ['日','月','火','水','木','金','土'];
    function pickSlots(offsetStart) {
      const out = [];
      const base = new Date(TODAY);
      base.setDate(base.getDate() + offsetStart);
      let i = 0;
      while (out.length < 3 && i < 30) {
        const d = new Date(base); d.setDate(d.getDate() + i);
        if (d.getDay() !== 0 && d.getDay() !== 6) {
          const t = TIME_POOL[(offsetStart + i + out.length) % TIME_POOL.length];
          out.push({
            id: `s-${d.getTime()}-${out.length}`,
            month: d.getMonth() + 1,
            day: d.getDate(),
            wday: wDayJp[d.getDay()],
            time: t.label,
            icon: t.icon,
            iso: d.toISOString().slice(0,10),
          });
        }
        i++;
      }
      return out;
    }
    slotsData = pickSlots(slotPoolOffset);
    // weekData reseed runs at the bottom of init

    // ===== Render LINE preview (Flex Message look) =====
    function renderPreview() {
      const slotsOn = document.getElementById('aib-attach-slots')?.checked;
      const pdfOn = document.getElementById('aib-attach-pdf')?.checked;
      const bodyText = document.getElementById('draft-text')?.value || draft.body;

      // text bubble
      const bubble = document.getElementById('aib-preview-text');
      if (bubble) bubble.textContent = bodyText;

      // carousel
      const carousel = document.getElementById('aib-preview-carousel');
      if (!carousel) return;
      let cards = '';
      if (slotsOn) {
        cards += `<div class="lp-card lp-card-header">
          <div class="lp-card-eyebrow"><i data-lucide="calendar-clock"></i><span>次回面談 候補</span></div>
          <div class="lp-card-title">どれかタップで予約確定</div>
        </div>`;
        slotsData.forEach((s, i) => {
          cards += `<div class="lp-card lp-card-slot">
            <div class="lp-card-num">候補 ${i+1}</div>
            <div class="lp-card-date">${s.month}/${s.day}<span class="lp-card-wday">(${s.wday})</span></div>
            <div class="lp-card-time"><i data-lucide="${s.icon}"></i><span>${s.time}</span></div>
            <button class="lp-card-btn">この日で予約</button>
          </div>`;
        });
      }
      if (pdfOn) {
        cards += `<div class="lp-card lp-card-pdf">
          <div class="lp-card-eyebrow"><i data-lucide="paperclip"></i><span>資料</span></div>
          <div class="lp-card-title">${escapeHtml(client.name || 'お客様')}様向け_資料.pdf</div>
          <button class="lp-card-btn lp-card-btn-secondary">PDF を見る</button>
        </div>`;
      }
      carousel.innerHTML = cards;
      carousel.style.display = (slotsOn || pdfOn) ? 'flex' : 'none';

      const phone = document.getElementById('aib-preview-phone');
      if (phone) phone.classList.toggle('aib-preview-phone-empty', !slotsOn && !pdfOn);

      if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': '1.6' } });
    }

    // Track which slots will be sent as Flex Message (separate from text body)
    function getAttachmentPayload() {
      return {
        slots: document.getElementById('aib-attach-slots')?.checked ? slotsData : null,
        pdf: document.getElementById('aib-attach-pdf')?.checked ? { name: (client.name || 'お客様') + '様向け_資料.pdf' } : null,
      };
    }
    window.__aibPayload = getAttachmentPayload;

    document.getElementById('aib-attach-slots')?.addEventListener('change', () => { renderCalendarSlots(); renderPreview(); });
    document.getElementById('aib-attach-pdf')?.addEventListener('change', renderPreview);
    document.getElementById('draft-text')?.addEventListener('input', renderPreview);

    // ★ オーナーfb「一発目で この人に最適なのが既にあるように」: モーダル open 直後に自動 Claude 発火
    setTimeout(() => {
      const ar = document.getElementById('draft-claude-regen');
      if (ar) ar.click();
    }, 350);

    // ===== Mock FP calendar — owner's busy events (Google Calendar mock) =====
    function buildOwnerEvents() {
      const seed = ['田中様 面談', '相続セミナー', '社内ミーティング', '佐藤様 面談', '社外研修', '保険会社訪問', '山田様 面談', '個別相談', 'パートナー打合せ'];
      const evs = [];
      const base = new Date(TODAY);
      for (let i = 0; i < 10; i++) {
        const d = new Date(base); d.setDate(d.getDate() + i);
        if (d.getDay() === 0) continue; // skip Sun
        const startHours = [10, 13, 15];
        const n = (i + d.getDay()) % 3 + 1;
        for (let k = 0; k < n; k++) {
          const sh = startHours[(i + k * 2) % startHours.length];
          evs.push({
            iso: d.toISOString().slice(0,10),
            month: d.getMonth() + 1,
            day: d.getDate(),
            wday: ['日','月','火','水','木','金','土'][d.getDay()],
            start: `${String(sh).padStart(2,'0')}:00`,
            startH: sh,
            title: seed[(i * 3 + k) % seed.length],
          });
        }
      }
      return evs;
    }
    const ownerEvents = buildOwnerEvents();

    // Generate week with both busy events and free 1-hour slots
    function buildWeekData() {
      const days = [];
      const base = new Date(TODAY);
      for (let i = 0; i < 7; i++) {
        const d = new Date(base); d.setDate(d.getDate() + i);
        if (d.getDay() === 0 || d.getDay() === 6) continue; // weekdays only
        const iso = d.toISOString().slice(0,10);
        const dayEvents = ownerEvents.filter(e => e.iso === iso);
        const busyHours = new Set(dayEvents.map(e => e.startH));
        // Build hour timeline 10-20
        const slots = [];
        const hourPool = [10, 11, 13, 14, 15, 16, 18, 19];
        hourPool.forEach(h => {
          if (!busyHours.has(h)) {
            slots.push({
              iso,
              month: d.getMonth() + 1,
              day: d.getDate(),
              wday: ['日','月','火','水','木','金','土'][d.getDay()],
              start: `${String(h).padStart(2,'0')}:00`,
              startH: h,
              time: `${String(h).padStart(2,'0')}:00〜${String(h+1).padStart(2,'0')}:00`,
              icon: h < 12 ? 'sunrise' : h < 17 ? 'sun' : 'moon',
            });
          }
        });
        days.push({ iso, month: d.getMonth()+1, day: d.getDate(), wday: ['日','月','火','水','木','金','土'][d.getDay()], events: dayEvents, slots });
      }
      return days;
    }
    const weekData = buildWeekData();

    function isSelected(slot) {
      return slotsData.some(s => s.iso === slot.iso && s.start === slot.start);
    }
    function toggleSlot(slot) {
      const idx = slotsData.findIndex(s => s.iso === slot.iso && s.start === slot.start);
      if (idx >= 0) {
        // Remove
        slotsData.splice(idx, 1);
      } else {
        // Add (replace oldest if already 3+)
        if (slotsData.length >= 3) slotsData.shift();
        slotsData.push({
          id: `s-${slot.iso}-${slot.startH}`,
          month: slot.month, day: slot.day, wday: slot.wday,
          time: slot.time, icon: slot.icon, iso: slot.iso, start: slot.start,
        });
        // Reorder by date
        slotsData.sort((a,b) => (a.iso+a.start).localeCompare(b.iso+b.start));
      }
      renderOwnerWeek();
      renderCalendarSlots();
      renderPreview();
    }

    function renderOwnerWeek() {
      const wrap = document.getElementById('aib-week');
      if (!wrap) return;
      const todayIso = TODAY.toISOString().slice(0,10);
      const html = weekData.map(day => {
        const isToday = day.iso === todayIso;
        const evHtml = day.events.map(e => `
          <div class="aib-week-ev">
            <span class="aib-week-ev-time">${e.start}</span>
            <span class="aib-week-ev-title">${escapeHtml(e.title)}</span>
          </div>
        `).join('');
        const slotsHtml = day.slots.map(s => {
          const sel = isSelected(s);
          return `<button class="aib-week-slot ${sel ? 'aib-week-slot-selected' : ''}" data-pick-iso="${s.iso}" data-pick-start="${s.start}">
            <i data-lucide="${sel ? 'check' : 'plus'}"></i>
            <span class="aib-week-slot-time">${s.start}</span>
            <span class="aib-week-slot-label">${sel ? '候補' + (slotsData.findIndex(x => x.iso === s.iso && x.start === s.start) + 1) : '空き'}</span>
          </button>`;
        }).join('');
        return `
          <div class="aib-week-day ${isToday ? 'aib-week-today' : ''}">
            <div class="aib-week-date">
              <span class="aib-week-num">${day.month}/${day.day}</span>
              <span class="aib-week-wday">${day.wday}</span>
              ${isToday ? '<span class="aib-week-today-mark">今日</span>' : ''}
            </div>
            ${evHtml ? `<div class="aib-week-events">${evHtml}</div>` : ''}
            <div class="aib-week-slots">${slotsHtml}</div>
          </div>
        `;
      }).join('');
      wrap.innerHTML = html;
      // wire pick handlers
      wrap.querySelectorAll('[data-pick-iso]').forEach(btn => {
        btn.addEventListener('click', () => {
          const iso = btn.dataset.pickIso;
          const start = btn.dataset.pickStart;
          const slot = weekData.flatMap(d => d.slots).find(s => s.iso === iso && s.start === start);
          if (slot) toggleSlot(slot);
        });
      });
      if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': '1.8' } });
    }

    // ===== FP Calendar suggestion UI =====
    function renderCalendarSlots() {
      const grid = document.getElementById('aib-cal-grid');
      const wrap = document.getElementById('aib-cal');
      if (!grid || !wrap) return;
      const enabled = document.getElementById('aib-attach-slots')?.checked;
      wrap.style.display = enabled ? '' : 'none';
      if (!enabled) return;
      grid.innerHTML = slotsData.map((s, i) => `
        <div class="aib-slot" data-slot-idx="${i}">
          <div class="aib-slot-head">
            <span class="aib-slot-num">候補 ${i+1}</span>
            <button class="aib-slot-remove" data-remove-idx="${i}" title="この候補を外す"><i data-lucide="x"></i></button>
          </div>
          <div class="aib-slot-date">${s.month}/${s.day}<span class="aib-slot-wday">(${s.wday})</span></div>
          <div class="aib-slot-time"><i data-lucide="${s.icon}"></i><span>${s.time}</span></div>
          <div class="aib-slot-free"><i data-lucide="check"></i><span>カレンダー空き</span></div>
        </div>
      `).join('');
      // remove handlers
      grid.querySelectorAll('[data-remove-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.removeIdx, 10);
          slotsData.splice(idx, 1);
          renderOwnerWeek();
          renderCalendarSlots();
          renderPreview();
        });
      });
      if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': '1.6' } });
    }
    document.getElementById('aib-cal-regen')?.addEventListener('click', () => {
      // ★ オーナーfb「履歴ゼロ顧客で別の3つボタン動かない」: weekData が空でも
      //   pickSlots(slotPoolOffset) で 純粋生成して 必ず 3つ提示する
      slotPoolOffset += 3;
      // ローテーション: 4週分回ったら 戻す
      if (slotPoolOffset > 21) slotPoolOffset = 2;
      slotsData = pickSlots(slotPoolOffset);
      try { renderOwnerWeek(); } catch (_) {}
      try { renderCalendarSlots(); } catch (_) {}
      try { renderPreview(); } catch (_) {}
    });
    // ★ オーナーfb「Google Calendar を開く ボタン押しても動かない」: handler 未実装だった
    document.getElementById('aib-gcal-toggle')?.addEventListener('click', () => {
      window.open('https://calendar.google.com/calendar/u/0/r/week', '_blank');
    });
    document.getElementById('aib-cal-add')?.addEventListener('click', () => {
      openManualPickerModal();
    });

    function openManualPickerModal() {
      const wrap = document.createElement('div');
      wrap.className = 'aib-picker-overlay';
      wrap.innerHTML = `
        <div class="aib-picker">
          <div class="aib-picker-head">
            <i data-lucide="calendar-plus"></i>
            <span>日時を手動で指定</span>
            <button class="aib-picker-close" aria-label="閉じる">×</button>
          </div>
          <div class="aib-picker-body">
            <label class="aib-picker-row">
              <span class="aib-picker-label">日付</span>
              <input type="date" id="aib-pick-date" value="${TODAY.toISOString().slice(0,10)}" min="${TODAY.toISOString().slice(0,10)}">
            </label>
            <label class="aib-picker-row">
              <span class="aib-picker-label">開始時刻</span>
              <select id="aib-pick-time">
                ${Array.from({length:11}, (_,i)=>i+9).map(h => `<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}:00〜${String(h+1).padStart(2,'0')}:00</option>`).join('')}
              </select>
            </label>
            <div class="aib-picker-note" id="aib-picker-note"></div>
            <div class="aib-picker-cta">
              <button class="primary aib-picker-confirm">この日時を候補に追加</button>
              <button class="ghost-btn aib-picker-cancel">キャンセル</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);
      if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': '1.6' } });
      const close = () => wrap.remove();
      wrap.querySelector('.aib-picker-close').addEventListener('click', close);
      wrap.querySelector('.aib-picker-cancel').addEventListener('click', close);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
      // Live check vs owner events
      const note = wrap.querySelector('#aib-picker-note');
      const dateInput = wrap.querySelector('#aib-pick-date');
      const timeInput = wrap.querySelector('#aib-pick-time');
      function checkConflict() {
        const iso = dateInput.value;
        const time = timeInput.value;
        const startH = parseInt(time.split(':')[0], 10);
        const conflict = ownerEvents.find(e => e.iso === iso && e.startH === startH);
        if (conflict) {
          note.innerHTML = `<i data-lucide="alert-triangle"></i><span>この時間は既に <strong>「${escapeHtml(conflict.title)}」</strong> の予定が入っています</span>`;
          note.className = 'aib-picker-note aib-picker-note-warn';
        } else {
          note.innerHTML = `<i data-lucide="check"></i><span>このカレンダー上は空きです</span>`;
          note.className = 'aib-picker-note aib-picker-note-ok';
        }
        if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': '1.6' } });
      }
      dateInput.addEventListener('change', checkConflict);
      timeInput.addEventListener('change', checkConflict);
      checkConflict();
      wrap.querySelector('.aib-picker-confirm').addEventListener('click', () => {
        const iso = dateInput.value;
        const time = timeInput.value;
        if (!iso || !time) return;
        const startH = parseInt(time.split(':')[0], 10);
        const d = new Date(iso);
        const wday = ['日','月','火','水','木','金','土'][d.getDay()];
        const newSlot = {
          id: `s-${iso}-${startH}`,
          month: d.getMonth()+1,
          day: d.getDate(),
          wday,
          time: `${time}〜${String(startH+1).padStart(2,'0')}:00`,
          icon: startH < 12 ? 'sunrise' : startH < 17 ? 'sun' : 'moon',
          iso,
          start: time,
        };
        // Replace oldest if 3+
        if (slotsData.length >= 3) slotsData.shift();
        slotsData.push(newSlot);
        slotsData.sort((a,b) => (a.iso+a.start).localeCompare(b.iso+b.start));
        renderOwnerWeek();
        renderCalendarSlots();
        renderPreview();
        close();
      });
    }

    // Re-seed slotsData from weekData (free slots only, take first 3)
    const seedFreeSlots = weekData.flatMap(d => d.slots).slice(0, 3).map((s, i) => ({
      id: `s-${s.iso}-${s.startH}`,
      month: s.month, day: s.day, wday: s.wday,
      time: s.time, icon: s.icon, iso: s.iso, start: s.start,
    }));
    if (seedFreeSlots.length === 3) slotsData = seedFreeSlots;

    // Initial paint
    renderOwnerWeek();
    renderCalendarSlots();
    renderPreview();
  }

  function generateDraftReply(client, events, recs, toneIndex) {
    toneIndex = toneIndex || 0;
    const fullName = client.name || 'お客';
    const lastName = fullName.split(/\s+/)[0];
    const dsl = daysSince(client.lastContact);
    const age = window.LifeEvents.currentAge(client);
    const topRec = (recs && recs[0]) || null;

    // === 状況分析 (context) ===
    // 直近の重要イベント (90日 〜 18ヶ月)
    const upcoming = (events || []).filter(ev => {
      const days = (ev.date - TODAY) / 86400000;
      return days >= 0 && days <= 540;
    }).slice(0, 3);
    const nearestEv = upcoming[0];

    // 提案フォロー漏れ
    const stalledProp = (client.proposals || []).slice().reverse().find(p =>
      p.result === '提案中' || p.result === '検討中'
    );
    const lastSuccessProp = (client.proposals || []).slice().reverse().find(p => p.result === '成約');

    // 直近キャンセル
    const lastCancel = (client.cancellations || []).slice().sort((a, b) =>
      new Date(b.date) - new Date(a.date)
    )[0];
    const recentCancelDays = lastCancel ? daysSince(lastCancel.date) : 9999;
    const recentCancel = recentCancelDays < 30 ? lastCancel : null;

    // 直近 LINE メッセージ
    const lastIncoming = (client.lineHistory || []).slice().reverse().find(m => m.direction === 'in');
    // ★ オーナーfb 2026-06-24: lastIncoming.ts が Firestore Timestamp の場合 .slice() で死ぬ → 文字列化
    const lastIncomingTsStr = (function(t){
      if (!t) return '';
      if (typeof t === 'string') return t;
      if (typeof t.toDate === 'function') { try { return t.toDate().toISOString(); } catch(_) {} }
      if (typeof t.seconds === 'number') return new Date(t.seconds * 1000).toISOString();
      if (t instanceof Date) return t.toISOString();
      try { return String(t); } catch(_) { return ''; }
    })(lastIncoming && lastIncoming.ts);
    const lastIncomingDays = lastIncoming ? daysSince(lastIncomingTsStr.slice(0, 10)) : 9999;

    // 家族構成
    const children = (client.family || []).filter(m => m.rel === 'child');
    const spouse = (client.family || []).find(m => m.rel === 'spouse');

    // 保有商品ギャップ
    const owns = (client.products || []).map(p => p.toLowerCase());
    const hasNisa = owns.some(p => p.includes('nisa'));
    const hasIdeco = owns.some(p => p.includes('ideco') || p.includes('idecoまた'));

    // === インテント判定 (優先度順) ===
    let intent = '定期フォロー', reason = '', situation = '';

    if (recentCancel) {
      intent = 'キャンセル後の再アプローチ';
      reason = `${recentCancelDays}日前にキャンセル (理由: ${recentCancel.reason || '不明'})`;
      situation = `直前のキャンセル理由「${recentCancel.reason || '理由なし'}」を踏まえ、お客様の負担にならない柔らかい再提案`;
    } else if (stalledProp) {
      const stalledDays = daysSince(stalledProp.date);
      intent = `${stalledProp.title} のフォローアップ`;
      reason = `${stalledDays}日前提案 / ${stalledProp.result}のまま`;
      situation = `${stalledDays}日前にご提案した「${stalledProp.title}」がまだ${stalledProp.result}。今のタイミングで決断材料を追加して提示`;
    } else if (nearestEv) {
      const evDate = nearestEv.date;
      const daysAway = Math.round((evDate - TODAY) / 86400000);
      const monthsAway = Math.round(daysAway / 30);
      intent = `${nearestEv.label} の事前準備提案`;
      reason = `${monthsAway}ヶ月後に「${nearestEv.label}」(${nearestEv.who})`;
      situation = `${nearestEv.who}様の「${nearestEv.label}」が${monthsAway}ヶ月後。今が準備のラストチャンス`;
    } else if (dsl != null && dsl >= 365) {
      intent = '1年以上未接触の近況伺い';
      reason = `最終接触 ${dsl}日前`;
      situation = `1年以上接触なし。ライフ状況に変化があったか伺いつつ再エンゲージ`;
    } else if (topRec) {
      intent = topRec.action;
      reason = topRec.reason;
      situation = topRec.reason;
    } else {
      intent = '定期フォロー';
      reason = dsl == null ? '最終接触 未記録' : `最終接触 ${dsl}日前`;
      situation = `特段の緊急事項なし。関係維持のための軽い連絡`;
    }

    // === 提案内容の組み立て (具体的) ===
    function buildProposals() {
      const props = [];
      if (recentCancel) {
        if (recentCancel.reason && recentCancel.reason.includes('日程')) {
          props.push('改めて別日候補を3つご提案 (時間帯も柔軟に)');
        } else if (recentCancel.reason && recentCancel.reason.includes('忙し')) {
          props.push('ご都合つく時期を伺うだけのライト連絡');
        } else {
          props.push('内容を整理した1ページ資料を先にお送り → ご都合つく時に面談');
        }
      } else if (stalledProp) {
        props.push(`「${stalledProp.title}」の最新シミュレーション (前回からの市況変化を反映)`);
        if (lastSuccessProp) {
          props.push(`過去にご成約いただいた「${lastSuccessProp.title}」との組み合わせ最適化`);
        }
        props.push('15分のお電話 or Zoom で疑問点を即解消');
      } else if (nearestEv) {
        if (/教育|大学|入学/.test(nearestEv.label)) {
          const childName = (children[0] && children[0].name) || `${nearestEv.who}`;
          props.push(`${childName}様の教育資金、現状残額と必要額のギャップ計算`);
          if (!hasNisa) props.push('NISA未活用なら、教育資金枠としての活用案');
          props.push('奨学金との比較表 (学資保険 vs 投資信託 vs 奨学金)');
        } else if (/退職|年金/.test(nearestEv.label)) {
          props.push(`退職金の受取方法 (一時金 vs 年金) — 税制シミュレーション`);
          if (!hasIdeco) props.push('iDeCo の出口戦略 (受給開始タイミング)');
          props.push('公的年金の繰下げ判定 (繰下げで+0.7%/月)');
        } else if (/相続/.test(nearestEv.label)) {
          props.push('基礎控除と相続税シミュレーション (家族構成ベース)');
          props.push('生前贈与の年110万円枠の活用案');
        } else if (/住宅|ローン/.test(nearestEv.label)) {
          props.push('繰上返済 vs 投資の比較 (金利と期待リターン)');
          props.push('団信見直し (収入保障保険との重複チェック)');
        } else {
          props.push(`「${nearestEv.label}」に向けた資金準備プラン (3案)`);
        }
      } else if (dsl >= 365) {
        props.push('ライフプランの定期見直し (年1回が理想)');
        props.push('家計の現状チェックシート (5分で完了)');
        if (!hasNisa || !hasIdeco) {
          props.push('NISA・iDeCo の最新枠拡充に対応した配分見直し');
        }
      } else {
        props.push('資産配分の年次レビュー');
        // ★ age null/不正 (-1歳バグ修正): 年齢未取得時は ライフステージ 表現に switch
        props.push((age != null && age >= 0)
          ? `${age}歳のライフステージに合った新しい商品/制度のご紹介`
          : 'ライフステージに合った新しい商品/制度のご紹介');
      }
      return props.slice(0, 3);
    }

    const proposals = buildProposals();

    // === トーン別 本文生成 ===
    const tones = [
      // トーン0: 標準・丁寧 — 具体提案つき
      () => {
        let b = `${lastName}様\n\nご無沙汰しております、ファイナンシャルプランナーの福田です。\n\n`;

        // 状況把握の一文
        if (recentCancel) {
          b += `先日はご予約のキャンセルご連絡ありがとうございました。\nまたお時間つけば、ぜひ改めてご一緒できればと思っております。\n\n`;
        } else if (stalledProp) {
          b += `先日ご提案させていただいた「${stalledProp.title}」の件、その後ご検討状況はいかがでしょうか。\n\n`;
        } else if (nearestEv) {
          const monthsAway = Math.round((nearestEv.date - TODAY) / 86400000 / 30);
          b += `${nearestEv.who}様の「${nearestEv.label}」まで${monthsAway}ヶ月となりました。\nこのタイミングで、いくつかご一緒に確認できればと思いご連絡しました。\n\n`;
        } else if (dsl >= 365) {
          b += `お変わりなくお過ごしでしょうか。\n前回ご相談から${Math.round(dsl/30)}ヶ月が経ち、ご家族や家計の状況に変化があるかもしれませんね。\n\n`;
        } else if (lastIncoming && lastIncomingDays < 14) {
          b += `先日はメッセージありがとうございました。\n${lastName}様の現状を踏まえて、改めて整理してみました。\n\n`;
        } else {
          b += `最近のご様子はいかがですか。\n\n`;
        }

        // 提案リスト
        if (proposals.length > 0) {
          b += `今、${lastName}様にお話しできそうな内容を整理しました:\n\n`;
          proposals.forEach((p, i) => { b += `${i + 1}. ${p}\n`; });
          b += `\n上記いずれかでも、ご興味ある内容があればお気軽にご返信ください。`;
        }

        b += `\n\nどうぞよろしくお願いいたします。\n— 福田`;
        return b;
      },

      // トーン1: カジュアル親しみ
      () => {
        let b = `${lastName}様、こんにちは!福田です😊\n\n`;

        if (recentCancel) {
          b += `先日のご都合つかなくて残念でした。\nまた良いタイミングがあればぜひ✨\n\n`;
        } else if (stalledProp) {
          b += `先日お話しした「${stalledProp.title}」、その後どうですか?\n気になる点があればお気軽に💬\n\n`;
        } else if (nearestEv) {
          b += `${nearestEv.who}様の${nearestEv.label}、いよいよ近づいてきましたね!\n\n`;
        } else if (dsl >= 365) {
          b += `お久しぶりです!ご家族みなさん元気にしていますか?\n\n`;
        } else {
          b += `お元気ですか?\n\n`;
        }

        if (proposals.length > 0) {
          b += `こんなトピックでお話できそうです:\n`;
          proposals.forEach(p => { b += `・ ${p}\n`; });
          b += `\n「これ気になる」があればスタンプ1つでもOKです👌`;
        }
        return b;
      },

      // トーン2: 提案型・具体アクション
      () => {
        let b = `${lastName}様\n\n福田です。\n${situation}と考え、ご連絡しました。\n\n`;

        b += `【ご提案 ${proposals.length}つ】\n`;
        proposals.forEach((p, i) => { b += `${i + 1}. ${p}\n`; });

        b += `\n所要 15〜30分のZoomで上記すべてカバーできます。\n下記の候補日でご都合いかがでしょうか?\n\n(本メッセージの後に候補日3つお送りします)`;
        return b;
      },
    ];

    const body = tones[toneIndex % 3]();
    return { intent, reason, body, situation, proposals };
  }

  function closeModal(options) {
    options = options || {};
    document.getElementById('modal-overlay').style.display = 'none';
    // ★ 閉じたら復元 flag クリア
    try {
      localStorage.removeItem('fp-last-open-client');
      localStorage.removeItem('fp-last-open-mode');
    } catch (_) {}
    window._fpCurrentClient = null;
    // ★ URL routing: customer / tab パラメータ を 除去 (popstate由来でない時)
    if (!options.fromPopstate) {
      try { pushModalUrl(null, null); } catch (_) {}
    }
    // ★ 2026-06-26 重さ解消 Phase 5: モーダル open 中に保留した 背景render を消化
    try { if (typeof window._fpFlushPendingBgRender === 'function') window._fpFlushPendingBgRender(); } catch (_) {}
  }

  // ============================
  // KPI / タスク 管理
  // ============================
  function getKpiDefinitions() {
    const today = TODAY;
    const days = (d) => Math.floor((today - new Date(d)) / 86400000);
    return [
      {
        id: 'kpi-untouched',
        icon: 'phone-missed',
        title: 'アクティブ顧客 月1接触',
        goal: '全顧客に月1回以上の接触',
        unit: '名',
        targetCount: () => clients.filter(c => c.status !== 'dormant').length,
        targetClients: () => clients.filter(c => c.status !== 'dormant' && days(c.lastContact) >= 30),
        intent: '30日以上未接触のため、軽い近況伺いを送る',
      },
      {
        id: 'kpi-stalled',
        icon: 'clock',
        title: '提案検討中のクロージング',
        goal: '90日以内に成約 / 見送り判定',
        unit: '名',
        targetCount: () => clients.filter(c => (c.proposals || []).some(p => p.result === '検討中' || p.result === '提案中')).length,
        targetClients: () => clients.filter(c => {
          const p = (c.proposals || []).slice().reverse().find(p => p.result === '検討中' || p.result === '提案中');
          return p && days(p.date) >= 30;
        }),
        intent: '提案が検討中のまま停滞。決断材料を追加して push',
      },
      {
        id: 'kpi-event',
        icon: 'calendar-clock',
        title: 'ライフイベント先取り',
        goal: 'イベント前60日以内に必ず1接触',
        unit: '名',
        targetCount: () => clients.length,
        targetClients: () => clients.filter(c => {
          if (!window.LifeEvents) return false;
          const evs = window.LifeEvents.generate(c) || [];
          const near = evs.find(ev => {
            const d = (ev.date - today) / 86400000;
            return ev.major && d >= 0 && d <= 60;
          });
          return !!near && days(c.lastContact) >= 21;
        }),
        intent: '60日以内のライフイベント前 / 21日以上未接触',
      },
      {
        id: 'kpi-dormant',
        icon: 'moon',
        title: '休眠客の再エンゲージ',
        goal: '月3名以上を起こす',
        unit: '名',
        targetCount: () => 3,
        targetClients: () => clients.filter(c => c.status === 'dormant' || days(c.lastContact) >= 180).slice(0, 8),
        intent: '180日以上未接触 / 休眠ステータス。軽いトピックで再開',
      },
      {
        id: 'kpi-cancel-recovery',
        icon: 'rotate-ccw',
        title: 'キャンセル後の再アプローチ',
        goal: 'キャンセル後7日以内に必ずフォロー',
        unit: '名',
        targetCount: () => clients.filter(c => (c.cancellations || []).length > 0).length,
        targetClients: () => clients.filter(c => {
          const last = (c.cancellations || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
          return last && days(last.date) <= 30 && days(c.lastContact) > days(last.date) - 1;
        }),
        intent: '直近キャンセル / フォロー未実施',
      },
    ];
  }

  function renderKpiBoard() {
    const wrap = document.getElementById('kpi-board');
    if (!wrap) return;
    const defs = getKpiDefinitions();

    const totalRemaining = defs.reduce((s, d) => s + d.targetClients().length, 0);
    const navCount = document.getElementById('nav-count-kpi');
    if (navCount) navCount.textContent = totalRemaining || '';

    wrap.innerHTML = defs.map(def => {
      const clientsList = def.targetClients();
      const total = def.targetCount();
      const remaining = clientsList.length;
      const done = Math.max(0, total - remaining);
      const pct = total > 0 ? Math.round(done / total * 100) : 100;
      const status = remaining === 0 ? 'good' : (remaining > total * 0.5 ? 'critical' : 'warn');

      const tasksHtml = clientsList.slice(0, 10).map(c => {
        const dslRaw = Math.floor((TODAY - new Date(c.lastContact)) / 86400000);
        const dsl = isNaN(dslRaw) ? null : dslRaw;
        const initial = (c.name || '?').replace(/\s+/g, '').slice(0, 1);
        return `
          <div class="kpi-task" data-kpi-client="${c.id}">
            <div class="kpi-task-avatar">${escapeHtml(initial)}</div>
            <div class="kpi-task-body">
              <div class="kpi-task-name">${escapeHtml(c.name)} 様 <span class="status-pill ${c.status}">${statusLabel(c.status)}</span></div>
              <div class="kpi-task-meta">${dsl == null ? '最終接触 未記録' : `最終接触 ${dsl}日前`} / ${escapeHtml(c.occupation || '—')} / AUM ¥${fmtMoney(c.aum)}</div>
            </div>
            <button class="kpi-task-btn primary" data-kpi-ai="${c.id}">
              <i data-lucide="wand-2"></i><span>AI下書き → 送信</span>
            </button>
          </div>
        `;
      }).join('') || '<div class="kpi-empty"><i data-lucide="check-circle-2"></i><span>このKPIは今月達成済みです 🎉</span></div>';

      return `
        <div class="kpi-card kpi-tone-${status}">
          <div class="kpi-card-head">
            <div class="kpi-card-icon"><i data-lucide="${def.icon}"></i></div>
            <div class="kpi-card-meta">
              <div class="kpi-card-title">${escapeHtml(def.title)}</div>
              <div class="kpi-card-goal">${escapeHtml(def.goal)}</div>
            </div>
            <div class="kpi-card-stats">
              <div class="kpi-stat-num">${remaining}<span class="kpi-stat-unit">${def.unit}</span></div>
              <div class="kpi-stat-label">未対応</div>
            </div>
          </div>
          <div class="kpi-card-progress">
            <div class="kpi-progress-bar"><div class="kpi-progress-fill" style="width:${pct}%"></div></div>
            <div class="kpi-progress-meta">対応済 <strong>${done}</strong> / 目標 <strong>${total}</strong> (${pct}%)</div>
          </div>
          <div class="kpi-card-intent">
            <i data-lucide="info"></i>
            <span>${escapeHtml(def.intent)}</span>
          </div>
          <div class="kpi-task-list">
            ${tasksHtml}
          </div>
        </div>
      `;
    }).join('');

    // Wire actions
    wrap.querySelectorAll('[data-kpi-ai]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.dataset.kpiAi;
        const c = clients.find(x => x.id === cid);
        if (!c) return;
        const evs = window.LifeEvents.generate(c);
        const recs = window.Recommender.forClient(c, evs);
        openDraftReplyModal(c, evs, recs);
      });
    });
    wrap.querySelectorAll('[data-kpi-client]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openClientModal(row.dataset.kpiClient);
      });
    });
  }

  // Render on tab switch
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.tab[data-tab="kpi"]');
    if (t) setTimeout(renderKpiBoard, 80);
  });
  setTimeout(renderKpiBoard, 1000);

  // ============================
  // 実モード ⇄ デモモード 切替
  // ============================
  function updateRealModeUi() {
    const btn = document.getElementById('real-mode-btn');
    const label = document.getElementById('real-mode-label');
    if (!btn) return;
    const on = isRealMode();
    btn.classList.toggle('real-mode-on', on);
    const realCount = getRealClients().length;
    if (label) {
      label.textContent = on
        ? '実モード (' + realCount + '名)'
        : 'デモモード (' + demoClients.length + '名)';
    }
  }
  function reloadEverything() {
    // 客リスト変更は再ロードで確実に反映
    setTimeout(() => location.reload(), 50);
  }
  // expose
  window.fpcRealMode = { isRealMode, setRealMode, getRealClients, reloadEverything };

  function openRealModeDialog() {
    const list = getRealClients();
    const html = `
      <div class="realmode-dialog">
        <div class="realmode-head">
          <h2>実モード設定</h2>
          <button class="realmode-close" id="rm-close" aria-label="閉じる">×</button>
        </div>
        <div class="realmode-body">
          <label class="realmode-toggle-row">
            <input type="checkbox" id="rm-toggle" ${isRealMode() ? 'checked' : ''}>
            <span class="realmode-toggle-label"><strong>デモ客 (${demoClients.length}名) を非表示にして、実客のみ表示</strong><br>OFF にすればすぐ元に戻ります。</span>
          </label>

          <div class="realmode-section-title">登録済みの実客 (${list.length}名)</div>
          <div class="realmode-list" id="rm-list">
            ${list.length === 0 ? '<div class="realmode-empty">まだ登録された実客はいません</div>' : list.map((c, i) => `
              <div class="realmode-row">
                <div class="realmode-row-info">
                  <div class="realmode-row-name">${escapeHtml(c.name)} 様</div>
                  <div class="realmode-row-meta">${(c.lineFriendId || '').slice(0, 12)}…</div>
                </div>
                <button class="realmode-row-del" data-rm-del="${i}"><i data-lucide="trash-2"></i></button>
              </div>
            `).join('')}
          </div>

          <div class="realmode-section-title">＋ 新しい実客を追加</div>
          <div class="realmode-form">
            <label>お名前 <input type="text" id="rm-name" placeholder="例: 鈴木 太郎"></label>
            <label>フリガナ <input type="text" id="rm-kana" placeholder="例: すずき たろう"></label>
            <label>年齢 <input type="number" id="rm-age" placeholder="例: 52" min="20" max="100"></label>
            <label>職業 <input type="text" id="rm-job" placeholder="例: 会社員"></label>
            <label>LINE userId <small>(Uで始まる文字列)</small> <input type="text" id="rm-uid" placeholder="例: U5b483d87fba587..."></label>
            <label>管理資産 (万円) <input type="number" id="rm-aum" placeholder="例: 1500" min="0"></label>
            <button class="realmode-add-btn" id="rm-add"><i data-lucide="plus"></i>追加する</button>
          </div>
        </div>
      </div>
    `;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(overlay);
    if (window.lucide) window.lucide.createIcons();

    const close = () => overlay.remove();
    overlay.querySelector('#rm-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#rm-toggle').addEventListener('change', e => {
      setRealMode(e.target.checked);
      reloadEverything();
    });

    overlay.querySelectorAll('[data-rm-del]').forEach(b => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.rmDel, 10);
        const arr = getRealClients();
        arr.splice(idx, 1);
        saveRealClients(arr);
        close();
        openRealModeDialog();
        reloadEverything();
      });
    });

    overlay.querySelector('#rm-add').addEventListener('click', () => {
      const name = overlay.querySelector('#rm-name').value.trim();
      const kana = overlay.querySelector('#rm-kana').value.trim();
      const age = parseInt(overlay.querySelector('#rm-age').value, 10);
      const job = overlay.querySelector('#rm-job').value.trim() || '未設定';
      const uid = overlay.querySelector('#rm-uid').value.trim();
      const aumMan = parseInt(overlay.querySelector('#rm-aum').value, 10) || 0;
      if (!name || !age) {
        alert('お名前と年齢は必須です');
        return;
      }
      const cYear = TODAY.getFullYear();
      const birth = (cYear - age) + '-01-01';
      const id = 'r-' + Date.now().toString(36);
      const newClient = {
        id, name, kana,
        birth, gender: 'M',
        occupation: job,
        family: [], source: '実客登録',
        status: 'new',
        aum: aumMan * 10000,
        lastContact: TODAY.toISOString().slice(0, 10),
        proposals: [],
        note: '',
        lineFriendId: uid || '',
        lineSubscribed: !!uid,
        cancellations: [],
        lineHistory: [],
      };
      const arr = getRealClients();
      arr.push(newClient);
      saveRealClients(arr);
      close();
      // 即実モードへ
      if (!isRealMode()) setRealMode(true);
      openRealModeDialog();
      reloadEverything();
    });
  }
  document.getElementById('real-mode-btn')?.addEventListener('click', openRealModeDialog);
  setTimeout(updateRealModeUi, 200);

  // ============================
  // 🏷 タグ機能 (FP自由作成 + 顧客割当)
  // ============================
  const TAG_COLORS = ['#5B5BF0', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#EF4444', '#84CC16', '#F97316', '#0EA5E9'];
  // ★ 議事録 から 全 client に AI自動タグ を 一括反映 (renderClients から call)
  //   商品キーワード regex 抽出 → c.autoTags に set。 既存マニュアルタグとは別軸 (AI badge付き chip)
  const FP_PRODUCT_AUTOTAG_PATTERNS = [
    { key: 'nisa',        re: /NISA|ニーサ|つみたて/i,                              label: 'NISA',     color: '#3B82F6' },
    { key: 'ideco',       re: /iDeCo|イデコ|個人型確定拠出/i,                       label: 'iDeCo',    color: '#6366F1' },
    { key: 'life_ins',    re: /生命保険|終身保険|定期保険|死亡保険/,               label: '生命保険',  color: '#EF4444' },
    { key: 'med_ins',     re: /医療保険|がん保険|ガン保険|入院保険/,               label: '医療保険',  color: '#F59E0B' },
    { key: 'mortgage',    re: /住宅ローン|フラット35|変動金利|固定金利/,           label: '住宅ローン', color: '#84CC16' },
    { key: 'inheritance', re: /相続|遺言|信託|生前贈与/,                           label: '相続',     color: '#A855F7' },
    { key: 'edu_fund',    re: /教育(資金|費)|学資保険|大学費用|進学費/,           label: '教育資金',  color: '#06B6D4' },
    { key: 'business',    re: /開業|起業|個人事業主|法人化/,                       label: '開業',     color: '#EC4899' },
    { key: 'retire_fund', re: /老後資金|退職金|年金繰下げ|繰り上げ返済/,           label: '老後資金',  color: '#0EA5E9' },
    { key: 'real_estate', re: /不動産投資|マンション投資|REIT/,                    label: '不動産',   color: '#14B8A6' },
    { key: 'stock',       re: /個別株|株式投資|高配当株/,                          label: '株式',     color: '#EAB308' },
    { key: 'fx',          re: /FX|外貨預金|外貨建て/,                              label: '外貨',     color: '#F97316' },
  ];
  function autoTagAllClients() {
    if (!Array.isArray(window.DUMMY_CLIENTS)) return;
    const liveAi = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
    if (liveAi.length === 0) return;
    let changed = 0;
    window.DUMMY_CLIENTS.forEach(c => {
      const cConfMs = c.confirmedSlot ? new Date(String(c.confirmedSlot).replace(' ', 'T')).getTime() : NaN;
      const detected = new Set();
      liveAi.forEach(r => {
        const strictMatch = (r.userId && c.lineFriendId && r.userId === c.lineFriendId)
                         || (r.customerName && r.customerName !== 'お客様' && r.customerName === c.name);
        let rescued = false;
        if (!strictMatch && !isNaN(cConfMs) && (!r.customerName || r.customerName === 'お客様') && !r.userId) {
          const rMs = new Date(String(r.ts || r.createdAt || r.bookingTs || '').replace(' ', 'T')).getTime();
          if (!isNaN(rMs) && Math.abs(rMs - cConfMs) < 6 * 60 * 60 * 1000) rescued = true;
        }
        if (!strictMatch && !rescued) return;
        const text = String(r.summary || '') + '\n' + String(r.transcript || '') + '\n' + (Array.isArray(r.key_concerns) ? r.key_concerns.join(' ') : String(r.key_concerns || ''));
        FP_PRODUCT_AUTOTAG_PATTERNS.forEach(p => { if (p.re.test(text)) detected.add(p.key); });
      });
      const newTags = Array.from(detected).map(k => FP_PRODUCT_AUTOTAG_PATTERNS.find(p => p.key === k)).filter(Boolean);
      const oldKeys = (c.autoTags || []).map(t => t.key).sort().join(',');
      const newKeys = newTags.map(t => t.key).sort().join(',');
      if (oldKeys !== newKeys) { c.autoTags = newTags; changed++; }
    });
    if (changed > 0) {
      try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS)); } catch (_) {}
      console.log('[autoTagAll] updated', changed, 'clients');
    }
  }
  // ★ 2026-06-22 roundI: 顧客台帳タグセグメント filter UI
  function renderClientTagSegmentBar() {
    const bar = document.getElementById('client-tag-segment-bar');
    const chipsEl = document.getElementById('client-tag-chips');
    const clearBtn = document.getElementById('client-tag-clear');
    if (!bar || !chipsEl) return;
    const master = (typeof getTagsMaster === 'function') ? getTagsMaster() : [];
    if (!master.length) { bar.style.display = 'none'; return; }
    // 各タグの該当顧客数を計算
    const tagCount = {};
    master.forEach(t => { tagCount[t.id] = 0; });
    (clients || []).forEach(c => {
      const ids = (typeof getClientTags === 'function') ? getClientTags(c.id) : [];
      ids.forEach(id => { if (tagCount.hasOwnProperty(id)) tagCount[id]++; });
    });
    // 0件タグは隠す
    const visible = master.filter(t => tagCount[t.id] > 0);
    if (!visible.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    state.tagFilter = state.tagFilter || [];
    chipsEl.innerHTML = visible.map(t => {
      const on = state.tagFilter.includes(t.id);
      const col = validColor(t.color);
      const bg = on ? col : '#fff';
      const fg = on ? '#fff' : col;
      const border = col;
      return `<button data-client-tag-filter="${escapeHtml(t.id)}" style="background:${bg};color:${fg};border:1.5px solid ${border};padding:5px 12px;border-radius:99px;font-size:11.5px;font-weight:800;cursor:pointer;font-family:'Hiragino Sans',sans-serif;letter-spacing:0.02em;display:inline-flex;align-items:center;gap:5px;transition:all .12s;">${escapeHtml(t.label || t.id)}<span style="opacity:.75;font-weight:700;font-size:10.5px;">${tagCount[t.id]}</span></button>`;
    }).join('');
    clearBtn.style.display = state.tagFilter.length > 0 ? '' : 'none';
    chipsEl.querySelectorAll('[data-client-tag-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.clientTagFilter;
        const idx = state.tagFilter.indexOf(tid);
        if (idx >= 0) state.tagFilter.splice(idx, 1);
        else state.tagFilter.push(tid);
        renderClients();
      });
    });
    clearBtn.onclick = () => { state.tagFilter = []; renderClients(); };
  }

  function getTagsMaster() {
    try { return JSON.parse(localStorage.getItem('fp-tags-master') || '[]'); } catch (_) { return []; }
  }
  function saveTagsMaster(tags) {
    localStorage.setItem('fp-tags-master', JSON.stringify(tags));
  }
  function getClientTags(clientId) {
    try { return JSON.parse(localStorage.getItem('fp-client-tags-' + clientId) || '[]'); } catch (_) { return []; }
  }
  function saveClientTags(clientId, tagIds) {
    localStorage.setItem('fp-client-tags-' + clientId, JSON.stringify(tagIds));
  }
  function renderClientTags(clientId) {
    const wrap = document.getElementById('cd-tags-list');
    if (!wrap) return;
    const master = getTagsMaster();
    const myTagIds = getClientTags(clientId);
    const myTags = myTagIds.map(id => master.find(t => t.id === id)).filter(Boolean);
    if (myTags.length === 0) {
      wrap.innerHTML = '<div style="font-size:11px;color:#94A3B8;font-style:italic;">タグなし — 「+ 追加 / 編集」 から付けてみる</div>';
      return;
    }
    wrap.innerHTML = myTags.map(t => { const col = validColor(t.color); return `
      <span style="display:inline-flex;align-items:center;gap:6px;background:${col}1A;color:${col};border:1px solid ${col}55;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:700;">
        ${escapeHtml(t.label)}
      </span>
    `; }).join('');
  }
  function openTagEditor(clientId) {
    const master = getTagsMaster();
    const myTagIds = getClientTags(clientId);
    const overlay = document.createElement('div');
    overlay.id = 'fp-tag-editor-ov';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:20px;';
    const renderModal = () => {
      const m = getTagsMaster();
      const mySet = new Set(getClientTags(clientId));
      overlay.innerHTML = `
        <div style="background:#fff;max-width:520px;width:100%;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;font-family:'Noto Sans JP',sans-serif;">
          <div style="padding:18px 24px;border-bottom:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;font-size:15px;font-weight:800;color:#0F172A;display:inline-flex;align-items:center;gap:8px;">
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none" style="flex-shrink:0;">
                <path d="M15 9 L24 9 C25.1 9 26 9.9 26 11 L26 19 C26 19.5 25.8 20 25.4 20.4 L18.4 27.4 C17.6 28.2 16.3 28.2 15.5 27.4 L8.5 20.4 C7.7 19.6 7.7 18.3 8.5 17.5 L15 11 Z" fill="#E58FAE"/>
                <circle cx="20.5" cy="14.5" r="2" fill="#14213D"/>
                <path d="M11 5 L20 5 C21.1 5 22 5.9 22 7 L22 15 C22 15.5 21.8 16 21.4 16.4 L14.4 23.4 C13.6 24.2 12.3 24.2 11.5 23.4 L4.5 16.4 C3.7 15.6 3.7 14.3 4.5 13.5 L11 7 Z" fill="#fff" stroke="#14213D" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
                <circle cx="16.5" cy="10.5" r="1.6" fill="#14213D"/>
              </svg>
              タグの追加 / 編集
            </h3>
            <button id="fp-tag-close" style="background:transparent;border:none;cursor:pointer;font-size:20px;color:#94A3B8;">✕</button>
          </div>
          <div style="padding:20px 24px;">
            <div style="font-size:11px;font-weight:800;color:#475569;letter-spacing:0.06em;margin-bottom:10px;">この顧客に付けるタグ (クリックでON/OFF)</div>
            <div id="fp-tag-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px;min-height:24px;">
              ${m.length === 0 ? '<div style="font-size:11.5px;color:#94A3B8;font-style:italic;">まだタグがありません — 下から作ってください</div>' :
                m.map(t => {
                  const on = mySet.has(t.id);
                  const col = validColor(t.color);
                  return `<button data-tag="${escapeHtml(t.id)}" class="fp-tag-toggle" style="background:${on ? col : col+'1A'};color:${on ? '#fff' : col};border:1px solid ${col}${on ? '' : '55'};padding:6px 14px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">${on ? '✓ ' : ''}${escapeHtml(t.label)}</button>`;
                }).join('')}
            </div>

            <div style="border-top:1px dashed #E2E8F0;padding-top:18px;">
              <div style="font-size:11px;font-weight:800;color:#475569;letter-spacing:0.06em;margin-bottom:10px;">+ 新しいタグを作る</div>
              <div style="display:flex;gap:8px;align-items:center;">
                <input id="fp-tag-new-name" type="text" maxlength="20" placeholder="例: 法人客 / 紹介者 / VIP" style="flex:1;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;">
                <button id="fp-tag-create" style="background:#0F172A;color:#fff;border:none;padding:9px 18px;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;">作成</button>
              </div>

              ${m.length > 0 ? `<div style="margin-top:14px;font-size:10.5px;color:#94A3B8;">タグを削除: <span style="color:#64748B;">${m.map(t => `<button data-del="${t.id}" class="fp-tag-del" style="background:transparent;border:none;color:#DC2626;cursor:pointer;font-size:10.5px;text-decoration:underline;padding:0 4px;">${escapeHtml(t.label)}</button>`).join(' / ')}</span></div>` : ''}
            </div>
          </div>
          <div style="padding:14px 24px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;">
            <button id="fp-tag-done" style="background:#10B981;color:#fff;border:none;padding:10px 24px;border-radius:6px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">✓ 完了</button>
          </div>
        </div>
      `;
      // バインド
      // ★ どの方法で閉じても外の chip を再描画する (✕ / 完了 / 背景クリック)
      const closeAndRefresh = () => { overlay.remove(); renderClientTags(clientId); };
      overlay.querySelector('#fp-tag-close').addEventListener('click', closeAndRefresh);
      overlay.querySelector('#fp-tag-done').addEventListener('click', closeAndRefresh);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAndRefresh(); });
      overlay.querySelectorAll('.fp-tag-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.tag;
          const cur = getClientTags(clientId);
          const set = new Set(cur);
          if (set.has(id)) set.delete(id); else set.add(id);
          saveClientTags(clientId, Array.from(set));
          renderModal();
        });
      });
      const createNewTag = () => {
        const name = overlay.querySelector('#fp-tag-new-name').value.trim();
        if (!name) return;
        const cur = getTagsMaster();
        if (cur.some(t => t.label === name)) { alert('同名のタグが既にあります'); return; }
        const id = 't-' + Date.now().toString(36);
        const color = TAG_COLORS[cur.length % TAG_COLORS.length];
        cur.push({ id, label: name, color });
        saveTagsMaster(cur);
        // 作成直後にこの顧客にも付与
        const myCur = getClientTags(clientId);
        myCur.push(id);
        saveClientTags(clientId, myCur);
        // ★ オーナーfb: 「タグ付いたか分からない」→ 外の chip 即座に更新 + トースト
        renderClientTags(clientId);
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#10B981;color:#fff;padding:12px 22px;border-radius:8px;font-size:13px;font-weight:800;z-index:10080;box-shadow:0 12px 32px rgba(16,185,129,0.4);font-family:"Noto Sans JP",sans-serif;';
        toast.textContent = `✓ 「${name}」 を 顧客に付与しました`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2400);
        renderModal();
      };
      overlay.querySelector('#fp-tag-create').addEventListener('click', createNewTag);
      // Enter キーでも作成
      overlay.querySelector('#fp-tag-new-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); createNewTag(); }
      });
      overlay.querySelectorAll('.fp-tag-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.del;
          if (!confirm('このタグを削除しますか? (全顧客から外れます)')) return;
          // master から削除
          saveTagsMaster(getTagsMaster().filter(t => t.id !== id));
          // 全 client-tags から該当 id を除去
          Object.keys(localStorage).filter(k => k.startsWith('fp-client-tags-')).forEach(k => {
            try {
              const arr = JSON.parse(localStorage.getItem(k) || '[]').filter(x => x !== id);
              localStorage.setItem(k, JSON.stringify(arr));
            } catch (_) {}
          });
          renderModal();
        });
      });
    };
    renderModal();
    document.body.appendChild(overlay);
  }

  // ============================
  // util
  // ============================
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }
  // ★ CSS injection fix (2026-06-25): タグ color 値が #rgb / #rrggbb / #rrggbbaa 以外なら 中立色にfallback
  //   ユーザー入力 color を style に直入れすると `red;background:url(...)` 等で 別CSS差込 可能
  function validColor(c) {
    if (typeof c !== 'string') return '#888';
    return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#888';
  }

  // ============================
  // 初期化
  // ============================
  document.addEventListener('DOMContentLoaded', () => {
    // メタ
    document.getElementById('app-meta').textContent =
      `デモデータ ${clients.length}名 / 基準日 ${fmtDate(TODAY)}`;

    // タブ
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => activateTab(t.dataset.tab));
    });

    // 検索 (★ 2026-06-26 重さ解消: 200ms debounce + 連打ガード)
    const searchEl = document.getElementById('client-search');
    const debouncedSearchRender = debounce(() => {
      _lastClientsSig = clientsSignature();
      renderClients();
    }, 200);
    searchEl.addEventListener('input', e => {
      state.search = e.target.value;
      saveState();
      debouncedSearchRender();
    });
    document.getElementById('status-filter').addEventListener('change', e => {
      state.statusFilter = e.target.value;
      saveState();
      renderClients();
    });
    const sortByEl = document.getElementById('sort-by');
    if (sortByEl) {
      sortByEl.addEventListener('change', e => {
        state.sortBy = e.target.value;
        saveState();
        renderClients();
      });
    }

    // 新規顧客ボタン
    const addBtn = document.getElementById('add-client-btn');
    if (addBtn) addBtn.addEventListener('click', () => openClientForm(null));

    // ★ オーナーfb 2026-06-24: 顧客台帳 CSV エクスポート (Excel 互換 UTF-8 BOM)
    const csvBtn = document.getElementById('export-csv-btn');
    if (csvBtn) csvBtn.addEventListener('click', () => {
      const csvEsc = (v) => {
        const s = String(v == null ? '' : v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const ageOf = (birth) => {
        if (!birth) return '';
        const d = new Date(birth);
        if (isNaN(d)) return '';
        const t = new Date();
        let a = t.getFullYear() - d.getFullYear();
        if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
        return a;
      };
      const familyDesc = (c) => {
        if (!Array.isArray(c.family) || c.family.length === 0) return c.familyStructure || '単身';
        return c.family.map(f => f.relation || f.role || '').filter(Boolean).join('・') || (c.familyStructure || '');
      };
      const headers = ['名前', 'かな', '年齢', '職業', '家族構成', 'ステータス', '管理資産(円)', '最終接触日', 'LINE連携', '主な関心事'];
      const rows = clients.map(c => [
        c.name || '',
        c.nameKana || c.kana || '',
        ageOf(c.birth),
        c.occupation || '',
        familyDesc(c),
        c.status || '',
        c.aum || 0,
        c.lastContact || '',
        c.lineFriendId ? '✓' : '',
        (Array.isArray(c.interests) ? c.interests.join('・') : (c.interests || '')),
      ]);
      const csv = [headers, ...rows].map(r => r.map(csvEsc).join(',')).join('\r\n');
      const bom = '﻿';
      const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
      const today = new Date().toISOString().slice(0, 10);
      const fpName = (window.__fp?.tenantName || '').replace(/\s/g, '').replace(/—DEMOビュー/, '') || 'FP事務所';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `顧客台帳_${fpName}_${today}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    // モーダル外クリックで閉じる
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    document.getElementById('form-overlay').addEventListener('click', e => {
      if (e.target.id === 'form-overlay') {
        document.getElementById('form-overlay').style.display = 'none';
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModal();
        document.getElementById('form-overlay').style.display = 'none';
      }
    });

    // line-app.js から呼び出せるように公開
    window.FpApp = { openClientModal: openClientModal, openClientForm: openClientForm, getTagsMaster: getTagsMaster, getClientTags: getClientTags };

    // ★ URL routing: ?view=clients 等で起動された場合は state.activeTab を 上書き
    //   (activateTab を 呼ぶ前に やらないと 先に state.activeTab で URL を 上書きしてしまう)
    try {
      const urlView = new URLSearchParams(window.location.search).get('view');
      if (urlView && VALID_VIEWS.indexOf(urlView) >= 0) {
        state.activeTab = urlView;
      }
    } catch (_) {}
    activateTab(state.activeTab);

    // 残存 cleared flag を解除 (前回までの残骸)
    try { localStorage.removeItem('fp-cleared-permanently'); } catch (_) {}
    // ★ mergeLineActivity 90秒毎 (2026-06-25 軽量化: 非表示時 skip)
    setInterval(() => {
      if (document.hidden) return;
      try { mergeLineActivity(); } catch (e) { console.warn('mergeLineActivity periodic fail:', e); }
    }, 90000);
    // 起動直後も実行 (3秒待ってfetchLiveData完了を見越す)
    setTimeout(() => { try { mergeLineActivity(); } catch (_) {} }, 3000);

    // ★ オーナーfb「リロードで顧客台帳トップに戻る」: 最後に開いてた顧客モーダル復元
    try {
      const lastClient = localStorage.getItem('fp-last-open-client');
      const lastMode = localStorage.getItem('fp-last-open-mode');
      if (lastClient && lastMode) {
        setTimeout(() => {
          const c = clients.find(x => x.id === lastClient);
          if (!c) return;
          openClientModal(lastClient);
          if (lastMode === 'brief') {
            setTimeout(() => {
              const events = window.LifeEvents.generate(c);
              const recs = window.Recommender.forClient(c, events);
              openDraftReplyModal(c, events, recs);
            }, 200);
          }
        }, 500);
      }
    } catch (_) {}
  });
})();
