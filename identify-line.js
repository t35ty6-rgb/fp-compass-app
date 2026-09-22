/* identify-line.js — 「この人は誰ですか?」 LINE 友だち と 台帳 の 名寄せ  (v20260922A)
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
  // 統合先 の 候補 = LINE 未連携 の 台帳 客
  function candidatesFor(friend) {
    var list = allClients().filter(function (c) {
      return c !== friend && !c.lineFriendId && String(c.name || '').trim();
    });
    list.forEach(function (c) { c.__idlScore = score(friend.lineDisplayName || friend.name, c); });
    list.sort(function (a, b) {
      if (b.__idlScore !== a.__idlScore) return b.__idlScore - a.__idlScore;
      return String(b.lastContact || '').localeCompare(String(a.lastContact || ''));
    });
    return list;
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
    var res = await f.httpsCallable(fns, name)(payload);
    return (res && res.data) || {};
  }
  async function writeCustomer(docId, patch) {
    var tid = tenantId();
    if (!tid || !docId) return;
    var app = await fbApp();
    var fs = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
    var db;
    try { db = fs.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }); }
    catch (_) { db = fs.getFirestore(app); }
    await fs.setDoc(fs.doc(db, 'tenants', tid, 'customers', docId), patch, { merge: true });
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

  /* ---- overlay ------------------------------------------------------- */
  var _idx = 0, _search = '';

  function closeOverlay() {
    var o = document.getElementById('idl-overlay');
    if (o && o.parentNode) o.parentNode.removeChild(o);
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e) { if (e.key === 'Escape') closeOverlay(); }

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
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onEsc);
    }
    o.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:760px;width:100%;' +
      'max-height:92vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,0.3);' +
      "font-family:'Noto Sans JP',sans-serif;\">" + innerHtml + '</div>';
    return o;
  }

  function avatarHtml(c, size) {
    var px = size || 46;
    var url = c.linePictureUrl || c.pictureUrl || '';
    var initial = String(c.name || '?').replace(/\s+/g, '').slice(0, 1);
    if (url) {
      return '<img src="' + esc(url) + '" alt="" style="width:' + px + 'px;height:' + px + 'px;border-radius:50%;object-fit:cover;display:block;border:2px solid #06c755;">';
    }
    return '<div style="width:' + px + 'px;height:' + px + 'px;border-radius:50%;background:#E2E8F0;color:#475569;' +
      'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:' + Math.round(px * 0.42) + 'px;">' + esc(initial) + '</div>';
  }

  function open(startIndex) {
    var list = pending();
    if (list.length === 0) { closeOverlay(); return; }
    _idx = Math.min(Math.max(startIndex || 0, 0), list.length - 1);
    _search = '';
    draw();
  }

  function draw() {
    var list = pending();
    if (list.length === 0) {
      shell('<div style="padding:40px 28px;text-align:center;">' +
        '<div style="font-size:34px;">✅</div>' +
        '<div style="font-size:16px;font-weight:800;color:#1B3A5C;margin-top:10px;">全員 確認 できました</div>' +
        '<button id="idl-done" style="margin-top:18px;background:#1B3A5C;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:13.5px;font-weight:800;cursor:pointer;font-family:inherit;">閉じる</button>' +
        '</div>');
      var d = document.getElementById('idl-done');
      if (d) d.addEventListener('click', closeOverlay);
      return;
    }
    if (_idx >= list.length) _idx = list.length - 1;
    var f = list[_idx];
    var friendName = f.lineDisplayName || f.name || '(名前 なし)';

    var cands = candidatesFor(f);
    var shown;
    if (_search.trim()) {
      var q = norm(_search);
      shown = cands.filter(function (c) {
        return norm(c.name).indexOf(q) >= 0 || norm(c.kana).indexOf(q) >= 0;
      }).slice(0, 12);
    } else {
      shown = cands.slice(0, 5);
    }

    var rows = shown.length === 0
      ? '<div style="padding:22px;text-align:center;color:#94A3B8;font-size:13px;">' +
          (cands.length === 0 ? 'LINE未連携のお客様が台帳にいません' : '該当するお客様がいません') + '</div>'
      : shown.map(function (c, i) {
          var sc = c.__idlScore || 0;
          var badge = sc >= 100 ? '<span style="background:#DCFCE7;color:#166534;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;">名前が一致</span>'
                    : sc >= 60 ? '<span style="background:#FEF3C7;color:#92400E;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;">名前が近い</span>'
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
          '<div style="font-size:16px;font-weight:800;color:#16202B;">' + esc(friendName)
            + '<span style="font-size:11px;color:#06c755;font-weight:800;margin-left:8px;background:#dcfce7;padding:2px 7px;border-radius:6px;">LINE</span></div>' +
          '<div style="font-size:12px;color:#6B7280;margin-top:3px;">友だち追加 ' + esc(f.lastContact || '日付なし') + ' ／ アンケート未回答</div>' +
        '</div>' +
        (pending().length > 1
          ? '<div style="font-size:12px;color:#6B7280;white-space:nowrap;">' + (_idx + 1) + ' / ' + pending().length + ' 人目</div>'
          : '') +
      '</div>' +

      '<div style="padding:16px 26px 8px;">' +
        '<input id="idl-search" type="search" placeholder="お客様を名前で探す" value="' + esc(_search) + '" ' +
          'style="width:100%;padding:10px 12px;border:1.5px solid #E3E7EE;border-radius:8px;font-size:13.5px;font-family:inherit;box-sizing:border-box;">' +
        (!_search.trim() && cands.length > 5
          ? '<div style="font-size:11.5px;color:#94A3B8;margin-top:6px;">名前が近い順に 5人 出しています。ほかの方は上の欄で探してください。</div>' : '') +
      '</div>' +

      '<div style="padding:0 26px;">' + rows + '</div>' +

      '<div style="padding:18px 26px 22px;margin-top:10px;border-top:1px solid #EEF2F6;display:flex;gap:10px;flex-wrap:wrap;">' +
        '<button id="idl-new" style="background:#fff;border:1.5px solid #1B3A5C;color:#1B3A5C;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">新しいお客様として そのまま残す</button>' +
        '<button id="idl-skip" style="background:#fff;border:1.5px solid #E3E7EE;color:#6B7280;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">あとで</button>' +
        '<div id="idl-status" style="flex:1;min-width:120px;font-size:12.5px;font-weight:700;color:#6B7280;align-self:center;text-align:right;"></div>' +
      '</div>'
    );

    var closeBtn = document.getElementById('idl-close');
    if (closeBtn) closeBtn.addEventListener('click', closeOverlay);

    var se = document.getElementById('idl-search');
    if (se) {
      se.addEventListener('input', function () {
        _search = se.value;
        var pos = se.selectionStart;
        draw();
        var s2 = document.getElementById('idl-search');
        if (s2) { s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (_) {} }
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.idl-pick'), function (b) {
      b.addEventListener('click', function () {
        var c = allClients().find(function (x) { return String(x.id) === b.dataset.cid; });
        if (c) doMerge(f, c, b);
      });
    });

    var nb = document.getElementById('idl-new');
    if (nb) nb.addEventListener('click', function () { doKeepAsNew(f, nb); });
    var sb = document.getElementById('idl-skip');
    if (sb) sb.addEventListener('click', function () {
      if (_idx + 1 < pending().length) { _idx++; _search = ''; draw(); }
      else closeOverlay();
    });
  }

  function setStatus(msg, color) {
    var el = document.getElementById('idl-status');
    if (el) { el.textContent = msg || ''; el.style.color = color || '#6B7280'; }
  }

  /* ---- 統合 ---------------------------------------------------------- */
  async function doMerge(friend, target, btn) {
    var srcId = fsId(friend), tgtId = fsId(target);
    if (!srcId || !tgtId) { alert('お客様のIDが取れませんでした'); return; }
    if (srcId === tgtId) { alert('同じお客様です'); return; }
    var fname = friend.lineDisplayName || friend.name;
    if (!confirm('LINE の「' + fname + '」さん を\n台帳 の「' + target.name + '」様 に まとめます。\n\nLINE の やりとり は ' + target.name + ' 様 の カード に 移ります。\nよろしい ですか?')) return;

    if (btn) { btn.disabled = true; btn.textContent = 'まとめ中…'; }
    setStatus('まとめています…', '#1B3A5C');
    try {
      var r = await callFn('mergeCustomerRecords', { sourceCustomerId: srcId, targetCustomerId: tgtId });
      if (!r.ok) throw new Error('統合に失敗しました');
      // ローカル 側 も 合わせる (reload 時 に 復活 しない ように)
      var arr = allClients();
      var i = arr.indexOf(friend);
      if (i >= 0) arr.splice(i, 1);
      target.lineFriendId = friend.lineFriendId || target.lineFriendId;
      target.lineDisplayName = friend.lineDisplayName || friend.name || target.lineDisplayName;
      if (friend.linePictureUrl || friend.pictureUrl) {
        target.linePictureUrl = friend.linePictureUrl || friend.pictureUrl;
        target.pictureUrl = target.linePictureUrl;
      }
      target.identityConfirmed = true;
      persistLocal();
      setStatus('まとめました', '#166534');
      setTimeout(function () { location.reload(); }, 700);
    } catch (e) {
      console.error('[identify-line] merge failed', e);
      setStatus('', '');
      alert('まとめられませんでした: ' + ((e && e.message) || e));
      if (btn) { btn.disabled = false; btn.textContent = 'この人です'; }
    }
  }

  /* ---- 新しいお客様 として 確定 ----------------------------------------- */
  async function doKeepAsNew(friend, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '登録中…'; }
    setStatus('登録しています…', '#1B3A5C');
    try {
      await writeCustomer(fsId(friend), { identityConfirmed: true });
      friend.identityConfirmed = true;
      persistLocal();
      setStatus('登録しました', '#166534');
      try { renderBar(); } catch (_) {}
      setTimeout(function () { _search = ''; draw(); }, 400);
    } catch (e) {
      console.error('[identify-line] keep-as-new failed', e);
      setStatus('', '');
      alert('登録できませんでした: ' + ((e && e.message) || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '新しいお客様として そのまま残す'; }
    }
  }

  /* ---- 逆方向: 台帳 の 客 から LINE 友だち を 選ぶ -------------------------- */
  async function openForClient(client) {
    if (!client) return;
    shell('<div style="padding:40px 28px;text-align:center;color:#6B7280;font-size:13.5px;">LINE の 友だち一覧 を 読み込んでいます…</div>');
    var friends = [];
    try {
      var r = await callFn('listLineFriends', {});
      friends = (r && r.friends) || [];
    } catch (e) {
      shell('<div style="padding:34px 28px;text-align:center;">' +
        '<div style="font-size:15px;font-weight:800;color:#991B1B;">友だち一覧 を 取れませんでした</div>' +
        '<div style="font-size:13px;color:#6B7280;margin-top:8px;">' + esc((e && e.message) || e) + '</div>' +
        '<button id="idl-close2" style="margin-top:18px;background:#1B3A5C;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:13.5px;font-weight:800;cursor:pointer;font-family:inherit;">閉じる</button></div>');
      var cb = document.getElementById('idl-close2');
      if (cb) cb.addEventListener('click', closeOverlay);
      return;
    }
    // すでに 別 の 客 に 紐付いて いる friend は 除外 しない (統合 の 対象 に なる)
    var taken = {};
    allClients().forEach(function (c) { if (c.lineFriendId && c !== client) taken[c.lineFriendId] = c; });
    friends.forEach(function (fr) { fr.__score = score(fr.displayName, client); });
    friends.sort(function (a, b) { return b.__score - a.__score; });

    var q = '';
    function drawList() {
      var shown = q.trim()
        ? friends.filter(function (fr) { return norm(fr.displayName).indexOf(norm(q)) >= 0; }).slice(0, 20)
        : friends.slice(0, 12);
      var rows = shown.length === 0
        ? '<div style="padding:22px;text-align:center;color:#94A3B8;font-size:13px;">該当する友だちがいません</div>'
        : shown.map(function (fr) {
            var dup = taken[fr.id];
            return '<div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-top:1px solid #EEF2F6;">' +
              (fr.pictureUrl
                ? '<img src="' + esc(fr.pictureUrl) + '" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid #06c755;">'
                : '<div style="width:38px;height:38px;border-radius:50%;background:#E2E8F0;"></div>') +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:14px;font-weight:700;color:#16202B;">' + esc(fr.displayName) + '</div>' +
                (dup ? '<div style="font-size:11.5px;color:#92400E;margin-top:2px;">いまは「' + esc(dup.name) + '」様として登録されています</div>' : '') +
              '</div>' +
              '<button class="idl-fpick" data-fid="' + esc(fr.id) + '" data-fname="' + esc(fr.displayName) + '" style="background:#06c755;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;">この人です</button>' +
            '</div>';
          }).join('');

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
          '<input id="idl-fsearch" type="search" placeholder="LINE の 表示名 で 探す" value="' + esc(q) + '" style="width:100%;padding:10px 12px;border:1.5px solid #E3E7EE;border-radius:8px;font-size:13.5px;font-family:inherit;box-sizing:border-box;">' +
        '</div>' +
        '<div style="padding:0 26px 18px;">' + rows + '</div>' +
        '<div style="padding:0 26px 22px;text-align:right;"><span id="idl-status" style="font-size:12.5px;font-weight:700;color:#6B7280;"></span></div>'
      );
      var cb2 = document.getElementById('idl-close');
      if (cb2) cb2.addEventListener('click', closeOverlay);
      var se2 = document.getElementById('idl-fsearch');
      if (se2) se2.addEventListener('input', function () {
        q = se2.value; var pos = se2.selectionStart; drawList();
        var s3 = document.getElementById('idl-fsearch');
        if (s3) { s3.focus(); try { s3.setSelectionRange(pos, pos); } catch (_) {} }
      });
      Array.prototype.forEach.call(document.querySelectorAll('.idl-fpick'), function (b) {
        b.addEventListener('click', function () { pickFriend(client, b.dataset.fid, b.dataset.fname, taken[b.dataset.fid], b); });
      });
    }
    drawList();
  }

  async function pickFriend(client, friendId, friendName, dupClient, btn) {
    if (!confirm((dupClient
        ? 'LINE の「' + friendName + '」さん (いまは「' + dupClient.name + '」様) を\n'
        : 'LINE の「' + friendName + '」さん を\n')
      + '台帳 の「' + client.name + '」様 に 紐付けます。\nよろしい ですか?')) return;
    if (btn) { btn.disabled = true; btn.textContent = '処理中…'; }
    setStatus('紐付けています…', '#1B3A5C');
    try {
      if (dupClient) {
        await doMergeSilent(dupClient, client);
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
      alert('紐付けられませんでした: ' + ((e && e.message) || e));
      if (btn) { btn.disabled = false; btn.textContent = 'この人です'; }
    }
  }

  async function doMergeSilent(source, target) {
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
  }

  window.IdentifyLine = {
    pending: pending,
    score: score,
    norm: norm,
    candidatesFor: candidatesFor,
    renderBar: renderBar,
    open: open,
    openForClient: openForClient,
    close: closeOverlay,
  };
})();
