/* identify-line.js — 「この人は誰ですか?」 LINE 友だち と 台帳 の 名寄せ  (v20260922B)
   ------------------------------------------------------------------
   2026-09-22 owner fb:
     「先 に 面談 → 後 から アンケート → 最後 に LINE 友だち登録」 の 客 は
     LINE の 表示名 と 台帳 の 氏名 が 違う ので webhook の 自動 名寄せ が 外れ、
     customer doc が 2つ に 割れる。 サロンワークス と 同じ ように
     「この 友だち は どの お客様 ですか?」 と 聞いて 1つ に まとめ たい。
   ------------------------------------------------------------------
   この file が 触る の は:
     - 自前 の overlay (#idl-overlay) だけ。 既存 modal (#modal-overlay) には 触らない
     - window.DUMMY_CLIENTS の 配列 中身 (統合 後 の 後片付け)
     - Cloud Function mergeCustomerRecords / listLineFriends / linkCustomerToLineFriend
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var FB = {
    apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
    authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
    projectId: 'skeleton-fp-compass-632026',
  };
  var CALL_TIMEOUT_MS = 540000; // CF 側 は 300s。 既定 の 70s だと 履歴 の 多い 客 で 切れる
  var MIN_SCORE = 30;           // これ 未満 は 「候補」 と して 出さない (誤統合 防止)

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* ---- 名前 の 正規化 と 類似度 ------------------------------------- */
  function norm(s) {
    return String(s == null ? '' : s).replace(/[\s　]+/g, '').normalize('NFKC').toLowerCase();
  }
  function charSet(s) {
    var o = {}, i;
    for (i = 0; i < s.length; i++) o[s[i]] = 1;
    return o;
  }
  // 0-100。 100 = 完全一致
  function score(friendName, client) {
    var f = norm(friendName);
    if (!f) return 0;
    var best = 0;
    var targets = [norm(client && client.name), norm(client && client.kana)];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t) continue;
      if (t === f) { best = Math.max(best, 100); continue; }
      if (t.indexOf(f) >= 0 || f.indexOf(t) >= 0) { best = Math.max(best, 80); continue; }
      var a = charSet(f), b = charSet(t), hit = 0, k;
      for (k in b) if (a[k]) hit++;
      var denom = Math.max(Object.keys(a).length, Object.keys(b).length);
      if (denom) best = Math.max(best, Math.round(65 * hit / denom));
    }
    return best;
  }

  /* ---- client 配列 ------------------------------------------------- */
  function allClients() {
    return Array.isArray(window.DUMMY_CLIENTS) ? window.DUMMY_CLIENTS : [];
  }
  function fsId(c) {
    if (!c) return '';
    if (c._fsCustomerId) return c._fsCustomerId;
    if (c.docId) return c.docId;
    if (c.id && String(c.id).indexOf('fs-') === 0) return String(c.id).slice(3);
    return c.id || '';
  }
  function tenantId() {
    return (window.__fp && window.__fp.tenantId)
      || (window.AccountInfo && window.AccountInfo.tenantId)
      || localStorage.getItem('fp-tenantId') || '';
  }

  // まだ 「どの お客様 か」 が 決まって いない LINE 友だち
  function pending() {
    return allClients().filter(function (c) {
      return !!c.lineFriendId && c.source === 'line_follow' && !c.identityConfirmed;
    });
  }
  // webhook が 自動 で 作った 仮 doc か (= 消しても 台帳 の 情報 を 失わない)
  function isProvisional(c) {
    return !!c && c.source === 'line_follow' && !c.identityConfirmed;
  }
  // 統合先 の 候補 = LINE 未連携 の 台帳 客。 [{client, score}] を 返す (client 自体 は 汚さない)
  function candidatesFor(friend) {
    var nm = friend && (friend.lineDisplayName || friend.name);
    return allClients()
      .filter(function (c) { return c !== friend && !c.lineFriendId && String(c.name || '').trim(); })
      .map(function (c) { return { client: c, score: score(nm, c) }; })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return String(b.client.lastContact || '').localeCompare(String(a.client.lastContact || ''));
      });
  }

  /* ---- Firebase ---------------------------------------------------- */
  async function fbApp() {
    var m = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
    return m.getApps()[0] || m.initializeApp(FB);
  }
  async function callFn(name, payload) {
    var app = await fbApp();
    var f = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
    var fns = f.getFunctions(app, 'asia-northeast1');
    var res = await f.httpsCallable(fns, name, { timeout: CALL_TIMEOUT_MS })(payload);
    return (res && res.data) || {};
  }
  async function fsLib() {
    var app = await fbApp();
    var fs = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
    var db;
    try { db = fs.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }); }
    catch (_) { db = fs.getFirestore(app); }
    return { fs: fs, db: db };
  }
  // 既存 doc に だけ 書く (消えた doc を 復活 させない)
  async function updateCustomer(docId, patch) {
    var tid = tenantId();
    if (!tid) throw new Error('事務所 の 情報 が 読み込めて いません。 画面 を 開き直して ください');
    if (!docId) throw new Error('お客様 の ID が 取れません でした');
    var L = await fsLib();
    await L.fs.updateDoc(L.fs.doc(L.db, 'tenants', tid, 'customers', docId), patch);
  }
  // 統合先 が まだ Firestore に 無い 古い 手入力 客 の ため の 保険。
  //   すでに ある 場合 は 何も しない (空 で 上書き して 情報 を 消さない)
  async function ensureCustomerDoc(c) {
    var tid = tenantId();
    var id = fsId(c);
    if (!tid) throw new Error('事務所 の 情報 が 読み込めて いません。 画面 を 開き直して ください');
    if (!id) throw new Error('お客様 の ID が 取れません でした');
    var L = await fsLib();
    var ref = L.fs.doc(L.db, 'tenants', tid, 'customers', id);
    var snap = await L.fs.getDoc(ref);
    if (snap.exists()) return;
    await L.fs.setDoc(ref, {
      name: c.name || '', kana: c.kana || '', birth: c.birth || '',
      gender: c.gender || '', occupation: c.occupation || '',
      source: c.source || 'manual', status: c.status || 'new',
      aum: c.aum || 0, lastContact: c.lastContact || '', note: c.note || '',
      family: c.family || [], lineFriendId: '',
      createdAt: L.fs.serverTimestamp(), updatedAt: L.fs.serverTimestamp(),
    });
  }

  /* ---- localStorage 後片付け ---------------------------------------- */
  function persistLocal() {
    var arr = allClients();
    try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(arr)); } catch (_) {}
    try {
      if (localStorage.getItem('fp-crm-real-mode') === '1') {
        localStorage.setItem('fp-crm-real-clients-v1', JSON.stringify(arr));
      }
    } catch (_) {}
  }

  /* ---- バナー -------------------------------------------------------- */
  function renderBar() {
    var el = document.getElementById('idl-bar');
    if (!el) return;
    var n = pending().length;
    if (n === 0) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML =
      '<span style="font-size:19px;line-height:1;">🙋</span>' +
      '<div style="flex:1;min-width:180px;">' +
        '<div style="font-size:13.5px;font-weight:800;color:#1B3A5C;">LINEに登録した ' + n + '人 が、台帳のどのお客様か分かりません</div>' +
        '<div style="font-size:12px;color:#6B7280;margin-top:2px;">先に面談してから後でLINE登録した方は、ここでまとめられます</div>' +
      '</div>' +
      '<button id="idl-open-btn" style="background:#1B3A5C;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;">確認する</button>';
    var btn = document.getElementById('idl-open-btn');
    if (btn) btn.addEventListener('click', function () { open(0); });
  }

  /* ---- overlay の 土台 ------------------------------------------------ */
  var _idx = 0;
  var _prevOverflow = null;
  var _composing = false;

  function onEsc(e) {
    if (e.key !== 'Escape') return;
    // 下 に 顧客モーダル が いる 場合 が ある。 こちら だけ 閉じる
    e.stopImmediatePropagation();
    e.preventDefault();
    closeOverlay();
  }
  function closeOverlay() {
    var o = document.getElementById('idl-overlay');
    // IME 変換中 に 閉じる と compositionend が 来ない browser が ある。 必ず 戻す
    _composing = false;
    if (o && o.parentNode) o.parentNode.removeChild(o);
    if (_prevOverflow !== null) { document.body.style.overflow = _prevOverflow; _prevOverflow = null; }
    document.removeEventListener('keydown', onEsc, true);
  }
  function shell(innerHtml) {
    var o = document.getElementById('idl-overlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'idl-overlay';
      o.setAttribute('role', 'dialog');
      o.setAttribute('aria-modal', 'true');
      o.style.cssText = 'position:fixed;inset:0;z-index:12000;background:rgba(15,23,42,0.55);' +
        'display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto;';
      o.addEventListener('click', function (e) { if (e.target === o) closeOverlay(); });
      document.body.appendChild(o);
      _composing = false;
      _prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onEsc, true);
    }
    o.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:760px;width:100%;' +
      'max-height:92vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,0.3);' +
      'font-family:\'Noto Sans JP\',sans-serif;">' + innerHtml + '</div>';
    return o;
  }
  function setStatus(msg, color) {
    var el = document.getElementById('idl-status');
    if (el) { el.textContent = msg || ''; el.style.color = color || '#6B7280'; }
  }
  // 検索欄 は 作り直さ ない (作り直す と 日本語 の 変換 が 途切れる)
  function bindSearch(inputId, onChange) {
    var se = document.getElementById(inputId);
    if (!se) return;
    se.addEventListener('compositionstart', function () { _composing = true; });
    se.addEventListener('compositionend', function () { _composing = false; onChange(se.value); });
    se.addEventListener('input', function (e) {
      if (e && e.isComposing) return;
      if (_composing) return;
      onChange(se.value);
    });
  }

  function avatarHtml(c, size) {
    var px = size || 46;
    var url = (c && (c.linePictureUrl || c.pictureUrl)) || '';
    var initial = String((c && c.name) || '?').replace(/\s+/g, '').slice(0, 1);
    if (url) {
      return '<img src="' + esc(url) + '" alt="" style="width:' + px + 'px;height:' + px + 'px;border-radius:50%;object-fit:cover;display:block;border:2px solid #06c755;">';
    }
    return '<div style="width:' + px + 'px;height:' + px + 'px;border-radius:50%;background:#E2E8F0;color:#475569;' +
      'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:' + Math.round(px * 0.42) + 'px;">' + esc(initial) + '</div>';
  }

  /* ================================================================
     A. 台帳 側 から: 「この LINE の 人 は どの お客様?」
     ================================================================ */
  function open(startIndex) {
    var list = pending();
    if (list.length === 0) { closeOverlay(); return; }
    _idx = Math.min(Math.max(startIndex || 0, 0), list.length - 1);
    drawFrame('');
  }

  function drawDone() {
    shell('<div style="padding:40px 28px;text-align:center;">' +
      '<div style="font-size:34px;">✅</div>' +
      '<div style="font-size:16px;font-weight:800;color:#1B3A5C;margin-top:10px;">全員 確認 できました</div>' +
      '<button id="idl-done" style="margin-top:18px;background:#1B3A5C;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:13.5px;font-weight:800;cursor:pointer;font-family:inherit;">閉じる</button>' +
      '</div>');
    var d = document.getElementById('idl-done');
    if (d) d.addEventListener('click', closeOverlay);
  }

  function rowsHtmlFor(friend, query) {
    var cands = candidatesFor(friend);
    var shown;
    if (String(query || '').trim()) {
      var q = norm(query);
      shown = cands.filter(function (x) {
        return norm(x.client.name).indexOf(q) >= 0 || norm(x.client.kana).indexOf(q) >= 0;
      }).slice(0, 12);
    } else {
      shown = cands.filter(function (x) { return x.score >= MIN_SCORE; }).slice(0, 5);
      if (shown.length === 0 && cands.length > 0) {
        return '<div style="padding:18px 4px;color:#6B7280;font-size:13px;line-height:1.9;">' +
          'LINEの表示名から近いお客様を見つけられませんでした。<br>' +
          '<b style="color:#16202B;">台帳に登録しているお名前</b>（例: 山田）を上の欄に入れて探してください。' +
          '</div>';
      }
    }
    if (shown.length === 0) {
      return '<div style="padding:22px;text-align:center;color:#94A3B8;font-size:13px;">' +
        (cands.length === 0 ? 'LINE未連携のお客様が台帳にいません' : '該当するお客様がいません') + '</div>';
    }
    return shown.map(function (x) {
      var c = x.client;
      var badge = x.score >= 100 ? '<span style="background:#DCFCE7;color:#166534;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;">名前が一致</span>'
                : x.score >= 60 ? '<span style="background:#FEF3C7;color:#92400E;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;">名前が近い</span>'
                : '';
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-top:1px solid #EEF2F6;">' +
        avatarHtml(c, 38) +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:14px;font-weight:700;color:#16202B;">' + esc(c.name) + ' 様 ' + badge + '</div>' +
          '<div style="font-size:12px;color:#6B7280;margin-top:2px;">' +
            (c.kana ? esc(c.kana) + ' ／ ' : '') +
            (c.occupation ? esc(c.occupation) + ' ／ ' : '') +
            '最終接触 ' + esc(c.lastContact || '記録なし') +
          '</div>' +
        '</div>' +
        '<button class="idl-pick" data-cid="' + esc(String(c.id)) + '" style="background:#06c755;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;">この人です</button>' +
      '</div>';
    }).join('');
  }

  function bindPickButtons(friend) {
    Array.prototype.forEach.call(document.querySelectorAll('.idl-pick'), function (b) {
      b.addEventListener('click', function () {
        var c = allClients().filter(function (x) { return String(x.id) === b.dataset.cid; })[0];
        if (c) doMerge(friend, c, b);
      });
    });
  }

  function drawFrame(query) {
    var list = pending();
    if (list.length === 0) { drawDone(); return; }
    if (_idx >= list.length) _idx = list.length - 1;
    var f = list[_idx];
    var friendName = f.lineDisplayName || f.name || '(名前 なし)';

    shell(
      '<div style="padding:22px 26px 14px;border-bottom:1px solid #EEF2F6;display:flex;align-items:flex-start;gap:14px;">' +
        '<div style="flex:1;">' +
          '<div style="font-size:11.5px;font-weight:800;color:#94A3B8;letter-spacing:0.12em;">LINE の 名寄せ</div>' +
          '<div style="font-size:20px;font-weight:900;color:#16202B;margin-top:4px;">この人は どのお客様 ですか？</div>' +
          '<div style="font-size:12.5px;color:#6B7280;margin-top:5px;">選ぶと、LINEのやりとりが そのお客様のカードにまとまります。</div>' +
        '</div>' +
        '<button id="idl-close" aria-label="閉じる" style="background:none;border:none;font-size:22px;line-height:1;color:#94A3B8;cursor:pointer;">×</button>' +
      '</div>' +

      '<div style="padding:18px 26px;background:#F8FAFC;display:flex;align-items:center;gap:14px;">' +
        avatarHtml(f, 52) +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:16px;font-weight:800;color:#16202B;">' + esc(friendName) +
            '<span style="font-size:11px;color:#06c755;font-weight:800;margin-left:8px;background:#dcfce7;padding:2px 7px;border-radius:6px;">LINE</span></div>' +
          '<div style="font-size:12px;color:#6B7280;margin-top:3px;">友だち追加 ' + esc(f.lastContact || '日付なし') + ' ／ アンケート未回答</div>' +
        '</div>' +
        (list.length > 1 ? '<div style="font-size:12px;color:#6B7280;white-space:nowrap;">' + (_idx + 1) + ' / ' + list.length + ' 人目</div>' : '') +
      '</div>' +

      '<div style="padding:16px 26px 8px;">' +
        '<input id="idl-search" type="search" placeholder="お客様を名前で探す" value="' + esc(query || '') + '" ' +
          'style="width:100%;padding:10px 12px;border:1.5px solid #E3E7EE;border-radius:8px;font-size:13.5px;font-family:inherit;box-sizing:border-box;">' +
      '</div>' +

      '<div id="idl-rows" style="padding:0 26px;">' + rowsHtmlFor(f, query) + '</div>' +

      '<div style="padding:18px 26px 22px;margin-top:10px;border-top:1px solid #EEF2F6;display:flex;gap:10px;flex-wrap:wrap;">' +
        '<button id="idl-new" style="background:#fff;border:1.5px solid #1B3A5C;color:#1B3A5C;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">新しいお客様として そのまま残す</button>' +
        '<button id="idl-skip" style="background:#fff;border:1.5px solid #E3E7EE;color:#6B7280;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">あとで</button>' +
        '<div id="idl-status" style="flex:1;min-width:120px;font-size:12.5px;font-weight:700;color:#6B7280;align-self:center;text-align:right;"></div>' +
      '</div>'
    );

    var closeBtn = document.getElementById('idl-close');
    if (closeBtn) closeBtn.addEventListener('click', closeOverlay);

    bindSearch('idl-search', function (v) {
      var rows = document.getElementById('idl-rows');
      if (!rows) return;
      rows.innerHTML = rowsHtmlFor(f, v);
      bindPickButtons(f);
    });
    bindPickButtons(f);

    var nb = document.getElementById('idl-new');
    if (nb) nb.addEventListener('click', function () { doKeepAsNew(f, nb); });
    var sb = document.getElementById('idl-skip');
    if (sb) sb.addEventListener('click', function () {
      if (_idx + 1 < pending().length) { _idx++; drawFrame(''); }
      else closeOverlay();
    });
  }

  /* ---- 統合 ---------------------------------------------------------- */
  async function doMerge(friend, target, btn) {
    var srcId = fsId(friend), tgtId = fsId(target);
    if (!srcId || !tgtId) { alert('お客様のIDが取れませんでした'); return; }
    if (srcId === tgtId) { alert('同じお客様です'); return; }
    var fname = friend.lineDisplayName || friend.name;
    if (!confirm('LINE の「' + fname + '」さん を\n台帳 の「' + target.name + '」様 に まとめます。\n\n' +
                 '・LINE の やりとり は 「' + target.name + '」様 の カード に 移ります\n' +
                 '・「' + fname + '」の カード は なくなります\n' +
                 '・元 に 戻せません\n\nよろしい ですか?')) return;

    if (btn) { btn.disabled = true; btn.textContent = 'まとめ中…'; }
    setStatus('まとめています…', '#1B3A5C');
    try {
      await ensureCustomerDoc(target);
      await mergeAndCleanUp(friend, target);
      setStatus('まとめました', '#166534');
      setTimeout(function () { location.reload(); }, 700);
    } catch (e) {
      console.error('[identify-line] merge failed', e);
      setStatus('', '');
      alert('まとめられませんでした: ' + ((e && e.message) || e) + '\n\nデータ は 変わって いません。');
      if (btn) { btn.disabled = false; btn.textContent = 'この人です'; }
    }
  }

  // CF を 呼んで、 成功 したら ローカル 配列 も 揃える
  async function mergeAndCleanUp(source, target) {
    var srcId = fsId(source), tgtId = fsId(target);
    if (!srcId || !tgtId || srcId === tgtId) throw new Error('お客様のIDが取れませんでした');
    var r = await callFn('mergeCustomerRecords', { sourceCustomerId: srcId, targetCustomerId: tgtId });
    if (!r.ok) throw new Error('統合に失敗しました');
    var arr = allClients();
    var i = arr.indexOf(source);
    if (i >= 0) arr.splice(i, 1);
    target.lineFriendId = source.lineFriendId || target.lineFriendId;
    target.lineDisplayName = source.lineDisplayName || source.name || target.lineDisplayName;
    if (source.linePictureUrl || source.pictureUrl) {
      target.linePictureUrl = source.linePictureUrl || source.pictureUrl;
      target.pictureUrl = target.linePictureUrl;
    }
    target.identityConfirmed = true;
    persistLocal();
    return r;
  }

  /* ---- 新しいお客様 として 確定 ----------------------------------------- */
  async function doKeepAsNew(friend, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '登録中…'; }
    setStatus('登録しています…', '#1B3A5C');
    try {
      await updateCustomer(fsId(friend), { identityConfirmed: true });
      friend.identityConfirmed = true;
      persistLocal();
      setStatus('登録しました', '#166534');
      try { renderBar(); } catch (_) {}
      setTimeout(function () { drawFrame(''); }, 400);
    } catch (e) {
      console.error('[identify-line] keep-as-new failed', e);
      setStatus('', '');
      alert('登録できませんでした: ' + ((e && e.message) || e));
      if (btn) { btn.disabled = false; btn.textContent = '新しいお客様として そのまま残す'; }
    }
  }

  /* ================================================================
     B. 顧客カード 側 から: 「この お客様 は LINE の どの人?」
     ================================================================ */
  var _friends = [], _friendQuery = '', _taken = {};

  async function openForClient(client) {
    if (!client) return;
    shell('<div style="padding:40px 28px;text-align:center;color:#6B7280;font-size:13.5px;">LINE の 友だち一覧 を 読み込んでいます…</div>');
    try {
      var r = await callFn('listLineFriends', {});
      _friends = (r && r.friends) || [];
    } catch (e) {
      shell('<div style="padding:34px 28px;text-align:center;">' +
        '<div style="font-size:15px;font-weight:800;color:#991B1B;">友だち一覧 を 取れませんでした</div>' +
        '<div style="font-size:13px;color:#6B7280;margin-top:8px;">' + esc((e && e.message) || e) + '</div>' +
        '<button id="idl-close2" style="margin-top:18px;background:#1B3A5C;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:13.5px;font-weight:800;cursor:pointer;font-family:inherit;">閉じる</button></div>');
      var cb = document.getElementById('idl-close2');
      if (cb) cb.addEventListener('click', closeOverlay);
      return;
    }
    _taken = {};
    allClients().forEach(function (c) { if (c.lineFriendId && c !== client) _taken[c.lineFriendId] = c; });
    _friends.forEach(function (fr) { fr.__score = score(fr.displayName, client); });
    _friends.sort(function (a, b) { return b.__score - a.__score; });
    _friendQuery = '';
    drawFriendFrame(client);
  }

  function friendRowsHtml(client) {
    var shown = String(_friendQuery || '').trim()
      ? _friends.filter(function (fr) { return norm(fr.displayName).indexOf(norm(_friendQuery)) >= 0; }).slice(0, 20)
      : _friends.slice(0, 12);
    if (shown.length === 0) {
      return '<div style="padding:22px;text-align:center;color:#94A3B8;font-size:13px;">該当する友だちがいません</div>';
    }
    return shown.map(function (fr) {
      var dup = _taken[fr.id];
      var hard = dup && !isProvisional(dup);
      var warn = '';
      if (dup && !hard) {
        warn = '<div style="font-size:11.5px;color:#92400E;margin-top:2px;">いまは「' + esc(dup.name) + '」という仮のカードです（このカードは消えます）</div>';
      } else if (hard) {
        warn = '<div style="font-size:11.5px;color:#991B1B;font-weight:700;margin-top:2px;">⚠ すでに「' + esc(dup.name) + '」様として登録されています</div>';
      }
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-top:1px solid #EEF2F6;">' +
        (fr.pictureUrl
          ? '<img src="' + esc(fr.pictureUrl) + '" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid #06c755;">'
          : '<div style="width:38px;height:38px;border-radius:50%;background:#E2E8F0;"></div>') +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:14px;font-weight:700;color:#16202B;">' + esc(fr.displayName) + '</div>' + warn +
        '</div>' +
        '<button class="idl-fpick" data-fid="' + esc(fr.id) + '" data-fname="' + esc(fr.displayName) + '" style="background:' + (hard ? '#B45309' : '#06c755') + ';color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;">' +
          (hard ? '1つにまとめる' : 'この人です') + '</button>' +
      '</div>';
    }).join('');
  }

  function bindFriendButtons(client) {
    Array.prototype.forEach.call(document.querySelectorAll('.idl-fpick'), function (b) {
      b.addEventListener('click', function () {
        pickFriend(client, b.dataset.fid, b.dataset.fname, _taken[b.dataset.fid], b);
      });
    });
  }

  function drawFriendFrame(client) {
    shell(
      '<div style="padding:22px 26px 14px;border-bottom:1px solid #EEF2F6;display:flex;align-items:flex-start;gap:14px;">' +
        '<div style="flex:1;">' +
          '<div style="font-size:11.5px;font-weight:800;color:#94A3B8;letter-spacing:0.12em;">LINE の 名寄せ</div>' +
          '<div style="font-size:20px;font-weight:900;color:#16202B;margin-top:4px;">' + esc(client.name) + ' 様 は LINE の どの人 ですか？</div>' +
          '<div style="font-size:12.5px;color:#6B7280;margin-top:5px;">選ぶと、この お客様 の カード から LINE を 送れる ように なります。</div>' +
        '</div>' +
        '<button id="idl-close" aria-label="閉じる" style="background:none;border:none;font-size:22px;line-height:1;color:#94A3B8;cursor:pointer;">×</button>' +
      '</div>' +
      '<div style="padding:16px 26px 8px;">' +
        '<input id="idl-fsearch" type="search" placeholder="LINE の 表示名 で 探す" value="' + esc(_friendQuery) + '" style="width:100%;padding:10px 12px;border:1.5px solid #E3E7EE;border-radius:8px;font-size:13.5px;font-family:inherit;box-sizing:border-box;">' +
      '</div>' +
      '<div id="idl-frows" style="padding:0 26px 18px;">' + friendRowsHtml(client) + '</div>' +
      '<div style="padding:0 26px 22px;text-align:right;"><span id="idl-status" style="font-size:12.5px;font-weight:700;color:#6B7280;"></span></div>'
    );
    var cb2 = document.getElementById('idl-close');
    if (cb2) cb2.addEventListener('click', closeOverlay);
    bindSearch('idl-fsearch', function (v) {
      _friendQuery = v;
      var rows = document.getElementById('idl-frows');
      if (!rows) return;
      rows.innerHTML = friendRowsHtml(client);
      bindFriendButtons(client);
    });
    bindFriendButtons(client);
  }

  async function pickFriend(client, friendId, friendName, dupClient, btn) {
    var hard = dupClient && !isProvisional(dupClient);
    var msg;
    if (hard) {
      msg = 'この LINE は すでに 台帳 の「' + dupClient.name + '」様 に 登録 されて います。\n\n' +
            '「' + dupClient.name + '」様 の カード を 削除 して、\n' +
            '面談 · 議事録 · LINE の やりとり を すべて「' + client.name + '」様 に まとめます。\n\n' +
            '元 に 戻せません。 本当 に 進めます か?';
    } else if (dupClient) {
      msg = 'LINE の「' + friendName + '」さん を 台帳 の「' + client.name + '」様 に 紐付けます。\n\n' +
            'LINE から 自動 で できた 仮 の カード「' + dupClient.name + '」は なくなり、\n' +
            'やりとり は「' + client.name + '」様 に 移ります。\n\nよろしい ですか?';
    } else {
      msg = 'LINE の「' + friendName + '」さん を 台帳 の「' + client.name + '」様 に 紐付けます。\nよろしい ですか?';
    }
    if (!confirm(msg)) return;

    var _label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '処理中…'; }
    setStatus('紐付けています…', '#1B3A5C');
    try {
      await ensureCustomerDoc(client);
      if (dupClient) {
        await mergeAndCleanUp(dupClient, client);
      } else {
        var r = await callFn('linkCustomerToLineFriend', { customerId: fsId(client), lineFriendId: friendId });
        if (!r.ok) throw new Error('紐付けに失敗しました');
        client.lineFriendId = friendId;
        client.lineDisplayName = r.displayName || friendName;
        if (r.pictureUrl) { client.linePictureUrl = r.pictureUrl; client.pictureUrl = r.pictureUrl; }
        client.identityConfirmed = true;
        persistLocal();
      }
      setStatus('紐付けました', '#166534');
      setTimeout(function () { location.reload(); }, 700);
    } catch (e) {
      console.error('[identify-line] pickFriend failed', e);
      setStatus('', '');
      var extra = (e && e.code === 'functions/already-exists')
        ? '\n\n画面 を 開き直す と 「1つにまとめる」 ボタン が 出ます。' : '';
      alert('紐付けられませんでした: ' + ((e && e.message) || e) + extra);
      if (btn) { btn.disabled = false; btn.textContent = _label || 'この人です'; }
    }
  }

  window.IdentifyLine = {
    pending: pending,
    score: score,
    norm: norm,
    candidatesFor: candidatesFor,
    isProvisional: isProvisional,
    renderBar: renderBar,
    open: open,
    openForClient: openForClient,
    close: closeOverlay,
  };
})();
