/* FP Compass — アフターフォロー 一覧 (2026-11-20)
   議事録 (meetings doc の tasks) から 拾った 「次 に やる こと」 を テナント 横断 で 並べる。
   データ: Cloud Functions listFollowUps / setFollowUpState (asia-northeast1)。
   完了 状態 は meetings doc の followupState に 持つ ので、 PC と スマホ で 同じ もの が 見える。 */
(function () {
  'use strict';
  if (window.FpFollowups) return;

  var STALE_MS = 2 * 60 * 1000;      // 画面 を 開いた とき、 これ より 古ければ 取り直す
  var GROUP_CAP = 12;                // 1 グループ で 最初 に 見せる 行数
  var STALE_DAYS = 30;               // 「古い 期限切れ」 と みなす 日数
  var BUCKETS = [
    { id: 'overdue', label: '期限切れ',  title: '期限切れ' },
    { id: 'week',    label: '今週',      title: '今週（7日以内）' },
    { id: 'month',   label: '今月',      title: '今月（30日以内）' },
    { id: 'later',   label: 'それ以降',  title: 'それ以降' }
  ];
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  var state = {
    items: [], next: {}, loadedAt: 0, loading: false, error: '',
    mode: 'due', status: 'open', q: '', bucket: '',
    expanded: {}, more: {}, confirm: ''
  };
  var root = null;
  var toastTimer = null;

  // ---------- 小物 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function toUtc(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  // 期限 まで の 日数 (負 = 超過)。 期限 なし は null。
  function diffDays(day, today) {
    var a = toUtc(day), b = toUtc(today);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((a - b) / 86400000);
  }
  function fmtDay(day, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    if (!m) return '';
    var w = WD[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
    var sameYear = String(today || '').slice(0, 4) === m[1];
    return (sameYear ? '' : m[1] + '/') + (+m[2]) + '/' + (+m[3]) + '(' + w + ')';
  }
  function relLabel(diff) {
    if (diff == null) return '';
    if (diff < 0) return (-diff) + '日超過';
    if (diff === 0) return '今日';
    if (diff === 1) return '明日';
    if (diff <= 30) return 'あと' + diff + '日';
    return '';
  }
  function bucketOf(diff) {
    if (diff == null) return 'later';
    if (diff < 0) return 'overdue';
    if (diff <= 7) return 'week';
    if (diff <= 30) return 'month';
    return 'later';
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s　]/g, '').replace(/様/g, '');
  }
  function withSama(name) {
    var n = String(name || 'お客様').trim();
    return /様$/.test(n) ? n : n + ' 様';
  }
  function initial(name) {
    var n = String(name || '').replace(/[\s　]/g, '');
    return n ? Array.from(n)[0] : '客';
  }
  function icon(name) { return '<i data-lucide="' + name + '" aria-hidden="true"></i>'; }
  function paintIcons() {
    try { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); } catch (_) {}
  }

  // ---------- 通信 ----------
  function ready() {
    return !!(window.__fp && window.__fp.functions && window.__fp.httpsCallable && window.__fp.tenantId);
  }
  function call(name, data) {
    if (!ready()) return Promise.reject(new Error('not-ready'));
    return window.__fp.httpsCallable(window.__fp.functions, name)(data || {}).then(function (r) { return (r && r.data) || {}; });
  }
  function load(force) {
    if (state.loading) return Promise.resolve();
    if (!force && state.loadedAt && Date.now() - state.loadedAt < STALE_MS) return Promise.resolve();
    if (!ready()) return Promise.resolve();
    state.loading = true; state.error = '';
    if (viewActive()) { if (!state.loadedAt) draw(); else markRefreshing(true); }   // 初回 だけ 骨組み。 2 回目 以降 は 今 の 表示 の まま 裏 で 取る
    return call('listFollowUps', {}).then(function (d) {
      state.items = Array.isArray(d.items) ? d.items : [];
      var nx = {};
      (Array.isArray(d.nextMeetings) ? d.nextMeetings : []).forEach(function (n) { if (n && n.customerId) nx[n.customerId] = n; });
      state.next = nx;
      state.loadedAt = Date.now();
    }).catch(function (e) {
      console.warn('[followups] load fail:', e && e.message);
      state.error = '通信の状態を確かめて、もう一度お試しください。';
    }).then(function () {
      state.loading = false;
      updateBadge();
      if (viewActive()) draw();
    });
  }
  function markRefreshing(on) {
    var b = root && root.querySelector('[data-fu="refresh"]');
    if (b) b.classList.toggle('is-busy', !!on);
  }

  // ---------- 集計 ----------
  function decorate(today) {
    return state.items.map(function (it) {
      var diff = diffDays(it.dueDay, today);
      return { it: it, diff: diff, bucket: bucketOf(diff) };
    });
  }
  function openCounts(rows) {
    var c = { overdue: 0, week: 0, month: 0, later: 0, open: 0, done: 0 };
    rows.forEach(function (r) {
      if (r.it.done) { c.done++; return; }
      c.open++; c[r.bucket]++;
    });
    return c;
  }
  function updateBadge() {
    var el = document.getElementById('nav-count-followups');
    if (!el) return;
    var c = openCounts(decorate(todayStr()));
    var n = c.overdue + c.week;         // いま 手 を 付ける べき もの
    el.textContent = n > 0 ? (n > 99 ? '99+' : String(n)) : '';
    el.classList.toggle('nav-count-alert', c.overdue > 0);
    el.title = n > 0 ? '期限切れ ' + c.overdue + '件 / 今週 ' + c.week + '件' : '';
  }
  function byDue(a, b) {
    var da = a.diff == null ? 99999 : a.diff, db = b.diff == null ? 99999 : b.diff;
    if (da !== db) return da - db;
    return String(a.it.customerName).localeCompare(String(b.it.customerName), 'ja');
  }

  // ---------- 描画 ----------
  function rowHtml(r, today, showWho) {
    var it = r.it;
    var open = !!state.expanded[it.id];
    var dueTxt = fmtDay(it.dueDay, today);
    var rel = it.done ? '' : relLabel(r.diff);
    var tone = it.done ? 'done' : (r.diff == null ? 'none' : r.diff < 0 ? 'overdue' : r.diff <= 1 ? 'soon' : 'normal');
    var dueHtml;
    if (it.done) {
      var dd = String(it.doneAt || '').slice(0, 10);
      dueHtml = '<span class="fu-due is-done">' + (dd ? esc(fmtDay(localDayOf(it.doneAt), today)) + ' に完了' : '完了') + '</span>';
    } else if (dueTxt) {
      dueHtml = '<span class="fu-due is-' + tone + '"><span class="fu-due-date">' + esc(dueTxt) + '</span>' +
        (rel ? '<span class="fu-due-rel">' + esc(rel) + '</span>' : '') + '</span>';
    } else {
      dueHtml = '<span class="fu-due is-none">期限なし</span>';
    }
    var detail = '';
    if (open) {
      detail = '<div class="fu-detail">' +
        (it.why ? '<div class="fu-detail-block"><div class="fu-detail-label">進め方</div><p class="fu-detail-text">' + esc(it.why) + '</p></div>' : '') +
        (it.lineDraft ? '<div class="fu-detail-block"><div class="fu-detail-label">LINEの文面（下書き）</div>' +
          '<div class="fu-draft"><p class="fu-draft-text">' + esc(it.lineDraft) + '</p>' +
          '<button type="button" class="fu-btn fu-btn-sm" data-fu="copy" data-id="' + esc(it.id) + '">' + icon('copy') + '<span>コピー</span></button></div></div>' : '') +
        '<div class="fu-detail-foot"><span class="fu-detail-src">' +
          (showWho ? '<span class="fu-detail-who">' + esc(withSama(it.customerName)) + '</span>' : '') +
          '<span>' + (it.meetingDay ? esc(fmtDay(it.meetingDay, today)) + ' の面談の議事録より' : '議事録より') + '</span></span>' +
          (showWho ? '<button type="button" class="fu-btn fu-btn-sm" data-fu="open" data-cid="' + esc(it.customerId) + '">' + icon('user-round') + '<span>カルテを開く</span></button>' : '') + '</div>' +
        '</div>';
    }
    return '<li class="fu-row' + (it.done ? ' is-done' : '') + (open ? ' is-open' : '') + '" data-id="' + esc(it.id) + '">' +
      '<button type="button" class="fu-check" data-fu="toggle" data-id="' + esc(it.id) + '" role="checkbox" aria-checked="' + (it.done ? 'true' : 'false') + '" ' +
        'aria-label="' + (it.done ? '未完了に戻す' : '完了にする') + '"><span class="fu-check-box">' + icon('check') + '</span></button>' +
      '<button type="button" class="fu-row-main" data-fu="expand" data-id="' + esc(it.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="fu-row-title">' + esc(it.task) + '</span>' +
        (showWho ? '<span class="fu-who" title="' + esc(withSama(it.customerName)) + '">' + esc(withSama(it.customerName)) + '</span>' : '') +
        dueHtml +
        '<span class="fu-chev">' + icon('chevron-down') + '</span>' +
      '</button>' + detail + '</li>';
  }
  function localDayOf(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function rowsHtml(rows, today, showWho, capKey) {
    var cap = state.more[capKey] ? rows.length : GROUP_CAP;
    var shown = rows.slice(0, cap);
    var rest = rows.length - shown.length;
    return '<ul class="fu-rows' + (showWho ? '' : ' no-who') + '">' +
      shown.map(function (r) { return rowHtml(r, today, showWho); }).join('') + '</ul>' +
      (rest > 0 ? '<button type="button" class="fu-more" data-fu="more" data-key="' + esc(capKey) + '">ほか ' + rest + ' 件を表示' + icon('chevron-down') + '</button>' : '') +
      (state.more[capKey] && rows.length > GROUP_CAP ? '<button type="button" class="fu-more" data-fu="less" data-key="' + esc(capKey) + '">たたむ' + icon('chevron-up') + '</button>' : '');
  }
  function confirmHtml(key, n, label, what) {
    if (state.confirm === key) {
      return '<span class="fu-confirm" role="group"><span class="fu-confirm-text">' + esc(what || '') + n + ' 件を完了にします</span>' +
        '<button type="button" class="fu-btn fu-btn-sm fu-btn-primary" data-fu="bulk-go" data-key="' + esc(key) + '">完了にする</button>' +
        '<button type="button" class="fu-btn fu-btn-sm" data-fu="bulk-cancel">やめる</button></span>';
    }
    return '<button type="button" class="fu-link" data-fu="bulk-ask" data-key="' + esc(key) + '">' + esc(label) + '</button>';
  }
  function dueModeHtml(rows, today) {
    if (state.status === 'done') {
      var sorted = rows.slice().sort(function (a, b) { return String(b.it.doneAt).localeCompare(String(a.it.doneAt)); });
      return '<section class="fu-group is-done"><header class="fu-group-head"><h2 class="fu-group-title">完了したフォロー</h2>' +
        '<span class="fu-group-count">' + sorted.length + '件</span><span class="fu-group-note">直近45日分</span></header>' +
        rowsHtml(sorted, today, true, 'done') + '</section>';
    }
    return BUCKETS.map(function (b) {
      if (state.bucket && state.bucket !== b.id) return '';
      var g = rows.filter(function (r) { return r.bucket === b.id; }).sort(byDue);
      if (!g.length) return '';
      var bulk = '';
      if (b.id === 'overdue') {
        var stale = g.filter(function (r) { return r.diff != null && r.diff <= -STALE_DAYS; });
        if (stale.length >= 3) bulk = confirmHtml('stale', stale.length, '古い ' + stale.length + ' 件をまとめて完了', '期限から' + STALE_DAYS + '日以上たった ');
      }
      return '<section class="fu-group is-' + b.id + '"><header class="fu-group-head"><h2 class="fu-group-title">' + esc(b.title) + '</h2>' +
        '<span class="fu-group-count">' + g.length + '件</span>' + bulk + '</header>' +
        rowsHtml(g, today, true, b.id) + '</section>';
    }).join('');
  }
  function customerModeHtml(rows, today) {
    var map = {}, order = [];
    rows.forEach(function (r) {
      if (state.status === 'open' && state.bucket && r.bucket !== state.bucket) return;
      var k = r.it.customerId;
      if (!map[k]) { map[k] = { id: k, name: r.it.customerName, rows: [] }; order.push(map[k]); }
      map[k].rows.push(r);
    });
    order.forEach(function (c) {
      if (state.status === 'done') c.rows.sort(function (a, b) { return String(b.it.doneAt).localeCompare(String(a.it.doneAt)); });
      else c.rows.sort(byDue);
      c.first = c.rows[0];
    });
    order.sort(function (a, b) {
      if (state.status === 'done') return String(b.first.it.doneAt).localeCompare(String(a.first.it.doneAt));
      return byDue(a.first, b.first);
    });
    return order.map(function (c) {
      var nx = state.status === 'open' ? state.next[c.id] : null;
      var first = c.first;
      var sub;
      if (state.status === 'done') sub = '完了 ' + c.rows.length + '件';
      else {
        var od = c.rows.filter(function (r) { return r.bucket === 'overdue'; }).length;
        sub = '未完了 ' + c.rows.length + '件' + (od ? '<span class="fu-cust-od">うち期限切れ ' + od + '件</span>' : '') +
          (first && first.it.dueDay && !od ? '<span class="fu-cust-nd">次の期限 ' + esc(fmtDay(first.it.dueDay, today)) + '</span>' : '');
      }
      var key = 'cust:' + c.id;
      return '<section class="fu-cust" data-cid="' + esc(c.id) + '">' +
        '<header class="fu-cust-head"><span class="fu-avatar" aria-hidden="true">' + esc(initial(c.name)) + '</span>' +
        '<div class="fu-cust-id"><h2 class="fu-cust-name">' + esc(withSama(c.name)) + '</h2><p class="fu-cust-sub">' + sub + '</p></div>' +
        '<button type="button" class="fu-btn fu-btn-sm fu-cust-open" data-fu="open" data-cid="' + esc(c.id) + '" aria-label="' + esc(withSama(c.name)) + ' のカルテを開く">' + icon('user-round') + '<span class="fu-lbl-full">カルテを開く</span><span class="fu-lbl-short">カルテ</span></button></header>' +
        (nx ? '<p class="fu-next"><span class="fu-next-label">次回の面談</span><span class="fu-next-text">' + esc(nx.text) + '</span></p>' : '') +
        rowsHtml(c.rows, today, false, key) +
        (state.status === 'open' && c.rows.length >= 2 ? '<footer class="fu-cust-foot">' + confirmHtml(key, c.rows.length, 'この方の ' + c.rows.length + ' 件をまとめて完了', '') + '</footer>' : '') +
        '</section>';
    }).join('');
  }
  function skeletonHtml() {
    var rows = '';
    for (var i = 0; i < 6; i++) rows += '<li class="fu-row fu-skel"><span class="fu-skel-box"></span><span class="fu-skel-line" style="width:' + (38 + (i * 7) % 30) + '%"></span><span class="fu-skel-line fu-skel-short"></span></li>';
    return '<section class="fu-group" aria-busy="true"><ul class="fu-rows">' + rows + '</ul></section>';
  }
  function emptyHtml(kind) {
    var t, s, btn = '';
    if (kind === 'search') { t = '当てはまるものがありません'; s = '「' + esc(state.q) + '」では見つかりませんでした。言葉を変えてお試しください。'; btn = '<button type="button" class="fu-btn" data-fu="clear-q">検索をやめる</button>'; }
    else if (kind === 'bucket') { t = 'この期間のフォローはありません'; s = '別の期間を選ぶか、絞り込みを外してください。'; btn = '<button type="button" class="fu-btn" data-fu="clear-bucket">すべて表示</button>'; }
    else if (kind === 'done') { t = '完了したフォローはまだありません'; s = '完了にしたものは、ここに45日間残ります。'; }
    else if (kind === 'alldone') { t = '未完了のフォローはありません'; s = 'すべて対応済みです。面談の議事録ができると、また「次にやること」がここに並びます。'; }
    else { t = 'フォロー項目はまだありません'; s = '面談の議事録ができると、「次にやること」がここに自動で並びます。'; }
    return '<div class="fu-empty"><span class="fu-empty-icon">' + icon(kind === 'search' ? 'search' : 'list-checks') + '</span>' +
      '<p class="fu-empty-title">' + t + '</p><p class="fu-empty-sub">' + s + '</p>' + btn + '</div>';
  }

  function draw() {
    root = document.getElementById('fu-root');
    if (!root) return;
    var today = todayStr();
    var all = decorate(today);
    var counts = openCounts(all);
    var q = norm(state.q);
    var rows = all.filter(function (r) {
      if ((state.status === 'done') !== !!r.it.done) return false;
      if (q && norm(r.it.customerName + ' ' + r.it.task + ' ' + r.it.why).indexOf(q) < 0) return false;
      return true;
    });

    var body;
    if (!state.loadedAt && !state.error) body = skeletonHtml();   // まだ 1 度 も 取れて いない 間 は 骨組み
    else if (state.error && !state.loadedAt) {
      body = '<div class="fu-empty is-error"><span class="fu-empty-icon">' + icon('cloud-off') + '</span><p class="fu-empty-title">読み込めませんでした</p>' +
        '<p class="fu-empty-sub">' + esc(state.error) + '</p><button type="button" class="fu-btn fu-btn-primary" data-fu="refresh">もう一度読み込む</button></div>';
    } else if (!rows.length) {
      body = emptyHtml(q ? 'search' : state.status === 'done' ? 'done' : (state.items.length ? 'alldone' : 'none'));
    } else {
      body = state.mode === 'customer' ? customerModeHtml(rows, today) : dueModeHtml(rows, today);
      if (!body) body = emptyHtml('bucket');
    }

    var stats = BUCKETS.map(function (b) {
      var on = state.status === 'open' && state.bucket === b.id;
      return '<button type="button" class="fu-stat is-' + b.id + (on ? ' is-on' : '') + (counts[b.id] ? '' : ' is-zero') + '" data-fu="bucket" data-bucket="' + b.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="fu-stat-num">' + (state.loadedAt ? counts[b.id] : '–') + '</span><span class="fu-stat-label">' + b.label + '</span></button>';
    }).join('');

    var focusSearch = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('fu-search-input');
    var caret = focusSearch ? document.activeElement.selectionStart : null;

    root.innerHTML =
      '<div class="fu">' +
        '<header class="fu-head"><div class="fu-head-text"><h1 class="fu-title">アフターフォロー</h1>' +
          '<p class="fu-sub"><span>議事録から拾った「次にやること」です。</span><span>終わったものにチェックを入れてください。</span></p></div>' +
          '<button type="button" class="fu-btn fu-refresh' + (state.loading ? ' is-busy' : '') + '" data-fu="refresh" aria-label="最新の状態に更新">' + icon('refresh-cw') + '<span>更新</span></button></header>' +
        '<div class="fu-stats' + (state.loadedAt ? '' : ' is-blank') + '" role="group" aria-label="期限ごとの件数">' + stats + '</div>' +
        '<div class="fu-toolbar">' +
          '<div class="fu-seg" role="group" aria-label="並べ方">' +
            '<button type="button" class="fu-seg-btn' + (state.mode === 'due' ? ' is-on' : '') + '" data-fu="mode" data-mode="due" aria-pressed="' + (state.mode === 'due') + '">期限順</button>' +
            '<button type="button" class="fu-seg-btn' + (state.mode === 'customer' ? ' is-on' : '') + '" data-fu="mode" data-mode="customer" aria-pressed="' + (state.mode === 'customer') + '">お客様ごと</button></div>' +
          '<label class="fu-search">' + icon('search') + '<input type="search" class="fu-search-input" placeholder="お客様の名前・内容でさがす" value="' + esc(state.q) + '" aria-label="フォローをさがす" autocomplete="off"></label>' +
          '<div class="fu-seg fu-seg-status" role="group" aria-label="表示するもの">' +
            '<button type="button" class="fu-seg-btn' + (state.status === 'open' ? ' is-on' : '') + '" data-fu="status" data-status="open" aria-pressed="' + (state.status === 'open') + '">未完了<span class="fu-seg-num">' + (state.loadedAt ? counts.open : '–') + '</span></button>' +
            '<button type="button" class="fu-seg-btn' + (state.status === 'done' ? ' is-on' : '') + '" data-fu="status" data-status="done" aria-pressed="' + (state.status === 'done') + '">完了<span class="fu-seg-num">' + (state.loadedAt ? counts.done : '–') + '</span></button></div>' +
        '</div>' +
        (state.error && state.loadedAt ? '<p class="fu-inline-error" role="alert">最新の状態を読み込めませんでした。' + esc(state.error) + '</p>' : '') +
        '<div class="fu-list">' + body + '</div>' +
      '</div>';
    paintIcons();
    if (focusSearch) {
      var inp = root.querySelector('.fu-search-input');
      if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch (_) {} }
    }
  }

  // ---------- 操作 ----------
  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }
  function setDone(ids, done, silent) {
    var changed = [];
    var at = new Date().toISOString();
    ids.forEach(function (id) {
      var it = findItem(id);
      if (!it || !!it.done === !!done) return;
      changed.push({ it: it, prevDone: it.done, prevAt: it.doneAt });
      it.done = !!done; it.doneAt = done ? at : '';
      delete state.expanded[id];
    });
    if (!changed.length) return;
    state.confirm = '';
    updateBadge(); draw();
    if (!silent) {
      toast(done ? (changed.length > 1 ? changed.length + ' 件を完了にしました' : '完了にしました') : '未完了に戻しました',
        '元に戻す', function () { setDone(changed.map(function (c) { return c.it.id; }), !done, true); });
    }
    call('setFollowUpState', {
      changes: changed.map(function (c) { return { customerId: c.it.customerId, meetingId: c.it.meetingId, key: c.it.key, done: !!done }; })
    }).then(function (res) {
      if (res && res.ok === false) throw new Error('partial');
    }).catch(function (e) {
      console.warn('[followups] save fail:', e && e.message);
      changed.forEach(function (c) { c.it.done = c.prevDone; c.it.doneAt = c.prevAt; });
      updateBadge(); draw();
      toast('保存できませんでした。もう一度お試しください。', '', null, true);
    });
  }
  function bulkIds(key) {
    var today = todayStr();
    var rows = decorate(today).filter(function (r) { return !r.it.done; });
    if (key === 'stale') return rows.filter(function (r) { return r.diff != null && r.diff <= -STALE_DAYS; }).map(function (r) { return r.it.id; });
    if (key.indexOf('cust:') === 0) {
      var cid = key.slice(5);
      var q = norm(state.q);
      return rows.filter(function (r) {
        if (r.it.customerId !== cid) return false;
        if (state.bucket && r.bucket !== state.bucket) return false;
        if (q && norm(r.it.customerName + ' ' + r.it.task + ' ' + r.it.why).indexOf(q) < 0) return false;
        return true;
      }).map(function (r) { return r.it.id; });
    }
    return [];
  }
  function copyText(text, btn) {
    var ok = function () {
      if (!btn) return;
      var sp = btn.querySelector('span');
      if (sp) { sp.textContent = 'コピーしました'; btn.classList.add('is-ok'); setTimeout(function () { sp.textContent = 'コピー'; btn.classList.remove('is-ok'); }, 1800); }
    };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (_) { toast('コピーできませんでした。文面を長押しして選んでください。', '', null, true); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }
  function toast(msg, actionLabel, onAction, isError) {
    var old = document.getElementById('fu-toast');
    if (old) old.remove();
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    var el = document.createElement('div');
    el.id = 'fu-toast';
    el.className = 'fu-toast' + (isError ? ' is-error' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="fu-toast-msg">' + esc(msg) + '</span>' +
      (actionLabel ? '<button type="button" class="fu-toast-btn">' + esc(actionLabel) + '</button>' : '');
    document.body.appendChild(el);
    var b = el.querySelector('.fu-toast-btn');
    if (b && onAction) b.addEventListener('click', function () { el.remove(); onAction(); });
    toastTimer = setTimeout(function () { el.remove(); }, isError ? 6000 : 5000);
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-fu]') : null;
    if (!t || !root || !root.contains(t)) return;
    var act = t.getAttribute('data-fu');
    if (act === 'toggle') { var it = findItem(t.getAttribute('data-id')); if (it) setDone([it.id], !it.done); return; }
    if (act === 'expand') { var id = t.getAttribute('data-id'); if (state.expanded[id]) delete state.expanded[id]; else state.expanded[id] = true; draw(); return; }
    if (act === 'more') { state.more[t.getAttribute('data-key')] = true; draw(); return; }
    if (act === 'less') { delete state.more[t.getAttribute('data-key')]; draw(); return; }
    if (act === 'mode') { state.mode = t.getAttribute('data-mode'); state.confirm = ''; draw(); return; }
    if (act === 'status') { state.status = t.getAttribute('data-status'); state.bucket = ''; state.confirm = ''; draw(); return; }
    if (act === 'bucket') { var b = t.getAttribute('data-bucket'); state.bucket = (state.status === 'open' && state.bucket === b) ? '' : b; state.status = 'open'; state.confirm = ''; draw(); return; }
    if (act === 'clear-q') { state.q = ''; draw(); return; }
    if (act === 'clear-bucket') { state.bucket = ''; draw(); return; }
    if (act === 'refresh') { load(true); return; }
    if (act === 'bulk-ask') { state.confirm = t.getAttribute('data-key'); draw(); return; }
    if (act === 'bulk-cancel') { state.confirm = ''; draw(); return; }
    if (act === 'bulk-go') { setDone(bulkIds(t.getAttribute('data-key')), true); return; }
    if (act === 'copy') { var ci = findItem(t.getAttribute('data-id')); if (ci) copyText(ci.lineDraft, t); return; }
    if (act === 'open') {
      var ok = false;
      try { ok = !!(window.__fpOpenClientByFsId && window.__fpOpenClientByFsId(t.getAttribute('data-cid'), 'meetings')); } catch (_) {}
      if (!ok) toast('この方のカルテが見つかりませんでした。顧客台帳からお探しください。', '', null, true);
      return;
    }
  }
  var qTimer = null;
  function onInput(e) {
    if (!e.target.classList || !e.target.classList.contains('fu-search-input')) return;
    var v = e.target.value;
    if (qTimer) clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = v; state.confirm = ''; draw(); }, 140);
  }
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);

  function render() {
    draw();
    load(false);
  }

  window.FpFollowups = {
    render: render,
    refresh: function () { return load(true); },
    _state: state
  };

  // 読み込み が 終わった 時点 で この 画面 が 開いて いたら 描く (?view=followups で 直接 来た とき)
  function viewActive() {
    var v = document.querySelector('.view[data-view="followups"]');
    return !!(v && v.classList.contains('active'));
  }
  // サイドバー の 件数 バッジ 用 に、 ログイン 後 に 1 回 だけ 先 に 取って おく
  var tries = 0;
  (function boot() {
    if (ready()) { if (viewActive()) render(); else load(false); return; }
    if (viewActive() && tries === 0) draw();
    if (++tries < 80) setTimeout(boot, 500);
  })();
})();
