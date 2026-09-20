/* manual-meeting.js — 面談 を 手入力 して 記録 に 残す  (v20260920A)
   ------------------------------------------------------------------
   2026-09-20 owner fb:
     「新規顧客登録を手動でした際、その顧客との前回面談のデータを手動で
       入力や登録ができる機能。 その時に前回の面談内容も手動で入力できると良い」
   → 録音 も Zoom も 通ら ない 面談 (過去 の 面談 · 対面 · 電話) を
     後から 議事録 タブ に 入れられる ように する。
   保存先 は 音声 upload と 完全 に 同じ /api/save-ai-result
   (Firestore /customers/{cid}/meetings + GAS sheet の dual-write)。
   source:'manual' を 付けて、 カード 表示 だけ
   「Zoom N回目 / 録画開始」 では なく 「手入力」 に する。
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var CLOUD_RUN = 'https://fp-compass-webhook-527726449426.asia-northeast1.run.app';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // YYYY-MM-DD + HH:MM (JST) → ISO 文字列
  function toIsoJst(date, time) {
    var t = /^\d{1,2}:\d{2}$/.test(time || '') ? time : '10:00';
    if (t.length === 4) t = '0' + t;
    var d = new Date(date + 'T' + t + ':00+09:00');
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function todayJst() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  /* ---- 保存 ---------------------------------------------------- */
  async function save(opts) {
    opts = opts || {};
    var date = opts.date, body = String(opts.body || '').trim();
    if (!date) throw new Error('面談日 を 入れて ください');
    if (body.length < 10) throw new Error('面談 の 内容 を 10 字 以上 入れて ください');

    var iso = toIsoJst(date, opts.time);
    var entry = {
      bookingTs: 'manual-' + Date.parse(iso) + '-' + Math.random().toString(36).slice(2, 7),
      ts: iso,
      createdAt: iso,
      userId: opts.customerId || opts.lineFriendId || '',
      customerName: opts.customerName || '',
      date: date,
      title: String(opts.title || '').trim() || '面談 記録 (手入力)',
      transcript: '',
      summary: body,
      transcript_summary: '',
      key_concerns: Array.isArray(opts.concerns) ? opts.concerns.filter(Boolean) : [],
      predicted_next_questions: [],
      next_meeting_suggestion: '',
      source: 'manual',
    };

    var headers = await (window.getFpAuthHeaders
      ? window.getFpAuthHeaders()
      : Promise.resolve({ 'Content-Type': 'application/json' }));
    var res = await fetch(CLOUD_RUN + '/api/save-ai-result', {
      method: 'POST', headers: headers, body: JSON.stringify({ entry: entry, tasks: [] }),
    });
    var data = {};
    try { data = await res.json(); } catch (_) {}
    if (!data.ok) throw new Error(data.error || ('保存 に 失敗 しました (HTTP ' + res.status + ')'));
    if (data.skipped) throw new Error('内容 が 空 と 判定 され 保存 され ません でした');

    // ※ ここで window.LineAppLiveData.ai_results に push しない。
    //   議事録 タブ は click の たび に ai_results を空にして サーバから 取り直す 作り なので
    //   push しても 必ず 捨てられ、 捨てられ なかった 場合 は 同じ 議事録 が 2 枚 出る。
    //   表示 は 既存 の 取得 経路 に 任せる (保存 は 完了 して いる)。
    return entry;
  }

  /* ---- 入力フォーム (overlay) ---------------------------------- */
  function open(opts) {
    opts = opts || {};
    var name = opts.customerName || 'お客様';
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;font-family:"Noto Sans JP","Hiragino Sans",sans-serif;';
    ov.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:22px;max-width:520px;width:100%;max-height:88vh;overflow-y:auto;box-shadow:0 24px 60px rgba(15,23,42,0.35);">' +
        '<div style="font-size:12.5px;font-weight:800;color:#0F766E;letter-spacing:0.14em;margin-bottom:6px;">MANUAL MEETING · ' + esc(name) + ' 様</div>' +
        '<h2 style="font-size:18px;font-weight:900;color:#0F172A;margin:0 0 10px;">面談 を 手入力</h2>' +
        '<p style="font-size:12.5px;color:#334155;line-height:1.7;margin:0 0 16px;">録音 の ない 面談 (過去 の 面談 · 対面 · 電話) を 記録 に 残します。 保存 する と 議事録 タブ に 並び、 AI の 提案 に も 使われ ます。</p>' +
        '<div style="display:flex;gap:10px;margin-bottom:12px;">' +
          '<div style="flex:2;"><label style="display:block;font-size:12.5px;font-weight:800;color:#475569;margin-bottom:4px;">面談日 <span style="color:#DC2626;">*</span></label>' +
          '<input type="date" id="fmm-date" value="' + esc(opts.date || todayJst()) + '" style="width:100%;padding:12px;min-height:46px;border:1.5px solid #CBD5E1;border-radius:9px;font-family:inherit;font-size:13.5px;box-sizing:border-box;color:#0F172A;"></div>' +
          '<div style="flex:1;"><label style="display:block;font-size:12.5px;font-weight:800;color:#475569;margin-bottom:4px;">時刻</label>' +
          '<input type="time" id="fmm-time" value="10:00" style="width:100%;padding:12px;min-height:46px;border:1.5px solid #CBD5E1;border-radius:9px;font-family:inherit;font-size:13.5px;box-sizing:border-box;color:#0F172A;"></div>' +
        '</div>' +
        '<div style="margin-bottom:12px;"><label style="display:block;font-size:12.5px;font-weight:800;color:#475569;margin-bottom:4px;">議題</label>' +
        '<input type="text" id="fmm-title" placeholder="例: 教育費 と 住宅ローン の 見直し" style="width:100%;padding:12px;min-height:46px;border:1.5px solid #CBD5E1;border-radius:9px;font-family:inherit;font-size:13.5px;box-sizing:border-box;color:#0F172A;"></div>' +
        '<div style="margin-bottom:6px;"><label style="display:block;font-size:12.5px;font-weight:800;color:#475569;margin-bottom:4px;">面談 の 内容 <span style="color:#DC2626;">*</span></label>' +
        '<textarea id="fmm-body" placeholder="話した こと を そのまま 書いて ください。&#10;&#10;例:&#10;・ お子様 の 進学 先 が 私立 に なり そう。 教育費 を 組み 直したい&#10;・ 住宅ローン は 残り 25 年、 借換え に 関心 あり&#10;・ 次回 まで に 給与 明細 を 用意 して もらう" style="width:100%;min-height:200px;padding:12px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-family:inherit;font-size:13.5px;line-height:1.75;resize:vertical;box-sizing:border-box;color:#0F172A;"></textarea></div>' +
        '<div id="fmm-count" style="font-size:13px;color:#64748B;font-weight:700;text-align:right;margin-bottom:12px;">0 字</div>' +
        '<div style="margin-bottom:16px;"><label style="display:block;font-size:12.5px;font-weight:800;color:#475569;margin-bottom:4px;">お客様 の 関心事 (任意 · 読点 区切り)</label>' +
        '<input type="text" id="fmm-concerns" placeholder="例: 教育費、住宅ローン、老後資金" style="width:100%;padding:12px;min-height:46px;border:1.5px solid #CBD5E1;border-radius:9px;font-family:inherit;font-size:13.5px;box-sizing:border-box;color:#0F172A;"></div>' +
        '<div id="fmm-msg" style="font-size:13px;font-weight:700;margin-bottom:8px;min-height:18px;"></div>' +
        '<div style="display:flex;gap:10px;">' +
          '<button id="fmm-cancel" style="flex:1;padding:12px;background:#F1F5F9;color:#334155;border:none;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">キャンセル</button>' +
          '<button id="fmm-submit" style="flex:2;padding:12px;background:linear-gradient(135deg,#0F766E,#0D5F58);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(15,118,110,0.30);">記録 に 残す →</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    function close() { try { document.body.removeChild(ov); } catch (_) {} }
    var ta = ov.querySelector('#fmm-body');
    var cc = ov.querySelector('#fmm-count');
    var msg = ov.querySelector('#fmm-msg');
    var btn = ov.querySelector('#fmm-submit');
    ta.addEventListener('input', function () { cc.textContent = ta.value.length + ' 字'; });
    ov.querySelector('#fmm-cancel').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    setTimeout(function () { ta.focus(); }, 60);

    btn.addEventListener('click', async function () {
      msg.style.color = '#64748B';
      msg.textContent = '';
      var concerns = String(ov.querySelector('#fmm-concerns').value || '')
        .split(/[、,]/).map(function (s) { return s.trim(); }).filter(Boolean);
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.textContent = '保存中…';
      try {
        var entry = await save({
          customerId: opts.customerId,
          customerName: opts.customerName,
          lineFriendId: opts.lineFriendId,
          date: ov.querySelector('#fmm-date').value,
          time: ov.querySelector('#fmm-time').value,
          title: ov.querySelector('#fmm-title').value,
          body: ta.value,
          concerns: concerns,
        });
        close();
        if (typeof opts.onSaved === 'function') opts.onSaved(entry);
      } catch (e) {
        msg.style.color = '#B91C1C';
        msg.textContent = '⚠ ' + (e && e.message ? e.message : e);
        btn.disabled = false;
        btn.style.opacity = '';
        btn.textContent = '記録 に 残す →';
      }
    });
  }

  window.FpManualMeeting = { save: save, open: open, toIsoJst: toIsoJst, todayJst: todayJst };
})();
