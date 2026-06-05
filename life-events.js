// ライフイベント自動生成
// 顧客の家族構成・年齢から、向こう30年の人生イベントを自動でタイムライン化する。
// FPの「次に何を話すか」が一目で分かることを目的とする。

(function () {
  // ★ オーナーfb「最終接触 -6日」「全員41歳」バグ修正:
  // 過去ハードコード '2026-05-27' が原因 → 動的に「今日」を取得
  const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);

  // 年齢別のライフイベントテンプレ
  const SELF_EVENTS = [
    { age: 50, label: '住宅ローン総点検', cat: 'finance' },
    { age: 55, label: '退職金準備強化期', cat: 'retirement' },
    { age: 60, label: '定年・退職金受取検討', cat: 'retirement', major: true },
    { age: 65, label: '年金受給開始 / 繰下げ判定', cat: 'retirement', major: true },
    { age: 70, label: 'NISA出口戦略', cat: 'finance' },
    { age: 75, label: '後期高齢者医療制度', cat: 'health', major: true },
    { age: 80, label: '相続対策最終調整', cat: 'inherit' },
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
    const horizonYears = 30;
    const horizonDate = new Date(TODAY);
    horizonDate.setFullYear(TODAY.getFullYear() + horizonYears);

    // 本人イベント
    SELF_EVENTS.forEach(tpl => {
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
    const a = age(client.birth, TODAY);
    return isNaN(a) ? null : a;
  }

  window.LifeEvents = {
    generate: generateEvents,
    currentAge: currentAge,
    formatRelative: formatRelative,
    TODAY: TODAY,
  };
})();
