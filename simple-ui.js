/* simple-ui.js — FP Compass シンプル画面（サンドベージュ × スカーレット）
   ------------------------------------------------------------------
   やること: 「お客様を選ぶ → Zoomで面談 / 録音を上げる → 議事録がカードに入る」だけの画面。
   公式LINEまわり（メッセージ・タグ・配信・名寄せ）は、この画面には出さない（消してはいない）。
   ------------------------------------------------------------------
   この file が触るのは:
     - 自前の #fps-root / .fps-modal-bg / .fps-toast / #fps-switch だけ
     - 読むだけ: window.DUMMY_CLIENTS / window.LineAppLiveData / window.FP_ZOOM_PENDING / window.__fpJobs
     - 呼ぶ: startInstantZoom (Cloud Function) / startAsyncStorageUpload / getCustomerDetailApi / save-ai-result
     - 書く: tenants/{tid}/customers/{id} の 名前・ふりがな・生年月日・職業・メモ（お客様の追加と編集）
   切り替え: URL に ?simple=1 で ON、?simple=0 で OFF（localStorage 'fp-simple-ui'）。
             事務所の設定 tenants/{tid}.ui.simple === true なら、本人が OFF にしない限り ON。
   ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__fpsLoaded) return;
  window.__fpsLoaded = true;

  var LS_KEY = 'fp-simple-ui';
  var CLOUD_RUN = 'https://fp-compass-webhook-527726449426.asia-northeast1.run.app';
  var FS_URL = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
  var FN_URL = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js';

  /* ---------- 小道具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'object' && typeof v.toDate === 'function') { try { return v.toDate(); } catch (_) { return null; } }
    if (typeof v === 'number') return new Date(v);
    var s = String(v);
    var d = new Date(s);
    if (isNaN(d)) { d = new Date(s.replace(/-/g, '/')); }
    return isNaN(d) ? null : d;
  }
  function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function fmtDay(v) {
    var d = toDate(v); if (!d) return '';
    var now = new Date();
    if (sameDay(d, now)) return '今日';
    var y = d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/';
    return y + (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）';
  }
  function fmtDateTime(v) {
    var d = toDate(v); if (!d) return '';
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtTime(v) { var d = toDate(v); return d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''; }
  function plain(md) {
    return String(md || '')
      .replace(/^#{1,6}\s+.*$/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^[\s]*[-・•*●]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/[（(]\s*該当なし\s*[)）]/g, '')
      .replace(/\n{2,}/g, '\n').trim();
  }
  function firstSentences(text, max) {
    var t = plain(text).replace(/\n+/g, ' ');
    if (t.length <= max) return t;
    var cut = t.slice(0, max);
    var i = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('．'));
    return (i > max * 0.4 ? cut.slice(0, i + 1) : cut + '…');
  }
  function asArray(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.trim()) {
      try { var j = JSON.parse(v); if (Array.isArray(j)) return j.filter(Boolean); } catch (_) {}
      return v.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return [];
  }
  var ICON = {
    logo: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F02300" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
    video: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="13" height="12" rx="2.5"/><path d="M15 10.5l6-3.5v10l-6-3.5z"/></svg>',
    mic: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
    cal: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1D4A42" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    doc: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C41D00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M9 11h7M9 15h7"/></svg>',
    people: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2B2622" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.6c1.8.7 3 2.5 3.5 5.4"/></svg>',
    plus: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  /* 公式キャラクター（mascot/ の画像） */
  var MV = '?v=' + (window.FP_VER || '1');
  function M(name, size, cls) {
    return '<img class="fps-m' + (cls ? ' ' + cls : '') + '" src="mascot/' + name + '.png' + MV + '" alt="" width="' + size + '" style="width:' + size + 'px" onerror="this.remove()">';
  }
  function decorate(el) {
    if (!el) return;
    Array.prototype.forEach.call(el.querySelectorAll('.fps-loading'), function (n) {
      if (n.querySelector('.fps-load')) return;
      var w = n.getAttribute('data-small') ? 96 : 168;
      n.insertAdjacentHTML('afterbegin', '<img class="fps-load" src="mascot/loading.gif' + MV + '" alt="" width="' + w + '" style="width:' + w + 'px" onerror="this.remove()">');
    });
    [['.fps-empty', 'think', 78]].forEach(function (d) {
      Array.prototype.forEach.call(el.querySelectorAll(d[0]), function (n) {
        if (n.querySelector('.fps-m')) return;
        n.insertAdjacentHTML('afterbegin', M(n.getAttribute('data-face') || d[1], d[2], 'top'));
      });
    });
  }

  /* ---------- データ ---------- */
  function fp() { return window.__fp || {}; }
  function tenantId() { return fp().tenantId || (window.AccountInfo && window.AccountInfo.tenantId) || lsGet('fp-tenantId') || ''; }
  function clients() {
    return (Array.isArray(window.DUMMY_CLIENTS) ? window.DUMMY_CLIENTS : []).filter(function (c) { return c && String(c.name || '').trim(); });
  }
  function fsId(c) {
    if (!c) return '';
    if (c._fsCustomerId) return c._fsCustomerId;
    if (c.docId) return c.docId;
    var id = String(c.id || '');
    return id.indexOf('fs-') === 0 ? id.slice(3) : id;
  }
  function findClient(key) {
    var list = clients();
    for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(key) || fsId(list[i]) === String(key)) return list[i]; }
    return null;
  }
  function idsOf(c) {
    var o = {};
    [c.id, fsId(c), c.lineFriendId, c._fsCustomerId].forEach(function (v) { if (v) { o[String(v)] = 1; o['fs-' + String(v)] = 1; } });
    return o;
  }
  function belongs(r, c, ids) {
    if (!r || r.deleted === true) return false;
    ids = ids || idsOf(c);
    if (r.userId && ids[String(r.userId)]) return true;
    if (r.customerId && ids[String(r.customerId)]) return true;
    return !!(r.customerName && String(r.customerName).trim() === String(c.name).trim());
  }
  function mTime(r) { return toDate(r.ts || r.createdAt || r.date || r.zoomStartTime); }
  function mKey(r) { return String(r.bookingTs || r._fsMeetingDocId || r.zoomMeetingId || r.ts || r.createdAt || ''); }
  function mTitle(r) {
    var t = String(r.title || r.zoomTopic || '').trim();
    if (t && !/^(zoom|quick|instant)/i.test(t) && t.length < 60) return t;
    var kc = asArray(r.key_concerns);
    if (kc.length) return String(kc[0]).replace(/^[・\-\s]+/, '').slice(0, 40);
        return '面談の記録';
  }
  function mGist(r, max) {
    var src = String(r.transcript_summary || r.summary || '');
    // 最初の見出しの中身だけを「ひとこと」に使う（ほかの見出しの箇条書きを混ぜない）
    var parts = src.split(/^#{1,4}\s+.*$/m).map(function (x) { return x.trim(); }).filter(Boolean);
    var g = firstSentences(parts.length ? parts[0] : src, max || 110);
    return g || (r.transcript ? firstSentences(r.transcript, max || 110) : '');
  }
  function mKind(r) {
    var s = String(r.source || '');
    if (/manual|手入力/.test(s)) return '手入力';
    if (/upload|mobile|inperson|voice|transcript/.test(s) || /^upload-/.test(String(r.bookingTs || ''))) return '録音';
    return 'Zoom';
  }
  function mTasks(r) {
    var t = asArray(r.tasks).map(function (x) { return typeof x === 'string' ? x : (x.task || x.title || ''); }).filter(Boolean);
    if (!t.length) {
      var live = window.LineAppLiveData || {};
      t = (live.ai_tasks || []).filter(function (x) { return (x.bookingTs || '') === (r.bookingTs || '_'); })
        .map(function (x) { return x.task || x.title || ''; }).filter(Boolean);
    }
    return t;
  }
  function liveMinutes() {
    var live = window.LineAppLiveData || {};
    return (Array.isArray(live.ai_results) ? live.ai_results : []).filter(function (r) { return r && r.deleted !== true && (r.summary || r.transcript_summary || r.transcript || r._transcriptStripped); });
  }
  function byTimeDesc(a, b) { return (mTime(b) ? mTime(b).getTime() : 0) - (mTime(a) ? mTime(a).getTime() : 0); }
  function clientOfMinute(r) {
    var list = clients();
    for (var i = 0; i < list.length; i++) { if (belongs(r, list[i])) return list[i]; }
    return null;
  }
  function lastMeetingOf(c) {
    var ids = idsOf(c), best = null;
    liveMinutes().forEach(function (r) { if (belongs(r, c, ids)) { var d = mTime(r); if (d && (!best || d > best)) best = d; } });
    (cache[fsId(c)] || []).forEach(function (r) { var d = mTime(r); if (d && (!best || d > best)) best = d; });
    return best || toDate(c.lastContact);
  }
  function nextSlotOf(c) {
    var d = toDate(c.confirmedSlot);
    return d && d.getTime() > Date.now() - 3 * 3600 * 1000 ? d : null;
  }
  function pendingList() {
    var out = [];
    (Array.isArray(window.FP_ZOOM_PENDING) ? window.FP_ZOOM_PENDING : []).forEach(function (p) {
      out.push({ name: p.name || '', customerId: p.customerId || '', at: p.startTime || p.updatedAt, kind: 'Zoom' });
    });
    try {
      var jc = window.__fpJobs && window.__fpJobs.jobsCache;
      if (jc && typeof jc.forEach === 'function') {
        jc.forEach(function (arr, cid) {
          (arr || []).forEach(function (j) {
            if (j.status === 'done' || /fail/.test(String(j.status || ''))) return;
            if (j.updatedAt && Date.now() - j.updatedAt > 6 * 3600 * 1000) return;
            var c = findClient(cid);
            out.push({ name: c ? c.name : (j.customerName || ''), customerId: cid, at: j.updatedAt, kind: '録音' });
          });
        });
      }
    } catch (_) {}
    return out;
  }

  /* お客様ごとの議事録（くわしい版）を取りにいく */
  var cache = {};        // fsId -> minutes[]
  var loading = {};      // fsId -> Promise
  var api = {
    detail: async function (c) {
      if (typeof window.getCustomerDetailApi !== 'function') return [];
      var h = window.getFpAuthHeaders ? await window.getFpAuthHeaders() : { 'Content-Type': 'application/json' };
      var ctl = new AbortController(); var t = setTimeout(function () { ctl.abort(); }, 30000);
      try {
        var r = await fetch(window.getCustomerDetailApi(fsId(c)), { headers: h, signal: ctl.signal });
        if (!r.ok) return [];
        var d = await r.json();
        return Array.isArray(d.ai_results) ? d.ai_results.filter(function (a) { return a && a.deleted !== true; }) : [];
      } catch (_) { return []; } finally { clearTimeout(t); }
    },
    fsMeetings: async function (c) {
      var tid = tenantId(), cid = fsId(c);
      if (!tid || !cid || !fp().db) return [];
      try {
        var fs = await import(FS_URL);
        var snap = await fs.getDocs(fs.collection(fp().db, 'tenants/' + tid + '/customers/' + cid + '/meetings'));
        return snap.docs.map(function (d) {
          var md = d.data() || {};
          var start = md.zoomStartTime || (md.createdAt && md.createdAt.toDate ? md.createdAt.toDate().toISOString() : '');
          return {
            userId: cid, customerId: cid, customerName: c.name || '',
            bookingTs: md.bookingTs || start || ('fs-' + d.id), ts: md.ts || start, createdAt: md.ts || start,
            transcript: md.transcript || '', summary: md.summary || '', transcript_summary: md.transcript_summary || '',
            key_concerns: md.key_concerns || [], tasks: md.tasks || [], next_meeting_suggestion: md.next_meeting_suggestion || '',
            zoomMeetingId: String(md.zoomMeetingId || ''), zoomTopic: md.zoomTopic || '', zoomDurationMin: md.zoomDurationMin || null,
            title: md.title || '', source: md.source || 'firestore-meetings', deleted: md.deleted === true, _fsMeetingDocId: d.id
          };
        }).filter(function (r) { return !r.deleted; });
      } catch (e) { console.warn('[fps] meetings read fail:', e && e.message); return []; }
    },
    call: async function (name, data) {
      var f = await import(FN_URL);
      var fns = fp().functions || f.getFunctions(fp().auth.app, 'asia-northeast1');
      var res = await f.httpsCallable(fns, name, { timeout: 120000 })(data);
      return (res && res.data) || {};
    },
    saveCustomer: async function (id, patch, isNew) {
      var tid = tenantId(); if (!tid || !fp().db) throw new Error('ログインの状態を確認できませんでした');
      var fs = await import(FS_URL);
      var data = Object.assign({}, patch, { updatedAt: fs.serverTimestamp() });
      if (isNew) {
        data.source = 'manual'; data.status = 'new'; data.lineFriendId = ''; data.lineSubscribed = false; data.createdAt = fs.serverTimestamp();
        var ref = await fs.addDoc(fs.collection(fp().db, 'tenants', tid, 'customers'), data);
        return ref.id;
      }
      await fs.setDoc(fs.doc(fp().db, 'tenants', tid, 'customers', id), data, { merge: true });
      return id;
    },
    getCustomer: async function (id) {
      var tid = tenantId(); if (!tid || !id || !fp().db) return null;
      try {
        var fs = await import(FS_URL);
        var d = await fs.getDoc(fs.doc(fp().db, 'tenants', tid, 'customers', id));
        return d.exists() ? d.data() : null;
      } catch (e) { console.warn('[fps] customer read fail:', e && e.message); return null; }
    },
    saveSummary: async function (entry) {
      var h = window.getFpAuthHeaders ? await window.getFpAuthHeaders() : { 'Content-Type': 'application/json' };
      var res = await fetch(CLOUD_RUN + '/api/save-ai-result', { method: 'POST', headers: h, body: JSON.stringify({ entry: entry, tasks: [] }) });
      var d = await res.json().catch(function () { return {}; });
      if (!res.ok || d.ok === false) throw new Error(d.error || ('保存できませんでした（' + res.status + '）'));
      return d;
    },
    tenantFlag: async function () {
      var tid = tenantId(); if (!tid || !fp().db) return null;
      try {
        var fs = await import(FS_URL);
        var s = await fs.getDoc(fs.doc(fp().db, 'tenants', tid));
        var d = s.exists() ? s.data() : {};
        return { simple: !!(d.ui && d.ui.simple === true), name: d.name || d.officeName || d.companyName || '' };
      } catch (_) { return null; }
    }
  };
  if (window.FPS_API_OVERRIDE) Object.assign(api, window.FPS_API_OVERRIDE);   // テスト用

  function mergeMinutes(lists) {
    var out = [], seen = {};
    lists.forEach(function (list) {
      (list || []).forEach(function (r) {
        var keys = [r.zoomMeetingId ? 'z:' + r.zoomMeetingId : '', r.bookingTs ? 'b:' + r.bookingTs : ''].filter(Boolean);
        var hit = -1;
        keys.forEach(function (k) { if (hit < 0 && seen[k] != null) hit = seen[k]; });
        if (hit >= 0) {
          var ex = out[hit];
          var a = String(ex.transcript || '').length + String(ex.summary || '').length;
          var b = String(r.transcript || '').length + String(r.summary || '').length;
          out[hit] = b > a ? Object.assign({}, ex, r) : Object.assign({}, r, ex);
        } else { hit = out.push(r) - 1; }
        keys.forEach(function (k) { seen[k] = hit; });
      });
    });
    return out.filter(function (r) { return r.summary || r.transcript || r.transcript_summary; }).sort(byTimeDesc);
  }
  function loadMinutes(c, force) {
    var id = fsId(c);
    if (!id) return Promise.resolve([]);
    if (loading[id] && !force) return loading[id];
    var ids = idsOf(c);
    var fromLive = liveMinutes().filter(function (r) { return belongs(r, c, ids); });
    loading[id] = Promise.all([api.detail(c), api.fsMeetings(c)]).then(function (res) {
      cache[id] = mergeMinutes([res[0].filter(function (r) { return belongs(r, c, ids) || !r.customerName; }), res[1], fromLive]);
      return cache[id];
    }).catch(function () { cache[id] = mergeMinutes([fromLive]); return cache[id]; });
    return loading[id];
  }
  function minutesOf(c) {
    var id = fsId(c);
    if (cache[id]) return cache[id];
    var ids = idsOf(c);
    return mergeMinutes([liveMinutes().filter(function (r) { return belongs(r, c, ids); })]);
  }

  /* ---------- 画面の状態 ---------- */
  var st = { view: 'home', cid: '', mid: '', q: '', mq: '', tab: 'minutes', office: '', showTranscript: false };
  var root = null, mounted = false;

  function parseHash() {
    var m = String(location.hash || '').match(/^#s\/([a-z]+)(?:\/([^/]+))?(?:\/(.+))?$/);
    if (!m) return null;
    return { view: m[1], cid: m[2] ? decodeURIComponent(m[2]) : '', mid: m[3] ? decodeURIComponent(m[3]) : '' };
  }
  function go(view, cid, mid) {
    var h = '#s/' + view + (cid ? '/' + encodeURIComponent(cid) : '') + (mid ? '/' + encodeURIComponent(mid) : '');
    if (location.hash === h) { applyHash(); return; }
    location.hash = h;
  }
  function applyHash() {
    var p = parseHash() || { view: 'home', cid: '', mid: '' };
    var prevCid = st.view === 'customer' || st.view === 'minute' ? st.cid : '';
    st.view = p.view; st.cid = p.cid; st.mid = p.mid; st.showTranscript = false;
    if (st.view === 'customer' && (['minutes', 'todo', 'contracts', 'life', 'data', 'hub'].indexOf(st.tab) < 0 || p.cid !== prevCid)) st.tab = isPhone() ? 'hub' : 'minutes';
    render();
    if (root) root.scrollTop = 0;
  }

  /* ---------- 部品 ---------- */
  function avatar(c, size, font) {
    var pic = c && (c.linePictureUrl || c.pictureUrl);
    var ch = esc(String((c && c.name) || '?').trim().charAt(0));
    return '<span class="fps-avatar" style="width:' + size + 'px;height:' + size + 'px;font-size:' + font + 'px">' +
      (pic ? '<img src="' + esc(pic) + '" alt="" onerror="this.remove()">' : '') + (pic ? '' : ch) + '</span>';
  }
  function toast(msg, ms) {
    var old = $('.fps-toast'); if (old) old.remove();
    var t = document.createElement('div'); t.className = 'fps-toast'; t.id = 'fps-toast'; t.setAttribute('role', 'status'); t.innerHTML = M(/できません|すぎ|入れてください|準備中/.test(msg) ? 'oh' : 'smile', 34) + '<span>' + esc(msg) + '</span>';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3200);
  }
  function modal(html, onMount, face) {
    closeModal();
    var bg = document.createElement('div'); bg.className = 'fps-modal-bg'; bg.id = 'fps-modal-root';
    bg.innerHTML = '<div class="fps-modal' + (face ? ' has-m' : '') + '" role="dialog" aria-modal="true">' + (face ? M(face, 84, 'modal-m') : '') + html + '</div>';
    decorate(bg);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) closeModal(); });
    document.body.appendChild(bg);
    document.addEventListener('keydown', escClose);
    if (onMount) onMount(bg.firstChild);
    var f = bg.querySelector('input,textarea,button'); if (f) try { f.focus(); } catch (_) {}
    return bg.firstChild;
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    var m = $('.fps-modal-bg'); if (m) m.remove();
    document.removeEventListener('keydown', escClose);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    try {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (_) { return false; }
  }

  /* 議事録の本文。見出しの言葉から種類を見分けて、種類ごとに見た目を変える */
  var SEC_ICON = {
    note: '<path d="M6 3h9l4 4v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M9 11h7M9 15h5"/>',
    done: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    worry: '<path d="M12 3l9.5 16.5h-19z"/><path d="M12 10v4M12 17v.5"/>',
    next: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    info: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.500 7 5.5"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M9 8l3 4 3-4M12 12v5M9.500 13h5M9.500 15.500h5"/>'
  };
  function secKind(h) {
    h = String(h || '');
    if (/次回|次に|宿題|アクション|やること|TODO|フォロー|今後|対応/i.test(h)) return 'next';
    if (/決ま|合意|結論|決定|方針|提案/.test(h)) return 'done';
    if (/気にな|懸念|不安|課題|悩み|リスク|関心|ニーズ|要望|希望/.test(h)) return 'worry';
    if (/資産|収入|支出|家計|保険|ローン|貯蓄|投資|年金|お金|費用/.test(h)) return 'money';
    if (/家族|プロフィール|情報|現状|状況|ライフ|イベント|背景/.test(h)) return 'info';
    return 'note';
  }
  function renderSummary(text) {
    var raw = String(text || '').replace(/^##\s+[^\n]+\n\s*[（(]?\s*該当なし\s*[)）]?\s*(?=\n##|\n*$)/gim, '').trim();
    if (!raw) return '<p class="fps-sub">まだ議事録の本文がありません。</p>';
    var inl = function (x) { return esc(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); };
    var secs = [], cur = null;
    raw.split(/\n/).forEach(function (line) {
      var l = line.trim(); if (!l) return;
      var h = l.match(/^#{1,4}\s+(.+)$/) || l.match(/^【(.+?)】$/) || l.match(/^■\s*(.+)$/);
      if (h) { cur = { h: h[1].replace(/[:：]$/, ''), items: [] }; secs.push(cur); return; }
      if (!cur) { cur = { h: '', items: [] }; secs.push(cur); }
      var b = l.match(/^(?:[-・•*●▪]|\d+[.)．]|[①-⑳])\s*(.+)$/);
      cur.items.push(b ? { li: b[1] } : { p: l });
    });
    return '<div class="fps-secs">' + secs.filter(function (x) { return x.items.length; }).map(function (sec, si) {
      var kind = sec.h ? secKind(sec.h) : 'note', n = 0;
      var lis = sec.items.filter(function (x) { return x.li; }).length;
      var rows = sec.items.map(function (it) {
        if (it.p) return '<p>' + inl(it.p) + '</p>';
        n++;
        var kv = it.li.match(/^(?:\*\*)?([^：:*]{1,16}?)(?:\*\*)?[：:]\s*(.+)$/);
        var mark = kind === 'next' ? '<i class="num">' + n + '</i>' : kind === 'done' ? '<i><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.500 4.500L19 7.500"/></svg></i>' : '<i></i>';
        return '<div class="fps-item' + (kv ? ' kv' : '') + '">' + mark + (kv ? '<span class="k">' + inl(kv[1]) + '</span><span class="v">' + inl(kv[2]) + '</span>' : '<span class="v">' + inl(it.li) + '</span>') + '</div>';
      }).join('');
      var wide = si === 0 || kind === 'note' && lis === 0 || sec.items.length > 6;
      return '<section class="fps-sec2 k-' + kind + (wide ? ' wide' : '') + '">' +
        (sec.h ? '<h3><span class="fps-sec-ic"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + SEC_ICON[kind].replace(/(\d)\.500/g, '$1.5') + '</svg></span>' + inl(sec.h) + (lis > 1 ? '<small class="num">' + lis + '</small>' : '') + '</h3>' : '') +
        '<div class="fps-sec-body">' + rows + '</div></section>';
    }).join('') + '</div>';
  }

  /* ---------- 画面 ---------- */
  function header() {
    var u = fp().auth && fp().auth.currentUser;
    var who = (st.office ? st.office + '　' : '') + ((u && (u.displayName || u.email)) || '');
    var nav = [['home', 'ホーム'], ['customers', 'お客様'], ['minutes', '議事録']].map(function (n) {
      var on = st.view === n[0] || (n[0] === 'customers' && st.view === 'customer') || (n[0] === 'minutes' && st.view === 'minute');
      return '<button type="button" data-go="' + n[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + n[1] + '</button>';
    }).join('');
    return '<header class="fps-head">' +
      '<button type="button" class="fps-logo" data-go="home"><i>' + M('smile', 30) + '</i>FP Compass</button>' +
      '<nav class="fps-nav" aria-label="メニュー">' + nav + '</nav>' +
      '<div class="fps-head-right">' +
        '<button type="button" class="fps-menu-btn" id="fps-menu-btn" aria-haspopup="true">' + esc(who || 'メニュー') + ' ▾</button>' +
        '<div class="fps-menu" id="fps-menu">' +
          '<button type="button" data-act="account">アカウントの設定</button>' +
          '<button type="button" data-act="manual">使い方</button>' +
          '<button type="button" data-act="classic">前の画面に切り替える</button>' +
          '<button type="button" data-act="logout">ログアウト</button>' +
        '</div>' +
      '</div></header>';
  }

  function minuteRow(r, c, withName) {
    var d = mTime(r);
    var key = mKey(r);
    return '<tr class="click" data-open-minute="' + esc(c ? fsId(c) : '') + '" data-mid="' + esc(key) + '">' +
      '<td class="num" style="width:150px">' + esc(d ? fmtDay(d) + ' ' + fmtTime(d) : '') +
        '<span style="display:block;font-size:12px" class="fps-sub">' + esc(mKind(r)) + (r.zoomDurationMin ? ' ・ ' + esc(r.zoomDurationMin) + '分' : '') + '</span></td>' +
      '<td>' + (withName ? '<b>' + esc(c ? c.name : (r.customerName || '')) + ' 様</b>　' : '') + '<b>' + esc(mTitle(r)) + '</b>' +
        '<span class="lead">' + esc(mGist(r, 90)) + '</span></td>' +
      '<td style="width:96px"><span class="fps-chip ok">できました</span></td></tr>';
  }
  function minuteCard(r, c) {
    var d = mTime(r), tasks = mTasks(r);
    var kc = asArray(r.key_concerns).map(function (x) { return typeof x === 'string' ? x : (x.text || x.title || ''); }).filter(Boolean).slice(0, 3);
    return '<li class="fps-tl-item"><button type="button" class="fps-tl-card" data-open-minute="' + esc(fsId(c)) + '" data-mid="' + esc(mKey(r)) + '">' +
      '<span class="fps-tl-date num">' + (d ? '<b>' + (d.getMonth() + 1) + '/' + d.getDate() + '</b><small>' + WD[d.getDay()] + '曜 ' + fmtTime(d) + '</small>' : '<b>—</b>') + '</span>' +
      '<span class="fps-tl-body">' +
        '<span class="fps-tl-meta"><span class="fps-chip plain">' + esc(mKind(r)) + '</span>' + (r.zoomDurationMin ? '<span class="fps-chip plain num">' + esc(r.zoomDurationMin) + '分</span>' : '') +
          (tasks.length ? '<span class="fps-chip ok">やること ' + tasks.length + '件</span>' : '') + '</span>' +
        '<b class="fps-tl-title">' + esc(mTitle(r)) + '</b>' +
        '<span class="fps-tl-gist">' + esc(mGist(r, 130)) + '</span>' +
        (kc.length ? '<span class="fps-tl-kc">' + kc.map(function (x) { return '<span>' + esc(String(x).slice(0, 24)) + '</span>'; }).join('') + '</span>' : '') +
      '</span><span class="fps-tl-go" aria-hidden="true">ひらく ›</span></button></li>';
  }
  function pendingRow(p) {
    return '<tr><td class="num" style="width:150px">' + esc(p.at ? fmtDay(p.at) + ' ' + fmtTime(p.at) : '') +
      '<span style="display:block;font-size:12px" class="fps-sub">' + esc(p.kind) + '</span></td>' +
      '<td><b>' + esc(p.name || 'お客様') + ' 様</b><span class="lead">いま議事録を作っています。できたら、ここに出ます。</span></td>' +
      '<td style="width:96px"><span class="fps-chip wait">' + M('laptop', 24) + '作成中</span></td></tr>';
  }

  var mountedAt = 0;
  function booting() { return Date.now() - mountedAt < 9000 && !clients().length && !liveMinutes().length; }
  function bootView() { return '<div class="fps-wrap"><div class="fps-panel fps-loading" style="padding:70px 16px">お客様と議事録を読み込んでいます…</div></div>'; }
  function viewHome() {
    if (booting()) return bootView();
    var list = clients(), now = new Date();
    var today = list.map(function (c) { return { c: c, at: nextSlotOf(c) }; }).filter(function (x) { return x.at && sameDay(x.at, now); })
      .sort(function (a, b) { return a.at - b.at; });
    var pend = pendingList();
    var recent = liveMinutes().slice().sort(byTimeDesc).slice(0, 6);
    var u = fp().auth && fp().auth.currentUser;
    var hello = (u && u.displayName) ? 'こんにちは、' + esc(u.displayName.split(/\s+/)[0]) + 'さん' : 'ホーム';

    var todayHtml = today.length ? today.map(function (x) {
      return '<div style="display:flex;gap:16px;align-items:stretch;margin-top:12px">' +
        '<span class="num" style="width:56px;font-size:18px;font-weight:700;color:var(--fps-red-text);padding-top:14px">' + fmtTime(x.at) + '</span>' +
        '<div style="flex:1;background:var(--fps-soft);border-radius:12px;padding:14px 16px">' +
          '<a data-open-client="' + esc(fsId(x.c)) + '" style="font-size:16px;font-weight:800;color:var(--fps-ink)">' + esc(x.c.name) + ' 様</a>' +
          (x.c.zoomUrl ? '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
            '<a class="fps-btn is-main is-sm" href="' + esc(x.c.hostZoomUrl || x.c.zoomUrl) + '" target="_blank" rel="noopener">Zoomを開く</a>' +
            '<button type="button" class="fps-btn is-quiet is-sm" data-copy="' + esc(x.c.zoomUrl) + '">URLをコピー</button></div>' : '') +
        '</div></div>';
    }).join('') : '<div class="fps-empty" data-face="sleep">今日の面談の予定はありません。<br>「Zoomで面談」から、すぐに始められます。</div>';

    var rows = pend.map(pendingRow).join('') + recent.map(function (r) { return minuteRow(r, clientOfMinute(r), true); }).join('');

    return '<div class="fps-wrap">' +
      '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
        M('kira', 92, 'hello') + '<div style="flex:1;min-width:200px"><p class="fps-eyebrow num">' + now.getFullYear() + '.' + pad(now.getMonth() + 1) + '.' + pad(now.getDate()) + '（' + WD[now.getDay()] + '）</p>' +
          '<h1 class="fps-title">' + hello + '</h1></div>' +
        '<button type="button" class="fps-btn" data-act="upload">' + ICON.mic + '録音から議事録を作る</button>' +
        '<button type="button" class="fps-btn is-main with-m" data-act="zoom">' + M('wink', 58, 'peek') + ICON.video + 'Zoomで面談</button>' +
      '</div>' +
      '<div class="fps-stats">' +
        '<div class="fps-panel fps-stat"><i>' + M('ic-cal', 60) + '</i><span><span class="fps-sub" style="display:block;font-size:13px;font-weight:700">今日の面談</span><b class="num">' + today.length + '</b><span style="font-size:13px;margin-left:3px">件</span></span></div>' +
        '<div class="fps-panel fps-stat"><i>' + M('ic-doc', 60) + '</i><span><span class="fps-sub" style="display:block;font-size:13px;font-weight:700">議事録を作成中</span><b class="num"' + (pend.length ? ' style="color:var(--fps-red-text)"' : '') + '>' + pend.length + '</b><span style="font-size:13px;margin-left:3px">件</span></span></div>' +
        '<button type="button" class="fps-panel fps-stat" data-go="customers" style="border:none;text-align:left;color:inherit"><i>' + M('ic-people', 60) + '</i><span><span class="fps-sub" style="display:block;font-size:13px;font-weight:700">お客様</span><b class="num">' + list.length + '</b><span style="font-size:13px;margin-left:3px">名</span></span></button>' +
      '</div>' +
      '<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start">' +
        '<section class="fps-panel" style="flex:1 1 340px;min-width:0;padding:24px 26px"><h2 class="fps-h">今日の予定' + M('smile', 44, 'h-m') + '</h2>' + todayHtml + '</section>' +
        '<section class="fps-panel" style="flex:999 1 520px;min-width:0;padding:24px 26px"><h2 class="fps-h">最近の議事録<small><a data-go="minutes">すべて見る ›</a></small></h2>' +
          (rows ? '<div class="fps-table-wrap"><table class="fps-table"><tbody>' + rows + '</tbody></table></div>'
                : '<div class="fps-empty">まだ議事録がありません。<br>Zoomで面談するか、録音をアップロードすると、ここに出ます。</div>') +
        '</section>' +
      '</div></div>';
  }

  function viewCustomers() {
    if (booting()) return bootView();
    var q = st.q.trim().toLowerCase();
    var list = clients().map(function (c) { return { c: c, last: lastMeetingOf(c), next: nextSlotOf(c) }; })
      .filter(function (x) { return !q || String(x.c.name).toLowerCase().indexOf(q) >= 0 || String(x.c.kana || '').toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (b.last ? b.last.getTime() : 0) - (a.last ? a.last.getTime() : 0) || String(a.c.name).localeCompare(String(b.c.name), 'ja'); });
    var rows = list.map(function (x) {
      return '<tr class="click" data-open-client="' + esc(fsId(x.c)) + '">' +
        '<td style="width:60px">' + avatar(x.c, 42, 17) + '</td>' +
        '<td><b style="font-size:16px">' + esc(x.c.name) + '</b>' + (x.c.kana ? '<span class="lead" style="font-size:12px">' + esc(x.c.kana) + '</span>' : '') + '</td>' +
        '<td class="num">' + (x.next ? '<span class="fps-chip ok">次回 ' + esc(fmtDay(x.next) + ' ' + fmtTime(x.next)) + '</span>' : (x.last ? '<span class="fps-sub">前回 ' + esc(fmtDay(x.last)) + '</span>' : '<span class="fps-chip plain">まだ面談していません</span>')) + '</td>' +
        '<td style="width:40px;text-align:right;color:var(--fps-sub);font-size:20px" aria-hidden="true">›</td></tr>';
    }).join('');
    return '<div class="fps-wrap"><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        M('smile', 64, 'hello') + '<h1 class="fps-title" style="flex:1;min-width:120px">お客様 <span class="num fps-sub" style="font-size:16px;font-weight:700">' + clients().length + '名</span></h1>' +
        '<label style="flex:1 1 240px;max-width:360px"><span style="position:absolute;width:1px;height:1px;overflow:hidden">名前でさがす</span>' +
          '<input id="fps-q" class="fps-input" type="search" placeholder="名前でさがす" value="' + esc(st.q) + '"></label>' +
        '<button type="button" class="fps-btn is-main" data-act="new-client">' + ICON.plus + '新しいお客様</button>' +
      '</div>' +
      '<section class="fps-panel" style="padding:10px 18px 14px">' +
        (rows ? '<div class="fps-table-wrap"><table class="fps-table" style="min-width:480px"><tbody id="fps-clist">' + rows + '</tbody></table></div>'
              : '<div class="fps-empty">' + (q ? '「' + esc(st.q) + '」に当てはまるお客様がいません。' : 'まだお客様がいません。<br>「新しいお客様」から登録できます。') + '</div>') +
      '</section></div>';
  }

  /* 契約（買ってもらった保険など）: tenants/{tid}/customers/{id}.contracts に入れる */
  var contractsCache = {};   // fsId -> [] （読み込み前は undefined）
  function loadContracts(c) {
    var id = fsId(c);
    if (contractsCache[id] || loading['c:' + id]) return;
    loading['c:' + id] = api.getCustomer(id).then(function (d) {
      contractsCache[id] = (d && Array.isArray(d.contracts) ? d.contracts : []).filter(Boolean);
      if (st.view === 'customer' && st.cid === id && !$('.fps-modal-bg')) render();
    });
  }
  function yen(v) { var n = Number(String(v || '').replace(/[^0-9.]/g, '')); return n ? n.toLocaleString('ja-JP') + '円' : ''; }
  function contractsHtml(c) {
    var list = contractsCache[fsId(c)];
    if (!list) return '<div class="fps-loading">契約を読み込んでいます…</div>';
    var sorted = list.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    return banner('heart', '買っていただいた商品', '保険などを、商品名と契約した日でのこせます。', '<button type="button" class="fps-btn is-main is-sm" data-act="new-contract">' + ICON.plus + '契約を足す</button>') +
      (sorted.length ? '<div class="fps-contracts">' + sorted.map(function (k) {
        var d = toDate(k.date);
        return '<button type="button" class="fps-contract" data-contract="' + esc(k.id) + '">' +
          '<span class="fps-contract-date num">' + (d ? '<small>' + d.getFullYear() + '年</small><b>' + (d.getMonth() + 1) + '/' + d.getDate() + '</b>' : '<b>—</b>') + '</span>' +
          '<span class="fps-contract-body"><b>' + esc(k.product || '（商品名なし）') + '</b>' +
            '<span class="fps-sub">' + esc([k.company, k.kind].filter(Boolean).join(' ・ ')) + '</span>' +
            (k.note ? '<span class="fps-sub" style="font-size:13px">' + esc(k.note) + '</span>' : '') + '</span>' +
          '<span class="fps-contract-fee num">' + (yen(k.premium) ? '<b>' + yen(k.premium) + '</b><small>' + esc(k.cycle || '月払い') + '</small>' : '') + '</span>' +
          '<span class="fps-tl-go" aria-hidden="true">直す ›</span></button>';
      }).join('') + '</div>' : '<div class="fps-empty" data-face="read">まだ契約の記録がありません。<br>「契約を足す」から入れられます。</div>');
  }
  function contractForm(c, k) {
    var isNew = !k; k = k || { date: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), cycle: '月払い' };
    var f = function (id, label, val, ph, type) {
      return '<label class="fps-field"><span>' + label + '</span><input class="fps-input" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '" autocomplete="off"' + (type === 'number' ? ' inputmode="numeric"' : '') + '></label>';
    };
    var sel = function (id, label, val, opts) {
      return '<label class="fps-field"><span>' + label + '</span><select class="fps-input" id="' + id + '">' + opts.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></label>';
    };
    modal('<h2>' + (isNew ? '契約を足す' : '契約を直す') + '</h2><p>' + esc(c.name) + ' 様が買ってくださったものを書きます。商品名と日付だけでも大丈夫です。</p>' +
      f('fps-k-product', '商品名', k.product, '例：終身医療保険 ○○') + f('fps-k-company', '保険会社', k.company, '例：○○生命') +
      sel('fps-k-kind', '種類', k.kind || '', ['', '医療保険', 'がん保険', '死亡保険', '学資保険', '個人年金', '変額保険', '火災・地震保険', '自動車保険', '投資信託・NISA', 'iDeCo', 'そのほか']) +
      f('fps-k-date', '契約した日', k.date, '', 'date') +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) 130px;gap:10px">' + f('fps-k-premium', '保険料（円）', k.premium, '例：8500', 'number') + sel('fps-k-cycle', '払い方', k.cycle || '月払い', ['月払い', '年払い', '一括']) + '</div>' +
      '<label class="fps-field"><span>メモ</span><textarea class="fps-input" id="fps-k-note" style="min-height:80px" placeholder="証券番号の下4けた、特約、見直しの時期など">' + esc(k.note || '') + '</textarea></label>' +
      '<div class="fps-actions">' + (isNew ? '' : '<button type="button" class="fps-btn is-quiet" id="fps-k-del" style="margin-right:auto">この契約を消す</button>') +
        '<button type="button" class="fps-btn is-quiet" data-close>やめる</button><button type="button" class="fps-btn is-main" id="fps-k-save">' + (isNew ? '足す' : '保存する') + '</button></div>', function (el) {
      var id = fsId(c);
      var write = async function (next, btn, label, done) {
        btn.disabled = true; btn.textContent = '保存しています…';
        try { await api.saveCustomer(id, { contracts: next }, false); contractsCache[id] = next; closeModal(); toast(done); render(); }
        catch (err) { btn.disabled = false; btn.textContent = label; toast('保存できませんでした：' + (err.message || err), 5000); }
      };
      $('[data-close]', el).addEventListener('click', closeModal);
      $('#fps-k-save', el).addEventListener('click', function () {
        var v = { id: k.id || ('k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), product: $('#fps-k-product', el).value.trim(), company: $('#fps-k-company', el).value.trim(),
          kind: $('#fps-k-kind', el).value, date: $('#fps-k-date', el).value, premium: $('#fps-k-premium', el).value.trim(), cycle: $('#fps-k-cycle', el).value, note: $('#fps-k-note', el).value.trim() };
        if (!v.product) { toast('商品名を入れてください'); $('#fps-k-product', el).focus(); return; }
        var cur = (contractsCache[id] || []).filter(function (x) { return x.id !== v.id; });
        write(cur.concat([v]), this, isNew ? '足す' : '保存する', isNew ? '契約を足しました' : '保存しました');
      });
      var del = $('#fps-k-del', el);
      if (del) del.addEventListener('click', function () {
        if (!this.dataset.sure) { this.dataset.sure = '1'; this.textContent = 'もう一度押すと消えます'; this.style.color = 'var(--fps-red-text)'; this.style.borderColor = 'var(--fps-red)'; return; }
        write((contractsCache[id] || []).filter(function (x) { return x.id !== k.id; }), this, 'この契約を消す', '契約を消しました');
      });
    }, 'heart');
  }

  /* 手で書く議事録（録音がないとき） */
  function manualMinuteForm(c) {
    var today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    modal('<h2>メモから議事録を書く</h2><p>録音がないときは、ここに ' + esc(c.name) + ' 様との話を書いてのこせます。</p>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) 130px;gap:10px"><label class="fps-field"><span>面談した日</span><input class="fps-input" id="fps-n-date" type="date" value="' + today + '"></label>' +
      '<label class="fps-field"><span>時刻</span><input class="fps-input" id="fps-n-time" type="time" value="10:00"></label></div>' +
      '<label class="fps-field"><span>題名</span><input class="fps-input" id="fps-n-title" placeholder="例：医療保険の見直し" autocomplete="off"></label>' +
      '<label class="fps-field"><span>話した内容</span><textarea class="fps-input" id="fps-n-body" style="min-height:200px" placeholder="例：\n・いまの医療保険は入院1日5,000円。先進医療の特約なし\n・上のお子さんが来年小学校。教育費が気になっている\n・次回までに見積もりを2つ用意する"></textarea></label>' +
      '<div class="fps-actions"><button type="button" class="fps-btn is-quiet" data-close>やめる</button><button type="button" class="fps-btn is-main" id="fps-n-save">保存する</button></div>', function (el) {
      $('[data-close]', el).addEventListener('click', closeModal);
      $('#fps-n-save', el).addEventListener('click', async function () {
        var btn = this, date = $('#fps-n-date', el).value, body = $('#fps-n-body', el).value.trim();
        if (!date) { toast('面談した日を入れてください'); return; }
        if (body.length < 10) { toast('話した内容を10文字以上入れてください'); $('#fps-n-body', el).focus(); return; }
        var iso = date + 'T' + ($('#fps-n-time', el).value || '10:00') + ':00+09:00';
        var entry = { bookingTs: 'manual-' + Date.parse(iso) + '-' + Math.random().toString(36).slice(2, 7), ts: iso, createdAt: iso,
          userId: fsId(c) || c.lineFriendId || '', customerName: c.name || '', date: date, title: $('#fps-n-title', el).value.trim() || '面談の記録',
          transcript: '', summary: body, transcript_summary: '', key_concerns: [], predicted_next_questions: [], next_meeting_suggestion: '', source: 'manual' };
        btn.disabled = true; btn.textContent = '保存しています…';
        try {
          var d = await api.saveSummary(entry);
          if (d && d.skipped) throw new Error('内容が空と判定されて、保存されませんでした');
          try { if (window.FpLifeSync) window.FpLifeSync.afterMeetingSaved({ customerId: fsId(c), userId: c.lineFriendId, name: c.name }); } catch (_) {}
          var id = fsId(c); cache[id] = mergeMinutes([[entry], cache[id] || minutesOf(c)]);
          closeModal(); toast('議事録をのこしました'); st.tab = 'minutes'; render();
        } catch (err) { btn.disabled = false; btn.textContent = '保存する'; toast(String(err.message || err), 5000); }
      });
    }, 'read');
  }

  /* 会社に出す報告文（いまある議事録を、報告の形にならべ直すだけ。新しく文を作りはしない） */
  function reportText(r, c) {
    var d = mTime(r), u = fp().auth && fp().auth.currentUser, tasks = mTasks(r);
    var kc = asArray(r.key_concerns).map(function (x) { return typeof x === 'string' ? x : (x.text || x.title || ''); }).filter(Boolean);
    var bodyTxt = String(r.summary || r.transcript_summary || '')
      .replace(/^##?#?\s+[^\n]+\n\s*[（(]?\s*該当なし\s*[)）]?\s*$/gim, '')
      .replace(/^#{1,4}\s+(.+)$/gm, '\n■ $1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^\s*[-•*●▪]\s+/gm, '・').replace(/\n{3,}/g, '\n\n').trim();
    if (bodyTxt && !/^■/.test(bodyTxt)) bodyTxt = '■ 内容\n' + bodyTxt;
    var who = c ? c.name : (r.customerName || '');
    return ['【面談報告】',
      '日時：' + (d ? d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）' + fmtTime(d) + '〜' + (r.zoomDurationMin ? '（' + r.zoomDurationMin + '分）' : '') : ''),
      'お客様：' + who + ' 様',
      '方法：' + ({ 'Zoom': 'Zoom', '録音': '対面（録音）', '手入力': '対面' }[mKind(r)] || mKind(r)),
      '担当：' + ((u && (u.displayName || u.email)) || ''),
      '件名：' + mTitle(r), '',
      '■ 要点', mGist(r, 200), '',
      bodyTxt,
      kc.length ? '\n■ お客様の関心ごと\n' + kc.map(function (x) { return '・' + x; }).join('\n') : '',
      tasks.length ? '\n■ 次にやること\n' + tasks.map(function (x) { return '・' + x; }).join('\n') : '',
      r.next_meeting_suggestion ? '\n■ 次回に向けて\n' + r.next_meeting_suggestion : '',
      '', '以上'].filter(function (x, i, a) { return x !== '' || (a[i - 1] !== ''); }).join('\n').replace(/\n{3,}/g, '\n\n');
  }
  function reportModal(r, c) {
    modal('<h2>会社への報告文</h2><p>議事録を報告の形にならべました。足りないところは、ここで直してからコピーできます。</p>' +
      '<textarea class="fps-input" id="fps-r-text" style="min-height:340px;font-size:14px;line-height:1.8">' + esc(reportText(r, c)) + '</textarea>' +
      '<div class="fps-actions"><button type="button" class="fps-btn is-quiet" data-close>とじる</button><button type="button" class="fps-btn is-main" id="fps-r-copy">コピーする</button></div>', function (el) {
      $('[data-close]', el).addEventListener('click', closeModal);
      $('#fps-r-copy', el).addEventListener('click', async function () { this.textContent = (await copyText($('#fps-r-text', el).value)) ? 'コピーしました' : 'コピーできませんでした'; });
    }, 'laptop');
  }

  var phoneMq = window.matchMedia ? window.matchMedia('(max-width: 760px)') : { matches: false };
  function isPhone() { return !!phoneMq.matches; }
  var HUB_IC = {
    doc: SEC_ICON.note, video: '<rect x="2" y="6" width="13" height="12" rx="2.5"/><path d="M15 10.5l6-3.5v10l-6-3.5z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/><path d="M8.500 12l2.500 2.500 4.500-5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.500" cy="6" r="1.200"/><circle cx="4.500" cy="12" r="1.200"/><circle cx="4.500" cy="18" r="1.200"/>',
    life: '<path d="M3 18c4 0 4-10 9-10s5 6 9 6"/><circle cx="12" cy="8" r="2"/>',
    person: SEC_ICON.info
  };
  function hubCard(attr, face, title, sub, cls) {
    return '<button type="button" class="fps-hub-card' + (cls ? ' ' + cls : '') + '" ' + attr + '><span class="fps-hub-m">' + M(face, 66) + '</span>' +
      '<span class="fps-hub-t"><b>' + title + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span><span class="fps-hub-go" aria-hidden="true">›</span></button>';
  }
  // ページやタブの頭に出す、キャラクターつきの案内
  function banner(face, title, desc, extra) {
    return '<div class="fps-banner">' + M(face, 64) + '<span class="fps-banner-t">' + (title ? '<b>' + title + '</b>' : '') + '<small>' + desc + '</small></span>' + (extra || '') + '</div>';
  }
  function lifeHtml(c) {
    var ev = [];
    try { if (window.LifeEvents && window.LifeEvents.generate) ev = (window.LifeEvents.generate(c) || []).slice(); } catch (_) {}
    ev = ev.filter(function (e) { return e && toDate(e.date); }).sort(function (a, b) { return toDate(a.date) - toDate(b.date); });
    if (!ev.length) return '<div class="fps-empty" data-face="think">まだライフプランを出せません。<br>生年月日とご家族がわかると、進学や退職の時期が自動でならびます。<br><button type="button" class="fps-btn is-sm" data-act="edit-client" style="margin-top:12px">お客様の情報を入れる</button></div>';
    var age0 = null; try { age0 = window.LifeEvents.currentAge(c); } catch (_) {}
    var y0 = new Date().getFullYear(), year = 0, out = '';
    ev.forEach(function (e) {
      var d = toDate(e.date), y = d.getFullYear();
      if (y !== year) { year = y; out += '<li class="fps-tl-year num">' + y + '年' + (age0 != null ? '<small>（' + esc(c.name.split(/\s+/)[0]) + 'さん ' + (age0 + (y - y0)) + '歳）</small>' : '') + '</li>'; }
      var tag = ''; try { tag = window.LifeEvents.tagText(e) || ''; } catch (_) {}
      out += '<li class="fps-tl-item"><div class="fps-life' + (e.major ? ' major' : '') + '"><span class="num">' + (d.getMonth() + 1) + '月</span><span class="fps-life-b"><b>' + esc(e.label || '') + '</b><small>' + esc(e.who || '') + (tag ? '　' + esc(tag) : '') + '</small></span></div></li>';
    });
    return banner('kira', 'これからの節目', '生年月日とご家族、面談で聞いた話から、進学や退職の時期をならべています。') + '<ol class="fps-tl">' + out + '</ol>';
  }

  function viewCustomer() {
    var c = findClient(st.cid);
    if (!c) return '<div class="fps-wrap"><div class="fps-panel fps-empty">このお客様が見つかりませんでした。<br><a data-go="customers">お客様の一覧にもどる</a></div></div>';
    var id = fsId(c);
    if (!cache[id]) loadMinutes(c).then(function () { if (st.view === 'customer' && st.cid === id) render(); });
    loadContracts(c);
    var kn = contractsCache[id] ? contractsCache[id].length : 0;
    if (!isPhone() && st.tab === 'hub') st.tab = 'minutes';
    var mins = minutesOf(c), last = mins[0] ? mTime(mins[0]) : toDate(c.lastContact), next = nextSlotOf(c);
    var todos = []; mins.slice(0, 3).forEach(function (r) { mTasks(r).forEach(function (t) { todos.push({ t: t, at: mTime(r) }); }); });
    var fam = Array.isArray(c.family) ? c.family.map(function (f) { return typeof f === 'string' ? f : [f.relation || f.rel || '', f.name || '', f.age ? f.age + '歳' : ''].filter(Boolean).join(' '); }).filter(Boolean).join('・') : '';
    var kv = [['ふりがな', c.kana], ['生年月日', c.birth], ['ご家族', fam], ['お仕事', c.occupation], ['前回の面談', last ? fmtDay(last) + (mins[0] ? '　' + mGist(mins[0], 40) : '') : ''], ['メモ', c.note]]
      .filter(function (x) { return String(x[1] || '').trim(); })
      .map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('');
    var tags = (Array.isArray(c.autoTags) ? c.autoTags : []).slice(0, 4).map(function (t) { return '<span class="fps-tag">' + esc(t.name || t.label || t) + '</span>'; }).join('');

    var body;
    if (st.tab === 'todo') {
      body = todos.length ? banner('fight', '次にやること', '最近の面談で決まった宿題です。議事録ができると自動で入ります。') + '<div class="fps-sec2 k-next bare" style="margin-top:6px"><div class="fps-sec-body">' + todos.map(function (x, i) { return '<div class="fps-item"><i class="num">' + (i + 1) + '</i><span class="v">' + esc(x.t) + '<span class="fps-sub" style="display:block;font-size:12px">' + esc(fmtDay(x.at)) + ' の面談から</span></span></div>'; }).join('') + '</div></div>'
        : '<div class="fps-empty" data-face="idea">次にやることは、議事録ができると自動で出ます。</div>';
    } else if (st.tab === 'life') {
      body = lifeHtml(c);
    } else if (st.tab === 'contracts') {
      body = contractsHtml(c);
    } else if (st.tab === 'data') {
      body = kv ? banner('smile', 'お客様のこと', '生年月日やご家族を入れておくと、ライフプランに使われます。', isPhone() ? '' : '<button type="button" class="fps-btn is-quiet is-sm" data-act="edit-client">直す</button>') + '<dl class="fps-kv">' + kv + '</dl>' : '<div class="fps-empty">まだ情報がありません。「お客様の情報を直す」から入れられます。</div>';
    } else {
      var q = st.mq.trim().toLowerCase();
      var shown = !q ? mins : mins.filter(function (r) { return (mTitle(r) + ' ' + (r.summary || '') + ' ' + (r.transcript_summary || '') + ' ' + asArray(r.key_concerns).join(' ')).toLowerCase().indexOf(q) >= 0; });
      var year = '', tl = '';
      shown.forEach(function (r) {
        var d = mTime(r), y = d ? String(d.getFullYear()) : '';
        if (y && y !== year) { year = y; tl += '<li class="fps-tl-year num">' + y + '年</li>'; }
        tl += minuteCard(r, c);
      });
      body = (mins.length > 4 ? '<label style="display:block;margin-top:14px"><span style="position:absolute;width:1px;height:1px;overflow:hidden">議事録の中をさがす</span><input id="fps-mq" class="fps-input" type="search" placeholder="議事録の中をさがす（例：保険、教育費）" value="' + esc(st.mq) + '"></label>' : '') +
        (shown.length ? '<ol class="fps-tl">' + tl + '</ol>' : '') +
        (!shown.length && mins.length ? '<div class="fps-empty">「' + esc(st.mq) + '」が出てくる議事録はありません。</div>' : '') +
        (!cache[id] ? '<div class="fps-loading"' + (mins.length ? ' data-small="1"' : '') + '>' + (mins.length ? 'もっと前の議事録をさがしています…' : '議事録を読み込んでいます…') + '</div>'
          : (!mins.length ? '<div class="fps-empty">まだ議事録がありません。<br>「Zoomで面談」か「録音から議事録を作る」で作れます。</div>' : ''));
    }
    var pend = pendingList().filter(function (p) { return p.customerId && (p.customerId === id || p.customerId === c.id); });

    if (isPhone()) {
      var pendBar = pend.length ? '<div class="fps-panel" style="background:var(--fps-amber-soft);color:var(--fps-amber-text);padding:12px 14px;font-size:14px;font-weight:700;display:flex;align-items:center;gap:12px">' + M('laptop', 48) + '<span>いま議事録を作っています。できたら「議事録を見る」に出ます。</span></div>' : '';
      if (st.tab === 'hub') {
        return '<div class="fps-wrap"><div><a data-go="customers" style="font-size:14px;font-weight:700">‹ お客様の一覧</a></div>' +
          '<section class="fps-panel fps-hub-head">' + avatar(c, 68, 28) + '<span class="fps-hub-name">' + (c.kana ? '<small>' + esc(c.kana) + '</small>' : '') + '<b>' + esc(c.name) + '<i>様</i></b>' +
            '<small class="num">' + (last ? '前回 ' + esc(fmtDay(last)) : 'まだ面談していません') + (next ? '　次回 ' + esc(fmtDay(next) + ' ' + fmtTime(next)) : '') + '</small></span></section>' + pendBar +
          '<div class="fps-hub">' +
            hubCard('data-tab="minutes"', 'read', '議事録を見る', mins.length ? mins.length + '件　いちばん新しいのは ' + esc(fmtDay(mTime(mins[0]))) : (cache[id] ? 'まだありません' : '読み込んでいます…'), 'wide') +
            hubCard('data-act="zoom"', 'laptop', 'Zoomで面談する', '案内を作って、自分のLINEで送ります', 'wide main') +
            hubCard('data-act="upload"', 'oh', '録音から作る', '録音を上げると議事録に', 't-mint') +
            hubCard('data-act="manual-minute"', 'idea', 'メモを取る', '録音がないときに書く', 't-sand') +
            hubCard('data-tab="contracts"', 'heart', '買った商品', kn ? kn + '件' : '保険などをのこす', 't-peach') +
            hubCard('data-tab="todo"', 'fight', 'やること', todos.length ? todos.length + '件' : 'ありません', 't-sand') +
            hubCard('data-tab="life"', 'kira', 'ライフプランを見る', '進学・退職などの節目', 't-mint') +
            hubCard('data-tab="data"', 'smile', 'お客様データ', '生年月日・ご家族・メモ', 't-peach') +
          '</div></div>';
      }
      var ttl = { minutes: '議事録', todo: 'やること', contracts: '買った商品・契約', life: 'ライフプラン', data: 'お客様データ' }[st.tab] || '';
      return '<div class="fps-wrap"><div><a data-tab="hub" style="font-size:14px;font-weight:700">‹ ' + esc(c.name) + ' 様</a></div>' + (st.tab === 'minutes' ? pendBar : '') +
        '<section class="fps-panel" style="padding:18px 16px"><h1 class="fps-h" style="font-size:17px">' + ttl + '<small>' + esc(c.name) + ' 様</small></h1>' + body +
        (st.tab === 'data' ? '<button type="button" class="fps-btn is-quiet" data-act="edit-client" style="margin-top:14px;width:100%">お客様の情報を直す</button>' : '') + '</section></div>';
    }
    return '<div class="fps-wrap"><div><a data-go="customers" style="font-size:14px;font-weight:700">‹ お客様の一覧</a></div>' +
      '<div class="fps-panel fps-card">'
 +
        '<aside class="fps-aside">' +
          '<div class="fps-person">' + avatar(c, 132, 52) +
            (c.kana ? '<span class="fps-kana">' + esc(c.kana) + '</span>' : '') +
            '<span class="fps-name">' + esc(c.name) + '<small>様</small></span>' +
            '<button type="button" class="fps-btn is-quiet is-sm" data-act="edit-client" style="margin-top:6px">お客様の情報を直す</button>' +
          '</div>' +
          (tags ? '<div class="fps-block"><b>タグ</b><div style="display:flex;gap:6px;flex-wrap:wrap">' + tags + '</div></div>' : '') +
          '<div class="fps-block"><b>面談</b>' +
            '<div class="fps-row"><span class="fps-sub">これまで</span><span class="num" style="font-weight:700">' + mins.length + '回</span></div>' +
            '<div class="fps-row"><span class="fps-sub">前回</span><span class="num" style="font-weight:700">' + esc(last ? fmtDay(last) : 'まだ') + '</span></div>' +
            '<div class="fps-row"><span class="fps-sub">契約</span><span class="num" style="font-weight:700">' + kn + '件</span></div>' +
            (next ? '<div class="fps-row"><span class="fps-sub">次回</span><span class="num" style="font-weight:700;color:var(--fps-red-text)">' + esc(fmtDay(next) + ' ' + fmtTime(next)) + '</span></div>' : '') +
          '</div>' +
          '<b style="font-size:13px;margin-top:auto">議事録をつくる</b><button type="button" class="fps-btn is-main with-m" data-act="zoom" style="height:56px;font-size:16px">' + M('wink', 58, 'peek') + ICON.video + 'Zoomで面談</button>' +
          '<button type="button" class="fps-btn" data-act="upload" style="height:44px;font-size:14px">' + ICON.mic + '録音から作る</button>' +
          '<button type="button" class="fps-btn is-quiet" data-act="manual-minute" style="height:44px;font-size:14px">メモから書く</button>' +
        '</aside>' +
        '<section class="fps-main">' +
          (pend.length ? '<div style="background:var(--fps-amber-soft);color:var(--fps-amber-text);border-radius:12px;padding:12px 16px;font-size:14px;font-weight:700;display:flex;align-items:center;gap:12px">' + M('laptop', 52) + '<span>いま議事録を作っています。できたら、下の一覧に出ます。</span></div>' : '') +
          '<div><h1 class="fps-h" style="font-size:17px">' + esc(c.name) + ' 様の記録</h1>' +
          '<div class="fps-tabs" role="tablist">' +
            '<button type="button" role="tab" data-tab="minutes" aria-selected="' + (st.tab === 'minutes') + '">議事録<span class="fps-chip plain num" style="margin-left:6px">' + mins.length + '</span></button>' +
            '<button type="button" role="tab" data-tab="todo" aria-selected="' + (st.tab === 'todo') + '">やること' + (todos.length ? '<span class="fps-chip ok num" style="margin-left:6px">' + todos.length + '</span>' : '') + '</button>' +
            '<button type="button" role="tab" data-tab="contracts" aria-selected="' + (st.tab === 'contracts') + '">契約' + (kn ? '<span class="fps-chip plain num" style="margin-left:6px">' + kn + '</span>' : '') + '</button>' +
            '<button type="button" role="tab" data-tab="life" aria-selected="' + (st.tab === 'life') + '">ライフプラン</button>' +
            '<button type="button" role="tab" data-tab="data" aria-selected="' + (st.tab === 'data') + '">データ</button>' +
          '</div>' + body + '</div>' +
        '</section></div></div>';
  }

  function viewMinutes() {
    var pend = pendingList();
    var rows = pend.map(pendingRow).join('') + liveMinutes().slice().sort(byTimeDesc).map(function (r) { return minuteRow(r, clientOfMinute(r), true); }).join('');
    return '<div class="fps-wrap"><div style="display:flex;align-items:center;gap:12px">' + M('read', 64, 'hello') + '<div><h1 class="fps-title">議事録</h1><p class="fps-sub" style="margin:2px 0 0;font-size:14px">新しい順にならんでいます。押すと中身が開きます。</p></div></div><section class="fps-panel" style="padding:10px 18px 14px">' +
      (rows ? '<div class="fps-table-wrap"><table class="fps-table"><thead><tr><th>日時</th><th>お客様・内容</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<div class="fps-empty">まだ議事録がありません。</div>') +
      '</section><p class="fps-sub" style="font-size:13px;margin:0">新しいものから並んでいます。古い議事録は、お客様のページから見られます。</p></div>';
  }

  function findMinute(c, mid) {
    var list = c ? minutesOf(c) : liveMinutes();
    for (var i = 0; i < list.length; i++) { if (mKey(list[i]) === mid) return list[i]; }
    var all = liveMinutes();
    for (var j = 0; j < all.length; j++) { if (mKey(all[j]) === mid) return all[j]; }
    return null;
  }
  function viewMinute() {
    var c = st.cid && st.cid !== '_' ? findClient(st.cid) : null;
    if (c && !cache[fsId(c)]) loadMinutes(c).then(function () { if (st.view === 'minute') render(); });
    var r = findMinute(c, st.mid);
    if (!r) return '<div class="fps-wrap"><div class="fps-panel ' + (c && !cache[fsId(c)] ? 'fps-loading">議事録を読み込んでいます…' : 'fps-empty">この議事録が見つかりませんでした。<br><a data-go="minutes">議事録の一覧にもどる</a>') + '</div></div>';
    if (!c) c = clientOfMinute(r);
    var d = mTime(r), tasks = mTasks(r), kc = asArray(r.key_concerns).map(function (x) { return typeof x === 'string' ? x : (x.text || x.title || ''); }).filter(Boolean);
    var gist = mGist(r, 160);
    var hasT = !!String(r.transcript || '').trim();
    return '<div class="fps-wrap"><div style="font-size:14px;font-weight:700">' +
        (c ? '<a data-open-client="' + esc(fsId(c)) + '">‹ ' + esc(c.name) + ' 様のページ</a>' : '<a data-go="minutes">‹ 議事録の一覧</a>') + '</div>' +
      '<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start">' +
        '<article class="fps-panel" style="flex:999 1 520px;min-width:0;padding:30px 32px"><div class="fps-doc">' +
          '<header><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><span class="fps-chip ok">できました</span><span class="fps-chip plain">' + esc(mKind(r)) + '</span>' +
            (r.zoomDurationMin ? '<span class="fps-chip plain num">' + esc(r.zoomDurationMin) + '分</span>' : '') + '</div>' +
            '<h1 class="fps-title" style="line-height:1.45">' + esc(mTitle(r)) + '</h1>' +
            '<div class="fps-meta">' +
              '<span><small>日時</small><b class="num">' + esc(d ? fmtDay(d) + ' ' + fmtTime(d) : '—') + '</b></span>' +
              '<span><small>お客様</small><b>' + esc(c ? c.name : (r.customerName || '—')) + ' 様</b></span>' +
              '<span><small>方法</small><b>' + esc(mKind(r)) + (r.zoomDurationMin ? '・' + esc(r.zoomDurationMin) + '分' : '') + '</b></span>' +
              '<span><small>やること</small><b class="num">' + tasks.length + '件</b></span></div></header>' +
          (gist ? '<section class="fps-gist">' + M('idea', 70, 'corner') + '<p class="fps-eyebrow" style="margin-bottom:8px">ひとことで言うと</p><p>' + esc(gist) + '</p></section>' : '') +
          '<div id="fps-sum">' + renderSummary(r.summary || r.transcript_summary || '') + '</div>' +
          ((kc.length || r.next_meeting_suggestion) ? renderSummary((kc.length ? '## お客様の関心ごと\n' + kc.map(function (x) { return '- ' + x; }).join('\n') + '\n' : '') + (r.next_meeting_suggestion ? '## 次回に向けて\n' + r.next_meeting_suggestion : '')) : '') +
          '<div><button type="button" class="fps-btn is-quiet" data-act="toggle-transcript">' + (st.showTranscript ? '話した内容の全文を閉じる' : '話した内容の全文を見る') + '</button>' +
            (st.showTranscript ? '<div class="fps-transcript" style="margin-top:12px">' + (hasT ? esc(r.transcript) : '全文はまだ読み込めていません。少し待ってから、もう一度開いてください。') + '</div>' : '') + '</div>' +
        '</div></article>' +
        '<aside style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:16px">' +
          '<section class="fps-panel" style="padding:20px 22px"><h2 class="fps-h">次にやること' + M('fight', 44, 'h-m') + '</h2>' +
            (tasks.length ? '<div class="fps-sec2 k-next bare"><div class="fps-sec-body">' + tasks.map(function (t, i) { return '<div class="fps-item"><i class="num">' + (i + 1) + '</i><span class="v">' + esc(t) + '</span></div>'; }).join('') + '</div></div>' : '<div class="fps-empty" data-face="smile" style="padding:16px 0 4px">この面談からの宿題はありません。</div>') + '</section>' +
          '<section class="fps-panel" style="padding:20px 22px;display:flex;flex-direction:column;gap:10px"><h2 class="fps-h">この議事録を使う' + M('laptop', 44, 'h-m') + '</h2>' +
            '<button type="button" class="fps-btn is-main" data-act="report">会社への報告文をつくる</button>' +
            '<button type="button" class="fps-btn" data-act="copy-minute">要点をコピーする</button>' +
            '<button type="button" class="fps-btn is-quiet" data-act="edit-minute">内容を直す</button>' +
            '<p class="fps-sub" style="margin:0;font-size:13px">報告文は、日時・お客様・要点・次にやることを報告の形にならべたものです。コピーして、メールや社内チャットに貼れます。</p></section>' +
        '</aside></div></div>';
  }

  var NAVI = {
    home: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z"/></svg>',
    people: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.6c1.8.7 3 2.5 3.5 5.4"/></svg>',
    doc: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M9 11h7M9 15h7"/></svg>'
  };
  // スマホ用：画面の下に出す、親指でとどくメニュー
  function bottomNav() {
    var cur = function (v) { return (st.view === v || (v === 'customers' && st.view === 'customer') || (v === 'minutes' && st.view === 'minute')) ? ' aria-current="page"' : ''; };
    return '<nav class="fps-bnav" aria-label="メニュー">' +
      '<button type="button" data-go="home"' + cur('home') + '>' + NAVI.home + '<span>ホーム</span></button>' +
      '<button type="button" data-go="customers"' + cur('customers') + '>' + NAVI.people + '<span>お客様</span></button>' +
      '<button type="button" class="fps-bnav-main" data-act="zoom"><i>' + ICON.video + '</i><span>Zoom面談</span></button>' +
      '<button type="button" data-go="minutes"' + cur('minutes') + '>' + NAVI.doc + '<span>議事録</span></button>' +
      '<button type="button" data-act="upload">' + ICON.mic + '<span>録音</span></button>' +
      '</nav>';
  }

  function render() {
    if (!mounted || !root) return;
    var body = st.view === 'customers' ? viewCustomers() : st.view === 'customer' ? viewCustomer() : st.view === 'minutes' ? viewMinutes() : st.view === 'minute' ? viewMinute() : viewHome();
    var keepQ = document.activeElement && /^fps-m?q$/.test(document.activeElement.id) ? document.activeElement.id : '';
    root.innerHTML = header() + body + bottomNav() + '<input type="file" id="fps-file" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.aac,.webm" hidden>';
    decorate(root);
    if (keepQ) { var q = $('#' + keepQ, root); if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (_) {} } }
  }

  /* ---------- 操作 ---------- */
  var uploadTarget = null;

  function pickClient(title, lead, onPick) {
    modal('<h2>' + esc(title) + '</h2><p>' + esc(lead) + '</p>' +
      '<input class="fps-input" id="fps-pick-q" type="search" placeholder="名前でさがす・新しい人の名前を入れる" autocomplete="off">' +
      '<div class="fps-pick" id="fps-pick-list"></div>' +
      '<div class="fps-actions"><button type="button" class="fps-btn is-quiet" data-close>やめる</button></div>', function (el) {
      el.insertAdjacentHTML('afterbegin', M('think', 84, 'modal-m')); el.classList.add('has-m');
      var draw = function () {
        var q = $('#fps-pick-q', el).value.trim(), ql = q.toLowerCase();
        var list = clients().filter(function (c) { return !ql || String(c.name).toLowerCase().indexOf(ql) >= 0 || String(c.kana || '').toLowerCase().indexOf(ql) >= 0; })
          .sort(function (a, b) { var x = lastMeetingOf(a), y = lastMeetingOf(b); return (y ? y.getTime() : 0) - (x ? x.getTime() : 0); }).slice(0, 40);
        var exact = clients().some(function (c) { return String(c.name).replace(/\s/g, '') === q.replace(/\s/g, ''); });
        $('#fps-pick-list', el).innerHTML =
          (q && !exact ? '<button type="button" data-new="' + esc(q) + '"><span class="fps-avatar" style="width:36px;height:36px;font-size:18px;background:var(--fps-red-soft);color:var(--fps-red-text)">＋</span>「' + esc(q) + '」さんを新しく登録する</button>' : '') +
          list.map(function (c) { return '<button type="button" data-id="' + esc(fsId(c)) + '">' + avatar(c, 36, 15) + esc(c.name) + '</button>'; }).join('') ||
          '<div class="fps-empty">お客様がいません。上に名前を入れると、新しく登録できます。</div>';
      };
      draw();
      $('#fps-pick-q', el).addEventListener('input', draw);
      el.addEventListener('click', async function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-close')) return closeModal();
        if (b.dataset.id) { var c = findClient(b.dataset.id); closeModal(); if (c) onPick(c); return; }
        if (b.dataset.new) {
          b.disabled = true; b.textContent = '登録しています…';
          try { var nc = await createClient({ name: b.dataset.new }); closeModal(); onPick(nc); }
          catch (err) { b.disabled = false; toast('登録できませんでした：' + (err.message || err), 5000); }
        }
      });
    });
  }

  async function createClient(v) {
    var name = String(v.name || '').trim();
    if (!name) throw new Error('名前を入れてください');
    var patch = { name: name, kana: v.kana || '', birth: v.birth || '', occupation: v.occupation || '', note: v.note || '', contactVia: 'personal_line' };
    var id = await api.saveCustomer(null, patch, true);
    var c = Object.assign({ id: 'fs-' + id, _fsCustomerId: id, gender: 'O', family: [], proposals: [], source: 'manual', status: 'new', aum: 0, lineFriendId: '', autoFromFirestore: true, viaKeyboard: true, lastContact: new Date().toISOString() }, patch);
    if (!Array.isArray(window.DUMMY_CLIENTS)) window.DUMMY_CLIENTS = [];
    window.DUMMY_CLIENTS.push(c);
    try { lsSet('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS)); } catch (_) {}
    return c;
  }

  function clientForm(c) {
    var isNew = !c; c = c || {};
    var f = function (id, label, val, ph, type) {
      return '<label class="fps-field"><span>' + label + '</span>' + (type === 'area'
        ? '<textarea class="fps-input" id="' + id + '" placeholder="' + esc(ph || '') + '">' + esc(val || '') + '</textarea>'
        : '<input class="fps-input" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '" autocomplete="off">') + '</label>';
    };
    modal('<h2>' + (isNew ? '新しいお客様' : 'お客様の情報を直す') + '</h2><p>' + (isNew ? '名前だけで登録できます。ほかは、あとから入れられます。' : '直したいところだけ書きかえてください。') + '</p>' +
      f('fps-f-name', '名前', c.name, '山田 花子') + f('fps-f-kana', 'ふりがな', c.kana, 'やまだ はなこ') +
      f('fps-f-birth', '生年月日', c.birth, '', 'date') + f('fps-f-job', 'お仕事', c.occupation, '会社員') +
      f('fps-f-note', 'メモ', c.note, '紹介してくれた人、話しやすい時間など', 'area') +
      '<div class="fps-actions"><button type="button" class="fps-btn is-quiet" data-close>やめる</button><button type="button" class="fps-btn is-main" id="fps-f-save">' + (isNew ? '登録する' : '保存する') + '</button></div>', function (el) {
      $('[data-close]', el).addEventListener('click', closeModal);
      $('#fps-f-save', el).addEventListener('click', async function () {
        var btn = this, v = { name: $('#fps-f-name', el).value.trim(), kana: $('#fps-f-kana', el).value.trim(), birth: $('#fps-f-birth', el).value, occupation: $('#fps-f-job', el).value.trim(), note: $('#fps-f-note', el).value.trim() };
        if (!v.name) { toast('名前を入れてください'); $('#fps-f-name', el).focus(); return; }
        btn.disabled = true; btn.textContent = '保存しています…';
        try {
          if (isNew) { var nc = await createClient(v); closeModal(); toast(v.name + 'さんを登録しました'); go('customer', fsId(nc)); }
          else {
            await api.saveCustomer(fsId(c), v, false); try { if (window.LifeEvents && window.LifeEvents.invalidate) window.LifeEvents.invalidate(c); } catch (_) {}
            Object.assign(c, v);
            try { lsSet('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS)); } catch (_) {}
            closeModal(); toast('保存しました'); render();
          }
        } catch (err) { btn.disabled = false; btn.textContent = isNew ? '登録する' : '保存する'; toast('保存できませんでした：' + (err.message || err), 5000); }
      });
    }, 'smile');
  }

  function startZoom(c) {
    modal('<h2>' + esc(c.name) + ' 様とZoomで面談</h2><p>Zoomを用意しています…</p><div class="fps-loading">10秒ほどかかります</div>', null, null);
    api.call('startInstantZoom', { customerId: fsId(c), lineFriendId: null }).then(function (d) {
      if (!d || !d.joinUrl) throw new Error((d && d.error) || 'Zoomを用意できませんでした');
      try { if (typeof window.armTabRecorder === 'function') window.armTabRecorder(fsId(c), c.name, tenantId()); } catch (_) {}
      c.zoomUrl = d.joinUrl; c.hostZoomUrl = d.startUrl || d.joinUrl; c.zoomMeetingId = String(d.meetingId || '');
      var idn = String(d.meetingId || '').replace(/\D/g, '');
      var idLabel = idn.length === 11 ? idn.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1 $2 $3') : idn.length === 10 ? idn.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3') : idn;
      var invite = ['Zoomのご案内です。', '参加URL：' + d.joinUrl, idLabel ? 'ミーティングID：' + idLabel : '', d.passcode ? 'パスコード：' + d.passcode : ''].filter(Boolean).join('\n');
      modal('<h2>Zoomの用意ができました</h2><p>① 下の案内をコピーして、自分のLINEなどで ' + esc(c.name) + ' 様に送ります。<br>② 「自分がZoomに入る」を押して、面談を始めます。</p>' +
        '<div class="fps-copybox" id="fps-invite">' + esc(invite) + '</div>' +
        '<div class="fps-actions" style="justify-content:stretch">' +
          '<button type="button" class="fps-btn" id="fps-copy-invite" style="flex:1">案内をコピー</button>' +
          '<a class="fps-btn is-main" style="flex:1" href="' + esc(d.startUrl || d.joinUrl) + '" target="_blank" rel="noopener">自分がZoomに入る</a></div>' +
        '<p style="margin:14px 0 0;font-size:13px">面談が終わると、5〜15分ほどで議事録が ' + esc(c.name) + ' 様のページに入ります。</p>' +
        '<div class="fps-actions"><button type="button" class="fps-btn is-quiet is-sm" data-close>とじる</button></div>', function (el) {
        $('[data-close]', el).addEventListener('click', closeModal);
        $('#fps-copy-invite', el).addEventListener('click', async function () { this.textContent = (await copyText(invite)) ? 'コピーしました' : 'コピーできませんでした'; });
      }, 'kira');
      try { if (window.refreshFirestoreCustomers) window.refreshFirestoreCustomers(); } catch (_) {}
    }).catch(function (e) {
      var msg = String((e && e.message) || e);
      var noZoom = /Zoom 未連携|failed-precondition/.test(msg);
      modal('<h2>Zoomを用意できませんでした</h2><p>' + (noZoom ? 'まだZoomとつながっていません。アカウントの設定で、Zoomの連携をしてください。' : esc(msg.slice(0, 200))) + '</p>' +
        '<div class="fps-actions">' + (noZoom ? '<a class="fps-btn is-main" href="/account.html" target="_blank" rel="noopener">アカウントの設定をひらく</a>' : '') +
        '<button type="button" class="fps-btn is-quiet" data-close>とじる</button></div>', function (el) { $('[data-close]', el).addEventListener('click', closeModal); }, 'oh');
    });
  }

  function startUpload(c) {
    uploadTarget = c;
    var inp = $('#fps-file', root); if (inp) { inp.value = ''; inp.click(); }
  }
  async function onFile(file) {
    var c = uploadTarget; uploadTarget = null;
    if (!file || !c) return;
    if (file.size / 1024 / 1024 > 400) { toast('ファイルが大きすぎます（上限 400MB）', 5000); return; }
    if (typeof window.startAsyncStorageUpload !== 'function') { toast('まだ準備中です。数秒待って、もう一度お試しください', 4500); return; }
    toast(c.name + ' 様の録音をアップロードしています…', 4000);
    try {
      var r = await window.startAsyncStorageUpload(file, fsId(c), c.name || 'お客様');
      if (r && r.ok === false) { toast('アップロードできませんでした：' + String(r.error || '').slice(0, 80), 6000); return; }
      toast('アップロードしました。数分で議事録ができます', 5000);
      setTimeout(refreshSoon, 4000);
    } catch (e) { toast('アップロードできませんでした：' + ((e && e.message) || e), 6000); }
  }

  function editMinute(r, c) {
    modal('<h2>議事録の内容を直す</h2><p>本文を書きかえて「保存する」を押してください。</p>' +
      '<textarea class="fps-input" id="fps-m-text" style="min-height:320px">' + esc(r.summary || '') + '</textarea>' +
      '<div class="fps-actions"><button type="button" class="fps-btn is-quiet" data-close>やめる</button><button type="button" class="fps-btn is-main" id="fps-m-save">保存する</button></div>', function (el) {
      $('[data-close]', el).addEventListener('click', closeModal);
      $('#fps-m-save', el).addEventListener('click', async function () {
        var btn = this, text = $('#fps-m-text', el).value.trim();
        btn.disabled = true; btn.textContent = '保存しています…';
        var entry = {
          bookingTs: r.bookingTs, userId: r.userId || (c ? (c.lineFriendId || fsId(c)) : ''), customerName: r.customerName || (c ? c.name : ''),
          date: r.date || '', transcript: r.transcript || '', summary: text, transcript_summary: r.transcript_summary || '',
          key_concerns: r.key_concerns || [], next_meeting_suggestion: r.next_meeting_suggestion || '', lifeEventCandidates: r.lifeEventCandidates || []
        };
        if (r.source) entry.source = r.source;
        if (/manual/.test(String(r.source || ''))) { if (r.title) entry.title = r.title; if (r.ts) entry.ts = r.ts; if (r.createdAt) entry.createdAt = r.createdAt; }
        try { await api.saveSummary(entry); r.summary = text; closeModal(); toast('保存しました'); render(); }
        catch (err) { btn.disabled = false; btn.textContent = '保存する'; toast(String(err.message || err), 5000); }
      });
    }, 'idea');
  }

  function refreshSoon() {
    try { if (window.__fpJobs && window.__fpJobs.fetchAllJobs) window.__fpJobs.fetchAllJobs().then(function () { if (!$('.fps-modal-bg')) render(); }); } catch (_) {}
  }

  function onClick(e) {
    var menu = $('#fps-menu', root);
    var t = e.target;
    if (t.closest('#fps-menu-btn')) { menu.classList.toggle('open'); return; }
    if (menu && menu.classList.contains('open') && !t.closest('#fps-menu')) menu.classList.remove('open');

    var el = t.closest('[data-go],[data-open-client],[data-open-minute],[data-act],[data-tab],[data-copy],[data-contract]');
    if (!el) return;
    if (el.dataset.go) { e.preventDefault(); if (el.dataset.go !== 'customers') st.q = ''; return go(el.dataset.go); }
    if (el.dataset.openClient) { e.preventDefault(); st.tab = isPhone() ? 'hub' : 'minutes'; st.mq = ''; return go('customer', el.dataset.openClient); }
    if (el.hasAttribute('data-open-minute')) { return go('minute', el.dataset.openMinute || '_', el.dataset.mid); }
    if (el.dataset.tab) { e.preventDefault(); st.tab = el.dataset.tab; render(); if (root) root.scrollTop = 0; return; }
    if (el.dataset.copy) { copyText(el.dataset.copy).then(function (ok) { toast(ok ? 'コピーしました' : 'コピーできませんでした'); }); return; }
    if (el.dataset.contract) { var cc = findClient(st.cid); var kk = cc && (contractsCache[fsId(cc)] || []).filter(function (x) { return x.id === el.dataset.contract; })[0]; return kk ? contractForm(cc, kk) : null; }
    var c = (st.view === 'customer' || st.view === 'minute') && st.cid && st.cid !== '_' ? findClient(st.cid) : null;
    switch (el.dataset.act) {
      case 'zoom': return c && st.view === 'customer' ? startZoom(c) : pickClient('だれとZoomで面談しますか？', 'お客様を選ぶと、Zoomの用意をします。', startZoom);
      case 'upload': return c && st.view === 'customer' ? startUpload(c) : pickClient('だれとの面談の録音ですか？', 'お客様を選ぶと、録音のファイルを選べます。', startUpload);
      case 'new-client': return clientForm(null);
      case 'new-contract': return c ? contractForm(c, null) : null;
      case 'manual-minute': return c ? manualMinuteForm(c) : null;
      case 'report': { var r3 = findMinute(c, st.mid); return r3 ? reportModal(r3, c || clientOfMinute(r3)) : null; }
      case 'edit-client': return c ? clientForm(c) : null;
      case 'toggle-transcript': st.showTranscript = !st.showTranscript; return render();
      case 'copy-minute': {
        var r = findMinute(c, st.mid); if (!r) return;
        var tasks = mTasks(r);
        var text = [mTitle(r) + '（' + fmtDay(mTime(r)) + '）', '', plain(r.summary || r.transcript_summary || ''), tasks.length ? '\n次にやること\n' + tasks.map(function (x) { return '・' + x; }).join('\n') : ''].join('\n').trim();
        return copyText(text).then(function (ok) { toast(ok ? '要点をコピーしました' : 'コピーできませんでした'); });
      }
      case 'edit-minute': { var r2 = findMinute(c, st.mid); return r2 ? editMinute(r2, c || clientOfMinute(r2)) : null; }
      case 'classic': return setEnabled(false);
      case 'account': return window.open('/account.html', '_blank', 'noopener');
      case 'manual': return window.open('/manual.html', '_blank', 'noopener');
      case 'logout':
        if (fp().signOut && fp().auth) { fp().signOut(fp().auth).then(function () { location.reload(); }).catch(function () { location.reload(); }); }
        return;
    }
  }

  /* ---------- 出し入れ ---------- */
  function mount() {
    if (mounted) return;
    root = document.getElementById('fps-root');
    if (!root) { root = document.createElement('div'); root.id = 'fps-root'; document.body.appendChild(root); }
    root.addEventListener('click', onClick);
    root.addEventListener('input', function (e) {
      if (e.target.id === 'fps-q') { st.q = e.target.value; render(); }
      if (e.target.id === 'fps-mq') { st.mq = e.target.value; render(); }
    });
    root.addEventListener('change', function (e) { if (e.target.id === 'fps-file') onFile(e.target.files && e.target.files[0]); });
    window.addEventListener('hashchange', onHash);
    try { phoneMq.addEventListener('change', function () { if (mounted && !$('.fps-modal-bg')) render(); }); } catch (_) {}
    document.documentElement.classList.add('fps-on');
    mounted = true; mountedAt = Date.now();
    applyHash();
    setTimeout(function () { if (mounted && !$('.fps-modal-bg')) render(); }, 9200);
    api.tenantFlag().then(function (f) { if (f && f.name && !st.office) { st.office = f.name; render(); } });
    refreshSoon();
    tick = setInterval(function () {
      if (!mounted || document.hidden || $('.fps-modal-bg')) return;
      var a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
      var sig = clients().length + '|' + liveMinutes().length + '|' + pendingList().length;
      if (sig !== lastSig) { lastSig = sig; render(); }
    }, 4000);
  }
  var tick = null, lastSig = '';
  function onHash() { if (mounted) applyHash(); }
  function unmount() {
    if (!mounted) return;
    mounted = false; clearInterval(tick);
    window.removeEventListener('hashchange', onHash);
    document.documentElement.classList.remove('fps-on');
    closeModal();
    if (root) { root.remove(); root = null; }
    if (/^#s\//.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} }
  }
  function switchButton(show) {
    var b = document.getElementById('fps-switch');
    if (!show) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('button'); b.id = 'fps-switch'; b.type = 'button'; b.textContent = 'シンプルな画面にする';
    b.addEventListener('click', function () { setEnabled(true); });
    document.body.appendChild(b);
  }
  function setEnabled(on) {
    lsSet(LS_KEY, on ? '1' : '0');
    if (on) { switchButton(false); mount(); } else { unmount(); switchButton(true); }
  }
  function loggedIn() { return !!(fp().auth && fp().auth.currentUser && tenantId()); }

  // URL の ?simple=1 / ?simple=0
  try {
    var sp = new URL(location.href).searchParams.get('simple');
    if (sp === '1' || sp === '0') lsSet(LS_KEY, sp);
  } catch (_) {}

  var flagChecked = false;
  function boot() {
    if (!loggedIn()) { if (mounted) unmount(); switchButton(false); return; }
    var pref = lsGet(LS_KEY);
    if (pref === '1') { if (!mounted) mount(); return; }
    if (pref === '0') { switchButton(true); return; }
    if (!flagChecked) {
      flagChecked = true;
      api.tenantFlag().then(function (f) {
        if (f && f.name) st.office = f.name;
        if (f && f.simple && lsGet(LS_KEY) == null && loggedIn()) mount();
      });
    }
  }
  setInterval(boot, 1500);
  setTimeout(boot, 300);

  window.FPSimple = { on: function () { setEnabled(true); }, off: function () { setEnabled(false); }, render: render, _api: api, _state: st };
})();
