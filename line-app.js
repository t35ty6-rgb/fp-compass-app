// LINE公式連携 UIロジック
// サブタブ7つ: 配信ダッシュボード / セグメント / スケジュール / テンプレ / 誕生日 / ログ / 設定

(function () {
  const TODAY = window.LineCRM.TODAY;
  let currentSubview = 'leadHub';

  function fmtMoney(n) {
    if (n >= 100_000_000) return (n / 100_000_000).toFixed(2).replace(/\.?0+$/, '') + '億';
    if (n >= 10_000) return Math.round(n / 10_000).toLocaleString() + '万';
    return n.toLocaleString();
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }
  function nl2br(s) {
    return escapeHtml(s).replace(/\n/g, '<br>');
  }
  function fmtDate(d) {
    if (typeof d === 'string') d = new Date(d);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  // ============================
  // サブタブ切替
  // ============================
  function activateSubview(name) {
    currentSubview = name;
    document.querySelectorAll('.line-subtab').forEach(t => {
      t.classList.toggle('active', t.dataset.lineSub === name);
    });
    document.querySelectorAll('.line-subview').forEach(v => {
      v.classList.toggle('active', v.dataset.lineView === name);
    });
    if (name === 'leadHub') renderLeadHub();
    if (name === 'distributionHub') renderDistributionHub();
    if (name === 'birthdayTab') renderBirthdayTab();
    if (name === 'calendarTab') renderCalendarTab();
    if (name === 'settingsHub') renderSettingsHub();
    if (name === 'dormantFollowup') renderDormantFollowup();
    if (name === 'tagsHub') renderTagsHub();
  }

  // ============================
  // 🎂 誕生日メッセージタブ (独立)
  // ============================
  function renderBirthdayTab() {
    fetchLiveData().then(() => { if (currentSubview === 'birthdayTab') renderBirthdayTabInner(); });
    renderBirthdayTabInner();
  }
  function renderBirthdayTabInner() {
    const v = document.querySelector('[data-line-view="birthdayTab"]');
    if (!v) return;
    const upcoming = window.LineCRM.upcomingBirthdays(90);
    const today = upcoming.filter(b => b.daysAhead === 0);
    const week = upcoming.filter(b => b.daysAhead > 0 && b.daysAhead <= 7);
    const month = upcoming.filter(b => b.daysAhead > 7 && b.daysAhead <= 30);
    const total = upcoming.length;

    // SVG icons (line-art, monochrome)
    const icoCake = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21V10a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11"/><path d="M4 13h16"/><path d="M8 8V5a2 2 0 1 1 4 0v3"/><path d="M16 8V5a2 2 0 1 1 4 0v3"/><circle cx="12" cy="4" r="1"/></svg>';
    const icoCal = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    const icoCal2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="1.5" fill="currentColor"/></svg>';
    const icoChart = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>';
    const accents = ['#c1272d', '#b8893d', '#1b2845', '#2d7d4e'];

    v.innerHTML = `
      <div class="section-title" data-eyebrow="Birthday Auto-Message">誕生日メッセージ</div>
      <p class="section-sub">お客様 + ご家族 (配偶者・お子様) の誕生日を90日先まで自動検出 → 当日朝9時に自動でお祝いLINE送信</p>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px;">
        ${[
          { ic: icoCake, label: 'Today', title: '今日の誕生日', count: today.length, unit: '名', desc: '9:00 に自動でお祝いLINE送信予定', accent: accents[0], active: today.length > 0 },
          { ic: icoCal, label: 'This Week', title: '1〜7日後の誕生日', count: week.length, unit: '名', desc: '直近対象 / 各日9:00に順次配信', accent: accents[1], active: week.length > 0 },
          { ic: icoCal2, label: 'This Month', title: '8〜30日後の誕生日', count: month.length, unit: '名', desc: 'スケジュール済', accent: accents[2], active: month.length > 0 },
          { ic: icoChart, label: 'Total', title: '90日先までの総数', count: total, unit: '名', desc: '本人+配偶者+子供 すべて自動検出', accent: accents[3], active: total > 0 },
        ].map(c => `
          <div style="background:#fff;border:1px solid #e0d8c0;border-top:4px solid ${c.accent};padding:24px 22px 22px;box-shadow:0 2px 8px rgba(15,23,41,0.04),0 8px 24px rgba(15,23,41,0.04);position:relative;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;background:${c.accent}12;color:${c.accent};border:1px solid ${c.accent}33;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${c.ic.replace(/<svg[^>]*>/, '').replace('</svg>', '')}</svg>
              </span>
              <span style="font-family:'Inter',sans-serif;font-size:9.5px;font-weight:800;color:${c.accent};letter-spacing:0.22em;text-transform:uppercase;">${c.label}</span>
            </div>
            <div style="font-family:'Inter',sans-serif;font-size:36px;font-weight:900;line-height:1;letter-spacing:-0.03em;color:${c.active ? c.accent : '#0f1729'};">${c.count}<span style="font-size:13px;font-weight:600;color:#6b7280;margin-left:6px;">${c.unit}</span></div>
            <div style="margin-top:12px;font-size:12.5px;color:#0f1729;font-weight:700;letter-spacing:0.02em;">${c.title}</div>
            <div style="margin-top:4px;font-size:11px;color:#6b7280;line-height:1.55;">${c.desc}</div>
          </div>
        `).join('')}
      </div>

      <section class="board-section" style="margin-top:36px;">
        <div class="section-title" data-eyebrow="Today" style="margin-top:0 !important;">本日のお祝い対象 (9:00 自動送信)</div>
        ${renderBirthdayGroup(today, '今日対象なし')}
      </section>
      <section class="board-section">
        <div class="section-title" data-eyebrow="This Week">今週 (1〜7日後)</div>
        ${renderBirthdayGroup(week, '今週はありません')}
      </section>
      <section class="board-section">
        <div class="section-title" data-eyebrow="This Month">今月 (8〜30日後)</div>
        ${renderBirthdayGroup(month, '今月はありません')}
      </section>
    `;
  }
  function renderBirthdayGroup(list, emptyMsg) {
    if (list.length === 0) {
      return '<div style="background:var(--surface);border:1px dashed var(--line);border-radius:10px;padding:24px;text-align:center;color:var(--muted);font-size:13px;">' + emptyMsg + '</div>';
    }
    return list.map(b => `
      <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin-bottom:8px;display:grid;grid-template-columns:80px 1fr 140px;gap:16px;align-items:center;box-shadow:var(--shadow-xs);">
        <div>
          <div style="font-family:'Inter',sans-serif;font-size:18px;font-weight:700;letter-spacing:-0.01em;">${b.date.getMonth() + 1}/${b.date.getDate()}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;letter-spacing:0.04em;">${b.daysAhead === 0 ? '本日' : '+' + b.daysAhead + '日'}</div>
        </div>
        <div>
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
            <strong style="font-family:'Noto Sans JP',sans-serif;font-size:14.5px;">${escapeHtml(b.personName)}</strong>
            <span class="status-pill ${b.rel === '本人' ? 'important' : 'new'}">${escapeHtml(b.rel)}</span>
            <span style="font-size:11px;color:var(--muted);">${b.age}歳</span>
          </div>
          <div style="font-size:11.5px;color:var(--muted);margin-top:3px;">顧客: ${escapeHtml(b.client.name)} 様</div>
        </div>
        <div style="text-align:right;">
          ${b.daysAhead === 0
            ? '<span class="status-pill active">✓ 9:00 送信予定</span>'
            : '<span class="status-pill new">予約済</span>'}
        </div>
      </div>
    `).join('');
  }

  // ============================
  // 🎍 カレンダー配布タブ (独立)
  // ============================
  function renderCalendarTab() {
    fetchLiveData().then(() => { if (currentSubview === 'calendarTab') renderCalendarTabInner(); });
    renderCalendarTabInner();
  }
  function renderCalendarTabInner() {
    const v = document.querySelector('[data-line-view="calendarTab"]');
    if (!v) return;
    // ライブデータ + デモデータ補完 (LIVE が空 or 住所付きが0件ならデモ追加)
    let reqs = (liveData && liveData.calendar_requests) || [];
    let isDemo = false;
    const hasLiveCal = reqs.some(r => r.address || r.status);
    if (!hasLiveCal && window.CALENDAR_DEMO) {
      reqs = reqs.concat(window.CALENDAR_DEMO);
      isDemo = true;
    }
    const wantList = reqs.filter(r => r.status === '要' && r.address);
    const wantNoAddr = reqs.filter(r => r.status === '要' && !r.address);
    const notWant = reqs.filter(r => r.status === '不要');
    const noReply = reqs.filter(r => !r.status);
    const total = reqs.length;
    const cvr = total > 0 ? Math.round(wantList.length / total * 100) : 0;

    // Google マップ URL は addresses-only (名前ラベルは Google My Maps でないと不可)
    const buildRouteUrl = (items) => {
      if (items.length === 0) return '#';
      const enc = items.map(it => encodeURIComponent(it.address));
      const origin = enc[0];
      const destination = enc[enc.length - 1];
      const waypoints = enc.slice(1, -1).join('|');
      let url = 'https://www.google.com/maps/dir/?api=1&origin=' + origin + '&destination=' + destination;
      if (waypoints) url += '&waypoints=' + waypoints;
      url += '&travelmode=driving';
      return url;
    };
    const buildMapAllUrl = (items) => items.length === 0 ? '#' : 'https://www.google.com/maps/search/' + encodeURIComponent(items.map(it => it.address).join(' / '));
    const routeUrl = buildRouteUrl(wantList);
    const allMapUrl = buildMapAllUrl(wantList);

    v.innerHTML = `
      <h1 class="page-h1"><i data-lucide="calendar-days"></i><span>年末カレンダー配布</span></h1>
      <p class="page-sub">既存お客様にオリジナル卓上カレンダーを配布する企画 / LINE一斉配信→要不要回答→住所収集→Google地図でルート最適化</p>

      ${isDemo ? '<div class="demo-notice"><i data-lucide="info"></i><span>表示中のお客様データはサンプル(デモ用)。本番では実際のLINE回答が並びます。</span></div>' : ''}

      <div class="task-board">
        <a href="#cal-want" class="task-card ${wantList.length > 0 ? 'action' : 'muted'}">
          <div class="task-icon"><i data-lucide="gift"></i></div>
          <div class="task-label">配達対象</div>
          <div class="task-count">${wantList.length}<span class="unit">名</span></div>
          <div class="task-title">要(住所済) — 配達リスト</div>
          <div class="task-desc">下のリストでGoogleマップ ルート最適化</div>
        </a>
        <a href="#cal-waiting" class="task-card ${wantNoAddr.length > 0 ? 'urgent' : 'muted'}">
          <div class="task-icon"><i data-lucide="hourglass"></i></div>
          <div class="task-label">${wantNoAddr.length > 0 ? '住所待ち' : '待ちなし'}</div>
          <div class="task-count">${wantNoAddr.length}<span class="unit">名</span></div>
          <div class="task-title">要(住所未) — 住所入力待ち</div>
          <div class="task-desc">入力URL送信済 / お客様の返信待ち</div>
        </a>
        <a href="#cal-noreply" class="task-card ${noReply.length > 0 ? 'urgent' : 'muted'}">
          <div class="task-icon"><i data-lucide="mail-question"></i></div>
          <div class="task-label">未回答</div>
          <div class="task-count">${noReply.length}<span class="unit">名</span></div>
          <div class="task-title">未回答 — 再配信検討</div>
          <div class="task-desc">配信後 まだ反応なし</div>
        </a>
        <div class="task-card">
          <div class="task-icon"><i data-lucide="trending-up"></i></div>
          <div class="task-label">希望率</div>
          <div class="task-count">${cvr}<span class="unit">%</span></div>
          <div class="task-title">配達対象 / 回答総数</div>
          <div class="task-desc">${total}名中 ${wantList.length + wantNoAddr.length}名希望</div>
        </div>
      </div>

      <div class="cta-row">
        <button class="primary" id="cal-blast-btn" data-hint="全LINE友だちに『年末カレンダー要りますか?』配信。年1回だけ押す想定"><i data-lucide="send"></i><span>友だち全員に一斉配信</span></button>
        <a class="ghost-btn" href="${allMapUrl}" target="_blank" data-hint="希望者の住所をGoogleマップ上に全部ピン表示" ${wantList.length===0?'style="pointer-events:none;opacity:0.4;"':''}><i data-lucide="map"></i><span>全員の住所を地図表示</span></a>
        <a class="ghost-btn" href="${routeUrl}" target="_blank" data-hint="希望者全員を回る最適ルートをGoogleマップで生成。当日ナビとして使用" ${wantList.length===0?'style="pointer-events:none;opacity:0.4;"':''}><i data-lucide="route"></i><span>配達ルートを最適化 (Google マップ)</span></a>
        <span id="cal-blast-msg" style="font-size:12px;color:var(--muted);align-self:center;margin-left:auto;"></span>
      </div>

      <section class="board-section" id="cal-want">
        <h2><i data-lucide="gift"></i><span>配達リスト (住所登録済) — ${wantList.length}名</span></h2>
        ${wantList.length === 0
          ? '<div style="background:var(--surface);border:1px dashed var(--line);border-radius:10px;padding:30px;text-align:center;color:var(--muted);">まだ住所登録なし</div>'
          : '<div class="delivery-list">' + wantList.map((r, i) => `
              <div class="delivery-row">
                <div class="delivery-num">${i + 1}</div>
                <div class="delivery-body">
                  <strong class="delivery-name">${escapeHtml(r.name) || '匿名'} 様</strong>
                  <div class="delivery-meta-row"><i data-lucide="map-pin"></i><span>${escapeHtml(r.address)}</span></div>
                  ${r.phone ? `<div class="delivery-meta-row delivery-meta-sub"><i data-lucide="phone"></i><span>${escapeHtml(r.phone)}</span></div>` : ''}
                  ${r.note ? `<div class="delivery-meta-row delivery-meta-sub delivery-meta-note"><i data-lucide="file-text"></i><span>${escapeHtml(r.note)}</span></div>` : ''}
                </div>
                <div class="delivery-action">
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(r.address)}" target="_blank" class="delivery-map-link"><i data-lucide="map"></i><span>地図で見る</span></a>
                </div>
              </div>
            `).join('') + '</div>'
        }
      </section>

      <section class="board-section" id="cal-waiting">
        <h2><i data-lucide="hourglass"></i><span>住所入力待ち — ${wantNoAddr.length}名</span></h2>
        ${wantNoAddr.length === 0
          ? '<div style="background:var(--surface);border:1px dashed var(--line);border-radius:10px;padding:24px;text-align:center;color:var(--muted);font-size:13px;">なし</div>'
          : '<div style="display:grid;gap:6px;">' + wantNoAddr.map(r => `
              <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
                <strong style="font-size:13.5px;">${escapeHtml(r.name) || '匿名'} 様</strong>
                <span style="font-size:11px;color:var(--muted);">住所入力URLを送信済 / 入力待ち</span>
              </div>
            `).join('') + '</div>'
        }
      </section>

      ${noReply.length > 0 ? `
      <section class="board-section" id="cal-noreply">
        <h2><i data-lucide="mail-question"></i><span>未回答 — ${noReply.length}名</span></h2>
        <div style="display:grid;gap:4px;">
          ${noReply.map(r => `<div style="padding:8px 14px;background:#fafbfc;border:1px solid var(--line);border-radius:6px;font-size:12.5px;">${escapeHtml(r.name) || '匿名'}</div>`).join('')}
        </div>
      </section>` : ''}

      ${notWant.length > 0 ? `
      <section class="board-section">
        <h2><i data-lucide="x-circle"></i><span>不要 — ${notWant.length}名</span></h2>
        <div style="display:grid;gap:4px;font-size:12px;color:var(--muted);">
          ${notWant.map(r => `<div style="padding:8px 14px;background:#fafbfc;border:1px solid var(--line);border-radius:6px;">${escapeHtml(r.name) || '匿名'}</div>`).join('')}
        </div>
      </section>` : ''}
    `;

    document.getElementById('cal-blast-btn').addEventListener('click', async () => {
      if (!confirm('LINE友だち全員に「カレンダー希望調査」を一斉配信します。よろしいですか?')) return;
      const btn = document.getElementById('cal-blast-btn');
      const msg = document.getElementById('cal-blast-msg');
      btn.disabled = true; btn.textContent = '配信中...';
      try {
        const r = await fetch(CLOUD_RUN_BASE + '/api/cal-blast', { method: 'POST' });
        const data = await r.json();
        msg.textContent = data.ok ? `✓ ${data.sent}/${data.total}名 に送信完了` : '❌ 失敗: ' + (data.error || '');
        msg.style.color = data.ok ? 'var(--green)' : 'var(--red)';
        btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i><span>友だち全員に一斉配信</span>'; if (window.lucide) lucide.createIcons();
      } catch (e) {
        msg.textContent = '❌ 失敗: ' + e.message;
        msg.style.color = 'var(--red)';
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send"></i><span>友だち全員に一斉配信</span>'; if (window.lucide) lucide.createIcons();
      }
    });
  }

  // ============================
  // 🏷 タグ管理 ハブ (全タグ一覧 / 作成 / 削除 / どの客に付いてるか)
  // ============================
  function renderTagsHub() {
    const v = document.querySelector('[data-line-view="tagsHub"]');
    if (!v) return;
    const allClients = window.DUMMY_CLIENTS || [];
    const TAG_COLORS = ['#5B5BF0', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#EF4444', '#84CC16', '#F97316', '#0EA5E9'];

    function getMaster() { try { return JSON.parse(localStorage.getItem('fp-tags-master') || '[]'); } catch(_) { return []; } }
    function saveMaster(m) { localStorage.setItem('fp-tags-master', JSON.stringify(m)); }
    function getClientTagsLocal(cid) { try { return JSON.parse(localStorage.getItem('fp-client-tags-' + cid) || '[]'); } catch(_) { return []; } }

    function tagClients(tagId) {
      return allClients.filter(c => getClientTagsLocal(c.id).includes(tagId));
    }

    function render() {
      const master = getMaster();
      const totalTagged = new Set(allClients.flatMap(c => getClientTagsLocal(c.id))).size;
      v.innerHTML = `
        <div class="page" style="max-width:960px;">
          <header class="page-head" style="margin-bottom:16px;">
            <h1 class="page-title"><i data-lucide="tag" style="vertical-align:middle;margin-right:8px;"></i>タグ管理</h1>
            <p class="page-sub">タグを作って 顧客カードから付与 → 「ご無沙汰フォロー」でタグ絞り込み → 一斉送信できる</p>
          </header>

          <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:10px;padding:14px 18px;margin-bottom:18px;font-size:13px;color:#1E3A8A;line-height:1.7;">
            <strong>💡 使い方</strong> ─ ①ここで新規タグを作る → ②顧客カードを開く → 「🏷 タグ」 セクション → 「+ 追加/編集」 から ON/OFF → ③ご無沙汰フォロータブで「タグで絞る」 → ターゲット限定の一斉送信
          </div>

          <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px;">
            <div style="font-size:11px;font-weight:800;color:#475569;letter-spacing:0.06em;margin-bottom:10px;">+ 新しいタグを作る</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <input id="fp-tg-new" type="text" maxlength="20" placeholder="例: 法人客 / 紹介者 / VIP / 教育費相談中" style="flex:1;padding:10px 12px;border:1.5px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;">
              <button id="fp-tg-create" style="background:#0F172A;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">作成</button>
            </div>
          </div>

          <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;">
            <div style="font-size:11px;font-weight:800;color:#475569;letter-spacing:0.06em;margin-bottom:14px;display:flex;justify-content:space-between;">
              <span>📋 タグ一覧 (${master.length}個 / 計 ${totalTagged}人 にタグ付き)</span>
            </div>
            ${master.length === 0 ? `
              <div style="text-align:center;padding:32px;color:#94A3B8;font-size:13px;">
                <svg width="56" height="56" viewBox="0 0 32 32" fill="none" style="margin:0 auto 8px;display:block;">
                  <path d="M15 9 L24 9 C25.1 9 26 9.9 26 11 L26 19 C26 19.5 25.8 20 25.4 20.4 L18.4 27.4 C17.6 28.2 16.3 28.2 15.5 27.4 L8.5 20.4 C7.7 19.6 7.7 18.3 8.5 17.5 L15 11 Z" fill="#E58FAE"/>
                  <circle cx="20.5" cy="14.5" r="2" fill="#14213D"/>
                  <path d="M11 5 L20 5 C21.1 5 22 5.9 22 7 L22 15 C22 15.5 21.8 16 21.4 16.4 L14.4 23.4 C13.6 24.2 12.3 24.2 11.5 23.4 L4.5 16.4 C3.7 15.6 3.7 14.3 4.5 13.5 L11 7 Z" fill="#fff" stroke="#14213D" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
                  <circle cx="16.5" cy="10.5" r="1.6" fill="#14213D"/>
                </svg>
                まだタグがありません。上のフォームから作成してください。
              </div>
            ` : `
              <div style="display:grid;gap:8px;">
                ${master.map(t => {
                  const tagged = tagClients(t.id);
                  return `
                    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:${t.color}0A;border:1px solid ${t.color}33;border-radius:8px;">
                      <span style="background:${t.color};color:#fff;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:0.04em;white-space:nowrap;">${escapeHtml(t.label)}</span>
                      <span style="flex:1;font-size:12px;color:#475569;">
                        <strong style="color:${t.color};">${tagged.length}名</strong> に付与
                        ${tagged.length > 0 ? ` — <span style="color:#64748B;font-size:11px;">${tagged.slice(0,5).map(c => escapeHtml(c.name)).join(' / ')}${tagged.length > 5 ? ` 他${tagged.length-5}名` : ''}</span>` : ''}
                      </span>
                      <button class="fp-tg-assign" data-id="${t.id}" style="background:${t.color};color:#fff;border:none;padding:5px 14px;border-radius:5px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">+ 客を選んで付ける</button>
                      <button class="fp-tg-del" data-id="${t.id}" style="background:transparent;color:#DC2626;border:1px solid #FEE2E2;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">削除</button>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      document.getElementById('fp-tg-create').addEventListener('click', () => {
        const name = document.getElementById('fp-tg-new').value.trim();
        if (!name) return;
        const cur = getMaster();
        if (cur.some(t => t.label === name)) { alert('同名のタグが既にあります'); return; }
        const id = 't-' + Date.now().toString(36);
        const color = TAG_COLORS[cur.length % TAG_COLORS.length];
        cur.push({ id, label: name, color });
        saveMaster(cur);
        render();
      });
      v.querySelectorAll('.fp-tg-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          if (!confirm('このタグを削除しますか? (全顧客から外れます)')) return;
          saveMaster(getMaster().filter(t => t.id !== id));
          Object.keys(localStorage).filter(k => k.startsWith('fp-client-tags-')).forEach(k => {
            try {
              const arr = JSON.parse(localStorage.getItem(k) || '[]').filter(x => x !== id);
              localStorage.setItem(k, JSON.stringify(arr));
            } catch (_) {}
          });
          render();
        });
      });
      // ★ オーナーfb: タグ管理 hub から複数客に一括 ON/OFF
      v.querySelectorAll('.fp-tg-assign').forEach(btn => {
        btn.addEventListener('click', () => {
          const tagId = btn.dataset.id;
          const tag = getMaster().find(t => t.id === tagId);
          if (!tag) return;
          openTagAssignModal(tag, () => render());
        });
      });
    }
    render();
  }

  // タグ管理 hub の「+ 客を選んで付ける」 から開く 一括ON/OFF モーダル
  function openTagAssignModal(tag, onDone) {
    const allClients = window.DUMMY_CLIENTS || [];
    function getClientTagsLocal(cid) { try { return JSON.parse(localStorage.getItem('fp-client-tags-' + cid) || '[]'); } catch(_) { return []; } }
    function saveClientTagsLocal(cid, ids) { localStorage.setItem('fp-client-tags-' + cid, JSON.stringify(ids)); }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10070;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';
    const initialAssigned = new Set(allClients.filter(c => getClientTagsLocal(c.id).includes(tag.id)).map(c => c.id));
    const working = new Set(initialAssigned);
    function paint() {
      overlay.innerHTML = `
        <div style="background:#fff;max-width:640px;width:100%;max-height:80vh;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);display:flex;flex-direction:column;overflow:hidden;">
          <div style="background:${tag.color};color:#fff;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:10px;font-weight:800;letter-spacing:0.22em;opacity:0.85;">TAG ASSIGNMENT</div>
              <h3 style="margin:4px 0 0 0;font-size:15px;font-weight:900;">🏷 「${escapeHtml(tag.label)}」 を付ける客を選ぶ</h3>
            </div>
            <button id="fp-ta-close" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:16px;">✕</button>
          </div>
          <div style="padding:14px 22px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;display:flex;gap:8px;align-items:center;">
            <input id="fp-ta-search" type="search" placeholder="名前で絞り込み..." style="flex:1;padding:8px 12px;border:1.5px solid #E2E8F0;border-radius:6px;font-size:12.5px;font-family:inherit;">
            <button id="fp-ta-all" style="background:#0F172A;color:#fff;border:none;padding:8px 14px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">全選択/解除</button>
          </div>
          <div id="fp-ta-list" style="flex:1;overflow-y:auto;padding:14px 22px;"></div>
          <div style="padding:14px 22px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;font-weight:700;color:#475569;">選択 <span id="fp-ta-count" style="color:${tag.color};font-weight:900;">${working.size}</span> 名</span>
            <button id="fp-ta-save" style="background:${tag.color};color:#fff;border:none;padding:10px 22px;border-radius:6px;font-size:13px;font-weight:900;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">✓ 保存</button>
          </div>
        </div>
      `;
      paintList();
      bind();
    }
    function paintList() {
      const q = (overlay.querySelector('#fp-ta-search')?.value || '').toLowerCase().trim();
      const list = overlay.querySelector('#fp-ta-list');
      const filtered = allClients.filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.kana || '').toLowerCase().includes(q));
      list.innerHTML = filtered.length === 0 ? '<div style="text-align:center;padding:30px;color:#94A3B8;font-size:13px;">該当客なし</div>' :
        filtered.map(c => {
          const on = working.has(c.id);
          return `
            <label data-cid="${c.id}" class="fp-ta-row" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid ${on ? tag.color : '#E2E8F0'};background:${on ? tag.color+'14' : '#fff'};border-radius:7px;margin-bottom:5px;cursor:pointer;">
              <input type="checkbox" data-cid="${c.id}" ${on ? 'checked' : ''} style="width:17px;height:17px;cursor:pointer;accent-color:${tag.color};">
              <span style="flex:1;font-size:13px;font-weight:600;color:#0F172A;">${escapeHtml(c.name)} <span style="color:#94A3B8;font-size:11px;font-weight:500;margin-left:5px;">${escapeHtml(c.occupation || '')}</span></span>
              ${c.lineFriendId ? '<span style="font-size:9px;color:#06C755;background:#DCFCE7;padding:1px 6px;border-radius:6px;font-weight:800;letter-spacing:0.05em;">LINE</span>' : ''}
            </label>
          `;
        }).join('');
      list.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
          const cid = cb.dataset.cid;
          if (cb.checked) working.add(cid); else working.delete(cid);
          overlay.querySelector('#fp-ta-count').textContent = String(working.size);
          const row = cb.closest('.fp-ta-row');
          if (row) { row.style.background = cb.checked ? tag.color+'14' : '#fff'; row.style.borderColor = cb.checked ? tag.color : '#E2E8F0'; }
        });
      });
    }
    function bind() {
      overlay.querySelector('#fp-ta-close').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#fp-ta-search').addEventListener('input', paintList);
      overlay.querySelector('#fp-ta-all').addEventListener('click', () => {
        const q = (overlay.querySelector('#fp-ta-search').value || '').toLowerCase().trim();
        const filtered = allClients.filter(c => !q || (c.name || '').toLowerCase().includes(q));
        const allOn = filtered.every(c => working.has(c.id));
        filtered.forEach(c => { if (allOn) working.delete(c.id); else working.add(c.id); });
        paintList();
        overlay.querySelector('#fp-ta-count').textContent = String(working.size);
      });
      overlay.querySelector('#fp-ta-save').addEventListener('click', () => {
        let added = 0, removed = 0;
        allClients.forEach(c => {
          const cur = getClientTagsLocal(c.id);
          const has = cur.includes(tag.id);
          const want = working.has(c.id);
          if (has && !want) { saveClientTagsLocal(c.id, cur.filter(x => x !== tag.id)); removed++; }
          else if (!has && want) { saveClientTagsLocal(c.id, cur.concat(tag.id)); added++; }
        });
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#10B981;color:#fff;padding:12px 22px;border-radius:8px;font-size:13px;font-weight:800;z-index:10090;box-shadow:0 12px 32px rgba(16,185,129,0.4);';
        toast.textContent = `✓ 「${tag.label}」: 追加 ${added}名 / 削除 ${removed}名`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2400);
        overlay.remove();
        if (onDone) onDone();
      });
    }
    document.body.appendChild(overlay);
    paint();
  }

  // ============================
  // 🔔 ご無沙汰フォロー (未接触客 一斉送信)
  // 期間: Jobs判断で 21日以上 を「ご無沙汰」 と定義
  //   - 🟡 21-59日 (3週間〜2ヶ月): 軽くタッチ
  //   - 🟠 60-179日 (2〜6ヶ月): しっかりフォロー
  //   - 🔴 180日以上 (半年〜): 関係再構築の本気アプローチ
  // ============================
  function renderDormantFollowup() {
    fetchLiveData().then(() => { if (currentSubview === 'dormantFollowup') renderDormantInner(); });
    renderDormantInner();
  }

  function daysSinceLastContact(c) {
    // ★ NaN日前 / 9999日前 表示防止: 未接触は -1 sentinel、 呼出側で 「未接触」 表記
    if (!c.lastContact) return -1;
    const t = new Date(c.lastContact).getTime();
    if (isNaN(t)) return -1;
    const today = (window.LifeEvents && window.LifeEvents.TODAY) || new Date();
    return Math.floor((today - t) / 86400000);
  }

  function renderDormantInner() {
    const v = document.querySelector('[data-line-view="dormantFollowup"]');
    if (!v) return;
    const allClients = (window.DUMMY_CLIENTS || []).filter(c => c.lineFriendId); // LINE連携客のみ
    // ★ 複数フィルタ state (タグ + 年代 + 職業 + 家族 + 期間 + 保有商品)
    const tagsMaster = (window.FpApp && window.FpApp.getTagsMaster) ? window.FpApp.getTagsMaster() : [];
    const F = (window._fpDormantFilters = window._fpDormantFilters || { tag: null, age: null, occ: null, fam: null, bucket: null, product: null });
    // 候補 抽出 (現状客から 動的に セレクトボックス候補 作成)
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
    const ageOptions = uniq(allClients.map(c => {
      // c.birth → 20/30/40... に丸める
      if (!c.birth) return null;
      const y = new Date().getFullYear() - new Date(c.birth).getFullYear();
      if (y < 30) return '20代'; if (y < 40) return '30代'; if (y < 50) return '40代';
      if (y < 60) return '50代'; if (y < 70) return '60代'; return '70代+';
    })).sort();
    const occOptions = uniq(allClients.map(c => c.occupation));
    const famOptions = uniq(allClients.map(c => c.family && Array.isArray(c.family) ? `家族${c.family.length}名` : null));
    const productOptions = uniq(allClients.flatMap(c => Array.isArray(c.autoTags) ? c.autoTags.map(t => t.label || t) : []));
    // バケット 期間
    const bucketOptions = ['21-60日', '60-180日', '180日+'];

    // フィルタ適用
    const passesFilters = (c) => {
      if (F.tag && !((window.FpApp.getClientTags(c.id) || []).includes(F.tag))) return false;
      if (F.age) {
        if (!c.birth) return false;
        const y = new Date().getFullYear() - new Date(c.birth).getFullYear();
        const a = y < 30 ? '20代' : y < 40 ? '30代' : y < 50 ? '40代' : y < 60 ? '50代' : y < 70 ? '60代' : '70代+';
        if (a !== F.age) return false;
      }
      if (F.occ && c.occupation !== F.occ) return false;
      if (F.fam) {
        const famKey = c.family && Array.isArray(c.family) ? `家族${c.family.length}名` : null;
        if (famKey !== F.fam) return false;
      }
      if (F.product) {
        const tags = Array.isArray(c.autoTags) ? c.autoTags.map(t => t.label || t) : [];
        if (!tags.includes(F.product)) return false;
      }
      return true;
    };
    const clients = allClients.filter(passesFilters);
    // ★ 未接触 (-1) は heavy bucket と同じ扱い (180日+ 相当の 関係再構築 対象)
    let enriched = clients.map(c => ({ c, days: daysSinceLastContact(c) })).filter(x => x.days >= 21 || x.days === -1);
    if (F.bucket) {
      enriched = enriched.filter(x => {
        if (F.bucket === '21-60日') return x.days >= 21 && x.days < 60;
        if (F.bucket === '60-180日') return x.days >= 60 && x.days < 180;
        if (F.bucket === '180日+') return x.days >= 180;
        return true;
      });
    }
    enriched.sort((a, b) => b.days - a.days);
    // 旧 state 互換
    const activeTagFilter = F.tag;

    const buckets = {
      light:  enriched.filter(x => x.days >= 21  && x.days < 60),
      mid:    enriched.filter(x => x.days >= 60  && x.days < 180),
      heavy:  enriched.filter(x => x.days >= 180 || x.days === -1),  // 未接触も heavy 扱い
    };
    document.getElementById('nav-count-dormant') && (document.getElementById('nav-count-dormant').textContent = String(enriched.length || ''));

    const renderRow = ({ c, days }) => {
      // 直近 議事録 1行
      const aiResults = (window.LineAppLiveData && window.LineAppLiveData.ai_results) || [];
      const myAi = aiResults.find(r => (r.userId && r.userId === c.lineFriendId) || (r.customerName && r.customerName === c.name));
      const ctx = myAi ? (myAi.summary || '').split('\n')[0].slice(0, 50) : '';
      return `
        <label class="fp-dormant-row" style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;cursor:pointer;">
          <input type="checkbox" class="fp-dormant-cb" data-uid="${escapeHtml(c.lineFriendId)}" data-name="${escapeHtml(c.name)}" checked style="width:18px;height:18px;cursor:pointer;">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13px;color:#0F172A;">${escapeHtml(c.name)} 様 <span style="font-size:10px;color:#94A3B8;font-weight:500;margin-left:6px;">${escapeHtml((c.occupation||''))}</span></div>
            ${ctx ? `<div style="font-size:11px;color:#64748B;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📝 ${escapeHtml(ctx)}</div>` : '<div style="font-size:11px;color:#CBD5E1;margin-top:2px;font-style:italic;">議事録なし</div>'}
          </div>
          <div style="text-align:right;font-size:11.5px;font-weight:800;color:${days===-1?'#94A3B8':days>=180?'#DC2626':days>=60?'#EA580C':'#CA8A04'};font-variant-numeric:tabular-nums;">${days===-1?'未接触':days+'日'}</div>
        </label>
      `;
    };

    const renderBucket = (key, label, color, items) => items.length === 0 ? '' : `
      <section style="margin-bottom:18px;">
        <h3 style="font-size:12px;font-weight:800;letter-spacing:0.06em;color:${color};margin:0 0 10px 0;display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span>
          ${escapeHtml(label)} <span style="color:#94A3B8;font-weight:600;">— ${items.length}名</span>
          <button class="fp-dormant-select-all" data-bucket="${key}" style="margin-left:auto;background:transparent;color:${color};border:1px solid ${color};padding:3px 10px;border-radius:5px;font-size:10.5px;font-weight:700;cursor:pointer;">全選択/解除</button>
        </h3>
        ${items.map(renderRow).join('')}
      </section>
    `;

    const defaultMsg = `{name}さん、ご無沙汰しております!

最近いかがお過ごしですか? 😊
家計や資産のことで 気になってる点や 変化があれば、
お気軽にメッセージください。

また落ち着いてお話できる機会、楽しみにしてます ✨`;

    // ★ 多段 絞り込みフィルタ UI — デザイン UP (カスタム chevron + ホバー + アクティブ強調)
    const selBox = (id, label, opts, current, color) => {
      const active = !!current;
      const c = color || '#5B5BF0';
      return `
        <label class="fp-filter-cell" style="display:flex;flex-direction:column;gap:6px;min-width:0;flex:1 1 150px;">
          <span style="font-size:11px;font-weight:900;color:${active ? c : '#64748B'};letter-spacing:0.06em;display:flex;align-items:center;gap:4px;">${label}</span>
          <div style="position:relative;">
            <select data-multi-filter="${id}" style="width:100%;padding:13px 38px 13px 14px;border:2px solid ${active ? c : '#E2E8F0'};border-radius:11px;font-size:14px;font-weight:${active ? '800' : '600'};font-family:inherit;background:${active ? c + '0D' : '#fff'};color:${active ? c : '#0F172A'};cursor:pointer;min-height:50px;appearance:none;-webkit-appearance:none;transition:border-color .15s,background-color .15s;box-shadow:${active ? '0 4px 12px ' + c + '22' : '0 1px 2px rgba(15,23,42,0.04)'};">
              <option value="">— すべて —</option>
              ${opts.map(o => `<option value="${escapeHtml(o)}" ${current === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
            </select>
            <svg style="position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="${active ? c : '#64748B'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </label>`;
    };
    const activeFilterCount = ['tag','bucket','age','occ','fam','product'].filter(k => F[k]).length;
    const filterHtml = `
      <style>
        .fp-filter-cell select:hover { border-color: #5B5BF0 !important; }
        .fp-filter-cell select:focus { outline:none; border-color:#5B5BF0 !important; box-shadow:0 0 0 4px rgba(91,91,240,0.16); }
      </style>
      <div style="background:linear-gradient(180deg,#fff,#FAFBFF);border:1.5px solid #E2E8F0;border-radius:16px;padding:18px 20px;margin-bottom:18px;box-shadow:0 4px 16px rgba(15,23,42,0.04);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <strong style="font-size:14.5px;font-weight:900;color:#0F172A;letter-spacing:-0.01em;display:inline-flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">🔍</span>絞り込み
            ${activeFilterCount > 0 ? `<span style="background:#5B5BF0;color:#fff;font-size:11px;font-weight:900;padding:3px 10px;border-radius:99px;letter-spacing:0.04em;">${activeFilterCount} 適用中</span>` : ''}
          </strong>
          ${activeFilterCount > 0 ? '<button id="fp-dormant-filter-clear" style="background:#fff;color:#DC2626;border:1.5px solid #FECACA;padding:7px 14px;border-radius:9px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px;">✕ 全解除</button>' : ''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
          ${selBox('bucket', '⏰ 期間', bucketOptions, F.bucket, '#EA580C')}
          ${selBox('age', '🎂 年代', ageOptions, F.age, '#A855F7')}
          ${selBox('occ', '💼 職業', occOptions, F.occ, '#0EA5E9')}
          ${selBox('fam', '👨‍👩‍👧 家族構成', famOptions, F.fam, '#10B981')}
          ${productOptions.length > 0 ? selBox('product', '📊 保有商品', productOptions, F.product, '#F59E0B') : ''}
        </div>
        ${tagsMaster.length > 0 ? `
          <div style="border-top:1.5px dashed #E2E8F0;margin-top:16px;padding-top:14px;">
            <div style="font-size:11.5px;font-weight:900;color:#475569;letter-spacing:0.06em;margin-bottom:8px;">🏷 タグ で 絞る</div>
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:7px;">
              <button data-tag-filter="" style="background:${!F.tag ? '#0F172A' : '#fff'};color:${!F.tag ? '#fff' : '#475569'};border:1.5px solid ${!F.tag ? '#0F172A' : '#E2E8F0'};padding:7px 14px;border-radius:99px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .12s;">指定なし</button>
              ${tagsMaster.map(t => {
                const n = allClients.filter(c => (window.FpApp.getClientTags(c.id) || []).includes(t.id) && daysSinceLastContact(c) >= 21).length;
                const on = F.tag === t.id;
                return `<button data-tag-filter="${t.id}" style="background:${on ? t.color : '#fff'};color:${on ? '#fff' : t.color};border:1.5px solid ${t.color};padding:7px 14px;border-radius:99px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:${on ? '0 4px 12px ' + t.color + '44' : 'none'};transition:all .12s;">${escapeHtml(t.label)} <span style="opacity:0.75;font-weight:700;">(${n})</span></button>`;
              }).join('')}
            </div>
          </div>` : ''}
      </div>
    `;
    const tagFilterHtml = filterHtml;

    v.innerHTML = `
      <div class="page" style="max-width:920px;">
        <header class="page-head" style="margin-bottom:16px;">
          <h1 class="page-title"><i data-lucide="alarm-clock" style="vertical-align:middle;margin-right:8px;"></i>ご無沙汰フォロー</h1>
          <p class="page-sub">21日以上 LINE で連絡してない方を期間ごとに表示。テンプレ編集 → 全員に1クリック送信。${activeTagFilter ? `<span style="color:#5B5BF0;font-weight:700;"> · タグ「${escapeHtml((tagsMaster.find(t => t.id === activeTagFilter) || {}).label || '')}」 で絞り込み中</span>` : ''}</p>
        </header>

        <!-- ★ 役割明示バナー: 配信タブとの混同防止 -->
        <div style="background:linear-gradient(135deg,#FEF3C7,#FFEDD5);border:1px solid #FCD34D;border-radius:12px;padding:18px 22px;margin-bottom:18px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <span style="background:#7C2D12;color:#fff;font-size:10px;font-weight:800;letter-spacing:0.12em;padding:3px 9px;border-radius:4px;">ご無沙汰フォロー — RE-ENGAGE</span>
            <span style="font-size:12px;color:#64748B;">= <strong style="color:#7C2D12;">最終接触から日数が経った客</strong>を1人ずつ追客 (関係維持・再接続)</span>
          </div>
          <div style="font-size:12px;color:#64748B;line-height:1.7;">
            キャンペーンやお知らせを全員に一斉送信したい時は → <a href="#" onclick="document.querySelector('.tab[data-tab=&quot;distributionHub&quot;]')?.click();return false;" style="color:#1D4ED8;font-weight:700;text-decoration:underline;">配信タブ</a> （テンプレ駆動でまとめて送信）
          </div>
        </div>

        ${tagFilterHtml}

        ${enriched.length === 0 ? `
          <div style="background:#F0FDF4;border:1px solid #10B981;color:#065F46;padding:24px;border-radius:10px;text-align:center;font-size:14px;font-weight:600;">
            ✨ ご無沙汰の方は1人もいません。全顧客と 21日以内 に接触できてます!
          </div>
        ` : `
          <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <strong style="font-size:13px;color:#0F172A;">対象者 ${enriched.length}名</strong>
              <div style="font-size:11px;color:#64748B;">名前は送信時に {name} 自動置換</div>
            </div>
            ${renderBucket('light', '🟡 21日〜60日未満 (軽くタッチ)', '#CA8A04', buckets.light)}
            ${renderBucket('mid', '🟠 60日〜180日未満 (しっかりフォロー)', '#EA580C', buckets.mid)}
            ${renderBucket('heavy', '🔴 180日以上 (関係再構築)', '#DC2626', buckets.heavy)}
          </div>

          <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px;">
            <div style="font-size:11px;font-weight:800;color:#475569;letter-spacing:0.06em;margin-bottom:8px;">📝 送信メッセージ (編集可・{name} は自動置換)</div>
            <textarea id="fp-dormant-msg" rows="8" style="width:100%;padding:14px 16px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:13.5px;font-family:'Noto Sans JP',sans-serif;line-height:1.75;resize:vertical;box-sizing:border-box;">${escapeHtml(defaultMsg)}</textarea>
          </div>

          <div style="position:sticky;bottom:18px;background:linear-gradient(135deg,#0F172A,#1E293B);border-radius:12px;padding:18px 22px;box-shadow:0 12px 36px rgba(15,23,42,0.32);display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
            <div style="flex:1;color:#fff;min-width:180px;">
              <div style="font-size:11.5px;font-weight:700;letter-spacing:0.06em;color:#94A3B8;">✓ 選択中 <span id="fp-dormant-selected-count" style="color:#FCD34D;font-weight:900;">${enriched.length}</span>名 に送信</div>
              <div style="font-size:10px;color:#CBD5E1;margin-top:2px;">⚠ 送信後は取消不可。送信前に文面を確認してください</div>
            </div>
            <div class="btn-cta-primary-wrap">
              <span class="btn-cta-primary-chip">\\ 全員に 1クリック /</span>
              <button id="fp-dormant-send" class="btn-cta-primary">
                <span>選んだ方に 一斉送信</span>
                <span class="cta-arrow">→</span>
              </button>
            </div>
          </div>
          <div id="fp-dormant-result" style="margin-top:14px;"></div>
        `}
      </div>
    `;
    if (window.lucide) lucide.createIcons();

    // タグフィルタボタン
    v.querySelectorAll('[data-tag-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.tagFilter;
        F.tag = id || null;
        window._fpDormantTagFilter = F.tag;  // 後方互換
        renderDormantInner();
      });
    });
    // ★ 多段フィルタ select
    v.querySelectorAll('[data-multi-filter]').forEach(sel => {
      sel.addEventListener('change', () => {
        F[sel.dataset.multiFilter] = sel.value || null;
        renderDormantInner();
      });
    });
    // フィルタ クリア
    const clearBtn = document.getElementById('fp-dormant-filter-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      Object.keys(F).forEach(k => F[k] = null);
      window._fpDormantTagFilter = null;
      renderDormantInner();
    });

    if (enriched.length === 0) return;

    // 選択カウント更新
    const updateCount = () => {
      const n = v.querySelectorAll('.fp-dormant-cb:checked').length;
      const el = document.getElementById('fp-dormant-selected-count');
      if (el) el.textContent = String(n);
    };
    v.querySelectorAll('.fp-dormant-cb').forEach(cb => cb.addEventListener('change', updateCount));

    // 全選択/解除
    v.querySelectorAll('.fp-dormant-select-all').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const key = btn.dataset.bucket;
        const section = btn.closest('section');
        const cbs = section.querySelectorAll('.fp-dormant-cb');
        const allChecked = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => { cb.checked = !allChecked; });
        updateCount();
      });
    });

    // 送信
    document.getElementById('fp-dormant-send').addEventListener('click', async () => {
      const selected = Array.from(v.querySelectorAll('.fp-dormant-cb:checked')).map(cb => ({ uid: cb.dataset.uid, name: cb.dataset.name }));
      if (selected.length === 0) { alert('送信対象を 1名以上 選択してください'); return; }
      const tpl = document.getElementById('fp-dormant-msg').value.trim();
      if (!tpl) { alert('メッセージが空です'); return; }
      if (!confirm(`${selected.length}名 に 一斉送信します。よろしいですか?\n\n⚠ 送信後は取消できません。`)) return;
      const btn = document.getElementById('fp-dormant-send');
      const result = document.getElementById('fp-dormant-result');
      btn.disabled = true; btn.textContent = '送信中...';
      // ★ 全画面オーバーレイで操作ブロック (誤クリック / 中断 防止)
      showSendingOverlay(`ご無沙汰フォロー 一斉送信中 (${selected.length}名)`, selected.length);
      // ★ multi-tenant sendLineMessage 経由 (旧 /api/send-line = demo GAS token で別チャンネル失敗するのを修正)
      const { initializeApp: _ia, getApps: _ga } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
      const { getFunctions: _gf, httpsCallable: _hc } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
      const _app = _ga()[0] || _ia({ apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4', authDomain: 'skeleton-fp-compass-632026.firebaseapp.com', projectId: 'skeleton-fp-compass-632026' });
      const _fn = _hc(_gf(_app, 'asia-northeast1'), 'sendLineMessage');
      let ok = 0, fail = 0;
      const failDetails = [];
      for (let i = 0; i < selected.length; i++) {
        const s = selected[i];
        updateSendingProgress(i, selected.length, s.name);
        const text = tpl.replace(/\{name\}/g, s.name);
        try {
          // customer id 紐付け: DUMMY_CLIENTS から逆引き
          const cClient = (window.DUMMY_CLIENTS || []).find(c => c.lineFriendId === s.uid);
          if (cClient) {
            await _fn({ customerId: cClient.id, text });
          } else {
            await _fn({ lineFriendId: s.uid, text });
          }
          ok++;
        } catch (e) {
          fail++;
          const m = e?.message || String(e);
          const reason = /LINE 未連携|failed-precondition/.test(m)
            ? 'あなたの LINE 公式アカウント が 未連携 (アカウント設定で 接続してください)'
            : /Failed to send|友だち追加/.test(m)
              ? `お客様 が この LINE 公式アカウント を 友だち未追加`
              : m.slice(0, 200);
          failDetails.push({ name: s.name, hint: reason });
        }
        // レート制限対策 200ms 待つ
        await new Promise(res => setTimeout(res, 200));
      }
      updateSendingProgress(selected.length, selected.length, '');
      closeSendingOverlay();
      // ★ 結果バナー: 失敗時は理由ごとにグループ化して表示
      let detailHtml = '';
      if (failDetails.length > 0) {
        // hint 別にまとめる
        const groups = {};
        failDetails.forEach(d => {
          // ★ code 400 は LINE が「送信できない」一般エラー — 4つの可能性を併記
          let key = d.hint
            || (d.code === 400 ? 'LINE 配信エラー — 次のいずれか: ①友だち未追加/ブロック ②無効なuserId ③LINE OA のチャンネル違い ④月間配信上限到達 (LINE Official Account Manager で確認推奨)' : (d.error || '理由不明'));
          (groups[key] = groups[key] || []).push(d.name);
        });
        detailHtml = '<div style="background:#fff;border:1px solid #FCA5A5;border-radius:8px;padding:14px 18px;margin-top:8px;font-size:12.5px;color:#7F1D1D;line-height:1.65;">'
          + '<div style="font-weight:800;margin-bottom:6px;font-size:13px;">失敗の内訳:</div>'
          + Object.keys(groups).map(reason => `<div style="margin-bottom:4px;"><strong>・${escapeHtml(reason)}</strong>: ${groups[reason].join(', ')}</div>`).join('')
          + '</div>';
      }
      result.innerHTML = `<div style="background:${fail===0?'#F0FDF4':'#FEF3C7'};border:1px solid ${fail===0?'#10B981':'#F59E0B'};color:${fail===0?'#065F46':'#92400E'};padding:14px 18px;border-radius:8px;font-size:13px;font-weight:700;">${fail===0?'✓':'⚠'} 送信完了: 成功 ${ok}名 / 失敗 ${fail}名</div>${detailHtml}`;
      // ★ オーナーfb: 結果を見えるところまでスクロール (画面外で気付かないバグ防止)
      try { result.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      btn.disabled = false; btn.textContent = '✨ 選択した方に一斉送信';
    });
  }

  // ============================
  // 🆕 新規相談ハブ (アクションカード型)
  // ============================
  function renderLeadHub() {
    // ★ Firestore 顧客 を 即時 反映
    if (window.refreshFirestoreCustomers) {
      try { window.refreshFirestoreCustomers(); } catch (_) {}
    }
    fetchLiveData().then(() => { if (currentSubview === 'leadHub') renderLeadHubInner(); });
    if (!window._leadHubInterval) {
      window._leadHubInterval = setInterval(() => {
        if (currentSubview === 'leadHub') {
          fetchLiveData().then(() => renderLeadHubInner());
        }
      }, 15000);
    }
    renderLeadHubInner();
  }

  function renderLeadHubInner() {
    const v = document.querySelector('[data-line-view="leadHub"]');
    if (!v) return;
    const today = new Date('2026-05-28').toISOString().slice(0, 10);
    let surveys = (liveData && liveData.survey_answers) || [];
    // ★ Firestore 多テナント 確定済 を bookings に 合流
    const fsConfirmedHero = (window._fpFirestoreConfirmed || []).map(c => {
      const [d, t] = String(c.confirmedSlot || '').split(' ');
      return { _fsCustomerId: c.docId, userId: 'fs:'+c.docId, name: c.name, date: d || '', time: t || '', zoomUrl: c.zoomUrl, ts: c.confirmedAt?.toDate?.()?.toISOString?.() || '', status: 'confirmed' };
    });
    const bookings = ((liveData && liveData.bookings) || []).concat(fsConfirmedHero);
    const fsPendingHeroCount = (window._fpFirestoreCustomers || []).length;
    // デモfallback無効化 — オーナーがLINE実機テストする時のためにLIVEデータだけ表示
    let isDemo = false;

    const isRealLineUidHero = (uid) => /^U[a-f0-9]{32}$/i.test(String(uid || ''));
    const pendingConfirm = surveys.filter(s => !s.confirmedSlot && (s.q6_候補1 || s.q7_候補2 || s.q8_候補3) && isRealLineUidHero(s.userId)).length + fsPendingHeroCount;
    const recPending = bookings.filter(b => b.recordingStatus === 'saved' && !b.transcript).length;
    const recordingNow = bookings.filter(b => b.recordingStatus === 'recording').length;
    const totalNewLeads = surveys.length;

    // Zoom打ち合わせ待ち: 確定済みで面談日がまだ来てない / 来日でまだ録画していない
    const archived = new Set(JSON.parse(localStorage.getItem('fp-booking-archived') || '[]'));
    const now = new Date();
    const upcomingZoom = bookings.filter(b => {
      if (archived.has(b.ts)) return false;
      if (b.recordingStatus === 'saved' || b.recordingStatus === 'recording') return false;
      if (!b.date) return false;
      // ★ オーナーfb 2026-06-20: 今日の 予約 が 弾かれる バグ修正
      //   旧: floor((midnight - now)/86400000) → 今日も -1 になる
      //   新: 日付 ローカル 0:00 で 比較 → 今日(0) も 未来 も 含める
      const meetDate = new Date(b.date + 'T00:00:00');
      if (isNaN(meetDate.getTime())) return false;
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return meetDate >= today0;
    });
    const upcomingZoomCount = upcomingZoom.length;
    // 最も近い面談を計算 (今日 / 明日 / N日後 表示用)
    const nearestZoom = upcomingZoom.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
    let nearestLabel = '';
    if (nearestZoom) {
      const md = new Date(nearestZoom.date);
      const dd = Math.floor((md - new Date(now.toDateString())) / 86400000);
      nearestLabel = dd === 0 ? '本日' : dd === 1 ? '明日' : `${dd}日後`;
    }

    // フォローアップ必要: Zoomまで到達しなかった人を抽出
    // - 友だち追加したがアンケート未回答 (>3日)
    // - アンケート回答したが候補日空欄 (>5日)
    // - 候補日確定したが面談日が過ぎても録画なし
    const liveUsers = (liveData && liveData.users) || [];
    const todayMs = Date.now();
    const aftercare = [];
    liveUsers.forEach(u => {
      const lastTs = u.lastActionAt || u.addedAt;
      if (!lastTs) return;
      const daysSinceAction = Math.floor((todayMs - new Date(lastTs).getTime()) / 86400000);
      const userSurveys = surveys.filter(s => s.userId === u.userId);
      const userBooking = bookings.find(b => b.userId === u.userId);
      const survey = userSurveys[userSurveys.length - 1]; // 最新
      // 友だち追加だけで放置
      if (!survey && daysSinceAction >= 3 && u.status !== 'unfollowed') {
        aftercare.push({ user: u, reason: '友だち追加後 アンケート未回答', stage: 'survey-pending', days: daysSinceAction, customerName: u.displayName || '匿名' });
      }
      // アンケート回答済み、候補日無し
      else if (survey && !survey.q6_候補1 && !survey.q7_候補2 && !survey.q8_候補3 && daysSinceAction >= 5) {
        aftercare.push({ user: u, reason: 'アンケート回答済み 候補日未提示', stage: 'slot-pending', days: daysSinceAction, customerName: u.displayName || '匿名', survey });
      }
      // 候補日提示済み、未確定
      else if (survey && (survey.q6_候補1 || survey.q7_候補2 || survey.q8_候補3) && !survey.confirmedSlot && daysSinceAction >= 3) {
        aftercare.push({ user: u, reason: '候補日提示済み 確定待ち', stage: 'confirm-pending', days: daysSinceAction, customerName: u.displayName || '匿名', survey });
      }
      // 確定済みで予定日が過ぎてるが完了マークなし
      else if (userBooking && userBooking.status === 'confirmed' && !userBooking.recordingStatus) {
        const meetDate = new Date(userBooking.date);
        const daysSinceMeet = Math.floor((todayMs - meetDate.getTime()) / 86400000);
        if (daysSinceMeet >= 1) {
          aftercare.push({ user: u, reason: '面談日が過ぎたが完了マーク無し', stage: 'completion-pending', days: daysSinceMeet, customerName: u.displayName || userBooking.name || '匿名' });
        }
      }
    });
    aftercare.sort((a, b) => b.days - a.days);

    // 最優先のアクションを判定 (ヒーロー用)
    const hero = pendingConfirm > 0 ? { title: 'お客様の候補日を確定する', count: pendingConfirm, unit: '名', sub: '第1〜第3希望から1つタップで予約確定 / Zoom URL・カレンダー登録・LINE通知が同時に走ります', target: '#section-confirm', kind: 'urgent' }
      : recordingNow > 0 ? { title: '録画中の面談', count: recordingNow, unit: '件', sub: '面談終了後、右上の「停止」を押してください / Drive に自動アップロードされます', target: '#section-recording', kind: 'active' }
      : upcomingZoomCount > 0 ? { title: `${nearestLabel} に Zoom 面談があります`, count: upcomingZoomCount, unit: '件', sub: '直近予約: ' + (nearestZoom ? (nearestZoom.name || '匿名') + '様 / ' + String(nearestZoom.date).slice(5, 10).replace('-', '/') + ' ' + String(nearestZoom.time || '').slice(0,5) : ''), target: '#section-recording', kind: 'upcoming' }
      : aftercare.length > 0 ? { title: 'Zoom まで到達していないお客様', count: aftercare.length, unit: '名', sub: 'アンケート途中・候補日提示後で止まっている方に追撃メッセージを送りましょう', target: '#section-aftercare', kind: 'followup' }
      : null;

    // 配色: 上品な navy / gold / cream トーン
    const accents = {
      urgent:   { fg: '#7a1530', bg: 'linear-gradient(135deg,#fdf2f4,#fafafa)', border: '#7a1530', dot: '#a23a55' },
      active:   { fg: '#365314', bg: 'linear-gradient(135deg,#f0f7e8,#fafafa)', border: '#4d7c0f', dot: '#65a30d' },
      upcoming: { fg: '#1e3a5f', bg: 'linear-gradient(135deg,#f0f4fa,#fafafa)', border: '#1e3a5f', dot: '#3b5c8f' },
      followup: { fg: '#7c4a14', bg: 'linear-gradient(135deg,#fcf7eb,#fafafa)', border: '#9a5a18', dot: '#b8893d' },
      ok:       { fg: '#5e4d1a', bg: 'linear-gradient(135deg,#fdfbf4,#fafafa)', border: '#c19a3a', dot: '#c19a3a' },
    };
    const heroColor = hero ? accents[hero.kind] : accents.ok;

    v.innerHTML = `
      <div style="margin:0 0 18px;padding:0 0 16px;border-bottom:1px solid #e8e2d4;display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;">
        <div>
          <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px;">New Consultation</div>
          <h1 style="font-family:'Noto Serif JP',serif;font-size:28px;font-weight:700;letter-spacing:0.02em;margin:0 0 6px;color:#1f2a3f;">新規相談</h1>
          <p style="color:#6b7280;font-size:13px;margin:0;line-height:1.6;">LINE — アンケート — 候補日 — Zoom面談 — 完了 までの進行状況</p>
        </div>
        <!-- ★ 急遽対面録画 (予約不要・お客様が突然来た時用) -->
        <button id="fp-quick-inperson"
          style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:#fff;border:none;padding:14px 22px;border-radius:10px;font-size:13.5px;font-weight:800;cursor:pointer;font-family:'Hiragino Sans',sans-serif;letter-spacing:0.04em;box-shadow:0 6px 20px rgba(124,58,237,0.35);display:flex;align-items:center;gap:10px;white-space:nowrap;"
          title="急に対面相談が入った時 → ボタン1つで録画開始 (議事録は自動で作られます)">
          <span style="font-size:18px;line-height:1;">●</span>
          <span>急遽 対面録画開始</span>
          <span style="background:rgba(255,255,255,0.18);font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;letter-spacing:0.06em;">予約不要</span>
        </button>
      </div>

      ${isDemo ? '<div style="background:#fdfbf4;border:1px solid #e8d9a8;border-radius:6px;padding:11px 16px;margin-bottom:24px;font-size:12px;color:#5e4d1a;font-family:\'Noto Sans JP\',sans-serif;letter-spacing:0.02em;"><strong style="font-weight:700;">Note —</strong> 表示中の候補日待ち4件はサンプルです。本番では実際のLINEアンケート回答が並びます</div>' : ''}

      ${hero ? `
      <a href="${hero.target}" style="text-decoration:none;color:inherit;display:block;background:${heroColor.bg};border:1px solid ${heroColor.border}33;border-left:3px solid ${heroColor.border};border-radius:8px;padding:24px 28px;margin-bottom:32px;display:grid;grid-template-columns:1fr auto;gap:20px;align-items:center;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);transition:transform 0.15s,box-shadow 0.15s;">
        <div>
          <div style="font-size:10px;font-weight:700;color:${heroColor.fg};letter-spacing:0.2em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
            <span style="width:6px;height:6px;background:${heroColor.dot};border-radius:50%;display:inline-block;"></span>
            Next Action
          </div>
          <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:8px;">
            <div style="font-size:42px;font-weight:800;font-family:'Inter',sans-serif;color:${heroColor.fg};line-height:1;letter-spacing:-0.02em;">${hero.count}<span style="font-size:14px;color:#6b7280;font-weight:600;margin-left:4px;">${hero.unit}</span></div>
            <div style="font-family:'Noto Serif JP',serif;font-size:18px;font-weight:600;color:#1f2a3f;line-height:1.35;">${hero.title}</div>
          </div>
          <div style="font-size:12.5px;color:#6b7280;line-height:1.6;letter-spacing:0.02em;">${hero.sub}</div>
        </div>
        <div style="font-size:18px;color:${heroColor.fg};font-family:'Inter',sans-serif;font-weight:300;">→</div>
      </a>` : `
      <div style="background:${accents.ok.bg};border:1px solid ${accents.ok.border}33;border-left:3px solid ${accents.ok.border};border-radius:8px;padding:24px 28px;margin-bottom:32px;display:grid;grid-template-columns:1fr;gap:6px;box-shadow:0 1px 3px rgba(15,23,42,0.04);">
        <div style="font-size:10px;font-weight:700;color:${accents.ok.fg};letter-spacing:0.2em;text-transform:uppercase;display:flex;align-items:center;gap:8px;">
          <span style="width:6px;height:6px;background:${accents.ok.dot};border-radius:50%;display:inline-block;"></span>
          Status
        </div>
        <div style="font-family:'Noto Serif JP',serif;font-size:18px;font-weight:600;color:#1f2a3f;">対応待ちはありません</div>
        <div style="font-size:12.5px;color:#6b7280;line-height:1.6;">新しい LINE 流入があれば自動でここに表示されます</div>
      </div>`}

      <div style="display:flex;align-items:baseline;justify-content:space-between;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid #e8e2d4;">
        <div>
          <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:3px;">Pipeline</div>
          <h2 style="font-family:'Noto Serif JP',serif;font-size:18px;margin:0;font-weight:600;color:#1f2a3f;">FP 作業フロー</h2>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:14px;">
        ${[
          { label: '候補日確定', desc: 'お客様の3候補から確定', value: pendingConfirm, unit: '名', target: '#section-confirm', accent: accents.urgent, active: pendingConfirm > 0, step: '01' },
          { label: 'Zoom 打ち合わせ予定', desc: '確定済 / 面談日待ち', value: upcomingZoomCount, unit: '件', target: '#section-recording', accent: accents.upcoming, active: upcomingZoomCount > 0, step: '02' },
        ].map(c => `
          <a href="${c.target}" style="text-decoration:none;color:inherit;background:#fff;border:1px solid ${c.active ? c.accent.border + '55' : '#e8e2d4'};${c.active ? `border-top:2px solid ${c.accent.border};` : ''}border-radius:8px;padding:18px 18px 16px;display:flex;flex-direction:column;gap:4px;transition:all 0.15s;${c.active ? `box-shadow:0 1px 3px rgba(15,23,42,0.04),0 6px 20px ${c.accent.border}1f;` : 'box-shadow:0 1px 2px rgba(15,23,42,0.03);'}">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:9.5px;font-weight:700;color:${c.active ? c.accent.fg : '#94a3b8'};letter-spacing:0.18em;font-family:'Inter',sans-serif;">${c.step}</span>
              ${c.active ? `<span style="width:6px;height:6px;background:${c.accent.dot};border-radius:50%;display:inline-block;"></span>` : ''}
            </div>
            <div style="font-size:12px;color:#1f2a3f;font-weight:700;letter-spacing:0.02em;margin-top:2px;">${c.label}</div>
            <div style="font-size:10.5px;color:#9ca3af;font-weight:500;letter-spacing:0.02em;line-height:1.4;">${c.desc}</div>
            <div style="font-size:30px;font-weight:800;font-family:'Inter',sans-serif;color:${c.active ? c.accent.fg : '#1f2a3f'};line-height:1;letter-spacing:-0.02em;margin-top:4px;">${c.value}<span style="font-size:11px;color:#9ca3af;font-weight:600;margin-left:4px;">${c.unit}</span></div>
          </a>
        `).join('')}
      </div>
      <!-- フロー説明 -->
      <div style="background:#fdfbf4;border:1px solid #e8d9a8;border-radius:8px;padding:14px 20px;margin-bottom:36px;font-size:11.5px;color:#5e4d1a;line-height:1.7;">
        <div style="font-size:10px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px;">How it works</div>
        <strong style="color:#1f2a3f;font-weight:700;">01</strong> アンケート回答+候補日3つが届いたら確定 →
        <strong style="color:#1f2a3f;font-weight:700;">02</strong> Zoom URLが発行され面談日待ち → 面談当日「録画ONでZoom開始」で録画開始 → 終了後 面談履歴タブに自動アーカイブ
      </div>

      <section class="board-section" id="section-confirm">
        <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:12px;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid #e8e2d4;">
          <div>
            <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:3px;">Action Required</div>
            <h2 style="font-family:'Noto Serif JP',serif;font-size:18px;margin:0;font-weight:600;color:#1f2a3f;">候補日確定 待ち ${pendingConfirm > 0 ? `<span style="font-size:11px;background:#7a1530;color:#fff;padding:2px 8px;border-radius:10px;margin-left:8px;font-family:'Inter',sans-serif;font-weight:700;letter-spacing:0.04em;">${pendingConfirm} 名</span>` : ''}</h2>
          </div>
          <button id="fp-toggle-cal" style="font-size:11.5px;padding:8px 14px;background:#fff;border:1px solid #c19a3a;border-radius:5px;cursor:pointer;font-family:inherit;color:#5e4d1a;font-weight:700;letter-spacing:0.04em;">自分の Google カレンダーを並べて表示</button>
        </div>
        <p style="color:#6b7280;font-size:12.5px;margin:0 0 18px;line-height:1.65;letter-spacing:0.02em;">第1〜第3希望から1つタップで確定 / Zoom URL発行・LINE通知・Googleカレンダー登録が同時に動きます</p>
        <div id="confirm-list"></div>
      </section>

      <section class="board-section" id="section-recording" style="margin-top:36px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:12px;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid #e8e2d4;">
          <div>
            <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:3px;">Upcoming &amp; Active</div>
            <h2 style="font-family:'Noto Serif JP',serif;font-size:18px;margin:0;font-weight:600;color:#1f2a3f;">Zoom 打ち合わせ ${upcomingZoomCount > 0 ? `<span style="font-size:11px;background:#1e3a5f;color:#fff;padding:2px 8px;border-radius:10px;margin-left:8px;font-family:'Inter',sans-serif;font-weight:700;letter-spacing:0.04em;">${upcomingZoomCount} 件 予約あり</span>` : ''}</h2>
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#6b7280;">
            <span style="letter-spacing:0.05em;">並び順:</span>
            <select id="fp-bookings-sort" style="font-size:12px;padding:6px 10px;border:1px solid #e8e2d4;border-radius:5px;font-family:inherit;background:#fff;color:#1f2a3f;">
              <option value="upcoming">予定が近い順 (今日 → 未来 → 過去)</option>
              <option value="date-asc">面談日 — 古い順</option>
              <option value="date-desc">面談日 — 新しい順</option>
              <option value="created-desc">予約日 — 新しい順</option>
              <option value="name">お客様名 — あいうえお順</option>
            </select>
          </div>
        </div>
        <p style="color:#6b7280;font-size:12.5px;margin:0 0 18px;line-height:1.65;letter-spacing:0.02em;">確定済みの予約 / 当日になったら「録画ONでZoom開始」 → 終了時「録画停止」 → 終わったら「完了」 で顧客台帳に自動反映</p>
        <div id="bookings-list"></div>
      </section>

      <section class="board-section" id="section-aftercare" style="margin-top:36px;">
        <div style="margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid #e8e2d4;">
          <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:3px;">Stuck / Re-engage</div>
          <h2 style="font-family:'Noto Serif JP',serif;font-size:18px;margin:0;font-weight:600;color:#1f2a3f;">対応漏れ ${aftercare.length > 0 ? `<span style="font-size:11px;background:#9a5a18;color:#fff;padding:2px 8px;border-radius:10px;margin-left:8px;font-family:'Inter',sans-serif;font-weight:700;letter-spacing:0.04em;">${aftercare.length} 名</span>` : ''}</h2>
        </div>
        <p style="color:#6b7280;font-size:12.5px;margin:0 0 18px;line-height:1.65;letter-spacing:0.02em;">アンケート途中・候補日提示後・面談キャンセル等で<strong>途中で止まっている方</strong> / LINEで追撃メッセージを送りましょう</p>
        <div id="aftercare-list">
          ${aftercare.length === 0 ? `<div style="background:#fff;border:1px dashed #e8e2d4;border-radius:8px;padding:20px 26px;color:#6b7280;font-size:12.5px;line-height:1.7;letter-spacing:0.02em;">
            <strong style="color:#1f2a3f;">途中で止まってる方はいません</strong> · 該当者が出てきたら自動でここに並びます
          </div>` :
            aftercare.map(a => `
              <div style="background:var(--surface);border:1px solid var(--line);border-left:4px solid ${a.stage==='completion-pending'?'#06c755':(a.days>=14?'#b91c3c':(a.days>=7?'#f59e0b':'#0ea5e9'))};border-radius:10px;padding:14px 18px;margin-bottom:8px;display:grid;grid-template-columns:36px 1fr auto;gap:14px;align-items:center;">
                <div style="background:#06c755;color:#fff;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;font-family:inherit;">L</div>
                <div>
                  <strong style="font-size:14px;">${escapeHtml(a.customerName)} 様</strong>
                  <span style="font-size:10px;color:#06c755;background:#dcfce7;padding:1px 5px;border-radius:5px;margin-left:6px;font-weight:700;">LINE</span>
                  <div style="font-size:12px;color:var(--ink-2);margin-top:3px;">📍 ${escapeHtml(a.reason)}</div>
                  <div style="font-size:11px;color:var(--muted);margin-top:2px;">最終アクションから ${a.days}日経過</div>
                </div>
                <button data-aftercare-uid="${escapeHtml(a.user.userId)}" data-aftercare-name="${escapeHtml(a.customerName)}" data-aftercare-stage="${a.stage}" class="primary aftercare-btn"><i data-lucide="send"></i><span>LINE追撃</span></button>
              </div>
            `).join('')
          }
        </div>
      </section>

      <div id="surveys-list" style="margin-top:18px;"></div>
    `;
    fillConfirmList();
    fillBookingsList();
    // フォローアップ追撃ボタン
    document.querySelectorAll('[data-aftercare-uid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.aftercareUid;
        const name = btn.dataset.aftercareName;
        const stage = btn.dataset.aftercareStage;
        const templates = {
          'survey-pending': `${name}様\n\nお申し込みありがとうございました!\nまだアンケートにお答えいただいてないようなので、お時間ある時にぜひお願いします😊\n\n回答は3分で完了します✨`,
          'slot-pending': `${name}様\n\nアンケート回答ありがとうございました!\nぜひ無料Zoom面談で詳しくお話しませんか?\nご都合の良い候補日を3つ教えていただけると、その中から1つを確定させていただきます😊`,
          'confirm-pending': `${name}様\n\n候補日3つご提示いただきありがとうございます!\n本日中にFPから1つ選んで確定のご連絡をお送りします🙏`,
          'completion-pending': `${name}様\n\n先日はZoom面談ありがとうございました!\nご相談内容で気になる点や追加でお聞きしたいこと、ぜひお知らせください😊`,
        };
        const msg = prompt('LINEで送るメッセージ', templates[stage] || `${name}様\n\nお元気でいらっしゃいますか?`);
        if (!msg) return;
        btn.disabled = true; btn.textContent = '送信中...';
        try {
          const r = await fetch(CLOUD_RUN_BASE + '/api/send-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: uid, text: msg }),
          });
          const data = await r.json();
          if (data.ok) {
            btn.textContent = '✓ 送信済';
            btn.style.background = '#94a3b8';
            await fetchLiveData();
            renderLeadHubInner();
          } else {
            alert('送信失敗: ' + (data.error || ''));
            btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i><span>LINE追撃</span>'; if (window.lucide) lucide.createIcons();
          }
        } catch (e) {
          alert('送信失敗: ' + e.message);
          btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i><span>LINE追撃</span>'; if (window.lucide) lucide.createIcons();
        }
      });
    });
    // カレンダー比較トグル
    const calBtn = document.getElementById('fp-toggle-cal');
    if (calBtn) calBtn.addEventListener('click', toggleCalendarSidePanel);
    // ★ 急遽対面録画ボタン (予約不要)
    const quickBtn = document.getElementById('fp-quick-inperson');
    if (quickBtn && !quickBtn._bound) {
      quickBtn._bound = true;
      quickBtn.addEventListener('click', openQuickInpersonModal);
    }
    // 起動時にも復元
    if (localStorage.getItem('fp-cal-side-open') === '1') ensureCalendarSidePanel();
    fillFunnelArea();
    fillSurveysList();
  }

  // ★ 急遽対面録画モーダル: 顧客選択 → カメラ録画開始 → 議事録自動生成
  function openQuickInpersonModal() {
    const clients = (window.DUMMY_CLIENTS || []);
    const ov = document.createElement('div');
    ov.id = 'fp-quick-inperson-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.72);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:"Hiragino Sans",sans-serif;';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:480px;width:92%;padding:28px;box-shadow:0 32px 80px rgba(0,0,0,0.4);">
        <div style="font-size:11px;font-weight:800;color:#9A5A18;letter-spacing:0.14em;margin-bottom:6px;">QUICK START</div>
        <h2 style="font-size:20px;font-weight:800;color:#111827;margin:0 0 6px;font-family:'Noto Serif JP',serif;">急遽 面談スタート</h2>
        <p style="font-size:13px;color:#6b7280;line-height:1.65;margin:0 0 18px;">予約なしで お客様から相談が入った時はこちら。 <strong style="color:#9A5A18;">Zoom リンクを 即発行 して 双方参加</strong> するか、 <strong style="color:#1F2A3F;">対面で 録音だけ する</strong> かを 選んで 開始してください。</p>

        <label style="display:block;font-size:11.5px;font-weight:700;color:#374151;letter-spacing:0.04em;margin-bottom:6px;">お客様を選択</label>
        <select id="fp-qi-client" style="width:100%;padding:11px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;font-family:inherit;margin-bottom:14px;background:#fff;">
          <option value="">— 顧客を選んでください —</option>
          <option value="__new__">＋ 新規お客様として記録 (後で顧客登録)</option>
          <optgroup label="既存顧客 (${clients.length}名)">
            ${clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || '?')} 様</option>`).join('')}
          </optgroup>
        </select>

        <div id="fp-qi-newname-row" style="display:none;margin-bottom:14px;">
          <label style="display:block;font-size:11.5px;font-weight:700;color:#374151;letter-spacing:0.04em;margin-bottom:6px;">新規お客様のお名前 (議事録ラベル用)</label>
          <input id="fp-qi-newname" type="text" placeholder="例: 山田 太郎" style="width:100%;padding:11px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;font-family:inherit;">
        </div>

        <!-- ★ 急遽 開始 — 2モード (Zoom即発行 / 対面録音) — カメラ/マイク権限は対面のみ必要 -->
        <label style="display:block;font-size:11.5px;font-weight:700;color:#374151;letter-spacing:0.04em;margin-bottom:8px;">面談スタイル</label>
        <div id="fp-qi-mode-grid" style="display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:16px;">
          <label class="fp-qi-mode" data-mode="zoom" style="display:flex;gap:12px;padding:16px 18px;border:1.5px solid #E5E7EB;border-radius:10px;cursor:pointer;background:#fff;transition:border-color .12s,background .12s;">
            <input type="radio" name="fp-qi-mode" value="zoom" checked style="margin-top:3px;flex-shrink:0;">
            <div style="flex:1;">
              <div style="font-size:11px;font-weight:800;color:#9A5A18;letter-spacing:0.12em;margin-bottom:3px;">RECOMMENDED</div>
              <div style="font-size:15px;font-weight:800;color:#1F2A3F;line-height:1.4;">🎥 Zoom リンクを 今すぐ発行 → 双方参加</div>
              <div style="font-size:12px;color:#6b7280;margin-top:4px;line-height:1.6;">お客様の LINE に Zoom URL を 即push。 FP も 新タブで host参加。 マイク/カメラ 権限は不要 (Zoom 側で設定)。</div>
            </div>
          </label>
          <label class="fp-qi-mode" data-mode="audio" style="display:flex;gap:12px;padding:16px 18px;border:1.5px solid #E5E7EB;border-radius:10px;cursor:pointer;background:#fff;transition:border-color .12s,background .12s;">
            <input type="radio" name="fp-qi-mode" value="audio" style="margin-top:3px;flex-shrink:0;">
            <div style="flex:1;">
              <div style="font-size:11px;font-weight:800;color:#6B7280;letter-spacing:0.12em;margin-bottom:3px;">IN-PERSON</div>
              <div style="font-size:15px;font-weight:800;color:#1F2A3F;line-height:1.4;">🎤 対面で録音だけ する</div>
              <div style="font-size:12px;color:#6b7280;margin-top:4px;line-height:1.6;">対面相談時に PC のマイクで 録音 → AI議事録 自動生成。 マイク権限が必要。</div>
            </div>
          </label>
          <label class="fp-qi-mode" data-mode="memo" style="display:flex;gap:12px;padding:14px 18px;border:1.5px solid #E5E7EB;border-radius:10px;cursor:pointer;background:#fff;transition:border-color .12s,background .12s;">
            <input type="radio" name="fp-qi-mode" value="memo" style="margin-top:3px;flex-shrink:0;">
            <div style="flex:1;">
              <div style="font-size:11px;font-weight:800;color:#6B7280;letter-spacing:0.12em;margin-bottom:3px;">TEXT ONLY</div>
              <div style="font-size:14px;font-weight:800;color:#1F2A3F;line-height:1.4;">📝 録音せず メモだけ 書く</div>
              <div style="font-size:11.5px;color:#6b7280;margin-top:3px;line-height:1.55;">手入力で議事録を残す。 自動生成はなし。</div>
            </div>
          </label>
        </div>

        <div style="display:flex;gap:10px;">
          <button id="fp-qi-start" class="btn-cta-primary" style="flex:2;justify-content:center;" disabled>
            <span>選んだスタイルで開始</span>
            <span class="cta-arrow">→</span>
          </button>
          <button id="fp-qi-cancel" class="btn-cta-ghost">キャンセル</button>
        </div>
      </div>
      <style>
        .fp-qi-mode:has(input:checked) { border-color: #C19A3A !important; background: #FBF5E3 !important; }
        .fp-qi-mode:hover { border-color: #C19A3A; }
      </style>`;
    document.body.appendChild(ov);

    const sel = ov.querySelector('#fp-qi-client');
    const newRow = ov.querySelector('#fp-qi-newname-row');
    const newInput = ov.querySelector('#fp-qi-newname');
    const startBtn = ov.querySelector('#fp-qi-start');
    sel.addEventListener('change', () => {
      const v = sel.value;
      newRow.style.display = v === '__new__' ? '' : 'none';
      const valid = v && (v !== '__new__' || (newInput.value || '').trim().length > 0);
      startBtn.disabled = !valid;
    });
    newInput.addEventListener('input', () => {
      startBtn.disabled = !(sel.value === '__new__' && newInput.value.trim().length > 0);
    });

    ov.querySelector('#fp-qi-cancel').addEventListener('click', () => ov.remove());

    startBtn.addEventListener('click', async () => {
      const v = sel.value;
      let clientName, clientId;
      if (v === '__new__') {
        clientName = (newInput.value || '').trim();
        clientId = 'quick-' + Date.now();
      } else {
        const c = clients.find(x => x.id === v);
        if (!c) return;
        clientName = c.name || 'お客様';
        clientId = c.id;
      }
      const mode = ov.querySelector('input[name="fp-qi-mode"]:checked')?.value || 'zoom';
      const inpersonTs = 'quick-' + Date.now();
      // ★ 2026-06-22 roundM: 新規お客様 (clientId が quick-) で 録音/メモ モード時は、
      //   先に Firestore に customer doc を 作成して resolvedClientId を 取得 → 顧客台帳 自動反映
      let effectiveClientId = clientId;
      if (clientId.startsWith('quick-') && (mode === 'audio' || mode === 'memo')) {
        try {
          const { addDoc, collection, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
          const tid = window.__fp?.tenantId;
          if (tid) {
            const newRef = await addDoc(collection(window.__fp.db, `tenants/${tid}/customers`), {
              name: clientName, status: 'new', source: 'quick-inperson',
              createdAt: serverTimestamp(), firstContactAt: serverTimestamp(),
              note: '急遽 ' + (mode === 'audio' ? '対面録音' : '対面メモ') + ' から 自動追加',
            });
            effectiveClientId = newRef.id;
            // refresh CRM 顧客台帳
            if (window.refreshFirestoreCustomers) await window.refreshFirestoreCustomers();
          }
        } catch (e) { console.warn('quick customer firestore create failed:', e); }
      }
      try {
        const existing = JSON.parse(localStorage.getItem('fp-quick-inperson-meta') || '[]');
        existing.push({ ts: inpersonTs, clientId: effectiveClientId, clientName, startedAt: new Date().toISOString(), mode });
        localStorage.setItem('fp-quick-inperson-meta', JSON.stringify(existing.slice(-50)));
      } catch (_) {}
      ov.remove();
      // モード分岐
      if (mode === 'zoom')        await startQuickZoom(effectiveClientId, clientName);
      else if (mode === 'audio')  await startAudioOnlyRecording(inpersonTs);
      else                        await openMemoOnlyForQuick(inpersonTs, effectiveClientId, clientName);
    });
  }

  // Sheets が自動で日付型に変換してしまった ISO 文字列を JST の "YYYY-MM-DD / 帯+時間" に戻す
  function parseSlotString(raw) {
    if (!raw) return { dateStr: '', slotStr: '', display: '' };
    const str = String(raw);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
      const d = new Date(str);
      const yyyy = d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric' });
      const mm = d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', month: '2-digit' });
      const dd = d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', day: '2-digit' });
      const hh = parseInt(d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }), 10);
      const min = d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', minute: '2-digit' });
      const taiLabel = hh < 12 ? '午前' : hh < 18 ? '午後' : '夜';
      const slotStr = `${taiLabel} ${String(hh).padStart(2, '0')}:${min.padStart(2, '0')}`;
      const dateStr = `${yyyy}-${mm}-${dd}`;
      return { dateStr, slotStr, display: `${dateStr} ${slotStr}` };
    }
    const parts = str.split(/\s+/);
    const dateStr = parts[0] || '';
    const slotStr = parts.slice(1).join(' ') || '';
    return { dateStr, slotStr, display: str };
  }

  // ★ Firestore tenants/{tid}/customers から 候補日確定待ち + 確定済 を 取得 (多テナント対応)
  //   優先1: window.DUMMY_CLIENTS (loadTenantData が 既に ロード済 / 重複fetch 防止)
  //   優先2: 直接 Firestore fetch (DUMMY_CLIENTS 未ロード時の fallback)
  async function refreshFirestoreCustomers() {
    try {
      // 優先1 (cache hit): DUMMY_CLIENTS に line_survey 顧客 があれば 暫定 表示用に セット
      //   (return しない — Firestore を 一次ソース に 必ず fetch + sync する。
      //    旧コード: DUMMY_CLIENTS cache hit で 早期return → Firestore の新規顧客 (例: 「お」)
      //    が DUMMY_CLIENTS に sync されず → openClientModal で clients.find undefined → 「クリック で何も起きない」)
      if (Array.isArray(window.DUMMY_CLIENTS) && window.DUMMY_CLIENTS.length > 0) {
        const lineSurvey = window.DUMMY_CLIENTS.filter(c => c.source === 'line_survey');
        if (lineSurvey.length > 0) {
          window._fpFirestoreCustomers = lineSurvey
            .filter(c => (c.meetingCandidates||[]).length > 0 && !c.confirmedSlot)
            .map(c => ({ docId: c.id, ...c }));
          window._fpFirestoreConfirmed = lineSurvey
            .filter(c => c.confirmedSlot && c.zoomUrl)
            .map(c => ({ docId: c.id, ...c }));
        }
      }
      // 優先2 (一次ソース): Firestore 直接 fetch + DUMMY_CLIENTS へ 差分 sync
      const tenantId = (window.__fp && window.__fp.tenantId)
        || (window.AccountInfo && window.AccountInfo.tenantId)
        || localStorage.getItem('fp-tenantId');
      if (!tenantId) return;
      const { getFirestore, collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
      const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
      const app = getApps()[0] || initializeApp({
        apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
        authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
        projectId: 'skeleton-fp-compass-632026',
      });
      const db = getFirestore(app);
      const snap = await getDocs(collection(db, 'tenants', tenantId, 'customers'));
      const pendingFs = [];
      const confirmedFs = [];
      const allFs = []; // ★ 2026-06-22 roundN: 全顧客 (source問わず) を DUMMY_CLIENTS 同期対象に
      snap.forEach(d => {
        const c = d.data();
        const obj = { docId: d.id, ...c };
        allFs.push(obj);  // ★ 全 source を sync 対象 (旧バグ: source!=='line_survey' で除外 → quick-zoom/quick-inperson 顧客が 顧客台帳に出なかった)
        if (c.source === 'line_survey') {
          if ((c.meetingCandidates||[]).length > 0 && !c.confirmedSlot) pendingFs.push(obj);
          if (c.confirmedSlot && c.zoomUrl) confirmedFs.push(obj);
        }
      });
      window._fpFirestoreCustomers = pendingFs;
      window._fpFirestoreConfirmed = confirmedFs;
      // ★ Firestore 全顧客 (line_survey + quick-zoom + quick-inperson 含む) を DUMMY_CLIENTS に sync
      try { syncFirestoreCustomersToClients(allFs); } catch (e) { console.warn('syncFirestoreCustomersToClients:', e); }
      try { if (currentSubview === 'leadHub') renderLeadHubInner(); } catch(_) {}
    } catch (e) { console.warn('refreshFirestoreCustomers:', e); }
  }
  // Firestore customer → DUMMY_CLIENTS 同期 (顧客台帳クリック→モーダル開く ために必須)
  function syncFirestoreCustomersToClients(fsList) {
    if (!Array.isArray(fsList) || fsList.length === 0) return;
    if (!Array.isArray(window.DUMMY_CLIENTS)) return;

    // ★ 過去 sync で 重複作成 されてしまった entries を まず除去
    //   症状: 同 Firestore docId の顧客 が DUMMY_CLIENTS に 2件入る (1つは過去手動分、もう1つは autoFromFirestore)
    //   原因: 旧 sync が lineFriendId だけで重複check → null同士は弾けず 2重登録
    //   対策: 同名顧客が 2件以上ある時、 autoFromFirestore=true の方 を 廃棄 (手動分を保持)
    const nameGroups = {};
    window.DUMMY_CLIENTS.forEach((c, idx) => {
      const k = String(c.name || '').trim();
      if (!k) return;
      if (!nameGroups[k]) nameGroups[k] = [];
      nameGroups[k].push({ idx, c });
    });
    const toRemove = [];
    Object.values(nameGroups).forEach(arr => {
      if (arr.length < 2) return;
      // 手動 entry (autoFromFirestore でない) が 1つ以上 ある → 自動分 を 削除候補
      const hasManual = arr.some(x => !x.c.autoFromFirestore);
      if (!hasManual) return;
      arr.forEach(x => { if (x.c.autoFromFirestore) toRemove.push(x.idx); });
    });
    if (toRemove.length > 0) {
      toRemove.sort((a,b) => b - a).forEach(idx => window.DUMMY_CLIENTS.splice(idx, 1));
      console.log('[fsSync] dedupe 重複自動entry除去', toRemove.length, '件');
    }

    const knownIds = new Set(window.DUMMY_CLIENTS.map(c => c.id));
    const knownUids = new Set(window.DUMMY_CLIENTS.map(c => c.lineFriendId).filter(Boolean));
    // ★ 同名顧客 既存check (lineFriendId null 同士でも 重複 防止)
    const knownNames = new Set(window.DUMMY_CLIENTS.map(c => String(c.name || '').trim()).filter(Boolean));
    let added = 0;
    fsList.forEach(c => {
      const fsClientId = 'fs-' + c.docId;
      if (knownIds.has(fsClientId)) return;
      // lineFriendId が 既存 clients と 一致 → 同人扱い (重複防止)
      if (c.lineFriendId && knownUids.has(c.lineFriendId)) return;
      // ★ 同名顧客 既に居る → スキップ (手動入力 と Firestore sync の 2重登録防止)
      const nm = String(c.name || '').trim();
      if (nm && knownNames.has(nm)) return;
      const newC = {
        id: fsClientId,
        _fsCustomerId: c.docId,
        name: c.name || 'お客様',
        kana: '',
        birth: c.birth || '',
        gender: 'O',
        occupation: c.occupation || '',
        family: c.family || [],
        proposals: [],
        source: 'line_survey',
        status: c.confirmedSlot ? 'active' : 'new',
        aum: c.aum || 0,
        lineFriendId: c.lineFriendId || c.userId || '',
        linePictureUrl: c.pictureUrl || c.linePictureUrl || '',
        lastContact: (c.lastContactAt?.toDate?.()?.toISOString?.() || c.confirmedAt?.toDate?.()?.toISOString?.() || c.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString()).slice(0,10),
        confirmedSlot: c.confirmedSlot || null,
        zoomUrl: c.zoomUrl || null,
        hostZoomUrl: c.hostZoomUrl || null,
        autoFromFirestore: true,
      };
      window.DUMMY_CLIENTS.push(newC);
      knownIds.add(newC.id);
      if (newC.lineFriendId) knownUids.add(newC.lineFriendId);
      added++;
    });
    if (added > 0 || toRemove.length > 0) {
      try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS)); } catch (_) {}
      if (added > 0) console.log('[fsSync] +', added, 'firestore customers → DUMMY_CLIENTS');
      if (window.FPCrmRefreshClients) window.FPCrmRefreshClients();
    }
  }
  window.refreshFirestoreCustomers = refreshFirestoreCustomers;
  if (!window._fpFirestoreInterval) {
    window._fpFirestoreInterval = setInterval(refreshFirestoreCustomers, 20000);
    refreshFirestoreCustomers();
  }

  function fillConfirmList() {
    const target = document.getElementById('confirm-list');
    if (!target) return;
    let surveys = (liveData && liveData.survey_answers) || [];
    // 本物 LINE userId (U + 32hex) でない古いテストデータ (uid=lf, SMOKE_*, anon-*) は除外
    const isRealLineUid = (uid) => /^U[a-f0-9]{32}$/i.test(String(uid || ''));
    const pendingLegacy = surveys.filter(s => !s.confirmedSlot && (s.q6_候補1 || s.q7_候補2 || s.q8_候補3) && isRealLineUid(s.userId));
    // ★ Firestore 顧客 を 既存 survey 形式 に 変換
    const fsCustomers = window._fpFirestoreCustomers || [];
    const pendingFs = fsCustomers.map(c => ({
      _fsCustomerId: c.docId,
      userId: 'fs:' + c.docId,
      name: c.name,
      // ★ LINE pictureUrl 反映 (fs:DOCID は liveData.users に存在しない → usersByUid lookup miss → イニシャル円になる退化バグ 修正)
      pictureUrl: c.pictureUrl || c.linePictureUrl || '',
      q2_年代: c.surveyAnswers?.q1_年代,
      q3_家族: c.surveyAnswers?.q3_家族,
      q4_年収: c.surveyAnswers?.q4_年収,
      q5_悩み: c.concerns || c.surveyAnswers?.q9_悩み,
      q6_候補1: (c.meetingCandidates||[])[0],
      q7_候補2: (c.meetingCandidates||[])[1],
      q8_候補3: (c.meetingCandidates||[])[2],
      ts: c.createdAt?.toDate?.()?.toISOString?.() || null,
    }));
    const pending = pendingLegacy.concat(pendingFs);
    if (pending.length === 0) {
      target.innerHTML = '<div style="background:var(--surface);border:1px dashed var(--line);border-radius:10px;padding:30px;text-align:center;color:var(--muted);font-size:13px;">候補日確定待ちのお客様はいません。<br><span style="font-size:11.5px;">LINEからアンケート + 候補日3つに回答するとここに並びます。</span></div>';
      return;
    }
    // user lookup (avatar + displayName)
    const usersByUid = {};
    ((liveData && liveData.users) || []).forEach(u => { if (u.userId) usersByUid[u.userId] = u; });
    target.innerHTML = pending.map(s => {
      const slots = [s.q6_候補1, s.q7_候補2, s.q8_候補3].filter(x => x);
      const uidShort = (s.userId || '').slice(0, 12);
      // ts を JST に変換
      const tsJst = s.ts ? new Date(s.ts).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
      const u = usersByUid[s.userId] || {};
      const displayName = (s.name && String(s.name).trim())
        || (u.displayName && String(u.displayName).trim())
        || ((s.q1_テーマ && s.q1_テーマ.trim()) ? s.q1_テーマ + 'のお客様' : '相談者');
      const initial = (displayName || '?').replace(/\s+/g, '').slice(0, 1);
      // ★ pictureUrl: s.pictureUrl (Firestore直) → u.pictureUrl (legacy users) の順 で fallback
      const picUrl = s.pictureUrl || u.pictureUrl || '';
      const avatarHtml = picUrl
        ? `<img src="${escapeHtml(picUrl)}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.12);">`
        : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:700;font-size:18px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.12);">${escapeHtml(initial)}</div>`;
      return `
        <div data-pending-card data-uid="${escapeHtml(s.userId || '')}" style="background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:10px;padding:18px 22px;margin-bottom:10px;box-shadow:var(--shadow-xs);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:12px;min-width:0;">
              ${avatarHtml}
              <div style="min-width:0;">
                <div><strong style="font-size:16px;">${escapeHtml(displayName)} 様</strong></div>
                <div style="font-size:11.5px;color:var(--gold);font-weight:700;margin-top:2px;">📅 ${escapeHtml(tsJst)} 回答</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
              <button data-focus-cal="${escapeHtml(s.userId || '')}" data-name="${escapeHtml(displayName)}" style="font-size:11.5px;font-weight:700;padding:6px 12px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;border-radius:6px;cursor:pointer;font-family:inherit;">📅 この方を見る</button>
              <button data-reschedule="${escapeHtml(s.userId || '')}" data-name="${escapeHtml(displayName)}" title="3つとも合わない時 → 改めて候補日を依頼" style="font-size:11.5px;font-weight:700;padding:6px 12px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-family:inherit;">✕ 別日再調整</button>
              <span class="status-pill important">確定待ち</span>
            </div>
          </div>
          <div style="font-size:12px;color:var(--muted);letter-spacing:0.02em;margin-bottom:10px;">
            ${escapeHtml(s.q2_年代 || '-')} / ${escapeHtml(s.q3_家族 || '-')} / ${escapeHtml(s.q4_年収 || '-')} / userId:${uidShort}…
          </div>
          <div style="background:#fffbf2;border:1px solid #f0d36b;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13.5px;color:#5e4d1a;line-height:1.6;">
            <span style="font-size:11px;color:#a08537;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;display:block;margin-bottom:4px;">お客様からの一言</span>
            💭 ${escapeHtml(s.q5_悩み || '(未記入)')}
          </div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">候補日 (タップで即確定)</div>
          <div style="display:grid;gap:6px;">
            ${slots.map((slot, idx) => {
              const parsed = parseSlotString(slot);
              return `<button class="slot-confirm-btn" data-slot-confirm
                data-fs-customer="${escapeHtml(s._fsCustomerId || '')}"
                data-uid="${escapeHtml(s.userId)}" data-date="${escapeHtml(parsed.dateStr)}" data-slot="${escapeHtml(parsed.slotStr)}"
                style="text-align:left;padding:12px 16px;background:#fff;border:2px solid var(--line);border-radius:8px;cursor:pointer;font-size:14px;display:flex;justify-content:space-between;align-items:center;font-family:inherit;transition:all 0.15s;">
                <span><strong style="color:var(--accent);margin-right:10px;">第${idx + 1}希望</strong>${escapeHtml(parsed.display)}</span>
                <span style="font-size:12px;color:var(--green);font-weight:700;background:var(--line-green-soft);padding:4px 10px;border-radius:6px;">この日で確定 →</span>
              </button>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');
    bindConfirmButtons();
    // 「📅 この方を見る」ボタン → カレンダーパネルを開いて該当顧客にフォーカス
    target.querySelectorAll('[data-focus-cal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.focusCal;
        if (!document.getElementById('fp-cal-side-v3')) {
          window._fpCalFocusUid = uid;
          toggleCalendarSidePanel();
        } else if (window.fpFocusCustomerInCalendar) {
          window.fpFocusCustomerInCalendar(uid);
        }
      });
    });
    // 「✕ 別日再調整」ボタン → 候補日3つとも合わない時の依頼 LINE 送信
    target.querySelectorAll('[data-reschedule]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showRescheduleTemplatePicker({
          userId: btn.dataset.reschedule,
          customerName: btn.dataset.name || 'お客',
        });
      });
    });
  }

  function fillBookingsList() {
    const target = document.getElementById('bookings-list');
    if (!target) return;
    // 完了アーカイブ済み bookingTs のセット (localStorage)
    const archived = new Set(JSON.parse(localStorage.getItem('fp-booking-archived') || '[]'));
    // ⚠ 旧 default (date-desc) が localStorage に固定されてる古いユーザを
    //   新 default (upcoming) に migrate
    let sortMode = localStorage.getItem('fp-bookings-sort') || 'upcoming';
    if (!localStorage.getItem('fp-sort-migrated-v2')) {
      sortMode = 'upcoming';
      localStorage.setItem('fp-bookings-sort', 'upcoming');
      localStorage.setItem('fp-sort-migrated-v2', '1');
    }
    // 並び替え
    const todayIso = new Date().toISOString().slice(0, 10);
    const cmp = {
      // 予定が近い順: 今日以降の未来昇順 → その後 過去降順
      'upcoming': (a, b) => {
        const ad = String(a.date || '').slice(0, 10);
        const bd = String(b.date || '').slice(0, 10);
        const aFut = ad >= todayIso;
        const bFut = bd >= todayIso;
        if (aFut && !bFut) return -1;  // a が未来 → a が先
        if (!aFut && bFut) return 1;   // b が未来 → b が先
        if (aFut && bFut) return ad.localeCompare(bd);  // 両方未来 → 近い順 (昇順)
        return bd.localeCompare(ad);   // 両方過去 → 新しい順 (降順)
      },
      'date-desc': (a, b) => String(b.date || '').localeCompare(String(a.date || '')),
      'date-asc':  (a, b) => String(a.date || '').localeCompare(String(b.date || '')),
      'created-desc': (a, b) => String(b.ts || '').localeCompare(String(a.ts || '')),
      'name': (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'),
    }[sortMode] || ((a, b) => 0);
    // ★ legacy proxy bookings + Firestore (多テナント) 確定済 を 合流
    const fsConfirmed = (window._fpFirestoreConfirmed || []).map(c => {
      const [d, t] = String(c.confirmedSlot || '').split(' ');
      return {
        _fsCustomerId: c.docId,
        userId: 'fs:' + c.docId,
        name: c.name,
        date: d || '',
        time: t || '',
        zoomUrl: c.zoomUrl,
        ts: c.confirmedAt?.toDate?.()?.toISOString?.() || c.createdAt?.toDate?.()?.toISOString?.() || '',
        status: 'confirmed',
        recordingStatus: null,
      };
    });
    const allBookings = (((liveData && liveData.bookings) || []).concat(fsConfirmed)).slice().sort(cmp);
    const bookings = allBookings.filter(b => !archived.has(b.ts)).slice(0, 8);
    const archivedCount = allBookings.filter(b => archived.has(b.ts)).length;
    // セレクトに現状値反映 + イベント
    const sortSel = document.getElementById('fp-bookings-sort');
    if (sortSel) {
      sortSel.value = sortMode;
      if (!sortSel._bound) {
        sortSel.addEventListener('change', (e) => {
          localStorage.setItem('fp-bookings-sort', e.target.value);
          fillBookingsList();
        });
        sortSel._bound = true;
      }
    }
    if (bookings.length === 0) {
      target.innerHTML = `<div style="background:#fff;border:1px dashed #e8e2d4;border-radius:8px;padding:28px 30px;color:#6b7280;font-size:12.5px;line-height:1.75;letter-spacing:0.02em;">
        <strong style="color:#1f2a3f;font-weight:700;font-size:13.5px;display:block;margin-bottom:8px;">進行中の予約はありません</strong>
        ここには <strong style="color:#1f2a3f;">確定済の Zoom 打ち合わせ</strong> が並びます:<br>
        ・上の「候補日確定 待ち」 でお客様の希望日を確定すると、ここに追加されます<br>
        ・面談当日: <strong style="color:#1f2a3f;">「録画ONでZoom開始」</strong> ボタンで Zoom 起動 + 自動録画開始<br>
        ・面談後: <strong style="color:#1f2a3f;">「完了 (台帳へ)」</strong> ボタンで顧客台帳に反映
        ${archivedCount > 0 ? `<br><br><a href="#" id="fp-show-archived" style="color:#1e3a5f;font-weight:700;">完了済み ${archivedCount}件 を見る →</a>` : ''}
      </div>`;
      if (archivedCount > 0) {
        document.getElementById('fp-show-archived').addEventListener('click', (e) => { e.preventDefault(); showArchivedBookings(allBookings.filter(b => archived.has(b.ts))); });
      }
      return;
    }
    // ISO日付 (Sheets自動変換) or "YYYY-MM-DD" 文字列を「MM/DD」と「曜日」に分割
    const formatBookingDate = (raw) => {
      if (!raw) return { mmdd: '-', weekday: '' };
      const str = String(raw);
      if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
        const d = new Date(str);
        const mm = d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', month: '2-digit' });
        const dd = d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', day: '2-digit' });
        const wdEn = d.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' });
        const wdMap = { Sun: '日', Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土' };
        return { mmdd: `${mm}/${dd}`, weekday: `(${wdMap[wdEn] || wdEn})` };
      }
      const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
        const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
        return { mmdd: `${m[2]}/${m[3]}`, weekday: `(${wd})` };
      }
      return { mmdd: str.slice(0, 10), weekday: '' };
    };
    // ISO時刻 or "午後 14:00" 風文字列を「14:00」+「午後」に分割
    const formatBookingTime = (raw) => {
      if (!raw) return '';
      const str = String(raw);
      if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
        const d = new Date(str);
        const hh = d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).replace(/[^\d]/g, '').padStart(2, '0');
        const mm = d.toLocaleString('en-CA', { timeZone: 'Asia/Tokyo', minute: '2-digit' }).replace(/[^\d]/g, '').padStart(2, '0');
        const hhNum = parseInt(hh, 10);
        const label = hhNum < 12 ? '午前' : hhNum < 18 ? '午後' : '夜';
        return `${label} ${hh}:${mm}`;
      }
      return str;
    };

    // user lookup (avatar + displayName) — fp-crm bookings リストにも反映
    const usersByUidBk = {};
    ((liveData && liveData.users) || []).forEach(u => { if (u.userId) usersByUidBk[u.userId] = u; });
    target.innerHTML = bookings.map(b => {
      const rec = b.recordingStatus || '';
      const tsEnc = encodeURIComponent(b.ts || '');
      const zUrl = escapeHtml(b.zoomUrl || '');
      const dateInfo = formatBookingDate(b.date);
      const timeStr = formatBookingTime(b.time);
      const u = usersByUidBk[b.userId] || {};
      const displayName = stripSama_(b.name || u.displayName || '匿名');
      const initial = (displayName || '?').replace(/\s+/g, '').slice(0, 1);
      const avatarHtml = u.pictureUrl
        ? `<img src="${escapeHtml(u.pictureUrl)}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1.5px solid #06c755;flex-shrink:0;">`
        : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.12);flex-shrink:0;">${escapeHtml(initial)}</div>`;
      // ローカル保存タスク件数を表示
      const tasksKey = 'fp-tasks-' + (b.userId || tsEnc);
      const savedTasksCount = (JSON.parse(localStorage.getItem(tasksKey) || '[]')).length;
      let cta = '';
      // キャンセルボタン (録画前のみ表示。録画開始したら出さない)
      const cancelBtnHtml = (rec !== 'recording' && rec !== 'saved')
        ? `<button class="btn-mini-action is-danger fp-cancel-booking" data-cancel-ts="${tsEnc}"><span class="icon">✕</span>キャンセル</button>`
        : '';
      if (rec === 'recording') {
        cta = `<button class="btn-rec-stop" data-rec-stop="${tsEnc}">■ 録画停止</button>
               <a class="btn-mini" href="${zUrl}" target="_blank">Zoomを開く</a>`;
      } else if (rec === 'saved') {
        // ★ 「完了」 ボタン 廃止 — 録画停止で 自動 archive + 議事録 顧客カード反映
        cta = `<button class="btn-mini-action" data-open-memo="${tsEnc}"><span class="icon">📝</span>メモ・タスク化${savedTasksCount > 0 ? ' ('+savedTasksCount+')' : ''}</button>`;
      } else if (zUrl) {
        // ★ 「完了」 ボタン 廃止 — 録画停止で 自動完了 (Zoom待ち から自動消去)
        cta = `<button class="btn-rec-start" data-rec-start="${tsEnc}" data-zoom="${zUrl}">● 録画ONでZoom開始</button>
               <button class="btn-mini-action" data-open-memo="${tsEnc}"><span class="icon">📝</span>メモ${savedTasksCount > 0 ? ' ('+savedTasksCount+'件)' : ''}</button>
               ${cancelBtnHtml}`;
      } else {
        cta = `<button class="btn-rec-start" data-rec-start="${tsEnc}" data-rec-mode="inperson" style="background:linear-gradient(135deg,#7C3AED,#6D28D9);">● 対面録画開始</button>
               <button class="btn-mini-action" data-open-memo="${tsEnc}"><span class="icon">📝</span>メモ${savedTasksCount > 0 ? ' ('+savedTasksCount+'件)' : ''}</button>
               ${cancelBtnHtml}`;
      }
      const recPill = rec === 'recording' ? '<span class="rec-pill recording">● 録画中</span>'
        : rec === 'saved' ? '<span class="rec-pill saved">📼 録画保存済</span>' : '';
      return `
        <div style="background:var(--surface);border:1px solid var(--line);border-left:4px solid ${rec === 'recording' ? 'var(--red)' : 'var(--line-green)'};border-radius:10px;padding:18px 22px;margin-bottom:10px;box-shadow:var(--shadow-xs);display:grid;grid-template-columns:104px 1fr;gap:18px;">
          <div style="border-right:1px solid var(--line);padding-right:14px;">
            <div style="font-size:22px;font-weight:800;font-family:'Inter',sans-serif;line-height:1.05;color:var(--ink);">${dateInfo.mmdd}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:1px;font-weight:600;">${dateInfo.weekday}</div>
            <div style="font-size:13px;color:var(--accent);margin-top:6px;font-weight:600;">${escapeHtml(timeStr)}</div>
          </div>
          <div style="min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                ${avatarHtml}
                <strong style="font-size:15.5px;">${escapeHtml(displayName)} 様</strong>
              </div>
              ${recPill}
            </div>
            ${b.zoomUrl ? `<div style="font-size:10.5px;color:var(--muted);font-family:ui-monospace,Menlo,monospace;margin-bottom:12px;word-break:break-all;line-height:1.5;">${escapeHtml(b.zoomUrl)}</div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;">${cta}</div>
          </div>
        </div>`;
    }).join('');
    // 末尾に完了済み件数表示 — クリックで詳細リスト
    if (archivedCount > 0) {
      const archivedItems = allBookings.filter(b => archived.has(b.ts));
      const archivedNames = archivedItems.slice(0, 3).map(b => (b.name || '匿名') + '様').join(' / ');
      const moreSuffix = archivedItems.length > 3 ? ` 他${archivedItems.length - 3}名` : '';
      target.innerHTML += `
        <div style="margin-top:14px;padding:14px 18px;background:linear-gradient(135deg,#dcfce7,#f0fdf4);border:1px solid #86efac;border-radius:10px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <span style="font-size:18px;">✅</span>
            <strong style="font-size:13.5px;color:#166534;">完了済み ${archivedCount}件 — 顧客台帳に反映済み</strong>
          </div>
          <div style="font-size:12px;color:#365314;margin-left:28px;margin-bottom:8px;">${escapeHtml(archivedNames + moreSuffix)}</div>
          <div style="margin-left:28px;display:flex;gap:8px;flex-wrap:wrap;">
            <a href="#" id="fp-jump-clients-tab" style="font-size:11.5px;padding:6px 12px;background:#fff;border:1px solid #86efac;color:#166534;border-radius:6px;text-decoration:none;font-weight:700;">→ 顧客台帳タブで確認</a>
            <a href="#" id="fp-show-archived" style="font-size:11.5px;padding:6px 12px;background:transparent;border:1px solid transparent;color:#166534;text-decoration:none;font-weight:600;">アーカイブを見る →</a>
          </div>
        </div>`;
      const sa = document.getElementById('fp-show-archived');
      if (sa) sa.addEventListener('click', (e) => { e.preventDefault(); showArchivedBookings(archivedItems); });
      const jc = document.getElementById('fp-jump-clients-tab');
      if (jc) jc.addEventListener('click', (e) => {
        e.preventDefault();
        const tabBtn = document.querySelector('div.tab[data-tab="clients"]');
        if (tabBtn) tabBtn.click();
      });
    }
    bindBookingsButtons();
  }

  function showCompletionToast(booking, client, isNew) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:#fff;border-left:5px solid #06c755;border-radius:12px;padding:16px 20px;box-shadow:0 12px 36px rgba(0,0,0,0.18);z-index:10002;max-width:420px;font-family:inherit;';
    t.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="font-size:22px;">✅</div>
        <strong style="font-size:14.5px;">面談完了 → 顧客台帳に反映しました</strong>
      </div>
      <div style="font-size:12.5px;color:#1f2937;line-height:1.7;margin-bottom:12px;">
        ・<strong>${escapeHtml(booking.name||'お客様')}様</strong> ${isNew ? 'を <span style="color:#06c755;font-weight:700;">新規顧客として登録</span>' : 'の<strong>最終接触日を更新</strong>'}<br>
        ・台帳: ${client ? `<strong>${escapeHtml(client.name)}</strong> (${client.status === 'new' ? '新規' : client.status === 'important' ? '重点' : client.status === 'active' ? '管理中' : '休眠'})` : '反映なし'}<br>
        ・最終接触: ${client ? client.lastContact : '-'}
      </div>
      <div style="display:flex;gap:6px;">
        <button id="fp-jump-client" style="font-size:11.5px;padding:7px 12px;background:linear-gradient(135deg,#b8893d,#d4a017);border:none;color:#fff;border-radius:6px;cursor:pointer;font-weight:700;font-family:inherit;">→ 顧客台帳で確認</button>
        <button id="fp-comp-close" style="font-size:11.5px;padding:7px 12px;background:#fff;border:1px solid #e5e7eb;color:#374151;border-radius:6px;cursor:pointer;font-family:inherit;">✕</button>
      </div>`;
    document.body.appendChild(t);
    document.getElementById('fp-comp-close').addEventListener('click', () => t.remove());
    document.getElementById('fp-jump-client').addEventListener('click', () => {
      t.remove();
      // 顧客台帳タブに切り替えて該当顧客の行をハイライト
      const tabBtn = document.querySelector('div.tab[data-tab="clients"]');
      if (tabBtn) tabBtn.click();
      setTimeout(() => {
        if (client && client.id) {
          const row = document.querySelector(`[data-client-id="${client.id}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.style.transition = 'all 0.4s';
            row.style.background = '#fff8e1';
            setTimeout(() => row.style.background = '', 2500);
          }
        }
      }, 400);
    });
    setTimeout(() => t.remove(), 12000);
  }

  function showArchivedBookings(items) {
    // 顧客台帳に紐付け (lineFriendId / name で マッチ)
    const findClient = (b) => {
      const cs = window.DUMMY_CLIENTS || [];
      let c = cs.find(x => x.lineFriendId && b.userId && x.lineFriendId === b.userId);
      if (!c) c = cs.find(x => x.name && b.name && x.name === b.name);
      return c;
    };
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;width:min(720px,100%);max-height:90vh;overflow-y:auto;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);font-family:'Noto Sans JP',sans-serif;">
        <div style="padding:20px 24px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <h2 style="margin:0;font-size:17px;font-weight:900;color:#0F172A;">✓ 完了済み面談 (${items.length}件)</h2>
          <button id="fp-arc-close" style="font-size:18px;width:34px;height:34px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:18px 24px;display:grid;gap:10px;">
          ${items.length === 0 ? '<div style="text-align:center;color:#94A3B8;padding:30px;font-size:13px;">完了済み面談 はありません</div>' : items.map((b, i) => {
            const c = findClient(b);
            const cid = c ? c.id : '';
            return `
              <div style="display:grid;grid-template-columns:90px 1fr auto;gap:12px;align-items:center;padding:13px 16px;background:#fafbfc;border:1.5px solid #e5e7eb;border-radius:10px;">
                <div style="font-size:14px;font-weight:800;font-family:'Inter',sans-serif;color:#0F172A;">${escapeHtml(String(b.date||'').slice(5,10).replace('-','/'))}</div>
                <div>
                  <strong style="font-size:14px;color:#0F172A;">${escapeHtml(b.name || '匿名')}様</strong>
                  <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">${escapeHtml(String(b.time||'').slice(0,5))}${c ? '' : ' · ⚠ 顧客台帳 未紐付け'}</div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                  ${cid ? `<button class="fp-arc-jump" data-cid="${escapeHtml(cid)}" style="font-size:12px;padding:8px 14px;background:linear-gradient(135deg,#5B5BF0,#4242C9);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:800;">📋 議事録を見る</button>` : ''}
                  <button class="fp-arc-unar" data-ts="${escapeHtml(b.ts)}" style="font-size:11.5px;padding:8px 12px;background:#fff;border:1.5px solid #e5e7eb;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;color:#64748B;">↩ 戻す</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#fp-arc-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('.fp-arc-unar').forEach(btn => {
      btn.addEventListener('click', () => {
        const set = new Set(JSON.parse(localStorage.getItem('fp-booking-archived') || '[]'));
        set.delete(btn.dataset.ts);
        localStorage.setItem('fp-booking-archived', JSON.stringify([...set]));
        overlay.remove();
        fillBookingsList();
      });
    });
    // ★ オーナーfb 2026-06-20: 「議事録を見る」 → 顧客モーダル の 議事録タブ に 直接 飛ぶ
    overlay.querySelectorAll('.fp-arc-jump').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = btn.dataset.cid;
        overlay.remove();
        // 顧客台帳タブ に 切替 → モーダル open → 議事録 タブ active
        const tabBtn = document.querySelector('div.tab[data-tab="clients"]');
        if (tabBtn) tabBtn.click();
        setTimeout(() => {
          if (window.FpApp && window.FpApp.openClientModal) {
            window.FpApp.openClientModal(cid);
            setTimeout(() => {
              const mt = document.querySelector('[data-cdtab="meetings"]');
              if (mt) mt.click();
            }, 250);
          }
        }, 200);
      });
    });
  }

  function fillFunnelArea() {
    const target = document.getElementById('funnel-area');
    if (!target) return;
    const f = window.LEAD_FUNNEL;
    const conv = (a, b) => b === 0 ? 0 : Math.round(a / b * 100);
    target.innerHTML = `
      <div class="funnel-grid">
        <div class="funnel-step"><div class="funnel-icon">👋</div><div class="funnel-label">友だち追加</div><div class="funnel-value">${f.friendAdded}</div><div class="funnel-conv">—</div></div>
        <div class="funnel-arrow">→</div>
        <div class="funnel-step"><div class="funnel-icon">📝</div><div class="funnel-label">アンケート</div><div class="funnel-value">${f.answeredSurvey}</div><div class="funnel-conv">${conv(f.answeredSurvey, f.friendAdded)}%</div></div>
        <div class="funnel-arrow">→</div>
        <div class="funnel-step"><div class="funnel-icon">📅</div><div class="funnel-label">Zoom予約</div><div class="funnel-value">${f.booked}</div><div class="funnel-conv">${conv(f.booked, f.answeredSurvey)}%</div></div>
        <div class="funnel-arrow">→</div>
        <div class="funnel-step"><div class="funnel-icon">🎯</div><div class="funnel-label">面談実施</div><div class="funnel-value">${f.completed}</div><div class="funnel-conv">${conv(f.completed, f.booked)}%</div></div>
        <div class="funnel-arrow">→</div>
        <div class="funnel-step highlight"><div class="funnel-icon">⭐</div><div class="funnel-label">成約</div><div class="funnel-value">${f.converted}</div><div class="funnel-conv">${conv(f.converted, f.completed)}%</div></div>
      </div>
    `;
  }

  function fillSurveysList() {
    const target = document.getElementById('surveys-list');
    if (!target) return;
    let src = (liveData && liveData.survey_answers) || [];
    const list = src.slice().reverse().slice(0, 5);
    if (list.length === 0) { target.innerHTML = ''; return; }
    target.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">最新のアンケート回答 (確定済も含む)</div>
      ${list.map(s => `
        <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin-bottom:6px;display:grid;grid-template-columns:1fr auto;gap:10px;font-size:12.5px;">
          <div>
            <strong>${escapeHtml(s.q1_テーマ || '-')}</strong>
            <span style="color:var(--muted);margin-left:6px;font-size:11px;">${(s.ts || '').slice(5, 16).replace('T', ' ')}</span>
            <div style="color:var(--muted);font-size:11px;margin-top:2px;">${escapeHtml(s.q2_年代 || '-')} / ${escapeHtml(s.q3_家族 || '-')} / ${escapeHtml(s.q4_年収 || '-')}</div>
          </div>
          <div>${s.confirmedSlot ? `<span class="status-pill active">確定済</span>` : '<span class="status-pill important">確定待ち</span>'}</div>
        </div>
      `).join('')}
    `;
  }

  function bindConfirmButtons() {
    document.querySelectorAll('[data-slot-confirm]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const dateStr = btn.dataset.date;
        const slotStr = btn.dataset.slot;
        const isDemo = uid && uid.indexOf('Udemo') === 0;

        const confirmMsg = isDemo
          ? `[デモモード] ${dateStr} ${slotStr} で確定します。\n\n本番では以下が同時に動きます:\n• Zoom URL自動発行\n• お客様にLINE通知\n• Googleカレンダー登録\n\n進めますか?`
          : `${dateStr} ${slotStr} で確定します。\n\nZoomURL発行 → お客様LINE通知 → Googleカレンダー登録 が同時に動きます。`;
        if (!confirm(confirmMsg)) return;

        btn.disabled = true;
        const inner = btn.querySelector('span:last-child');
        if (inner) inner.textContent = '処理中...';

        // ─── デモuserId は擬似成功 ───
        if (isDemo) {
          const fakeZoom = 'https://zoom.us/j/' + Math.floor(Math.random() * 9000000000 + 1000000000) + '?pwd=fpcompass';
          setTimeout(() => {
            alert('✅ 確定しました (デモモード)\n\n📅 ' + dateStr + ' ' + slotStr + '\n💻 Zoom URL: ' + fakeZoom + '\n\n本番ではこの瞬間に:\n  ・お客様の LINE にZoom URL通知\n  ・Googleカレンダーに60分予約イベント登録\n  ・スプレッドシートに予約記録\nが自動で動きます。');
            // デモ確定したら DEMO データから該当を削除して再描画
            if (window.SURVEY_DEMO) {
              window.SURVEY_DEMO = window.SURVEY_DEMO.filter(s => s.userId !== uid);
            }
            renderLeadHubInner();
          }, 600);
          return;
        }

        // ─── Firestore 顧客 (多テナント) → confirmSlotMultiTenant Cloud Function ───
        const fsCustomerId = btn.dataset.fsCustomer;
        if (fsCustomerId) {
          try {
            const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
            const app = getApps()[0] || initializeApp({
              apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
              authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
              projectId: 'skeleton-fp-compass-632026',
            });
            const fn = httpsCallable(getFunctions(app, 'asia-northeast1'), 'confirmSlotMultiTenant');
            const res = await fn({ customerId: fsCustomerId, confirmedSlot: `${dateStr} ${slotStr}` });
            alert('✅ 確定\n\nZoom URL: ' + res.data.zoomUrl + '\nお客様 に LINE カード 自動送信済');
            if (window.refreshFirestoreCustomers) window.refreshFirestoreCustomers();
            renderLeadHubInner();
          } catch (e) {
            alert('失敗: ' + (e.message || e.code || '不明'));
            btn.disabled = false;
            if (inner) inner.textContent = 'この日で確定 →';
          }
          return;
        }

        // ─── 本物のLIVEデータは Cloud Run へ ───
        try {
          const r = await fetch(CLOUD_RUN_BASE + '/api/confirm-slot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: uid, dateStr: dateStr, slotStr: slotStr }),
          });
          const data = await r.json();
          if (data.ok) {
            alert('✅ 確定\n\nZoom URL: ' + data.zoomUrl + '\nお客様にLINE通知済 + Googleカレンダー登録済');
            await fetchLiveData();
            renderLeadHubInner();
          } else {
            alert('失敗: ' + (data.error || data.raw || '不明なエラー'));
            btn.disabled = false;
            if (inner) inner.textContent = 'この日で確定 →';
          }
        } catch (e) {
          alert('失敗: ' + e.message);
          btn.disabled = false;
          if (inner) inner.textContent = 'この日で確定 →';
        }
      });
    });
  }

  // ===== LINE 友だち追加プロンプト (userId が無いお客様向け) =====
  // フェムーン (FEMOON) 解法と同じ: 友だち追加URLに ?ref=clientId を埋めて
  // ボットの handleFollow で受け取り → ref と userId を自動紐付ける流れ
  function showFriendAddPrompt(customerName, clientId) {
    const existing = document.getElementById('fp-friend-add-prompt');
    if (existing) existing.remove();
    const botId = '@511thleq'; // FP Compass デモ bot
    const addUrl = `https://line.me/R/ti/p/${encodeURIComponent(botId)}` + (clientId ? `?ref=${encodeURIComponent(clientId)}` : '');
    const overlay = document.createElement('div');
    overlay.id = 'fp-friend-add-prompt';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;width:min(540px,100%);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;font-family:inherit;">
        <div style="padding:18px 22px;background:linear-gradient(135deg,#fef9c3,#fffbeb);border-bottom:1px solid #fde68a;display:flex;justify-content:space-between;align-items:baseline;">
          <strong style="font-size:15px;color:#78350f;">⚠ ${escapeHtml(customerName || 'この方')} は LINE 友だち追加がまだです</strong>
          <button id="fp-friend-add-close" style="background:#fff;border:1px solid #fde68a;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px;color:#78350f;">✕</button>
        </div>
        <div style="padding:20px 22px;font-size:13px;line-height:1.75;color:#374151;">
          <p style="margin:0 0 14px;">LINE Messaging API はお客様が <strong>こちらの公式LINEを友だち追加した時点で userId が発行される仕組み</strong> です。まだ追加していないため、こちらから直接送信できません。</p>
          <p style="margin:0 0 14px;">下のリンクを SMS / メール / 名刺 QR などで送ってください。お客様が追加した瞬間、CRM に <strong>自動で userId が紐付き</strong>、こちらから LINE 送信できるようになります。</p>
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px;margin:14px 0;">
            <div style="font-size:10.5px;font-weight:700;color:#166534;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">友だち追加リンク (${escapeHtml(customerName || '匿名')} 様 専用)</div>
            <code id="fp-friend-add-url" style="display:block;font-size:11.5px;color:#0f172a;background:#fff;border:1px solid #d1d5db;padding:10px 12px;border-radius:6px;word-break:break-all;font-family:Menlo,monospace;">${escapeHtml(addUrl)}</code>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button id="fp-friend-add-copy" style="flex:1;padding:9px;background:#06c755;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">📋 URL をコピー</button>
              <button id="fp-friend-add-open" style="flex:1;padding:9px;background:#fff;color:#0f172a;border:1px solid #d1d5db;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">↗ 新タブで開く</button>
            </div>
          </div>
          <p style="margin:0;font-size:11.5px;color:#6b7280;">※ ?ref=${escapeHtml(clientId || 'なし')} が末尾に付いてます。お客様が追加した時に この CRM の顧客カードと自動で紐付き、displayName と pictureUrl も自動取得されます。</p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('fp-friend-add-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('fp-friend-add-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(addUrl);
      const b = document.getElementById('fp-friend-add-copy');
      b.textContent = '✓ コピー済';
      setTimeout(() => { b.textContent = '📋 URL をコピー'; }, 2000);
    });
    document.getElementById('fp-friend-add-open').addEventListener('click', () => {
      window.open(addUrl, '_blank', 'noopener');
    });
  }

  // 日付・時刻の堅牢な整形 (Sheets が "1899-12-30T18:00:00.000Z" 形式で返す time セル対策)
  function fmtTime_(raw) {
    if (!raw) return '';
    const s = String(raw);
    // ISO datetime: "...T18:00:00..." → "18:00"
    const isoMatch = s.match(/T(\d{1,2}):(\d{2})/);
    if (isoMatch) return isoMatch[1].padStart(2, '0') + ':' + isoMatch[2];
    // 普通の HH:mm / HH:mm:ss
    const hmMatch = s.match(/^(\d{1,2}):(\d{2})/);
    if (hmMatch) return hmMatch[1].padStart(2, '0') + ':' + hmMatch[2];
    return '';
  }
  function fmtDateMMDD_(raw) {
    if (!raw) return '';
    const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return parseInt(m[2]) + '月' + parseInt(m[3]) + '日';
  }
  function fmtDateJa_(raw) {
    const m = String(raw || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    const wd = ['日','月','火','水','木','金','土'][d.getDay()];
    return parseInt(m[2]) + '月' + parseInt(m[3]) + '日(' + wd + ')';
  }
  function stripSama_(s) {
    return String(s || '').replace(/\s*様$/, '').replace(/\s*さん$/, '').trim();
  }

  // ===== Zoom 予約 キャンセル: テンプレ複数から選んで LINE 送信 =====
  function showCancelTemplatePicker(booking) {
    const existing = document.getElementById('fp-cancel-picker');
    if (existing) existing.remove();
    const name = stripSama_((booking && booking.name) || 'お客');
    const dateJa = fmtDateJa_((booking && booking.date) || '');
    const timeOk = fmtTime_((booking && booking.time) || '');
    const dateLabel = (dateJa && timeOk) ? (dateJa + ' ' + timeOk) : (dateJa || timeOk || '(日時未設定)');
    const templates = [
      {
        id: 'fp-emergency',
        label: 'FP都合・急用で変更',
        body: `${name}様\n\n大変申し訳ございません。${dateLabel} に予定しておりました面談ですが、FP側 急な用件が入りまして日程変更をお願いせざるを得ない状況です。\n\nご迷惑をおかけしますが、改めて候補日を3つお送りいただけますでしょうか?\n\n— 福田`,
      },
      {
        id: 'customer-cancel',
        label: 'お客様キャンセル受領',
        body: `${name}様\n\n${dateLabel} の面談キャンセルご連絡、承知いたしました。\n\nまたタイミングが合いましたら、いつでもこちらの LINE からお声がけください。引き続きどうぞよろしくお願いいたします。\n\n— 福田`,
      },
      {
        id: 'reschedule-soft',
        label: '日程再調整 (お客様都合・延期)',
        body: `${name}様\n\n${dateLabel} の面談、ご都合変更承りました。お忙しい中ありがとうございます。\n\n改めて候補日を3つお送りいただけますと、こちらで調整して Zoom URL をお送りいたします。よろしくお願いいたします。\n\n— 福田`,
      },
      {
        id: 'illness',
        label: '体調不良で延期',
        body: `${name}様\n\nご体調いかがでしょうか。お大事になさってください。\n\n${dateLabel} の面談は一旦キャンセル扱いとさせていただきます。ご回復されてから改めて候補日3つをお知らせください。お待ちしております🙏\n\n— 福田`,
      },
      {
        id: 'custom',
        label: '✏️ 自由入力 (テンプレ無し)',
        body: '',
      },
    ];
    const overlay = document.createElement('div');
    overlay.id = 'fp-cancel-picker';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;width:min(640px,100%);max-height:92vh;overflow-y:auto;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);font-family:inherit;">
        <div style="padding:18px 22px;background:linear-gradient(135deg,#fef2f2,#fff5f5);border-bottom:1px solid #fecaca;display:flex;justify-content:space-between;align-items:baseline;">
          <div>
            <div style="font-size:10.5px;font-weight:700;color:#7f1d1d;letter-spacing:0.18em;text-transform:uppercase;">CANCEL BOOKING</div>
            <strong style="font-size:15px;color:#0f1729;">${escapeHtml(name)} 様 / ${escapeHtml(dateLabel)} 面談 キャンセル</strong>
          </div>
          <button id="fp-cancel-close" style="background:#fff;border:1px solid #fecaca;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px;color:#7f1d1d;">✕</button>
        </div>
        <div style="padding:18px 22px;">
          <div style="font-size:11.5px;color:#6b7280;margin-bottom:12px;">キャンセル理由のテンプレを選んでください。「自由入力」を選ぶと空白から書けます。</div>
          <div style="display:grid;gap:8px;margin-bottom:14px;">
            ${templates.map((t, i) => `
              <label style="display:flex;align-items:flex-start;gap:10px;padding:11px 14px;border:1.5px solid #e5e7eb;border-radius:8px;cursor:pointer;background:#fff;transition:all 0.15s;">
                <input type="radio" name="cancel-tpl" value="${t.id}" ${i === 0 ? 'checked' : ''} style="margin-top:3px;">
                <div style="flex:1;font-size:13px;font-weight:600;color:#1f2937;">${escapeHtml(t.label)}</div>
              </label>
            `).join('')}
          </div>
          <div style="font-size:10.5px;font-weight:700;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">送信されるメッセージ (編集可)</div>
          <textarea id="fp-cancel-msg" style="width:100%;min-height:200px;padding:12px 14px;font-size:13px;line-height:1.7;font-family:inherit;border:1.5px solid #d1d5db;border-radius:8px;resize:vertical;background:#fafbfc;">${escapeHtml(templates[0].body)}</textarea>
          <div style="display:flex;gap:10px;margin-top:16px;">
            <button id="fp-cancel-abort" style="flex:1;padding:11px;background:#fff;border:1.5px solid #d1d5db;color:#374151;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">キャンセル (送信しない)</button>
            <button id="fp-cancel-send" style="flex:2;padding:11px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">📤 この内容で送信 + 予約をキャンセル</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('fp-cancel-close').addEventListener('click', () => overlay.remove());
    document.getElementById('fp-cancel-abort').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    // テンプレ切替で textarea を更新
    overlay.querySelectorAll('input[name="cancel-tpl"]').forEach(inp => {
      inp.addEventListener('change', () => {
        const t = templates.find(x => x.id === inp.value);
        document.getElementById('fp-cancel-msg').value = t ? t.body : '';
      });
    });
    // 送信
    document.getElementById('fp-cancel-send').addEventListener('click', async () => {
      const msg = document.getElementById('fp-cancel-msg').value.trim();
      if (!msg) { alert('メッセージ本文を入力してください。'); return; }
      const uid = booking && booking.userId;
      if (!uid) { showFriendAddPrompt(name, ''); return; }
      const btn = document.getElementById('fp-cancel-send');
      btn.disabled = true; btn.textContent = '送信中…';
      try {
        // 1) LINE 送信
        const r1 = await fetch(CLOUD_RUN_BASE + '/api/send-line', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid, text: msg }),
        });
        const d1 = await r1.json();
        if (!d1.ok) throw new Error(d1.error || 'LINE 送信失敗');
        // 2) 予約 status を cancelled に
        if (booking.id || booking.ts) {
          await fetch(CLOUD_RUN_BASE + '/api/cancel-booking', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: booking.id || '', ts: booking.ts || '', userId: uid }),
          }).catch(() => {/* best effort */});
        }
        overlay.remove();
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #dc2626;border-radius:12px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:10010;font-family:inherit;';
        t.innerHTML = `<strong style="font-size:14px;">✓ キャンセル LINE 送信完了</strong><br><span style="font-size:12px;color:#6b7280;">${escapeHtml(name)} 様 の ${escapeHtml(dateLabel)} 予約をキャンセル処理しました</span>`;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 6000);
        await fetchLiveData();
        renderLeadHubInner();
      } catch (e) {
        alert('失敗: ' + e.message);
        btn.disabled = false; btn.textContent = '📤 この内容で送信 + 予約をキャンセル';
      }
    });
  }

  // ===== 候補日3つ合わない時の 再調整依頼: テンプレ複数 + 自動URL付き =====
  function showRescheduleTemplatePicker(customer) {
    // customer = { userId, customerName, ts } など
    const existing = document.getElementById('fp-reschedule-picker');
    if (existing) existing.remove();
    const name = stripSama_(customer.customerName || customer.name || 'お客');
    const uid = customer.userId || '';
    const bookingBase = 'https://fp-compass-webhook-527726449426.asia-northeast1.run.app';
    const rebookingUrl = bookingBase + '/booking/' + encodeURIComponent(uid);
    const fp = '福田'; // FP_NAME
    const tail = `\n\n▼ お手数ですが、改めて候補日を 3 つお選びください\n${rebookingUrl}\n\nよろしくお願いいたします。\n— ${fp}`;
    const templates = [
      {
        id: 'fp-busy',
        label: 'FP都合 (3つとも先約あり)',
        body: `🙏 ${name}様\n\nアンケート + 候補日のご回答ありがとうございました。\n\n大変申し訳ございません、${name}様にご提示いただいた候補日3つとも ${fp} の先約と重なっており、調整が難しい状況です。${tail}`,
      },
      {
        id: 'fp-week-suggest',
        label: '来週でしたら空きが多い',
        body: `🙏 ${name}様\n\nアンケート + 候補日のご回答ありがとうございました。\n\n大変申し訳ございません、ご提示いただいた候補日3つとも先約と重なっておりました。\n\n💡 来週でしたら空き枠が多くございますので、その辺りでご検討いただけますと幸いです。${tail}`,
      },
      {
        id: 'fp-weekend',
        label: '土日でも対応可能',
        body: `🙏 ${name}様\n\nアンケート + 候補日のご回答ありがとうございました。\n\n大変申し訳ございません、平日の候補日3つは先約と重なっておりまして…\n\n💡 もし土日のご都合がよろしければ、土日も対応可能です。改めてお選びいただけますでしょうか?${tail}`,
      },
      {
        id: 'fp-evening',
        label: '夕方以降の枠を提案',
        body: `🙏 ${name}様\n\nアンケート + 候補日のご回答ありがとうございました。\n\n大変申し訳ございません、いただいた候補日3つは先約と重なっておりました。\n\n💡 19:00 / 20:00 の夕方〜夜の枠でしたら比較的空きがございます。可能でしたらその時間帯でご検討ください。${tail}`,
      },
      {
        id: 'custom',
        label: '✏️ 自由入力 (テンプレ無し・URLは自動付加)',
        body: `🙏 ${name}様\n\n${tail.trim()}`,
      },
    ];
    const overlay = document.createElement('div');
    overlay.id = 'fp-reschedule-picker';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;width:min(680px,100%);max-height:92vh;overflow-y:auto;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);font-family:inherit;">
        <div style="padding:18px 22px;background:linear-gradient(135deg,#fef9c3,#fffbeb);border-bottom:1px solid #fde68a;display:flex;justify-content:space-between;align-items:baseline;">
          <div>
            <div style="font-size:10.5px;font-weight:700;color:#78350f;letter-spacing:0.18em;text-transform:uppercase;">REQUEST RESCHEDULE</div>
            <strong style="font-size:15px;color:#0f1729;">${escapeHtml(name)} 様 / 候補日3つとも合わない → 別日を依頼</strong>
          </div>
          <button id="fp-resched-close" style="background:#fff;border:1px solid #fde68a;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px;color:#78350f;">✕</button>
        </div>
        <div style="padding:18px 22px;">
          <div style="font-size:11.5px;color:#6b7280;margin-bottom:12px;">FP からのひとことテンプレを選んでください。送信文末に <strong>再選択フォームのURL</strong>が自動で付きます。</div>
          <div style="display:grid;gap:8px;margin-bottom:14px;">
            ${templates.map((t, i) => `
              <label style="display:flex;align-items:flex-start;gap:10px;padding:11px 14px;border:1.5px solid #e5e7eb;border-radius:8px;cursor:pointer;background:#fff;transition:all 0.15s;">
                <input type="radio" name="resched-tpl" value="${t.id}" ${i === 0 ? 'checked' : ''} style="margin-top:3px;">
                <div style="flex:1;font-size:13px;font-weight:600;color:#1f2937;">${escapeHtml(t.label)}</div>
              </label>
            `).join('')}
          </div>
          <div style="font-size:10.5px;font-weight:700;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">送信されるメッセージ (編集可)</div>
          <textarea id="fp-resched-msg" style="width:100%;min-height:220px;padding:12px 14px;font-size:13px;line-height:1.7;font-family:inherit;border:1.5px solid #d1d5db;border-radius:8px;resize:vertical;background:#fafbfc;">${escapeHtml(templates[0].body)}</textarea>
          <div style="margin-top:8px;font-size:11px;color:#16a34a;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:8px 12px;">✓ お客様がこのURLから3つ選び直すと、CRMの「候補日確定待ち」に再度上がってきます。</div>
          <div style="display:flex;gap:10px;margin-top:16px;">
            <button id="fp-resched-abort" style="flex:1;padding:11px;background:#fff;border:1.5px solid #d1d5db;color:#374151;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">キャンセル (送信しない)</button>
            <button id="fp-resched-send" style="flex:2;padding:11px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">📤 この内容で送信 + 候補日3つを無効化</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('fp-resched-close').addEventListener('click', () => overlay.remove());
    document.getElementById('fp-resched-abort').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('input[name="resched-tpl"]').forEach(inp => {
      inp.addEventListener('change', () => {
        const t = templates.find(x => x.id === inp.value);
        document.getElementById('fp-resched-msg').value = t ? t.body : '';
      });
    });
    document.getElementById('fp-resched-send').addEventListener('click', async () => {
      const msg = document.getElementById('fp-resched-msg').value.trim();
      if (!msg) { alert('メッセージ本文を入力してください。'); return; }
      if (!uid) { showFriendAddPrompt(name, ''); return; }
      const isDemo = uid.indexOf('Udemo') === 0;
      const btn = document.getElementById('fp-resched-send');
      btn.disabled = true; btn.textContent = '送信中…';
      try {
        if (isDemo) {
          await new Promise(r => setTimeout(r, 600));
          overlay.remove();
          alert('[デモモード] 再調整依頼を送信 (本番では LINE 送信)');
          return;
        }
        // ★ Firestore 多テナント 顧客: requestReschedule Cloud Function
        if (uid.startsWith('fs:')) {
          const fsCustomerId = uid.slice(3);
          const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
          const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
          const app = getApps()[0] || initializeApp({
            apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
            authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
            projectId: 'skeleton-fp-compass-632026',
          });
          const fn = httpsCallable(getFunctions(app, 'asia-northeast1'), 'requestReschedule');
          await fn({ customerId: fsCustomerId, message: msg });
          overlay.remove();
          const t = document.createElement('div');
          t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #f59e0b;border-radius:12px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:10010;font-family:inherit;';
          t.innerHTML = `<strong style="font-size:14px;">↩ ${escapeHtml(name)} 様 再調整依頼を送信</strong><br><span style="font-size:12px;color:#6b7280;">LINE送信完了 / 候補日3つを無効化</span>`;
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 6000);
          if (window.refreshFirestoreCustomers) await window.refreshFirestoreCustomers();
          if (typeof renderLeadHubInner === 'function') renderLeadHubInner();
          return;
        }
        // legacy proxy
        const r = await fetch(CLOUD_RUN_BASE + '/api/request-reschedule', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid, name: name, fullMessage: msg }),
        });
        const data = await r.json();
        if (data.ok) {
          overlay.remove();
          const t = document.createElement('div');
          t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #f59e0b;border-radius:12px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:10010;font-family:inherit;';
          t.innerHTML = `<strong style="font-size:14px;">↩ ${escapeHtml(name)} 様 再調整依頼を送信</strong><br><span style="font-size:12px;color:#6b7280;">再選択URL付き LINE 送信 / 候補日3つを無効化</span>`;
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 6000);
          await fetchLiveData();
          renderLeadHubInner();
          // カレンダーパネル側も更新
          if (window.fpFocusCustomerInCalendar) window.fpFocusCustomerInCalendar(null);
        } else {
          alert('失敗: ' + (data.error || '不明'));
          btn.disabled = false; btn.textContent = '📤 この内容で送信 + 候補日3つを無効化';
        }
      } catch (e) {
        alert('失敗: ' + e.message);
        btn.disabled = false; btn.textContent = '📤 この内容で送信 + 候補日3つを無効化';
      }
    });
  }

  // ===== 画面録画 (getDisplayMedia + MediaRecorder) =====
  window._fpRecorder = window._fpRecorder || {
    mediaRecorder: null, chunks: [], startTime: null, bookingTs: null, timerId: null, blobUrl: null,
  };

  // メモpopup からの「面談を完了」 メッセージ受信
  if (!window._fpMessageWired) {
    window._fpMessageWired = true;
    window.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'fp-finish-meeting') {
        const hasActiveRecording = window._fpRecorder
          && window._fpRecorder.mediaRecorder
          && window._fpRecorder.mediaRecorder.state !== 'inactive';
        if (hasActiveRecording) {
          stopScreenRecording();
        } else {
          // 録画なし → silent skip だと「ボタン効かない」 と見える → 理由明示 + メモ保存案内
          handleFinishWithoutRecording();
        }
      }
    });
  }

  // 対面モード録画: webcam + マイクで録画 → 同じ AI議事録パイプラインへ
  async function startWebcamRecording(bookingTs) {
    const R = window._fpRecorder;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });
    } catch (e) {
      // ★ オーナーfb 2026-06-22 (roundG): カメラ/マイク 失敗時に 進める fallback を 3 つ提示
      //   1) マイクのみ録音 (音声 → AI議事録 まで同じパイプライン)
      //   2) メモのみ (録画なしで メモモーダル 開く)
      //   3) 設定見直してリロード
      const errName = e?.name || '';
      const isPermission = /NotAllowed|Permission/i.test(errName);
      const isNoDevice = /NotFound|DevicesNotFound/i.test(errName);
      const isInUse = /NotReadable|InUse|TrackStart/i.test(errName);
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.78);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:"Hiragino Sans",sans-serif;overflow-y:auto;padding:24px 0;';
      const heading = isPermission ? 'カメラ / マイク のアクセス が ブロックされています'
        : isNoDevice ? 'カメラ / マイク が 見つかりません'
        : isInUse ? 'カメラ / マイク が 他のアプリ で 使用中 です'
        : 'カメラ起動 に 失敗しました';
      ov.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:520px;width:92%;padding:28px 32px;box-shadow:0 28px 80px rgba(0,0,0,0.4);">
          <div style="display:inline-flex;align-items:center;gap:8px;background:#FEF3C7;color:#92400E;font-size:11px;font-weight:800;padding:5px 12px;border-radius:99px;letter-spacing:0.1em;margin-bottom:14px;">⚠ 録画準備 に 問題</div>
          <h2 style="font-family:'Noto Serif JP',serif;font-size:19px;font-weight:700;color:#111827;margin:0 0 8px;line-height:1.45;">${heading}</h2>
          <p style="font-size:13px;color:#6b7280;line-height:1.75;margin:0 0 18px;">大丈夫です。 <strong style="color:#111827;">下のどれかを選んで そのまま 面談に進めます</strong>。 設定の修正は あとで OK。</p>

          <!-- Option 1: マイクだけで録音 (大本命) -->
          <button id="fp-rec-fallback-audio" style="display:block;width:100%;text-align:left;background:linear-gradient(135deg,#C19A3A,#9A5A18);color:#fff;border:none;border-radius:11px;padding:18px 22px;margin-bottom:10px;cursor:pointer;font-family:inherit;transition:transform .15s,box-shadow .15s;box-shadow:0 6px 18px rgba(193,154,58,0.3);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
              <div>
                <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;opacity:0.85;margin-bottom:4px;">RECOMMENDED</div>
                <div style="font-size:15.5px;font-weight:800;letter-spacing:0.03em;line-height:1.4;">🎤 マイクだけで 録音する</div>
                <div style="font-size:11.5px;opacity:0.9;margin-top:4px;line-height:1.55;">カメラ無しで OK。 音声から AI議事録 まで 同じ流れで 作れます。</div>
              </div>
              <span style="font-size:22px;flex-shrink:0;">→</span>
            </div>
          </button>

          <!-- Option 2: メモのみ -->
          <button id="fp-rec-fallback-memo" style="display:block;width:100%;text-align:left;background:#fff;color:#1F2A3F;border:1.5px solid #E8E2D4;border-radius:11px;padding:16px 22px;margin-bottom:10px;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
              <div>
                <div style="font-size:11px;font-weight:800;color:#9A5A18;letter-spacing:0.14em;margin-bottom:4px;">手書きメモ</div>
                <div style="font-size:14px;font-weight:700;letter-spacing:0.03em;line-height:1.4;">📝 録音せず メモだけ 書く</div>
                <div style="font-size:11.5px;color:#6b7280;margin-top:4px;line-height:1.55;">手入力で 議事録を 残す。 録音 / 議事録自動生成 は なし。</div>
              </div>
              <span style="font-size:18px;color:#9A5A18;flex-shrink:0;">→</span>
            </div>
          </button>

          <!-- Option 3: 設定見直す (技術系) -->
          <details style="margin-top:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:0;">
            <summary style="cursor:pointer;padding:12px 16px;font-size:12.5px;font-weight:700;color:#475569;list-style:none;display:flex;align-items:center;justify-content:space-between;">
              <span>⚙ カメラ/マイク を 設定して 録画 する (技術詳細)</span>
              <span style="font-size:14px;">▾</span>
            </summary>
            <div style="padding:0 16px 14px;font-size:12.5px;color:#475569;line-height:1.85;">
              <ol style="margin:0;padding-left:22px;">
                ${(isPermission ? [
                  '画面上部 アドレスバー左の <strong>🎥/🎤 アイコン</strong> をクリック',
                  '「常に許可」を選択 → ページをリロード',
                ] : isNoDevice ? [
                  'PC に カメラ・マイク が 内蔵 / USB 接続されているか 確認',
                  'Mac: <strong>システム設定 → プライバシーとセキュリティ → カメラ/マイク</strong> で ブラウザ ON',
                ] : isInUse ? [
                  'Zoom / Meet / Teams 等 他のビデオ会議アプリ を 完全終了',
                  '別タブで カメラ を使う アプリ も 閉じる',
                ] : [
                  'ブラウザをリロード → 再試行',
                ]).map(s => `<li style="margin-bottom:4px;">${s}</li>`).join('')}
              </ol>
              <button onclick="location.reload()" class="btn-mini-action" style="margin-top:12px;">↻ ページをリロード</button>
              <div style="margin-top:12px;font-size:10.5px;color:#94A3B8;font-family:'JetBrains Mono',monospace;line-height:1.5;">技術: ${escapeHtml(String(errName || e?.message || e).slice(0, 160))}</div>
            </div>
          </details>

          <div style="display:flex;justify-content:flex-end;margin-top:14px;">
            <button class="btn-cta-ghost" id="fp-rec-err-close">あとにする</button>
          </div>
        </div>`;
      document.body.appendChild(ov);

      const closeOv = () => ov.remove();
      document.getElementById('fp-rec-err-close').addEventListener('click', closeOv);

      // Option 1: マイクのみで録音
      document.getElementById('fp-rec-fallback-audio').addEventListener('click', async () => {
        closeOv();
        await startAudioOnlyRecording(bookingTs);
      });

      // Option 2: メモのみ → 既存 memo モーダル を開く
      document.getElementById('fp-rec-fallback-memo').addEventListener('click', () => {
        closeOv();
        if (typeof openMemoModal === 'function') {
          openMemoModal(bookingTs);
        } else {
          // 既存 data-open-memo ボタン を 探して click
          const memoBtn = document.querySelector(`[data-open-memo="${bookingTs}"]`);
          if (memoBtn) memoBtn.click();
          else alert('メモ機能を 起動できませんでした。 顧客カード → 議事録 から 手入力できます。');
        }
      });
      return;
    }
    // 録画プレビュー (小さく右下に表示)
    let previewEl = document.getElementById('fp-webcam-preview');
    if (!previewEl) {
      previewEl = document.createElement('video');
      previewEl.id = 'fp-webcam-preview';
      previewEl.muted = true;
      previewEl.autoplay = true;
      previewEl.playsInline = true;
      previewEl.style.cssText = 'position:fixed;bottom:80px;right:20px;width:180px;height:120px;border-radius:10px;border:3px solid #DC2626;z-index:9990;object-fit:cover;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
      document.body.appendChild(previewEl);
    }
    previewEl.srcObject = stream;
    const chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const mr = new MediaRecorder(stream, { mimeType });
    mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (previewEl) { previewEl.remove(); }
      const blob = new Blob(chunks, { type: mimeType });
      R.blob = blob;
      R.bookingTs = bookingTs;
      R.mediaRecorder = null;
      try { await fetch(CLOUD_RUN_BASE + '/api/recording/stop?ts=' + encodeURIComponent(bookingTs), { method: 'POST' }); } catch (_) {}
      // ★ 2026-06-22 roundJ: フル AI パイプライン (Drive + Whisper + Claude + 顧客保存 + 進捗UI)
      const customerName = (function () {
        try { return JSON.parse(localStorage.getItem('fp-quick-inperson-meta') || '[]').find(m => m.ts === bookingTs)?.clientName || 'お客様'; } catch (_) { return 'お客様'; }
      })();
      const customerId = (function () {
        try { return JSON.parse(localStorage.getItem('fp-quick-inperson-meta') || '[]').find(m => m.ts === bookingTs)?.clientId || ''; } catch (_) { return ''; }
      })();
      const fallbackBooking = { ts: bookingTs, name: customerName, userId: customerId, isInperson: true };

      try { showUnifiedProgressPanel(customerName, blob); } catch (_) {}
      try { updateProgressStep('save', 'done'); updateProgressStep('drive', 'active'); updateProgressStep('ai', 'active'); } catch (_) {}
      try { showCenterToast('議事録 を 生成中…', `${customerName} 様 の 対面録画 → AI で 文字起こし + 議事録 作成 中。 30-60秒 ほど お待ちください`, { tone: 'progress', duration: 0 }); } catch (_) {}

      const drivePromise = autoUploadRecording(blob, bookingTs, customerName, fallbackBooking)
        .then(() => { try { updateProgressStep('drive', 'done'); } catch(_){} })
        .catch(() => { try { updateProgressStep('drive', 'error'); } catch(_){} });

      let aiResult = null;
      try { aiResult = await aiProcessRecording(blob, bookingTs, customerName, fallbackBooking); } catch (e) { console.error('aiProcessRecording fail:', e); }
      if (aiResult && aiResult.ok) {
        try { updateProgressStep('ai', 'done'); } catch(_){}
        window._fpAIResult = { result: aiResult, customerName: customerName, booking: fallbackBooking };
        try { autoSaveAIResult(aiResult, customerName, fallbackBooking); } catch(_){}
        try { showProgressDoneAction(); } catch(_){}
      } else {
        try { updateProgressStep('ai', 'error', aiResult?.error); } catch(_){}
        try {
          autoSaveAIResult({
            ok: true, bookingTs, userId: customerId, customerName,
            summary: '⚠ AI処理 失敗\n\nエラー: ' + (aiResult?.error || '不明') + '\n\n録画ファイル自体は Drive に保存されています。',
            transcript: '', key_concerns: ['AI処理エラー'], tasks: [], error: true,
          }, customerName, fallbackBooking);
        } catch(_){}
      }
      await drivePromise;
      try { await onRecordingComplete(bookingTs, blob, URL.createObjectURL(blob)); } catch(_){}
      await fetchLiveData();
      try { renderLeadHubInner(); } catch(_){}
      try { if (typeof renderMeetingHistory === 'function') renderMeetingHistory(); } catch(_){}
    };
    mr.start(3000);
    R.mediaRecorder = mr;
    R.bookingTs = bookingTs;
    R.blob = null;
    // GAS に録画開始を通知
    try { await fetch(CLOUD_RUN_BASE + '/api/recording/start?ts=' + encodeURIComponent(bookingTs), { method: 'POST' }); } catch (_) {}
    // ★ 同じく stopScreenRecording ボタン = 停止
    await fetchLiveData();
    renderLeadHubInner();
  }

  // ★ 2026-06-22 roundH: 急遽 Zoom 即発行 (オーナーfb: 「カメラ/マイク 関係ない、 Zoom リンク即発行 して双方参加」)
  async function startQuickZoom(clientId, clientName) {
    // 進行モーダル (Zoom発行中…)
    const wait = document.createElement('div');
    wait.id = 'fp-quick-zoom-wait';
    wait.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.78);z-index:2147483646;display:flex;align-items:center;justify-content:center;font-family:"Hiragino Sans",sans-serif;';
    wait.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:32px 40px;max-width:420px;width:90%;box-shadow:0 32px 80px rgba(0,0,0,0.5);text-align:center;">
        <div style="width:56px;height:56px;border:4px solid #E2E8F0;border-top-color:#C19A3A;border-radius:50%;margin:0 auto 18px;animation:fp-spin 0.9s linear infinite;"></div>
        <div style="font-size:11px;font-weight:800;color:#9A5A18;letter-spacing:0.14em;margin-bottom:6px;">QUICK ZOOM</div>
        <div style="font-size:17px;font-weight:800;color:#111827;font-family:'Noto Serif JP',serif;margin-bottom:6px;">${escapeHtml(clientName)} 様 / Zoom 発行中…</div>
        <div style="font-size:12.5px;color:#6b7280;line-height:1.7;">Zoom Meeting を 作成 → お客様に LINE で URL 通知 → FP は host で 参加 します</div>
      </div>
      <style>@keyframes fp-spin { to { transform: rotate(360deg); } }</style>`;
    document.body.appendChild(wait);

    let result;
    try {
      const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
      const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
      const app = getApps()[0] || initializeApp({
        apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
        authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
        projectId: 'skeleton-fp-compass-632026',
      });
      const fn = httpsCallable(getFunctions(app, 'asia-northeast1'), 'quickZoomMeeting');
      const payload = clientId.startsWith('quick-')
        ? { customerId: clientId, topic: clientName }   // quick-* + topic=clientName → CF が auto-create
        : { customerId: clientId };
      const res = await fn(payload);
      result = res.data;
      // ★ 2026-06-22 roundM: 新規顧客自動追加バグ修正
      //   CF で Firestore に作っても CRM の DUMMY_CLIENTS に同期されてないとき 顧客台帳に出ない
      //   → refreshFirestoreCustomers で 即同期 + ローカル meta も更新
      if (result.autoCreatedCustomer && result.customerId) {
        try {
          if (window.refreshFirestoreCustomers) await window.refreshFirestoreCustomers();
          // localStorage の急遽meta も resolvedCustomerId に書き換え (議事録 紐付け維持)
          try {
            const meta = JSON.parse(localStorage.getItem('fp-quick-inperson-meta') || '[]');
            const last = meta[meta.length - 1];
            if (last && last.clientId === clientId) {
              last.clientId = result.customerId;
              last.autoLinkedFromQuick = true;
              localStorage.setItem('fp-quick-inperson-meta', JSON.stringify(meta));
            }
          } catch (_) {}
        } catch (e) { console.warn('auto-create sync failed:', e); }
      }
    } catch (e) {
      wait.remove();
      const errMsg = e?.message || String(e);
      const isNoZoom = /Zoom 未連携|failed-precondition/.test(errMsg);
      alert(isNoZoom
        ? `Zoom が 未連携 です。\n\nアカウント設定 → Zoom 連携 で 認証情報 (Account ID / Client ID / Client Secret) を 入れてから 再度 お試しください。\n\n→ /account.html#zoom`
        : `Zoom 発行失敗: ${errMsg.slice(0, 300)}`);
      return;
    }

    wait.remove();

    // 成功 → 結果モーダル — LINE 送信成否で 出し分け
    const ov = document.createElement('div');
    ov.id = 'fp-quick-zoom-result';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.78);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:"Hiragino Sans",sans-serif;padding:24px;overflow-y:auto;';

    // QR コード (新規お客様 = LINE未送信 時に 一発でスマホに伝えられるよう)
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(result.zoomUrl)}`;
    const mailSubject = encodeURIComponent(`【${clientName} 様】Zoom 面談のご案内`);
    const mailBody = encodeURIComponent(`${clientName} 様\n\nご相談 ありがとうございます。 下記 URL から Zoom に お入りください。\n\n${result.zoomUrl}\n\n何かあれば お気軽に ご連絡ください。`);
    const mailtoUrl = `mailto:?subject=${mailSubject}&body=${mailBody}`;
    const smsBody = encodeURIComponent(`${clientName}様 Zoom面談URLです → ${result.zoomUrl}`);
    const smsUrl = `sms:?body=${smsBody}`;

    ov.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:540px;width:100%;padding:28px 32px;box-shadow:0 32px 80px rgba(0,0,0,0.5);">
        <div style="display:inline-flex;align-items:center;gap:8px;background:#FBF5E3;color:#9A5A18;font-size:11px;font-weight:800;padding:5px 12px;border-radius:99px;letter-spacing:0.12em;margin-bottom:14px;">⚡ Zoom 発行完了</div>
        <h2 style="font-family:'Noto Serif JP',serif;font-size:20px;font-weight:700;color:#111827;margin:0 0 6px;">${escapeHtml(clientName)} 様 と Zoom 開始</h2>

        ${result.linePushed
          ? `<p style="font-size:12.5px;color:#6b7280;line-height:1.7;margin:0 0 16px;">下の <strong>「FPとして 参加」</strong> を 押すと 新タブで Zoom が起動。 お客様 にも すでに LINE で URL を 送信済 です。</p>
             <div style="display:inline-flex;align-items:center;gap:6px;background:#D1FAE5;color:#065F46;font-size:11px;font-weight:800;padding:5px 12px;border-radius:99px;letter-spacing:0.08em;margin-bottom:14px;">✓ LINE 送信済</div>`
          : `<p style="font-size:13.5px;color:#1F2A3F;line-height:1.7;margin:0 0 16px;"><strong style="color:#9A5A18;">LINE 未連携のお客様</strong>のため、 下の方法で URL を お伝えください。 まず <strong>「FPとして 参加」</strong> で Zoom 開いて お客様の入室を 待ちましょう。</p>`}

        <!-- FP 用 host URL — メインCTA -->
        <div style="background:#FBF5E3;border:1.5px solid #C19A3A;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <div style="font-size:10.5px;font-weight:800;color:#9A5A18;letter-spacing:0.14em;margin-bottom:8px;">FP HOST URL (あなた用)</div>
          <a href="${escapeHtml(result.hostZoomUrl)}" target="_blank" rel="noopener noreferrer" class="btn-cta-primary" style="text-decoration:none;justify-content:center;width:100%;">
            <span>FPとして Zoom に参加 (host)</span>
            <span class="cta-arrow">→</span>
          </a>
        </div>

        <!-- お客様用 URL 共有エリア -->
        ${result.linePushed ? `
          <details style="margin-top:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:0;">
            <summary style="cursor:pointer;padding:12px 16px;font-size:12.5px;font-weight:700;color:#475569;list-style:none;display:flex;align-items:center;justify-content:space-between;">
              <span>📋 お客様用 URL (コピー / 手動共有)</span>
              <span style="font-size:14px;">▾</span>
            </summary>
            <div style="padding:0 16px 14px;">
              <code style="display:block;font-size:11px;font-family:'JetBrains Mono',monospace;color:#1F2A3F;word-break:break-all;line-height:1.5;background:#fff;padding:8px 10px;border-radius:6px;border:1px solid #E2E8F0;">${escapeHtml(result.zoomUrl)}</code>
              <button id="fp-qz-copy" class="btn-mini-action" style="margin-top:10px;"><span class="icon">📋</span>URLを コピー</button>
            </div>
          </details>
        ` : `
          <!-- LINE 未連携時: 共有手段を プロミネント に出す -->
          <div style="background:#fff;border:2px solid #C19A3A;border-radius:12px;padding:18px 20px;">
            <div style="font-size:10.5px;font-weight:800;color:#9A5A18;letter-spacing:0.14em;margin-bottom:10px;">お客様 へ 共有する</div>
            <code style="display:block;font-size:12px;font-family:'JetBrains Mono',monospace;color:#1F2A3F;word-break:break-all;line-height:1.6;background:#FBF5E3;padding:10px 12px;border-radius:6px;border:1px solid #E8D9A8;margin-bottom:14px;">${escapeHtml(result.zoomUrl)}</code>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
              <button id="fp-qz-copy" class="btn-mini-action" style="justify-content:center;"><span class="icon">📋</span>コピー</button>
              <a id="fp-qz-mail" href="${mailtoUrl}" class="btn-mini-action" style="justify-content:center;text-decoration:none;"><span class="icon">✉</span>メール 起動</a>
              <a id="fp-qz-sms" href="${smsUrl}" class="btn-mini-action" style="justify-content:center;text-decoration:none;"><span class="icon">📱</span>SMS 起動</a>
              <button id="fp-qz-toggle-qr" class="btn-mini-action" style="justify-content:center;"><span class="icon">▦</span>QR 表示</button>
            </div>
            <div id="fp-qz-qr-wrap" style="display:none;text-align:center;background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:14px;">
              <img src="${qrSrc}" alt="Zoom URL QR" style="width:180px;height:180px;border-radius:6px;">
              <div style="font-size:11px;color:#6B7280;margin-top:6px;">お客様 のスマホ で 読み取ると Zoom が 開きます</div>
            </div>
          </div>
        `}

        ${result.linePushError ? `<div style="margin-top:12px;background:#FEE2E2;border:1px solid #FCA5A5;border-radius:6px;padding:10px 14px;font-size:11.5px;color:#991B1B;line-height:1.6;"><strong>LINE 送信失敗:</strong> ${escapeHtml(result.linePushError.slice(0, 200))}</div>` : ''}

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;">
          <button class="btn-cta-ghost" id="fp-qz-close">閉じる</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const qrToggle = document.getElementById('fp-qz-toggle-qr');
    if (qrToggle) qrToggle.addEventListener('click', () => {
      const w = document.getElementById('fp-qz-qr-wrap');
      if (w) w.style.display = w.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('fp-qz-close').addEventListener('click', () => ov.remove());
    document.getElementById('fp-qz-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(result.zoomUrl).then(() => {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#065F46;color:#fff;padding:10px 22px;border-radius:99px;font-weight:800;font-size:12px;z-index:2147483647;';
        t.textContent = '✓ コピー完了';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 1800);
      });
    });

    // Firestore 反映 (面談履歴に出るよう liveData refresh)
    try { await fetchLiveData(); renderLeadHubInner(); } catch (_) {}
  }

  // ★ 2026-06-22 roundG: 録音せずメモだけ書く (急遽録画モーダルの 3rd option)
  function openMemoOnlyForQuick(inpersonTs, clientId, clientName) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.78);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:"Hiragino Sans",sans-serif;padding:24px;';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:560px;width:100%;padding:28px 32px;box-shadow:0 28px 80px rgba(0,0,0,0.4);">
        <div style="display:inline-flex;align-items:center;gap:8px;background:#FBF5E3;color:#9A5A18;font-size:11px;font-weight:800;padding:5px 12px;border-radius:99px;letter-spacing:0.12em;margin-bottom:14px;">📝 メモ ONLY</div>
        <h2 style="font-family:'Noto Serif JP',serif;font-size:19px;font-weight:700;color:#111827;margin:0 0 6px;">${escapeHtml(clientName)} 様 / 面談メモ</h2>
        <p style="font-size:12.5px;color:#6b7280;line-height:1.7;margin:0 0 14px;">面談中・面談後に メモを 書いてください。 保存すると 顧客カードに 残ります。</p>
        <textarea id="fp-memo-only-text" rows="12" placeholder="例:\n相談テーマ: 老後資金 / NISA\n論点: 月3万 積立 / 配偶者 控除\n次のアクション: 来月 候補日3つ 送る" style="width:100%;padding:14px 16px;font-size:13.5px;font-family:'Hiragino Sans',sans-serif;line-height:1.75;border:1.5px solid #E5E7EB;border-radius:8px;resize:vertical;box-sizing:border-box;"></textarea>
        <div style="display:flex;gap:10px;margin-top:18px;">
          <button class="btn-cta-primary" id="fp-memo-only-save" style="flex:2;justify-content:center;"><span>メモを 保存</span><span class="cta-arrow">✓</span></button>
          <button class="btn-cta-ghost" id="fp-memo-only-cancel">キャンセル</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    document.getElementById('fp-memo-only-cancel').addEventListener('click', () => ov.remove());
    document.getElementById('fp-memo-only-save').addEventListener('click', () => {
      const text = document.getElementById('fp-memo-only-text').value.trim();
      if (!text) { alert('メモが空です。 内容を 書いてから 保存してください。'); return; }
      // localStorage に メモとして保存 (既存のキー命名規則に揃える)
      const tasksKey = 'fp-tasks-' + inpersonTs;
      try {
        const existing = JSON.parse(localStorage.getItem(tasksKey) || '[]');
        existing.push({ ts: new Date().toISOString(), text: text, kind: 'memo-only', clientId, clientName });
        localStorage.setItem(tasksKey, JSON.stringify(existing));
      } catch (_) {}
      // 面談履歴 にも 反映されるよう meta 更新
      try {
        const meta = JSON.parse(localStorage.getItem('fp-quick-inperson-meta') || '[]');
        const idx = meta.findIndex(m => m.ts === inpersonTs);
        if (idx >= 0) { meta[idx].memo = text.slice(0, 200); localStorage.setItem('fp-quick-inperson-meta', JSON.stringify(meta)); }
      } catch (_) {}
      ov.remove();
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#065F46;color:#fff;padding:14px 28px;border-radius:99px;font-weight:800;font-size:13px;z-index:2147483647;box-shadow:0 12px 30px rgba(0,0,0,0.3);';
      toast.textContent = '✓ メモを 保存しました';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2800);
      if (typeof renderMeetingHistory === 'function') renderMeetingHistory();
    });
  }

  // ★ 2026-06-22 roundG: マイクのみ録音 fallback (カメラ NotFound / 不要 時)
  //   音声 → 同じパイプライン (upload → AI議事録)
  async function startAudioOnlyRecording(bookingTs) {
    const R = window._fpRecorder;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });
    } catch (e) {
      alert('マイク も アクセス不可 です。\n\nMac の場合: システム設定 → プライバシーとセキュリティ → マイク で ブラウザ を ON にしてください。\n\n技術: ' + (e?.name || e?.message || e));
      return;
    }

    // 録音中インジケータ (右下、 audio-only 用)
    let indicator = document.getElementById('fp-audio-rec-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'fp-audio-rec-indicator';
      indicator.style.cssText = 'position:fixed;bottom:80px;right:20px;background:#fff;border:3px solid #DC2626;border-radius:99px;padding:14px 22px;z-index:9990;box-shadow:0 8px 24px rgba(0,0,0,0.25);font-family:"Hiragino Sans",sans-serif;display:flex;align-items:center;gap:12px;cursor:pointer;';
      indicator.innerHTML = `
        <span style="width:12px;height:12px;background:#DC2626;border-radius:50%;animation:fp-audio-pulse 1.2s ease-in-out infinite;"></span>
        <span style="font-weight:800;color:#1F2A3F;font-size:13px;">🎤 マイク 録音中…</span>
        <span id="fp-audio-rec-timer" style="font-family:'Inter',monospace;font-weight:700;color:#9A5A18;font-size:12px;">00:00</span>
        <span style="font-size:10.5px;color:#6B7280;border-left:1px solid #E5E7EB;padding-left:10px;margin-left:2px;">クリックで 停止</span>
        <style>@keyframes fp-audio-pulse { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:.5;transform:scale(1.15);} }</style>`;
      document.body.appendChild(indicator);
    }

    const startedAt = Date.now();
    const timerEl = document.getElementById('fp-audio-rec-timer');
    const timerInterval = setInterval(() => {
      if (!timerEl) return;
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      timerEl.textContent = `${mm}:${ss}`;
    }, 1000);

    const chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    // ★ オーナーfb 2026-06-23: 長録画 (30/60分) を Cloud Run 32MB 制限に収めるため
    // bitrate を 24kbps に 下げる (音声明瞭度は維持されつつ 60分=10MB に収まる)
    const mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 });
    mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(timerInterval);
      if (indicator) indicator.remove();
      const blob = new Blob(chunks, { type: mimeType });
      R.blob = blob;
      R.bookingTs = bookingTs;
      R.mediaRecorder = null;
      try { await fetch(CLOUD_RUN_BASE + '/api/recording/stop?ts=' + encodeURIComponent(bookingTs), { method: 'POST' }); } catch (_) {}
      // ★ 2026-06-22 roundJ: 録画停止後のフル AI パイプラインを startScreenRecording と同じく実装
      //   旧: 単純 upload のみ で AI議事録 生成されず → 面談履歴に出ない
      //   新: Drive 保存 + Whisper 文字起こし + Claude 解析 + 顧客カード自動保存 + 進捗パネル
      const customerName = (function () {
        try {
          const meta = JSON.parse(localStorage.getItem('fp-quick-inperson-meta') || '[]');
          const found = meta.find(m => m.ts === bookingTs);
          return found?.clientName || 'お客様';
        } catch (_) { return 'お客様'; }
      })();
      const customerId = (function () {
        try {
          const meta = JSON.parse(localStorage.getItem('fp-quick-inperson-meta') || '[]');
          return meta.find(m => m.ts === bookingTs)?.clientId || '';
        } catch (_) { return ''; }
      })();
      const fallbackBooking = { ts: bookingTs, name: customerName, userId: customerId, isInperson: true };

      // 進捗パネル
      try { showUnifiedProgressPanel(customerName, blob); } catch (_) {}
      try { updateProgressStep('save', 'done'); updateProgressStep('drive', 'active'); updateProgressStep('ai', 'active'); } catch (_) {}
      try { showCenterToast('議事録 を 生成中…', `${customerName} 様 の 対面録音 → AI で 文字起こし + 議事録 作成 中。 30-60秒 ほど お待ちください`, { tone: 'progress', duration: 0 }); } catch (_) {}

      // Drive: 音声ファイル upload (並列)
      const drivePromise = autoUploadRecording(blob, bookingTs, customerName, fallbackBooking)
        .then(() => { try { updateProgressStep('drive', 'done'); } catch(_){} })
        .catch(() => { try { updateProgressStep('drive', 'error'); } catch(_){} });

      // AI: 同じ音声を Whisper + Claude で処理
      let aiResult = null;
      try { aiResult = await aiProcessRecording(blob, bookingTs, customerName, fallbackBooking); } catch (e) { console.error('aiProcessRecording fail:', e); }
      if (aiResult && aiResult.ok) {
        try { updateProgressStep('ai', 'done'); } catch(_){}
        window._fpAIResult = { result: aiResult, customerName: customerName, booking: fallbackBooking };
        try { autoSaveAIResult(aiResult, customerName, fallbackBooking); } catch(_){}
        try { showProgressDoneAction(); } catch(_){}
      } else {
        try { updateProgressStep('ai', 'error', aiResult?.error); } catch(_){}
        // AI 失敗ログも 保存して 面談履歴に「失敗」として 残す
        try {
          autoSaveAIResult({
            ok: true, bookingTs, userId: customerId, customerName,
            summary: '⚠ AI処理 失敗\n\nエラー: ' + (aiResult?.error || '不明') + '\n\n録画ファイル自体は Drive に保存されています。',
            transcript: '', key_concerns: ['AI処理エラー'], tasks: [], error: true,
          }, customerName, fallbackBooking);
        } catch(_){}
      }
      await drivePromise;
      try { await onRecordingComplete(bookingTs, blob, URL.createObjectURL(blob)); } catch(_){}
      await fetchLiveData();
      try { renderLeadHubInner(); } catch(_){}
      try { if (typeof renderMeetingHistory === 'function') renderMeetingHistory(); } catch(_){}
    };
    indicator.addEventListener('click', () => {
      if (mr.state !== 'inactive') {
        if (confirm('録音を 停止しますか?\n\n停止後、 音声から 自動で AI議事録 が生成されます。')) mr.stop();
      }
    });
    mr.start(3000);
    R.mediaRecorder = mr;
    R.bookingTs = bookingTs;
    R.blob = null;
    R.mode = 'audio-only';
    try { await fetch(CLOUD_RUN_BASE + '/api/recording/start?ts=' + encodeURIComponent(bookingTs), { method: 'POST' }); } catch (_) {}
    await fetchLiveData();
    renderLeadHubInner();
  }

  // 画面録画 → 停止時に Drive の顧客フォルダへ自動アップロード
  async function startScreenRecording(bookingTs, zoomUrl, preOpened) {
    // preOpened = { preZoomWin } - click 直後に開いた空 Zoom popup を引き継ぐ
    const preZoomWin = preOpened?.preZoomWin || null;
    const R = window._fpRecorder;
    // ★ 順序: 共有許可 → 成功時に Zoom + メモ 同時オープン → 録画開始
    // (Zoom を先に開くと画面共有ダイアログが裏に隠れて操作不能になるため)
    // キャンセル時は catch で Zoom だけ開いて「録画なしで Zoom 入る」フォールバック
    showPickerHint();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor', frameRate: 15 },
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
        systemAudio: 'include',
        preferCurrentTab: false,
      });
      hidePickerHint();
      // ★ Chrome の「共有を停止」 バー (画面最下部に常時表示) で停止された時の検知
      // → MediaRecorder.onstop が onended で自動発火する
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (window._fpRecorder.mediaRecorder && window._fpRecorder.mediaRecorder.state !== 'inactive') {
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #06c755;border-radius:10px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:10004;font-family:inherit;';
            t.innerHTML = '<strong style="font-size:14px;display:block;">⏹ 画面共有が停止されました</strong><div style="font-size:12px;color:#6b7280;">録画停止 → AI 処理を開始します</div>';
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 6000);
            stopScreenRecording();
          }
        });
      });
      // 音声チェック
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        const ok = confirm('⚠ 「音声を共有」 が OFF のようです。\n\n録画はされますが、音声が無いと AI 議事録が生成できません。\n\n[OK] このまま録画する (音声無しで進める)\n[キャンセル] 一度キャンセル → やり直す');
        if (!ok) { stream.getTracks().forEach(t => t.stop()); return; }
      }

      // ★ オーナーfb (v AF): メモ画面廃止 → Zoom 全画面 1 つだけ。pre-open Zoom popup に URL を流し込む。
      const sw = window.screen.availWidth || screen.width;
      const sh = window.screen.availHeight || screen.height;
      const zoomBrowserUrl = (function() {
        try {
          const m = (zoomUrl || '').match(/zoom\.us\/j\/(\d+)(\?.*)?/);
          if (!m) return zoomUrl;
          const host = (zoomUrl.match(/^https?:\/\/([^\/]+)/) || ['', 'zoom.us'])[1];
          return `https://${host}/wc/join/${m[1]}${m[2] || ''}`;
        } catch (_) { return zoomUrl; }
      })();
      let zoomWin = preZoomWin;
      if (zoomWin && !zoomWin.closed) {
        try {
          // ★ 画面共有許可されたので Zoom popup を全画面に resize+move して URL 流し込み
          zoomWin.moveTo(0, 0);
          zoomWin.resizeTo(sw, sh);
          zoomWin.location.href = zoomBrowserUrl;
          zoomWin.focus();
        } catch (_) { zoomWin = window.open(zoomBrowserUrl, 'fp-zoom-win'); }
      } else {
        // fallback (preZoom 無効): 直接 open
        const zoomFeatures = `width=${sw},height=${sh},left=0,top=0,toolbar=no,location=no,menubar=no,status=no,scrollbars=yes,resizable=yes`;
        zoomWin = window.open(zoomBrowserUrl, 'fp-zoom-win', zoomFeatures);
        if (!zoomWin) window.open(zoomBrowserUrl, '_blank');
      }
      // Zoom が閉じられたら自動で録画停止 (切り忘れ防止)
      // ただし最低30秒経過してから (誤検知防止)
      window._fpZoomWin = zoomWin;
      // ※ Zoom popup が閉じても自動停止しない (誤検知防止のため監視機能を撤廃)
      // 停止は「Chrome 共有を停止」 or 「メモの完了ボタン」 でのみ実行
      // ★ legacy proxy bookings + Firestore 多テナント confirmed customer の 両方 から lookup
      //   (multi-tenant 顧客で booking が legacy にない時 議事録 が customerName='お客様' で保存され 顧客カードと紐付かないバグ 修正)
      const bookingTsKey = String(bookingTs).slice(0,19);
      const fsConfirmedAsBookings = (window._fpFirestoreConfirmed || []).map(c => ({
        _fsCustomerId: c.docId,
        userId: 'fs:' + c.docId,
        name: c.name,
        date: String(c.confirmedSlot || '').split(' ')[0] || '',
        time: String(c.confirmedSlot || '').split(' ')[1] || '',
        zoomUrl: c.zoomUrl,
        ts: c.confirmedAt?.toDate?.()?.toISOString?.() || '',
        lineFriendId: c.lineFriendId || c.userId || null,
      }));
      const allBookingsForLookup = ((liveData && liveData.bookings) || []).concat(fsConfirmedAsBookings);
      const booking = allBookingsForLookup.find(b => String(b.ts).slice(0,19) === bookingTsKey);
      // ★ オーナーfb: popup ウィンドウだと Zoom と z-order 競合で潜る。物理タブ (同じ Chrome ウィンドウ内の新タブ) に変更。
      // tab だと Chrome のタブストリップから手動で切り替え or ドラッグでウィンドウ分離可能。CRM 親と同じウィンドウなので focus 問題ゼロ。
      const memoKey = 'fp-memo-' + (bookingTs || '');
      const tasksKey = 'fp-tasks-' + ((booking && booking.userId) || bookingTs);
      const memoQuery = `?v=${Date.now()}&memoKey=${encodeURIComponent(memoKey)}&tasksKey=${encodeURIComponent(tasksKey)}&name=${encodeURIComponent((booking && booking.name) || 'お客様')}&baseDate=${encodeURIComponent((booking && booking.date) || '')}&bookingTs=${encodeURIComponent(bookingTs || '')}`;
      // ★ オーナーfb (v AF): メモ画面 廃止。 完了操作は CRM タブの REC ピル + 下バー、 もしくは Chrome の「停止」 バーで。
      // (旧 memo popup / PiP のコードは全削除)
      window._fpMemoWin = null;
      console.log('[layout] Zoom 全画面 (' + sw + 'x' + sh + ') / メモ画面なし');

      // マイク音声を合成
      let combined = stream;
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ac = new AudioContext();
        const dest = ac.createMediaStreamDestination();
        if (stream.getAudioTracks().length > 0) ac.createMediaStreamSource(new MediaStream([stream.getAudioTracks()[0]])).connect(dest);
        ac.createMediaStreamSource(mic).connect(dest);
        combined = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        R._micStream = mic;
      } catch (_) {}

      // ★ bookingTs が URLエンコード状態 (%3A 等) で来る path がある → 必ず decode して保存
      //   旧バグ: data-rec-start に encodeURIComponent済 ts を 入れる箇所 (fillBookingsList の tsEnc) → R.bookingTs encoded で GAS sheet 保存 → 顧客モーダル b.ts (decoded) と find 一致せず 議事録 反映なし
      let _safeBookingTs = bookingTs;
      try { if (_safeBookingTs && _safeBookingTs.indexOf('%') >= 0) _safeBookingTs = decodeURIComponent(_safeBookingTs); } catch (_) {}
      R.chunks = []; R.startTime = Date.now(); R.bookingTs = _safeBookingTs;
      // booking が見つからない時の fallback: liveData users から 唯一の LINE 連携客
      let fallbackBooking = booking;
      if (!fallbackBooking) {
        const us = (window.LineAppLiveData && window.LineAppLiveData.users) || [];
        if (us.length === 1) {
          fallbackBooking = { userId: us[0].userId, name: us[0].displayName, ts: bookingTs };
          console.log('[recording] booking 不在 → liveUsers[0] で fallback:', fallbackBooking);
        }
      }
      R.booking = fallbackBooking;  // onstop で参照
      R.customerName = (fallbackBooking && fallbackBooking.name) || 'お客様';
      // 音声のみで録音 (動画は不要、Drive用もAI用も同じ音声ファイル)
      // 1時間 ≒ 8MB に収まる
      const audioOnlyStream = new MediaStream(combined.getAudioTracks());
      const audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      R.mediaRecorder = new MediaRecorder(audioOnlyStream, { mimeType: audioMime, audioBitsPerSecond: 24000 });
      R.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) R.chunks.push(e.data); };
      R.mediaRecorder.onstop = async () => {
        const blob = new Blob(R.chunks, { type: 'audio/webm' });
        R.blobUrl = URL.createObjectURL(blob);
        combined.getTracks().forEach(t => t.stop());
        stream.getTracks().forEach(t => t.stop());
        if (R._micStream) R._micStream.getTracks().forEach(t => t.stop());
        // 統一進行パネル開始
        showUnifiedProgressPanel(R.customerName, blob);
        updateProgressStep('save', 'done');
        updateProgressStep('drive', 'active');
        updateProgressStep('ai', 'active');
        // ★ 中央 ポップアップ「議事録 生成中」 (完了 ポップアップ で 自動 上書き される)
        showCenterToast('議事録 を 生成中…', `${R.customerName} 様 の Zoom 録画 → AI で 文字起こし + 議事録 作成 中。 30-60秒 ほど お待ちください`, { tone: 'progress', duration: 0 });
        // booking が見つからなかった時の fallback (R.booking で保持済)
        const effectiveBooking = booking || R.booking || null;
        // Drive: 音声ファイル (.webm) を upload
        const drivePromise = autoUploadRecording(blob, R.bookingTs, R.customerName, effectiveBooking)
          .then(() => updateProgressStep('drive', 'done'))
          .catch(() => updateProgressStep('drive', 'error'));
        // AI: 同じ音声ファイルを送信
        const aiResult = await aiProcessRecording(blob, R.bookingTs, R.customerName, effectiveBooking);
        if (aiResult && aiResult.ok) {
          updateProgressStep('ai', 'done');
          window._fpAIResult = { result: aiResult, customerName: R.customerName, booking: effectiveBooking };
          // ★ AI 結果を自動で顧客カードに保存 (手動ボタン押下不要)
          autoSaveAIResult(aiResult, R.customerName, effectiveBooking);
          showProgressDoneAction();
        } else {
          updateProgressStep('ai', 'error', aiResult && aiResult.error);
          // AI失敗時も「失敗ログ」を localStorage に保存しておく (デバッグ追跡可能に)
          try {
            const errEntry = {
              bookingTs: R.bookingTs,
              userId: (effectiveBooking && effectiveBooking.userId) || '',
              customerName: R.customerName,
              date: effectiveBooking && effectiveBooking.date,
              summary: '⚠ AI処理が失敗しました\n\nエラー: ' + (aiResult && aiResult.error ? aiResult.error : '不明 (詳細はネットワークタブ確認)') + '\n\n録画ファイル自体は Drive に保存されています。',
              transcript: '',
              key_concerns: ['AI処理エラー'],
              next_meeting_suggestion: '',
              createdAt: new Date().toISOString(),
              error: true,
            };
            autoSaveAIResult({ ok: true, ...errEntry, tasks: [] }, R.customerName, effectiveBooking);
            console.warn('[AI失敗ログを保存]', errEntry);
          } catch (e) { console.error('failure-log save fail', e); }
        }
        await drivePromise;
        await onRecordingComplete(R.bookingTs, blob, R.blobUrl);
      };
      R.mediaRecorder.start(1000);

      showRecordingBorder();
      fetch(CLOUD_RUN_BASE + '/api/recording/start?ts=' + encodeURIComponent(bookingTs), { method: 'POST' }).catch(() => {});
      showRecordingPill();
      // ★ オーナーfb (v AF): メモ画面廃止につき、 CRM 下バー復活 — 完了操作の入口を確保
      showFixedCompleteButton();
    } catch (e) {
      hidePickerHint();
      // ★ 事前 open 済の Zoom popup を閉じる
      try { if (preZoomWin && !preZoomWin.closed) preZoomWin.close(); } catch (_) {}
      // 共有許可キャンセル時: 録画は無理だが Zoom だけ開いて「録画なしで入室」フォールバック
      if (e && e.name === 'NotAllowedError') {
        const sw = window.screen.availWidth || screen.width;
        const sh = window.screen.availHeight || screen.height;
        const zoomBrowserUrl = (function() {
          try {
            const m = (zoomUrl || '').match(/zoom\.us\/j\/(\d+)(\?.*)?/);
            if (!m) return zoomUrl;
            const host = (zoomUrl.match(/^https?:\/\/([^\/]+)/) || ['', 'zoom.us'])[1];
            return `https://${host}/wc/join/${m[1]}${m[2] || ''}`;
          } catch (_) { return zoomUrl; }
        })();
        const zf = `width=${sw},height=${sh},left=0,top=0,toolbar=no,location=no,menubar=no,status=no,scrollbars=yes,resizable=yes`;
        const zw = window.open(zoomBrowserUrl, 'fp-zoom-win', zf);
        if (!zw) window.open(zoomBrowserUrl, '_blank');
        window._fpZoomWin = zw;
        alert('画面共有がキャンセルされました。\n\nZoom は開きました (録画なし)。\n\n録画したい場合はもう一度「録画ON」ボタンを押し、\nChrome のダイアログで「画面全体」を選択 → 「音声を共有」 にチェック → 「共有」 を押してください。');
      } else {
        alert('画面録画の開始に失敗しました\n\n詳細: ' + (e && e.message));
      }
      localStorage.removeItem('fp-memo-fullscreen');
    }
  }

  // ===== 統一進行パネル (録画停止後の Drive + AI 進捗を1枚で集約) =====
  function showUnifiedProgressPanel(customerName, blob) {
    const existing = document.getElementById('fp-unified-progress');
    if (existing) existing.remove();
    const panel = document.createElement('div');
    panel.id = 'fp-unified-progress';
    panel.style.cssText = 'position:fixed;top:18px;right:18px;background:#fff;border:1px solid #e8e2d4;border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,0.18);z-index:10010;font-family:inherit;width:380px;overflow:hidden;';
    panel.innerHTML = `
      <div style="background:linear-gradient(135deg,#fdfbf4,#fafaf6);padding:14px 18px;border-bottom:1px solid #e8e2d4;">
        <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:3px;">Recording Stopped — Processing</div>
        <strong style="font-size:14px;color:#1f2a3f;">${escapeHtml(customerName)}様 面談 (${(blob.size/1024/1024).toFixed(1)}MB)</strong>
      </div>
      <div style="padding:14px 18px;">
        <div id="fp-progress-steps" style="display:grid;gap:10px;">
          ${renderStep('save', '録画ファイル保存', '完了 / ローカルメモリに保持')}
          ${renderStep('drive', 'Google Drive へアップロード', '顧客フォルダに自動振り分け')}
          ${renderStep('ai', 'AI で議事録 + タスク生成', 'Whisper 文字起こし → Claude 解析')}
        </div>
        <div id="fp-progress-bottom" style="margin-top:14px;padding:11px 14px;background:#fdfbf4;border:1px dashed #c19a3a;border-radius:8px;font-size:11.5px;color:#5e4d1a;line-height:1.6;text-align:center;">
          ⏳ そのまま <strong>1〜2分</strong> お待ちください<br>
          <span style="font-size:10.5px;opacity:0.85;">他の操作は普通にできます</span>
        </div>
      </div>`;
    document.body.appendChild(panel);
  }

  function renderStep(id, title, desc) {
    return `
      <div id="fp-step-${id}" data-status="pending" style="display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:center;padding:9px 12px;background:#f8fafc;border:1px solid #e8e2d4;border-radius:7px;opacity:0.5;transition:all 0.3s;">
        <div class="fp-step-ic" style="font-size:14px;text-align:center;color:#94a3b8;">○</div>
        <div>
          <strong style="font-size:12.5px;display:block;color:#1f2a3f;">${title}</strong>
          <span class="fp-step-desc" style="font-size:10.5px;color:#6b7280;">${desc}</span>
        </div>
      </div>`;
  }

  function updateProgressStep(id, status, errorMsg) {
    const el = document.getElementById('fp-step-' + id);
    if (!el) return;
    el.dataset.status = status;
    const ic = el.querySelector('.fp-step-ic');
    const desc = el.querySelector('.fp-step-desc');
    if (status === 'active') {
      el.style.opacity = '1'; el.style.background = '#fff'; el.style.borderColor = '#c19a3a';
      ic.textContent = '⏳'; ic.style.color = '#c19a3a';
      if (desc) desc.textContent = '処理中...';
    } else if (status === 'done') {
      el.style.opacity = '1'; el.style.background = '#f0fdf4'; el.style.borderColor = '#86efac';
      ic.textContent = '✓'; ic.style.color = '#16a34a'; ic.style.fontWeight = '700';
      if (desc) desc.textContent = '完了';
    } else if (status === 'error') {
      el.style.opacity = '1'; el.style.background = '#fef2f2'; el.style.borderColor = '#fca5a5';
      ic.textContent = '✗'; ic.style.color = '#b91c3c'; ic.style.fontWeight = '700';
      if (desc) desc.textContent = '失敗: ' + (errorMsg || '不明');
    }
  }

  // ★ 画面中央 大型 ポップアップ (議事録生成中 / 反映完了 を 視認性最大で 通知)
  //   tone='progress' (生成中) はスピナー + 自動消えない、 tone='success' (反映済) は ✕閉じ付
  function showCenterToast(title, sub, opts) {
    opts = opts || {};
    const tone = opts.tone || 'success';
    const dur = opts.duration != null ? opts.duration : (tone === 'progress' ? 0 : 0); // 自動消失なし default
    const old = document.getElementById('fp-center-toast');
    if (old) old.remove();
    if (!document.getElementById('fp-center-toast-spin-style')) {
      const st = document.createElement('style');
      st.id = 'fp-center-toast-spin-style';
      st.textContent = '@keyframes fp-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes fp-pulse-ring{0%{box-shadow:0 0 0 0 rgba(59,130,246,0.5)}100%{box-shadow:0 0 0 28px rgba(59,130,246,0)}}';
      document.head.appendChild(st);
    }
    const bg = tone === 'progress'
      ? 'linear-gradient(135deg,#EFF6FF,#DBEAFE)'
      : 'linear-gradient(135deg,#ECFDF5,#D1FAE5)';
    const accent = tone === 'progress' ? '#3B82F6' : '#059669';
    const t = document.createElement('div');
    t.id = 'fp-center-toast';
    // ★ 邪魔にならない 右上 配置 + コンパクト + ドラッグ可能 (オーナーfb 2026-06-20)
    //   復元: 前回ドラッグ位置を localStorage 保存 → 同位置に出る
    let posLeft = null, posTop = 18;
    try {
      const saved = JSON.parse(localStorage.getItem('fp-toast-pos') || 'null');
      if (saved && typeof saved.left === 'number') { posLeft = saved.left; posTop = saved.top; }
    } catch (_) {}
    const positionCss = posLeft != null ? `left:${posLeft}px;top:${posTop}px;right:auto;` : `top:18px;right:18px;`;
    t.style.cssText = `position:fixed;${positionCss}background:${bg};border:2px solid ${accent};border-radius:14px;padding:16px 20px 18px;box-shadow:0 12px 36px rgba(0,0,0,0.22);z-index:10090;font-family:'Noto Sans JP',sans-serif;text-align:left;width:320px;max-width:90vw;user-select:none;`;
    const iconHtml = tone === 'progress'
      ? `<div style="width:32px;height:32px;border:3px solid ${accent}33;border-top-color:${accent};border-radius:50%;animation:fp-spin 0.9s linear infinite;flex-shrink:0;"></div>`
      : `<div style="font-size:30px;line-height:1;flex-shrink:0;">✅</div>`;
    const closeHtml = tone === 'progress'
      ? ''
      : `<button id="fp-toast-close" style="margin-top:10px;background:transparent;border:1px solid ${accent}66;color:${accent};padding:6px 14px;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">確認 ✓</button>`;
    t.innerHTML = `
      <!-- ドラッグハンドル -->
      <div id="fp-toast-drag" style="position:absolute;top:0;left:0;right:0;height:8px;cursor:grab;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.04);border-radius:12px 12px 0 0;">
        <div style="width:34px;height:3px;background:${accent}55;border-radius:2px;"></div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;margin-top:6px;cursor:grab;" id="fp-toast-drag-area">
        ${iconHtml}
        <div style="flex:1;min-width:0;">
          <div style="font-size:13.5px;font-weight:800;color:${accent};letter-spacing:-0.005em;line-height:1.45;margin-bottom:4px;">${escapeHtml(title)}</div>
          <div style="font-size:11.5px;color:#475569;line-height:1.55;cursor:text;user-select:text;">${escapeHtml(sub || '')}</div>
          ${closeHtml}
        </div>
        <button id="fp-toast-mini-close" title="閉じる" style="background:transparent;border:none;color:${accent};font-size:14px;cursor:pointer;padding:2px 6px;line-height:1;align-self:flex-start;font-weight:700;">✕</button>
      </div>`;
    document.body.appendChild(t);
    const closeBtn = t.querySelector('#fp-toast-close');
    if (closeBtn) closeBtn.addEventListener('click', () => t.remove());
    const miniClose = t.querySelector('#fp-toast-mini-close');
    if (miniClose) miniClose.addEventListener('click', () => t.remove());
    // ★ ドラッグ 実装
    (function setupDrag(){
      const handles = [t.querySelector('#fp-toast-drag'), t.querySelector('#fp-toast-drag-area')];
      let drag = null;
      const onDown = (e) => {
        if (e.target.closest('button')) return;  // ボタンクリックはドラッグ扱いしない
        e.preventDefault();
        const r = t.getBoundingClientRect();
        drag = { startX: e.clientX, startY: e.clientY, baseLeft: r.left, baseTop: r.top };
        t.style.cursor = 'grabbing';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      };
      const onMove = (e) => {
        if (!drag) return;
        const nx = Math.max(0, Math.min(window.innerWidth - 60, drag.baseLeft + (e.clientX - drag.startX)));
        const ny = Math.max(0, Math.min(window.innerHeight - 60, drag.baseTop + (e.clientY - drag.startY)));
        t.style.left = nx + 'px'; t.style.top = ny + 'px'; t.style.right = 'auto';
      };
      const onUp = () => {
        if (drag) {
          const r = t.getBoundingClientRect();
          try { localStorage.setItem('fp-toast-pos', JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch(_) {}
        }
        drag = null; t.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      handles.forEach(h => h && h.addEventListener('mousedown', onDown));
    })();
    if (dur > 0) {
      setTimeout(() => { if (t.parentNode) t.remove(); }, dur);
    }
    return t;
  }
  function showProgressDoneAction() {
    const bottom = document.getElementById('fp-progress-bottom');
    if (!bottom) return;
    const r = (window._fpAIResult && window._fpAIResult.result) || {};
    const taskCount = (r.tasks || []).length;
    bottom.style.background = 'linear-gradient(135deg,#dcfce7,#f0fdf4)';
    bottom.style.borderColor = '#86efac';
    bottom.style.borderStyle = 'solid';
    const customerName = (window._fpAIResult && window._fpAIResult.customerName) || 'お客様';
    bottom.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;text-align:left;">
        <div style="font-size:26px;">✨</div>
        <div style="flex:1;">
          <strong style="font-size:13px;color:#166534;display:block;">議事録を ${escapeHtml(customerName)} 様 の 顧客カード に 反映 しました</strong>
          <span style="font-size:11px;color:#365314;">タスク${taskCount}件 + LINE下書き 生成済み</span>
        </div>
      </div>
      <div style="display:grid;gap:6px;margin-top:10px;">
        <button id="fp-show-result" style="font-size:13px;padding:11px;background:linear-gradient(135deg,#06c755,#04a045);color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:800;font-family:inherit;letter-spacing:0.04em;">📋 AI議事録を見る</button>
        <button id="fp-progress-close" style="font-size:12px;padding:9px;background:#1b2845;color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:800;font-family:inherit;letter-spacing:0.08em;text-transform:uppercase;">閉じる</button>
      </div>`;
    // ★ 反映完了 toast は autoSaveAIResult の GAS保存完了 .then で 出す (showProgressDoneAction は ここでは 出さない、 二重表示防止)
    document.getElementById('fp-show-result').addEventListener('click', () => {
      // ★ オーナーfb 2026-06-24: 「AI議事録を見る」 → 顧客モーダルの 議事録タブ に 飛ぶ (旧: 別モーダル)
      const r = window._fpAIResult;
      const p = document.getElementById('fp-unified-progress'); if (p) p.remove();
      if (!r) return;
      // 該当客を特定: booking.userId or customerName 一致
      const clients = (window.DUMMY_CLIENTS || window.FpApp?.getClients?.() || []);
      const targetUid = (r.booking && r.booking.userId) || '';
      let match = clients.find(c => targetUid && (c.lineFriendId === targetUid || c.id === targetUid));
      if (!match && r.customerName) {
        match = clients.find(c => c.name === r.customerName);
      }
      if (match && typeof window.openClientModal === 'function') {
        window.openClientModal(match.id);
        // モーダル開いた後 議事録タブ に切替
        setTimeout(() => {
          const t = [...document.querySelectorAll('.cd-tab')].find(t => /議事録/.test(t.textContent));
          if (t) t.click();
        }, 600);
      } else if (typeof window.FpApp?.openClientModal === 'function' && match) {
        window.FpApp.openClientModal(match.id);
        setTimeout(() => {
          const t = [...document.querySelectorAll('.cd-tab')].find(t => /議事録/.test(t.textContent));
          if (t) t.click();
        }, 600);
      } else {
        // 旧フォールバック: 該当客が 特定できない場合は 旧 AI結果モーダル
        showAIResultModal(r.result, r.customerName, r.booking);
      }
    });
    document.getElementById('fp-progress-close').addEventListener('click', () => {
      const p = document.getElementById('fp-unified-progress'); if (p) p.remove();
      // Zoom popup + メモ popup も一緒に閉じる + 完了マーク
      try { if (window._fpZoomWin && !window._fpZoomWin.closed) window._fpZoomWin.close(); } catch (_) {}
      try { if (window._fpMemoWin && !window._fpMemoWin.closed) window._fpMemoWin.close(); } catch (_) {}
      const panel = document.getElementById('fp-memo-panel'); if (panel) panel.remove();
    });
  }

  // (旧トースト系は unified progress panel に統合済み)

  // AI 結果保存: GAS を一次ソース、localStorage は network失敗時のbackupのみ
  // (旧マルチキー localStorage 散らばりを廃止、データの真実は GAS シートに一本化)
  function autoSaveAIResult(result, customerName, booking) {
    if (!result || !result.ok) return;
    const bookingTs = (booking && booking.ts) || '';
    const userId   = (booking && booking.userId) || '';
    const nameKey  = customerName || (booking && booking.name) || '';
    const newTasks = (result.tasks || []).map(t => ({
      task: t.task, due: t.dueDate, priority: t.priority, icon: t.icon,
      recommendedAction: t.recommendedAction, actionTemplate: t.lineDraft,
      createdAt: new Date().toISOString(), customerName: nameKey, bookingTs,
    }));
    const entry = {
      bookingTs, userId, customerName: nameKey,
      date: booking && booking.date,
      transcript: result.transcript || '',
      summary: result.summary || '',
      transcript_summary: result.transcript_summary || '',
      key_concerns: result.key_concerns || [],
      next_meeting_suggestion: result.next_meeting_suggestion || '',
      lifeEventCandidates: result.lifeEventCandidates || [],
      createdAt: new Date().toISOString(),
    };
    // ★ ライフイベント自動抽出: 抽出された 候補 を 該当顧客の customEvents[] に積む
    try {
      const cands = Array.isArray(result.lifeEventCandidates) ? result.lifeEventCandidates : [];
      if (cands.length > 0 && window.DUMMY_CLIENTS) {
        const c = window.DUMMY_CLIENTS.find(x =>
          (x.lineFriendId && x.lineFriendId === userId) ||
          (x.name && (x.name === nameKey || x.name === customerName))
        );
        if (c) {
          if (!Array.isArray(c.customEvents)) c.customEvents = [];
          const sourceTag = 'Zoom ' + (booking?.date || new Date().toISOString().slice(0,10));
          cands.forEach(ev => {
            // 重複防止: date + label 一致は skip
            const key = (ev.date || '') + '|' + (ev.label || '');
            if (c.customEvents.some(x => (x.date || '') + '|' + (x.label || '') === key)) return;
            c.customEvents.push({
              date: ev.date || '',
              label: ev.label || '',
              who: ev.who || c.name,
              cat: ev.cat || 'family',
              source: sourceTag,
              confidence: ev.confidence || 0.5,
              addedAt: new Date().toISOString(),
            });
          });
          try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS)); } catch (_) {}
          console.log('[lifeEvent抽出]', cands.length, 'candidates → customEvents on', c.name);
        }
      }
    } catch (e) { console.warn('lifeEventCandidates merge fail:', e); }
    // ★ 「録画されてない可能性」 を 構造的に 排除:
    //   1. 最初に localStorage backup を 確実に保存 (POST失敗しても データ消えない)
    //   2. GAS POST を 3回 retry (3s/6s/12s)
    //   3. 失敗時 pending-sync 蓄積 → 起動時 自動再送
    const persistKey = 'fp-ai-backup-' + (bookingTs || userId || nameKey || Date.now()) + '-' + Date.now();
    try { localStorage.setItem(persistKey, JSON.stringify({ entry, tasks: newTasks })); } catch (_) {}
    async function saveWithRetry(maxRetries) {
      const delays = [3000, 6000, 12000];
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const r = await fetch(CLOUD_RUN_BASE + '/api/save-ai-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entry, tasks: newTasks }),
          });
          const d = await r.json();
          if (d && d.ok) return { ok: true };
          if (attempt < maxRetries) await new Promise(rs => setTimeout(rs, delays[attempt] || 12000));
          else return { ok: false, error: (d && d.error) || 'unknown' };
        } catch (e) {
          if (attempt < maxRetries) await new Promise(rs => setTimeout(rs, delays[attempt] || 12000));
          else return { ok: false, error: e.message };
        }
      }
      return { ok: false, error: 'retries exhausted' };
    }
    saveWithRetry(3).then(d => {
      if (d.ok) {
        console.log('[autoSaveAIResult] GAS 保存 OK');
        // 成功 → pending-sync から persistKey 削除 (まだ蓄積してなくても無害)
        try {
          const pending = JSON.parse(localStorage.getItem('fp-ai-pending-sync') || '[]');
          const filtered = pending.filter(p => p.persistKey !== persistKey);
          if (filtered.length !== pending.length) localStorage.setItem('fp-ai-pending-sync', JSON.stringify(filtered));
        } catch (_) {}
        // 顧客台帳再描画 (GAS から取り直す)
        fetchLiveData().catch(() => {});
        // ★ 中央 ポップアップ「顧客カード 反映完了」 + SKU (録画時刻ID) で 紐付け可視化
        try {
          const recDate = new Date();
          const sku = recDate.getFullYear() + String(recDate.getMonth()+1).padStart(2,'0') + String(recDate.getDate()).padStart(2,'0') + '-' + String(recDate.getHours()).padStart(2,'0') + String(recDate.getMinutes()).padStart(2,'0');
          showCenterToast(
            '議事録 #' + sku + ' を 反映しました',
            (nameKey || 'お客様') + ' 様 → 議事録タブ → カード上の 「#' + sku + '」 が この議事録です',
            { tone: 'success' }
          );
        } catch (_) {}
      } else {
        console.warn('[autoSaveAIResult] GAS 4回retry失敗→pending-sync 蓄積', d);
        saveAIToLocalBackup(entry, newTasks, persistKey);
        try { showCenterToast('議事録 保存 一時失敗', 'ローカル保存しました。 5分毎に 自動再送 します (' + (d.error || '原因不明').slice(0,60) + ')', { tone: 'success' }); } catch (_) {}
      }
    });
  }
  // ★ 起動時 + 5分毎 に pending-sync の 未送信 entry を 自動再送
  async function flushPendingAiSync() {
    let pending;
    try { pending = JSON.parse(localStorage.getItem('fp-ai-pending-sync') || '[]'); } catch (_) { pending = []; }
    if (!Array.isArray(pending) || pending.length === 0) return;
    console.log('[pending-sync] flush', pending.length, 'entries');
    const remaining = [];
    for (const p of pending) {
      try {
        const r = await fetch(CLOUD_RUN_BASE + '/api/save-ai-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entry: p.entry, tasks: p.tasks || [] }),
        });
        const d = await r.json();
        if (!d || !d.ok) remaining.push(p);
      } catch (_) { remaining.push(p); }
    }
    try { localStorage.setItem('fp-ai-pending-sync', JSON.stringify(remaining)); } catch (_) {}
    if (remaining.length < pending.length) {
      console.log('[pending-sync] flushed', pending.length - remaining.length, 'remaining', remaining.length);
      try { fetchLiveData(); } catch (_) {}
    }
  }
  if (!window._fpPendingSyncInterval) {
    window._fpPendingSyncInterval = setInterval(flushPendingAiSync, 5 * 60 * 1000);
    // 起動時 5秒後 (LiveData load 後) に 1回
    setTimeout(flushPendingAiSync, 5000);
  }

  // GAS到達不能時の localStorage backup (5分毎 自動再送)
  function saveAIToLocalBackup(entry, tasks, persistKey) {
    try {
      const pending = JSON.parse(localStorage.getItem('fp-ai-pending-sync') || '[]');
      pending.push({ entry, tasks, persistKey, queuedAt: new Date().toISOString() });
      localStorage.setItem('fp-ai-pending-sync', JSON.stringify(pending));
      // 表示用 backup も
      const k = persistKey || ('fp-ai-backup-' + (entry.bookingTs || entry.userId || Date.now()));
      localStorage.setItem(k, JSON.stringify({ entry, tasks }));
    } catch (_) {}
  }

  // AI 議事録生成 (Drive アップロードと並行)
  async function aiProcessRecording(blob, bookingTs, customerName, booking) {
    const sizeMB = blob.size / 1024 / 1024;
    console.log('[aiProcessRecording] start', { sizeMB: sizeMB.toFixed(2), bookingTs, customerName });
    // ★ オーナーfb 2026-06-23: 長時間録画 (30分/1時間) で AI処理 が 走らない問題
    //   旧: 18MB 超 → 黙って null return (議事録 0)
    //   新: 25MB 超 → チャンク分割 (audio Blob を 時系列で 切って 各チャンク を 個別に Whisper → 結合)
    if (sizeMB > 25) {
      console.log('[aiProcessRecording] large file → chunked path', sizeMB);
      return await aiProcessRecordingChunked(blob, bookingTs, customerName, booking);
    }
    try {
      const reader = new FileReader();
      const base64 = await new Promise((res, rej) => {
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
      const survey = ((liveData && liveData.survey_answers) || []).find(s => s.userId === (booking && booking.userId));
      const ctx = survey ? `テーマ: ${survey.q1_テーマ} / 年代: ${survey.q2_年代} / 家族: ${survey.q3_家族} / 年収: ${survey.q4_年収} / 悩み: ${survey.q5_悩み}` : '';
      // ★ オーナーfb 2026-06-23: 長録画 Whisper timeout 防止: クライアント側 timeout 10分
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      const r = await fetch(CLOUD_RUN_BASE + '/api/process-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64, mimeType: blob.type || 'audio/webm',
          customerName, customerContext: ctx,
          bookingTs, userId: booking && booking.userId,
          tenantId: (window.__fp && window.__fp.tenantId) || '',
        }),
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        const err = `HTTP ${r.status}: ${text.slice(0, 200)}`;
        console.error('[aiProcessRecording] non-OK response', err);
        return { ok: false, error: err };
      }
      const data = await r.json();
      console.log('[aiProcessRecording] response', { ok: data.ok, hasTranscript: !!data.transcript, hasSummary: !!data.summary, error: data.error });
      return data;
    } catch (e) {
      const msg = e.name === 'AbortError' ? '10分の timeout 超過 (録画が長過ぎる可能性)' : (e.message || String(e));
      console.error('[aiProcessRecording] catch', msg, e);
      return { ok: false, error: 'AI処理 例外: ' + msg };
    }
  }

  // ★ オーナーfb 2026-06-23: 長録画 (>25MB) — Blob を 18MB チャンクに分割 → 各チャンク Whisper → transcript 結合
  // 要約 endpoint がない場合は 「文字起こしのみ + Anthropic への直call 試行」 で fallback
  async function aiProcessRecordingChunked(blob, bookingTs, customerName, booking) {
    try {
      const chunkSize = 18 * 1024 * 1024;
      const chunks = [];
      for (let off = 0; off < blob.size; off += chunkSize) {
        chunks.push(blob.slice(off, Math.min(off + chunkSize, blob.size), blob.type));
      }
      console.log('[aiChunked] split into', chunks.length, 'chunks');
      const allResults = [];
      let firstErr = null;
      for (let i = 0; i < chunks.length; i++) {
        try { showCenterToast?.('議事録 を 生成中…', `音声が長いので 分割処理中 (${i+1}/${chunks.length})`, { tone: 'progress', duration: 0 }); } catch (_) {}
        const c = chunks[i];
        const reader = new FileReader();
        const base64 = await new Promise((res, rej) => {
          reader.onload = () => res(reader.result.split(',')[1]);
          reader.onerror = rej;
          reader.readAsDataURL(c);
        });
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 8 * 60 * 1000);
        let r;
        try {
          r = await fetch(CLOUD_RUN_BASE + '/api/process-recording', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64, mimeType: blob.type || 'audio/webm',
              customerName: customerName + ` (chunk ${i+1}/${chunks.length})`,
              customerContext: '', bookingTs, userId: booking && booking.userId,
              tenantId: (window.__fp && window.__fp.tenantId) || '',
            }),
            signal: controller.signal,
          });
        } catch (e) {
          if (!firstErr) firstErr = `chunk ${i+1} fetch fail: ${e.message || e}`;
          continue;
        } finally { clearTimeout(tid); }
        if (!r.ok) { if (!firstErr) firstErr = `chunk ${i+1}: HTTP ${r.status}`; continue; }
        const d = await r.json().catch(() => ({}));
        if (d.transcript || d.summary) allResults.push(d);
        else if (d.error && !firstErr) firstErr = `chunk ${i+1}: ${d.error}`;
      }
      if (allResults.length === 0) {
        return { ok: false, error: firstErr || '全チャンクの 文字起こし に失敗' };
      }
      const fullTranscript = allResults.map(r => r.transcript || '').filter(Boolean).join('\n---\n');
      const mergedSummary = allResults.map((r, i) => `【パート${i+1}】\n` + (r.summary || '(要約なし)')).join('\n\n');
      const mergedConcerns = [...new Set(allResults.flatMap(r => r.key_concerns || []))].slice(0, 8);
      const mergedTasks = allResults.flatMap(r => r.tasks || []).slice(0, 8);
      return {
        ok: true,
        transcript: fullTranscript,
        summary: mergedSummary,
        key_concerns: mergedConcerns,
        tasks: mergedTasks,
        chunked: true,
        chunkCount: chunks.length,
      };
    } catch (e) {
      console.error('[aiChunked] fatal', e);
      return { ok: false, error: 'チャンク分割処理 例外: ' + (e.message || e) };
    }
  }

  function showAIResultModal(result, customerName, booking) {
    if (!result || !result.ok) return;
    const overlay = document.createElement('div');
    overlay.id = 'fp-ai-result';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:10003;display:flex;align-items:center;justify-content:center;padding:20px;';
    const tasksHtml = (result.tasks || []).map(t => {
      const priColor = t.priority === '至急' ? '#fef2f2;color:#b91c3c' : (t.priority === '今週') ? '#fff7ed;color:#c2410c' : '#f0f9ff;color:#075985';
      return `
        <div style="background:#fff;border:1px solid #e5e7eb;border-left:3px solid #c19a3a;border-radius:8px;padding:14px 18px;">
          <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;">
            <span style="font-size:18px;">${t.icon || '✅'}</span>
            <span style="font-size:10.5px;font-weight:700;background:${priColor};padding:3px 8px;border-radius:10px;letter-spacing:0.04em;">${escapeHtml(t.priority||'-')}</span>
            <span style="font-size:11px;color:#6b7280;margin-left:auto;font-family:'Inter',sans-serif;">${escapeHtml(t.dueDate||'-')}</span>
          </div>
          <strong style="font-size:14px;display:block;margin-bottom:6px;">${escapeHtml(t.task||'')}</strong>
          <div style="font-size:11.5px;color:#5e4d1a;background:#fdfbf4;border:1px solid #e8d9a8;border-radius:5px;padding:7px 11px;margin-bottom:8px;line-height:1.6;">${escapeHtml(t.recommendedAction||'')}</div>
          ${t.lineDraft ? `
            <div style="background:#dcfce7;border:1px solid #86efac;border-radius:5px;padding:9px 12px;font-size:12px;color:#166534;line-height:1.65;margin-bottom:6px;white-space:pre-wrap;">${escapeHtml(t.lineDraft)}</div>
            <button class="fp-ai-send" data-uid="${escapeHtml((booking && booking.userId)||'')}" data-msg="${escapeHtml(t.lineDraft)}" style="font-size:11.5px;padding:6px 12px;background:#06c755;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;font-family:inherit;">→ このLINEを送信</button>
          ` : ''}
        </div>`;
    }).join('');
    overlay.innerHTML = `
      <div style="background:#fff;width:min(820px,100%);max-height:92vh;overflow-y:auto;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);">
        <div style="padding:20px 26px;border-bottom:1px solid #e8e2d4;display:flex;justify-content:space-between;align-items:baseline;">
          <div>
            <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:3px;">AI Meeting Summary${result.mock ? ' <span style="background:#fef2f2;color:#b91c3c;padding:1px 6px;border-radius:4px;font-size:9.5px;margin-left:4px;letter-spacing:0.02em;">DEMO MODE</span>' : ''}</div>
            <h2 style="font-family:'Noto Serif JP',serif;font-size:20px;margin:0;font-weight:600;color:#1f2a3f;">${escapeHtml(customerName)}様 面談 AI 議事録</h2>
          </div>
          <button id="fp-ai-close-modal" title="保存済み・閉じる" style="background:#dcfce7;border:1px solid #86efac;color:#166534;width:auto;height:32px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;padding:0 12px;font-family:inherit;">✓ 保存済 ✕</button>
        </div>
        <div style="background:#f0fdf4;border-bottom:1px solid #bbf7d0;padding:8px 26px;font-size:11.5px;color:#166534;font-weight:600;">
          ✓ この議事録・タスク・関心事はすでに <strong>顧客カード&gt;面談録</strong> に自動保存されています。✕ や 閉じる ボタンを押しても消えません。
        </div>
        ${result.mock ? '<div style="background:#fff8e1;border-bottom:1px solid #f0d36b;padding:10px 26px;font-size:11.5px;color:#5e4d1a;">⚠ デモモード — Groq + Anthropic の API キーが未設定。実際の Zoom 音声ではなく、サンプル議事録を表示しています</div>' : ''}
        <div style="padding:22px 26px;">
          ${result.summary ? `
            <div style="margin-bottom:22px;">
              <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:8px;">議事録</div>
              <div style="background:#fafbfc;border:1px solid #e8e2d4;border-radius:8px;padding:14px 18px;font-size:13px;line-height:1.75;white-space:pre-wrap;">${escapeHtml(result.summary)}</div>
            </div>` : ''}
          ${result.key_concerns && result.key_concerns.length > 0 ? `
            <div style="margin-bottom:22px;">
              <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:8px;">お客様の関心事</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${result.key_concerns.map(k => `<span style="background:#fff;border:1px solid #c19a3a;color:#5e4d1a;padding:5px 12px;border-radius:14px;font-size:12px;font-weight:600;">${escapeHtml(k)}</span>`).join('')}
              </div>
            </div>` : ''}
          ${tasksHtml ? `
            <div style="margin-bottom:22px;">
              <div style="font-size:10.5px;font-weight:700;color:#8b7d5d;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:8px;">FP が次にやるタスク (推奨)</div>
              <div style="display:grid;gap:10px;">${tasksHtml}</div>
            </div>` : ''}
          ${result.next_meeting_suggestion ? `
            <div style="background:#f0f4fa;border:1px solid #3b5c8f33;border-left:3px solid #3b5c8f;border-radius:6px;padding:12px 16px;font-size:12.5px;color:#1e3a5f;line-height:1.65;">
              <strong>次回面談の提案:</strong> ${escapeHtml(result.next_meeting_suggestion)}
            </div>` : ''}
        </div>
        <div style="padding:14px 26px;border-top:1px solid #e8e2d4;display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font-size:11.5px;color:#16a34a;font-weight:700;">✓ 顧客カード「面談録」タブに自動保存済み — どちらの閉じるボタンを押しても消えません</span>
          <button id="fp-ai-save-tasks" style="font-size:13px;padding:9px 20px;background:linear-gradient(135deg,#1b2845,#0f1729);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">閉じる (保存済)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('fp-ai-close-modal').addEventListener('click', () => overlay.remove());
    document.getElementById('fp-ai-save-tasks').addEventListener('click', () => {
      // 自動保存済みなのでモーダルを閉じるだけ
      overlay.remove();
    });
    overlay.querySelectorAll('.fp-ai-send').forEach(btn => {
      btn.addEventListener('click', async () => {
        // dataset.uid が空 (booking 不在で保存された分) なら現在開いてる客 / liveData users から fallback
        let uid = btn.dataset.uid;
        const msg = btn.dataset.msg;
        if (!uid) {
          // 1) 現在モーダル開いてる client から
          const cur = window._fpCurrentClient;
          if (cur && cur.lineFriendId) uid = cur.lineFriendId;
        }
        if (!uid) {
          // 2) customerName と一致する LINE users から
          const us = (window.LineAppLiveData && window.LineAppLiveData.users) || [];
          const hit = us.find(u => u.displayName && customerName && u.displayName.indexOf(customerName) >= 0);
          if (hit) uid = hit.userId;
        }
        if (!uid) { showFriendAddPrompt(customerName, (booking && booking.id) || ''); return; }
        const finalMsg = prompt('LINEで送るメッセージ (編集可)', msg);
        if (!finalMsg) return;
        btn.disabled = true; btn.textContent = '送信中...';
        try {
          const r = await fetch(CLOUD_RUN_BASE + '/api/send-line', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: uid, text: finalMsg }),
          });
          const d = await r.json();
          if (d.ok) { btn.textContent = '✓ 送信済'; btn.style.background = '#94a3b8'; }
          else { alert('失敗: ' + (d.error || '')); btn.disabled = false; btn.textContent = '→ このLINEを送信'; }
        } catch (e) { alert('失敗: ' + e.message); btn.disabled = false; btn.textContent = '→ このLINEを送信'; }
      });
    });
  }

  async function autoUploadRecording(blob, bookingTs, customerName, booking) {
    const sizeMB = blob.size / 1024 / 1024;
    const filename = `meeting-${(booking && booking.date) || new Date().toISOString().slice(0,10)}-${new Date().toISOString().slice(11,16).replace(':','')}.webm`;
    if (sizeMB > 24) throw new Error('ファイルが大きすぎます (' + sizeMB.toFixed(1) + 'MB)');
    const reader = new FileReader();
    const base64 = await new Promise((res, rej) => {
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    const r = await fetch(CLOUD_RUN_BASE + '/api/upload-recording', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: bookingTs, customerName, filename, mimeType: 'audio/webm', base64 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Drive 保存失敗');
    return data;
  }


  function showPickerHint() {
    if (document.getElementById('fp-picker-hint')) return;
    const o = document.createElement('div');
    o.id = 'fp-picker-hint';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(2px);z-index:10004;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;pointer-events:none;';
    o.innerHTML = `
      <div style="background:linear-gradient(135deg,#fff7ed,#fffbf2);border:3px solid #f59e0b;border-radius:20px;padding:28px 36px;max-width:560px;box-shadow:0 24px 64px rgba(0,0,0,0.35);font-family:inherit;animation:fp-hint-bounce 0.6s ease-out;">
        <h2 style="margin:0 0 12px;font-size:18px;font-family:'Noto Serif JP',serif;display:flex;align-items:center;gap:10px;">
          <span style="font-size:28px;">👇</span> 画面共有ダイアログの操作方法
        </h2>
        <ol style="margin:0;padding-left:24px;font-size:14px;line-height:1.85;color:#1f2937;">
          <li>上のタブから 「<strong style="color:#d9264c;">画面全体</strong>」 をクリック</li>
          <li>表示されている <strong>モニター画像</strong> をクリックして選択</li>
          <li>右下の <strong style="color:#06c755;">「共有」</strong> ボタンを押す</li>
        </ol>
        <div style="margin-top:14px;padding:10px 14px;background:#fffbf2;border:1px solid #f0d36b;border-radius:8px;font-size:12px;color:#5e4d1a;line-height:1.55;">
          💡 「ウィンドウ」 や 「Chrome タブ」 ではなく <strong>「画面全体」</strong> を選んでください<br>
          → 画面全体録画なので Zoom も メモも 全部1枚に収まります
        </div>
      </div>`;
    document.body.appendChild(o);
    if (!document.getElementById('fp-hint-style')) {
      const s = document.createElement('style');
      s.id = 'fp-hint-style';
      s.textContent = '@keyframes fp-hint-bounce{0%{transform:translateY(-30px) scale(0.9);opacity:0}60%{transform:translateY(8px) scale(1.02);opacity:1}100%{transform:translateY(0) scale(1);opacity:1}}';
      document.head.appendChild(s);
    }
  }

  function hidePickerHint() {
    const o = document.getElementById('fp-picker-hint');
    if (o) o.remove();
  }

  // 画面下に常時表示の「面談を完了する」 固定バー (録画中・処理中に出続ける)
  function showFixedCompleteButton() {
    if (document.getElementById('fp-fixed-complete')) return;
    const bar = document.createElement('div');
    bar.id = 'fp-fixed-complete';
    // ★ オーナーfb (4回目): Zoom ウィンドウは別OSウィンドウで右側に並ぶ → bar 右端は Zoom に被って隠れる。
    // 物理対策: ボタンを「左端」に固定 (Zoom がどこにあっても見える)
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:linear-gradient(180deg,#1b2845,#0f1729);color:#fff;padding:14px 24px;box-shadow:0 -8px 32px rgba(15,23,41,0.3);z-index:99999;display:flex;align-items:center;justify-content:flex-start;gap:18px;font-family:inherit;';
    bar.innerHTML = `
      <button id="fp-fixed-complete-btn" style="background:#fff;color:#1b2845;border:none;padding:14px 32px;font-size:14px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;font-family:'Inter','Noto Sans JP',sans-serif;box-shadow:0 4px 14px rgba(255,255,255,0.2);flex-shrink:0;">■ 面談を完了する</button>
      <div style="display:flex;align-items:center;gap:12px;font-size:13px;min-width:0;">
        <span style="width:10px;height:10px;background:#ff4d6d;border-radius:50%;animation:fp-rec-pulse 1s infinite;flex-shrink:0;"></span>
        <strong style="letter-spacing:0.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">面談中 — 終わったら左の「■ 面談を完了する」を押す</strong>
      </div>
    `;
    document.body.appendChild(bar);
    document.getElementById('fp-fixed-complete-btn').addEventListener('click', () => {
      const hasActiveRecording = window._fpRecorder
        && window._fpRecorder.mediaRecorder
        && window._fpRecorder.mediaRecorder.state !== 'inactive';
      if (!hasActiveRecording) {
        handleFinishWithoutRecording();
        return;
      }
      if (!confirm('録画を停止して AI 議事録を生成しますか?\n(Zoom と メモも一緒に閉じます)')) return;
      stopScreenRecording();
    });
  }

  // 録画が行われていない状態で「終了」 が押された場合の処理
  // (音声テスト中の押下 / 何らかの理由で録画開始失敗 / 検証目的 など)
  // silent skip だと「ボタン効かない」 とユーザーが誤解するため、 必ず可視フィードバックを返す
  function handleFinishWithoutRecording() {
    // メモは可能な限り保存
    try {
      if (window._fpMemoWin && !window._fpMemoWin.closed) {
        // popup 側で localStorage に保存済 (memo-popup 側 finish-meeting-btn handler が事前保存している)
        window._fpMemoWin.close();
      }
    } catch (_) {}
    try { if (window._fpZoomWin && !window._fpZoomWin.closed) window._fpZoomWin.close(); } catch (_) {}
    hideFixedCompleteButton();

    // モーダルで明示
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.65);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit;';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:480px;width:100%;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;">
        <div style="background:linear-gradient(135deg,#FEF3C7,#FDE68A);padding:18px 24px;border-bottom:1px solid #F59E0B;">
          <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.22em;color:#92400E;text-transform:uppercase;margin-bottom:4px;">録画なし</div>
          <h3 style="font-family:'Noto Sans JP',sans-serif;font-weight:900;font-size:18px;margin:0;color:#0E1116;letter-spacing:-0.012em;">AI 議事録 は生成できませんでした</h3>
        </div>
        <div style="padding:20px 24px;font-size:13.5px;color:#353D4F;line-height:1.85;">
          画面録画 が 開始されていない 状態 で 「終了」 が押されたため、 <b style="color:#0E1116;">AI 音声議事録 の 生成 を スキップ</b> しました。<br><br>
          メモ 入力 がある場合 は ローカル に 保存済み です。<br><br>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#6B7385;">▼ 議事録生成 を 実行 する 場合 は:<br>① 顧客カード → 予約 → 「● 録画ONでZoom開始」<br>② Zoom 終了時 「■ 録画停止」 → 自動で AI 解析 + 議事録生成</span>
        </div>
        <div style="padding:14px 24px 20px;display:flex;gap:10px;justify-content:flex-end;">
          <button id="fp-no-rec-close" style="background:#0E1116;color:#fff;border:none;padding:10px 24px;border-radius:6px;font-family:'Manrope',sans-serif;font-weight:800;font-size:13px;letter-spacing:0.04em;cursor:pointer;">了解</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('fp-no-rec-close').addEventListener('click', () => overlay.remove());
    try { window.focus(); } catch (_) {}
  }
  function hideFixedCompleteButton() {
    const b = document.getElementById('fp-fixed-complete');
    if (b) b.remove();
  }

  function showRecordingBorder() {
    if (document.getElementById('fp-rec-border')) return;
    const b = document.createElement('div');
    b.id = 'fp-rec-border';
    b.style.cssText = 'position:fixed;inset:0;border:5px solid #d9264c;border-radius:0;pointer-events:none;z-index:10200;box-shadow:inset 0 0 24px rgba(217,38,76,0.35);animation:fp-rec-border-pulse 1.6s ease-in-out infinite;';
    document.body.appendChild(b);
    if (!document.getElementById('fp-rec-border-style')) {
      const s = document.createElement('style');
      s.id = 'fp-rec-border-style';
      s.textContent = '@keyframes fp-rec-border-pulse{0%,100%{border-color:#d9264c;box-shadow:inset 0 0 24px rgba(217,38,76,0.35)}50%{border-color:#ff4d6d;box-shadow:inset 0 0 36px rgba(217,38,76,0.55)}}';
      document.head.appendChild(s);
    }
  }

  function hideRecordingBorder() {
    const b = document.getElementById('fp-rec-border');
    if (b) b.remove();
  }

  function stopScreenRecording() {
    const R = window._fpRecorder;
    if (R.mediaRecorder && R.mediaRecorder.state !== 'inactive') R.mediaRecorder.stop();
    if (R.timerId) { clearInterval(R.timerId); R.timerId = null; }
    const pill = document.getElementById('fp-rec-pill');
    if (pill) pill.remove();
    hideRecordingBorder();
    localStorage.removeItem('fp-memo-fullscreen');
    // Zoom 閉じ監視も停止
    if (window._fpZoomCloseWatcher) { clearInterval(window._fpZoomCloseWatcher); window._fpZoomCloseWatcher = null; }
    // ★ Zoom popup + メモ popup を自動で閉じて CRM を前面に
    try { if (window._fpZoomWin && !window._fpZoomWin.closed) window._fpZoomWin.close(); } catch (_) {}
    try { if (window._fpMemoWin && !window._fpMemoWin.closed) window._fpMemoWin.close(); } catch (_) {}
    const panel = document.getElementById('fp-memo-panel'); if (panel) panel.remove();
    try { window.focus(); } catch (_) {}
    hideFixedCompleteButton();
  }

  function showRecordingPill() {
    const R = window._fpRecorder;
    let el = document.getElementById('fp-rec-pill');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fp-rec-pill';
      // 大型化 + メイン CTA を「録画を停止」 に絞る + 自動停止案内付き
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="display:flex;align-items:center;gap:10px;padding-right:14px;border-right:1px solid rgba(255,255,255,0.3);">
            <span style="width:14px;height:14px;background:#fff;border-radius:50%;display:inline-block;animation:fp-rec-pulse 1s infinite;box-shadow:0 0 12px rgba(255,255,255,0.8);"></span>
            <div style="display:flex;flex-direction:column;line-height:1;gap:4px;">
              <span style="font-family:'Inter',sans-serif;font-size:10px;font-weight:800;letter-spacing:0.22em;opacity:0.85;">REC</span>
              <span id="fp-rec-time" style="font-weight:900;font-family:'Inter',sans-serif;letter-spacing:0.04em;font-size:18px;font-variant-numeric:tabular-nums;">00:00</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button id="fp-rec-stop-btn" style="background:#fff;color:#b91c3c;border:none;padding:11px 22px;border-radius:6px;font-weight:900;cursor:pointer;font-family:'Inter','Noto Sans JP',sans-serif;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;box-shadow:0 4px 12px rgba(0,0,0,0.15);">■ 録画を停止</button>
            <button id="fp-zoom-close-btn" style="background:rgba(255,255,255,0.18);color:#fff;border:1.5px solid rgba(255,255,255,0.7);padding:7px 14px;border-radius:6px;font-weight:700;cursor:pointer;font-family:'Inter','Noto Sans JP',sans-serif;font-size:11.5px;letter-spacing:0.06em;">× Zoom を閉じる</button>
          </div>
        </div>
        <div style="margin-top:8px;font-size:10.5px;color:rgba(255,255,255,0.92);text-align:center;letter-spacing:0.04em;">面談終わったら ■ を押す / Zoom 閉じても自動停止</div>
      `;
      // ★ Zoom ウィンドウは右側に並ぶ → 右上配置だと Zoom に被る → 左上に固定 (4回目修正)
      el.style.cssText = 'position:fixed;top:18px;left:18px;background:linear-gradient(135deg,#d9264c,#b91c3c);color:#fff;padding:14px 18px 12px;border-radius:14px;box-shadow:0 16px 40px rgba(217,38,76,0.45),0 0 0 4px rgba(255,255,255,0.6);z-index:10201;font-size:13.5px;min-width:280px;';
      const style = document.createElement('style');
      style.textContent = '@keyframes fp-rec-pulse{0%,100%{opacity:1}50%{opacity:0.3}}@keyframes fp-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
      document.body.appendChild(el);
      document.getElementById('fp-rec-stop-btn').addEventListener('click', () => {
        if (!confirm('録画を停止しますか?\n\n停止後、自動で:\n・Drive に録画アップロード\n・AI で議事録 + タスク生成')) return;
        stopScreenRecording();
      });
      document.getElementById('fp-zoom-close-btn').addEventListener('click', () => {
        try { if (window._fpZoomWin && !window._fpZoomWin.closed) window._fpZoomWin.close(); } catch (_) {}
        window._fpZoomWin = null;
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:120px;right:18px;background:#0f1729;color:#fff;padding:10px 16px;border-radius:8px;z-index:10005;font-size:12px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.3);';
        t.textContent = '✓ Zoom を閉じました (録画は継続中)';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
      });
    }
    R.timerId = setInterval(() => {
      const secs = Math.floor((Date.now() - R.startTime) / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      const txt = (h > 0 ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      const elT = document.getElementById('fp-rec-time');
      if (elT) elT.textContent = txt;
    }, 1000);
  }

  async function onRecordingComplete(bookingTs, blob, blobUrl) {
    // ★ multi-tenant Firestore 顧客 も lookup 対象に (startScreenRecording と同じ理由)
    const fsAsBookings = (window._fpFirestoreConfirmed || []).map(c => ({
      _fsCustomerId: c.docId,
      userId: 'fs:' + c.docId,
      name: c.name,
      date: String(c.confirmedSlot || '').split(' ')[0] || '',
      time: String(c.confirmedSlot || '').split(' ')[1] || '',
      zoomUrl: c.zoomUrl,
      ts: c.confirmedAt?.toDate?.()?.toISOString?.() || '',
      lineFriendId: c.lineFriendId || c.userId || null,
    }));
    const booking = (((liveData && liveData.bookings) || []).concat(fsAsBookings))
      .find(b => String(b.ts).slice(0, 19) === String(bookingTs).slice(0, 19));
    // 録画完了の小さなトースト + ダウンロード/メモ動線
    showRecordingDoneToast(booking, blob, blobUrl, bookingTs);
    // ★ Zoom 待ち リスト から 自動 archive (録画完了 = 面談完了 とみなす)
    //   legacy 「完了」 ボタン path は data-complete-booking で archived set に push → 同じ機構を 自動発火
    //   booking.ts は legacy ISO / Firestore confirmedAt ISO どちらも archive 対象
    if (booking && booking.ts) {
      try {
        const set = new Set(JSON.parse(localStorage.getItem('fp-booking-archived') || '[]'));
        set.add(booking.ts);
        localStorage.setItem('fp-booking-archived', JSON.stringify([...set]));
        console.log('[recording-complete] auto-archived booking:', booking.ts, booking.name);
      } catch (e) { console.warn('auto-archive fail:', e); }
    }
    // サーバー側にも保存通知
    try { await fetch(CLOUD_RUN_BASE + '/api/recording/stop?ts=' + encodeURIComponent(bookingTs), { method: 'POST' }); } catch (_) {}
    await fetchLiveData();
    renderLeadHubInner();
  }

  function showRecordingDoneToast(booking, blob, blobUrl, bookingTs) {
    const name = (booking && booking.name) || 'お客様';
    const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:18px;right:18px;background:#fff;border:1px solid var(--line,#e5e7eb);border-left:4px solid var(--green,#06c755);border-radius:12px;padding:16px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.18);z-index:9999;max-width:380px;font-family:inherit;';
    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="font-size:20px;">✅</div>
        <strong style="font-size:14px;">録画保存完了</strong>
      </div>
      <div style="font-size:12.5px;color:#4b5563;margin-bottom:12px;line-height:1.5;">${escapeHtml(name)}様の面談録画 (${sizeMB}MB)</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <a href="${blobUrl}" download="meeting-${escapeHtml(name)}-${Date.now()}.webm" style="font-size:11.5px;padding:7px 12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;text-decoration:none;color:#1f2937;font-weight:600;">💾 ダウンロード</a>
        <button id="fp-open-memo" style="font-size:11.5px;padding:7px 14px;background:linear-gradient(135deg,#b8893d,#d4a017);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-family:inherit;">📝 メモを書く</button>
        <button id="fp-toast-close" style="font-size:11.5px;padding:7px 10px;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-family:inherit;">✕</button>
      </div>
    `;
    document.body.appendChild(toast);
    document.getElementById('fp-toast-close').addEventListener('click', () => toast.remove());
    document.getElementById('fp-open-memo').addEventListener('click', () => {
      toast.remove();
      openMemoModal(booking, bookingTs);
    });
    // 30秒で自動消去
    setTimeout(() => toast.remove(), 30000);
  }

  // ===== Google カレンダー右半分表示 v3 =====
  // 戦略: 1) /calendar/embed は iframe で動く (XFOヘッダなし) → 優先利用
  //       2) ボタンに「別ウィンドウで開く」副ボタンも常時表示
  function toggleCalendarSidePanel() {
    const existing = document.getElementById('fp-cal-side-v3');
    if (existing) {
      existing.remove();
      document.body.style.paddingRight = '';
      const btn = document.getElementById('fp-toggle-cal');
      if (btn) btn.textContent = '🗓 自分のGoogleカレンダーを並べて表示';
      return;
    }
    const widthStr = localStorage.getItem('fp-cal-side-width');
    const width = widthStr ? parseInt(widthStr, 10) : Math.floor(window.innerWidth * 0.45);

    const panel = document.createElement('div');
    panel.id = 'fp-cal-side-v3';
    panel.style.cssText = `position:fixed;top:0;right:0;bottom:0;width:${width}px;z-index:9997;background:#fff;border-left:1px solid #e5e7eb;box-shadow:-4px 0 24px rgba(0,0,0,0.08);display:flex;flex-direction:column;`;
    // 確定待ちを顧客単位でグルーピング (1人ずつ集中モード)
    //   legacy proxy survey_answers + Firestore tenants/{tid}/customers 両方 統合
    function buildPendingByCustomer() {
      const usersByUid = {};
      ((liveData && liveData.users) || []).forEach(u => { if (u.userId) usersByUid[u.userId] = u; });
      const isRealLineUid = (uid) => /^U[a-f0-9]{32}$/i.test(String(uid || ''));
      const pendingSurveys = ((liveData && liveData.survey_answers) || []).filter(s => !s.confirmedSlot && (s.q6_候補1 || s.q7_候補2 || s.q8_候補3) && isRealLineUid(s.userId));
      const legacy = pendingSurveys.map(s => {
        const candidates = [s.q6_候補1, s.q7_候補2, s.q8_候補3].map((slot, idx) => {
          if (!slot) return null;
          const parsed = parseSlotString(slot);
          if (!parsed.dateStr) return null;
          return { dateStr: parsed.dateStr, slotStr: parsed.slotStr, rank: idx + 1 };
        }).filter(Boolean);
        const userIdShort = (s.userId || '').slice(0, 8);
        const u = usersByUid[s.userId] || {};
        return {
          userId: s.userId,
          customerName: (s.name && String(s.name).trim())
            || (u.displayName && String(u.displayName).trim())
            || ((s.q1_テーマ && s.q1_テーマ.trim()) ? s.q1_テーマ + 'のお客様' : 'お客様 ' + userIdShort),
          pictureUrl: u.pictureUrl || '',
          age: s.q1_年代 || s.q2_年代 || '',
          family: s.q3_家族 || '',
          income: s.q4_年収 || '',
          theme: s.q8_テーマ || s.q1_テーマ || '',
          worry: s.q9_悩み || s.q5_悩み || '',
          ts: s.ts,
          candidates: candidates,
        };
      }).filter(p => p.candidates.length > 0);

      // ★ Firestore tenants/{tid}/customers (多テナント) を 合流
      const fsCustomers = window._fpFirestoreCustomers || [];
      const fs = fsCustomers.map(c => {
        const candidates = (c.meetingCandidates || []).map((slot, idx) => {
          if (!slot) return null;
          const parsed = parseSlotString(slot);
          if (!parsed.dateStr) return null;
          return { dateStr: parsed.dateStr, slotStr: parsed.slotStr, rank: idx + 1 };
        }).filter(Boolean);
        return {
          userId: 'fs:' + c.docId,
          _fsCustomerId: c.docId,
          customerName: c.name || c.lineDisplayName || 'お客様',
          pictureUrl: c.pictureUrl || c.linePictureUrl || '',
          age: c.surveyAnswers?.q1_年代 || '',
          family: c.surveyAnswers?.q3_家族 || '',
          income: c.surveyAnswers?.q4_年収 || '',
          theme: Array.isArray(c.themes) ? c.themes.join('・') : (c.surveyAnswers?.q8_テーマ || ''),
          worry: c.concerns || c.surveyAnswers?.q9_悩み || '',
          ts: c.createdAt?.toDate?.()?.toISOString?.() || null,
          candidates: candidates,
        };
      }).filter(p => p.candidates.length > 0);

      return legacy.concat(fs);
    }
    let pendingByCustomer = buildPendingByCustomer();
    // 直前にどの顧客にフォーカスしてたか復元 (確定後の自動次へで使う)
    const savedFocusUid = window._fpCalFocusUid;
    let currentIdx = 0;
    if (savedFocusUid) {
      const idx = pendingByCustomer.findIndex(p => p.userId === savedFocusUid);
      if (idx >= 0) currentIdx = idx;
    }

    // 日付を ローカル(JST)で YYYY-MM-DD に整形 (toISOString は UTC で 1日ずれる罠を回避)
    const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    // 起点日(候補日1つ目)の週初め (月曜) を計算
    const startDate = pendingByCustomer[currentIdx] && pendingByCustomer[currentIdx].candidates[0]
      ? new Date(pendingByCustomer[currentIdx].candidates[0].dateStr + 'T00:00:00')
      : new Date();
    const dow = startDate.getDay();
    const monOffset = (dow === 0 ? -6 : 1 - dow);
    const weekStart = new Date(startDate); weekStart.setDate(startDate.getDate() + monOffset); weekStart.setHours(0,0,0,0);
    panel.dataset.weekStart = fmtLocalDate(weekStart);

    panel.innerHTML = `
      <div id="fp-cal-resize-v3" style="position:absolute;top:0;bottom:0;left:0;width:6px;cursor:ew-resize;z-index:2;background:transparent;"></div>
      <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb;background:#fafbfc;display:flex;align-items:center;gap:8px;">
        <strong style="flex:1;font-size:12.5px;">🗓 自分のカレンダー (FP)</strong>
        <button id="fp-cal-prev-v3" title="前週" style="font-size:13px;width:26px;height:26px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;color:#374151;font-family:inherit;">‹</button>
        <button id="fp-cal-today-v3" title="今週へ" style="font-size:11px;padding:5px 10px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;color:#374151;font-weight:600;font-family:inherit;">今週</button>
        <button id="fp-cal-next-v3" title="次週" style="font-size:13px;width:26px;height:26px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;color:#374151;font-family:inherit;">›</button>
        <button id="fp-cal-close-v3" style="font-size:13px;width:26px;height:26px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;color:#6b7280;font-family:inherit;">✕</button>
      </div>
      <div id="fp-cal-focus-section"></div>
      <div id="fp-cal-week-v3" style="flex:1;overflow-y:auto;background:#fff;padding:6px 4px 14px;"></div>
    `;
    document.body.appendChild(panel);
    document.body.style.paddingRight = width + 'px';
    const btn = document.getElementById('fp-toggle-cal');
    if (btn) btn.textContent = '✕ カレンダーを閉じる';

    document.getElementById('fp-cal-close-v3').addEventListener('click', toggleCalendarSidePanel);

    // ★ 自前の週ビュー: GAS から FP カレンダー予定を fetch して描画
    async function renderWeekView() {
      const root = document.getElementById('fp-cal-week-v3');
      if (!root) return;
      const ws = new Date(panel.dataset.weekStart + 'T00:00:00');
      const we = new Date(ws); we.setDate(ws.getDate() + 6); we.setHours(23,59,59,999);
      const fromStr = fmtLocalDate(ws);
      const toStr = fmtLocalDate(we);
      const wkLabel = `${ws.getMonth()+1}月${ws.getDate()}日 〜 ${we.getMonth()+1}月${we.getDate()}日`;
      root.innerHTML = `<div style="text-align:center;padding:8px;font-size:12px;color:#6b7280;font-weight:600;letter-spacing:0.04em;">${wkLabel}<span style="margin-left:8px;color:#9ca3af;font-weight:400;">読み込み中…</span></div>`;
      try {
        const r = await fetch(CLOUD_RUN_BASE + '/api/fp-events?from=' + fromStr + '&to=' + toStr);
        const data = await r.json();
        if (!data.ok) { root.innerHTML = `<div style="padding:24px;text-align:center;color:#dc2626;font-size:12px;">予定取得失敗: ${data.error||'unknown'}</div>`; return; }
        // 候補日 (赤枠で強調)
        const focused = pendingByCustomer[currentIdx];
        const candidates = focused ? focused.candidates : [];
        const candidateSet = new Set(candidates.map(c => c.dateStr));
        // 7列 (月〜日)
        const days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(ws); d.setDate(ws.getDate() + i);
          days.push(d);
        }
        const wdLabel = ['月','火','水','木','金','土','日'];
        const today = new Date(); today.setHours(0,0,0,0);
        const eventsByDay = days.map(d => {
          const dKey = fmtLocalDate(d);
          return (data.events || []).filter(ev => {
            const evDate = fmtLocalDate(new Date(ev.start));
            return evDate === dKey;
          });
        });
        let html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:0 6px 14px;">';
        days.forEach((d, i) => {
          const dKey = fmtLocalDate(d);
          const isToday = d.getTime() === today.getTime();
          const isCandidate = candidateSet.has(dKey);
          const evs = eventsByDay[i];
          const headerBg = isCandidate ? 'linear-gradient(135deg,#fef3c7,#fde68a)' : (isToday ? '#dbeafe' : '#f3f4f6');
          const headerColor = isCandidate ? '#92400e' : (isToday ? '#1e40af' : '#374151');
          html += `
            <div style="background:#fff;border:1.5px solid ${isCandidate ? '#f59e0b' : (isToday ? '#3b82f6' : '#e5e7eb')};border-radius:6px;min-height:240px;display:flex;flex-direction:column;">
              <div style="background:${headerBg};color:${headerColor};padding:6px 4px;text-align:center;border-radius:4px 4px 0 0;font-size:10.5px;font-weight:700;letter-spacing:0.04em;">
                ${wdLabel[i]} ${d.getMonth()+1}/${d.getDate()}
                ${isCandidate ? '<div style="font-size:9.5px;margin-top:2px;font-weight:800;">候補日</div>' : ''}
              </div>
              <div style="padding:4px 3px;flex:1;display:flex;flex-direction:column;gap:2px;">
                ${evs.length === 0 ? '<div style="text-align:center;font-size:10px;color:#cbd5e1;padding:8px 0;">予定なし</div>' : evs.slice(0,8).map(ev => {
                  const st = new Date(ev.start);
                  const tm = ev.allDay ? '終日' : String(st.getHours()).padStart(2,'0') + ':' + String(st.getMinutes()).padStart(2,'0');
                  return `<div title="${escapeHtml(ev.title)} (${escapeHtml(ev.calendarName||'')})" style="background:#eff6ff;border-left:2px solid #3b82f6;padding:3px 5px;font-size:10px;color:#1e40af;border-radius:2px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="font-weight:700;">${tm}</span> ${escapeHtml(ev.title||'(無題)')}</div>`;
                }).join('')}
                ${evs.length > 8 ? `<div style="font-size:9px;color:#6b7280;text-align:center;">+${evs.length-8} 件</div>` : ''}
              </div>
            </div>
          `;
        });
        html += '</div>';
        html += '<div style="padding:8px 14px;font-size:10.5px;color:#6b7280;display:flex;gap:14px;flex-wrap:wrap;"><span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;background:#fde68a;border:1.5px solid #f59e0b;border-radius:2px;"></span>お客様候補日</span><span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;background:#dbeafe;border:1.5px solid #3b82f6;border-radius:2px;"></span>今日</span><span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;background:#eff6ff;border-left:2px solid #3b82f6;"></span>FP予定</span></div>';
        root.innerHTML = html;
      } catch (e) {
        root.innerHTML = `<div style="padding:24px;text-align:center;color:#dc2626;font-size:12px;">通信失敗: ${e.message}</div>`;
      }
    }
    document.getElementById('fp-cal-prev-v3').addEventListener('click', () => {
      const d = new Date(panel.dataset.weekStart + 'T00:00:00');
      d.setDate(d.getDate() - 7);
      panel.dataset.weekStart = fmtLocalDate(d);
      renderWeekView();
    });
    document.getElementById('fp-cal-next-v3').addEventListener('click', () => {
      const d = new Date(panel.dataset.weekStart + 'T00:00:00');
      d.setDate(d.getDate() + 7);
      panel.dataset.weekStart = fmtLocalDate(d);
      renderWeekView();
    });
    document.getElementById('fp-cal-today-v3').addEventListener('click', () => {
      const t = new Date(); t.setHours(0,0,0,0);
      const dow = t.getDay();
      const monOff = (dow === 0 ? -6 : 1 - dow);
      t.setDate(t.getDate() + monOff);
      panel.dataset.weekStart = fmtLocalDate(t);
      renderWeekView();
    });
    renderWeekView();

    // 顧客フォーカス枠を再描画 (1人ずつ集中モード)
    function renderFocusSection() {
      const section = document.getElementById('fp-cal-focus-section');
      if (!section) return;
      pendingByCustomer = buildPendingByCustomer();
      if (pendingByCustomer.length === 0) {
        section.innerHTML = `
          <div style="padding:24px 18px;text-align:center;background:linear-gradient(135deg,#ecfdf5,#fff);border-bottom:1px solid #d1fae5;">
            <div style="font-size:30px;margin-bottom:6px;">🎉</div>
            <div style="font-size:13px;font-weight:700;color:#065f46;">確定待ちのお客様はいません</div>
            <div style="font-size:11.5px;color:#6b7280;margin-top:4px;">アンケート + 候補日が届くとここに表示されます</div>
          </div>`;
        return;
      }
      if (currentIdx >= pendingByCustomer.length) currentIdx = pendingByCustomer.length - 1;
      if (currentIdx < 0) currentIdx = 0;
      const cur = pendingByCustomer[currentIdx];
      window._fpCalFocusUid = cur.userId;
      const meta = [cur.age, cur.family, cur.income].filter(Boolean).join(' / ') || '—';
      const initial = (cur.customerName || '?').replace(/\s+/g, '').slice(0, 1);
      const avatarHtml = cur.pictureUrl
        ? `<img src="${escapeHtml(cur.pictureUrl)}" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.15);">`
        : `<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.15);">${escapeHtml(initial)}</div>`;
      section.innerHTML = `
        <div style="padding:12px 14px;background:linear-gradient(135deg,#eef2ff,#fafaff);border-bottom:1px solid #c7d2fe;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <button id="fp-cal-prev" ${currentIdx === 0 ? 'disabled' : ''} style="padding:6px 10px;background:#fff;border:1px solid #c7d2fe;border-radius:6px;cursor:${currentIdx === 0 ? 'not-allowed' : 'pointer'};font-family:inherit;font-size:12px;font-weight:700;color:${currentIdx === 0 ? '#cbd5e1' : '#3730a3'};">← 前</button>
            <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:10px;min-width:0;">
              ${avatarHtml}
              <div style="text-align:left;min-width:0;">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#6366f1;text-transform:uppercase;">確定待ち ${currentIdx + 1} / ${pendingByCustomer.length} 人目</div>
                <div style="font-size:15px;font-weight:700;color:#1e1b4b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(cur.customerName)} 様</div>
              </div>
            </div>
            <button id="fp-cal-next" ${currentIdx >= pendingByCustomer.length - 1 ? 'disabled' : ''} style="padding:6px 10px;background:#fff;border:1px solid #c7d2fe;border-radius:6px;cursor:${currentIdx >= pendingByCustomer.length - 1 ? 'not-allowed' : 'pointer'};font-family:inherit;font-size:12px;font-weight:700;color:${currentIdx >= pendingByCustomer.length - 1 ? '#cbd5e1' : '#3730a3'};">次 →</button>
          </div>
          <div style="font-size:11px;color:#4b5563;line-height:1.5;">${escapeHtml(meta)}${cur.theme ? ' / テーマ: ' + escapeHtml(cur.theme) : ''}</div>
          ${cur.worry ? `<div style="margin-top:6px;padding:6px 9px;background:#fffbf2;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#5e4d1a;line-height:1.5;">💭 ${escapeHtml(cur.worry)}</div>` : ''}
          <div style="margin-top:8px;text-align:right;">
            <button id="fp-cal-reschedule" title="候補日3つとも合わない時 → 改めて候補日を依頼" style="font-size:10.5px;font-weight:700;padding:5px 10px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-family:inherit;">✕ 3つとも合わない → 再調整依頼</button>
          </div>
        </div>
        <div style="padding:10px 12px;background:#fef2f2;border-bottom:2px solid #fca5a5;">
          <div style="font-size:10.5px;color:#7f1d1d;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:6px;">🎯 この方の希望日 (タップでカレンダー移動 → ✓で確定)</div>
          <div id="fp-cand-chips" style="display:grid;gap:6px;">
            ${cur.candidates.map((c, i) => `
              <div data-cand-row="${i}" data-date="${escapeHtml(c.dateStr)}" data-slot="${escapeHtml(c.slotStr)}"
                style="padding:9px 12px;background:#fff;border:1.5px solid #fca5a5;border-radius:8px;font-family:inherit;display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;transition:all 0.15s;">
                <button class="fp-cand-jump" style="background:transparent;border:none;padding:0;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;font-family:inherit;">
                  <span style="font-size:9.5px;color:#b91c3c;font-weight:700;">第${c.rank}希望</span>
                  <span style="font-size:11.5px;font-weight:700;color:#1f2937;">${escapeHtml(c.dateStr.slice(5).replace('-','/'))} ${escapeHtml(c.slotStr)}</span>
                </button>
                <span class="fp-cand-status" data-status="loading" style="font-size:10px;color:#9ca3af;text-align:right;">⏳ 判定中</span>
                <button class="fp-cand-confirm" title="この日で予約確定" style="padding:6px 10px;background:linear-gradient(135deg,#06c755,#04a045);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;white-space:nowrap;">✓ 確定</button>
              </div>
            `).join('')}
          </div>
        </div>`;
      // ナビ
      const prevBtn = document.getElementById('fp-cal-prev');
      const nextBtn = document.getElementById('fp-cal-next');
      if (prevBtn) prevBtn.addEventListener('click', () => { if (currentIdx > 0) { currentIdx--; renderFocusSection(); jumpIframeTo(cur); } });
      if (nextBtn) nextBtn.addEventListener('click', () => { if (currentIdx < pendingByCustomer.length - 1) { currentIdx++; renderFocusSection(); jumpIframeTo(pendingByCustomer[currentIdx]); } });
      const reBtn = document.getElementById('fp-cal-reschedule');
      if (reBtn) reBtn.addEventListener('click', () => {
        showRescheduleTemplatePicker({ userId: cur.userId, customerName: cur.customerName });
      });
      bindCandidateRows();
    }
    function jumpIframeTo(customer) {
      if (!customer || !customer.candidates[0]) return;
      // 候補日の週へ ジャンプ (自前 週ビュー)
      const d = new Date(customer.candidates[0].dateStr + 'T00:00:00');
      const dow = d.getDay();
      const monOffset = (dow === 0 ? -6 : 1 - dow);
      d.setDate(d.getDate() + monOffset); d.setHours(0,0,0,0);
      panel.dataset.weekStart = fmtLocalDate(d);
      if (typeof renderWeekView === 'function') renderWeekView();
    }
    function bindCandidateRows() {
      const cur = pendingByCustomer[currentIdx];
      if (!cur) return;
      panel.querySelectorAll('[data-cand-row]').forEach((row) => {
        const dateStr = row.dataset.date;
        const slotStr = row.dataset.slot;
        const userId  = cur.userId;
        const name    = cur.customerName;
        // 日付タップ → iframe ジャンプ + ハイライト
        const jumpBtn = row.querySelector('.fp-cand-jump');
        jumpBtn.addEventListener('click', () => {
          // 候補日の週へ ジャンプ (自前 週ビュー)
          const d = new Date(dateStr + 'T00:00:00');
          const dow = d.getDay();
          const monOffset = (dow === 0 ? -6 : 1 - dow);
          d.setDate(d.getDate() + monOffset); d.setHours(0,0,0,0);
          panel.dataset.weekStart = fmtLocalDate(d);
          if (typeof renderWeekView === 'function') renderWeekView();
          panel.querySelectorAll('[data-cand-row]').forEach(c => { c.style.background = '#fff'; c.style.boxShadow = ''; });
          row.style.background = '#fef2f2';
          row.style.boxShadow = '0 0 0 3px #fca5a5';
        });
        // 確定 → Firestore 顧客 or /api/confirm-slot → 確定後は次の顧客へ自動移動
        const confirmBtn = row.querySelector('.fp-cand-confirm');
        confirmBtn.addEventListener('click', async () => {
          if (!confirm(`${name} 様 の予約を ${dateStr} ${slotStr} で確定します。\n\n• Zoom URL 自動発行\n• お客様の LINE に通知\n• Google カレンダーに登録\n\n進めますか?`)) return;
          confirmBtn.disabled = true;
          confirmBtn.textContent = '...';
          const isDemo = userId && userId.indexOf('Udemo') === 0;
          const fsCustomerId = cur._fsCustomerId; // Firestore (多テナント) 顧客 か?
          try {
            if (isDemo) {
              await new Promise(r => setTimeout(r, 800));
              alert('[デモモード] 確定処理完了 (本番では Zoom + LINE + カレンダー実行)');
              confirmBtn.textContent = '✓ 確定済';
              confirmBtn.style.background = '#94a3b8';
              return;
            }
            // ★ Firestore 多テナント 顧客 → confirmSlotMultiTenant Cloud Function
            if (fsCustomerId) {
              const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
              const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
              const app = getApps()[0] || initializeApp({
                apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
                authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
                projectId: 'skeleton-fp-compass-632026',
              });
              const fn = httpsCallable(getFunctions(app, 'asia-northeast1'), 'confirmSlotMultiTenant');
              const res = await fn({ customerId: fsCustomerId, confirmedSlot: `${dateStr} ${slotStr}` });
              const t = document.createElement('div');
              t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #06c755;border-radius:12px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:10003;font-family:inherit;';
              t.innerHTML = `<strong style="font-size:14px;">✅ ${escapeHtml(name)} 様 予約確定</strong><br><span style="font-size:12px;color:#6b7280;">${escapeHtml(dateStr)} ${escapeHtml(slotStr)} — Zoom + LINE 通知済</span><br><a href="${escapeHtml(res.data.googleCalendarAddUrl)}" target="_blank" style="display:inline-block;margin-top:8px;padding:8px 14px;background:#16A34A;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700;">📅 Google カレンダー に追加</a>`;
              document.body.appendChild(t);
              setTimeout(() => t.remove(), 12000);
              if (window.refreshFirestoreCustomers) await window.refreshFirestoreCustomers();
              pendingByCustomer = buildPendingByCustomer();
              window._fpCalFocusUid = (pendingByCustomer[currentIdx] && pendingByCustomer[currentIdx].userId) || null;
              renderFocusSection();
              if (pendingByCustomer[currentIdx]) jumpIframeTo(pendingByCustomer[currentIdx]);
              renderLeadHubInner();
              return;
            }
            // legacy proxy 顧客
            const r = await fetch(CLOUD_RUN_BASE + '/api/confirm-slot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, dateStr, slotStr, name }),
            });
            const data = await r.json();
            if (data.ok) {
              const t = document.createElement('div');
              t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border-left:5px solid #06c755;border-radius:12px;padding:14px 22px;box-shadow:0 12px 36px rgba(0,0,0,0.2);z-index:10003;font-family:inherit;';
              t.innerHTML = `<strong style="font-size:14px;">✅ ${escapeHtml(name)} 様 予約確定</strong><br><span style="font-size:12px;color:#6b7280;">${escapeHtml(dateStr)} ${escapeHtml(slotStr)} — Zoom + カレンダー + LINE 通知済み</span>`;
              document.body.appendChild(t);
              setTimeout(() => t.remove(), 6000);
              // データ再取得 → 次の顧客へ自動移動
              await fetchLiveData();
              pendingByCustomer = buildPendingByCustomer();
              // 現在の顧客は除外されてるはず → currentIdx は据え置き (次の顧客が同じ位置に来る)
              window._fpCalFocusUid = (pendingByCustomer[currentIdx] && pendingByCustomer[currentIdx].userId) || null;
              renderFocusSection();
              if (pendingByCustomer[currentIdx]) jumpIframeTo(pendingByCustomer[currentIdx]);
              renderLeadHubInner();
            } else {
              alert('失敗: ' + (data.error || '不明'));
              confirmBtn.textContent = '✓ 確定';
              confirmBtn.disabled = false;
            }
          } catch (e) {
            alert('失敗: ' + e.message);
            confirmBtn.textContent = '✓ 確定';
            confirmBtn.disabled = false;
          }
        });
        // 空き判定
        const statusEl = row.querySelector('.fp-cand-status');
        fetch(`${CLOUD_RUN_BASE}/api/check-slot?dateStr=${encodeURIComponent(dateStr)}&slotStr=${encodeURIComponent(slotStr)}`)
          .then(r => r.json())
          .then(data => {
            if (!statusEl) return;
            if (data.ok && data.busy) {
              statusEl.innerHTML = `🔴 予定あり<br><span style="font-size:9.5px;font-weight:400;">${escapeHtml(data.events.map(e => e.title).join(', ').slice(0, 24))}</span>`;
              statusEl.style.color = '#b91c3c'; statusEl.style.fontWeight = '700';
              row.style.borderColor = '#fca5a5';
              const cb = row.querySelector('.fp-cand-confirm');
              if (cb) cb.title = '⚠ FPの予定とかぶってます。本当に確定しますか?';
            } else if (data.ok && !data.busy) {
              statusEl.textContent = '🟢 空き';
              statusEl.style.color = '#166534'; statusEl.style.fontWeight = '700';
              row.style.borderColor = '#86efac';
            } else {
              statusEl.textContent = '⚠ 判定不可';
              statusEl.style.color = '#92400e';
            }
        })
        .catch(() => {
          if (statusEl) { statusEl.textContent = '⚠ 判定失敗'; statusEl.style.color = '#92400e'; }
        });
      });
    }
    // 顧客フォーカス API (左パネルの「この方をカレンダーで見る」用)
    window.fpFocusCustomerInCalendar = function(userId) {
      pendingByCustomer = buildPendingByCustomer();
      const idx = pendingByCustomer.findIndex(p => p.userId === userId);
      if (idx >= 0) {
        currentIdx = idx;
        renderFocusSection();
        if (pendingByCustomer[currentIdx]) jumpIframeTo(pendingByCustomer[currentIdx]);
      }
    };
    renderFocusSection();

    // ★ 自前 週ビュー化により iframe フォールバック helper は撤去

    // リサイズ
    const handle = document.getElementById('fp-cal-resize-v3');
    handle.addEventListener('mouseenter', () => { handle.style.background = 'rgba(184,137,61,0.4)'; });
    handle.addEventListener('mouseleave', () => { handle.style.background = 'transparent'; });
    let dragging = false;
    handle.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); document.body.style.userSelect = 'none'; });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = Math.max(320, Math.min(window.innerWidth - 360, window.innerWidth - e.clientX));
      panel.style.width = w + 'px';
      document.body.style.paddingRight = w + 'px';
      localStorage.setItem('fp-cal-side-width', String(w));
    });
    document.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.userSelect = ''; } });
  }

  function ensureCalendarSidePanel() { /* 後方互換ダミー */ }

  // ===== メモ → タスク自動抽出 (ブラウザウィンドウ風: ヘッダードラッグ移動 + 縁リサイズ) =====
  function openMemoModal(booking, bookingTs) {
    const name = (booking && booking.name) || 'お客様';
    const memoKey = 'fp-memo-' + (bookingTs || '');
    const existingMemo = localStorage.getItem(memoKey) || '';

    // 前回の位置・サイズを復元
    const savedPos = JSON.parse(localStorage.getItem('fp-memo-pos') || '{}');
    const savedSize = JSON.parse(localStorage.getItem('fp-memo-size') || '{}');
    // 録画中の「画面左1/4固定」 モード — CRMサイズに関わらず screen を基準にする
    const fullscreenMode = localStorage.getItem('fp-memo-fullscreen') === '1';
    let w, h, left, top;
    if (fullscreenMode) {
      const sw = window.screen.availWidth || screen.width;
      const sh = window.screen.availHeight || screen.height;
      w = Math.floor(sw / 4);
      h = sh;
      left = 0;
      top = 0;
    } else {
      w = savedSize.w || 520;
      h = savedSize.h || Math.min(640, window.innerHeight - 100);
      left = (savedPos.left != null) ? savedPos.left : Math.max(40, window.innerWidth - w - 40);
      top = (savedPos.top != null) ? savedPos.top : 80;
    }

    // 既存パネルがあれば閉じる
    const old = document.getElementById('fp-memo-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'fp-memo-panel';
    panel.style.cssText = `position:fixed;top:${top}px;left:${left}px;width:${w}px;height:${h}px;z-index:9998;background:#fff;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,0.18);border:1px solid #e5e7eb;display:flex;flex-direction:column;overflow:hidden;min-width:340px;min-height:280px;`;

    panel.innerHTML = `
      <div id="fp-memo-titlebar" style="padding:12px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,#fafbfc,#f1f5f9);cursor:grab;user-select:none;">
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="width:11px;height:11px;border-radius:50%;background:#ff5f57;"></span>
          <span style="width:11px;height:11px;border-radius:50%;background:#febc2e;"></span>
          <span style="width:11px;height:11px;border-radius:50%;background:#28c840;"></span>
        </div>
        <div style="flex:1;min-width:0;text-align:center;">
          <strong style="font-size:13px;font-family:'Noto Sans JP',sans-serif;">📝 面談メモ — ${escapeHtml(name)}様</strong>
        </div>
        <button id="fp-memo-close" title="閉じる" style="font-size:13px;width:26px;height:24px;background:#fff;border:1px solid #e5e7eb;border-radius:5px;cursor:pointer;color:#6b7280;font-family:inherit;">✕</button>
      </div>
      <div style="padding:14px 18px;overflow-y:auto;flex:1;">
        <div style="background:#fffbf2;border:1px solid #f0d36b;border-radius:8px;padding:9px 13px;margin-bottom:12px;font-size:11px;color:#5e4d1a;line-height:1.5;">
          <strong>書き方のコツ:</strong> 「○月○日までに XXする」「来週 △△を送る」「3ヶ月後に □□確認」
        </div>
        <textarea id="fp-memo-text" placeholder="例:&#10;・新NISAの最適配分シミュレーション資料を 来週中に送る&#10;・教育費見直し 3ヶ月後に再面談&#10;・iDeCo加入手続きの進捗を 2ヶ月後に確認" style="width:100%;min-height:180px;padding:13px 15px;border:1.5px solid #e5e7eb;border-radius:9px;font-size:13px;font-family:'Noto Sans JP',sans-serif;line-height:1.7;resize:vertical;box-sizing:border-box;">${escapeHtml(existingMemo)}</textarea>
        <div id="fp-memo-tasks" style="margin-top:14px;display:none;"></div>
      </div>
      <div style="padding:11px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;background:#fafbfc;">
        <button id="fp-memo-save" style="font-size:13px;padding:9px 22px;background:linear-gradient(135deg,#b8893d,#d4a017);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;">💡 保存して タスク自動抽出</button>
      </div>
      <!-- 四方リサイズハンドル -->
      <div data-resize="e"  style="position:absolute;top:8px;right:0;bottom:8px;width:6px;cursor:ew-resize;"></div>
      <div data-resize="w"  style="position:absolute;top:8px;left:0;bottom:8px;width:6px;cursor:ew-resize;"></div>
      <div data-resize="s"  style="position:absolute;left:8px;right:8px;bottom:0;height:6px;cursor:ns-resize;"></div>
      <div data-resize="n"  style="position:absolute;left:8px;right:8px;top:0;height:6px;cursor:ns-resize;"></div>
      <div data-resize="se" style="position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(184,137,61,0.5) 50%);"></div>
      <div data-resize="sw" style="position:absolute;left:0;bottom:0;width:14px;height:14px;cursor:nesw-resize;"></div>
      <div data-resize="ne" style="position:absolute;right:0;top:0;width:14px;height:14px;cursor:nesw-resize;"></div>
      <div data-resize="nw" style="position:absolute;left:0;top:0;width:14px;height:14px;cursor:nwse-resize;"></div>
    `;
    document.body.appendChild(panel);

    // 入力中も自動で保存 (×で消失しないように)
    let autoSaveTimer = null;
    document.getElementById('fp-memo-text').addEventListener('input', (e) => {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        try { localStorage.setItem(memoKey, e.target.value); } catch (_) {}
      }, 300);
    });
    document.getElementById('fp-memo-close').addEventListener('click', () => {
      // 最後の保存
      try { localStorage.setItem(memoKey, document.getElementById('fp-memo-text').value); } catch (_) {}
      panel.remove();
    });
    document.getElementById('fp-memo-save').addEventListener('click', () => {
      const memo = document.getElementById('fp-memo-text').value;
      localStorage.setItem(memoKey, memo);
      const tasks = extractTasksFromMemo(memo, booking);
      const tasksKey = 'fp-tasks-' + ((booking && booking.userId) || bookingTs);
      const existing = JSON.parse(localStorage.getItem(tasksKey) || '[]');
      const merged = existing.concat(tasks.map(t => ({ ...t, createdAt: new Date().toISOString(), customerName: name, bookingTs: bookingTs })));
      localStorage.setItem(tasksKey, JSON.stringify(merged));
      renderExtractedTasks(tasks);
    });

    setupWindowDragAndResize(panel);
  }

  function setupWindowDragAndResize(panel) {
    const bar = panel.querySelector('#fp-memo-titlebar');
    // タイトルバードラッグ → 移動
    let dragging = false, sx = 0, sy = 0, sLeft = 0, sTop = 0;
    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect();
      sLeft = r.left; sTop = r.top;
      bar.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    const onMove = (e) => {
      if (dragging) {
        const nl = Math.max(0, Math.min(window.innerWidth - 240, sLeft + (e.clientX - sx)));
        const nt = Math.max(0, Math.min(window.innerHeight - 60, sTop + (e.clientY - sy)));
        panel.style.left = nl + 'px';
        panel.style.top = nt + 'px';
        localStorage.setItem('fp-memo-pos', JSON.stringify({ left: nl, top: nt }));
      }
      if (resizing) {
        const r = panel.getBoundingClientRect();
        let nl = r.left, nt = r.top, nw = r.width, nh = r.height;
        if (resizing.includes('e')) nw = Math.max(340, e.clientX - r.left);
        if (resizing.includes('w')) { nw = Math.max(340, r.right - e.clientX); nl = e.clientX; }
        if (resizing.includes('s')) nh = Math.max(280, e.clientY - r.top);
        if (resizing.includes('n')) { nh = Math.max(280, r.bottom - e.clientY); nt = e.clientY; }
        panel.style.width = nw + 'px';
        panel.style.height = nh + 'px';
        if (resizing.includes('w')) panel.style.left = nl + 'px';
        if (resizing.includes('n')) panel.style.top = nt + 'px';
        localStorage.setItem('fp-memo-size', JSON.stringify({ w: nw, h: nh }));
        localStorage.setItem('fp-memo-pos', JSON.stringify({ left: nl, top: nt }));
      }
    };
    const onUp = () => {
      if (dragging) { dragging = false; bar.style.cursor = 'grab'; document.body.style.userSelect = ''; }
      if (resizing) { resizing = null; document.body.style.userSelect = ''; }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    // 縁/隅リサイズ
    let resizing = null;
    panel.querySelectorAll('[data-resize]').forEach(h => {
      h.addEventListener('mousedown', (e) => {
        resizing = h.dataset.resize;
        document.body.style.userSelect = 'none';
        e.preventDefault(); e.stopPropagation();
      });
    });
  }



  // 自然言語メモ → タスク配列に変換 (ルールベース、外部API不要)
  function extractTasksFromMemo(memo, booking) {
    if (!memo || !memo.trim()) return [];
    const baseDate = (booking && booking.date) ? new Date(booking.date) : new Date('2026-05-28');
    // 行ごとに走査 (・- や改行で区切る)
    const lines = memo.split(/\n|・|・|✓|☐|□|■/).map(s => s.trim()).filter(s => s.length > 3);
    return lines.map(line => parseTaskLine(line, baseDate)).filter(t => t);
  }

  function parseTaskLine(line, baseDate) {
    if (!line) return null;
    // 期限を推定
    let due = null;
    let priorityLabel = '来月';
    const today = baseDate;

    // 絶対日付パターン: "○月○日", "2026/7/15", "7月末"
    let m = line.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const mo = parseInt(m[1], 10);
      const dd = parseInt(m[2], 10);
      const year = today.getFullYear() + (mo < today.getMonth() + 1 ? 1 : 0);
      due = new Date(year, mo - 1, dd);
    }
    if (!due) {
      m = line.match(/(\d{1,2})月末/);
      if (m) {
        const mo = parseInt(m[1], 10);
        const year = today.getFullYear() + (mo < today.getMonth() + 1 ? 1 : 0);
        due = new Date(year, mo, 0); // 月末
      }
    }
    if (!due && line.match(/今週中|今週/)) {
      due = addDays(today, 7);
      priorityLabel = '今週';
    }
    if (!due && line.match(/来週/)) {
      due = addDays(today, 14);
      priorityLabel = '今週';
    }
    if (!due && line.match(/3ヶ月後|3ヵ月後|三ヶ月後/)) {
      due = addMonths(today, 3);
      priorityLabel = '3ヶ月後';
    }
    if (!due && line.match(/2ヶ月後|2ヵ月後|二ヶ月後/)) {
      due = addMonths(today, 2);
      priorityLabel = '2ヶ月後';
    }
    if (!due && line.match(/半年後|6ヶ月後/)) {
      due = addMonths(today, 6);
      priorityLabel = '半年後';
    }
    if (!due && line.match(/1年後|来年/)) {
      due = addMonths(today, 12);
      priorityLabel = '来年';
    }
    if (!due && line.match(/明日|翌日/)) {
      due = addDays(today, 1);
      priorityLabel = '至急';
    }
    if (!due && line.match(/急ぎ|至急|今日中/)) {
      due = today;
      priorityLabel = '至急';
    }
    // 期限なし → 来月扱い
    if (!due) {
      due = addMonths(today, 1);
      priorityLabel = '来月';
    }
    // タスクの動詞抽出 → アイコン
    let icon = '✅', recommendedAction = '', actionTemplate = '';
    if (line.match(/送(る|付|る)|送信/)) {
      icon = '📤';
      recommendedAction = '資料添付付きで LINE 送信';
      actionTemplate = 'お疲れ様です。先日お話した件、資料お送りします。ご確認の上、ご不明点あればお気軽にどうぞ。';
    } else if (line.match(/確認/)) {
      icon = '👀';
      recommendedAction = '進捗確認の LINE を送信';
      actionTemplate = 'お疲れ様です。その後いかがでしょうか?進捗ご確認させてください。';
    } else if (line.match(/電話|TEL|連絡/)) {
      icon = '📞';
      recommendedAction = '電話 → ボイスメモ要約をCRMに保存';
      actionTemplate = '';
    } else if (line.match(/資料|PDF|レポート/)) {
      icon = '📄';
      recommendedAction = '資料作成 → PDF添付で LINE 送信';
      actionTemplate = 'お疲れ様です。ご依頼の資料お送りします。ご確認お願いします。';
    } else if (line.match(/面談|相談|ZOOM|Zoom/)) {
      icon = '💻';
      recommendedAction = '次回面談の候補日3つを LINE で打診';
      actionTemplate = 'お疲れ様です。次回 Zoom 面談のご候補日3つお送りします。ご都合の良い日をお選びください。';
    } else if (line.match(/シミュ|シミュレーション/)) {
      icon = '📊';
      recommendedAction = 'シミュレーション資料作成 → 共有';
      actionTemplate = 'お疲れ様です。シミュレーション結果まとめましたのでご確認ください。';
    } else {
      recommendedAction = 'LINE で進捗のヒアリング';
      actionTemplate = 'お疲れ様です。その後いかがでしょうか?お話進められたら嬉しいです。';
    }

    // 優先度の色分け
    const daysToDue = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    if (daysToDue <= 7) priorityLabel = '今週';
    else if (daysToDue <= 14) priorityLabel = '2週間以内';
    else if (daysToDue <= 30) priorityLabel = '来月';
    else if (daysToDue <= 90) priorityLabel = '3ヶ月以内';
    else priorityLabel = '半年以降';

    return {
      task: line.trim(),
      due: formatDate(due),
      priority: priorityLabel,
      icon: icon,
      recommendedAction: recommendedAction,
      actionTemplate: actionTemplate,
    };
  }

  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
  function formatDate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return `${y}/${m}/${dd}(${wd})`;
  }

  function renderExtractedTasks(tasks) {
    const target = document.getElementById('fp-memo-tasks');
    if (!target) return;
    target.style.display = 'block';
    if (tasks.length === 0) {
      target.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;font-size:12.5px;color:#991b1b;">タスクを抽出できませんでした。期限と動作を含む文章を書いてください。</div>`;
      return;
    }
    target.innerHTML = `
      <div style="background:linear-gradient(135deg,#fff8e1,#fffbf2);border:1px solid #f0d36b;border-radius:10px;padding:14px 18px;margin-bottom:12px;">
        <strong style="font-size:13px;color:#5e4d1a;">✨ ${tasks.length}件のタスクを抽出 → 顧客カードに保存しました</strong>
      </div>
      <div style="display:grid;gap:7px;">
        ${tasks.map(t => `
          <div style="display:grid;grid-template-columns:90px 32px 1fr 130px;gap:12px;align-items:center;padding:11px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
            <span style="font-size:10.5px;font-weight:700;letter-spacing:0.05em;background:${t.priority==='至急'?'#fef2f2;color:#b91c3c':(t.priority==='今週'||t.priority==='2週間以内')?'#fff7ed;color:#c2410c':'#f0f9ff;color:#075985'};padding:4px 9px;border-radius:11px;text-align:center;">${t.priority}</span>
            <span style="font-size:18px;">${t.icon}</span>
            <span style="font-size:13px;">${escapeHtml(t.task)}</span>
            <span style="font-size:11px;color:#6b7280;text-align:right;">${t.due}</span>
          </div>`).join('')}
      </div>`;
  }

  function _UNUSED_showAIProcessingModal(booking, survey, blob, blobUrl, bookingTs) {
    const overlay = document.createElement('div');
    overlay.id = 'fp-ai-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.65);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;width:min(780px,100%);max-height:92vh;overflow-y:auto;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.35);">
        <div style="padding:28px 32px 0;">
          <h2 style="margin:0 0 4px;font-family:'Noto Serif JP',serif;font-size:22px;font-weight:700;">✨ AI議事録生成</h2>
          <p style="margin:0;color:#6b7280;font-size:12.5px;">録画ファイルをWhisperで文字起こし → Claudeで要約 → 顧客データへ自動書込</p>
        </div>
        <div id="fp-ai-body" style="padding:24px 32px 32px;"></div>
      </div>`;
    document.body.appendChild(overlay);

    const body = document.getElementById('fp-ai-body');
    const fileSize = (blob.size / 1024 / 1024).toFixed(1);
    const stages = [
      { icon: '📁', label: '録画ファイル保存', detail: fileSize + 'MB の WebM → Drive アップロード', dur: 800 },
      { icon: '🎙', label: 'Whisperで音声文字起こし', detail: '日本語認識・話者分離', dur: 1400 },
      { icon: '🧠', label: 'Claudeで要約生成', detail: '会話のポイント・お客様の関心・宿題を抽出', dur: 1600 },
      { icon: '🏷', label: '次アクション タグ付け', detail: '提案項目・優先度・最適なフォロータイミング判定', dur: 1000 },
      { icon: '✍', label: '顧客カードに自動書込', detail: 'CRMにメモ追記 / Googleカレンダーにフォロー予定登録', dur: 1000 },
    ];

    let html = '<div style="display:grid;gap:14px;">';
    stages.forEach((st, i) => {
      html += `<div id="fp-stage-${i}" style="display:grid;grid-template-columns:32px 1fr 24px;gap:12px;align-items:center;padding:12px 16px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;opacity:0.45;transition:all 0.3s;">
        <div style="font-size:20px;">${st.icon}</div>
        <div><strong style="font-size:13.5px;">${st.label}</strong><div style="font-size:11.5px;color:#6b7280;margin-top:1px;">${st.detail}</div></div>
        <div class="fp-stage-icon" style="font-size:14px;color:#94a3b8;">○</div>
      </div>`;
    });
    html += '</div>';
    body.innerHTML = html;

    // ステージを順次アクティブ化
    let cumulative = 0;
    stages.forEach((st, i) => {
      cumulative += st.dur;
      setTimeout(() => {
        const el = document.getElementById('fp-stage-' + i);
        if (el) {
          el.style.opacity = '1';
          el.style.background = '#fff';
          el.style.borderColor = 'var(--gold,#c19a3a)';
          const icon = el.querySelector('.fp-stage-icon');
          if (icon) { icon.textContent = '⏳'; icon.style.color = 'var(--gold,#c19a3a)'; }
          // 前のステージは完了マーク
          if (i > 0) {
            const prev = document.getElementById('fp-stage-' + (i - 1));
            if (prev) {
              const prevIcon = prev.querySelector('.fp-stage-icon');
              if (prevIcon) { prevIcon.textContent = '✓'; prevIcon.style.color = 'var(--green,#06c755)'; prevIcon.style.fontWeight = '700'; }
            }
          }
        }
      }, cumulative - st.dur + 100);
    });

    // 全ステージ完了 → 結果表示
    setTimeout(async () => {
      // 最終ステージも✓に
      const last = document.getElementById('fp-stage-' + (stages.length - 1));
      if (last) {
        const ic = last.querySelector('.fp-stage-icon');
        if (ic) { ic.textContent = '✓'; ic.style.color = 'var(--green,#06c755)'; ic.style.fontWeight = '700'; }
      }
      // サーバーにも反映
      fetch(CLOUD_RUN_BASE + '/api/recording/stop?ts=' + encodeURIComponent(bookingTs), { method: 'POST' }).catch(() => {});
      await new Promise(r => setTimeout(r, 600));
      renderAIResult(booking, survey, blob, blobUrl, bookingTs);
    }, cumulative + 300);
  }

  function _UNUSED_renderAIResult(booking, survey, blob, blobUrl, bookingTs) {
    const body = document.getElementById('fp-ai-body');
    if (!body) return;
    const name = (booking && booking.name) || 'お客様';
    const theme = (survey && survey.q1_テーマ) || '老後資金';
    const era = (survey && survey.q2_年代) || '40代';
    const family = (survey && survey.q3_家族) || '夫婦+子供';
    const income = (survey && survey.q4_年収) || '700〜1000万';
    const concern = (survey && survey.q5_悩み) || 'NISAの活用方法と老後資金の不足';

    // デモ用議事録テンプレ (アンケート回答から自然な会話風に組み立て)
    const transcript = `■ 面談日時: ${(booking && booking.date) || '2026-06-12'} ${(booking && booking.time) || '14:00'}
■ お客様: ${name}様 (${era} / ${family} / 年収${income})
■ 相談テーマ: ${theme}

【会話サマリー】
お客様は「${concern}」というお悩みを抱えていらっしゃる。
特に「子供の教育費と老後資金の同時準備」に強い不安を感じている様子。
現在の家計簿を共有いただき、月の貯蓄余力は約8〜10万円と確認。

【お客様の関心が高かった項目】
・新NISA つみたて投資枠 (年120万) の効率的な活用
・iDeCo との併用パターン (節税効果)
・教育資金の最適配分 (学資保険 vs ジュニアNISA代替)

【FP側の所見】
${family} ${era}層は「教育費ピーク (子18歳) と退職金準備が重なる」典型パターン。
ライフプラン表を作成して可視化することで、お客様の納得感が一気に高まった。
ご自身でも「想像していたより全体像が見えた」とコメントあり。`;

    const actions = [
      { priority: '至急', task: 'ライフプラン表PDFを作成して送付', when: '7日以内', icon: '📄' },
      { priority: '今週', task: '新NISAつみたて枠の最適配分シミュレーション資料を提示', when: '次回までに準備', icon: '📊' },
      { priority: '来月', task: '教育費見直しの定期レビュー (子供誕生月)', when: '2026年6月末', icon: '🎓' },
      { priority: '3ヶ月後', task: 'iDeCo加入手続き進捗の確認', when: '2026年8月28日', icon: '🏦' },
      { priority: '半年後', task: 'NISA運用状況のレビュー面談', when: '2026年11月28日', icon: '📅' },
    ];

    body.innerHTML = `
      <div style="background:linear-gradient(135deg,#fff8e1,#fffbf2);border:1px solid #f0d36b;border-radius:12px;padding:16px 20px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">
        <div style="font-size:28px;">✨</div>
        <div>
          <strong style="font-size:15px;color:#5e4d1a;">AI処理完了</strong>
          <div style="font-size:12px;color:#8a6f1e;margin-top:2px;">議事録 / 次アクション5件 / フォローアップ予定3件 を自動生成しました</div>
        </div>
      </div>

      <h3 style="margin:0 0 8px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:700;">📝 議事録</h3>
      <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:18px;font-size:12.5px;line-height:1.75;font-family:'Noto Sans JP',sans-serif;margin:0 0 20px;max-height:280px;overflow-y:auto;">${escapeHtml(transcript)}</pre>

      <h3 style="margin:0 0 8px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:700;">🏷 次アクション + フォローアップ自動スケジュール</h3>
      <div style="display:grid;gap:8px;margin-bottom:20px;">
        ${actions.map(a => `
          <div style="display:grid;grid-template-columns:80px 32px 1fr 130px;gap:12px;align-items:center;padding:11px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
            <span style="font-size:10.5px;font-weight:700;letter-spacing:0.05em;background:${a.priority==='至急'?'#fef2f2;color:#b91c3c':a.priority==='今週'?'#fff7ed;color:#c2410c':'#f0f9ff;color:#075985'};padding:4px 9px;border-radius:11px;text-align:center;">${a.priority}</span>
            <span style="font-size:18px;">${a.icon}</span>
            <span style="font-size:13px;">${a.task}</span>
            <span style="font-size:11px;color:#6b7280;text-align:right;">${a.when}</span>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding-top:16px;border-top:1px solid #e5e7eb;">
        <a href="${blobUrl}" download="meeting-${(booking && booking.name) || 'recording'}-${Date.now()}.webm" style="font-size:12.5px;padding:9px 18px;border:1px solid #e5e7eb;border-radius:8px;color:#374151;text-decoration:none;font-weight:600;">💾 録画ファイル DL (${(blob.size/1024/1024).toFixed(1)}MB)</a>
        <button id="fp-ai-copy" style="font-size:12.5px;padding:9px 18px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;font-weight:600;color:#374151;">📋 議事録コピー</button>
        <button id="fp-ai-close" style="font-size:13px;padding:9px 22px;background:linear-gradient(135deg,#b8893d,#d4a017);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;">✓ 顧客カードに保存して閉じる</button>
      </div>
    `;

    document.getElementById('fp-ai-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(transcript).then(() => alert('議事録をコピーしました'));
    });
    document.getElementById('fp-ai-close').addEventListener('click', async () => {
      // GAS にも議事録を保存依頼
      try { await fetch(CLOUD_RUN_BASE + '/api/transcript?ts=' + encodeURIComponent(bookingTs), { method: 'POST' }); } catch (_) {}
      document.getElementById('fp-ai-overlay').remove();
      await fetchLiveData();
      renderLeadHubInner();
    });
  }

  function bindBookingsButtons() {
    document.querySelectorAll('[data-rec-start]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ts = btn.dataset.recStart;
        const zoomUrl = btn.dataset.zoom;
        if (btn.dataset.recMode === 'inperson') {
            await startWebcamRecording(ts);
            await fetchLiveData();
            renderLeadHubInner();
            return;
          }
        // ★ オーナーfb (v AH): Zoom pre-open popup が画面共有ダイアログを覆ってた。
        // 修正: pre-open は 画面外/極小 で 開いて 即 blur + CRM focus 戻し。 ユーザには見えないように。
        const sw = window.screen.availWidth || screen.width;
        const sh = window.screen.availHeight || screen.height;
        // 極小+画面外: 200x100 を screen の右下 さらに先 (見えない位置)
        const preZoomFeatures = `popup=yes,width=200,height=100,left=${sw - 1},top=${sh - 1},toolbar=no,location=no,menubar=no,status=no,scrollbars=no,resizable=yes`;
        const preZoomWin = window.open('about:blank', 'fp-zoom-win', preZoomFeatures);
        if (preZoomWin) {
          try {
            preZoomWin.document.title = 'Zoom 準備中...';
            preZoomWin.document.body.innerHTML = '<div style="font-family:sans-serif;padding:10px;background:#0F172A;color:#fff;font-size:11px;text-align:center;">⏳ 準備中</div>';
            // 即 blur → CRM focus 戻し
            preZoomWin.blur();
          } catch (_) {}
        }
        try { window.focus(); window.opener?.focus?.(); document.body.click(); } catch (_) {}
        // 確実に CRM が前面に来てから getDisplayMedia 走らせる (microtask 一発噛ます)
        await new Promise(r => setTimeout(r, 50));
        try { window.focus(); } catch (_) {}
        console.log('[layout] pre-open zoom (極小+画面外) + CRM focus 戻し済');
        await startScreenRecording(ts, zoomUrl, { preZoomWin });
        await fetchLiveData();
        renderLeadHubInner();
      });
    });
    document.querySelectorAll('[data-rec-stop]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window._fpRecorder.mediaRecorder && window._fpRecorder.mediaRecorder.state !== 'inactive') {
          if (!confirm('録画を停止して保存しますか?')) return;
          stopScreenRecording();
        } else {
          alert('進行中の録画がありません');
        }
      });
    });
    document.querySelectorAll('[data-open-memo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ts = btn.dataset.openMemo;
        const b = ((liveData && liveData.bookings) || []).find(x => String(x.ts).slice(0,19) === decodeURIComponent(ts).slice(0,19));
        openMemoModal(b || { name: 'お客様', userId: ts, date: new Date().toISOString().slice(0,10) }, ts);
      });
    });
    // ✕ キャンセル → テンプレ選択モーダル
    document.querySelectorAll('.fp-cancel-booking').forEach(btn => {
      btn.addEventListener('click', () => {
        const tsEnc = btn.dataset.cancelTs;
        const ts = decodeURIComponent(tsEnc);
        const b = ((liveData && liveData.bookings) || []).find(x => String(x.ts).slice(0,19) === ts.slice(0,19));
        if (!b) { alert('予約が見つかりません'); return; }
        showCancelTemplatePicker(b);
      });
    });
    document.querySelectorAll('[data-complete-booking]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tsEnc = btn.dataset.completeBooking;
        const ts = decodeURIComponent(tsEnc);
        // ★ multi-tenant Firestore 顧客 も lookup 対象に (legacy のみ だと 「お」 で alert 失敗)
        const fsAsBookings = (window._fpFirestoreConfirmed || []).map(c => ({
          _fsCustomerId: c.docId,
          userId: 'fs:' + c.docId,
          name: c.name,
          date: String(c.confirmedSlot || '').split(' ')[0] || '',
          time: String(c.confirmedSlot || '').split(' ')[1] || '',
          zoomUrl: c.zoomUrl,
          ts: c.confirmedAt?.toDate?.()?.toISOString?.() || '',
        }));
        const b = (((liveData && liveData.bookings) || []).concat(fsAsBookings))
          .find(x => String(x.ts).slice(0,19) === ts.slice(0,19));
        if (!b) { alert('予約が見つかりません'); return; }
        if (!confirm(`「${b.name||'お客様'}様」の面談を完了扱いにして顧客台帳に反映しますか?\n(取り消しは「アーカイブを見る → 戻す」から可能)`)) return;
        const set = new Set(JSON.parse(localStorage.getItem('fp-booking-archived') || '[]'));
        set.add(b.ts);
        localStorage.setItem('fp-booking-archived', JSON.stringify([...set]));
        // 顧客の lastContact を面談日に更新 (お客様マッチ)
        let matched = null;
        let createdNew = false;
        if (window.DUMMY_CLIENTS) {
          matched = window.DUMMY_CLIENTS.find(x => x.lineFriendId === b.userId || x.name === b.name);
          if (matched) {
            matched.lastContact = String(b.date).slice(0, 10);
          } else {
            // 既存顧客にいなければ新規追加
            const newId = 'c' + String(Date.now()).slice(-5);
            matched = {
              id: newId,
              name: b.name || 'お客様',
              kana: '',
              birth: '', // ★ 空にする (旧: '1985-01-01' 全員41歳になる元凶)
              gender: 'O',
              occupation: '',
              family: [],
              source: 'LINE無料相談',
              status: 'new',
              aum: 0,
              lastContact: String(b.date).slice(0, 10),
              proposals: [],
              note: `LINE経由で初回面談 (${String(b.date).slice(0,10)})\nuserId: ${b.userId || ''}`,
              lineFriendId: b.userId || '',
              lineSubscribed: true,
            };
            window.DUMMY_CLIENTS.push(matched);
            createdNew = true;
          }
          try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS)); } catch (_) {}
        }
        fillBookingsList();
        // 顧客台帳の再描画 (app.js から expose されたフック)
        if (window.FPCrmRefreshClients) window.FPCrmRefreshClients();
        // 反映結果を分かりやすく表示
        showCompletionToast(b, matched, createdNew);
      });
    });
  }

  // ============================
  // 📨 配信管理ハブ (ダッシュ + スケジュール + テンプレ + ログ を縦に)
  // ============================
  function renderDistributionHub() {
    const v = document.querySelector('[data-line-view="distributionHub"]');
    const cur = window._fpDistSubtab || 'today';  // today / schedules / templates / log
    const tab = (k, ic, label) => `
      <button data-dist-subtab="${k}" style="background:${cur===k?'#0F172A':'#fff'};color:${cur===k?'#fff':'#475569'};border:2px solid ${cur===k?'#0F172A':'#E2E8F0'};padding:14px 22px;border-radius:11px;font-family:'Noto Sans JP',sans-serif;font-weight:800;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all .12s;min-height:54px;letter-spacing:-0.005em;">
        <span style="font-size:18px;">${ic}</span>${label}
      </button>`;
    v.innerHTML = `
      <!-- ★ 役割明示バナー: 「配信」 と 「ご無沙汰フォロー」 の混同防止 -->
      <div style="background:linear-gradient(135deg,#EFF6FF,#F5F3FF);border:1px solid #BFDBFE;border-radius:12px;padding:18px 22px;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="background:#1D4ED8;color:#fff;font-size:10px;font-weight:800;letter-spacing:0.12em;padding:3px 9px;border-radius:4px;">配信タブ — BROADCAST</span>
          <span style="font-size:12px;color:#64748B;">= テンプレで <strong style="color:#1D4ED8;">複数人に一斉送信</strong> (キャンペーン/お知らせ/季節企画)</span>
        </div>
        <div style="font-size:12px;color:#64748B;line-height:1.7;">
          1対1で個別追客したい時は → <a href="#" onclick="document.querySelector('.tab[data-tab=&quot;dormantFollowup&quot;]')?.click();return false;" style="color:#7C2D12;font-weight:700;text-decoration:underline;">ご無沙汰フォロー</a> （最終接触から日数が経った客を順番に1人ずつ）
        </div>
      </div>
      <!-- サブタブ: 今日 / スケジュール / テンプレ / ログ — 一発目は「今日」 -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
        ${tab('today', '📤', '今日 送る')}
        ${tab('schedules', '⏰', '予定')}
        ${tab('templates', '💬', 'テンプレ')}
        ${tab('log', '📋', '送信ログ')}
      </div>
      <section data-dist-pane="today" ${cur==='today'?'':'hidden'}>
        <div data-line-view="dashboard"></div>
      </section>
      <section data-dist-pane="schedules" ${cur==='schedules'?'':'hidden'}>
        <div data-line-view="schedules"></div>
      </section>
      <section data-dist-pane="templates" ${cur==='templates'?'':'hidden'}>
        <div data-line-view="templates"></div>
      </section>
      <section data-dist-pane="log" ${cur==='log'?'':'hidden'}>
        <div data-line-view="log"></div>
      </section>
    `;
    // ★ 一発目に重い 4 render 全部 走らせない: 現在の サブタブ だけ render
    if (cur === 'today') renderLineDashboard();
    else if (cur === 'schedules') renderSchedules();
    else if (cur === 'templates') renderTemplates();
    else if (cur === 'log') renderLog();
    // サブタブ click
    v.querySelectorAll('[data-dist-subtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        window._fpDistSubtab = btn.dataset.distSubtab;
        renderDistributionHub();
      });
    });
  }

  // ============================
  // 🎁 イベント配信ハブ (誕生日 + 年末カレンダー)
  // ============================
  function renderEventsHub() {
    const v = document.querySelector('[data-line-view="eventsHub"]');
    v.innerHTML = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">🎁 イベント配信</span>
          <span class="howto-banner-subtitle">記念日や季節企画のお客様タッチポイント</span>
        </div>
        <div class="howto-steps">
          <div class="howto-step"><div class="howto-step-no">1</div><div><strong>誕生日リスト</strong> — 本人・配偶者・お子様の誕生日を90日先まで自動検出して当日朝9時にお祝いLINE送信</div></div>
          <div class="howto-step"><div class="howto-step-no">2</div><div><strong>年末カレンダー配布</strong> — 12月にカレンダーを配るFP向け / LINE一斉配信 → 要不要 → 住所収集 → Google地図でルート最適化</div></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;font-size:11.5px;">
        <a href="#evt-birthdays" class="quick-jump">🎂 誕生日</a>
        <a href="#evt-calendar" class="quick-jump">🎍 年末カレンダー</a>
      </div>
      <section id="evt-birthdays">
        <h2 class="hub-section-title">🎂 誕生日リスト (90日)</h2>
        <div data-line-view="birthdays"></div>
      </section>
      <section id="evt-calendar" style="margin-top:32px;">
        <h2 class="hub-section-title">🎍 年末カレンダー配布</h2>
        <div data-line-view="calendars"></div>
      </section>
    `;
    renderBirthdays();
    renderCalendars();
  }

  // ============================
  // ⚙️ 設定ハブ (LINE接続 + セグメント)
  // ============================
  function renderSettingsHub() {
    const v = document.querySelector('[data-line-view="settingsHub"]');
    v.innerHTML = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">⚙️ 設定</span>
          <span class="howto-banner-subtitle">FP切替 / LINE接続情報 / セグメント定義</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;font-size:11.5px;">
        <a href="#set-tenant" class="quick-jump">🏢 FP切替・新規追加</a>
        <a href="#set-line" class="quick-jump">🔌 LINE接続</a>
        <a href="#set-segments" class="quick-jump">👥 セグメント</a>
      </div>
      <section id="set-tenant" style="margin-bottom:32px;">
        <h2 class="hub-section-title">🏢 FP切替・新規追加 (マルチテナント)</h2>
        <div data-line-view="tenant"></div>
      </section>
      <section id="set-line">
        <h2 class="hub-section-title">🔌 LINE 公式アカウント接続</h2>
        <div data-line-view="settings"></div>
      </section>
      <section id="set-segments" style="margin-top:32px;">
        <h2 class="hub-section-title">👥 セグメント定義</h2>
        <div data-line-view="segments"></div>
      </section>
    `;
    renderTenantUI();
    renderSettings();
    renderSegments();
  }

  // FP切替・新規登録UI
  async function renderTenantUI() {
    const v = document.querySelector('[data-line-view="tenant"]');
    if (!v) return;
    const cur = currentFpId();
    v.innerHTML = '<div style="padding:20px;color:#94a3b8;">読込中…</div>';
    let list = [];
    try {
      const r = await fetch(CLOUD_RUN_BASE + '/api/fp-list');
      list = await r.json();
    } catch (e) { list = []; }
    v.innerHTML = `
      <div style="background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:20px 24px;">
        <div style="font-size:12.5px;color:#475569;margin-bottom:14px;line-height:1.7;">
          現在の FP: <strong style="color:#5B5BF0;">${escapeHtml(cur)}</strong><br>
          1つのシステムで 複数 FP の顧客データを完全分離管理します。
        </div>
        <div style="display:grid;gap:8px;margin-bottom:18px;">
          ${list.map(f => `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid ${f.fpId === cur ? '#5B5BF0' : '#E2E8F0'};border-radius:8px;background:${f.fpId === cur ? '#EEF1FE' : '#fff'};">
              <div style="flex:1;">
                <div style="font-weight:700;font-size:13.5px;color:#0F172A;">${escapeHtml(f.fpName || '(未設定)')} <span style="font-family:Manrope,monospace;font-size:10.5px;color:#94A3B8;">${escapeHtml(f.fpId)}</span></div>
                <div style="font-size:11.5px;color:#64748B;margin-top:2px;">${escapeHtml(f.email || '')} ・ plan: ${escapeHtml(f.plan || '-')} ・ ${escapeHtml(f.status || '-')}</div>
              </div>
              ${f.fpId === cur ? '<span style="background:#5B5BF0;color:#fff;padding:5px 12px;border-radius:99px;font-size:10.5px;font-weight:800;letter-spacing:0.06em;">CURRENT</span>'
                : `<button data-switch-fp="${escapeHtml(f.fpId)}" style="background:#fff;border:1.5px solid #CBD5E1;color:#475569;padding:6px 14px;border-radius:6px;font-size:11.5px;font-weight:800;cursor:pointer;font-family:inherit;">切替</button>`}
            </div>
          `).join('')}
        </div>
        <button id="fp-add-new" style="background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;border:none;padding:11px 22px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;letter-spacing:0.04em;box-shadow:0 4px 12px rgba(91,91,240,0.3);">+ 新規 FP を登録</button>
      </div>
    `;
    v.querySelectorAll('[data-switch-fp]').forEach(b => {
      b.addEventListener('click', () => {
        if (confirm(b.dataset.switchFp + ' に切り替えますか? (ページ再読込)')) setCurrentFpId(b.dataset.switchFp);
      });
    });
    document.getElementById('fp-add-new').addEventListener('click', openFpRegisterWizard);
  }

  function openFpRegisterWizard() {
    const ex = document.getElementById('fp-reg-modal'); if (ex) ex.remove();
    const o = document.createElement('div');
    o.id = 'fp-reg-modal';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:20px;';
    o.innerHTML = `
      <div style="background:#fff;width:min(560px,100%);max-height:90vh;overflow-y:auto;border-radius:14px;font-family:'Noto Sans JP',sans-serif;">
        <div style="padding:18px 22px;background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:15px;">🏢 新規 FP 登録ウィザード</strong>
          <button id="fp-reg-close" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;width:28px;height:28px;border-radius:5px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:22px;">
          <div style="font-size:11.5px;color:#64748B;line-height:1.7;margin-bottom:14px;background:#FFFBEB;border:1px solid #FBBF24;border-radius:6px;padding:10px 14px;color:#78350F;">
            ⚠ 事前に Skeleton 運営側で 各FP用の LINE Channel + LIFF + Zoom 鍵を取得しておく必要があります。
          </div>
          <form id="fp-reg-form" style="display:grid;gap:12px;">
            <label style="font-size:12px;color:#475569;font-weight:700;">FP 表示名 *<br><input name="fpName" required style="width:100%;padding:9px;border:1.5px solid #CBD5E1;border-radius:6px;font-family:inherit;margin-top:4px;" placeholder="例: 山田 太郎 (FP)"></label>
            <label style="font-size:12px;color:#475569;font-weight:700;">メールアドレス *<br><input name="email" type="email" required style="width:100%;padding:9px;border:1.5px solid #CBD5E1;border-radius:6px;font-family:inherit;margin-top:4px;"></label>
            <label style="font-size:12px;color:#475569;font-weight:700;">LINE Channel Access Token<br><input name="lineChannelAccessToken" style="width:100%;padding:9px;border:1.5px solid #CBD5E1;border-radius:6px;font-family:inherit;margin-top:4px;font-family:Menlo,monospace;font-size:11px;" placeholder="Messaging API 長期トークン"></label>
            <label style="font-size:12px;color:#475569;font-weight:700;">LIFF ID<br><input name="liffId" style="width:100%;padding:9px;border:1.5px solid #CBD5E1;border-radius:6px;font-family:inherit;margin-top:4px;font-family:Menlo,monospace;font-size:11px;" placeholder="例: 2010266648-iX5kooZe"></label>
            <label style="font-size:12px;color:#475569;font-weight:700;">Zoom Account ID<br><input name="zoomAccountId" style="width:100%;padding:9px;border:1.5px solid #CBD5E1;border-radius:6px;font-family:inherit;margin-top:4px;font-family:Menlo,monospace;font-size:11px;"></label>
            <label style="font-size:12px;color:#475569;font-weight:700;">プラン<br><select name="plan" style="width:100%;padding:9px;border:1.5px solid #CBD5E1;border-radius:6px;font-family:inherit;margin-top:4px;"><option value="trial">トライアル (30日無料)</option><option value="pro" selected>Pro (月¥29,800)</option><option value="enterprise">Enterprise (応相談)</option></select></label>
            <div style="display:flex;gap:10px;margin-top:8px;">
              <button type="button" id="fp-reg-cancel" style="flex:1;padding:11px;background:#fff;border:1.5px solid #CBD5E1;color:#475569;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;">キャンセル</button>
              <button type="submit" style="flex:2;padding:11px;background:#5B5BF0;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">+ 登録</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(o);
    document.getElementById('fp-reg-close').addEventListener('click', () => o.remove());
    document.getElementById('fp-reg-cancel').addEventListener('click', () => o.remove());
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });
    document.getElementById('fp-reg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {};
      fd.forEach((v, k) => payload[k] = v);
      try {
        const r = await fetch(CLOUD_RUN_BASE + '/api/fp-register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (d.ok) {
          alert('✓ 登録完了! fpId: ' + d.fpId + '\n\n切替も自動で行います。');
          setCurrentFpId(d.fpId);
        } else {
          alert('失敗: ' + (d.error || ''));
        }
      } catch (err) {
        alert('通信失敗: ' + err.message);
      }
    });
  }

  // ============================
  // 🎍 年末カレンダー配布
  // ============================
  function renderCalendars() {
    fetchLiveData().then(() => { if (currentSubview === 'eventsHub') renderCalendarsInner(); });
    renderCalendarsInner();
  }

  function renderCalendarsInner() {
    const reqs = (liveData && liveData.calendar_requests) || [];
    const wantList = reqs.filter(r => r.status === '要' && r.address);
    const wantNoAddr = reqs.filter(r => r.status === '要' && !r.address);
    const notWant = reqs.filter(r => r.status === '不要');
    const total = reqs.length;
    const cvr = total > 0 ? Math.round(wantList.length / total * 100) : 0;

    // Google Maps ルートURL生成
    const buildRouteUrl = (addresses) => {
      if (addresses.length === 0) return '#';
      const enc = addresses.map(a => encodeURIComponent(a));
      const origin = enc[0];
      const destination = enc[enc.length - 1];
      const waypoints = enc.slice(1, -1).join('|');
      let url = 'https://www.google.com/maps/dir/?api=1&origin=' + origin + '&destination=' + destination;
      if (waypoints) url += '&waypoints=' + waypoints;
      url += '&travelmode=driving';
      return url;
    };
    const buildMapAllUrl = (addresses) => {
      if (addresses.length === 0) return '#';
      return 'https://www.google.com/maps/search/' + encodeURIComponent(addresses.join(' / '));
    };

    const wantAddresses = wantList.map(r => r.address).filter(x => x);
    const routeUrl = buildRouteUrl(wantAddresses);
    const allMapUrl = buildMapAllUrl(wantAddresses);

    const html = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">💡 年末カレンダー配布の流れ</span>
          <span class="howto-banner-subtitle">毎年12月に既存客に手渡しカレンダー配るFP向け / 5ステップで完了</span>
        </div>
        <div class="howto-steps">
          <div class="howto-step"><div class="howto-step-no">1</div><div>下の <span class="btn-hint">📨 友だち全員に一斉配信</span> を押す → 全LINE友だちに「カレンダー希望調査」が届く</div></div>
          <div class="howto-step"><div class="howto-step-no">2</div><div>お客様は LINE で「🎁 受け取る / 不要」を1タップ</div></div>
          <div class="howto-step"><div class="howto-step-no">3</div><div>「受け取る」を選んだ方には自動で住所入力URLが届く → 入力すると下のリストに反映</div></div>
          <div class="howto-step"><div class="howto-step-no">4</div><div>FP は <span class="btn-hint">🚗 配達ルート最適化</span> でGoogle マップを開き、ナビで配達</div></div>
          <div class="howto-step"><div class="howto-step-no">5</div><div>各住所行の <span class="btn-hint">📍 地図で見る</span> で個別位置確認も可能</div></div>
        </div>
      </div>

      <div class="kpi-row" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi">
          <div class="kpi-label">回答総数</div>
          <div class="kpi-value">${total}</div>
          <div class="kpi-sub">人</div>
        </div>
        <div class="kpi good">
          <div class="kpi-label">「要」(住所済)</div>
          <div class="kpi-value">${wantList.length}</div>
          <div class="kpi-sub">配達対象</div>
        </div>
        <div class="kpi warn">
          <div class="kpi-label">「要」(住所未)</div>
          <div class="kpi-value">${wantNoAddr.length}</div>
          <div class="kpi-sub">住所待ち</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">希望率</div>
          <div class="kpi-value">${cvr}<span class="unit">%</span></div>
          <div class="kpi-sub">要 / 回答総数</div>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;margin-bottom:24px;">
        <button class="primary" id="cal-blast-btn" data-hint="全LINE友だちに「カレンダー要りますか?」配信。年1回だけ押す想定"><i data-lucide="send"></i><span>友だち全員に一斉配信</span></button>
        <a class="ghost" href="${allMapUrl}" target="_blank" data-hint="希望者の住所をGoogleマップ上に全部ピン表示" style="text-decoration:none;display:inline-block;padding:9px 18px;border:1px solid var(--line-2);border-radius:7px;color:var(--ink);${wantList.length===0?'pointer-events:none;opacity:0.4;':''}">🗺 全員の住所を地図表示</a>
        <a class="ghost" href="${routeUrl}" target="_blank" data-hint="希望者全員を回る最適ルートをGoogleマップで生成。当日ナビとして使用" style="text-decoration:none;display:inline-block;padding:9px 18px;border:1px solid var(--line-2);border-radius:7px;color:var(--ink);${wantList.length===0?'pointer-events:none;opacity:0.4;':''}">🚗 配達ルートを最適化 (Google マップ)</a>
        <span id="cal-blast-msg" style="font-size:12px;color:var(--muted);align-self:center;margin-left:auto;"></span>
      </div>

      <div class="section-title">🎁 受け取り希望 (住所済) — ${wantList.length}名</div>
      ${wantList.length === 0
        ? '<div class="line-card" style="text-align:center;padding:30px;color:var(--muted);">まだ住所登録されたご希望はありません</div>'
        : `<div style="display:grid;gap:8px;margin-bottom:24px;">
            ${wantList.map((r, i) => `
              <div class="line-card" style="padding:14px 18px;display:grid;grid-template-columns:36px 1fr 160px;gap:12px;align-items:center;">
                <div style="background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;font-family:'Inter',sans-serif;">${i + 1}</div>
                <div>
                  <strong style="font-size:14px;">${escapeHtml(r.name) || '匿名'}</strong>
                  <div style="font-size:12.5px;color:var(--ink-2);margin-top:3px;letter-spacing:0.01em;line-height:1.6;">📮 ${escapeHtml(r.address)}</div>
                  ${r.phone ? `<div style="font-size:11.5px;color:var(--muted);margin-top:2px;">📞 ${escapeHtml(r.phone)}</div>` : ''}
                  ${r.note ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;font-style:italic;">📝 ${escapeHtml(r.note)}</div>` : ''}
                </div>
                <div style="text-align:right;">
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(r.address)}" target="_blank" style="font-size:11.5px;color:var(--accent);text-decoration:none;background:var(--accent-soft);padding:4px 10px;border-radius:11px;display:inline-block;">📍 地図で見る</a>
                </div>
              </div>
            `).join('')}
          </div>`
      }

      ${wantNoAddr.length > 0 ? `
        <div class="section-title" style="margin-top:24px;">⏳ 住所登録待ち — ${wantNoAddr.length}名</div>
        <div style="display:grid;gap:6px;margin-bottom:24px;">
          ${wantNoAddr.map(r => `
            <div class="line-card" style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
              <strong style="font-size:13.5px;">${escapeHtml(r.name) || '匿名'}</strong>
              <span style="font-size:11px;color:var(--muted);">住所入力URLを送信済 / 入力待ち</span>
            </div>
          `).join('')}
        </div>` : ''}

      ${notWant.length > 0 ? `
        <div class="section-title" style="margin-top:24px;">✗ 不要 — ${notWant.length}名</div>
        <div style="display:grid;gap:4px;font-size:12px;color:var(--muted);">
          ${notWant.map(r => `<div style="padding:8px 14px;background:#fafbfc;border:1px solid var(--line);border-radius:6px;">${escapeHtml(r.name) || '匿名'}</div>`).join('')}
        </div>` : ''}
    `;
    document.querySelector('[data-line-view="calendars"]').innerHTML = html;

    document.getElementById('cal-blast-btn').addEventListener('click', async () => {
      if (!confirm('LINE友だち全員に「カレンダー希望調査」を一斉配信します。よろしいですか?')) return;
      const btn = document.getElementById('cal-blast-btn');
      const msg = document.getElementById('cal-blast-msg');
      btn.disabled = true; btn.textContent = '配信中...';
      try {
        const r = await fetch(CLOUD_RUN_BASE + '/api/cal-blast', { method: 'POST' });
        const data = await r.json();
        msg.textContent = data.ok ? `✓ ${data.sent}/${data.total}名 に送信完了` : '❌ 失敗: ' + (data.error || '');
        msg.style.color = data.ok ? 'var(--green)' : 'var(--red)';
        btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i><span>友だち全員に一斉配信</span>'; if (window.lucide) lucide.createIcons();
      } catch (e) {
        msg.textContent = '❌ 失敗: ' + e.message;
        msg.style.color = 'var(--red)';
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send"></i><span>友だち全員に一斉配信</span>'; if (window.lucide) lucide.createIcons();
      }
    });
  }

  // ============================
  // 初回相談導線 (リードファネル)
  // ============================
  // Cloud Run のリアルデータ
  const CLOUD_RUN_BASE = 'https://fp-compass-webhook-527726449426.asia-northeast1.run.app';
  // マルチテナント: 現在の FP (localStorage で永続、default fp001)
  // ★ デフォルト 'fp001' (= 旧 GAS データ 吉田恭聡 等 含む) を 撤去 — 旧テスト顧客 が 誤注入される 元凶
  //   明示的に localStorage に セット された 場合 のみ GAS フェッチ 有効
  function currentFpId() {
    // ★ multi-tenant Firebase Auth login 経由 だと fp-current-fpid が空のまま で
    //   /api/bookings?fpId= が空文字 fetch → ai_results 0件 → 議事録 反映なし
    //   優先順: localStorage > window.__fp (login時に set) > AccountInfo
    return localStorage.getItem('fp-current-fpid')
        || (window.__fp && window.__fp.tenantId)
        || localStorage.getItem('fp-tenantId')
        || (window.AccountInfo && window.AccountInfo.tenantId)
        || '';
  }
  function setCurrentFpId(id) { localStorage.setItem('fp-current-fpid', id); location.reload(); }
  window.FpTenant = { current: currentFpId, set: setCurrentFpId };
  // ★ CLOUD_RUN_API は 関数化 — login 後 に currentFpId() の値 が 変わる ため
  //   const で 評価固定 だと page load 時 (login前) の 空文字で 固定 → 全fetch で fpId空 で AI results取れない
  const getCloudRunApi = () => CLOUD_RUN_BASE + '/api/bookings?fpId=' + encodeURIComponent(currentFpId());
  let liveData = null;

  function showSyncIndicator(state, detail) {
    // 控えめな細い進行バー (右下、3px、indigo)。loading 中だけ表示。
    let bar = document.getElementById('fp-sync-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fp-sync-bar';
      bar.style.cssText = 'position:fixed;bottom:0;right:0;height:3px;width:0;background:linear-gradient(90deg,#5B5BF0,#06B6D4);z-index:9998;transition:width 0.4s ease,opacity 0.3s;border-radius:2px 0 0 0;pointer-events:none;';
      document.body.appendChild(bar);
    }
    if (state === 'loading') {
      bar.style.opacity = '1';
      bar.style.width = '40%';
      // 90% で stuck (擬似プログレス、完了で 100%)
      setTimeout(() => { if (bar.style.opacity === '1') bar.style.width = '85%'; }, 600);
    } else if (state === 'done') {
      bar.style.width = '100%';
      setTimeout(() => { bar.style.opacity = '0'; bar.style.width = '0'; }, 400);
    } else if (state === 'error') {
      console.warn('[sync error]', detail);
      bar.style.background = '#E11D48';
      bar.style.width = '100%';
      setTimeout(() => { bar.style.opacity = '0'; bar.style.background = 'linear-gradient(90deg,#5B5BF0,#06B6D4)'; bar.style.width = '0'; }, 1200);
    }
  }

  const LIVE_CACHE_KEY = 'fp-livedata-cache-v1';

  async function fetchLiveData() {
    // ★ fpId が 未設定 (= 旧 GAS データ 誤注入 防止) なら GAS フェッチ スキップ
    if (!currentFpId()) {
      console.log('[fetchLiveData] skipped (no fpId set in localStorage)');
      liveData = liveData || { users: [], bookings: [], survey_answers: [], line_messages: [] };
      window.LineAppLiveData = liveData;
      return;
    }
    // ★ v20260608Y で全 GAS 遮断していたが、オーナーの実予約も消えてしまうので解除。
    // GAS は ?fpId=xxx で URL レベルで tenant 分離されている (CLOUD_RUN_API)。
    // demo テナントには dummy-data.js 由来の demo 客が出るのは変わらず (loadTenantData の別経路)。
    // ① キャッシュがあれば即座に画面へ反映 (体感ゼロ秒)
    if (!liveData) {
      try {
        const cached = localStorage.getItem(LIVE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && (parsed.users || parsed.bookings)) {
            liveData = parsed;
            window.LineAppLiveData = liveData;
            if (window.FPCrmRefreshClients) {
              try { window.FPCrmRefreshClients(); } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
    // ② network fetch (バックグラウンドで最新化)
    showSyncIndicator('loading');
    try {
      const r = await fetch(getCloudRunApi());
      liveData = await r.json();
      // ※ 削除済: 旧コード「cleared flag で liveData 全配列空に強制上書き」
      //   → GAS resetAll で実データを消したので強制上書き不要。
      //   → リセット後に新規予約しても、この強制上書きで消えてしまうバグの原因だった。
      window.LineAppLiveData = liveData;
      try { localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(liveData)); } catch (_) {}
      // ★ オーナーfb「客返信が CRM に反映されない」: line_messages を各顧客 lineHistory にマージ
      try {
        const msgs = liveData.line_messages || [];
        if (msgs.length > 0 && window.DUMMY_CLIENTS) {
          // (前段) liveData.users から「実 LINE userId」を取得し、同名 client の lineFriendId を実値に補正
          // dummy-data の架空 lineFriendId と Webhook の実 userId の不一致を解消
          try {
            const liveUsers = liveData.users || [];
            liveUsers.forEach(u => {
              if (!u.userId || !u.displayName) return;
              const c = window.DUMMY_CLIENTS.find(x => String(x.name || '').trim() === u.displayName.trim());
              if (c && c.lineFriendId !== u.userId) {
                console.log('[lineFix] overwrite', c.name, ':', c.lineFriendId, '→', u.userId);
                c.lineFriendId = u.userId;
              }
            });
            localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS));
          } catch (fixErr) { console.warn('lineFriendId 補正 fail:', fixErr); }
          let merged = 0;
          msgs.forEach(m => {
            if (!m.userId || !m.text) return;
            let c = window.DUMMY_CLIENTS.find(x => x.lineFriendId === m.userId);
            if (!c && m.name) {
              c = window.DUMMY_CLIENTS.find(x => String(x.name || '').trim() === String(m.name || '').trim());
              if (c && m.userId) c.lineFriendId = m.userId;
            }
            if (!c) return;
            if (!Array.isArray(c.lineHistory)) c.lineHistory = [];
            const ts = String(m.ts || '').slice(0, 19);
            const seen = c.lineHistory.some(h => String(h.ts || '').slice(0, 19) === ts && (h.text || h.message) === m.text);
            if (seen) return;
            const entry = { from: 'user', direction: 'in', text: m.text, message: m.text, ts: m.ts, date: String(m.ts || '').slice(0, 10), source: 'gas-webhook' };
            c.lineHistory.push(entry);
            // 独立キーにも保存 (リロード耐性)
            try {
              const key = 'fp-line-history-' + c.id;
              const arr = JSON.parse(localStorage.getItem(key) || '[]');
              arr.push(entry);
              localStorage.setItem(key, JSON.stringify(arr));
            } catch (_) {}
            merged++;
          });
          if (merged > 0) {
            localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS));
            console.log('[line_messages] merged', merged, 'incoming msgs to client.lineHistory');
          }
        }
      } catch (mergeErr) { console.warn('line_messages merge fail:', mergeErr); }

      // ★ アンケート→顧客カード 自動反映 (空欄のみ埋める / 既存値は壊さない)
      //   proxy/index.js 本番スキーマ: q1_年代/q2_職業/q3_家族/q10_生年月日/q15_緊急度
      try {
        const surveys = liveData.survey_answers || [];
        if (surveys.length > 0 && window.DUMMY_CLIENTS) {
          let mergedCount = 0;
          // userId 最新順に並べて顧客毎の最新サーベイを取る
          const latestByUid = {};
          surveys.slice().sort((a,b) => (a.ts || '').localeCompare(b.ts || ''))
            .forEach(s => { if (s.userId) latestByUid[s.userId] = s; });

          Object.values(latestByUid).forEach(s => {
            const c = window.DUMMY_CLIENTS.find(x => x.lineFriendId === s.userId);
            if (!c) return;
            let changed = false;
            // 生年月日 (NEW項目) — '1985-01-01' 旧デフォルトも空扱い
            // Sheets で ISO timestamp 化 (例 1985-04-11T15:00:00.000Z) されるので YYYY-MM-DD に正規化
            if ((!c.birth || c.birth === '1985-01-01') && s.q10_生年月日) {
              const raw = String(s.q10_生年月日);
              const birthYmd = /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw).toISOString().slice(0,10) : raw.slice(0,10);
              c.birth = birthYmd;
              changed = true;
            }
            // 職業
            if (!c.occupation && s.q2_職業) {
              c.occupation = s.q2_職業;
              changed = true;
            }
            // 緊急度 → タグ自動付与 (緊急度が「すぐに」系なら 🔥緊急 タグ)
            if (s.q15_緊急度 && /すぐ/.test(s.q15_緊急度)) {
              if (!Array.isArray(c.tags)) c.tags = [];
              if (!c.tags.includes('🔥緊急')) {
                c.tags.push('🔥緊急');
                changed = true;
              }
            }
            // 相談テーマ → タグ (q8_テーマ 複数可・「, 」結合済)
            if (s.q8_テーマ) {
              const themes = String(s.q8_テーマ).split(/[,、]\s*/).filter(Boolean);
              if (!Array.isArray(c.tags)) c.tags = [];
              themes.forEach(t => {
                const tag = '💬' + t;
                if (!c.tags.includes(tag)) { c.tags.push(tag); changed = true; }
              });
            }
            // 家族構成 (textだけ反映、 c.family 配列は手入力ベースのまま不変)
            if (!c.familyText && s.q3_家族) {
              c.familyText = s.q3_家族;
              changed = true;
            }
            if (changed) mergedCount++;
          });
          if (mergedCount > 0) {
            localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS));
            console.log('[survey→client] auto-filled', mergedCount, 'clients (birth/occupation/tags 等の空欄のみ)');
          }
        }
      } catch (sErr) { console.warn('survey→client merge fail:', sErr); }
      try { checkPendingDateSelections(); } catch(_) {}

      const detail = (liveData.users ? liveData.users.length + 'ユーザー' : '') +
                     (liveData.bookings ? ' / ' + liveData.bookings.length + '予約' : '');
      showSyncIndicator('done', detail);
      if (window.FPCrmRefreshClients) {
        try { window.FPCrmRefreshClients(); } catch (_) {}
      }
      return liveData;
    } catch (e) {
      console.error('liveData fail', e);
      showSyncIndicator('error', e.message || '');
      return liveData; // キャッシュがあれば返す
    }
  }

  // Scan line_messages for customer date selections → show FP confirmation popup
  function checkPendingDateSelections() {
    if (!liveData) return;
    const msgs = liveData.line_messages || [];
    const surveys = liveData.survey_answers || [];
    const bookings = liveData.bookings || [];
    const DATE_SEL_PAT = /候補([1-3１２３])\s*[（(]([^）)]+)[）)]\s*でお願いします/;
    msgs.forEach(m => {
      if (!m.text || !m.userId || m.direction === 'out') return;
      const match = m.text.match(DATE_SEL_PAT);
      if (!match) return;
      const alreadyConfirmed = bookings.some(b => b.userId === m.userId && b.date && b.status !== 'cancelled');
      if (alreadyConfirmed) return;
      const pending = surveys.find(s => s.userId === m.userId && !s.confirmedSlot && (s.q6_候補1 || s.q7_候補2 || s.q8_候補3));
      if (!pending) return;
      const alertKey = 'fp-date-alert-' + m.userId + '-' + String(m.ts || '').slice(0, 16);
      if (localStorage.getItem(alertKey)) return;
      localStorage.setItem(alertKey, '1');
      const userName = m.name || (window.DUMMY_CLIENTS || []).find(c => c.lineFriendId === m.userId)?.name || 'お客様';
      showDateConfirmModal(m.userId, userName, match[2], m.text);
    });
  }

  function showDateConfirmModal(userId, userName, dateTimeStr, originalText) {
    const year = new Date().getFullYear();
    const dmMatch = dateTimeStr.match(/(\d{1,2})月(\d{1,2})日/);
    const timeMatch = dateTimeStr.match(/(\d{1,2}:\d{2})/);
    if (!dmMatch) return;
    const dateStr = year + '-' + dmMatch[1].padStart(2, '0') + '-' + dmMatch[2].padStart(2, '0');
    const slotStr = timeMatch ? timeMatch[1] : '';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.72);backdrop-filter:blur(6px);z-index:10090;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:500px;width:100%;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;">
        <div style="background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;padding:20px 24px;">
          <div style="font-size:10px;font-weight:800;letter-spacing:0.2em;margin-bottom:4px;opacity:0.9;">📅 日程確認リクエスト</div>
          <h3 style="margin:0;font-size:18px;font-weight:900;">お客様から日程選択が届きました</h3>
        </div>
        <div style="padding:24px;">
          <div style="background:#FFFBEB;border:1.5px solid #FCD34D;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
            <div style="font-size:11px;font-weight:800;color:#92400E;letter-spacing:0.06em;margin-bottom:5px;">📩 ${escapeHtml(userName)}様からのメッセージ</div>
            <div style="font-size:14px;font-weight:800;color:#1F1A12;">${escapeHtml(originalText)}</div>
          </div>
          <div style="font-size:14px;color:#374151;margin-bottom:6px;line-height:1.8;">
            <strong>${escapeHtml(userName)}様</strong>が <strong style="color:#5B5BF0;">${escapeHtml(dateTimeStr)}</strong> を選択しました。<br>
            確定してよろしいですか？
          </div>
          <div style="font-size:11.5px;color:#6B7280;margin-bottom:20px;">確定すると Zoom URL が自動生成・送信され、Googleカレンダーに登録されます。</div>
          <div id="fp-date-confirm-status" style="font-size:12.5px;font-weight:700;margin-bottom:14px;min-height:18px;"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="fp-date-confirm-skip" style="background:#fff;color:#6B7280;border:1px solid #D1D5DB;padding:11px 22px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">後で確認</button>
            <button id="fp-date-confirm-ok" style="background:linear-gradient(135deg,#5B5BF0,#6D6DEF);color:#fff;border:none;padding:11px 26px;border-radius:8px;font-size:13.5px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(91,91,240,0.3);">✓ 確定して承りましたを送る</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#fp-date-confirm-skip').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#fp-date-confirm-ok').addEventListener('click', async () => {
      const statusEl = overlay.querySelector('#fp-date-confirm-status');
      const okBtn = overlay.querySelector('#fp-date-confirm-ok');
      okBtn.disabled = true; okBtn.textContent = '処理中...';
      statusEl.style.color = '#5B5BF0'; statusEl.textContent = 'Zoom URL を発行・カレンダー登録中…';
      try {
        const r = await fetch(CLOUD_RUN_BASE + '/api/confirm-slot', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, dateStr, slotStr, name: userName }),
        });
        const d = await r.json();
        if (d.ok || d.success) {
          statusEl.style.color = '#059669'; statusEl.textContent = '✅ 確定完了 — 「承りました」メッセージを送信しました';
          setTimeout(() => overlay.remove(), 2200);
          fetchLiveData().then(() => { if (currentSubview === 'leadHub') renderLeadHubInner(); });
        } else {
          statusEl.style.color = '#DC2626'; statusEl.textContent = '❌ ' + (d.error || '確定処理に失敗しました');
          okBtn.disabled = false; okBtn.textContent = '✓ 確定して承りましたを送る';
        }
      } catch (e) {
        statusEl.style.color = '#DC2626'; statusEl.textContent = '❌ 通信エラー: ' + e.message;
        okBtn.disabled = false; okBtn.textContent = '✓ 確定して承りましたを送る';
      }
    });
  }

  function renderLeadFunnel() {
    // 起動時 + 10秒ごとにライブデータ取得
    fetchLiveData().then(() => { if (currentSubview === 'leadHub') renderLeadFunnelInner(); });
    if (!window._leadFunnelInterval) {
      window._leadFunnelInterval = setInterval(() => {
        if (currentSubview === 'leadHub') {
          fetchLiveData().then(() => renderLeadFunnelInner());
        }
      }, 10000);
    }
    renderLeadFunnelInner();
  }

  function renderLeadFunnelInner() {
    const f = window.LEAD_FUNNEL;
    const scenario = window.LEAD_SCENARIO;
    const form = window.LEAD_FORM;

    // Cloud Run の bookings/survey_answers を優先表示
    let bookings = window.UPCOMING_BOOKINGS;
    let surveysList = [];
    let liveStats = null;
    if (liveData) {
      // 「終わった面談」自動クリーンアップ:
      //  ① 録画 saved (= 終了済) で 24h 経過したもの
      //  ② 録画 saved で zoomUrl 削除 (= 手動で終了マーク)
      //  ③ 開始予定日から 24h 以上経過してるもの (録画なしで終わったケース)
      const NOW_MS = Date.now();
      const ONE_DAY = 86400000;
      const isFinishedBooking = (b) => {
        const recDone = b.recordingStatus === 'saved' || b.recordingStatus === 'completed';
        const zoomGone = !b.zoomUrl || b.zoomUrl === '';
        if (recDone && zoomGone) return true;
        if (recDone) {
          const recAge = b.ts ? (NOW_MS - new Date(b.ts).getTime()) : 0;
          if (recAge > ONE_DAY) return true;
        }
        // 日付過ぎてるもの (24h 以上前)
        if (b.date) {
          const d = new Date(b.date + ' ' + (b.time || '23:59'));
          if (!isNaN(d.getTime()) && (NOW_MS - d.getTime()) > ONE_DAY) return true;
        }
        return false;
      };
      const liveAll = (liveData.bookings || []).slice().reverse().slice(0, 20).map(b => ({
        id: 'live-' + (b.userId || b.ts),
        name: b.name || '匿名',
        date: b.date || '',
        time: b.time || '',
        via: 'Zoom',
        status: 'confirmed',
        zoomUrl: b.zoomUrl || '',
        answers: { q1: '-', q2: '-', q3: '-', q4: '-', q5: '-' },
        addedToCrm: false,
        live: true,
        ts: b.ts || '',
        recordingStatus: b.recordingStatus || '',
        driveUrl: b.driveUrl || '',
        transcript: b.transcript || '',
      }));
      const live = liveAll.filter(b => !isFinishedBooking(b)).slice(0, 10);
      window._fpFinishedBookings = liveAll.filter(isFinishedBooking).slice(0, 5);
      if (live.length > 0) bookings = live.concat(bookings);
      surveysList = (liveData.survey_answers || []).slice().reverse().slice(0, 8);
      liveStats = {
        users: (liveData.users || []).length,
        surveys: (liveData.survey_answers || []).length,
        bookings: (liveData.bookings || []).length,
      };
    }
    const hotLeads = window.HOT_LEADS;

    const conv = (a, b) => b === 0 ? 0 : Math.round(a / b * 100);

    const html = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">💡 このタブの使い方</span>
          <span class="howto-banner-subtitle">新規相談 → Zoom面談 → 顧客化 までを自動化する場所</span>
        </div>
        <div class="howto-steps">
          <div class="howto-step"><div class="howto-step-no">1</div><div>お客様が公式LINE追加 → 自動でステップ配信 → アンケート + 候補日3つ受信</div></div>
          <div class="howto-step"><div class="howto-step-no">2</div><div>下の<strong>「公式LINEからの最新アンケート回答」</strong>に「確定待ち」のお客様が並ぶ</div></div>
          <div class="howto-step"><div class="howto-step-no">3</div><div>候補日3つから1つ <span class="btn-hint">この日で確定 →</span> ボタンを押す</div></div>
          <div class="howto-step"><div class="howto-step-no">4</div><div>瞬時に: Zoom URL自動発行 / お客様にLINE通知 / Googleカレンダー登録 が全部起きる</div></div>
          <div class="howto-step"><div class="howto-step-no">5</div><div>面談当日は予約カードの <span class="btn-hint">● 録画ONでZoom開始</span> から入室 → 終了時 <span class="btn-hint">■ 録画停止</span> → <span class="btn-hint">✨ AI議事録を生成</span></div></div>
        </div>
      </div>

      ${liveStats ? `
      <div style="background:linear-gradient(135deg,#06873f,#06c755);color:#fff;border-radius:10px;padding:12px 18px;margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;">
          <span style="width:8px;height:8px;background:#fff;border-radius:50%;animation:pulse 1.5s infinite;"></span> LIVE
        </div>
        <div style="font-size:12px;opacity:0.9;">公式LINEから入った実データ</div>
        <div style="margin-left:auto;display:flex;gap:16px;font-size:13px;">
          <div>友だち <strong>${liveStats.users}</strong></div>
          <div>回答 <strong>${liveStats.surveys}</strong></div>
          <div>予約 <strong>${liveStats.bookings}</strong></div>
        </div>
      </div>
      <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
      ` : ''}

      ${surveysList.length > 0 ? `
      <div class="section-title">📝 公式LINEからの最新アンケート回答 (候補日3つ込み)</div>
      <div style="display:grid;gap:10px;margin-bottom:18px;">
        ${surveysList.map(s => {
          const slots = [s.q6_候補1, s.q7_候補2, s.q8_候補3].filter(x => x);
          const confirmed = s.confirmedSlot || '';
          const uidShort = (s.userId || '').slice(0, 12);
          return `
          <div class="line-card" style="padding:14px 18px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:8px;">
              <div>
                <strong style="font-size:14px;">${escapeHtml(s.q1_テーマ || '-')}</strong>
                <span style="font-size:11px;color:var(--muted);margin-left:8px;">${(s.ts || '').slice(5, 16).replace('T', ' ')}</span>
              </div>
              ${confirmed
                ? `<span class="status-pill active">✓ ${escapeHtml(confirmed)} 確定</span>`
                : '<span class="status-pill new">確定待ち</span>'}
            </div>
            <div style="font-size:12px;color:var(--muted);letter-spacing:0.02em;margin-bottom:4px;">
              ${escapeHtml(s.q2_年代 || '-')} ・ ${escapeHtml(s.q3_家族 || '-')} ・ ${escapeHtml(s.q4_年収 || '-')} ・ userId:${uidShort}…
            </div>
            <div style="font-size:13px;color:var(--ink-2);margin-bottom:10px;line-height:1.6;">💭 ${escapeHtml(s.q5_悩み || '-')}</div>
            ${confirmed ? '' : (slots.length > 0 ? `
              <div style="background:#fafbfc;border:1px solid var(--line);border-radius:7px;padding:10px 12px;">
                <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">候補日 (タップで確定 → 自動でZoom URL作成・LINE通知・カレンダー登録)</div>
                <div style="display:grid;gap:6px;">
                  ${slots.map((slot, idx) => {
                    const parts = (slot || '').split(/\s+/);
                    const dateStr = parts[0] || '';
                    const slotStr = parts.slice(1).join(' ') || '';
                    return `<button class="slot-confirm-btn" data-slot-confirm
                      data-uid="${escapeHtml(s.userId)}" data-date="${escapeHtml(dateStr)}" data-slot="${escapeHtml(slotStr)}"
                      data-hint="この日で確定 → ZoomURL自動発行・お客様にLINE通知・Googleカレンダー登録 が一括で動きます"
                      style="text-align:left;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:6px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;align-items:center;font-family:inherit;">
                      <span><strong style="color:var(--accent);margin-right:8px;">第${idx + 1}希望</strong>${escapeHtml(slot)}</span>
                      <span style="font-size:11px;color:var(--green);font-weight:700;">この日で確定 →</span>
                    </button>`;
                  }).join('')}
                </div>
              </div>` : '<div style="font-size:11.5px;color:var(--muted);">※ 候補日未取得 (旧バージョンのアンケート回答)</div>')}
          </div>`;
        }).join('')}
      </div>
      ` : ''}

      <div class="section-title" style="margin-top:24px;">今後の面談予約 (アンケート回答済)</div>
      <div>
        ${bookings.length === 0 ? '<div class="line-card empty">予約なし</div>' : bookings.map(b => {
          const isLive = b.live;
          const rec = b.recordingStatus || '';
          const recPill = rec === 'recording' ? '<span class="rec-pill recording">● 録画中</span>'
                        : rec === 'saved' ? '<span class="rec-pill saved">📼 保存済</span>' : '';
          const dateStr = (b.date || '').slice(5).replace('-','/');
          const recButtons = isLive && b.zoomUrl ? (
            rec === 'recording' ? `
              <button class="btn-rec-stop" data-rec-stop="${escapeHtml(b.ts)}" data-hint="面談終了時に押す。録画ファイルが Drive に保存される">■ 録画停止</button>
              <a class="btn-mini" href="${escapeHtml(b.zoomUrl)}" target="_blank" data-hint="Zoom会議画面を別タブで開く">Zoomを開く</a>
            ` : rec === 'saved' ? `
              <a class="btn-mini" href="${escapeHtml(b.driveUrl||'#')}" target="_blank" data-hint="Google Drive に保存された録画ファイルを開く">📁 録画を開く (Drive)</a>
              <a class="btn-mini" href="${escapeHtml(b.zoomUrl)}" target="_blank" data-hint="同じZoom URLを再度開く (フォロー面談用)">Zoomを開く</a>
              ${b.transcript
                ? `<button class="btn-mini-action" data-view-transcript="${escapeHtml(b.ts)}" data-hint="AIが作った議事録を表示・コピー"><span class="icon">📝</span>議事録を見る</button>`
                : `<button class="btn-mini" data-gen-transcript="${escapeHtml(b.ts)}" data-hint="アンケート回答と顧客情報から議事録テンプレを自動生成。面談後に押す" style="background:linear-gradient(135deg,#b8893d,#d4a017);border:none;color:#fff;font-weight:700;">✨ AI議事録を生成</button>`}
            ` : `
              <button class="btn-rec-start" data-rec-start="${escapeHtml(b.ts)}" data-zoom="${escapeHtml(b.zoomUrl)}" data-hint="面談直前に押す。Zoomが別タブで開き、録画状態が「録画中」に">● 録画ONでZoom開始</button>
              <a class="btn-mini" href="${escapeHtml(b.zoomUrl)}" target="_blank" data-hint="録画せずにZoomだけ開く (簡易確認用)">録画なしで開く</a>
            `
          ) : '';
          return `
          <div class="booking-row" data-booking-id="${b.id}">
            <div class="booking-when">
              <div class="booking-date">${dateStr}</div>
              <div class="booking-time">${b.time}</div>
            </div>
            <div class="booking-main">
              <div class="booking-name">${escapeHtml(b.name)} ${isLive ? '<span class="status-pill active">LIVE</span>' : '<span class="status-pill new">未登録</span>'} ${recPill}</div>
              ${!isLive ? `<div class="booking-meta">${escapeHtml(b.answers.q1)} / ${escapeHtml(b.answers.q2)} / ${escapeHtml(b.answers.q3)} / ${escapeHtml(b.answers.q4)}</div>` : ''}
              ${!isLive ? `<div class="booking-want">💭 ${escapeHtml(b.answers.q5)}</div>` : ''}
              ${isLive ? `<div class="booking-want" style="font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;font-style:normal;">${escapeHtml(b.zoomUrl)}</div>` : ''}
              ${recButtons ? `<div class="booking-rec-row">${recButtons}</div>` : ''}
            </div>
            <div class="booking-cta">
              ${!isLive ? `<button class="ghost" data-view-answers="${b.id}">回答詳細</button>
              <button class="primary" data-convert="${b.id}" ${b.addedToCrm ? 'disabled style="opacity:0.5;"' : ''}>${b.addedToCrm ? '✓ 登録済' : '顧客登録'}</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="section-title" style="margin-top:24px;">🔥 ホットリード (回答済・未予約)</div>
      <div class="line-card">
        ${hotLeads.map(h => `
          <div class="booking-row">
            <div class="booking-when">
              <div class="booking-time" style="font-size:11px;">${escapeHtml(h.answeredAt.slice(5, 16))}</div>
              <div class="booking-date" style="font-size:10.5px;color:var(--muted);">回答済</div>
            </div>
            <div class="booking-main">
              <div class="booking-name">${escapeHtml(h.name)}</div>
              <div class="booking-meta">
                ${escapeHtml(h.answers.q1)} / ${escapeHtml(h.answers.q2)} / ${escapeHtml(h.answers.q3)} / ${escapeHtml(h.answers.q4)}
              </div>
              <div class="booking-want">💭 ${escapeHtml(h.answers.q5)}</div>
            </div>
            <div class="booking-cta">
              <button class="primary" disabled style="opacity:0.6;">予約URL再送</button>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:24px;">
        <div>
          <div class="section-title">⚙️ ステップ配信シナリオ</div>
          <div class="line-card">
            <div style="padding:10px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-weight:600;font-size:13.5px;">${escapeHtml(scenario.name)}</div>
                <div style="font-size:11px;color:var(--muted);">トリガー: ${escapeHtml(scenario.trigger)}</div>
              </div>
              <label class="toggle-switch"><input type="checkbox" ${scenario.enabled ? 'checked' : ''} disabled><span></span></label>
            </div>
            ${scenario.steps.map((s, i) => `
              <div class="step-row">
                <div class="step-no">${i + 1}</div>
                <div class="step-main">
                  <div class="step-head">
                    <span class="step-day">${s.day === 0 ? '即時' : '+' + s.day + '日'}</span>
                    <span class="step-time">${escapeHtml(s.time)}</span>
                    <span class="step-title">${escapeHtml(s.title)}</span>
                  </div>
                  <div class="step-body">${nl2br(s.body)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div>
          <div class="section-title">📋 ヒアリングアンケート (LINE内回答)</div>
          <div class="line-card">
            <div style="padding:10px 14px;border-bottom:1px solid var(--line);">
              <div style="font-weight:600;font-size:13.5px;">${escapeHtml(form.title)}</div>
              <div style="font-size:11px;color:var(--muted);">回答結果が自動で顧客メモに反映される</div>
            </div>
            ${form.questions.map((q, i) => `
              <div class="q-row">
                <div class="q-no">Q${i + 1}</div>
                <div class="q-main">
                  <div class="q-label">${escapeHtml(q.label)}</div>
                  ${q.type === 'choice' ? `<div class="q-opts">${q.options.map(o => `<span class="q-opt">${escapeHtml(o)}</span>`).join('')}</div>` : '<div class="q-opts" style="color:var(--muted);font-style:italic;">自由記述</div>'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    document.querySelector('[data-line-view="leadfunnel"]').innerHTML = html;

    // 顧客登録ボタン
    document.querySelectorAll('[data-convert]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.convert;
        const booking = window.UPCOMING_BOOKINGS.find(b => b.id === id);
        if (!booking || booking.addedToCrm) return;
        const newClient = window.LineCRM.convertBookingToClient(booking);
        if (newClient) {
          btn.textContent = '✓ 登録済';
          btn.disabled = true;
          btn.style.opacity = '0.5';
          // 確認モーダル
          showConvertResult(newClient);
        }
      });
    });
    // 回答詳細表示
    document.querySelectorAll('[data-view-answers]').forEach(btn => {
      btn.addEventListener('click', () => showAnswersDetail(btn.dataset.viewAnswers));
    });
    // Zoom録画開始
    document.querySelectorAll('[data-rec-start]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ts = btn.dataset.recStart;
        const zoomUrl = btn.dataset.zoom;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await fetch(CLOUD_RUN_BASE + '/api/recording/start?ts=' + encodeURIComponent(ts), { method: 'POST' });
          window.open(zoomUrl, '_blank');
          await fetchLiveData();
          renderLeadFunnelInner();
        } catch (e) {
          alert('録画開始失敗: ' + e.message);
          btn.disabled = false;
        }
      });
    });
    // Zoom録画停止
    document.querySelectorAll('[data-rec-stop]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('録画を停止して Drive に保存しますか?')) return;
        const ts = btn.dataset.recStop;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await fetch(CLOUD_RUN_BASE + '/api/recording/stop?ts=' + encodeURIComponent(ts), { method: 'POST' });
          await fetchLiveData();
          renderLeadFunnelInner();
        } catch (e) {
          alert('録画停止失敗: ' + e.message);
          btn.disabled = false;
        }
      });
    });
    // 候補日確定
    document.querySelectorAll('[data-slot-confirm]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const dateStr = btn.dataset.date;
        const slotStr = btn.dataset.slot;
        if (!confirm(`${dateStr} ${slotStr} で確定し、お客様にZoom URLをLINE送信、Googleカレンダーに登録します。よろしいですか?`)) return;
        btn.disabled = true;
        btn.innerHTML = btn.innerHTML.replace('この日で確定 →', '処理中...');
        try {
          const r = await fetch(CLOUD_RUN_BASE + '/api/confirm-slot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: uid, dateStr: dateStr, slotStr: slotStr }),
          });
          const data = await r.json();
          if (data.ok) {
            alert('✅ 確定しました\n\nZoom URL: ' + data.zoomUrl + '\n\n• お客様LINEに通知済\n• Googleカレンダーに登録済' + (data.calendar ? '\n• カレンダーID: ' + (data.calendar.calendarId || '') : ''));
            await fetchLiveData();
            renderLeadFunnelInner();
          } else {
            alert('❌ 確定失敗: ' + (data.error || ''));
            btn.disabled = false;
          }
        } catch (e) {
          alert('❌ 確定失敗: ' + e.message);
          btn.disabled = false;
        }
      });
    });
    // AI議事録 生成
    document.querySelectorAll('[data-gen-transcript]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ts = btn.dataset.genTranscript;
        btn.disabled = true;
        btn.textContent = '✨ 生成中...';
        try {
          const r = await fetch(CLOUD_RUN_BASE + '/api/transcript?ts=' + encodeURIComponent(ts), { method: 'POST' });
          const data = await r.json();
          if (data.ok && data.transcript) {
            await fetchLiveData();
            renderLeadFunnelInner();
            showTranscriptModal(data.transcript, '✨ AI議事録 (自動生成)');
          } else {
            alert('議事録生成失敗: ' + (data.error || ''));
            btn.disabled = false;
            btn.textContent = '✨ AI議事録を生成';
          }
        } catch (e) {
          alert('議事録生成失敗: ' + e.message);
          btn.disabled = false;
        }
      });
    });
    // 議事録を見る
    document.querySelectorAll('[data-view-transcript]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ts = btn.dataset.viewTranscript;
        // ライブデータから該当 booking の transcript を取得
        const live = (liveData && liveData.bookings) || [];
        const b = live.find(x => String(x.ts).slice(0,19) === String(ts).slice(0,19));
        if (b && b.transcript) {
          showTranscriptModal(b.transcript, '📝 議事録 — ' + (b.name || ''));
        } else {
          alert('議事録が見つかりません');
        }
      });
    });
  }

  // ★ 2026-06-22 roundK: 議事録モーダル 3タブ化 (要約 / タスク / 全文)
  // transcriptOrAI: string (旧: 全文だけ) OR object { transcript, summary, transcript_summary, key_concerns, tasks, next_meeting_suggestion }
  function showTranscriptModal(transcriptOrAI, title) {
    const isObj = transcriptOrAI && typeof transcriptOrAI === 'object';
    const ai = isObj ? transcriptOrAI : null;
    const transcript = isObj ? (ai.transcript || '') : String(transcriptOrAI || '');
    const summary = ai?.transcript_summary || (ai?.summary && !Array.isArray(ai.summary) ? '' : '');
    const summaryPoints = ai?.summary || '';
    const concerns = Array.isArray(ai?.key_concerns) ? ai.key_concerns : [];
    const tasks = Array.isArray(ai?.tasks) ? ai.tasks : [];
    const nextMeeting = ai?.next_meeting_suggestion || '';
    const hasAny = summary || summaryPoints || concerns.length || tasks.length;
    // タブ初期値: タスクあればタスク優先 / なければ要約
    const defaultTab = tasks.length > 0 ? 'tasks' : (hasAny ? 'summary' : 'full');

    const tabs = [
      { id: 'summary', label: '要約', icon: '◉', count: hasAny ? (concerns.length + (summaryPoints ? 1 : 0)) : 0 },
      { id: 'tasks', label: 'タスク', icon: '✓', count: tasks.length },
      { id: 'full', label: '全文', icon: '◧', count: transcript ? Math.ceil(transcript.length / 100) + 'p' : 0 },
    ];

    // タスク priority → 色マッピング (左ボーダー)
    const priColor = (p) => {
      if (/至急|即/.test(p || '')) return '#B91C3C';
      if (/今週|today|今日/i.test(p || '')) return '#9A5A18';
      if (/3ヶ月|three.month/i.test(p || '')) return '#5B21B6';
      if (/半年|6.month/i.test(p || '')) return '#1E3A5F';
      return '#6B7280';
    };

    const html = `
      <div class="modal-header" style="border-bottom:1px solid #E8E2D4;background:linear-gradient(180deg,#fdfbf4,#fff);">
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div style="font-size:10.5px;font-weight:700;color:#9A5A18;letter-spacing:0.22em;text-transform:uppercase;font-family:'Inter',sans-serif;">Meeting Minutes</div>
          <h2 style="font-family:'Noto Serif JP',serif;font-size:19px;font-weight:700;color:#1F2A3F;margin:0;letter-spacing:0.02em;">${escapeHtml(title || '議事録')}</h2>
        </div>
        <button class="modal-close" id="tr-close">×</button>
      </div>
      <div class="modal-body" style="padding:0;">
        <!-- サブタブ inline -->
        <div id="tr-tabs" style="display:flex;gap:0;border-bottom:1px solid #E8E2D4;background:#fff;padding:0 22px;">
          ${tabs.map(t => `
            <button data-tr-tab="${t.id}" class="tr-tab" style="background:transparent;border:none;padding:14px 18px 12px;font-family:'Hiragino Sans',sans-serif;font-size:13px;font-weight:700;color:#6B7280;cursor:pointer;border-bottom:3px solid transparent;letter-spacing:0.04em;display:inline-flex;align-items:center;gap:7px;">
              <span style="font-size:14px;opacity:0.8;">${t.icon}</span>
              ${t.label}
              ${t.count ? `<span style="background:#F0EBDF;color:#9A5A18;font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:99px;font-family:'Inter',sans-serif;">${t.count}</span>` : ''}
            </button>
          `).join('')}
        </div>

        <!-- 要約 panel -->
        <div id="tr-panel-summary" data-tr-panel="summary" style="display:none;padding:24px 28px;max-height:560px;overflow-y:auto;">
          ${hasAny ? `
            ${summary ? `
              <div style="background:linear-gradient(135deg,#FBF5E3,#FDFBF4);border:1px solid #E8D9A8;border-left:3px solid #C19A3A;border-radius:10px;padding:18px 22px;margin-bottom:14px;">
                <div style="font-size:10px;font-weight:800;color:#9A5A18;letter-spacing:0.18em;margin-bottom:6px;">TODAY'S THEME</div>
                <div style="font-family:'Noto Serif JP',serif;font-size:15.5px;font-weight:600;color:#1F2A3F;line-height:1.75;">${escapeHtml(summary)}</div>
              </div>
            ` : ''}
            ${concerns.length ? `
              <div style="margin-bottom:14px;">
                <div style="font-size:10px;font-weight:800;color:#9A5A18;letter-spacing:0.18em;margin-bottom:8px;">CONCERNS · お客様の懸念</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  ${concerns.map(c => `<span style="background:#1F2A3F;color:#FCFAF2;font-family:'Hiragino Sans',sans-serif;font-weight:700;font-size:11.5px;padding:5px 12px;border-radius:99px;">${escapeHtml(c)}</span>`).join('')}
                </div>
              </div>
            ` : ''}
            ${summaryPoints ? `
              <div style="background:#fff;border:1px solid #E8E2D4;border-radius:10px;padding:18px 22px;margin-bottom:14px;">
                <div style="font-size:10px;font-weight:800;color:#9A5A18;letter-spacing:0.18em;margin-bottom:8px;">SUMMARY · ポイント</div>
                <div style="font-family:'Hiragino Sans',sans-serif;font-size:13.5px;color:#1F2A3F;line-height:1.85;white-space:pre-wrap;">${escapeHtml(summaryPoints)}</div>
              </div>
            ` : ''}
            ${nextMeeting ? `
              <div style="background:#F0FDF4;border:1px solid #86EFAC;border-left:3px solid #065F46;border-radius:10px;padding:14px 18px;">
                <div style="font-size:10px;font-weight:800;color:#065F46;letter-spacing:0.18em;margin-bottom:6px;">NEXT MEETING</div>
                <div style="font-size:13px;color:#1F2A3F;line-height:1.7;">${escapeHtml(nextMeeting)}</div>
              </div>
            ` : ''}
          ` : '<div style="padding:40px;text-align:center;color:#9CA3AF;font-size:13px;">要約はまだ生成されていません。 「全文」 タブで 文字起こしを確認できます。</div>'}
        </div>

        <!-- タスク panel -->
        <div id="tr-panel-tasks" data-tr-panel="tasks" style="display:none;padding:24px 28px;max-height:560px;overflow-y:auto;">
          ${tasks.length ? tasks.map(t => `
            <div style="background:#fff;border:1px solid #E8E2D4;border-left:4px solid ${priColor(t.priority)};border-radius:10px;padding:16px 20px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:8px;">
                <strong style="font-family:'Hiragino Sans',sans-serif;font-size:14px;color:#1F2A3F;line-height:1.4;flex:1;">${escapeHtml(t.task || '')}</strong>
                <span style="font-size:10.5px;font-weight:800;color:${priColor(t.priority)};letter-spacing:0.08em;white-space:nowrap;font-family:'Hiragino Sans',sans-serif;">${escapeHtml(t.priority || '')}${t.dueDate ? ' · ' + escapeHtml(t.dueDate) : ''}</span>
              </div>
              ${t.recommendedAction ? `<div style="font-size:12px;color:#5e4d1a;background:#FBF5E3;border-radius:6px;padding:9px 13px;line-height:1.7;margin-bottom:${t.lineDraft ? '8px' : '0'};">${escapeHtml(t.recommendedAction)}</div>` : ''}
              ${t.lineDraft ? `
                <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:6px;padding:10px 13px;font-size:12px;color:#065F46;line-height:1.7;white-space:pre-wrap;margin-bottom:8px;">${escapeHtml(t.lineDraft)}</div>
                <button class="btn-mini-action is-line" data-tr-copy-draft="${escapeHtml(t.lineDraft).replace(/&quot;/g, '&#34;')}"><span class="icon">📋</span>LINE文案コピー</button>
              ` : ''}
            </div>
          `).join('') : '<div style="padding:40px;text-align:center;color:#9CA3AF;font-size:13px;">タスクはまだ抽出されていません。</div>'}
        </div>

        <!-- 全文 panel -->
        <div id="tr-panel-full" data-tr-panel="full" style="display:none;padding:24px 28px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div style="font-size:10px;font-weight:800;color:#9A5A18;letter-spacing:0.18em;">FULL TRANSCRIPT · 文字起こし全文 (${transcript.length}文字)</div>
            <button class="btn-mini-action" id="tr-copy"><span class="icon">📋</span>全文コピー</button>
          </div>
          <div style="background:#fafbfc;border:1px solid #E8E2D4;border-radius:8px;padding:20px 24px;font-family:'Hiragino Sans',monospace;font-size:13px;line-height:1.95;white-space:pre-wrap;max-height:520px;overflow-y:auto;letter-spacing:0.02em;color:#1F2A3F;">${escapeHtml(transcript) || '<span style="color:#9CA3AF;">文字起こしがありません</span>'}</div>
        </div>

        <div style="padding:14px 28px;border-top:1px solid #E8E2D4;display:flex;justify-content:space-between;align-items:center;background:#fafaf7;">
          <div id="tr-msg" style="font-size:11.5px;color:#6B7280;"></div>
          <button class="btn-cta-ghost" id="tr-close-btn">閉じる</button>
        </div>
      </div>
      <style>
        .tr-tab.is-active { color: #1F2A3F !important; border-bottom-color: #C19A3A !important; }
        .tr-tab:hover:not(.is-active) { color: #1F2A3F !important; }
      </style>
    `;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'flex';
    const close = () => { document.getElementById('modal-overlay').style.display = 'none'; };
    document.getElementById('tr-close').addEventListener('click', close);
    document.getElementById('tr-close-btn').addEventListener('click', close);

    // タブ切替
    const switchTab = (id) => {
      document.querySelectorAll('.tr-tab').forEach(b => b.classList.toggle('is-active', b.dataset.trTab === id));
      document.querySelectorAll('[data-tr-panel]').forEach(p => p.style.display = p.dataset.trPanel === id ? 'block' : 'none');
    };
    document.querySelectorAll('.tr-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.trTab)));
    switchTab(defaultTab);

    // 全文コピー
    const copyBtn = document.getElementById('tr-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(transcript);
      document.getElementById('tr-msg').textContent = '✓ クリップボードにコピーしました';
      setTimeout(() => { document.getElementById('tr-msg').textContent = ''; }, 2200);
    });
    // タスク内 LINE文案コピー
    document.querySelectorAll('[data-tr-copy-draft]').forEach(b => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.trCopyDraft);
        document.getElementById('tr-msg').textContent = '✓ LINE文案をコピーしました';
        setTimeout(() => { document.getElementById('tr-msg').textContent = ''; }, 2200);
      });
    });
  }

  function showAnswersDetail(bookingId) {
    const b = window.UPCOMING_BOOKINGS.find(x => x.id === bookingId);
    if (!b) return;
    const form = window.LEAD_FORM;
    const html = `
      <div class="modal-header">
        <h2>📝 アンケート回答 — ${escapeHtml(b.name)}</h2>
        <button class="modal-close" id="ans-close">×</button>
      </div>
      <div class="modal-body">
        <div style="background:#fafbfc;border:1px solid var(--line);border-radius:6px;padding:14px;">
          ${form.questions.map((q, i) => `
            <div style="margin-bottom:12px;">
              <div style="font-size:11.5px;color:var(--muted);font-weight:600;margin-bottom:3px;">Q${i + 1}. ${escapeHtml(q.label)}</div>
              <div style="font-size:14px;font-weight:600;color:var(--ink);">${escapeHtml(b.answers[q.id] || '—')}</div>
            </div>
          `).join('')}
        </div>
        <div style="margin-top:14px;font-size:12.5px;color:var(--muted);">
          📅 面談予約: ${escapeHtml(b.date)} ${escapeHtml(b.time)} (${escapeHtml(b.via)})
        </div>
      </div>
    `;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('ans-close').addEventListener('click', () => {
      document.getElementById('modal-overlay').style.display = 'none';
    });
  }

  function showConvertResult(newClient) {
    const html = `
      <div class="modal-header">
        <h2>✓ 新規顧客として登録しました</h2>
        <button class="modal-close" id="conv-close">×</button>
      </div>
      <div class="modal-body">
        <div style="background:#e6f7ee;border:1px solid #b8e3c8;border-radius:8px;padding:14px;margin-bottom:14px;">
          <div style="font-weight:700;font-size:15px;color:#06873f;margin-bottom:4px;">${escapeHtml(newClient.name)} 様</div>
          <div style="font-size:12.5px;color:var(--ink-2);">CRMの顧客一覧に追加されました。アンケート回答もメモに自動転記済み。</div>
        </div>
        <div style="background:#fafbfc;border:1px solid var(--line);border-radius:6px;padding:12px;">
          <div style="font-size:11.5px;color:var(--muted);font-weight:600;margin-bottom:4px;">自動登録された内容</div>
          <div style="font-family:ui-monospace,Menlo,monospace;font-size:11.5px;white-space:pre-wrap;color:var(--ink-2);line-height:1.6;">${escapeHtml(newClient.note)}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="primary" id="conv-open">顧客詳細を開く</button>
          <button id="conv-close-btn">閉じる</button>
        </div>
      </div>
    `;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'flex';
    function close() { document.getElementById('modal-overlay').style.display = 'none'; }
    document.getElementById('conv-close').addEventListener('click', close);
    document.getElementById('conv-close-btn').addEventListener('click', close);
    document.getElementById('conv-open').addEventListener('click', () => {
      close();
      window.FpApp && window.FpApp.openClientModal && window.FpApp.openClientModal(newClient.id);
    });
  }

  // ============================
  // 配信ダッシュボード
  // ============================
  // ★ 今日 送るべきメッセージ案を組み立て (= 承認リスト)
  // 1) 今日が誕生日のお客様 / 2) 60日以上未接触 / 3) 月1お役立ち(月初) / 4) 季節挨拶日
  function buildTodayMessageQueue() {
    const queue = [];
    const today = new Date();
    today.setHours(0,0,0,0);
    const clients = window.DUMMY_CLIENTS || [];
    const fpName = (window.__fp?.tenantName || 'FP').replace(/ — DEMO ビュー/, '');
    const skipped = (function(){ try { return JSON.parse(localStorage.getItem('fp-msg-skipped-' + today.toISOString().slice(0,10)) || '[]'); } catch(_) { return []; } })();
    const sent = (function(){ try { return JSON.parse(localStorage.getItem('fp-msg-sent-' + today.toISOString().slice(0,10)) || '[]'); } catch(_) { return []; } })();
    const isHandled = (id) => skipped.includes(id) || sent.includes(id);

    // 1) 誕生日 (本人・家族)
    clients.forEach(c => {
      if (!c.lineFriendId) return;
      const targets = [];
      if (c.birth) {
        const b = new Date(c.birth);
        if (b.getMonth() === today.getMonth() && b.getDate() === today.getDate()) {
          targets.push({ personName: c.name, rel: '本人' });
        }
      }
      (c.family || []).forEach(m => {
        if (!m.birth) return;
        const b = new Date(m.birth);
        if (b.getMonth() === today.getMonth() && b.getDate() === today.getDate()) {
          targets.push({ personName: m.name, rel: m.rel === 'spouse' ? '奥様' : (m.rel === 'child' ? 'お子様' : 'ご家族') });
        }
      });
      targets.forEach((t, idx) => {
        const isSelf = t.rel === '本人';
        const id = 'bday-' + c.id + '-' + idx;
        if (isHandled(id)) return;
        const body = isSelf
          ? `${c.name}さん、お誕生日おめでとうございます 🎂\n\n日頃お任せいただき、 ありがとうございます。\n新しい一年が ${c.name}さんにとって 良い年になりますよう\nお祈りしております。\n— ${fpName}`
          : `${c.name}さん、いつもお世話になっております。\n\n本日は ${t.personName}様 (${t.rel}) の お誕生日ですね。\n素敵な1日を お過ごしください 🎂\n\n— ${fpName}`;
        // ★ ディテール: 最終接触 + 保有商品 タグ + 次の打ち手
        const lastDays = c.lastContact ? Math.floor((today - new Date(c.lastContact)) / 86400000) : null;
        const autoTagsTxt = Array.isArray(c.autoTags) ? c.autoTags.slice(0, 3).map(t => t.label || t).join(' / ') : '';
        const ctxParts = [];
        if (lastDays != null) ctxParts.push(`最終接触 ${lastDays}日前`);
        else ctxParts.push('未接触');
        if (autoTagsTxt) ctxParts.push(`関心 ${autoTagsTxt}`);
        if (c.aum) ctxParts.push(`管理資産 ¥${Number(c.aum).toLocaleString()}`);
        queue.push({
          id, clientId: c.id, clientName: c.name,
          icon: '🎂',
          reason: isSelf ? '本日 お誕生日' : `${t.personName}様 (${t.rel}) のお誕生日`,
          category: '誕生日',
          why: ctxParts.join(' · '),
          nextAction: isSelf
            ? (lastDays != null && lastDays >= 60 ? '返信あれば 60分Zoom で 直近の家計レビュー の 機会に' : '返信あれば 誕生日割記念で 個別商品 のご案内 (任意)')
            : '返信あれば 教育費 / 老後資金 の話題 を 自然に展開',
          body,
        });
      });
    });

    // 2) 60日以上未接触 (1月のうち 1人につき 1回まで)
    const dormantMonthKey = 'fp-dormant-sent-' + today.toISOString().slice(0,7);
    const dormantThisMonth = (function(){ try { return JSON.parse(localStorage.getItem(dormantMonthKey) || '[]'); } catch(_) { return []; } })();
    clients.forEach(c => {
      if (!c.lineFriendId || !c.lastContact) return;
      const days = Math.floor((today - new Date(c.lastContact)) / 86400000);
      if (days < 60) return;
      if (dormantThisMonth.includes(c.id)) return;
      const id = 'dormant-' + c.id;
      if (isHandled(id)) return;
      // ★ ディテール: 前回提案 / 関心タグ / 直近イベント
      const lastProp = (c.proposals || []).slice().reverse()[0];
      const autoTagsTxt = Array.isArray(c.autoTags) ? c.autoTags.slice(0, 3).map(t => t.label || t).join(' / ') : '';
      const ctxParts = [`最終接触 ${days}日前`];
      if (lastProp) ctxParts.push(`前回提案 「${lastProp.title}」 (${lastProp.result})`);
      if (autoTagsTxt) ctxParts.push(`関心 ${autoTagsTxt}`);
      queue.push({
        id, clientId: c.id, clientName: c.name,
        icon: '🔔',
        reason: `${days}日 ご連絡 が空いています`,
        category: 'ご無沙汰',
        why: ctxParts.join(' · '),
        nextAction: days >= 180
          ? '返信あれば 関係再構築 の 30分 Zoom → 直近の生活変化 ヒアリング'
          : '返信あれば 候補日3つ で Zoom 設定 → 前回提案 のフォロー or 新テーマ',
        body: `${c.name}さん、 ご無沙汰しております 😊\n\nお元気でいらっしゃいますか?\n\n最近、 ${c.name}さんに お伝えしたい話題が\nいくつか出てきました。\n\nお時間ある時に 30分の Zoom でも\nお茶でも いかがでしょうか?\n\n候補日 3つ ご返信いただけると 助かります。\n— ${fpName}`,
      });
    });

    // 3) 月初 (1日) のお役立ち情報 (月1回 まとめて全LINE連携客 — ただし 1人 1メッセージ案として出す)
    const monthlyKey = 'fp-monthly-sent-' + today.toISOString().slice(0,7);
    const monthlySent = (function(){ try { return JSON.parse(localStorage.getItem(monthlyKey) || '[]'); } catch(_) { return []; } })();
    if (today.getDate() === 1) {
      const themes = ['新NISA 成長投資枠 の 賢い使い方', 'iDeCo を 始めるなら 知っておきたい3点', '教育費 の準備 シミュレーション', '住宅ローン 金利動向と借換の判断', '保険の見直しチェックリスト', '相続税 改正の影響', 'ふるさと納税 まだ間に合う?', '年末調整 で 損しないコツ', '生活防衛資金 の 適正額', 'NISA / iDeCo / 個別株 の使い分け', 'クレカ積立 の活用法', '年金繰下げ受給の判断'];
      const monthIdx = today.getMonth();
      const theme = themes[monthIdx];
      clients.forEach(c => {
        if (!c.lineFriendId) return;
        if (monthlySent.includes(c.id)) return;
        const id = 'monthly-' + c.id;
        if (isHandled(id)) return;
        const lastDays = c.lastContact ? Math.floor((today - new Date(c.lastContact)) / 86400000) : null;
        const ctxParts = [`月初一斉配信 / テーマ「${theme}」`];
        if (lastDays != null) ctxParts.push(`最終接触 ${lastDays}日前`);
        queue.push({
          id, clientId: c.id, clientName: c.name,
          icon: '📰',
          reason: `${today.getMonth()+1}月の お役立ち情報`,
          category: '月初配信',
          why: ctxParts.join(' · '),
          nextAction: '返信あれば 個別シミュ 作成 → 商品提案 / 別件あれば 自然に拡張',
          body: `${c.name}さん、こんにちは 🌷\n\n今月の お役立ち情報を お届けします。\n\n📌 ${theme}\n→ 3行 で まとめました。\nお時間ある時に ご覧ください 😊\n\n気になる点あれば LINE で お知らせください。\n— ${fpName}`,
        });
      });
    }

    return queue.slice(0, 12); // 1日12件 まで
  }

  function renderLineDashboard() {
    const subscribers = (window.DUMMY_CLIENTS || []).filter(c => c.lineSubscribed).length;
    const enabledSchedules = window.LINE_SCHEDULES.filter(s => s.enabled).length;
    const monthSent = window.LINE_LOG.reduce((s, l) => s + l.success, 0);
    const upcoming = window.LineCRM.upcomingBirthdays(30);
    const todayBirthdays = upcoming.filter(b => b.daysAhead === 0);
    const upcomingScheds = window.LINE_SCHEDULES
      .filter(s => s.enabled && s.nextSend && !s.nextSend.startsWith('—'))
      .sort((a, b) => a.nextSend.localeCompare(b.nextSend))
      .slice(0, 6);

    // ★ オーナーfb (v AK): 全自動配信は 50代FPに怖い → 「下書き承認制」 にメンタルモデル転換。
    // 今日送るべき下書きを毎朝AIが作って、FPは1件ずつ「✓送る」 を押す。 自動化は「設定タブ」 に隔離。
    const isFirstTime = enabledSchedules === 0;

    // ★ オーナーfb (v AJ): プリセットに「実際の文面」まで含める。何が送られるか一目で分かるように。
    // {name}, {fpName} は送信時に自動置換。 月1お役立ちは 12ヶ月分ローテーション。
    const presetScenarios = [
      {
        id: 'preset-birthday',
        emoji: '🎂',
        title: '誕生日メッセージ',
        subtitle: '当日の朝 9:00 に自動送信',
        cadence: '誕生日当日 9:00',
        segment: 'auto-birthday',
        why: 'もっとも返信率が高い接点。「覚えててくれた」 だけで信頼が育つ。',
        sample: `{name}さん、お誕生日おめでとうございます 🎂\n\n日頃お任せいただき、本当にありがとうございます。\n新しい一年が、{name}さんにとって 実り多い年に なりますよう お祈りしています。\n\nまた近いうちに 改めて お祝いさせてください ✨\n— {fpName}`,
      },
      {
        id: 'preset-monthly',
        emoji: '📰',
        title: '月1お役立ち情報',
        subtitle: '毎月1日 10:00 / 全顧客向け',
        cadence: '毎月 1日 10:00',
        segment: 'seg-all',
        why: '黙ってると忘れられる。月1で軽く存在感を保つだけで再接触率2倍。',
        sample: `{name}さん、こんにちは 🌷\n\n今月の お役立ち情報 1本 お届けします!\n\n📌 新NISA 成長投資枠 の 賢い使い方\n→ 240万円の枠を 個別株ではなく 投資信託に\n振り分けるべき理由を 3行で まとめました。\n\nお時間ある時に ご覧ください 😊\n何か気になる事あれば お気軽に LINE まで。\n— {fpName}`,
        note: '※ 月ごとにテーマ自動ローテーション (NISA / iDeCo / 教育費 / 住宅ローン / 保険 / 相続 / 確定申告 …)',
      },
      {
        id: 'preset-followup',
        emoji: '🔔',
        title: 'ご無沙汰フォロー',
        subtitle: '60日連絡なしの方に 月1',
        cadence: '毎月15日 10:00',
        segment: 'seg-dormant',
        why: '半年放置は「契約解消への助走」。60日で軽く声かけ → リスク回避。',
        sample: `{name}さん、ご無沙汰しております 😊\n\nお元気でいらっしゃいますか?\n\n最近、相続税の改正や 新NISA の追加情報など、\n{name}さんに お伝えしたいトピックが いくつかございます。\n\nお時間ある時に 30分の Zoom でも、\nお茶でもいかがでしょうか?\n\n候補日3つ ご返信いただけると \nこちらで調整しますね 🗓\n— {fpName}`,
      },
      {
        id: 'preset-newyear',
        emoji: '🎍',
        title: '季節のご挨拶',
        subtitle: '元旦・お盆・年末 の年3回',
        cadence: '元旦/お盆/年末',
        segment: 'seg-all',
        why: '日本人の信頼関係の基本。「年賀状の代わり」 で十分。手軽。',
        sample: `{name}さん、明けまして おめでとうございます 🎍\n\n旧年中は 大変お世話に なりました。\n本年も {name}さんの 暮らしと家計に\n寄り添える FP でありたいと思います。\n\nどうぞ よろしくお願いいたします。\n\n— {fpName}`,
        note: '※ 元旦/お盆/年末 で文面が自動切替',
      },
    ];

    const cadenceVisual = (cadence) => {
      const m = (cadence || '').match(/毎月\s*(\d+)\s*日/);
      if (m) return `<div class="fp-cadence-mini">毎月<strong>${m[1]}</strong>日</div>`;
      if (/毎週/.test(cadence)) return `<div class="fp-cadence-mini">毎週</div>`;
      if (/誕生日/.test(cadence)) return `<div class="fp-cadence-mini">🎂</div>`;
      return `<div class="fp-cadence-mini" style="font-size:9.5px;">${escapeHtml((cadence || '').slice(0, 8))}</div>`;
    };

    // ★ 今日 FP が送るべきメッセージ案を組み立てる
    const todayMessages = buildTodayMessageQueue();
    const todayDateLabel = (function(){
      const d = new Date();
      const weekday = ['日','月','火','水','木','金','土'][d.getDay()];
      return `${d.getMonth()+1}月${d.getDate()}日 (${weekday})`;
    })();
    const fpHandleName = ((window.__fp?.tenantName || '').match(/^[^\s—\-]+/) || ['先生'])[0];

    // ★ オーナーfb (v AL): もっと簡単に。 ヒーローを 1行 タイトル に縮小。
    const heroHtml = todayMessages.length === 0 ? `
      <div class="fp-dist-simple-empty">
        <div class="fp-dist-simple-empty-mark">🌿</div>
        <h2>今日 送る方は いません</h2>
        <p>明日朝 また 下書き 出します</p>
      </div>
    ` : `
      <div class="fp-dist-simple-head">
        <h1>今日 送るお客様 <span class="fp-dist-simple-count">${todayMessages.length}名</span></h1>
        <p>緑のボタンで 送信</p>
      </div>
    `;

    const html = `
      ${heroHtml}

      <!-- 今日 送るメッセージ案 (承認リスト v AL: 簡素化) -->
      ${todayMessages.length > 0 ? `
      <div class="fp-today-list">
        ${todayMessages.map((m, i) => `
          <article class="fp-today-card-v2" data-msg-id="${escapeHtml(m.id)}" style="animation-delay:${i*70}ms;">
            <header class="fp-today-v2-head">
              <div class="fp-today-v2-name">${escapeHtml(m.clientName)} <span>さん</span></div>
              <div class="fp-today-v2-reason">${m.icon} ${escapeHtml(m.reason)}</div>
            </header>
            ${m.why ? `
              <div style="background:#FFFBEB;border:1.5px solid #FCD34D;border-radius:10px;padding:11px 14px;margin-bottom:12px;display:flex;gap:10px;align-items:flex-start;">
                <span style="font-size:14px;flex-shrink:0;line-height:1.4;">💡</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:10.5px;font-weight:900;color:#B45309;letter-spacing:0.08em;margin-bottom:3px;">なぜ 今 この人に</div>
                  <div style="font-size:13px;font-weight:700;color:#0F172A;line-height:1.55;">${escapeHtml(m.why)}</div>
                </div>
              </div>
            ` : ''}
            <div style="font-size:10.5px;font-weight:900;color:#475569;letter-spacing:0.08em;margin-bottom:5px;text-transform:uppercase;">📝 送る本文</div>
            <div class="fp-today-v2-bubble">${escapeHtml(m.body).replace(/\n/g, '<br>')}</div>
            ${m.nextAction ? `
              <div style="background:linear-gradient(135deg,#F0F9FF,#E0F2FE);border:1.5px solid #7DD3FC;border-radius:10px;padding:11px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:flex-start;">
                <span style="font-size:14px;flex-shrink:0;line-height:1.4;">→</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:10.5px;font-weight:900;color:#0369A1;letter-spacing:0.08em;margin-bottom:3px;">送ったあと の 次の打ち手</div>
                  <div style="font-size:13px;font-weight:700;color:#0F172A;line-height:1.55;">${escapeHtml(m.nextAction)}</div>
                </div>
              </div>
            ` : ''}
            <button class="fp-today-v2-send" data-send="${escapeHtml(m.id)}">
              <span class="fp-today-v2-send-icon">📤</span>
              <span>このまま LINE で送る</span>
            </button>
            <div class="fp-today-v2-sub-actions">
              <button data-edit="${escapeHtml(m.id)}">✏ 文面を直す</button>
              <span>・</span>
              <button data-skip="${escapeHtml(m.id)}">今回はスキップ</button>
            </div>
          </article>
        `).join('')}
      </div>
      ` : ''}

      <!-- 設定 (折り畳み): よく使うシナリオを いつもの予定として登録 -->
      <details class="fp-dist-fold">
        <summary>
          <span class="fp-dist-fold-icon">⚙</span>
          <div>
            <strong>いつも送る予定を 登録する</strong>
            <span>誕生日や 月1お役立ち など、 毎月決まったタイミングで <br class="fp-dist-fold-br">送る予定を登録しておくと、 朝の承認リストに 自動で並びます。</span>
          </div>
          <span class="fp-dist-fold-chev">▾</span>
        </summary>
        <div class="fp-dist-fold-body">
          <div class="fp-dist-presets">
            ${presetScenarios.map((p, i) => `
              <div class="fp-dist-preset-card" style="animation-delay:${i*60}ms;">
                <div class="fp-dist-preset-head">
                  <div class="fp-dist-preset-emoji">${p.emoji}</div>
                  <div class="fp-dist-preset-titleblock">
                    <div class="fp-dist-preset-title">${escapeHtml(p.title)}</div>
                    <div class="fp-dist-preset-sub">${escapeHtml(p.subtitle)}</div>
                  </div>
                  <div class="fp-dist-preset-cadence-tag">${escapeHtml(p.cadence)}</div>
                </div>
                <div class="fp-dist-preset-why">${escapeHtml(p.why)}</div>
                <div class="fp-line-preview">
                  <div class="fp-line-preview-header">
                    <span class="fp-line-preview-dot"></span>
                    <span>お客様の LINE に届く本文 (見本)</span>
                  </div>
                  <div class="fp-line-preview-bubble">${escapeHtml(p.sample).replace(/\\n/g, '<br>').replace(/\n/g, '<br>')}</div>
                  ${p.note ? `<div class="fp-line-preview-note">${escapeHtml(p.note)}</div>` : ''}
                </div>
                ${(function(){
                  // 該当者カウント (今すぐ送れる人数)
                  const clientList = window.DUMMY_CLIENTS || [];
                  const today = new Date(); today.setHours(0,0,0,0);
                  let count = 0;
                  if (p.id === 'preset-birthday') {
                    clientList.forEach(c => {
                      if (!c.lineFriendId) return;
                      if (c.birth) { const b=new Date(c.birth); if(b.getMonth()===today.getMonth()&&b.getDate()===today.getDate()) count++; }
                      (c.family||[]).forEach(m => { if(!m.birth) return; const b=new Date(m.birth); if(b.getMonth()===today.getMonth()&&b.getDate()===today.getDate()) count++; });
                    });
                  } else if (p.id === 'preset-followup') {
                    clientList.forEach(c => {
                      if (!c.lineFriendId || !c.lastContact) return;
                      const days = Math.floor((today - new Date(c.lastContact)) / 86400000);
                      if (days >= 60) count++;
                    });
                  } else if (p.id === 'preset-monthly') {
                    count = clientList.filter(c => c.lineFriendId).length;
                  } else if (p.id === 'preset-newyear') {
                    count = clientList.filter(c => c.lineFriendId).length;
                  }
                  return `<div class="fp-dist-preset-count">現在 <strong>${count}名</strong> が 該当しています</div>`;
                })()}
                <div class="fp-dist-preset-actions">
                  <button class="fp-dist-preset-now" data-preset-now="${p.id}">📤 今すぐ 該当者に 送る</button>
                  <button class="fp-dist-preset-add" data-preset="${p.id}">毎回 自動で やる</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </details>

      <!-- いま登録されてる予定 (デフォルト 折りたたみ — 開いた時に各予定もコンパクト表示) -->
      ${enabledSchedules > 0 ? `
      <details class="fp-dist-fold">
        <summary>
          <span class="fp-dist-fold-icon">📋</span>
          <div>
            <strong>いま登録されてる予定 (${enabledSchedules}件)</strong>
            <span>クリックで一覧表示 / 各行クリックで本文編集</span>
          </div>
          <span class="fp-dist-fold-chev">▾</span>
        </summary>
        <div class="fp-dist-fold-body">
        <div class="fp-dist-sched-list">
          ${window.LINE_SCHEDULES.filter(s => s.enabled).map(s => {
            const seg = window.SEGMENTS.find(x => x.id === s.segment);
            const recipients = seg ? window.LineCRM.evaluateSegment(seg.id).length : (s.segment === 'auto-birthday' ? todayBirthdays.length : 0);
            const tpl = (window.LINE_TEMPLATES || []).find(t => t.id === s.templateId);
            const bodyText = (s.body || (tpl && tpl.body) || '').replace(/\{\{name\}\}/g, 'お客様').replace(/\{name\}/g, 'お客様').replace(/\{\{fp_name\}\}/g, 'FP').replace(/\{fpName\}/g, 'FP').replace(/\{\{[^}]+\}\}/g, '…');
            const cadenceText = s.schedule || '';
            return `
              <button class="fp-dist-sched-row" data-preview-schid="${escapeHtml(s.id)}" title="クリックで本文編集">
                <span class="fp-dist-sched-row-cadence">${escapeHtml(cadenceText.slice(0, 18) || '—')}</span>
                <span class="fp-dist-sched-row-name">${escapeHtml(s.name)}</span>
                <span class="fp-dist-sched-row-seg">${seg ? seg.icon : '🎂'}</span>
                <span class="fp-dist-sched-row-count">${recipients}名</span>
                <span class="fp-dist-sched-row-next">${escapeHtml((s.nextSend || '').slice(5))}</span>
                <span class="fp-dist-sched-row-arrow">›</span>
              </button>
            `;
          }).join('')}
        </div>
        </div>
      </details>` : ''}

      <!-- 直近1週間の誕生日 (折り畳み: 予告) -->
      ${upcoming.filter(b => b.daysAhead <= 7 && b.daysAhead > 0).length > 0 ? `
      <details class="fp-dist-fold">
        <summary>
          <span class="fp-dist-fold-icon">🎂</span>
          <div>
            <strong>このあと1週間で 誕生日のお客様 (${upcoming.filter(b => b.daysAhead <= 7 && b.daysAhead > 0).length}名)</strong>
            <span>当日の朝になったら 承認リストに自動で並びます。</span>
          </div>
          <span class="fp-dist-fold-chev">▾</span>
        </summary>
        <div class="fp-dist-fold-body">
        <div class="fp-dist-bday-list">
          ${upcoming.filter(b => b.daysAhead <= 7 && b.daysAhead > 0).map(b => `
            <div class="fp-dist-bday-row">
              <div class="fp-dist-bday-date">
                <strong>${(b.date.getMonth() + 1)}/${b.date.getDate()}</strong>
                <span>${b.daysAhead}日後</span>
              </div>
              <div class="fp-dist-bday-main">
                <strong>${escapeHtml(b.personName)}</strong> <span class="fp-dist-bday-rel">${b.rel}</span>
                <div>${b.age}歳 / 顧客 ${escapeHtml(b.client.name)}</div>
              </div>
              <div class="fp-dist-bday-status"><span class="fp-dist-status-wait">予約済</span></div>
            </div>
          `).join('')}
        </div>
        </div>
      </details>` : ''}

      <style>
      /* === Distribution Dashboard v AI === */
      .fp-dist-hero {
        background: linear-gradient(135deg, #FDFBF4 0%, #FAF8F1 100%);
        border: 1px solid #E8E2D4;
        border-radius: 14px;
        padding: 36px 36px 30px;
        margin-bottom: 22px;
        position: relative;
        overflow: hidden;
      }
      .fp-dist-hero::before {
        content: '';
        position: absolute; top: 0; right: 0;
        width: 220px; height: 220px;
        background: radial-gradient(circle at top right, rgba(193,154,58,0.10), transparent 70%);
        pointer-events: none;
      }
      .fp-dist-hero-eyebrow {
        font-family: 'Manrope', 'Inter', sans-serif;
        font-weight: 800; font-size: 10.5px;
        letter-spacing: 0.22em; text-transform: uppercase;
        color: #C19A3A; margin-bottom: 12px;
      }
      .fp-dist-hero-title {
        font-family: 'Noto Serif JP', serif;
        font-weight: 700; font-size: 28px;
        line-height: 1.35; letter-spacing: -0.01em;
        color: #1F1A12; margin: 0 0 12px 0;
      }
      .fp-dist-hero-sub {
        font-family: 'Noto Sans JP', sans-serif;
        font-size: 13.5px; line-height: 1.85;
        color: #5E5648; margin: 0 0 14px 0; max-width: 60ch;
      }
      .fp-dist-hero-arrow {
        font-family: 'Manrope', sans-serif;
        font-weight: 700; font-size: 12px;
        letter-spacing: 0.1em; color: #C19A3A;
        animation: fp-dist-arrow-pulse 1.8s ease-in-out infinite;
      }
      @keyframes fp-dist-arrow-pulse { 0%,100%{transform:translateY(0);opacity:0.85} 50%{transform:translateY(4px);opacity:1} }

      .fp-dist-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
      .fp-dist-kpi {
        background: #fff; border: 1px solid #E8E2D4;
        border-radius: 10px; padding: 14px 18px;
        position: relative; overflow: hidden;
      }
      .fp-dist-kpi-on { background: linear-gradient(135deg,#F0FDF4,#FFF); border-color: #86EFAC; }
      .fp-dist-kpi-warn { background: linear-gradient(135deg,#FFF7ED,#FFF); border-color: #FED7AA; }
      .fp-dist-kpi-eyebrow {
        font-family: 'Manrope', sans-serif;
        font-weight: 700; font-size: 10px;
        letter-spacing: 0.16em; text-transform: uppercase;
        color: #8B7D5D; margin-bottom: 6px;
      }
      .fp-dist-kpi-num {
        font-family: 'Noto Serif JP', serif;
        font-weight: 700; font-size: 28px;
        color: #1F1A12; letter-spacing: -0.012em;
        line-height: 1; font-variant-numeric: tabular-nums;
      }
      .fp-dist-kpi-unit { font-family: 'Noto Sans JP', sans-serif; font-size: 11px; color: #8B7D5D; font-weight: 600; margin-left: 4px; }
      .fp-dist-kpi-sub { font-size: 10.5px; color: #8B7D5D; margin-top: 5px; }

      .fp-dist-section { margin-bottom: 32px; }
      .fp-dist-section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; gap: 16px; }
      .fp-dist-eyebrow {
        font-family: 'Manrope', sans-serif;
        font-weight: 700; font-size: 10.5px;
        letter-spacing: 0.22em; color: #C19A3A;
        text-transform: uppercase; margin-bottom: 5px;
      }
      .fp-dist-section-title {
        font-family: 'Noto Serif JP', serif;
        font-weight: 700; font-size: 19px;
        color: #1F1A12; margin: 0; letter-spacing: -0.01em;
      }
      .fp-dist-section-sub { font-size: 11.5px; color: #8B7D5D; max-width: 38ch; text-align: right; line-height: 1.6; margin: 0; }

      .fp-dist-presets { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
      .fp-dist-preset-card {
        background: #fff; border: 1px solid #E8E2D4;
        border-radius: 14px; padding: 22px 22px 18px;
        transition: all 0.2s ease;
        font-family: inherit;
        animation: fp-dist-preset-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        position: relative; overflow: hidden;
      }
      .fp-dist-preset-card::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
        background: linear-gradient(90deg, #C19A3A, transparent 60%);
        opacity: 0.5;
      }
      @keyframes fp-dist-preset-in { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
      .fp-dist-preset-card:hover {
        border-color: #C19A3A;
        box-shadow: 0 12px 32px rgba(193,154,58,0.12);
      }
      .fp-dist-preset-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 10px; }
      .fp-dist-preset-emoji { font-size: 34px; line-height: 1; flex-shrink: 0; }
      .fp-dist-preset-titleblock { flex: 1; min-width: 0; }
      .fp-dist-preset-title {
        font-family: 'Noto Serif JP', serif;
        font-weight: 700; font-size: 16px;
        color: #1F1A12; letter-spacing: -0.005em;
        margin-bottom: 3px;
      }
      .fp-dist-preset-sub {
        font-family: 'Manrope', 'Noto Sans JP', sans-serif;
        font-size: 11px; color: #8B7D5D;
        font-weight: 600; letter-spacing: 0.02em;
      }
      .fp-dist-preset-cadence-tag {
        flex-shrink: 0; font-family: 'Manrope', sans-serif;
        font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
        color: #C19A3A; background: #FDFBF4;
        border: 1px solid #E8C56F; padding: 5px 10px; border-radius: 999px;
      }
      .fp-dist-preset-why {
        font-size: 12px; line-height: 1.7;
        color: #5E5648; margin-bottom: 14px;
        padding-bottom: 14px; border-bottom: 1px dashed #E8E2D4;
      }

      /* LINE 風プレビュー */
      .fp-line-preview {
        background: linear-gradient(180deg, #F1F5F9, #E2E8F0);
        border-radius: 10px; padding: 14px;
        margin-bottom: 14px;
      }
      .fp-line-preview-header {
        display: flex; align-items: center; gap: 7px;
        font-family: 'Manrope', sans-serif;
        font-weight: 700; font-size: 10px;
        letter-spacing: 0.1em; color: #475569;
        text-transform: uppercase; margin-bottom: 10px;
      }
      .fp-line-preview-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #06C755; box-shadow: 0 0 6px rgba(6,199,85,0.5);
      }
      .fp-line-preview-bubble {
        background: #fff; border-radius: 14px 14px 14px 3px;
        padding: 12px 14px;
        font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif;
        font-size: 12.5px; line-height: 1.75;
        color: #0F172A; white-space: pre-wrap;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }
      .fp-line-preview-note {
        margin-top: 8px; font-size: 10.5px;
        color: #64748B; font-style: italic; line-height: 1.55;
      }

      .fp-dist-preset-count {
        font-size: 12px; color: #5E5648; margin-bottom: 12px;
        padding: 10px 12px; background: #FDFBF4;
        border: 1px solid #E8E2D4; border-radius: 8px;
        text-align: center;
      }
      .fp-dist-preset-count strong {
        font-family: 'Noto Serif JP', serif;
        font-size: 16px; color: #C19A3A;
        font-weight: 700;
      }
      .fp-dist-preset-actions {
        display: flex; gap: 8px; flex-direction: column;
      }
      .fp-dist-preset-now {
        width: 100%;
        font-family: 'Noto Sans JP', 'Manrope', sans-serif;
        font-weight: 900; font-size: 14px;
        letter-spacing: 0.04em; color: #fff;
        background: linear-gradient(135deg, #06C755, #04A847);
        border: none; padding: 13px 14px; border-radius: 9px;
        cursor: pointer; transition: all 0.15s ease;
        box-shadow: 0 4px 14px rgba(6,199,85,0.32);
      }
      .fp-dist-preset-now:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 22px rgba(6,199,85,0.45);
      }
      .fp-dist-preset-add {
        width: 100%;
        font-family: 'Manrope', 'Noto Sans JP', sans-serif;
        font-weight: 700; font-size: 11.5px;
        letter-spacing: 0.04em; color: #5E5648;
        background: #fff; border: 1px solid #D6CDB6;
        padding: 10px 14px; border-radius: 8px;
        cursor: pointer; transition: all 0.15s ease;
      }
      .fp-dist-preset-add:hover { border-color: #C19A3A; color: #C19A3A; }
      .fp-dist-preset-edit {
        font-family: 'Manrope', 'Noto Sans JP', sans-serif;
        font-weight: 700; font-size: 11.5px;
        color: #5E5648;
        background: #fff; border: 1px solid #D6CDB6;
        padding: 11px 14px; border-radius: 8px;
        cursor: pointer; transition: all 0.15s ease;
        white-space: nowrap;
      }
      .fp-dist-preset-edit:hover { border-color: #C19A3A; color: #C19A3A; }

      .fp-dist-running-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
      /* ★ コンパクト1行リスト: 折りたたみ展開時の予定一覧 */
      .fp-dist-sched-list { display: flex; flex-direction: column; gap: 0; border: 1px solid #E8E2D4; border-radius: 8px; overflow: hidden; background: #fff; }
      .fp-dist-sched-row {
        display: grid;
        grid-template-columns: 100px 1fr 24px 60px 60px 16px;
        gap: 12px; align-items: center;
        background: transparent; border: none; border-bottom: 1px solid #F0EBDF;
        padding: 12px 16px; cursor: pointer;
        font-family: 'Hiragino Sans', sans-serif;
        text-align: left; transition: background .12s;
      }
      .fp-dist-sched-row:last-child { border-bottom: none; }
      .fp-dist-sched-row:hover { background: #FDFBF4; }
      .fp-dist-sched-row-cadence { font-size: 11px; color: #9A5A18; font-weight: 700; letter-spacing: 0.04em; font-family: 'Inter', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .fp-dist-sched-row-name { font-size: 13px; color: #1F2A3F; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .fp-dist-sched-row-seg { font-size: 14px; text-align: center; }
      .fp-dist-sched-row-count { font-size: 11.5px; color: #6B7280; font-weight: 600; text-align: right; font-family: 'Inter', sans-serif; }
      .fp-dist-sched-row-next { font-size: 10.5px; color: #94A3B8; font-weight: 600; text-align: right; font-family: 'Inter', sans-serif; white-space: nowrap; }
      .fp-dist-sched-row-arrow { font-size: 16px; color: #C19A3A; text-align: center; }
      .fp-dist-run-card {
        background: #fff; border: 1px solid #E8E2D4;
        border-radius: 10px; padding: 14px 16px;
        transition: all 0.15s ease;
      }
      .fp-dist-run-top {
        display: flex; align-items: center; gap: 14px;
      }
      .fp-dist-run-card:hover { border-color: #C19A3A; }
      .fp-dist-run-preview {
        margin-top: 12px; padding: 10px 12px;
        background: #FDFBF4;
        border: 1px solid #F1ECDF;
        border-radius: 8px;
      }
      .fp-dist-run-preview-label {
        font-family: 'Manrope', sans-serif;
        font-weight: 800; font-size: 10px;
        letter-spacing: 0.16em;
        color: #8B7D5D; text-transform: uppercase;
        margin-bottom: 5px;
      }
      .fp-dist-run-preview-text {
        font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif;
        font-size: 11.5px; line-height: 1.65;
        color: #1F1A12; margin-bottom: 7px;
      }
      .fp-dist-run-preview-btn {
        background: transparent; border: none;
        color: #C19A3A;
        font-family: 'Manrope', 'Noto Sans JP', sans-serif;
        font-weight: 700; font-size: 11px;
        letter-spacing: 0.04em;
        padding: 0; cursor: pointer;
        text-decoration: underline;
      }
      .fp-dist-run-preview-btn:hover { color: #B8893D; }
      .fp-dist-run-preview-empty {
        font-size: 11px; color: #DC2626;
        font-family: 'Manrope', 'Noto Sans JP', sans-serif;
        font-weight: 700;
        background: #FEF2F2; border-color: #FCA5A5;
      }
      .fp-cadence-mini {
        flex-shrink: 0; width: 56px; height: 56px;
        background: linear-gradient(135deg, #FDFBF4, #FAF6E8);
        border: 1px solid #E8E2D4; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 0;
        font-family: 'Manrope', sans-serif;
        font-weight: 700; font-size: 10px;
        color: #8B7D5D; text-align: center; line-height: 1.2;
      }
      .fp-cadence-mini strong { font-family: 'Noto Serif JP', serif; font-size: 19px; color: #C19A3A; font-weight: 700; }
      .fp-dist-run-main { flex: 1; min-width: 0; }
      .fp-dist-run-name { font-family: 'Noto Serif JP', serif; font-weight: 700; font-size: 14px; color: #1F1A12; margin-bottom: 4px; }
      .fp-dist-run-meta { font-size: 11.5px; color: #5E5648; margin-bottom: 4px; }
      .fp-dist-run-recipients { color: #8B7D5D; font-size: 10.5px; margin-left: 4px; }
      .fp-dist-run-next { font-size: 11px; color: #8B7D5D; font-family: 'Manrope', sans-serif; font-weight: 600; letter-spacing: 0.02em; }
      .fp-dist-run-toggle { color: #10B981; font-size: 11px; }

      .fp-dist-bday-list { background: #fff; border: 1px solid #E8E2D4; border-radius: 10px; overflow: hidden; }
      .fp-dist-bday-row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-bottom: 1px solid #F1ECDF; }
      .fp-dist-bday-row:last-child { border-bottom: 0; }
      .fp-dist-bday-date { flex-shrink: 0; min-width: 56px; }
      .fp-dist-bday-date strong { font-family: 'Noto Serif JP', serif; font-weight: 700; font-size: 16px; color: #1F1A12; display: block; line-height: 1.1; }
      .fp-dist-bday-date span { font-size: 10.5px; color: #C19A3A; font-weight: 700; letter-spacing: 0.04em; }
      .fp-dist-bday-main { flex: 1; min-width: 0; font-size: 12.5px; }
      .fp-dist-bday-main strong { font-family: 'Noto Serif JP', serif; font-weight: 700; color: #1F1A12; font-size: 13px; }
      .fp-dist-bday-rel { font-size: 10.5px; color: #8B7D5D; background: #FDFBF4; padding: 1px 7px; border-radius: 8px; margin-left: 5px; }
      .fp-dist-bday-main > div { color: #5E5648; margin-top: 2px; font-size: 11.5px; }
      .fp-dist-status-on { background: #ECFDF5; color: #047857; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
      .fp-dist-status-wait { background: #F1ECDF; color: #8B7D5D; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; }

      /* ===== v AL シンプル版 ===== */
      .fp-dist-simple-head {
        margin-bottom: 22px;
        padding-bottom: 18px;
        border-bottom: 1px solid #E8E2D4;
      }
      .fp-dist-simple-head h1 {
        font-family: 'Noto Sans JP', -apple-system, sans-serif;
        font-weight: 900; font-size: 30px;
        letter-spacing: -0.02em; color: #0F172A;
        margin: 0 0 8px 0; line-height: 1.3;
      }
      .fp-dist-simple-count {
        background: linear-gradient(135deg, #C19A3A, #B8893D);
        color: #fff;
        font-family: 'Manrope', sans-serif;
        font-size: 14px; font-weight: 800;
        letter-spacing: 0.04em;
        padding: 4px 12px;
        border-radius: 999px;
        margin-left: 8px;
        vertical-align: middle;
      }
      .fp-dist-simple-head p {
        font-family: 'Noto Sans JP', -apple-system, sans-serif;
        font-size: 16px; color: #475569;
        font-weight: 500;
        margin: 0; line-height: 1.6;
      }
      .fp-dist-simple-empty {
        background: linear-gradient(135deg, #F0FDF4, #DCFCE7);
        border: 1px solid #86EFAC;
        border-radius: 14px;
        padding: 50px 30px;
        text-align: center;
      }
      .fp-dist-simple-empty-mark { font-size: 48px; margin-bottom: 10px; }
      .fp-dist-simple-empty h2 {
        font-family: 'Noto Sans JP', -apple-system, sans-serif;
        font-weight: 900; font-size: 22px;
        color: #065F46; margin: 0 0 8px 0;
        letter-spacing: -0.01em;
      }
      .fp-dist-simple-empty p {
        font-family: 'Noto Sans JP', -apple-system, sans-serif;
        font-size: 15px; color: #047857;
        font-weight: 500;
        margin: 0; line-height: 1.6;
      }
      .fp-today-card-v2 {
        background: #fff;
        border: 1px solid #E8E2D4;
        border-radius: 14px;
        padding: 22px 24px 18px;
        margin-bottom: 16px;
        animation: fp-today-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      .fp-today-v2-head { margin-bottom: 14px; }
      .fp-today-v2-name {
        font-family: 'Noto Sans JP', -apple-system, sans-serif;
        font-weight: 900; font-size: 22px;
        color: #0F172A; letter-spacing: -0.015em;
        line-height: 1.25;
      }
      .fp-today-v2-name span {
        font-size: 15px; color: #64748B;
        font-weight: 600; margin-left: 4px;
      }
      .fp-today-v2-reason {
        font-family: 'Noto Sans JP', -apple-system, sans-serif;
        font-size: 13.5px; color: #B45309;
        font-weight: 800;
        background: #FFFBEB;
        border: 1px solid #FCD34D;
        display: inline-block;
        padding: 5px 12px;
        border-radius: 999px;
        margin-top: 8px;
        letter-spacing: 0.01em;
      }
      .fp-today-v2-bubble {
        background: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 10px;
        padding: 18px 20px;
        font-family: 'Noto Sans JP', 'Hiragino Sans', sans-serif;
        font-size: 16px;
        line-height: 1.85;
        color: #0F172A;
        font-weight: 500;
        margin-bottom: 18px;
        white-space: pre-wrap;
      }
      .fp-today-v2-send {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-family: 'Noto Sans JP', sans-serif;
        font-weight: 900;
        font-size: 19px;
        letter-spacing: 0.04em;
        color: #fff;
        background: linear-gradient(135deg, #06C755, #04A847);
        border: none;
        padding: 22px 28px;
        border-radius: 12px;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(6,199,85,0.32);
        transition: transform 0.12s ease, box-shadow 0.18s ease;
        min-height: 64px;
      }
      .fp-today-v2-send-icon { font-size: 18px; }
      .fp-today-v2-send:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 28px rgba(6,199,85,0.45);
      }
      .fp-today-v2-send:disabled {
        opacity: 0.6; cursor: wait;
      }
      .fp-today-v2-sub-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: center;
        margin-top: 12px;
        font-size: 11.5px;
        color: #8B7D5D;
      }
      .fp-today-v2-sub-actions button {
        background: transparent;
        border: none;
        color: #5E5648;
        font-family: inherit;
        font-size: 11.5px;
        cursor: pointer;
        text-decoration: underline;
        padding: 4px 6px;
      }
      .fp-today-v2-sub-actions button:hover { color: #C19A3A; }
      .fp-today-msg-done.fp-today-card-v2 { opacity: 0.4; pointer-events: none; }

      /* ===== 今日 のメッセージ承認リスト (v AK) ===== */
      .fp-dist-hero-date {
        font-family: 'Manrope', 'Inter', sans-serif;
        font-weight: 700; font-size: 10.5px;
        letter-spacing: 0.18em; text-transform: uppercase;
        color: #8B7D5D; margin-bottom: 10px;
      }
      .fp-today-list { display: grid; gap: 16px; }
      .fp-today-msg {
        background: #fff;
        border: 1px solid #E8E2D4;
        border-radius: 14px;
        padding: 22px 24px 18px;
        animation: fp-today-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        transition: border-color 0.2s ease, opacity 0.25s ease, transform 0.25s ease;
      }
      @keyframes fp-today-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      .fp-today-msg-head {
        display: flex; align-items: center; gap: 14px;
        margin-bottom: 14px;
      }
      .fp-today-avatar {
        width: 46px; height: 46px;
        border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Noto Serif JP', serif;
        font-weight: 700; font-size: 19px;
        letter-spacing: -0.02em;
      }
      .fp-today-who { flex: 1; min-width: 0; }
      .fp-today-name {
        font-family: 'Noto Serif JP', serif;
        font-weight: 700; font-size: 17px;
        color: #1F1A12; letter-spacing: -0.008em;
        line-height: 1.3;
      }
      .fp-today-honor {
        font-size: 12px; color: #8B7D5D;
        font-weight: 400; margin-left: 2px;
      }
      .fp-today-reason {
        font-size: 12px;
        color: #5E5648;
        margin-top: 3px;
        line-height: 1.5;
      }
      .fp-today-cat {
        flex-shrink: 0;
        font-family: 'Manrope', 'Noto Sans JP', sans-serif;
        font-weight: 700; font-size: 10.5px;
        letter-spacing: 0.06em;
        color: #C19A3A;
        background: #FDFBF4;
        border: 1px solid #E8C56F;
        padding: 5px 11px;
        border-radius: 999px;
      }
      .fp-today-bubble-wrap {
        position: relative;
        background: linear-gradient(180deg, #F1F5F9, #E2E8F0);
        border-radius: 10px;
        padding: 12px 14px 12px 18px;
        margin-bottom: 14px;
      }
      .fp-today-bubble {
        background: #fff;
        border-radius: 14px 14px 14px 3px;
        padding: 14px 16px;
        font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif;
        font-size: 13px;
        line-height: 1.85;
        color: #1F1A12;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      }
      .fp-today-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .fp-today-btn {
        font-family: 'Manrope', 'Noto Sans JP', sans-serif;
        font-weight: 700;
        font-size: 13px;
        letter-spacing: 0.04em;
        padding: 12px 18px;
        border-radius: 9px;
        cursor: pointer;
        transition: transform 0.12s ease, box-shadow 0.18s ease, background 0.18s ease;
        display: inline-flex; align-items: center; gap: 6px;
      }
      .fp-today-btn span { font-size: 14px; }
      .fp-today-btn-send {
        flex: 1; min-width: 0;
        color: #fff;
        background: linear-gradient(135deg, #06C755, #04A847);
        border: none;
        font-weight: 800;
        box-shadow: 0 4px 14px rgba(6,199,85,0.32);
      }
      .fp-today-btn-send:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 22px rgba(6,199,85,0.42);
      }
      .fp-today-btn-edit {
        color: #5E5648;
        background: #fff;
        border: 1px solid #D6CDB6;
      }
      .fp-today-btn-edit:hover {
        border-color: #C19A3A; color: #C19A3A;
      }
      .fp-today-btn-skip {
        color: #8B7D5D;
        background: transparent;
        border: 1px solid transparent;
        font-size: 12px;
        margin-left: auto;
      }
      .fp-today-btn-skip:hover {
        color: #5E5648;
        background: #FDFBF4;
        border-color: #E8E2D4;
      }
      .fp-today-msg-done {
        opacity: 0.45;
        background: #FAFAF6;
        pointer-events: none;
      }
      .fp-today-bulk {
        margin-top: 18px;
        padding: 18px 22px;
        background: linear-gradient(135deg, #1F1A12, #2C2419);
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 16px;
        color: #FAF8F1;
      }
      .fp-today-bulk strong {
        font-family: 'Noto Serif JP', serif;
        font-weight: 700;
        font-size: 15px;
        color: #FFE9A8;
        display: block;
        margin-bottom: 2px;
      }
      .fp-today-bulk span {
        font-size: 11.5px;
        color: rgba(250,248,241,0.7);
        line-height: 1.55;
      }
      .fp-today-bulk-btn {
        margin-left: auto;
        flex-shrink: 0;
        font-family: 'Manrope', 'Noto Sans JP', sans-serif;
        font-weight: 800;
        font-size: 13px;
        letter-spacing: 0.06em;
        color: #1F1A12;
        background: #FFE9A8;
        border: none;
        padding: 13px 22px;
        border-radius: 9px;
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.18s ease;
      }
      .fp-today-bulk-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 22px rgba(255,233,168,0.4);
      }
      .fp-today-empty {
        background: #FDFBF4;
        border: 1px dashed #D6CDB6;
        border-radius: 12px;
        padding: 40px 30px;
        text-align: center;
        color: #5E5648;
      }
      .fp-today-empty-mark {
        font-size: 30px;
        color: #C19A3A;
        margin-bottom: 8px;
      }
      .fp-today-empty p {
        font-size: 13px; line-height: 1.75; margin: 0;
      }

      /* ===== 折り畳み セクション ===== */
      .fp-dist-fold {
        background: #fff;
        border: 1px solid #E8E2D4;
        border-radius: 12px;
        margin-bottom: 14px;
        overflow: hidden;
      }
      .fp-dist-fold > summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px 20px;
        transition: background 0.15s ease;
      }
      .fp-dist-fold > summary::-webkit-details-marker { display: none; }
      .fp-dist-fold > summary:hover { background: #FDFBF4; }
      .fp-dist-fold-icon {
        font-size: 20px;
        flex-shrink: 0;
        width: 32px; height: 32px;
        background: #FDFBF4;
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
      }
      .fp-dist-fold > summary > div {
        flex: 1; min-width: 0;
      }
      .fp-dist-fold > summary > div > strong {
        font-family: 'Noto Serif JP', serif;
        font-weight: 700;
        font-size: 14px;
        color: #1F1A12;
        display: block;
        margin-bottom: 2px;
        letter-spacing: -0.005em;
      }
      .fp-dist-fold > summary > div > span {
        font-size: 11.5px;
        color: #8B7D5D;
        line-height: 1.55;
      }
      .fp-dist-fold-br { display: none; }
      .fp-dist-fold-chev {
        flex-shrink: 0;
        color: #8B7D5D;
        font-size: 14px;
        transition: transform 0.2s ease;
      }
      .fp-dist-fold[open] .fp-dist-fold-chev {
        transform: rotate(180deg);
      }
      .fp-dist-fold-body {
        padding: 4px 20px 20px;
        border-top: 1px solid #F1ECDF;
        margin-top: -4px;
      }

      @media (max-width: 800px) {
        .fp-dist-presets, .fp-dist-running-grid { grid-template-columns: 1fr; }
        .fp-dist-hero { padding: 24px 22px; }
        .fp-dist-hero-title { font-size: 22px; }
        .fp-dist-section-head { flex-direction: column; align-items: flex-start; }
        .fp-dist-section-sub { text-align: left; }
        .fp-today-msg { padding: 18px 18px 14px; }
        .fp-today-bulk { flex-direction: column; align-items: flex-start; }
        .fp-today-bulk-btn { margin-left: 0; width: 100%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .fp-today-msg, .fp-dist-preset-card, .fp-dist-hero-arrow { animation: none; }
      }
      </style>
    `;
    document.querySelector('[data-line-view="dashboard"]').innerHTML = html;

    // プリセット 1クリック追加 (そのまま追加)
    function addPresetToSchedules(preset, customBody) {
      const dup = window.LINE_SCHEDULES.find(s => s.name === preset.title);
      if (dup) {
        if (confirm(`「${preset.title}」 は既にあります。 「配信スケジュール」 タブに移動して編集しますか?`)) {
          document.querySelector('[data-line-sub="schedules"]')?.click();
        }
        return;
      }
      const tplId = 'tpl-preset-' + Date.now().toString(36);
      // テンプレ追加
      if (window.LINE_TEMPLATES) {
        window.LINE_TEMPLATES.push({
          id: tplId,
          name: preset.title + ' (テンプレ)',
          body: customBody || preset.sample,
          tags: [preset.id],
        });
      }
      const newSched = {
        id: 'sch-preset-' + Date.now().toString(36),
        name: preset.title,
        segment: preset.segment,
        templateId: tplId,
        cadence: preset.cadence.includes('毎月') ? 'monthly' : (preset.cadence.includes('誕生日') ? 'birthday' : 'event'),
        schedule: preset.cadence,
        enabled: true,
        lastSent: null,
        nextSend: preset.cadence,
        body: customBody || preset.sample,
      };
      window.LINE_SCHEDULES.push(newSched);
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#0F172A;color:#fff;padding:12px 22px;border-radius:8px;font-size:13px;font-weight:700;z-index:99999;box-shadow:0 12px 32px rgba(15,23,42,0.4);font-family:"Noto Sans JP",sans-serif;';
      toast.innerHTML = `✓ 「${escapeHtml(preset.title)}」 を自動配信に追加しました`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2400);
      renderLineDashboard();
    }

    // ===== 今日のメッセージ承認リスト 操作 =====
    const todayKey = new Date().toISOString().slice(0,10);
    const dormantMonthKey = 'fp-dormant-sent-' + new Date().toISOString().slice(0,7);
    const monthlyKey = 'fp-monthly-sent-' + new Date().toISOString().slice(0,7);
    function markSent(msgId, clientId) {
      try {
        const sent = JSON.parse(localStorage.getItem('fp-msg-sent-' + todayKey) || '[]');
        sent.push(msgId); localStorage.setItem('fp-msg-sent-' + todayKey, JSON.stringify(sent));
        if (msgId.startsWith('dormant-')) {
          const arr = JSON.parse(localStorage.getItem(dormantMonthKey) || '[]');
          if (!arr.includes(clientId)) { arr.push(clientId); localStorage.setItem(dormantMonthKey, JSON.stringify(arr)); }
        }
        if (msgId.startsWith('monthly-')) {
          const arr = JSON.parse(localStorage.getItem(monthlyKey) || '[]');
          if (!arr.includes(clientId)) { arr.push(clientId); localStorage.setItem(monthlyKey, JSON.stringify(arr)); }
        }
      } catch (_) {}
    }
    function markSkipped(msgId) {
      try {
        const arr = JSON.parse(localStorage.getItem('fp-msg-skipped-' + todayKey) || '[]');
        arr.push(msgId); localStorage.setItem('fp-msg-skipped-' + todayKey, JSON.stringify(arr));
      } catch (_) {}
    }
    function toast(text, kind) {
      const t = document.createElement('div');
      t.style.cssText = `position:fixed;top:24px;left:50%;transform:translateX(-50%);background:${kind === 'sent' ? '#1F1A12' : '#8B7D5D'};color:#fff;padding:12px 22px;border-radius:8px;font-size:13px;font-weight:700;z-index:99999;box-shadow:0 12px 32px rgba(15,23,42,0.4);font-family:"Noto Sans JP",sans-serif;`;
      t.textContent = text; document.body.appendChild(t);
      setTimeout(() => t.remove(), 2200);
    }
    async function sendMsg(msg) {
      const client = (window.DUMMY_CLIENTS || []).find(c => c.id === msg.clientId);
      if (!client) { alert(`送信失敗: ${msg.clientName}様の顧客データが見つかりません`); return false; }
      if (!client.lineFriendId || client.lineFriendId.startsWith('U-lead-') || client.lineFriendId.startsWith('demo-')) {
        alert(`${msg.clientName}様はLINE未連携です。\n\n顧客台帳でLINE友だちIDを確認してください。`); return false;
      }
      // ★ 真因対応 (2026-06-22): multi-tenant sendLineMessage callable に切替
      //    旧 /api/send-line は demo (福田) GAS token で 別チャンネル送信失敗していた
      try {
        const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js');
        const app = getApps()[0] || initializeApp({
          apiKey: 'AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4',
          authDomain: 'skeleton-fp-compass-632026.firebaseapp.com',
          projectId: 'skeleton-fp-compass-632026',
        });
        const fn = httpsCallable(getFunctions(app, 'asia-northeast1'), 'sendLineMessage');
        await fn({ customerId: client.id, text: msg.body });
        markSent(msg.id, msg.clientId);
        return true;
      } catch (e) {
        // Firebase callable は friendlyMsg を message に入れて throw 投げてくれる
        const errMsg = e?.message || String(e);
        const isNoToken = /LINE 未連携|failed-precondition/.test(errMsg);
        const lines = [`${msg.clientName}様への送信に失敗しました`, ''];
        if (isNoToken) {
          lines.push('原因: あなたの LINE 公式アカウントが未連携です');
          lines.push('');
          lines.push('→ アカウント設定 で LINE 公式アカウント の Channel Access Token を 入力してください');
          lines.push('  (画面右上「アカウント」 から ⚙ 設定)');
        } else {
          lines.push(errMsg.slice(0, 400));
        }
        alert(lines.join('\n'));
        return false;
      }
    }

    document.querySelectorAll('[data-send]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const msg = todayMessages.find(m => m.id === btn.dataset.send);
        if (!msg) return;
        btn.disabled = true; btn.innerHTML = '<span>...</span> 送信中';
        const ok = await sendMsg(msg);
        if (ok) {
          const card = btn.closest('.fp-today-card-v2, .fp-today-msg');
          if (card) { card.classList.add('fp-today-msg-done'); card.innerHTML = `<div style="padding:24px;text-align:center;color:#065F46;font-size:14px;font-family:'Noto Serif JP',serif;font-weight:700;">✓ ${escapeHtml(msg.clientName)}さんに送信しました</div>`; }
          toast(`✓ ${msg.clientName}さん に 送信しました`, 'sent');
        } else {
          btn.disabled = false; btn.innerHTML = '<span class="fp-today-v2-send-icon">📤</span> <span>このまま LINE で送る</span>';
        }
      });
    });
    document.querySelectorAll('[data-skip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = todayMessages.find(m => m.id === btn.dataset.skip);
        if (!msg) return;
        markSkipped(msg.id);
        const card = btn.closest('.fp-today-card-v2, .fp-today-msg');
        if (card) { card.classList.add('fp-today-msg-done'); card.innerHTML = `<div style="padding:24px;text-align:center;color:#8B7D5D;font-size:13px;">○ ${escapeHtml(msg.clientName)}さんはスキップしました</div>`; }
        toast(`スキップ: ${msg.clientName}さん`, 'skip');
      });
    });
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = todayMessages.find(m => m.id === btn.dataset.edit);
        if (!msg) return;
        openTodayMessageEditor(msg, async (updatedBody) => {
          msg.body = updatedBody;
          const card = btn.closest('.fp-today-card-v2, .fp-today-msg');
          const bubble = card?.querySelector('.fp-today-v2-bubble, .fp-today-bubble');
          if (bubble) bubble.innerHTML = escapeHtml(updatedBody).replace(/\n/g, '<br>');
        });
      });
    });
    const bulkBtn = document.getElementById('fp-today-bulk-send');
    if (bulkBtn) bulkBtn.addEventListener('click', async () => {
      if (!confirm(`${todayMessages.length}件 すべて 送信します。 よろしいですか?`)) return;
      bulkBtn.disabled = true; bulkBtn.textContent = '送信中...';
      // ★ 全画面ブロック (誤クリック / 中断 防止)
      showSendingOverlay(`今日 送る 一斉送信中 (${todayMessages.length}件)`, todayMessages.length);
      let ok = 0, ng = 0;
      for (let i = 0; i < todayMessages.length; i++) {
        const m = todayMessages[i];
        updateSendingProgress(i, todayMessages.length, m.clientName);
        const sent = await sendMsg(m); if (sent) ok++; else ng++;
        await new Promise(r => setTimeout(r, 200));
      }
      updateSendingProgress(todayMessages.length, todayMessages.length, '');
      closeSendingOverlay();
      toast(`✓ 一斉送信 完了: ${ok}件 / 失敗 ${ng}件`, 'sent');
      setTimeout(() => renderLineDashboard(), 1200);
    });

    // 「予定を登録する」ボタン
    document.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = presetScenarios.find(p => p.id === btn.dataset.preset);
        if (!preset) return;
        if (!confirm(`「${preset.title}」 を 「いつも送る予定」 に登録します。\n\nタイミング: ${preset.cadence}\n対象: ${preset.segment}\n\n登録 してよろしいですか?`)) return;
        addPresetToSchedules(preset, null);
      });
    });

    // ★ オーナーfb (v AM): 「今すぐ 該当者に 送る」ボタン → 該当者一覧モーダル
    document.querySelectorAll('[data-preset-now]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = presetScenarios.find(p => p.id === btn.dataset.presetNow);
        if (!preset) return;
        openPresetSendNowModal(preset, sendMsg, () => renderLineDashboard());
      });
    });

    // 「✎ 文面を編集してから」ボタン
    document.querySelectorAll('[data-preset-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = presetScenarios.find(p => p.id === btn.dataset.presetEdit);
        if (!preset) return;
        openPresetEditModal(preset, addPresetToSchedules);
      });
    });
    // 稼働中カードクリック → スケジュール編集
    document.querySelectorAll('[data-schid-jump]').forEach(el => {
      el.addEventListener('click', (e) => {
        // プレビューボタンが押された時は カード遷移しない
        if (e.target.closest('[data-preview-schid]')) return;
        const id = el.dataset.schidJump;
        document.querySelector('[data-line-sub="schedules"]')?.click();
        setTimeout(() => openScheduleEditor(id), 200);
      });
    });
    // 「全文を見る・編集する」 ボタン → 本文プレビュー&編集モーダル
    document.querySelectorAll('[data-preview-schid]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openSchedulePreview(el.dataset.previewSchid);
      });
    });
  }

  // ============================
  // セグメント一覧
  // ============================
  function renderSegments() {
    document.querySelector('[data-line-view="segments"]').innerHTML = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">💡 セグメントとは</span>
          <span class="howto-banner-subtitle">お客様を「属性」で自動グループ分けする機能</span>
        </div>
        <div class="howto-steps">
          <div class="howto-step"><div class="howto-step-no">1</div><div>例: 子育て世帯 13名、退職前世代 5名 など、CRM内のお客様を<strong>自動で分類</strong></div></div>
          <div class="howto-step"><div class="howto-step-no">2</div><div>「配信スケジュール」サブタブで<strong>セグメント別に配信内容を変える</strong> (子育て世帯には教育費ニュース など)</div></div>
          <div class="howto-step"><div class="howto-step-no">3</div><div>セグメントカードを<strong>タップ</strong>で該当者一覧を確認できる</div></div>
        </div>
      </div>
      <div id="segment-cards-area"></div>
    `;
    const cards = window.SEGMENTS.map(seg => {
      const list = window.LineCRM.evaluateSegment(seg.id);
      return `
        <div class="segment-card" data-segid="${seg.id}">
          <div class="seg-head">
            <span class="seg-icon">${seg.icon}</span>
            <span class="seg-name">${escapeHtml(seg.name)}</span>
            <span class="seg-count">${list.length}名</span>
          </div>
          <div class="seg-desc">${escapeHtml(seg.desc)}</div>
          <div class="seg-members">
            ${list.slice(0, 5).map(c => `<span class="seg-chip">${escapeHtml(c.name)}</span>`).join('')}
            ${list.length > 5 ? `<span class="seg-chip more">+${list.length - 5}名</span>` : ''}
            ${list.length === 0 ? '<span style="color:var(--muted);font-size:11.5px;">該当者なし</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('segment-cards-area').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <button class="primary" disabled style="opacity:0.6;cursor:not-allowed;">+ カスタムセグメント (v2)</button>
      </div>
      <div class="segment-grid">${cards}</div>
    `;

    document.querySelectorAll('.segment-card').forEach(el => {
      el.addEventListener('click', () => openSegmentDetail(el.dataset.segid));
    });
  }

  function openSegmentDetail(segId) {
    const seg = window.SEGMENTS.find(s => s.id === segId);
    if (!seg) return;
    const list = window.LineCRM.evaluateSegment(segId);
    const html = `
      <div class="modal-header">
        <h2>${seg.icon} ${escapeHtml(seg.name)} <span style="font-size:12px;color:var(--muted);font-weight:400;">${list.length}名</span></h2>
        <button class="modal-close" id="seg-close-btn">×</button>
      </div>
      <div class="modal-body">
        <div style="font-size:13px;color:var(--muted);margin-bottom:14px;">${escapeHtml(seg.desc)}</div>
        ${list.length === 0 ? '<div class="empty">該当者なし</div>' :
          `<table class="clients">
            <thead><tr><th>顧客</th><th>年齢</th><th>AUM</th><th>ステータス</th><th>LINE</th></tr></thead>
            <tbody>
              ${list.map(c => `
                <tr>
                  <td><strong>${escapeHtml(c.name)}</strong></td>
                  <td>${window.LifeEvents.currentAge(c)}</td>
                  <td class="num">¥${fmtMoney(c.aum)}</td>
                  <td><span class="status-pill ${c.status}">${({active:'管理中',important:'重点',new:'新規',dormant:'休眠'})[c.status]}</span></td>
                  <td>${c.lineSubscribed ? '<span class="line-status-pill on">連携</span>' : '<span class="line-status-pill">未連携</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`
        }
      </div>
    `;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('seg-close-btn').addEventListener('click', () => {
      document.getElementById('modal-overlay').style.display = 'none';
    });
  }

  // 文面編集モーダル (プリセットを編集してから追加)
  function openPresetEditModal(preset, onSave) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10080;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:680px;width:100%;max-height:88vh;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;display:flex;flex-direction:column;">
        <div style="background:linear-gradient(135deg,#FDFBF4,#FAF6E8);padding:22px 26px;border-bottom:1px solid #E8E2D4;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.22em;color:#C19A3A;text-transform:uppercase;margin-bottom:5px;">EDIT TEMPLATE</div>
            <h3 style="margin:0;font-family:'Noto Serif JP',serif;font-weight:700;font-size:18px;color:#1F1A12;">${escapeHtml(preset.emoji)} ${escapeHtml(preset.title)} の文面を編集</h3>
          </div>
          <button id="fp-preset-close" style="background:transparent;border:none;cursor:pointer;font-size:22px;color:#8B7D5D;">✕</button>
        </div>
        <div style="padding:22px 26px;overflow-y:auto;flex:1;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
            <!-- 左: 編集 -->
            <div>
              <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10px;letter-spacing:0.16em;color:#8B7D5D;text-transform:uppercase;margin-bottom:8px;">📝 本文 (編集できます)</div>
              <textarea id="fp-preset-textarea" rows="12" style="width:100%;padding:14px 16px;border:1.5px solid #E8E2D4;border-radius:8px;font-size:13px;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;line-height:1.85;resize:vertical;box-sizing:border-box;background:#FDFBF4;">${escapeHtml(preset.sample)}</textarea>
              <div style="font-size:10.5px;color:#8B7D5D;margin-top:6px;line-height:1.6;">
                <strong style="color:#C19A3A;">{name}</strong> = お客様の名前 / <strong style="color:#C19A3A;">{fpName}</strong> = FP事業者名<br>
                送信時に自動で置換されます。
              </div>
              ${preset.note ? `<div style="margin-top:12px;padding:10px 12px;background:#FFFBEB;border-left:3px solid #C19A3A;border-radius:6px;font-size:11px;color:#5E5648;line-height:1.6;">${escapeHtml(preset.note)}</div>` : ''}
            </div>
            <!-- 右: プレビュー -->
            <div>
              <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10px;letter-spacing:0.16em;color:#8B7D5D;text-transform:uppercase;margin-bottom:8px;">👁 お客様の LINE プレビュー</div>
              <div style="background:linear-gradient(180deg,#F1F5F9,#E2E8F0);border-radius:12px;padding:16px;">
                <div id="fp-preset-preview" style="background:#fff;border-radius:14px 14px 14px 3px;padding:14px 16px;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;font-size:13px;line-height:1.85;color:#0F172A;white-space:pre-wrap;box-shadow:0 1px 3px rgba(0,0,0,0.08);min-height:200px;"></div>
              </div>
              <div style="font-size:10.5px;color:#8B7D5D;margin-top:6px;text-align:center;">山田 太郎 さんで表示</div>
            </div>
          </div>
        </div>
        <div style="padding:16px 26px;background:#FDFBF4;border-top:1px solid #E8E2D4;display:flex;gap:10px;justify-content:flex-end;">
          <button id="fp-preset-cancel" style="background:#fff;color:#5E5648;border:1px solid #D6CDB6;padding:11px 22px;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">キャンセル</button>
          <button id="fp-preset-save" style="background:linear-gradient(135deg,#C19A3A,#B8893D);color:#fff;border:none;padding:11px 24px;border-radius:8px;font-size:13px;font-weight:900;cursor:pointer;font-family:inherit;letter-spacing:0.06em;box-shadow:0 4px 14px rgba(193,154,58,0.4);">✓ この文面で稼働開始</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#fp-preset-textarea');
    const preview = overlay.querySelector('#fp-preset-preview');
    const fpName = (window.__fp?.tenantName || 'FP事務所').replace(/ — DEMO ビュー/, '');
    function updatePreview() {
      const text = textarea.value.replace(/\{name\}/g, '山田 太郎').replace(/\{fpName\}/g, fpName);
      preview.textContent = text;
    }
    textarea.addEventListener('input', updatePreview);
    updatePreview();
    overlay.querySelector('#fp-preset-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#fp-preset-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#fp-preset-save').addEventListener('click', () => {
      const customBody = textarea.value.trim();
      if (!customBody) { alert('本文が空です'); return; }
      overlay.remove();
      onSave(preset, customBody);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  // 「今すぐ 該当者に 送る」 モーダル — プリセットの該当者を一覧で表示・選んで送信
  function openPresetSendNowModal(preset, sendMsgFn, onDone) {
    const allClients = window.DUMMY_CLIENTS || [];
    const today = new Date(); today.setHours(0,0,0,0);
    const fpName = (window.__fp?.tenantName || 'FP').replace(/ — DEMO ビュー/, '');

    // 該当者抽出
    const eligible = [];
    if (preset.id === 'preset-birthday') {
      allClients.forEach(c => {
        if (!c.lineFriendId) return;
        if (c.birth) { const b=new Date(c.birth); if(b.getMonth()===today.getMonth()&&b.getDate()===today.getDate()) eligible.push({ client: c, info: '本日 お誕生日', subjectName: c.name }); }
        (c.family||[]).forEach(m => { if(!m.birth) return; const b=new Date(m.birth); if(b.getMonth()===today.getMonth()&&b.getDate()===today.getDate()) eligible.push({ client: c, info: `${m.name}様 (${m.rel === 'spouse' ? '奥様' : (m.rel === 'child' ? 'お子様' : 'ご家族')}) のお誕生日`, subjectName: m.name }); });
      });
    } else if (preset.id === 'preset-followup') {
      allClients.forEach(c => {
        if (!c.lineFriendId || !c.lastContact) return;
        const days = Math.floor((today - new Date(c.lastContact)) / 86400000);
        if (days >= 60) eligible.push({ client: c, info: `最終接触 ${days}日前 (${c.lastContact})`, subjectName: c.name });
      });
      eligible.sort((a,b) => new Date(a.client.lastContact) - new Date(b.client.lastContact));
    } else if (preset.id === 'preset-monthly' || preset.id === 'preset-newyear') {
      allClients.forEach(c => { if (c.lineFriendId) eligible.push({ client: c, info: `LINE連携済`, subjectName: c.name }); });
    }

    if (eligible.length === 0) {
      alert(`該当する お客様が いません。\n\n${preset.title} は 該当者が出た時に 自動で 候補リストに 並びます。`);
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10080;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';

    const renderModal = () => {
      const selected = new Set();
      eligible.forEach((e, i) => selected.add(i)); // デフォ全選択
      overlay.innerHTML = `
        <div style="background:#fff;max-width:760px;width:100%;max-height:88vh;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;display:flex;flex-direction:column;">
          <div style="background:linear-gradient(135deg,#FDFBF4,#FAF6E8);padding:22px 26px;border-bottom:1px solid #E8E2D4;display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.2em;color:#C19A3A;text-transform:uppercase;margin-bottom:5px;">SEND NOW</div>
              <h3 style="margin:0;font-family:'Noto Serif JP',serif;font-weight:700;font-size:19px;color:#1F1A12;">${escapeHtml(preset.emoji)} ${escapeHtml(preset.title)} を 今すぐ送る</h3>
              <p style="margin:5px 0 0;font-size:12px;color:#8B7D5D;line-height:1.6;">該当する お客様 <strong style="color:#C19A3A;">${eligible.length}名</strong> です。 送りたい方を 選んでください。</p>
            </div>
            <button id="fp-sn-close" style="background:transparent;border:none;cursor:pointer;font-size:22px;color:#8B7D5D;">✕</button>
          </div>
          <div style="padding:20px 26px;overflow-y:auto;flex:1;display:grid;grid-template-columns:1fr 1fr;gap:18px;">
            <!-- 左: 該当者リスト -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.14em;color:#8B7D5D;text-transform:uppercase;margin-bottom:10px;">
                <span>👥 送信先 (該当者一覧)</span>
                <button id="fp-sn-toggle-all" style="background:transparent;border:1px solid #C19A3A;color:#C19A3A;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:5px;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">全選択/全解除</button>
              </div>
              <div id="fp-sn-list" style="max-height:50vh;overflow-y:auto;display:grid;gap:6px;"></div>
            </div>
            <!-- 右: 本文 + プレビュー -->
            <div>
              <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.14em;color:#8B7D5D;text-transform:uppercase;margin-bottom:10px;">📝 本文 (編集可)</div>
              <textarea id="fp-sn-textarea" rows="10" style="width:100%;padding:12px 14px;border:1.5px solid #E8E2D4;border-radius:8px;font-size:12.5px;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;line-height:1.85;resize:vertical;box-sizing:border-box;background:#FDFBF4;">${escapeHtml(preset.sample)}</textarea>
              <div style="font-size:10px;color:#8B7D5D;margin-top:5px;line-height:1.55;">
                <strong style="color:#C19A3A;">{name}</strong> = お客様の名前 / <strong style="color:#C19A3A;">{fpName}</strong> = 自分の名前。 送信時に置換します。
              </div>
            </div>
          </div>
          <div style="padding:16px 26px;background:#FDFBF4;border-top:1px solid #E8E2D4;display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <span style="font-size:12px;color:#5E5648;"><strong id="fp-sn-count" style="color:#C19A3A;font-size:14px;">${eligible.length}</strong>名 に 送信します</span>
            <div style="display:flex;gap:10px;">
              <button id="fp-sn-cancel" style="background:#fff;color:#5E5648;border:1px solid #D6CDB6;padding:11px 22px;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;">キャンセル</button>
              <button id="fp-sn-send" style="background:linear-gradient(135deg,#06C755,#04A847);color:#fff;border:none;padding:11px 26px;border-radius:8px;font-size:13px;font-weight:900;cursor:pointer;font-family:inherit;letter-spacing:0.06em;box-shadow:0 4px 14px rgba(6,199,85,0.32);">📤 選択した方に 送信</button>
            </div>
          </div>
        </div>
      `;
      const listEl = overlay.querySelector('#fp-sn-list');
      const renderList = () => {
        listEl.innerHTML = eligible.map((e, i) => {
          const on = selected.has(i);
          return `
            <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${on ? '#F0FDF4' : '#fff'};border:1px solid ${on ? '#86EFAC' : '#E8E2D4'};border-radius:8px;cursor:pointer;font-family:inherit;">
              <input type="checkbox" data-idx="${i}" ${on ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;accent-color:#06C755;">
              <div style="flex:1;min-width:0;">
                <div style="font-family:'Noto Serif JP',serif;font-weight:700;font-size:13.5px;color:#1F1A12;">${escapeHtml(e.client.name)} さん</div>
                <div style="font-size:11px;color:#5E5648;margin-top:2px;">${escapeHtml(e.info)}</div>
              </div>
            </label>
          `;
        }).join('');
        listEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.addEventListener('change', () => {
            const i = parseInt(cb.dataset.idx, 10);
            if (cb.checked) selected.add(i); else selected.delete(i);
            overlay.querySelector('#fp-sn-count').textContent = String(selected.size);
            renderList();
          });
        });
      };
      renderList();

      overlay.querySelector('#fp-sn-close').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#fp-sn-cancel').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      overlay.querySelector('#fp-sn-toggle-all').addEventListener('click', () => {
        if (selected.size === eligible.length) selected.clear();
        else eligible.forEach((_, i) => selected.add(i));
        overlay.querySelector('#fp-sn-count').textContent = String(selected.size);
        renderList();
      });
      overlay.querySelector('#fp-sn-send').addEventListener('click', async () => {
        if (selected.size === 0) { alert('送信先を 1名以上 選んでください'); return; }
        if (!confirm(`${selected.size}名 に 送信します。 よろしいですか?`)) return;
        const tpl = overlay.querySelector('#fp-sn-textarea').value;
        const sendBtn = overlay.querySelector('#fp-sn-send');
        sendBtn.disabled = true; sendBtn.textContent = '送信中...';
        let ok = 0, ng = 0;
        for (const i of Array.from(selected)) {
          const e = eligible[i];
          const body = tpl.replace(/\{name\}/g, e.subjectName).replace(/\{fpName\}/g, fpName);
          const fakeMsg = { id: 'now-' + preset.id + '-' + i, clientId: e.client.id, clientName: e.client.name, body };
          const sent = await sendMsgFn(fakeMsg);
          if (sent) ok++; else ng++;
          await new Promise(r => setTimeout(r, 200));
        }
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#1F1A12;color:#fff;padding:12px 22px;border-radius:8px;font-size:13px;font-weight:700;z-index:99999;box-shadow:0 12px 32px rgba(15,23,42,0.4);font-family:"Noto Sans JP",sans-serif;';
        t.textContent = `✓ 送信完了: ${ok}名 / 失敗 ${ng}名`;
        document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
        overlay.remove();
        if (onDone) onDone();
      });
    };
    renderModal();
    document.body.appendChild(overlay);
  }

  // 「登録されてる予定」 の 本文プレビュー&編集モーダル
  function openSchedulePreview(schId) {
    const s = (window.LINE_SCHEDULES || []).find(x => x.id === schId);
    if (!s) return;
    const tpl = (window.LINE_TEMPLATES || []).find(t => t.id === s.templateId);
    const seg = (window.SEGMENTS || []).find(x => x.id === s.segment);
    const initialBody = s.body || (tpl && tpl.body) || '';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10080;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:700px;width:100%;max-height:88vh;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;display:flex;flex-direction:column;">
        <div style="background:linear-gradient(135deg,#FDFBF4,#FAF6E8);padding:20px 26px;border-bottom:1px solid #E8E2D4;display:flex;justify-content:space-between;align-items:flex-start;gap:14px;">
          <div style="flex:1;min-width:0;">
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.2em;color:#C19A3A;text-transform:uppercase;margin-bottom:5px;">PREVIEW · 配信される本文</div>
            <h3 style="margin:0;font-family:'Noto Serif JP',serif;font-weight:700;font-size:18px;color:#1F1A12;letter-spacing:-0.005em;">${escapeHtml(s.name)}</h3>
            <div style="margin-top:5px;font-size:11.5px;color:#5E5648;line-height:1.6;">
              ${escapeHtml(s.schedule || '')} · ${seg ? seg.icon + ' ' + escapeHtml(seg.name) : '🎂 誕生日対象者'}
            </div>
          </div>
          <button id="fp-sp-close" style="background:transparent;border:none;cursor:pointer;font-size:22px;color:#8B7D5D;flex-shrink:0;">✕</button>
        </div>
        <div style="padding:20px 26px;overflow-y:auto;flex:1;display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div>
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.14em;color:#8B7D5D;text-transform:uppercase;margin-bottom:8px;">📝 本文 (編集可)</div>
            <textarea id="fp-sp-textarea" rows="12" style="width:100%;padding:14px 16px;border:1.5px solid #E8E2D4;border-radius:8px;font-size:13px;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;line-height:1.85;resize:vertical;box-sizing:border-box;background:#FDFBF4;">${escapeHtml(initialBody)}</textarea>
            <div style="font-size:10.5px;color:#8B7D5D;margin-top:6px;line-height:1.6;">
              <strong style="color:#C19A3A;">{{name}}</strong> または <strong style="color:#C19A3A;">{name}</strong> = お客様の名前<br>
              <strong style="color:#C19A3A;">{{fp_name}}</strong> または <strong style="color:#C19A3A;">{fpName}</strong> = 自分の名前<br>
              送信時に 自動置換します。
            </div>
          </div>
          <div>
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.14em;color:#8B7D5D;text-transform:uppercase;margin-bottom:8px;">👁 お客様のLINE プレビュー</div>
            <div style="background:linear-gradient(180deg,#F1F5F9,#E2E8F0);border-radius:12px;padding:16px;">
              <div id="fp-sp-preview" style="background:#fff;border-radius:14px 14px 14px 3px;padding:14px 16px;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;font-size:13px;line-height:1.85;color:#0F172A;white-space:pre-wrap;box-shadow:0 1px 3px rgba(0,0,0,0.08);min-height:200px;"></div>
            </div>
            <div style="font-size:10.5px;color:#8B7D5D;margin-top:6px;text-align:center;">山田 太郎 さん で 表示しています</div>
          </div>
        </div>
        <div style="padding:16px 26px;background:#FDFBF4;border-top:1px solid #E8E2D4;display:flex;gap:10px;justify-content:flex-end;">
          <button id="fp-sp-cancel" style="background:#fff;color:#5E5648;border:1px solid #D6CDB6;padding:11px 22px;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">閉じる</button>
          <button id="fp-sp-save" style="background:linear-gradient(135deg,#1F1A12,#2C2419);color:#FFE9A8;border:none;padding:11px 26px;border-radius:8px;font-size:13px;font-weight:900;cursor:pointer;font-family:inherit;letter-spacing:0.06em;">✓ この本文で 保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#fp-sp-textarea');
    const preview = overlay.querySelector('#fp-sp-preview');
    const fpName = (window.__fp?.tenantName || 'FP事務所').replace(/ — DEMO ビュー/, '');
    function updatePreview() {
      const text = textarea.value
        .replace(/\{\{name\}\}/g, '山田 太郎').replace(/\{name\}/g, '山田 太郎')
        .replace(/\{\{fp_name\}\}/g, fpName).replace(/\{fpName\}/g, fpName)
        .replace(/\{\{[^}]+\}\}/g, '○○');
      preview.textContent = text;
    }
    textarea.addEventListener('input', updatePreview);
    updatePreview();
    overlay.querySelector('#fp-sp-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#fp-sp-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#fp-sp-save').addEventListener('click', () => {
      const v = textarea.value.trim();
      if (!v) { alert('本文が空です'); return; }
      s.body = v; // schedule の body フィールドに保存 (テンプレ独立)
      overlay.remove();
      const t = document.createElement('div');
      t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#1F1A12;color:#fff;padding:12px 22px;border-radius:8px;font-size:13px;font-weight:700;z-index:99999;box-shadow:0 12px 32px rgba(15,23,42,0.4);font-family:"Noto Sans JP",sans-serif;';
      t.textContent = `✓ 「${s.name}」 の本文を保存しました`;
      document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
      renderLineDashboard();
    });
    setTimeout(() => textarea.focus(), 100);
  }

  // 今日のメッセージ 個別編集モーダル
  function openTodayMessageEditor(msg, onSave) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10080;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Noto Sans JP",sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:620px;width:100%;max-height:88vh;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.35);overflow:hidden;display:flex;flex-direction:column;">
        <div style="background:linear-gradient(135deg,#FDFBF4,#FAF6E8);padding:20px 24px;border-bottom:1px solid #E8E2D4;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0.16em;color:#C19A3A;text-transform:uppercase;margin-bottom:4px;">${msg.icon} ${escapeHtml(msg.category)}</div>
            <h3 style="margin:0;font-family:'Noto Serif JP',serif;font-weight:700;font-size:17px;color:#1F1A12;">${escapeHtml(msg.clientName)}さん への メッセージを直す</h3>
            <div style="font-size:11.5px;color:#8B7D5D;margin-top:3px;">${escapeHtml(msg.reason)}</div>
          </div>
          <button id="fp-tm-close" style="background:transparent;border:none;cursor:pointer;font-size:22px;color:#8B7D5D;">✕</button>
        </div>
        <div style="padding:20px 24px;overflow-y:auto;flex:1;">
          <div style="font-family:'Manrope',sans-serif;font-weight:700;font-size:10.5px;letter-spacing:0.14em;color:#8B7D5D;text-transform:uppercase;margin-bottom:8px;">📝 本文 (お客様にこのまま届きます)</div>
          <textarea id="fp-tm-textarea" rows="10" style="width:100%;padding:14px 16px;border:1.5px solid #E8E2D4;border-radius:8px;font-size:13px;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;line-height:1.85;resize:vertical;box-sizing:border-box;background:#FDFBF4;">${escapeHtml(msg.body)}</textarea>
        </div>
        <div style="padding:14px 24px;background:#FDFBF4;border-top:1px solid #E8E2D4;display:flex;gap:10px;justify-content:flex-end;">
          <button id="fp-tm-cancel" style="background:#fff;color:#5E5648;border:1px solid #D6CDB6;padding:11px 22px;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;">キャンセル</button>
          <button id="fp-tm-save" style="background:linear-gradient(135deg,#1F1A12,#2C2419);color:#FFE9A8;border:none;padding:11px 26px;border-radius:8px;font-size:13px;font-weight:900;cursor:pointer;font-family:inherit;letter-spacing:0.06em;">✓ この内容に直す</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#fp-tm-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#fp-tm-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#fp-tm-save').addEventListener('click', () => {
      const v = overlay.querySelector('#fp-tm-textarea').value.trim();
      if (!v) { alert('本文が空です'); return; }
      overlay.remove();
      onSave(v);
    });
    setTimeout(() => overlay.querySelector('#fp-tm-textarea').focus(), 100);
  }

  // ============================
  // 配信スケジュール
  // ============================
  function renderSchedules() {
    const html = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">💡 配信スケジュール</span>
          <span class="howto-banner-subtitle">「いつ・誰に・何を」を一度組めば自動配信し続ける</span>
        </div>
        <div class="howto-steps">
          <div class="howto-step"><div class="howto-step-no">1</div><div>例: 「子育て世帯 × 教育費お役立ち × 毎月15日10時」のように<strong>セグメント × テンプレ × タイミング</strong>を組む</div></div>
          <div class="howto-step"><div class="howto-step-no">2</div><div><strong>左のトグル</strong>で稼働/停止を切替 (停止中は配信されません)</div></div>
          <div class="howto-step"><div class="howto-step-no">3</div><div>編集は <span class="btn-hint">編集</span> ボタン、新規は右上の <span class="btn-hint">+ 新規スケジュール</span></div></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:11.5px;color:var(--muted);">${window.LINE_SCHEDULES.length} 本のシナリオ</span>
        <button class="primary" id="add-sched-btn" data-hint="新しい自動配信シナリオを作る">+ 新規スケジュール</button>
      </div>
      <table class="sched-table">
        <thead>
          <tr>
            <th></th>
            <th>シナリオ名</th>
            <th>宛先セグメント</th>
            <th>配信タイミング</th>
            <th>本文プレビュー</th>
            <th>最終送信</th>
            <th>次回</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${window.LINE_SCHEDULES.map(s => {
            const seg = window.SEGMENTS.find(x => x.id === s.segment);
            const segLabel = seg ? `${seg.icon} ${seg.name}` : (s.segment === 'auto-birthday' ? '🎂 誕生日対象者' : s.segment);
            const recipients = seg ? window.LineCRM.evaluateSegment(seg.id).length : '-';
            // ★ オーナーfb (v AN): 何が送られるかわかるよう 本文プレビューを列追加
            const tpl = (window.LINE_TEMPLATES || []).find(t => t.id === s.templateId);
            const bodyText = (s.body || (tpl && tpl.body) || '').replace(/\{\{name\}\}/g, 'お客様').replace(/\{name\}/g, 'お客様').replace(/\{\{[^}]+\}\}/g, '…');
            const previewShort = bodyText.slice(0, 40).replace(/\n/g, ' ');
            return `
              <tr class="${s.enabled ? '' : 'disabled-row'}">
                <td><label class="toggle-switch"><input type="checkbox" ${s.enabled ? 'checked' : ''} data-schid="${s.id}"><span></span></label></td>
                <td><strong>${escapeHtml(s.name)}</strong></td>
                <td>${escapeHtml(segLabel)} <span style="color:var(--muted);">(${recipients}名)</span></td>
                <td>${escapeHtml(s.schedule)}</td>
                <td style="max-width:280px;">
                  ${bodyText ? `
                    <div style="font-size:11.5px;color:#475569;line-height:1.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(previewShort)}${bodyText.length > 40 ? '…' : ''}</div>
                    <button class="ghost" data-preview-schid="${s.id}" style="font-size:10.5px;color:#C19A3A;background:transparent;border:none;text-decoration:underline;padding:2px 0 0;cursor:pointer;font-family:inherit;">全文を見る</button>
                  ` : '<span style="color:#DC2626;font-size:11px;font-weight:700;">⚠ 本文未設定</span>'}
                </td>
                <td>${s.lastSent || '—'}</td>
                <td>${escapeHtml(s.nextSend)}</td>
                <td><button class="ghost" data-schid-edit="${s.id}">編集</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <div style="font-size:11.5px;color:var(--muted);margin-top:10px;">
        ※ デモのため送信は実行されません。本番では LINE Messaging API の push でセグメント全員に同時送信されます。
      </div>
    `;
    document.querySelector('[data-line-view="schedules"]').innerHTML = html;

    document.querySelectorAll('[data-schid]').forEach(el => {
      el.addEventListener('change', e => {
        const s = window.LINE_SCHEDULES.find(x => x.id === el.dataset.schid);
        if (s) s.enabled = el.checked;
        renderSchedules();
      });
    });
    document.querySelectorAll('[data-schid-edit]').forEach(el => {
      el.addEventListener('click', () => openScheduleEditor(el.dataset.schidEdit));
    });
    // ★ スケジュールテーブルの「全文を見る」 ボタン → 本文プレビュー&編集モーダル
    document.querySelectorAll('[data-preview-schid]').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); openSchedulePreview(el.dataset.previewSchid); });
    });
    document.getElementById('add-sched-btn').addEventListener('click', () => openScheduleEditor(null));
  }

  function openScheduleEditor(schId) {
    const s = schId ? window.LINE_SCHEDULES.find(x => x.id === schId) : {
      id: 'sch-' + Date.now(),
      name: '新規シナリオ',
      segment: 'seg-all',
      templateId: window.LINE_TEMPLATES[0].id,
      cadence: 'monthly',
      schedule: '毎月 1日 10:00',
      enabled: true,
      lastSent: null, nextSend: '— (未送信)',
    };
    const segOptions = window.SEGMENTS.map(seg =>
      `<option value="${seg.id}" ${seg.id === s.segment ? 'selected' : ''}>${seg.icon} ${seg.name}</option>`
    ).join('');
    const tplOptions = window.LINE_TEMPLATES.map(tpl =>
      `<option value="${tpl.id}" ${tpl.id === s.templateId ? 'selected' : ''}>${tpl.name}</option>`
    ).join('');

    const html = `
      <div class="modal-header">
        <h2>${schId ? 'スケジュール編集' : '新規スケジュール作成'}</h2>
        <button class="modal-close" id="sch-edit-close">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row"><label>シナリオ名</label><input type="text" id="sch-name" value="${escapeHtml(s.name)}"></div>
        <div class="form-row"><label>宛先セグメント</label><select id="sch-segment">${segOptions}<option value="auto-birthday" ${s.segment === 'auto-birthday' ? 'selected' : ''}>🎂 誕生日対象者 (自動)</option></select></div>
        <div class="form-row"><label>メッセージテンプレ</label><select id="sch-template">${tplOptions}</select></div>
        <div class="form-row"><label>配信頻度</label>
          <select id="sch-cadence">
            <option value="daily" ${s.cadence==='daily'?'selected':''}>毎日</option>
            <option value="weekly" ${s.cadence==='weekly'?'selected':''}>毎週</option>
            <option value="monthly" ${s.cadence==='monthly'?'selected':''}>毎月</option>
            <option value="birthday" ${s.cadence==='birthday'?'selected':''}>誕生日トリガー</option>
          </select>
        </div>
        <div class="form-row"><label>配信時刻 (説明)</label><input type="text" id="sch-schedule" value="${escapeHtml(s.schedule)}" placeholder="例: 毎月 15日 10:00"></div>
        <div class="form-row"><label>有効</label><label class="toggle-switch"><input type="checkbox" id="sch-enabled" ${s.enabled ? 'checked' : ''}><span></span></label></div>
        <div style="display:flex;gap:8px;margin-top:18px;">
          <button class="primary" id="sch-save-btn">${schId ? '保存' : '追加'}</button>
          <button id="sch-cancel-btn">キャンセル</button>
          ${schId ? '<button id="sch-delete-btn" style="margin-left:auto;border-color:var(--red);color:var(--red);">削除</button>' : ''}
        </div>
      </div>
    `;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'flex';

    function close() { document.getElementById('modal-overlay').style.display = 'none'; }
    document.getElementById('sch-edit-close').addEventListener('click', close);
    document.getElementById('sch-cancel-btn').addEventListener('click', close);
    document.getElementById('sch-save-btn').addEventListener('click', () => {
      s.name = document.getElementById('sch-name').value;
      s.segment = document.getElementById('sch-segment').value;
      s.templateId = document.getElementById('sch-template').value;
      s.cadence = document.getElementById('sch-cadence').value;
      s.schedule = document.getElementById('sch-schedule').value;
      s.enabled = document.getElementById('sch-enabled').checked;
      if (!schId) window.LINE_SCHEDULES.push(s);
      close();
      renderSchedules();
    });
    const delBtn = document.getElementById('sch-delete-btn');
    if (delBtn) delBtn.addEventListener('click', () => {
      const idx = window.LINE_SCHEDULES.indexOf(s);
      if (idx >= 0) window.LINE_SCHEDULES.splice(idx, 1);
      close();
      renderSchedules();
    });
  }

  // ============================
  // メッセージテンプレ
  // ============================
  function renderTemplates() {
    const tplHelp = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">💡 メッセージテンプレ</span>
          <span class="howto-banner-subtitle">配信で使う文章ストック / 「{{name}}」は自動でお客様名に置換</span>
        </div>
        <div class="howto-steps">
          <div class="howto-step"><div class="howto-step-no">1</div><div>テンプレは<strong>3種類</strong>: 季節挨拶 / イベント連動 (誕生日・退職前) / 定期配信 (月次レポート etc)</div></div>
          <div class="howto-step"><div class="howto-step-no">2</div><div>「配信スケジュール」サブタブで <strong>どのテンプレをいつ送るか</strong> を組む</div></div>
        </div>
      </div>
    `;
    const groups = { event: [], broadcast: [], season: [] };
    window.LINE_TEMPLATES.forEach(t => {
      (groups[t.cat] || (groups[t.cat] = [])).push(t);
    });
    const catLabel = { event: 'イベント連動', broadcast: '定期配信', season: '季節挨拶' };

    const html = `
      ${tplHelp}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:11.5px;color:var(--muted);">テンプレ内の <code>{{name}}</code> はLINE配信時に各顧客名に自動置換されます</span>
        <button class="primary" disabled style="opacity:0.6;cursor:not-allowed;">+ 新規テンプレ (v2)</button>
      </div>
      ${Object.keys(groups).map(cat => `
        <div class="section-title">${catLabel[cat] || cat}</div>
        <div class="tpl-grid">
          ${groups[cat].map(t => `
            <div class="tpl-card">
              <div class="tpl-head">
                <span class="tpl-name">${escapeHtml(t.name)}</span>
                <span class="tpl-cat">${catLabel[t.cat] || t.cat}</span>
              </div>
              <div class="tpl-target">📌 ${escapeHtml(t.target)}</div>
              <div class="tpl-body">${nl2br(t.body)}</div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
    document.querySelector('[data-line-view="templates"]').innerHTML = html;
  }

  // ============================
  // 誕生日リスト
  // ============================
  function renderBirthdays() {
    const upcoming = window.LineCRM.upcomingBirthdays(90);
    const today = upcoming.filter(b => b.daysAhead === 0);
    const week = upcoming.filter(b => b.daysAhead > 0 && b.daysAhead <= 7);
    const month = upcoming.filter(b => b.daysAhead > 7 && b.daysAhead <= 30);
    const next3m = upcoming.filter(b => b.daysAhead > 30);

    function renderGroup(title, list, accent) {
      if (list.length === 0) return '';
      return `
        <div class="section-title" style="display:flex;align-items:center;gap:8px;">
          <span>${title}</span><span style="background:${accent};color:white;padding:1px 8px;border-radius:9px;font-size:10px;font-weight:700;">${list.length}名</span>
        </div>
        <div class="line-card" style="margin-bottom:14px;">
          ${list.map(b => `
            <div class="bday-row">
              <div class="bday-date">${(b.date.getMonth() + 1)}/${b.date.getDate()}<span class="bday-rel">${b.daysAhead === 0 ? '本日' : b.daysAhead + '日後'}</span></div>
              <div class="bday-main">
                <strong>${escapeHtml(b.personName)}</strong> <span class="bday-rel-tag">${b.rel}</span>
                <div class="bday-meta">${b.age}歳 / 顧客: <a href="#" data-cid="${b.client.id}">${escapeHtml(b.client.name)}</a></div>
              </div>
              <div class="bday-action">${b.daysAhead === 0 ? '<span class="line-status-pill on">✓ 9:00 送信予定</span>' : '<span class="line-status-pill">予約済</span>'}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    document.querySelector('[data-line-view="birthdays"]').innerHTML = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">💡 誕生日リスト</span>
          <span class="howto-banner-subtitle">本人 + 配偶者 + お子様の誕生日を90日先まで自動検出</span>
        </div>
        <div class="howto-steps">
          <div class="howto-step"><div class="howto-step-no">1</div><div>配信スケジュールに「誕生日自動メッセージ」シナリオが既に組まれている (毎日9:00判定)</div></div>
          <div class="howto-step"><div class="howto-step-no">2</div><div>顧客の家族の生年月日を CRM の顧客フォームで入れておくと、ここに自動で並ぶ</div></div>
          <div class="howto-step"><div class="howto-step-no">3</div><div>当日になると<strong>本人</strong>にお祝いLINEが自動送信される</div></div>
        </div>
      </div>
      ${renderGroup('今日 (' + (TODAY.getMonth() + 1) + '/' + TODAY.getDate() + ')', today, 'var(--red)')}
      ${renderGroup('今週 (1〜7日後)', week, 'var(--yellow)')}
      ${renderGroup('今月 (8〜30日後)', month, 'var(--accent)')}
      ${renderGroup('来月以降 (31〜90日後)', next3m, 'var(--muted)')}
      ${upcoming.length === 0 ? '<div class="empty">該当なし</div>' : ''}
    `;

    document.querySelectorAll('[data-line-view="birthdays"] a[data-cid]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        window.FpApp && window.FpApp.openClientModal && window.FpApp.openClientModal(a.dataset.cid);
      });
    });
  }

  // ============================
  // 送信ログ
  // ============================
  function renderLog() {
    const html = `
      <div class="howto-banner">
        <div class="howto-banner-head">
          <span class="howto-banner-title">💡 送信ログ</span>
          <span class="howto-banner-subtitle">配信スケジュールから飛んだメッセージの履歴 / 何件届いて何件失敗したか</span>
        </div>
        <div class="howto-steps">
          <div class="howto-step"><div class="howto-step-no">1</div><div>失敗があった場合は「備考」列に理由が書かれる (ブロック解除待ち など)</div></div>
          <div class="howto-step"><div class="howto-step-no">2</div><div>テスト配信 (右上「テスト配信」ボタン経由) もここに記録される</div></div>
        </div>
      </div>
      <table class="sched-table">
        <thead>
          <tr>
            <th>送信日時</th>
            <th>シナリオ / テンプレ</th>
            <th>宛先</th>
            <th>件数</th>
            <th>成功</th>
            <th>失敗</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          ${window.LINE_LOG.map(l => `
            <tr>
              <td style="font-variant-numeric:tabular-nums;">${escapeHtml(l.date)}</td>
              <td><strong>${escapeHtml(l.template)}</strong></td>
              <td>${escapeHtml(l.segment)}</td>
              <td class="num">${l.recipients}</td>
              <td class="num" style="color:var(--green);font-weight:600;">${l.success}</td>
              <td class="num" style="color:${l.fail > 0 ? 'var(--red)' : 'var(--muted)'};font-weight:${l.fail > 0 ? '600' : '400'};">${l.fail}</td>
              <td style="font-size:11.5px;color:var(--muted);">${escapeHtml(l.detail || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.querySelector('[data-line-view="log"]').innerHTML = html;
  }

  // ============================
  // 設定
  // ============================
  function renderSettings() {
    const settings = loadSettings();
    const html = `
      <div style="max-width:640px;">
        <div class="section-title">LINE公式アカウント接続</div>
        <div class="line-card" style="background:linear-gradient(135deg,#F0FDF4,#ECFDF5);border:2px solid #06C755;padding:24px 28px;">
          <div style="font-size:15px;font-weight:700;color:#065F46;margin-bottom:10px;line-height:1.6;">
            🔗 LINE 公式アカウント の 接続 は <strong>「アカウント設定」 → 「公式LINE 連携」</strong> から 行います。
          </div>
          <div style="font-size:12.5px;color:#525252;line-height:1.85;margin-bottom:18px;">
            鍵 ① ② を 貼るだけで <strong>リッチメニュー / Webhook / 自動応答OFF まで 全部 自動セット</strong>。
            手動で URL を コピペ する 必要 は ありません。
          </div>
          <a href="/account.html#line" class="primary" style="display:inline-block;background:#06C755;color:#fff;padding:12px 22px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">→ アカウント設定 で LINE 接続 する</a>
          <details style="margin-top:18px;font-size:12px;color:var(--muted);">
            <summary style="cursor:pointer;">設定 方法 が わからない (ガイド を 見る)</summary>
            <p style="margin-top:10px;line-height:1.85;">
              全10ステップ の 設定ガイド (実画面 + 矢印付き):<br>
              <a href="https://t35ty6-rgb.github.io/skeleton-demos/fp-compass-line-setup/" target="_blank" style="color:#06C755;font-weight:700;">→ 公式LINE 接続ガイド を 開く</a>
            </p>
          </details>
        </div>

        <div class="section-title" style="margin-top:24px;">FP情報 (テンプレ署名で使用)</div>
        <div class="line-card">
          <div class="settings-row">
            <label>FP表示名</label>
            <input type="text" id="set-fp-name" value="${escapeHtml(settings.fpName)}" placeholder="例: 田中 太郎 ファイナンシャルプランナー">
          </div>
          <div class="settings-row">
            <label>レポートURL</label>
            <input type="text" id="set-report-url" value="${escapeHtml(settings.reportUrl)}" placeholder="例: https://example.com/report-may">
          </div>
          <div class="settings-row">
            <label>面談予約カレンダーURL</label>
            <input type="text" id="set-calendar-url" value="${escapeHtml(settings.calendarUrl)}" placeholder="例: https://timerex.net/s/...">
          </div>
        </div>

        <div class="section-title" style="margin-top:24px;">自動配信の停止・再開</div>
        <div class="line-card">
          <div style="font-size:13px;color:var(--ink-2);margin-bottom:8px;">緊急時は全自動配信を一括停止できます。</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <label class="toggle-switch"><input type="checkbox" id="set-master-enabled" ${settings.masterEnabled ? 'checked' : ''}><span></span></label>
            <span>マスター: <strong id="set-master-label">${settings.masterEnabled ? '稼働中' : '🛑 全停止中'}</strong></span>
          </div>
        </div>
      </div>
    `;
    document.querySelector('[data-line-view="settings"]').innerHTML = html;

    // FP表示名 / レポートURL / カレンダー / マスター稼働 は 残ってる
    const saveBtnEl = document.getElementById('set-save-btn');
    if (saveBtnEl) saveBtnEl.addEventListener('click', () => {
      const existing = loadSettings();
      const s = {
        ...existing,
        fpName: (document.getElementById('set-fp-name')||{}).value || existing.fpName,
        reportUrl: (document.getElementById('set-report-url')||{}).value || existing.reportUrl,
        calendarUrl: (document.getElementById('set-calendar-url')||{}).value || existing.calendarUrl,
        masterEnabled: (document.getElementById('set-master-enabled')||{}).checked ?? existing.masterEnabled,
      };
      saveSettings(s);
      updateHeroStatus();
    });

    document.getElementById('set-master-enabled').addEventListener('change', e => {
      document.getElementById('set-master-label').innerHTML = e.target.checked ? '稼働中' : '🛑 全停止中';
      const s = loadSettings();
      s.masterEnabled = e.target.checked;
      saveSettings(s);
      updateHeroStatus();
    });
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem('fp-crm-line-settings');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      channelId: '2001234567',
      channelToken: '••••••••••••••••••••••••••••',
      fpName: 'FP 山田 太郎',
      reportUrl: 'https://example.com/monthly-report',
      calendarUrl: 'https://timerex.net/s/fp-compass-sample/30min',
      masterEnabled: true,
    };
  }
  function saveSettings(s) {
    try { localStorage.setItem('fp-crm-line-settings', JSON.stringify(s)); } catch (e) {}
  }

  function updateHeroStatus() {
    const s = loadSettings();
    const el = document.getElementById('line-hero-status');
    if (!el) return;
    if (s.masterEnabled) {
      el.innerHTML = '✓ 接続済み (デモモード) — 自動配信 稼働中';
      el.style.color = 'var(--green)';
    } else {
      el.innerHTML = '🛑 全自動配信を停止中';
      el.style.color = 'var(--red)';
    }
  }

  // ============================
  // テスト配信ダイアログ
  // ============================
  function openTestSendDialog() {
    const segOptions = window.SEGMENTS.map(seg =>
      `<option value="${seg.id}">${seg.icon} ${seg.name} (${window.LineCRM.evaluateSegment(seg.id).length}名)</option>`
    ).join('');
    const tplOptions = window.LINE_TEMPLATES.map(tpl =>
      `<option value="${tpl.id}">${tpl.name}</option>`
    ).join('');

    const html = `
      <div class="modal-header">
        <h2>📨 テスト配信</h2>
        <button class="modal-close" id="test-close">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row"><label>セグメント</label><select id="test-seg">${segOptions}</select></div>
        <div class="form-row"><label>テンプレ</label><select id="test-tpl">${tplOptions}</select></div>
        <div class="form-row"><label>プレビュー</label><div id="test-preview" class="tpl-body" style="min-height:120px;background:#fafbfc;border:1px solid var(--line);border-radius:6px;padding:12px;"></div></div>
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="primary" id="test-send-btn">送信実行 (デモ)</button>
          <button id="test-cancel-btn">キャンセル</button>
        </div>
        <div id="test-result" style="margin-top:12px;font-size:13px;"></div>
      </div>
    `;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'flex';

    function updatePreview() {
      const tpl = window.LINE_TEMPLATES.find(t => t.id === document.getElementById('test-tpl').value);
      if (!tpl) return;
      const sample = window.LineCRM.evaluateSegment(document.getElementById('test-seg').value)[0];
      const name = sample ? sample.name : 'お客様';
      const body = tpl.body
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{age\}\}/g, sample ? window.LifeEvents.currentAge(sample) : '')
        .replace(/\{\{fp_name\}\}/g, loadSettings().fpName)
        .replace(/\{\{report_url\}\}/g, loadSettings().reportUrl)
        .replace(/\{\{calendar_url\}\}/g, loadSettings().calendarUrl)
        .replace(/\{\{article_url\}\}/g, 'https://example.com/article')
        .replace(/\{\{tool_url\}\}/g, 'https://example.com/tool')
        .replace(/\{\{years_to_retire\}\}/g, '5');
      document.getElementById('test-preview').innerHTML = nl2br(body);
    }
    document.getElementById('test-seg').addEventListener('change', updatePreview);
    document.getElementById('test-tpl').addEventListener('change', updatePreview);
    updatePreview();

    function close() { document.getElementById('modal-overlay').style.display = 'none'; }
    document.getElementById('test-close').addEventListener('click', close);
    document.getElementById('test-cancel-btn').addEventListener('click', close);
    document.getElementById('test-send-btn').addEventListener('click', () => {
      const segId = document.getElementById('test-seg').value;
      const seg = window.SEGMENTS.find(s => s.id === segId);
      const list = window.LineCRM.evaluateSegment(segId);
      const tpl = window.LINE_TEMPLATES.find(t => t.id === document.getElementById('test-tpl').value);
      const result = document.getElementById('test-result');
      result.innerHTML = '送信中...';
      setTimeout(() => {
        // ログに追加
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        window.LINE_LOG.unshift({
          date: dateStr,
          scheduleId: 'manual',
          segment: seg ? seg.name : '',
          recipients: list.length,
          success: list.length,
          fail: 0,
          template: tpl ? tpl.name : '',
          detail: '手動テスト配信',
        });
        result.innerHTML = `<span style="color:var(--green);font-weight:600;">✓ ${list.length}名に送信完了 (デモ)</span>`;
        setTimeout(close, 1500);
      }, 900);
    });
  }

  // ============================
  // 送信中オーバーレイ (全クリック ブロック + 進捗表示)
  // ★ オーナーfb 2026-06-22: 送信中 に 他ボタン 押せて 中断 / 取消 起きる バグ対策
  // ============================
  function showSendingOverlay(label, total) {
    closeSendingOverlay(); // 念のため 既存 を 消す
    const ov = document.createElement('div');
    ov.id = 'fp-sending-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.78);z-index:2147483646;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);font-family:"Hiragino Sans","Noto Sans JP",sans-serif;';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:32px 40px;max-width:440px;width:90%;box-shadow:0 32px 80px rgba(0,0,0,0.5);text-align:center;">
        <div style="width:60px;height:60px;border:4px solid #E2E8F0;border-top-color:#7C3AED;border-radius:50%;margin:0 auto 20px;animation:fp-spin 0.9s linear infinite;"></div>
        <div style="font-size:11px;font-weight:800;color:#7C3AED;letter-spacing:0.16em;margin-bottom:6px;">SENDING</div>
        <div id="fp-sending-label" style="font-size:18px;font-weight:800;color:#111827;font-family:'Noto Serif JP',serif;margin-bottom:8px;">${label || '送信中…'}</div>
        <div id="fp-sending-progress" style="font-size:12.5px;color:#6b7280;line-height:1.7;">${total ? '0 / ' + total + ' 名 完了' : '通信中…'}</div>
        <div style="margin-top:18px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:10px 14px;font-size:11px;color:#92400E;font-weight:600;line-height:1.6;">
          ⚠ 完了するまで このまま お待ちください<br>他の操作 / ブラウザ閉じ は 行わないでください
        </div>
      </div>
      <style>@keyframes fp-spin { to { transform: rotate(360deg); } }</style>`;
    document.body.appendChild(ov);
    return ov;
  }
  function updateSendingProgress(done, total, currentName) {
    const p = document.getElementById('fp-sending-progress');
    if (!p) return;
    p.innerHTML = `<strong style="color:#111827;font-family:'Inter',sans-serif;">${done}</strong> / ${total} 名 完了` + (currentName ? `<br><span style="color:#7C3AED;font-weight:700;">今: ${currentName} 様 へ 送信中…</span>` : '');
  }
  function closeSendingOverlay() {
    const ov = document.getElementById('fp-sending-overlay');
    if (ov) ov.remove();
  }

  // ============================
  // 面談履歴 (ワークスペース top タブ)
  // Zoom + 対面 + 議事録リンクの蓄積場所 — editorial layout
  // ============================
  function renderMeetingHistory() {
    const root = document.getElementById('mh-root');
    if (!root) return;

    // ★ 同期 render: liveData が無くても empty/quick だけで描く。 取得は背後で並行
    const live = window.LineAppLiveData || liveData || {};
    if (!live.bookings) {
      // 背後で fetch → 完了後に再 render
      try { fetchLiveData().then(() => renderMeetingHistory()).catch(() => {}); } catch (_) {}
    }
    (function () {
      const bookings = live.bookings || [];
      const aiResults = live.ai_results || [];
      const now = new Date();
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // 完了予約: recordingStatus==='saved' or 過去日付
      const seen = new Set();
      const completed = bookings.filter(b => {
        if (b.status === 'cancelled') return false;
        if (b.recordingStatus === 'saved') return true;
        if (!b.date) return false;
        const md = new Date(b.date + 'T00:00:00');
        return !isNaN(md.getTime()) && md < today0;
      }).filter(b => {
        const k = b.ts || (b.date + '_' + b.userId);
        if (seen.has(k)) return false; seen.add(k); return true;
      });

      // 急遽対面 (localStorage)
      let quick = [];
      try { quick = JSON.parse(localStorage.getItem('fp-quick-inperson-meta') || '[]'); } catch (_) {}
      const quickRows = quick.map(q => ({
        ts: q.ts,
        date: (q.startedAt || '').slice(0, 10),
        time: (q.startedAt || '').slice(11, 16),
        name: q.clientName + ' 様',
        userId: q.clientId,
        isInperson: true,
      }));

      const all = quickRows.concat(completed).sort((a, b) => {
        const ka = String(a.date || '') + (a.time || '');
        const kb = String(b.date || '') + (b.time || '');
        return kb.localeCompare(ka);
      });

      // バッジ更新
      const navCount = document.getElementById('nav-count-history');
      if (navCount) navCount.textContent = all.length > 0 ? String(all.length) : '';

      // 月別グルーピング
      const byMonth = {};
      all.forEach(b => {
        const ym = (b.date || '').slice(0, 7) || 'unknown';
        (byMonth[ym] = byMonth[ym] || []).push(b);
      });
      const months = Object.keys(byMonth).sort().reverse();

      // 統計
      const thisYm = String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0');
      const thisMonthCount = byMonth[thisYm]?.length || 0;
      const yearCount = all.filter(b => (b.date || '').slice(0, 4) === String(now.getFullYear())).length;
      const withMinutes = all.filter(b => aiResults.find(r =>
        (r.bookingTs && r.bookingTs === b.ts) ||
        (r.userId && r.userId === b.userId) ||
        (r.customerName && r.customerName === (b.name || '').replace(/様$/, '').trim())
      )).length;
      const minRate = all.length > 0 ? Math.round((withMinutes / all.length) * 100) : 0;

      // ----- HTML -----
      const fmtMonth = ym => {
        if (ym === 'unknown') return '日付未定';
        const [y, m] = ym.split('-');
        return `<span style="font-family:'Inter',sans-serif;font-weight:600;font-size:0.7em;letter-spacing:0.06em;color:#9ca3af;">${y}</span>　${parseInt(m, 10)}月`;
      };
      const fmtWeekday = dateStr => {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return '';
        return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
      };

      root.innerHTML = `
        <style>
          .mh-page { max-width: 920px; }
          .mh-header { padding: 0 0 22px; border-bottom: 1px solid #e8e2d4; margin-bottom: 26px; }
          .mh-eyebrow { font-size: 10.5px; font-weight: 700; color: #9a5a18; letter-spacing: 0.22em; text-transform: uppercase; margin-bottom: 8px; font-family: 'Inter',sans-serif; }
          .mh-title { font-family: 'Noto Serif JP', serif; font-size: 30px; font-weight: 700; letter-spacing: 0.02em; margin: 0 0 8px; color: #1f2a3f; line-height: 1.2; }
          .mh-sub { color: #6b7280; font-size: 13px; margin: 0; line-height: 1.65; }
          .mh-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #e8e2d4; border: 1px solid #e8e2d4; border-radius: 10px; overflow: hidden; margin-bottom: 32px; }
          .mh-stat { background: #fafaf7; padding: 18px 22px; }
          .mh-stat-label { font-size: 10px; font-weight: 700; color: #9a5a18; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 6px; font-family: 'Inter',sans-serif; }
          .mh-stat-val { font-size: 26px; font-weight: 800; color: #1f2a3f; font-family: 'Inter',sans-serif; line-height: 1; letter-spacing: -0.02em; }
          .mh-stat-unit { font-size: 11px; color: #9ca3af; font-weight: 600; margin-left: 4px; }
          .mh-month-head { font-family: 'Noto Serif JP', serif; font-size: 22px; font-weight: 700; color: #1f2a3f; margin: 28px 0 14px; padding-bottom: 8px; border-bottom: 1px solid #e8e2d4; display: flex; align-items: baseline; justify-content: space-between; }
          .mh-month-count { font-size: 11px; color: #9ca3af; font-weight: 700; letter-spacing: 0.12em; font-family: 'Inter',sans-serif; }
          .mh-card { background: #fff; border: 1px solid #e8e2d4; border-left: 4px solid #c19a3a; border-radius: 10px; padding: 18px 22px; margin-bottom: 10px; display: grid; grid-template-columns: 88px 1fr auto; gap: 22px; align-items: center; transition: box-shadow 0.15s, transform 0.15s; }
          .mh-card:hover { box-shadow: 0 6px 22px rgba(193,154,58,0.18), 0 1px 3px rgba(15,23,42,0.04); }
          .mh-card.no-minutes { border-left-color: #d1c8b3; }
          .mh-date-block { border-right: 1px solid #e8e2d4; padding-right: 18px; }
          .mh-date-day { font-family: 'Inter',sans-serif; font-size: 24px; font-weight: 800; color: #1f2a3f; line-height: 1; letter-spacing: -0.02em; }
          .mh-date-month { font-size: 10.5px; color: #9a5a18; font-weight: 700; letter-spacing: 0.12em; margin-top: 4px; font-family: 'Inter',sans-serif; }
          .mh-date-time { font-size: 11.5px; color: #6b7280; font-weight: 600; margin-top: 6px; font-family: 'Inter',sans-serif; }
          .mh-meta { min-width: 0; }
          .mh-name { font-family: 'Noto Serif JP', serif; font-size: 17px; font-weight: 700; color: #1f2a3f; margin-bottom: 4px; letter-spacing: 0.02em; }
          .mh-kind { display: inline-block; font-size: 9.5px; font-weight: 800; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.08em; margin-left: 8px; vertical-align: 1px; font-family: 'Inter',sans-serif; }
          .mh-kind.zoom { background: #f0f4fa; color: #1e3a5f; }
          .mh-kind.inperson { background: #faf5ff; color: #6d28d9; }
          .mh-minutes-preview { font-size: 11.5px; color: #6b7280; line-height: 1.55; }
          .mh-minutes-preview .has { color: #065F46; font-weight: 700; }
          .mh-minutes-preview .none { color: #c0b8a5; font-style: italic; }
          .mh-actions { display: flex; gap: 8px; align-items: center; }
          .mh-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 99px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.02em; cursor: pointer; font-family: 'Hiragino Sans',sans-serif; border: 1.5px solid transparent; transition: background .12s, border-color .12s, color .12s; white-space: nowrap; background: transparent; }
          .mh-btn-minutes { border-color: #c19a3a; color: #1f2a3f; }
          .mh-btn-minutes:hover { background: #fbf5e3; border-color: #9a5a18; color: #9a5a18; }
          .mh-btn-minutes:disabled { background: transparent; border-color: #e5e7eb; color: #c0b8a5; cursor: not-allowed; opacity: 0.55; }
          .mh-btn-client { border-color: #cbd5e1; color: #1f2a3f; }
          .mh-btn-client:hover { background: #f8fafc; border-color: #94a3b8; }
          .mh-empty { background: #fff; border: 1px dashed #e8e2d4; border-radius: 10px; padding: 40px 36px; color: #6b7280; font-size: 13px; line-height: 1.8; text-align: center; }
          .mh-empty-title { font-family: 'Noto Serif JP', serif; font-size: 16px; font-weight: 700; color: #1f2a3f; margin-bottom: 10px; }
          @media (max-width: 720px) {
            .mh-card { grid-template-columns: 72px 1fr; gap: 14px; padding: 14px 16px; }
            .mh-actions { grid-column: 1 / -1; justify-content: flex-end; padding-top: 8px; border-top: 1px dashed #e8e2d4; margin-top: 4px; }
            .mh-stats { grid-template-columns: 1fr; }
          }
        </style>

        <div class="mh-page">
          <div class="mh-header">
            <div class="mh-eyebrow">Past Meetings · 面談履歴</div>
            <h1 class="mh-title">これまでの面談</h1>
            <p class="mh-sub">Zoom 録画・対面録画が完了したミーティングを時系列で振り返り。各行から議事録と顧客カードへ飛べます。</p>
          </div>

          <div class="mh-stats">
            <div class="mh-stat">
              <div class="mh-stat-label">This Month</div>
              <div class="mh-stat-val">${thisMonthCount}<span class="mh-stat-unit">件</span></div>
            </div>
            <div class="mh-stat">
              <div class="mh-stat-label">${now.getFullYear()} 累計</div>
              <div class="mh-stat-val">${yearCount}<span class="mh-stat-unit">件</span></div>
            </div>
            <div class="mh-stat">
              <div class="mh-stat-label">議事録 生成率</div>
              <div class="mh-stat-val">${minRate}<span class="mh-stat-unit">%</span></div>
            </div>
          </div>

          ${all.length === 0 ? `
            <div class="mh-empty">
              <div class="mh-empty-title">まだ完了した面談はありません</div>
              録画完了した Zoom 面談 / 急遽対面録画が、ここに時系列で積み上がります。<br>
              録画を停止すると、議事録が自動生成されて各行から確認できます。
            </div>
          ` : months.map(ym => {
            const list = byMonth[ym];
            return `
              <h2 class="mh-month-head">
                <span>${fmtMonth(ym)}</span>
                <span class="mh-month-count">${list.length} ${list.length === 1 ? 'meeting' : 'meetings'}</span>
              </h2>
              ${list.map(b => {
                const ai = aiResults.find(r =>
                  (r.bookingTs && r.bookingTs === b.ts) ||
                  (r.userId && r.userId === b.userId) ||
                  (r.customerName && r.customerName === (b.name || '').replace(/様$/, '').trim())
                );
                const day = b.date ? String(parseInt(b.date.slice(8, 10), 10)) : '?';
                const monthLabel = b.date ? String(parseInt(b.date.slice(5, 7), 10)) + '月' : '';
                const wd = fmtWeekday(b.date);
                const tm = b.time ? String(b.time).slice(0, 5) : '';
                const isInp = b.isInperson;
                const summary = ai ? String(ai.summary || '').split('\n')[0].slice(0, 80) : '';

                return `
                  <div class="mh-card ${ai ? '' : 'no-minutes'}">
                    <div class="mh-date-block">
                      <div class="mh-date-day">${day}</div>
                      <div class="mh-date-month">${monthLabel} ${wd ? '(' + wd + ')' : ''}</div>
                      ${tm ? `<div class="mh-date-time">${tm}</div>` : ''}
                    </div>
                    <div class="mh-meta">
                      <div class="mh-name">
                        ${escapeHtml(b.name || '匿名')}
                        <span class="mh-kind ${isInp ? 'inperson' : 'zoom'}">${isInp ? '対面' : 'ZOOM'}</span>
                      </div>
                      <div class="mh-minutes-preview">
                        ${ai
                          ? `<span class="has">議事録あり</span>　${escapeHtml(summary)}`
                          : '<span class="none">議事録なし（録画が完了していないか、 生成中）</span>'}
                      </div>
                    </div>
                    <div class="mh-actions">
                      <button class="mh-btn mh-btn-minutes" data-view-mh-minutes="${escapeHtml(b.ts || '')}" data-ai-summary="${escapeHtml(String(ai && ai.summary || ''))}" data-ai-transcript="${escapeHtml(String(ai && (ai.transcript || ai.summary) || ''))}" data-has-ai="${ai ? '1' : '0'}" data-client-name="${escapeHtml((b.name||'').replace(/様$/,'').trim())}">議事録${ai ? '' : ' (未)'}</button>
                      ${b.userId ? `<button class="mh-btn mh-btn-client" data-open-mh-client="${escapeHtml(b.userId)}" data-client-name="${escapeHtml((b.name||'').replace(/様$/,'').trim())}">顧客カードへ</button>` : ''}
                    </div>
                  </div>`;
              }).join('')}
            `;
          }).join('')}
        </div>
      `;

      // bind
      root.querySelectorAll('[data-view-mh-minutes]').forEach(btn => {
        btn.addEventListener('click', () => {
          const ts = btn.dataset.viewMhMinutes;
          const cname = btn.dataset.clientName || 'お客様';
          const hasAi = btn.dataset.hasAi === '1';
          const liveBookings = (live.bookings || []);
          const matched = liveBookings.find(x => String(x.ts).slice(0, 19) === String(ts).slice(0, 19));
          // ★ 2026-06-22 roundK: AI結果オブジェクト全体を 渡して タブ構造で見せる
          const aiByTs = aiResults.find(r =>
            (r.bookingTs && String(r.bookingTs).slice(0, 19) === String(ts).slice(0, 19)) ||
            (r.customerName && r.customerName === cname)
          );
          // tasks 等 JSON 文字列で 保存されてる場合は parse
          const safeAi = aiByTs ? {
            transcript: aiByTs.transcript || '',
            summary: aiByTs.summary || '',
            transcript_summary: aiByTs.transcript_summary || '',
            key_concerns: typeof aiByTs.key_concerns === 'string'
              ? (function () { try { return JSON.parse(aiByTs.key_concerns); } catch (_) { return aiByTs.key_concerns.split(/[,、]\s*/).filter(Boolean); } })()
              : (aiByTs.key_concerns || []),
            tasks: typeof aiByTs.tasks === 'string'
              ? (function () { try { return JSON.parse(aiByTs.tasks); } catch (_) { return []; } })()
              : (aiByTs.tasks || []),
            next_meeting_suggestion: aiByTs.next_meeting_suggestion || '',
          } : null;
          // 多重 fallback
          if (safeAi && (safeAi.transcript || safeAi.summary || safeAi.transcript_summary || safeAi.tasks?.length)) {
            showTranscriptModal(safeAi, '議事録 — ' + cname);
            return;
          }
          const transcript = (matched && matched.transcript)
            || btn.dataset.aiTranscript
            || btn.dataset.aiSummary
            || '';
          if (transcript) {
            showTranscriptModal(transcript, '議事録 — ' + cname);
            return;
          }
          // 議事録未生成 — 案内モーダル
          const ov = document.createElement('div');
          ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.78);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:"Hiragino Sans",sans-serif;padding:24px;';
          ov.innerHTML = `
            <div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:28px 32px;box-shadow:0 28px 80px rgba(0,0,0,0.4);">
              <div style="display:inline-flex;align-items:center;gap:8px;background:#FEF3C7;color:#92400E;font-size:11px;font-weight:800;padding:5px 12px;border-radius:99px;letter-spacing:0.12em;margin-bottom:14px;">⏳ 議事録 未生成</div>
              <h2 style="font-family:'Noto Serif JP',serif;font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">${escapeHtml(cname)} 様 / 議事録</h2>
              <p style="font-size:13px;color:#6b7280;line-height:1.75;margin:0 0 18px;">この面談の議事録は まだ 生成されていません。 次のいずれかが 原因です:</p>
              <ul style="font-size:12.5px;color:#374151;line-height:1.85;padding-left:22px;margin:0 0 18px;">
                <li>録画停止後 まだ AI 処理が <strong>完了していない</strong> (通常 30〜60 秒)</li>
                <li>録音は終わったが <strong>音声が短すぎた</strong> / 検出できなかった</li>
                <li>AI 処理が <strong>エラー</strong> で 止まった (録画ファイル自体は Drive に保存済)</li>
              </ul>
              <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="btn-cta-ghost" id="fp-mh-err-close">閉じる</button>
                <button class="btn-cta-primary" id="fp-mh-err-refresh" style="justify-content:center;">
                  <span>更新して再確認</span>
                  <span class="cta-arrow">↻</span>
                </button>
              </div>
            </div>`;
          document.body.appendChild(ov);
          document.getElementById('fp-mh-err-close').addEventListener('click', () => ov.remove());
          document.getElementById('fp-mh-err-refresh').addEventListener('click', async () => {
            ov.remove();
            await fetchLiveData();
            renderMeetingHistory();
          });
        });
      });
      root.querySelectorAll('[data-open-mh-client]').forEach(btn => {
        btn.addEventListener('click', () => {
          const uid = btn.dataset.openMhClient;
          const cname = btn.dataset.clientName;
          const c = (window.DUMMY_CLIENTS || []).find(x => x.lineFriendId === uid || (cname && x.name === cname));
          if (c && window.FpApp && window.FpApp.openClientModal) {
            window.FpApp.openClientModal(c.id);
          } else {
            alert('該当する顧客カードが見つかりません');
          }
        });
      });
    })();
  }

  // ============================
  // 初期化 (LINEタブが activate されたら)
  // ============================
  window.LineApp = {
    activateSubview: activateSubview,
    renderMeetingHistory: renderMeetingHistory,
    openQuickInpersonModal: openQuickInpersonModal,
    init: function () {
      document.querySelectorAll('.line-subtab').forEach(t => {
        t.addEventListener('click', () => activateSubview(t.dataset.lineSub));
      });
      const btn = document.getElementById('line-test-send-btn');
      if (btn) btn.addEventListener('click', openTestSendDialog);
      updateHeroStatus();
      activateSubview('leadHub');
    },
    refresh: function () {
      activateSubview(currentSubview);
    },
    // 起動直後に外部から呼べる: タブに関わらず liveData を取って FPCrmRefreshClients を発火
    bootLiveData: function () {
      fetchLiveData();
      // 30秒ごとに自動更新 (LINE 友だち追加や bookings 反映が常時走るよう)
      if (!window._fpBootInterval) {
        window._fpBootInterval = setInterval(fetchLiveData, 30000);
      }
    }
  };

  // 自動起動: app.js より後にロードされる line-app.js が IIFE 完了時に即 liveData fetch を開始
  // → LineApp タブを開いてなくても顧客台帳に LINE 友だちが反映される
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.LineApp.bootLiveData());
  } else {
    window.LineApp.bootLiveData();
  }
})();
