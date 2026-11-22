/* ============================================================
   minutes-report.js — 議事録を「報告書」の形にまとめる（2026-11-21）
   ・面談のカードに「報告書にまとめる」ボタンを出す
   ・議事録（AI のまとめ）を、そのまま貼れる文章に組み直す。AI は呼ばない（その場で出る・費用なし）
   ・形式: 標準 / 短く（日報向け） / 意向把握の記録 / 経過（この方の面談ぜんぶ）
   ・コピー・共有・印刷。出す前に手で直せる
   app.js からは FpMinutesReport.buttonHtml(...) を呼ぶだけ。
   ============================================================ */
(function () {
  'use strict';
  if (window.FpMinutesReport) return;

  var store = new Map();          // key → 面談1件ぶんの材料
  var ui = { key: '', mode: 'std', mask: false, edited: false, last: null };
  var MODE_KEY = 'fp-report-mode';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 日付 ---------- */
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function jstParts(ts) {
    var d = ts ? new Date(ts) : null;
    if (!d || isNaN(d.getTime())) return null;
    var j = new Date(d.getTime() + 9 * 3600 * 1000);   // 日本時間で読む
    return { y: j.getUTCFullYear(), m: j.getUTCMonth() + 1, d: j.getUTCDate(), wd: WD[j.getUTCDay()], hh: j.getUTCHours(), mm: j.getUTCMinutes() };
  }
  function dayParts(day) {
    var m = String(day || '').match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return { y: +m[1], m: +m[2], d: +m[3], wd: WD[d.getUTCDay()], hh: null, mm: null };
  }
  function whenText(rec, short) {
    var p = /\d{4}-\d{2}-\d{2}T/.test(String(rec.ts || '')) ? jstParts(rec.ts) : null;
    if (!p) {
      p = dayParts(rec.date) || dayParts(rec.ts);
      var tm = String(rec.time || '').match(/^(\d{1,2}):(\d{2})/);
      if (p && tm) { p.hh = +tm[1]; p.mm = +tm[2]; }
    }
    if (!p) return '';
    var s = (short ? '' : p.y + '年') + p.m + '月' + p.d + '日（' + p.wd + '）';
    if (p.hh != null) s += ' ' + p.hh + ':' + String(p.mm).padStart(2, '0');
    return s;
  }
  function sortKey(rec) {
    var t = Date.parse(rec.ts || '');
    if (!isNaN(t)) return t;
    var p = dayParts(rec.date);
    return p ? Date.UTC(p.y, p.m - 1, p.d) : 0;
  }

  /* ---------- 議事録（## 見出し + 箇条書き）を読み分ける ---------- */
  function cleanInline(s) {
    return String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/[ \t]+$/g, '');
  }
  function cleanLine(line) {
    var l = cleanInline(line);
    if (!l.trim()) return '';
    var m;
    if ((m = l.match(/^(\s*)[-*•・]\s+(.*)$/))) return (m[1].length >= 2 ? '　' : '') + '・' + m[2].trim();
    if ((m = l.match(/^(\s*)(\d+)[.)．]\s+(.*)$/))) return (m[1].length >= 2 ? '　' : '') + m[2] + '. ' + m[3].trim();
    if ((m = l.match(/^#{3,}\s*(.*)$/))) return '▼ ' + m[1].trim();
    return l.trim();
  }
  function isEmptyBody(lines) {
    var t = lines.join('').replace(/[・\s　()（）]/g, '');
    return !t || /^(該当なし|なし|特になし|記載なし|未確認)$/.test(t);
  }
  function parseSections(md) {
    var out = [], cur = null, pre = [];
    String(md || '').replace(/\r/g, '').split('\n').forEach(function (raw) {
      var h = raw.match(/^##\s+(.*)$/);
      if (h) { cur = { title: cleanInline(h[1]).replace(/^[^\wぁ-んァ-ヶ一-龠]+/, '').trim(), lines: [] }; out.push(cur); return; }
      if (/^#\s+/.test(raw)) return;                 // 大見出しは捨てる
      var l = cleanLine(raw);
      if (!l) return;
      if (cur) cur.lines.push(l); else pre.push(l);
    });
    out = out.filter(function (s) { return !isEmptyBody(s.lines); });
    return { pre: pre, sections: out };
  }
  // 見出しの言葉から、報告書のどの欄に入れるかを決める（上から順に当てる）
  var KINDS = [
    ['legal', /重要事項|書類|書面|交付/],
    ['todo', /TODO|todo|ToDo|次回まで|アクション|やること|宿題|タスク/],
    ['risk', /懸念|リスク|注意|課題/],
    ['decided', /決定|合意|結論|決まった/],
    ['proposal', /提案|推奨|プラン/],
    ['numbers', /数字|試算|金額|シミュレーション/],
    ['intent', /意向|要望|関心|ニーズ|希望|悩み/],
    ['status', /現在|現況|状況|家族|収支|既契約|資産/],
    ['next', /次回|今後/]
  ];
  function kindOf(title) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(title)) return KINDS[i][0];
    return 'other';
  }
  function bucket(rec) {
    var p = parseSections(rec.summary);
    var b = { pre: p.pre, other: [] };
    p.sections.forEach(function (s) {
      var k = kindOf(s.title);
      if (k === 'other') { b.other.push(s); return; }
      if (b[k]) b[k] = b[k].concat(s.lines); else b[k] = s.lines.slice();
    });
    // 「次回までのTODO」の欄が無いときは、保存してある TODO から作る
    if (!b.todo && Array.isArray(rec.tasks) && rec.tasks.length) {
      b.todo = rec.tasks.map(function (t) {
        if (!t) return '';
        var text = typeof t === 'string' ? t : (t.task || t.title || '');
        var due = typeof t === 'string' ? '' : (t.dueDate || t.due || '');
        return text ? '・' + cleanInline(text) + (due ? '（' + due + '）' : '') : '';
      }).filter(Boolean);
      if (!b.todo.length) delete b.todo;
    }
    if (!b.next && rec.next) b.next = [cleanInline(rec.next)];
    return b;
  }

  /* ---------- 文章に組む ---------- */
  function fpName() {
    try { return String((window.__fp && window.__fp.tenantName) || '').replace(/ — DEMO ビュー/, '').trim(); } catch (_) { return ''; }
  }
  function methodText(rec) {
    var base = rec.manual ? '対面・電話など（手入力の記録）' : (/zoom/i.test(String(rec.source || '')) || rec.zN ? 'Zoom' : '面談');
    if (!rec.manual && rec.zN && rec.zN !== '?') base += '（' + rec.zN + '回目）';
    return base;
  }
  function headLines(rec, opts, label) {
    var out = ['【' + label + '】'];
    var w = whenText(rec);
    if (w) out.push('面談日時：' + w + (rec.durationMin ? '（約' + rec.durationMin + '分）' : ''));
    out.push('お客様：' + (opts.mask ? '（お名前は伏せています）' : (rec.clientName ? rec.clientName + ' 様' : '')));
    out.push('面談方法：' + methodText(rec));
    var fp = opts.fp != null ? opts.fp : fpName();
    if (fp) out.push('担当：' + fp);
    return out;
  }
  function block(title, lines) {
    return ['', '■ ' + title].concat(lines);
  }
  var NONE = '（この面談の議事録には記録がありません）';

  function buildStd(rec, opts) {
    var b = bucket(rec), out = headLines(rec, opts, '面談報告書');
    var ov = cleanInline(rec.overview || '').trim();
    if (ov) out = out.concat(block('面談の要点', [ov]));
    else if (b.pre.length) out = out.concat(block('面談の要点', b.pre));
    [['intent', 'ご意向・ご要望'], ['status', '現在のご状況'], ['proposal', 'ご提案した内容と、その理由'], ['numbers', '話に出た数字・試算'],
     ['decided', '決定事項'], ['todo', '次回までにやること'], ['risk', '懸念事項・リスク'], ['legal', '説明した重要事項・お渡しした書類']].forEach(function (x) {
      if (b[x[0]] && b[x[0]].length) out = out.concat(block(x[1], b[x[0]]));
    });
    b.other.forEach(function (s) { out = out.concat(block(s.title, s.lines)); });
    if (b.next && b.next.length) out = out.concat(block('次回に向けて', b.next));
    return out.join('\n');
  }
  function buildShort(rec, opts) {
    var b = bucket(rec);
    var w = whenText(rec);
    var who = opts.mask ? 'お客様' : (rec.clientName ? rec.clientName + ' 様' : '');
    var out = ['【面談報告】' + [w, who].filter(Boolean).join('　') + '（' + (rec.manual ? '対面・電話など' : methodText(rec).replace('（', ' ').replace('）', '')) + (rec.durationMin ? '・約' + rec.durationMin + '分' : '') + '）'];
    var ov = cleanInline(rec.overview || '').trim();
    if (ov) out = out.concat(block('要点', [ov]));
    if (b.decided && b.decided.length) out = out.concat(block('決定事項', b.decided));
    if (b.todo && b.todo.length) out = out.concat(block('次回までにやること', b.todo));
    if (b.risk && b.risk.length) out = out.concat(block('気をつけること', b.risk));
    if (b.next && b.next.length) out = out.concat(block('次回に向けて', b.next));
    if (out.length === 1) {   // まとめが見出しに分かれていない古い議事録
      var body = b.pre.concat.apply(b.pre, b.other.map(function (s) { return ['▼ ' + s.title].concat(s.lines); }));
      ['intent', 'status', 'proposal', 'numbers', 'legal'].forEach(function (k) { if (b[k]) body = body.concat(b[k]); });
      if (body.length) out = out.concat(block('内容', body));
    }
    return out.join('\n');
  }
  function buildIntent(rec, opts) {
    var b = bucket(rec), out = headLines(rec, opts, '意向把握・ご提案の記録');
    [['intent', '1. お客様のご意向・ご要望'], ['status', '2. 現在のご状況'], ['proposal', '3. ご提案した内容と、その理由'],
     ['legal', '4. 説明した重要事項・お渡しした書類'], ['decided', '5. 本日の決定事項']].forEach(function (x) {
      out = out.concat(block(x[1], (b[x[0]] && b[x[0]].length) ? b[x[0]] : [NONE]));
    });
    if (b.risk && b.risk.length) out = out.concat(block('6. 懸念事項・リスク', b.risk));
    return out.join('\n');
  }
  function buildAll(recs, opts) {
    var list = recs.slice().sort(function (a, b) { return sortKey(a) - sortKey(b); });
    if (!list.length) return '';
    var who = opts.mask ? 'お客様' : (list[0].clientName ? list[0].clientName + ' 様' : 'お客様');
    var out = ['【面談の経過】' + who + '（全' + list.length + '回）'];
    var fp = opts.fp != null ? opts.fp : fpName();
    if (fp) out.push('担当：' + fp);
    list.forEach(function (rec, i) {
      var b = bucket(rec);
      out.push('');
      out.push('● ' + (i + 1) + '回目　' + [whenText(rec), methodText(rec).replace(/（\d+回目）/, '')].filter(Boolean).join('　'));
      var ov = cleanInline(rec.overview || '').trim();
      if (ov) out.push('要点：' + ov);
      if (b.decided && b.decided.length) { out.push('決定事項：'); out = out.concat(b.decided); }
      if (b.todo && b.todo.length) { out.push('次回までにやること：'); out = out.concat(b.todo); }
      if (!ov && !(b.decided && b.decided.length) && !(b.todo && b.todo.length)) {
        var any = b.pre.concat(b.intent || [], b.status || [], b.proposal || []).slice(0, 4);
        out = out.concat(any.length ? any : ['（まとめがまだありません）']);
      }
    });
    return out.join('\n');
  }
  function maskNames(text, clientName) {
    var full = String(clientName || '').trim();
    if (!full) return text;
    var escRe = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var parts = full.split(/[\s　]+/).filter(Boolean);
    var out = text;
    var fullRe = new RegExp(parts.map(escRe).join('[\\s　]*') + '[\\s　]*(様|さん|さま|氏)?', 'g');
    out = out.replace(fullRe, 'お客様');
    if (parts.length > 1 && parts[0].length >= 2) out = out.replace(new RegExp(escRe(parts[0]) + '[\\s　]*(様|さん|さま|氏)', 'g'), 'お客様');
    return out;
  }
  function build(rec, opts) {
    opts = opts || {};
    var mode = opts.mode || 'std';
    var text;
    if (mode === 'all') text = buildAll(opts.all || [rec], opts);
    else if (mode === 'short') text = buildShort(rec, opts);
    else if (mode === 'intent') text = buildIntent(rec, opts);
    else text = buildStd(rec, opts);
    if (opts.mask) text = maskNames(text, rec.clientName);
    return text.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* ---------- カードに出すボタン ---------- */
  function buttonHtml(ai, client, booking, zN) {
    try {
      ai = ai || {}; client = client || {}; booking = booking || {};
      var summary = String(ai.summary || ai.transcript_summary || '').trim();
      if (!summary) return '';
      var cid = String(client._fsCustomerId || client.id || client.lineFriendId || client.name || '');
      var ts = ai.ts || ai.createdAt || '';
      var key = cid + '|' + (ai.bookingTs || booking.ts || '') + '|' + ts;
      store.set(key, {
        key: key, clientId: cid, clientName: String(client.name || ai.customerName || '').trim(),
        ts: ts, date: ai.date || booking.date || '', time: booking.time || '',
        zN: zN == null ? '' : String(zN), source: ai.source || '',
        manual: !!(ai.source && /manual/.test(String(ai.source))) || ai.manual === true,
        durationMin: Number(ai.zoomDurationMin) > 0 ? Math.round(Number(ai.zoomDurationMin)) : 0,
        summary: summary, overview: String(ai.transcript_summary || '').trim(),
        tasks: Array.isArray(ai.tasks) ? ai.tasks : [], next: String(ai.next_meeting_suggestion || '').trim()
      });
      return '<button type="button" class="fpmr-open" data-fpmr="' + esc(key) + '">' + ICON_DOC + '<span>報告書にまとめる</span></button>';
    } catch (e) { return ''; }
  }
  var ICON_DOC = '<svg class="fpmr-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>';
  var ICON_X = '<svg class="fpmr-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  // いま画面に出ている、同じお客様の面談
  function siblings(rec) {
    var out = [];
    document.querySelectorAll('[data-fpmr]').forEach(function (el) {
      var r = store.get(el.getAttribute('data-fpmr'));
      if (r && r.clientId === rec.clientId && out.indexOf(r) < 0) out.push(r);
    });
    return out.length ? out : [rec];
  }

  /* ---------- 画面 ---------- */
  var CSS = [
    '.fpmr-open{display:inline-flex!important;align-items:center!important;gap:6px!important;min-height:34px!important;padding:5px 12px!important;border:0!important;border-radius:10px!important;background:linear-gradient(180deg,#5B54EA 0%,#4A41E0 100%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 1px 2px rgba(49,46,129,.3),0 3px 8px rgba(79,70,229,.2)!important;color:#fff!important;font-family:inherit!important;font-size:13px!important;font-weight:700!important;letter-spacing:0!important;text-transform:none!important;cursor:pointer;white-space:nowrap}',
    '.fpmr-open span{color:#fff!important;background:transparent!important;padding:0!important;font-size:13px!important}',
    '.fpmr-open .fpmr-svg{flex:none;color:#fff!important;stroke:currentColor!important;width:16px!important;height:16px!important}',
    '.fpmr-open:hover{filter:brightness(1.06)}',
    '.fpmr-ov{position:fixed;inset:0;z-index:10700;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.45);font-family:"Noto Sans JP",-apple-system,BlinkMacSystemFont,sans-serif;color:#0F172A}',
    '.fpmr-box{display:flex;flex-direction:column;width:min(760px,100%);max-height:min(860px,100%);background:#fff;border:1px solid #E6E8EC;border-radius:16px;box-shadow:0 2px 6px rgba(15,23,42,.06),0 24px 60px rgba(15,23,42,.18);overflow:hidden}',
    '.fpmr-box:focus{outline:none}',
    '.fpmr-hd{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 20px;border-bottom:1px solid #E6E8EC}',
    '.fpmr-h{flex:1;min-width:0;margin:0;font-size:17px;font-weight:700;line-height:1.5;color:#0F172A}',
    '.fpmr-x{flex:none;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:0!important;border-radius:10px!important;background:transparent!important;box-shadow:none!important;color:#475569!important;cursor:pointer}',
    '.fpmr-x:hover{background:#F1F3F6!important}',
    '.fpmr-bd{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px 20px;overflow:auto}',
    '.fpmr-seg{display:flex;gap:4px;padding:4px;border-radius:12px;background:#F1F3F6}',
    '.fpmr-seg button{flex:1 1 0;min-width:0;min-height:40px;padding:6px 8px;border:0!important;border-radius:9px!important;background:transparent!important;box-shadow:none!important;color:#475569!important;font-family:inherit;font-size:13.5px!important;font-weight:700!important;line-height:1.3;cursor:pointer}',
    '.fpmr-seg button[aria-pressed="true"]{background:#fff!important;box-shadow:0 1px 2px rgba(15,23,42,.12)!important;color:#3730A3!important}',
    '.fpmr-opt{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
    '.fpmr-chk{display:inline-flex;align-items:center;gap:8px;min-height:44px;font-size:13.5px;font-weight:500;color:#0F172A;cursor:pointer}',
    '.fpmr-chk input{width:18px;height:18px;margin:0;accent-color:#4F46E5}',
    '.fpmr-note{margin:0;font-size:12.5px;line-height:1.7;color:#475569}',
    '.fpmr-ta{flex:1 1 auto;width:100%;min-height:300px;box-sizing:border-box;padding:14px 16px;border:1px solid #D5D9E0!important;border-radius:12px!important;background:#fff!important;box-shadow:inset 0 1px 2px rgba(15,23,42,.05);color:#0F172A!important;font-family:inherit;font-size:14px;line-height:1.85;resize:vertical;white-space:pre-wrap}',
    '.fpmr-ta:focus{border-color:#4F46E5!important;box-shadow:0 0 0 3px rgba(79,70,229,.16);outline:none}',
    '.fpmr-ft{display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid #E6E8EC;background:#fff}',
    '.fpmr-msg{flex:1;min-width:0;font-size:13px;font-weight:700;color:#047647}',
    '.fpmr-2nd{min-height:44px;padding:0 16px;border:1px solid #D5D9E0!important;border-radius:10px!important;background:#fff!important;box-shadow:0 1px 2px rgba(15,23,42,.06)!important;color:#0F172A!important;font-family:inherit;font-size:14px!important;font-weight:700!important;cursor:pointer;white-space:nowrap}',
    '.fpmr-go{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 20px;border:0!important;border-radius:10px!important;background:linear-gradient(180deg,#5B54EA 0%,#4A41E0 100%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 1px 2px rgba(49,46,129,.35),0 6px 14px rgba(79,70,229,.25)!important;color:#fff!important;font-family:inherit;font-size:14.5px!important;font-weight:700!important;cursor:pointer;white-space:nowrap}',
    '#fpmr-print{display:none}',
    '@media (max-width:768px){.fpmr-ov{padding:0;align-items:stretch}.fpmr-box{width:100%;max-height:none;height:100%;border:0;border-radius:0}.fpmr-hd{padding:calc(8px + env(safe-area-inset-top,0px)) 8px 8px 16px}.fpmr-bd{padding:12px 16px}.fpmr-seg{flex-wrap:wrap}.fpmr-seg button{flex:1 1 calc(50% - 4px);min-height:44px}.fpmr-ta{font-size:16px;min-height:240px}.fpmr-ft{flex-wrap:wrap;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px))}.fpmr-msg{flex:1 1 100%;min-height:18px}.fpmr-2nd{flex:1 1 0}.fpmr-go{flex:2 1 0;justify-content:center}.fpmr-open{min-height:36px!important}}',
    '@media print{html.fpmr-printing body>*:not(#fpmr-print){display:none!important}html.fpmr-printing #fpmr-print{display:block!important;white-space:pre-wrap;font-family:"Noto Sans JP",sans-serif;font-size:11pt;line-height:1.8;color:#000;padding:0;margin:0}}'
  ].join('\n');
  function ensureCss() {
    if (document.getElementById('fpmr-css')) return;
    var st = document.createElement('style'); st.id = 'fpmr-css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  var MODES = [['std', '標準'], ['short', '短く（日報向け）'], ['intent', '意向把握の記録'], ['all', '経過（全部の面談）']];
  function currentText() {
    var rec = store.get(ui.key);
    if (!rec) return '';
    return build(rec, { mode: ui.mode, mask: ui.mask, all: siblings(rec) });
  }
  function paint(keepText) {
    var ov = document.getElementById('fpmr-ov');
    if (!ov) return;
    ov.querySelectorAll('.fpmr-seg button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.mode === ui.mode ? 'true' : 'false'); });
    var ta = ov.querySelector('.fpmr-ta');
    if (!keepText) { ta.value = currentText(); ui.edited = false; ta.scrollTop = 0; }
    ov.querySelector('.fpmr-msg').textContent = '';
  }
  function open(key) {
    var rec = store.get(key);
    if (!rec) return;
    ensureCss();
    close();
    ui.key = key; ui.mask = false; ui.edited = false;
    try { var m = localStorage.getItem(MODE_KEY); if (m && MODES.some(function (x) { return x[0] === m; })) ui.mode = m; } catch (_) {}
    var n = siblings(rec).length;
    var ov = document.createElement('div');
    ov.id = 'fpmr-ov'; ov.className = 'fpmr-ov';
    ov.innerHTML =
      '<div class="fpmr-box" role="dialog" aria-modal="true" aria-labelledby="fpmr-h" tabindex="-1">' +
        '<div class="fpmr-hd"><h2 class="fpmr-h" id="fpmr-h">報告書にまとめる</h2><button type="button" class="fpmr-x" data-fpmr-act="close" aria-label="報告書の画面を閉じる">' + ICON_X + '</button></div>' +
        '<div class="fpmr-bd">' +
          '<div class="fpmr-seg" role="group" aria-label="報告書の形">' + MODES.map(function (x) {
            return '<button type="button" data-mode="' + x[0] + '" aria-pressed="false">' + esc(x[0] === 'all' ? '経過（全' + n + '回）' : x[1]) + '</button>';
          }).join('') + '</div>' +
          '<div class="fpmr-opt"><label class="fpmr-chk"><input type="checkbox" data-fpmr-act="mask"><span>お客様の名前を伏せる</span></label></div>' +
          '<textarea class="fpmr-ta" aria-label="報告書の文章（そのまま直せます）" spellcheck="false"></textarea>' +
          '<p class="fpmr-note">AI がまとめた議事録から組み直した文章です。この欄でそのまま直せます。出す前に内容を確認してください。</p>' +
        '</div>' +
        '<div class="fpmr-ft"><span class="fpmr-msg" role="status" aria-live="polite"></span>' +
          '<button type="button" class="fpmr-2nd" data-fpmr-act="print">印刷・PDF</button>' +
          ((navigator.share || window.FP_NATIVE) ? '<button type="button" class="fpmr-2nd" data-fpmr-act="share">共有</button>' : '') +
          '<button type="button" class="fpmr-go" data-fpmr-act="copy">コピーする</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    paint(false);
    try { ov.querySelector('.fpmr-box').focus(); } catch (_) {}
  }
  function close() {
    var ov = document.getElementById('fpmr-ov');
    if (ov) ov.remove();
  }
  function say(msg) {
    var ov = document.getElementById('fpmr-ov');
    if (ov) ov.querySelector('.fpmr-msg').textContent = msg;
  }
  function copyText(text) {
    var ta = document.querySelector('#fpmr-ov .fpmr-ta');
    var fallback = function () {
      try { ta.focus(); ta.select(); var ok = document.execCommand('copy'); say(ok ? 'コピーしました' : '文章を選びました。長押しでコピーしてください'); }
      catch (_) { say('文章を選びました。長押しでコピーしてください'); }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { say('コピーしました'); }, fallback);
      else fallback();
    } catch (_) { fallback(); }
  }
  function printText(text) {
    var el = document.getElementById('fpmr-print');
    if (!el) { el = document.createElement('div'); el.id = 'fpmr-print'; document.body.appendChild(el); }
    el.textContent = text;
    var root = document.documentElement;
    root.classList.add('fpmr-printing');
    var done = function () { root.classList.remove('fpmr-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (_) { say('この画面では印刷を開けませんでした。コピーしてお使いください'); }
    setTimeout(done, 60000);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var opener = t.closest('[data-fpmr]');
    if (opener) { e.preventDefault(); e.stopPropagation(); open(opener.getAttribute('data-fpmr')); return; }
    var ov = document.getElementById('fpmr-ov');
    if (!ov) return;
    if (t === ov) { close(); return; }
    var seg = t.closest('.fpmr-seg button');
    if (seg && ov.contains(seg)) {
      if (ui.edited && !window.confirm('形を切り替えると、手で直した内容は消えます。切り替えますか？')) return;
      ui.mode = seg.dataset.mode;
      try { localStorage.setItem(MODE_KEY, ui.mode); } catch (_) {}
      paint(false); return;
    }
    var act = t.closest('[data-fpmr-act]');
    if (!act || !ov.contains(act)) return;
    var a = act.getAttribute('data-fpmr-act');
    var text = ov.querySelector('.fpmr-ta').value;
    if (a === 'close') close();
    else if (a === 'copy') copyText(text);
    else if (a === 'print') {
      // iPhone アプリの中: 画面の印刷は使えないので、 アプリ本体の印刷を呼ぶ
      if (window.FP_NATIVE && window.FpNative) window.FpNative.printText(text, '面談の報告書').catch(function () { copyText(text); });
      else printText(text);
    }
    else if (a === 'share') {
      if (window.FP_NATIVE && window.FpNative && window.FpNative.info()) window.FpNative.share(text, '面談の報告書').catch(function () {});
      else { try { navigator.share({ text: text }).catch(function () {}); } catch (_) { copyText(text); } }
    }
  }, true);
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches('#fpmr-ov [data-fpmr-act="mask"]')) return;
    if (ui.edited && !window.confirm('名前の出し方を変えると、手で直した内容は消えます。変えますか？')) { t.checked = ui.mask; return; }
    ui.mask = !!t.checked; paint(false);
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.matches && e.target.matches('#fpmr-ov .fpmr-ta')) { ui.edited = true; say(''); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('fpmr-ov')) { e.stopPropagation(); close(); }
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureCss); else ensureCss();

  window.FpMinutesReport = { buttonHtml: buttonHtml, build: build, parseSections: parseSections, open: open, close: close, _store: store, _kindOf: kindOf, _whenText: whenText, _mask: maskNames };
})();
