// ライフイベント自動生成
// 顧客の家族構成・年齢から、向こう30年の人生イベントを自動でタイムライン化する。
// FPの「次に何を話すか」が一目で分かることを目的とする。

(function () {
  // ★ オーナーfb「最終接触 -6日」「全員41歳」バグ修正:
  // 過去ハードコード '2026-05-27' が原因 → 動的に「今日」を取得
  const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);

  // ★ 顧客が 「商品/属性 を 持ってるか」 判定 (アンケート q7_保有 + q14_既存商品 + productsManual − productsRemoved)
  function clientHas(client, pattern) {
    const surveys = (window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [];
    const s = surveys.find(x =>
      (x.userId && client.lineFriendId && x.userId === client.lineFriendId) ||
      (x.name && client.name && x.name === client.name)
    ) || {};
    const raw = String(s.q7_保有 || '') + ' ' + String(s.q14_既存商品 || '');
    const fromSurvey = pattern.test(raw);
    const inManual = (client.productsManual || []).some(k => pattern.test(k));
    const inRemoved = (client.productsRemoved || []).some(k => pattern.test(k));
    return (fromSurvey || inManual) && !inRemoved;
  }
  function clientOccMatches(client, pattern) {
    const surveys = (window.LineAppLiveData && window.LineAppLiveData.survey_answers) || [];
    const s = surveys.find(x =>
      (x.userId && client.lineFriendId && x.userId === client.lineFriendId) ||
      (x.name && client.name && x.name === client.name)
    ) || {};
    return pattern.test(client.occupation || '') || pattern.test(s.q2_職業 || '') || pattern.test(s.q9_職業 || '');
  }

  // ★ 顧客の 属性/商品 に応じた 条件付き ライフイベント (cond 関数 で 適用判定)
  //   cond なし = 全員に適用 (年金/後期高齢/相続 等)
  const SELF_EVENTS = [
    { age: 50, label: '住宅ローン総点検', cat: 'finance',
      cond: c => !!(c.mortgage) || clientHas(c, /住宅ローン|住宅ロ|住宅L/) },
    { age: 55, label: '退職金準備強化期', cat: 'retirement',
      cond: c => clientOccMatches(c, /会社員|公務員|専門職/) },
    { age: 60, label: '定年・退職金受取検討', cat: 'retirement', major: true,
      cond: c => clientOccMatches(c, /会社員|公務員|専門職/) },
    { age: 65, label: '年金受給開始 / 繰下げ判定', cat: 'retirement', major: true }, // 全員
    { age: 70, label: 'NISA出口戦略', cat: 'finance',
      cond: c => clientHas(c, /NISA/i) },
    { age: 70, label: 'iDeCo 出口戦略', cat: 'finance',
      cond: c => clientHas(c, /iDeCo|企業型|個人型|DC/i) },
    { age: 75, label: '後期高齢者医療制度', cat: 'health', major: true }, // 全員
    { age: 80, label: '相続対策最終調整', cat: 'inherit' }, // 全員
  ];

  const CHILD_EVENTS = [
    { age: 6, label: '小学校入学', cat: 'education' },
    { age: 12, label: '中学校入学', cat: 'education' },
    { age: 15, label: '高校入学', cat: 'education' },
    { age: 18, label: '大学入学 (教育費ピーク)', cat: 'education', major: true },
    { age: 22, label: '就職', cat: 'family' },
    { age: 30, label: '結婚適齢期', cat: 'family' },
  ];

  const SPOUSE_EVENTS = [
    { age: 60, label: '配偶者・定年', cat: 'retirement' },
    { age: 65, label: '配偶者・年金受給', cat: 'retirement' },
    { age: 75, label: '配偶者・後期高齢者', cat: 'health' },
  ];

  function age(birth, atDate) {
    const b = new Date(birth);
    let a = atDate.getFullYear() - b.getFullYear();
    const m = atDate.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && atDate.getDate() < b.getDate())) a--;
    return a;
  }

  function eventDate(birth, atAge) {
    const b = new Date(birth);
    const target = new Date(b);
    target.setFullYear(b.getFullYear() + atAge);
    // 教育系は4月入学に寄せる
    return target;
  }

  function adjustEducationToApril(date) {
    // その年の4月1日に寄せる
    const d = new Date(date);
    return new Date(d.getFullYear(), 3, 1);
  }

  function generateEvents(client) {
    const events = [];
    // ★ オーナーfb「29歳客で2件しか出ない」: 30年固定 → 「82歳到達まで」 動的化
    //   何歳の客でも 50/55/60/65/70/75/80 節目 全部 + 子の進学 全部 が必ず表示される
    const myAge = client.birth ? age(client.birth, TODAY) : 40;
    const horizonYears = Math.max(30, 82 - myAge); // 最低30年、 上は82歳まで
    const horizonDate = new Date(TODAY);
    horizonDate.setFullYear(TODAY.getFullYear() + horizonYears);

    // 本人イベント (条件付きテンプレ — 持ってない商品/該当しない職業 は スキップ)
    SELF_EVENTS.forEach(tpl => {
      if (tpl.cond && !tpl.cond(client)) return; // 条件不一致なら スキップ
      const d = eventDate(client.birth, tpl.age);
      if (d >= TODAY && d <= horizonDate) {
        events.push({
          date: d,
          who: client.name,
          label: tpl.label,
          cat: tpl.cat,
          major: !!tpl.major,
        });
      }
    });

    // 家族イベント
    (client.family || []).forEach(member => {
      if (member.rel === 'child') {
        CHILD_EVENTS.forEach(tpl => {
          let d = eventDate(member.birth, tpl.age);
          if (tpl.cat === 'education') d = adjustEducationToApril(d);
          if (d >= TODAY && d <= horizonDate) {
            events.push({
              date: d,
              who: member.name,
              label: tpl.label,
              cat: tpl.cat,
              major: !!tpl.major,
            });
          }
        });
      } else if (member.rel === 'spouse') {
        SPOUSE_EVENTS.forEach(tpl => {
          const d = eventDate(member.birth, tpl.age);
          if (d >= TODAY && d <= horizonDate) {
            events.push({
              date: d,
              who: member.name,
              label: tpl.label,
              cat: tpl.cat,
              major: !!tpl.major,
            });
          }
        });
      }
    });

    // 住宅ローン完済
    if (client.mortgage && client.mortgage.remainingYears) {
      const d = new Date(TODAY);
      d.setFullYear(d.getFullYear() + client.mortgage.remainingYears);
      if (d <= horizonDate) {
        events.push({
          date: d,
          who: client.name,
          label: '住宅ローン完済',
          cat: 'finance',
          major: true,
        });
      }
    }

    // ★ Zoom議事録から AI 抽出された 個別ライフイベント (client.customEvents[])
    (client.customEvents || []).forEach(ev => {
      if (!ev || !ev.date) return;
      // 'YYYY-MM' を 'YYYY-MM-01' に補完、 'YYYY' を 'YYYY-06-01' に補完
      let dStr = String(ev.date);
      if (/^\d{4}$/.test(dStr)) dStr += '-06-01';
      else if (/^\d{4}-\d{2}$/.test(dStr)) dStr += '-01';
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return;
      if (d >= TODAY && d <= horizonDate) {
        events.push({
          date: d,
          who: ev.who || client.name,
          label: '🎙 ' + (ev.label || '面談で言及'),
          cat: ev.cat || 'family',
          major: (ev.confidence || 0) >= 0.8,
          source: ev.source || 'AI抽出',
          confidence: ev.confidence,
        });
      }
    });

    events.sort((a, b) => a.date - b.date);
    return events;
  }

  function formatRelative(date) {
    const diffMs = date - TODAY;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `${Math.abs(diffDays)}日前`;
    if (diffDays === 0) return '今日';
    if (diffDays < 30) return `${diffDays}日後`;
    const diffMonths = Math.round(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}ヶ月後`;
    const years = (diffDays / 365).toFixed(1);
    return `${years}年後`;
  }

  function currentAge(client) {
    if (!client || !client.birth) return null;
    // ★ birth が将来日 / 不正値の場合 null を返す (-1歳バグ防止)
    const b = new Date(client.birth);
    if (isNaN(b.getTime()) || b > TODAY) return null;
    const a = age(client.birth, TODAY);
    return (isNaN(a) || a < 0) ? null : a;
  }

  // ★ オーナーfb 2026-06-20: 重い → generateEvents 結果を WeakMap キャッシュ (同じ client 何度呼ばれても再計算0)
  const _genCache = new WeakMap();
  function generateEventsCached(client) {
    if (!client || typeof client !== 'object') return generateEvents(client);
    const cached = _genCache.get(client);
    if (cached) return cached;
    const r = generateEvents(client);
    _genCache.set(client, r);
    return r;
  }

  window.LifeEvents = {
    generate: generateEventsCached,
    currentAge: currentAge,
    formatRelative: formatRelative,
    TODAY: TODAY,
  };
})();
