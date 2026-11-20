// ============================================================
// FP Compass — ライフイベント の 自動 作成 (画面 側)  2026-11-20
//   owner 「子供 とか 退職 とか、 年齢 を 聞いたら 逆算 して 自動 で 作成 する 感じ」
//
//   面談 の 記録 を サーバー (syncLifeFacts) が 読み、 聞いた 年齢・学年・予定 から
//   生まれ年 や 進学・退職 の 年 を 逆算 して 顧客 の 情報 に 書き込む。
//   この ファイル は ① それ を 呼ぶ ② 返って きた 結果 を 画面 の 顧客 データ に 反映 する
//   ③ 「何 を 聞いて、 どう 計算 した か」 を カード で 見せる、 の 3 つ を 受け持つ。
//
//   呼ぶ タイミング:
//     - 顧客 カード を 開いた とき (その 人 の、 まだ 読んで いない 議事録 だけ)
//     - ライフイベント の 画面 を 開いた とき (全員 分。 一度 に 読み すぎない よう 小分け)
//     - 対面 録音 の 議事録 を 保存 した 直後
//     (Zoom は サーバー 側 が 議事録 の 保存 と 同時 に 済ませる)
// ============================================================
(function () {
  'use strict';

  var THROTTLE_MS = 60 * 1000;          // 同じ 顧客 を 続けて 開いて も 1 分 は 呼び 直さない
  var ALL_THROTTLE_MS = 5 * 60 * 1000;  // 全員 分 は 5 分
  var AUTO_ROUNDS = 3;                  // 画面 を 開いた だけ で 読む の は 最大 3 回 (= 12 件) まで
  var MANUAL_ROUNDS = 10;               // 「続き を 読む」 を 押した とき

  var st = {
    cur: null,          // { c, refresh } いま 開いて いる 顧客 カード
    per: {},            // fsId → { at, busy, err, budget }
    open: {},           // fsId → 年表 を 最後 まで 開いて いる
    src: {},            // fsId → 「読み取った 内容」 を 開いて いる
    all: { busy: false, at: 0, read: 0, added: 0, remaining: 0, err: '', budget: '', rerender: null, dismissed: false },
  };

  // ---------- 小物 ----------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // アイコン は 自前 の SVG (顧客 カード の タブ は 押した とき に 中身 を 作る ため、 後 から 絵 を 差し込む 方式 だと 出ない こと が ある)
  var ICONS = {
    'calendar-clock': '<path d="M16 14v2.2l1.6 1"/><path d="M16 2v4"/><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M3 10h5"/><path d="M8 2v4"/><circle cx="16" cy="16" r="6"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  };
  function icon(name) {
    return '<svg class="lf-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function paintIcons() {}
  function ready() { return !!(window.__fp && window.__fp.functions && window.__fp.httpsCallable && window.__fp.tenantId); }
  // デモ 用 の 顧客 (ブラウザ の 中 だけ に ある) では サーバー を 呼ばない
  function isLive() { return ready() && String(window.DUMMY_CLIENTS_VERSION || '').indexOf('firestore-') === 0; }
  function fsId(c) {
    if (!c) return '';
    var id = c._fsCustomerId || c.docId || c.id || '';
    id = String(id);
    if (id.indexOf('fs-') === 0) id = id.slice(3);
    return /^[A-Za-z0-9_-]{6,128}$/.test(id) ? id : '';
  }
  function findClient(id) {
    var list = window.DUMMY_CLIENTS || [];
    for (var i = 0; i < list.length; i++) if (fsId(list[i]) === id) return list[i];
    return null;
  }
  function invalidate(c) { try { if (window.LifeEvents && window.LifeEvents.invalidate) window.LifeEvents.invalidate(c); } catch (_) {} }
  function parseBirth(b) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(b || ''));
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function dayLabel(day) {   // '2026-11-20' → '11/20'
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
    return m ? (+m[2]) + '/' + (+m[3]) : '';
  }
  function dateLabel(d) {    // '2029-11' → '2029年11月' / '2030' → '2030年ごろ'
    var m = /^(\d{4})(?:-(\d{2}))?/.exec(String(d || ''));
    if (!m) return '';
    return m[2] ? m[1] + '年' + (+m[2]) + '月' : m[1] + '年ごろ';
  }

  // 差し替え 可能 な 出入口 (テスト で 入れ替える)
  var io = {
    call: function (name, data) {
      if (!ready()) return Promise.reject(new Error('not-ready'));
      return window.__fp.httpsCallable(window.__fp.functions, name)(data || {}).then(function (r) { return (r && r.data) || {}; });
    },
    // 顧客 の 情報 を 一部 だけ 書き換える (FP は 自分 の テナント の 顧客 を 書ける)
    persist: function (c, patch) {
      var id = fsId(c);
      if (!id || !isLive()) return Promise.resolve(false);   // デモ は 画面 の 中 だけ
      return import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js').then(function (m) {
        return m.updateDoc(m.doc(window.__fp.db, 'tenants', window.__fp.tenantId, 'customers', id), patch);
      }).then(function () { return true; });
    },
  };

  // ---------- お知らせ (画面 下 の 小さな 帯) ----------
  var toastTimer = null;
  function toast(msg, actionLabel, onAction, isError) {
    var old = document.getElementById('lf-toast');
    if (old) old.remove();
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    var el = document.createElement('div');
    el.id = 'lf-toast';
    el.className = 'lf-toast' + (isError ? ' is-error' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="lf-toast-msg">' + esc(msg) + '</span>' +
      (actionLabel ? '<button type="button" class="lf-toast-btn">' + esc(actionLabel) + '</button>' : '');
    document.body.appendChild(el);
    var b = el.querySelector('.lf-toast-btn');
    if (b && onAction) b.addEventListener('click', function () { el.remove(); onAction(); });
    toastTimer = setTimeout(function () { el.remove(); }, isError ? 7000 : 6000);
  }

  // ---------- サーバー の 結果 を 画面 の 顧客 データ に 反映 ----------
  function applyView(c, v) {
    if (!c || !v) return false;
    var before = JSON.stringify([c.birth || '', !!c.birthApprox, c.retireAge, c.family || [], c.customEvents || []]);
    var birth = v.birth === '1985-01-01' ? '' : (v.birth || '');   // 旧 初期値 は 空 と 同じ
    if (birth) c.birth = birth;
    c.birthApprox = !!v.birthApprox;
    c.birthSource = v.birthSource || null;
    c.retireAge = (v.retireAge === undefined) ? null : v.retireAge;
    c.retireAgeAuto = !!v.retireAgeAuto;
    c.retireAgeSource = v.retireAgeSource || null;
    c.family = Array.isArray(v.family) ? v.family : [];
    c.customEvents = Array.isArray(v.customEvents) ? v.customEvents : [];
    c.aiLifeLog = v.aiLifeLog || null;
    c.lifeUpdatedAt = v.lifeUpdatedAt || '';
    var after = JSON.stringify([c.birth || '', !!c.birthApprox, c.retireAge, c.family || [], c.customEvents || []]);
    if (before === after) return false;
    invalidate(c);
    return true;
  }
  function modalOpenFor(c) {
    return !!(st.cur && st.cur.c === c && document.querySelector('.cd-tabpanels'));
  }
  function timelineViewActive() { return !!document.querySelector('.view[data-view="timeline"].active'); }
  // 表示 を 作り直す。 入力 の 途中 なら 終わる まで 待つ。
  function refreshViews(c) {
    if (modalOpenFor(c) && typeof st.cur.refresh === 'function') {
      var ae = document.activeElement;
      var panel = document.querySelector('.cd-tabpanel[data-cdpanel="timeline"]');
      if (ae && panel && panel.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) {
        var cur = st.cur;
        ae.addEventListener('blur', function () { setTimeout(function () { if (st.cur === cur) { try { cur.refresh(); } catch (_) {} paintIcons(); } }, 0); }, { once: true });
      } else {
        try { st.cur.refresh(); } catch (e) { console.warn('[lifesync] refresh fail:', e); }
        paintIcons();
      }
    }
    if (timelineViewActive() && typeof st.all.rerender === 'function') {
      try { st.all.rerender(); } catch (e) { console.warn('[lifesync] timeline rerender fail:', e); }
    }
  }

  // ---------- 1 人 分 ----------
  function perState(id) { return st.per[id] || (st.per[id] = { at: 0, busy: null, err: '', budget: '' }); }
  function syncCustomer(c, opts) {
    var o = opts || {};
    var id = fsId(c);
    if (!id || !isLive()) return Promise.resolve(null);
    var p = perState(id);
    if (p.busy) return p.busy;
    if (!o.force && Date.now() - p.at < THROTTLE_MS) return Promise.resolve(null);
    var rounds = 0, added = [], readTotal = 0;
    function round() {
      rounds++;
      return io.call('syncLifeFacts', { customerId: id, max: 4 }).then(function (r) {
        r = r || {};
        readTotal += Number(r.processed || 0);
        var mine = (r.changes || []).filter(function (x) { return x && x.customerId === id; });
        mine.forEach(function (ch) { (ch.added || []).forEach(function (a) { added.push(a); }); });
        var view = r.customer || (mine.length ? mine[mine.length - 1].customer : null);
        // 変更 が あった とき と、 別 の 場所 (Zoom の 自動 処理 / 他 の 端末) で 増えて いた とき だけ 取り込む
        var fresh = view && (mine.length || (view.lifeUpdatedAt && view.lifeUpdatedAt !== (c.lifeUpdatedAt || '')));
        if (fresh && applyView(c, view)) refreshViews(c);
        p.budget = (r.budget && r.budget.ok === false) ? String(r.budget.ja || 'AI の 上限 に 達して います') : '';
        if (Number(r.remaining || 0) > 0 && !p.budget && rounds < 4 && Number(r.processed || 0) > 0) return round();
        return r;
      });
    }
    p.err = '';
    p.busy = round().then(function (r) {
      p.busy = null; p.at = Date.now();
      paintStatus(c);
      if (added.length && !o.quiet) {
        // その 人 の カード を 開いて いる とき は 名前 を 付けない (スマホ で 2 行 に 折れる の を 防ぐ)
        var who = modalOpenFor(c) ? '' : '（' + String(c.name || 'お客様').slice(0, 10) + '様）';
        toast('議事録から ' + added.length + '件 を自動で入れました' + who, '見る', function () { showLifeTab(c); });
      }
      return { read: readTotal, added: added, result: r };
    }, function (e) {
      p.busy = null; p.at = Date.now();
      p.err = String((e && e.message) || e || '');
      console.warn('[lifesync] syncCustomer fail:', p.err);
      paintStatus(c);
      return null;
    });
    paintStatus(c);
    return p.busy;
  }
  function showLifeTab(c) {
    if (modalOpenFor(c)) {
      var b = document.querySelector('.cd-tab[data-cdtab="timeline"]');
      if (b) b.click();
      return;
    }
    var id = fsId(c);
    if (id && typeof window.__fpOpenClientByFsId === 'function') window.__fpOpenClientByFsId(id, 'timeline');
  }
  // 顧客 カード を 開いた とき に app.js から 呼ばれる
  function onOpenClient(c, refresh) {
    st.cur = { c: c, refresh: refresh };
    return syncCustomer(c);
  }
  // 対面 録音 の 議事録 を 保存 した 直後 (line-app.js)。 保存 が Firestore に 届く まで 少し 待つ。
  function afterMeetingSaved(info) {
    var i = info || {};
    var list = window.DUMMY_CLIENTS || [];
    var c = i.customerId ? findClient(String(i.customerId).replace(/^fs-/, '')) : null;
    for (var k = 0; !c && k < list.length; k++) {
      var x = list[k];
      if ((i.userId && x.lineFriendId && x.lineFriendId === i.userId) || (i.name && x.name && x.name === i.name)) { c = x; break; }
    }
    if (!c) return;
    var tries = 0;
    (function attempt(delay) {
      setTimeout(function () {
        tries++;
        var p = syncCustomer(c, { force: true });
        if (!p) return;
        p.then(function (r) { if (r && r.read === 0 && tries < 2) attempt(15000); });
      }, delay);
    })(4000);
  }

  // ---------- 全員 分 (ライフイベント の 画面) ----------
  function runAll(manual) {
    var a = st.all;
    if (a.busy || !isLive()) return;
    a.busy = true; a.err = ''; a.budget = ''; a.dismissed = false;
    if (manual) { a.read = 0; a.added = 0; }
    paintBar();
    var rounds = 0, limit = manual ? MANUAL_ROUNDS : AUTO_ROUNDS;
    function round() {
      rounds++;
      return io.call('syncLifeFacts', { max: 4 }).then(function (r) {
        r = r || {};
        a.read += Number(r.processed || 0);
        a.remaining = Number(r.remaining || 0);
        var touched = false;
        (r.changes || []).forEach(function (ch) {
          if (!ch) return;
          a.added += (ch.added || []).length;
          var c = findClient(ch.customerId);
          if (c && applyView(c, ch.customer)) { touched = true; if (modalOpenFor(c)) refreshViews(c); }
        });
        if (r.budget && r.budget.ok === false) a.budget = String(r.budget.ja || 'AI の 上限 に 達して います');
        if (touched && timelineViewActive() && typeof a.rerender === 'function') { try { a.rerender(); } catch (_) {} }
        paintBar();
        if (a.remaining > 0 && !a.budget && rounds < limit && Number(r.processed || 0) > 0) return round();
      });
    }
    round().then(function () { a.busy = false; a.at = Date.now(); paintBar(); },
      function (e) { a.busy = false; a.at = Date.now(); a.err = String((e && e.message) || e || ''); console.warn('[lifesync] runAll fail:', a.err); paintBar(); });
  }
  function onOpenTimeline(rerender) {
    st.all.rerender = rerender;
    paintBar();
    if (st.all.busy || !isLive()) return;
    if (Date.now() - st.all.at < ALL_THROTTLE_MS) return;
    runAll(false);
  }
  function barHtml() {
    var a = st.all;
    if (a.busy) {
      return '<div class="lf-bar is-busy" role="status"><span class="lf-spin" aria-hidden="true"></span>' +
        '<span class="lf-bar-text">議事録を読んで、聞いた年齢や予定からライフイベントを作っています' +
        (a.read ? '<span class="lf-bar-num">（' + a.read + '件 読みました）</span>' : '…') + '</span></div>';
    }
    if (a.budget) {
      return '<div class="lf-bar is-warn" role="status">' + icon('circle-alert') + '<span class="lf-bar-text">' + esc(a.budget) + '</span></div>';
    }
    if (a.err) {
      return '<div class="lf-bar is-warn" role="status">' + icon('circle-alert') + '<span class="lf-bar-text">議事録を確認できませんでした</span>' +
        '<button type="button" class="lf-bar-btn" data-lf-act="all-more">もう一度</button></div>';
    }
    if (a.remaining > 0) {
      return '<div class="lf-bar" role="status">' + icon('file-text') + '<span class="lf-bar-text">' +
        (a.added ? '議事録から ' + a.added + '件 を自動で入れました。' : '') +
        'まだ読んでいない議事録が <b>' + a.remaining + '件</b> あります</span>' +
        '<button type="button" class="lf-bar-btn" data-lf-act="all-more">続きを読む</button></div>';
    }
    if (a.added > 0 && !a.dismissed) {
      return '<div class="lf-bar is-ok" role="status">' + icon('check') + '<span class="lf-bar-text">議事録から ' + a.added + '件 を自動で入れました' +
        '<span class="lf-bar-num">（年齢から逆算した生まれ年・退職の年・聞いた予定）</span></span>' +
        '<button type="button" class="lf-bar-x" data-lf-act="all-dismiss" aria-label="お知らせを閉じる" title="閉じる">' + icon('x') + '</button></div>';
    }
    return '';
  }
  function paintBar() {
    var el = document.getElementById('lf-bar');
    if (!el) return;
    el.innerHTML = barHtml();
    paintIcons();
  }

  // ---------- 顧客 カード の 「ライフ」 タブ に 出す カード ----------
  function memberLabel(m) {
    var rel = (window.LifeEvents && window.LifeEvents.relLabel && window.LifeEvents.relLabel(m.rel)) || 'ご家族';
    return m.name ? rel + '（' + m.name + '）' : rel;
  }
  function nextSchool(m) {
    var LE = window.LifeEvents;
    if (!LE || !LE.isChildRel || !LE.isChildRel(m.rel)) return '';
    var entry = LE.elemEntryYear(m.birth);
    if (!entry) return '';
    var t = LE.TODAY || new Date();
    var steps = [[0, '小学校入学'], [6, '中学校入学'], [9, '高校入学'], [12, '大学入学']];
    for (var i = 0; i < steps.length; i++) {
      var d = new Date(entry + steps[i][0], 3, 1);
      if (d >= t) return '次は ' + (entry + steps[i][0]) + '年4月 ' + steps[i][1].replace('入学', 'に入学');
    }
    return '';
  }
  function quote(evidence, day) {
    var e = String(evidence || '').trim();
    var d = dayLabel(day);
    if (!e && !d) return '';
    return (e ? '「' + e + '」' : '') + (d ? (e ? ' ' : '') + d + ' の面談' : '');
  }
  // 自動 で 入れた もの の 一覧 (何 を 聞いて → どう 計算 した か)
  function factRows(c) {
    var rows = [];
    var sb = parseBirth(c.birth);
    if (sb && c.birthApprox && c.birthSource && c.birthSource.birth === c.birth) {
      rows.push({ k: 'ご本人', heard: (c.birthSource.age !== undefined && c.birthSource.age !== null) ? c.birthSource.age + '歳' : '',
        result: sb.y + '年ごろ生まれ', sub: '', q: quote(c.birthSource.evidence, c.birthSource.aiMeetingDay) });
    }
    (c.family || []).forEach(function (m) {
      if (!m) return;
      var b = parseBirth(m.birth);
      if (b && (m.addedByAI || m.birthApprox)) {
        var heard = m.aiGrade ? m.aiGrade : ((m.aiAge !== undefined && m.aiAge !== null) ? m.aiAge + '歳' : '');
        // 学年 から の 逆算 は 「年度」 まで 確か (4/2 〜 翌 4/1 生まれ)。 年齢 から の 逆算 は 「ごろ」。
        var sy = (b.m < 4 || (b.m === 4 && b.d === 1)) ? b.y - 1 : b.y;
        rows.push({ k: memberLabel(m), heard: heard, result: m.aiGrade ? sy + '年度生まれ' : b.y + '年ごろ生まれ', sub: nextSchool(m), q: quote(m.aiEvidence, m.aiMeetingDay) });
      }
      if (m.rel === 'spouse' && m.retireAgeAuto && m.retireAge) {
        rows.push({ k: '配偶者の退職', heard: m.retireAge + '歳', result: b ? (b.y + Number(m.retireAge)) + '年' : '', sub: '', q: quote(m.retireEvidence, m.aiMeetingDay) });
      }
    });
    return rows;
  }
  function autoEvents(c) {
    return (c.customEvents || []).filter(function (e) { return e && e.auto && e.id; })
      .slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  }
  function statusText(c) {
    var p = st.per[fsId(c)];
    if (!p) return '';
    if (p.busy) return '議事録を確認中…';
    if (p.budget) return p.budget;
    if (p.err) return '議事録を確認できませんでした';
    return '';
  }
  function paintStatus(c) {
    var el = document.querySelector('[data-lf-status="' + (fsId(c) || 'x') + '"]');
    if (!el) return;
    var p = st.per[fsId(c)] || {};
    el.textContent = statusText(c);
    el.classList.toggle('is-busy', !!p.busy);
    el.classList.toggle('is-warn', !p.busy && !!(p.err || p.budget));
  }
  // ---------- ご家族 と 年齢 (「ライフ」 タブ の いちばん 上) ----------
  //   前 から ある 「家族構成 & 年齢」 は 絵文字 と 色 の ついた 帯 で、 下 の 「これから の 見通し」 と 見た目 が そろって いなかった。
  //   同じ 白い 箱・同じ 文字 の 大きさ に そろえる。 出す 人 は 前 と 同じ (ご本人・配偶者・お子様)。
  function ageNow(birth) {
    var b = parseBirth(birth);
    if (!b) return null;
    var t = (window.LifeEvents && window.LifeEvents.TODAY) || new Date();
    var a = t.getFullYear() - b.y;
    if (t.getMonth() + 1 < b.m || (t.getMonth() + 1 === b.m && t.getDate() < b.d)) a--;
    return a >= 0 ? a : null;
  }
  function personHtml(kind, role, name, birth, note, tagged, next) {
    var age = ageNow(birth);
    var bits = [];
    if (age !== null) bits.push(age + '歳');
    if (note) bits.push(String(note).slice(0, 20));
    var shown = name || role;
    return '<li class="lf-p lf-p-' + kind + '">' +
      '<span class="lf-p-av" aria-hidden="true">' + esc(String(shown).replace(/\s+/g, '').slice(0, 1)) + '</span>' +
      '<div class="lf-p-body">' +
        '<div class="lf-p-top"><b class="lf-p-nm">' + esc(shown) + '</b>' + (name ? '<span class="lf-p-role">' + esc(role) + '</span>' : '') + '</div>' +
        '<div class="lf-p-info">' + (bits.length ? esc(bits.join(' ・ ')) : '<span class="lf-muted">年齢は未登録</span>') + (tagged ? ' <span class="lf-tag lf-tag-inline">議事録から</span>' : '') + '</div>' +
        (next ? '<div class="lf-p-next">' + esc(next) + '</div>' : '') +
      '</div></li>';
  }
  function familyHtml(c) {
    if (!c) return '';
    var LE = window.LifeEvents || {};
    var fam = (c.family || []).filter(Boolean);
    var selfTagged = !!(c.birthApprox && c.birthSource && c.birthSource.birth === c.birth);
    var items = [personHtml('self', 'ご本人', c.name || 'お客様', c.birth, c.occupation, selfTagged, '')];
    fam.forEach(function (m) { if (m.rel === 'spouse') items.push(personHtml('spouse', '配偶者', m.name, m.birth, m.note, !!(m.addedByAI || m.birthApprox), '')); });
    fam.forEach(function (m) {
      if (LE.isChildRel && LE.isChildRel(m.rel)) items.push(personHtml('child', (LE.relLabel && LE.relLabel(m.rel)) || 'お子様', m.name, m.birth, m.note, !!(m.addedByAI || m.birthApprox), nextSchool(m)));
    });
    var only = items.length === 1;
    return '<section class="lf-box lf-ppl">' +
      '<header class="lf-head"><h4 class="lf-h"><span>ご家族と年齢</span></h4>' +
        '<button type="button" class="lf-link cd-tab-jump" data-jump-tab="family">' + (only ? '家族を登録する' : '家族を編集する') + '</button></header>' +
      '<ul class="lf-ppl-list">' + items.join('') + '</ul>' +
      (only ? '<p class="lf-foot">配偶者やお子様を登録すると、進学や退職の時期が下の見通しに出ます。面談で年齢を聞けば自動でも入ります。</p>' : '') +
      '</section>';
  }

  // ---------- これから の 見通し (5 年 ごと に まとめる) ----------
  //   owner が 5 案 から 選んだ 「案 E 時期 で まとめる」。 1 つ の 箱 = 1 つ の 時期。
  //   左 に 「いつ・本人 が 何 歳 の ころ・ひとこと」、 右 に その 時期 の できごと を 年 の 順 に 並べる。
  var CAT_COLOR = { education: '#6D28D9', retirement: '#047857', health: '#B42318', family: '#B45309', finance: '#1D4ED8', inherit: '#334155', business: '#0E7490' };
  // ひとこと の 札 の 地 の 色 (文字 色 ごと)。 どれ も 文字 と の 明暗 差 4.5:1 以上。
  var HL_BG = { '#6D28D9': '#F3EFFE', '#047857': '#E8F7F0', '#B42318': '#FDECEA', '#B45309': '#FDF1E3', '#1D4ED8': '#E9F0FE', '#334155': '#EEF2F6', '#0E7490': '#E6F5F8', '#78350F': '#FBE7A6' };
  var LAST_BAND_ROWS = 6;      // 「その 先」 は 長く なる ので、 これ を 超えた 分 は 畳む (大事 な 節目 は 畳まない)
  var SCHOOL_TEXT = { '小学校入学': '小学校に入学', '中学校入学': '中学校に入学', '高校入学': '高校に入学', '大学入学 (教育費ピーク)': '大学に入学', '就職': '就職' };
  function planEvents(c) {
    var evs = (window.LifeEvents && window.LifeEvents.generate) ? (window.LifeEvents.generate(c) || []) : [];
    return evs.filter(function (e) { return e && !e.kind && e.date instanceof Date && !isNaN(e.date.getTime()); });
  }
  function hasPlan(c) { return !!c && planEvents(c).length > 0; }
  // 「2028年4月」 「2028年ごろ」 「2053年」。 年齢 から 逆算 した もの は 「ごろ」 を 付ける。
  function whenText(ev) {
    var y = ev.date.getFullYear();
    var t = ev.month ? y + '年' + (ev.date.getMonth() + 1) + '月' : y + '年';
    return ev.approx ? t + 'ごろ' : t;
  }
  // 「長男が小学校に入学」 「退職の予定」 など、 読んで すぐ 分かる 言い方 に する
  function whatText(c, ev) {
    var label = String(ev.label || '').replace(/^🎙\s*/, '').replace(/\s*\(\d+歳\)$/, '');
    if (ev.subject === 'child') return SCHOOL_TEXT[label] ? ev.who + 'が' + SCHOOL_TEXT[label] : ev.who + ' ' + label;
    if (ev.subject === 'spouse' || ev.subject === 'self') return label;
    return (ev.who && ev.who !== c.name && label.indexOf(ev.who) !== 0) ? ev.who + 'の' + label : label;
  }
  function ageText(ev) {
    if (ev.by === undefined || ev.by === null) return '';
    var a = ev.date.getFullYear() - ev.by;
    if (!(a >= 0)) return '';
    return (ev.subject === 'self' ? 'ご本人 ' : '') + a + '歳';
  }
  function lineHtml(c, ev, hidden) {
    var removable = ev.src === 'minutes' && ev.customId;
    var age = ageText(ev);
    return '<div class="lf-ln' + (removable ? ' lf-ln-x' : '') + '"' + (hidden ? ' hidden' : '') + '>' +
      '<span class="lf-ln-d">' + esc(whenText(ev)) + '</span>' +
      '<span class="lf-ln-t"><b>' + esc(whatText(c, ev)) + '</b>' + (age ? '（' + esc(age) + '）' : '') + '</span>' +
      (removable ? '<button type="button" class="lf-x" data-lf-act="remove-event" data-id="' + esc(ev.customId) + '" aria-label="この予定を取り消す" title="取り消す">' + icon('x') + '</button>' : '') +
      '</div>';
  }
  // 時期 の ひとこと。 その 時期 に 何 が 重なる か を、 できごと の 種類 から 決める。
  function headline(evs, isPeak, beforePeak) {
    var has = function (re) { return evs.some(function (e) { return re.test(String(e.label || '')); }); };
    // 入学 は 前 の 時期 で、 この 時期 は 通って いる 最中、 という こと が ある (その とき は 理由 を 添える)
    if (isPeak) return { text: has(/大学入学/) ? '教育費のピーク' : '教育費のピーク（大学に在学中）', color: '#78350F' };
    var cat = function (k) { return evs.some(function (e) { return e.cat === k; }); };
    if (beforePeak && has(/高校入学|大学入学/)) return { text: '教育費が増えはじめる', color: CAT_COLOR.education };
    var parts = [];
    if (has(/住宅|マイホーム|家を|家の|建て替え|新築|マンション|リフォーム/)) parts.push({ t: '住まい', c: CAT_COLOR.finance });
    if (has(/入学/)) parts.push({ t: '進学', c: CAT_COLOR.education });
    if (cat('retirement')) parts.push({ t: '退職・年金', c: CAT_COLOR.retirement });
    if (has(/就職|結婚/)) parts.push({ t: '独立', c: CAT_COLOR.family });
    if (cat('business')) parts.push({ t: '事業', c: CAT_COLOR.business });
    if (cat('inherit')) parts.push({ t: '相続', c: CAT_COLOR.inherit });
    if (cat('health')) parts.push({ t: '医療・介護', c: CAT_COLOR.health });
    if (!parts.length && cat('finance')) parts.push({ t: '大きな支出', c: CAT_COLOR.finance });
    if (!parts.length) return evs.length ? { text: '予定がある時期', color: '#334155' } : { text: '', color: '#334155' };
    var two = parts.slice(0, 2);
    return { text: two.map(function (p) { return p.t; }).join('と') + (two.length > 1 ? 'が重なる' : 'の時期'), color: two[0].c };
  }
  // 大学 に 通って いる 子 が のべ 何 年 分 いる か (教育費 の 山 を 探す ため)
  function uniYears(evs, y0, y1) {
    var n = 0;
    evs.forEach(function (e) {
      if (e.subject !== 'child' || !/大学入学/.test(String(e.label || ''))) return;
      var s = e.date.getFullYear();
      for (var y = s; y < s + 4; y++) if (y >= y0 && y <= y1) n++;
    });
    return n;
  }
  function bandsHtml(c, id) {
    var evs = planEvents(c);
    var thisY = ((window.LifeEvents && window.LifeEvents.TODAY) || new Date()).getFullYear();
    var sb = parseBirth(c.birth);
    var defs = [
      { t: 'これから5年', y0: thisY, y1: thisY + 5 },
      { t: '6〜10年後', y0: thisY + 6, y1: thisY + 10 },
      { t: '11〜15年後', y0: thisY + 11, y1: thisY + 15 },
      { t: 'その先', y0: thisY + 16, y1: 9999 },
    ];
    defs.forEach(function (d) {
      d.evs = evs.filter(function (e) { var y = e.date.getFullYear(); return y >= d.y0 && y <= d.y1; }).sort(function (a, b) { return a.date - b.date; });
      d.uni = uniYears(evs, d.y0, d.y1);
    });
    var peak = -1, best = 0;
    defs.forEach(function (d, i) { if (d.uni > best) { best = d.uni; peak = i; } });
    var open = !!st.open[id];
    var out = defs.map(function (d, i) {
      if (!d.evs.length && i > 0) return '';        // 予定 の 無い 時期 は 出さない (「これから 5 年」 だけ は 必ず 出す)
      var last = d.y1 === 9999;
      var range = last ? d.y0 + '年〜' : d.y0 + '〜' + d.y1 + '年';
      var ages = sb ? ' ・ ご本人 ' + (d.y0 - sb.y) + (last ? '歳〜' : '〜' + (d.y1 - sb.y) + '歳') : '';
      var hl = headline(d.evs, i === peak, peak >= 0 && i < peak);
      // 「その 先」 が 長い とき: 大事 な 節目 と 近い もの を 残して 畳む
      var hide = [];
      if (last && d.evs.length > LAST_BAND_ROWS + 1) {
        var keep = d.evs.filter(function (e) { return e.major; });
        d.evs.forEach(function (e) { if (keep.length < LAST_BAND_ROWS && keep.indexOf(e) < 0) keep.push(e); });
        hide = d.evs.filter(function (e) { return keep.indexOf(e) < 0; });
      }
      var lines = d.evs.length
        ? d.evs.map(function (e) { return lineHtml(c, e, !open && hide.indexOf(e) >= 0); }).join('')
        : '<div class="lf-ln lf-ln-none">いまのところ、大きな予定はありません</div>';
      var more = hide.length
        ? '<button type="button" class="lf-more" data-lf-act="more" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '大事な節目だけに戻す' : 'ほか ' + hide.length + '件も見る') + '</button>'
        : '';
      return '<section class="lf-band' + (i === peak ? ' is-peak' : '') + '">' +
        '<div class="lf-band-l">' +
          '<h5 class="lf-band-t">' + esc(d.t) + '</h5>' +
          '<p class="lf-band-rg">' + esc(range + ages) + '</p>' +
          (hl.text ? '<p class="lf-band-hl" style="color:' + hl.color + ';background:' + (HL_BG[hl.color] || '#F1F5F9') + '">' + esc(hl.text) + '</p>' : '') +
        '</div>' +
        '<div class="lf-band-r">' + lines + more + '</div>' +
        '</section>';
    }).join('');
    return '<div class="lf-bands">' + out + '</div>';
  }
  function cardHtml(c) {
    if (!c) return '';
    var id = fsId(c);
    var rows = factRows(c);
    var evs = autoEvents(c);
    var p = st.per[id] || {};
    var sb = parseBirth(c.birth);
    var ra = (c.retireAge === null || c.retireAge === undefined || c.retireAge === '') ? '' : Number(c.retireAge);
    var raOk = ra !== '' && isFinite(ra);
    var plan = hasPlan(c);
    var retireResult = raOk ? (sb ? '<b>' + (sb.y + ra) + '年</b>' : '<span class="lf-muted">生年月日が入ると年が出ます</span>') : '<span class="lf-muted">聞いたら入れてください（45〜85）</span>';
    var rq = (raOk && c.retireAgeAuto && c.retireAgeSource) ? quote(c.retireAgeSource.evidence, c.retireAgeSource.aiMeetingDay) : '';

    var retireHtml = '<div class="lf-retire-row">' +
      '<span class="lf-k">退職の予定</span>' +
      '<label class="lf-retire"><input type="number" inputmode="numeric" min="45" max="85" step="1" class="lf-retire-input" data-lf-retire="' + esc(id) + '"' +
        ' value="' + (raOk ? esc(ra) : '') + '" placeholder="—" aria-label="退職の予定の年齢"><span>歳</span></label>' +
      '<span class="lf-arrow" aria-hidden="true">→</span>' + retireResult +
      '<span class="lf-err" data-lf-retire-err hidden>45〜85 の数字で入れてください</span>' +
      '</div>';

    // 議事録 の どこ から 読み取った か (畳んで おく)
    var srcRows = rows.map(function (r) {
      return '<div class="lf-row"><div class="lf-k">' + esc(r.k) + '</div><div class="lf-v">' +
        '<div class="lf-main">' + (r.heard ? '<span class="lf-heard">' + esc(r.heard) + '</span><span class="lf-arrow" aria-hidden="true">→</span>' : '') + '<b>' + esc(r.result) + '</b></div>' +
        (r.q ? '<div class="lf-q">' + esc(r.q) + '</div>' : '') + '</div></div>';
    });
    if (raOk && c.retireAgeAuto) {
      srcRows.push('<div class="lf-row"><div class="lf-k">退職の予定</div><div class="lf-v"><div class="lf-main"><span class="lf-heard">' + esc(ra) + '歳</span>' +
        (sb ? '<span class="lf-arrow" aria-hidden="true">→</span><b>' + (sb.y + ra) + '年</b>' : '') + '</div>' + (rq ? '<div class="lf-q">' + esc(rq) + '</div>' : '') + '</div></div>');
    }
    evs.forEach(function (e) {
      var q = quote(e.evidence, e.meetingDay);
      srcRows.push('<div class="lf-row"><div class="lf-k">予定</div><div class="lf-v"><div class="lf-main"><b>' + esc(dateLabel(e.date)) + '</b><span class="lf-ev-label">' +
        (e.who ? esc(e.who) + 'の' : '') + esc(e.label) + '</span></div>' + (q ? '<div class="lf-q">' + esc(q) + '</div>' : '') + '</div></div>');
    });
    var srcHtml = srcRows.length
      ? '<details class="lf-src" data-lf-src="' + esc(id) + '"' + (st.src[id] ? ' open' : '') + '><summary>議事録から読み取った内容（' + srcRows.length + '件）</summary>' +
        '<div class="lf-rows">' + srcRows.join('') + '</div>' +
        '<p class="lf-foot">ちがうときは、<button type="button" class="lf-link cd-tab-jump" data-jump-tab="family">「家族」タブ</button>で生年月日を入れると正確な年に変わります。</p></details>'
      : '';

    var lead = plan
      ? '5年ごとにまとめています。どの時期に何が重なるかが分かります。'
      : '面談で「上の子がいま5歳」「65で定年の予定」のように聞くと、生まれ年や進学・退職の年を計算して、ここに見通しが自動でできます。';
    var st0 = statusText(c);
    return '<section class="lf-box" data-lf-card="' + esc(id) + '">' +
      '<header class="lf-head">' +
        '<h4 class="lf-h"><span>これからの見通し</span></h4>' +
        '<span class="lf-state' + (p.busy ? ' is-busy' : ((p.err || p.budget) ? ' is-warn' : '')) + '" data-lf-status="' + esc(id || 'x') + '" role="status">' + esc(st0) + '</span>' +
      '</header>' +
      '<p class="lf-lead">' + lead + '</p>' +
      (plan ? bandsHtml(c, id) : '') +
      retireHtml + srcHtml +
      '</section>';
  }
  function repaintCard(c) {
    var el = document.querySelector('[data-lf-card="' + (fsId(c) || '') + '"]');
    if (el) el.outerHTML = cardHtml(c);
  }

  // ---------- 小さな 印 ----------
  function tagHtml(ev) {
    var t = (window.LifeEvents && window.LifeEvents.tagText) ? window.LifeEvents.tagText(ev) : '';
    if (!t) return '';
    return '<span class="lf-tag' + (ev.src === 'minutes' ? '' : ' lf-tag-approx') + '">' + esc(t) + '</span>';
  }
  function memberTagHtml(m) {
    return (m && (m.addedByAI || m.birthApprox)) ? '<span class="lf-tag lf-tag-inline">議事録から</span>' : '';
  }

  // ---------- カード の 操作 ----------
  function currentClient(id) {
    if (st.cur && fsId(st.cur.c) === id) return st.cur.c;
    return findClient(id);
  }
  function removeEvent(c, evId) {
    var list = Array.isArray(c.customEvents) ? c.customEvents : [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === evId) { idx = i; break; }
    if (idx < 0) return;
    var removed = list[idx];
    var prev = list.slice();
    c.customEvents = list.filter(function (_, i2) { return i2 !== idx; });
    invalidate(c); refreshViews(c);
    var undone = false;
    io.persist(c, { customEvents: c.customEvents }).then(function () {
      toast('予定「' + String(removed.label || '') + '」を取り消しました', '元に戻す', function () {
        undone = true;
        // 取り消した 後 に 他 の 変更 が 入って いて も 壊さない よう、 いま の 一覧 に 足し 直す
        var now = Array.isArray(c.customEvents) ? c.customEvents.slice() : [];
        if (!now.some(function (x) { return x && x.id === removed.id; })) now.push(removed);
        c.customEvents = now;
        invalidate(c); refreshViews(c);
        io.persist(c, { customEvents: c.customEvents }).catch(function () { toast('元に戻せませんでした。通信を確認してください', null, null, true); });
      });
    }, function (e) {
      if (undone) return;
      console.warn('[lifesync] remove persist fail:', e && e.message);
      c.customEvents = prev;
      invalidate(c); refreshViews(c);
      toast('取り消せませんでした。通信を確認してください', null, null, true);
    });
  }
  function setRetire(c, input) {
    var raw = String(input.value || '').trim();
    var wrap = input.closest('.lf-retire-row');
    var err = wrap ? wrap.querySelector('[data-lf-retire-err]') : null;
    var val = null;
    if (raw !== '') {
      var n = Number(raw);
      if (!isFinite(n) || n < 45 || n > 85 || Math.round(n) !== n) {
        input.classList.add('is-error');
        if (err) err.hidden = false;
        return;
      }
      val = n;
    }
    input.classList.remove('is-error');
    if (err) err.hidden = true;
    var prevAge = (c.retireAge === undefined) ? null : c.retireAge, prevAuto = !!c.retireAgeAuto;
    if (String(prevAge === null ? '' : prevAge) === String(val === null ? '' : val)) return;
    c.retireAge = val; c.retireAgeAuto = false;
    invalidate(c); refreshViews(c);
    io.persist(c, { retireAge: val, retireAgeAuto: false }).then(function () {
      toast(val === null ? '退職の予定を空にしました' : '退職の予定を ' + val + '歳 にしました');
    }, function (e) {
      console.warn('[lifesync] retire persist fail:', e && e.message);
      c.retireAge = prevAge; c.retireAgeAuto = prevAuto;
      invalidate(c); refreshViews(c);
      toast('保存できませんでした。通信を確認してください', null, null, true);
    });
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-lf-act]') : null;
    if (!t) return;
    var act = t.getAttribute('data-lf-act');
    if (act === 'all-more') { runAll(true); return; }
    if (act === 'all-dismiss') { st.all.dismissed = true; paintBar(); return; }
    if (act === 'more') {
      var box = t.closest('[data-lf-card]');
      var cc = box ? currentClient(box.getAttribute('data-lf-card')) : null;
      if (cc) { var k = fsId(cc); st.open[k] = !st.open[k]; repaintCard(cc); }
      return;
    }
    if (act === 'remove-event') {
      var card = t.closest('[data-lf-card]');
      var c = card ? currentClient(card.getAttribute('data-lf-card')) : (st.cur && st.cur.c);
      if (c) removeEvent(c, t.getAttribute('data-id'));
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || t.getAttribute('data-lf-retire') === null) return;
    var c = currentClient(t.getAttribute('data-lf-retire')) || (st.cur && st.cur.c);
    if (c) setRetire(c, t);
  });
  // <details> の 開閉 は 上 へ 伝わらない ので、 つかまえる 側 (capture) で 覚える (作り直して も 開いた まま に する)
  document.addEventListener('toggle', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-lf-src') !== null) st.src[t.getAttribute('data-lf-src')] = !!t.open;
  }, true);
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.key === 'Enter' && t && t.getAttribute && t.getAttribute('data-lf-retire') !== null) { e.preventDefault(); t.blur(); }
  });

  window.FpLifeSync = {
    onOpenClient: onOpenClient,
    onOpenTimeline: onOpenTimeline,
    afterMeetingSaved: afterMeetingSaved,
    syncCustomer: syncCustomer,
    cardHtml: cardHtml,
    hasPlan: hasPlan,
    familyHtml: familyHtml,
    barHtml: barHtml,
    paintBar: paintBar,
    tagHtml: tagHtml,
    memberTagHtml: memberTagHtml,
    _state: st,
    _io: io,
    _applyView: applyView,
    _toast: toast,
  };
})();
