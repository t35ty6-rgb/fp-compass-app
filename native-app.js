/* FP Compass — iPhone アプリの中だけで動く部分 (2026-11-22)
   アプリ本体 (Swift 側の FPNative) を呼ぶ窓口。 ブラウザで開いたときは何もしない。
   できること: Face ID ロックの入切 / 面談のお知らせ (端末内の通知) / 共有 / 印刷。
   古いアプリ (1.0.0 の最初のビルド) には FPNative が無いので、 その場合は静かに何もしない。 */
(function () {
  'use strict';
  if (window.FpNative) return;

  var cap = window.Capacitor;
  var root = document.documentElement;

  function call(method, opts, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, timeoutMs || 15000);
      try {
        if (!cap || typeof cap.nativePromise !== 'function') throw new Error('no-bridge');
        cap.nativePromise('FPNative', method, opts || {}).then(function (r) {
          if (done) return; done = true; clearTimeout(t); resolve(r || {});
        }, function (e) {
          if (done) return; done = true; clearTimeout(t); reject(e || new Error('failed'));
        });
      } catch (e) { if (!done) { done = true; clearTimeout(t); reject(e); } }
    });
  }

  var info = null;
  var ready = call('getInfo', {}, 3000).then(function (r) {
    info = r;
    root.classList.add('fp-native-v2');
    return r;
  }, function () { info = null; return null; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 面談のお知らせ ----------
  var MAX_ITEMS = 40;                 // iPhone が持てる予約通知は 64 件まで
  var AHEAD_MS = 21 * 86400000;       // 3 週間先まで
  var lastSig = null;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hm(d) { return d.getHours() + ':' + pad2(d.getMinutes()); }
  function slotOf(b) {
    if (!b) return null;
    var raw = b.confirmedSlot || (b.date ? (b.date + (b.time ? ' ' + b.time : '')) : null);
    if (!raw) return null;
    raw = String(raw).trim();
    // 「2026-11-24 9:05」 の形は Safari が読めないので自分で組み立てる (端末の時刻として扱う)
    var m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
    var d = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0) : new Date(raw);
    if (!m && /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(raw)) return null;   // 時刻が決まっていない予定
    return isNaN(d) ? null : d;
  }
  function isLive(b) {
    var st = String((b && (b.status || b.state)) || '').toLowerCase();
    return !/cancel|キャンセル|取消|declin|reject/.test(st);
  }
  // 予定の一覧 → 通知の一覧。 お客さまの名前は画面ロック中にも見えるので入れない。
  function buildItems(bookings, now) {
    var nowMs = (now || new Date()).getTime();
    var seen = {};
    var slots = [];
    (bookings || []).forEach(function (b) {
      if (!isLive(b)) return;
      var d = slotOf(b);
      if (!d) return;
      var ms = d.getTime();
      if (ms <= nowMs || ms > nowMs + AHEAD_MS) return;
      if (seen[ms]) return;             // 同じ時刻の重複は 1 つに
      seen[ms] = true;
      slots.push(d);
    });
    slots.sort(function (a, b) { return a - b; });
    var items = [];
    slots.forEach(function (d) {
      var ms = d.getTime();
      var eve = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 18, 0, 0).getTime();
      if (eve > nowMs) items.push({ id: 'fp-rem-e-' + ms, at: eve, title: '明日の面談', body: '明日 ' + hm(d) + ' から面談の予定があります。' });
      var soon = ms - 30 * 60000;
      if (soon > nowMs) items.push({ id: 'fp-rem-s-' + ms, at: soon, title: 'まもなく面談', body: hm(d) + ' から面談の予定があります。' });
    });
    items.sort(function (a, b) { return a.at - b.at; });
    return items.slice(0, MAX_ITEMS);
  }
  function syncReminders(force) {
    return ready.then(function (r) {
      if (!r || !r.reminders || r.notifications !== 'granted') return null;
      var bks = (window.LineAppLiveData && window.LineAppLiveData.bookings) || null;
      if (!Array.isArray(bks)) return null;          // まだ読み込み中
      var items = buildItems(bks);
      var sig = items.map(function (x) { return x.id; }).join(',');
      if (!force && sig === lastSig) return null;
      return call('setReminders', { enabled: true, items: items }).then(function (res) { lastSig = sig; return res; }, function () { return null; });
    });
  }
  function setRemindersEnabled(on) {
    if (!on) {
      lastSig = null;
      return call('setReminders', { enabled: false, items: [] }).then(function () { if (info) info.reminders = false; return { enabled: false }; });
    }
    return call('requestNotifications', {}, 120000).then(function (r) {
      if (info) info.notifications = r.status;
      if (r.status !== 'granted') return { enabled: false, denied: true };
      if (info) info.reminders = true;
      var bks = (window.LineAppLiveData && window.LineAppLiveData.bookings) || [];
      return call('setReminders', { enabled: true, items: buildItems(bks) }).then(function () { return { enabled: true }; });
    });
  }

  // ---------- Face ID ロック ----------
  function setLock(on) {
    return call('setLock', { enabled: !!on }, 120000).then(function (r) { if (info) info.lock = !!r.enabled; return r; });
  }

  // ---------- 共有・印刷 ----------
  function share(text, title) { return call('share', { text: String(text || ''), title: String(title || '') }, 600000); }
  function printText(text, title) {
    var html = '<html><head><meta charset="utf-8"><style>body{font-family:-apple-system,"Hiragino Sans",sans-serif;font-size:11pt;line-height:1.75;color:#111;}h1{font-size:13pt;margin:0 0 10pt;}pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:inherit;margin:0;}</style></head><body>' +
      (title ? '<h1>' + esc(title) + '</h1>' : '') + '<pre>' + esc(text) + '</pre></body></html>';
    return call('printHtml', { html: html, title: String(title || 'FP Compass') }, 600000);
  }

  // ---------- 設定の画面 (アカウントのページに差し込む) ----------
  function mountSettings(host) {
    if (!host || host.querySelector('.fpn-box')) return;
    var st = document.createElement('style');
    st.textContent =
      '.fpn-box{background:#fff;border:1px solid #E6E8EC;border-radius:14px;overflow:hidden;font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;}' +
      '.fpn-row{display:flex;align-items:center;gap:14px;padding:16px 16px;border-top:1px solid #EEF0F3;min-height:64px;}' +
      '.fpn-row:first-child{border-top:0;}' +
      '.fpn-txt{flex:1;min-width:0;}' +
      '.fpn-name{font-size:15px;font-weight:700;color:#1F2430;line-height:1.4;}' +
      '.fpn-sub{font-size:12.5px;color:#6B7280;line-height:1.6;margin-top:2px;}' +
      '.fpn-sw{flex:0 0 auto;position:relative;width:52px;height:32px;border-radius:999px;border:0;background:#D5D9E0;cursor:pointer;transition:background .15s;padding:0;-webkit-tap-highlight-color:transparent;}' +
      '.fpn-sw::after{content:"";position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s;}' +
      '.fpn-sw[aria-checked="true"]{background:#4F46E5;}' +
      '.fpn-sw[aria-checked="true"]::after{transform:translateX(20px);}' +
      '.fpn-sw:disabled{opacity:.5;}' +
      '.fpn-hit{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-width:52px;min-height:44px;}' +
      '.fpn-msg{font-size:12.5px;color:#B45309;line-height:1.6;padding:0 16px 14px;}' +
      '.fpn-msg:empty{display:none;}' +
      '.fpn-ver{font-size:12px;color:#9AA1AD;padding:10px 4px 0;}';
    host.appendChild(st);
    var box = document.createElement('div');
    box.className = 'fpn-box';
    host.appendChild(box);
    var ver = document.createElement('div');
    ver.className = 'fpn-ver';
    host.appendChild(ver);

    function row(key, name, sub) {
      var r = document.createElement('div');
      r.className = 'fpn-row';
      r.innerHTML = '<div class="fpn-txt"><div class="fpn-name">' + esc(name) + '</div><div class="fpn-sub">' + esc(sub) + '</div></div>' +
        '<div class="fpn-hit"><button type="button" class="fpn-sw" role="switch" aria-checked="false" aria-label="' + esc(name) + '" data-fpn="' + key + '"></button></div>';
      box.appendChild(r);
      return r.querySelector('.fpn-sw');
    }
    var msg = document.createElement('div');
    msg.className = 'fpn-msg';
    msg.setAttribute('role', 'status');

    ready.then(function (r) {
      if (!r) {
        box.innerHTML = '<div class="fpn-row"><div class="fpn-txt"><div class="fpn-sub">アプリを最新版に更新すると、Face ID ロックと面談のお知らせが使えます。</div></div></div>';
        return;
      }
      var bioName = r.biometry === 'faceID' ? 'Face ID' : (r.biometry === 'touchID' ? 'Touch ID' : 'パスコード');
      var swLock = row('lock', bioName + ' でロック', 'アプリを開くときに ' + bioName + ' で本人確認します。');
      var swRem = row('rem', '面談のお知らせ', '面談の前日 18 時と 30 分前に通知します。お客さまの名前は表示しません。');
      box.appendChild(msg);
      ver.textContent = 'バージョン ' + (r.version || '') + (r.build ? ' (' + r.build + ')' : '');
      function paint() {
        swLock.setAttribute('aria-checked', info && info.lock ? 'true' : 'false');
        swRem.setAttribute('aria-checked', info && info.reminders && info.notifications === 'granted' ? 'true' : 'false');
      }
      paint();
      swLock.addEventListener('click', function () {
        var want = swLock.getAttribute('aria-checked') !== 'true';
        swLock.disabled = true; msg.textContent = '';
        setLock(want).then(function () { paint(); }, function (e) {
          msg.textContent = (e && e.message && /設定/.test(e.message)) ? e.message : 'ロックを切り替えられませんでした。';
        }).then(function () { swLock.disabled = false; });
      });
      swRem.addEventListener('click', function () {
        var want = swRem.getAttribute('aria-checked') !== 'true';
        swRem.disabled = true; msg.textContent = '';
        setRemindersEnabled(want).then(function (res) {
          if (res && res.denied) msg.textContent = '通知が許可されていません。iPhone の「設定」→「通知」→「ハカドル」で許可してください。';
          paint();
        }, function () { msg.textContent = 'お知らせを切り替えられませんでした。'; }).then(function () { swRem.disabled = false; });
      });
    });
  }

  window.FpNative = {
    ready: ready, call: call, info: function () { return info; },
    setLock: setLock, setRemindersEnabled: setRemindersEnabled, syncReminders: syncReminders,
    share: share, printText: printText, mountSettings: mountSettings,
    _buildItems: buildItems, _slotOf: slotOf
  };

  // 予定が読み込まれたら・画面に戻ったら、 通知を合わせ直す
  setTimeout(function () { syncReminders(false); }, 8000);
  setInterval(function () { if (!document.hidden) syncReminders(false); }, 120000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(function () { syncReminders(false); }, 3000); });
})();
