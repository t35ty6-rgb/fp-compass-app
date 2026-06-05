// 次アクション自動レコメンダー
// 顧客の状態 + 生成済みライフイベントから、FPが次に打つべき手を提案する。
// 優先度 (priority) は数値が大きいほど急ぎ。

(function () {
  const TODAY = new Date('2026-05-27');
  const ONE_DAY = 1000 * 60 * 60 * 24;

  function daysBetween(d1, d2) {
    return Math.round((d2 - d1) / ONE_DAY);
  }

  function daysSinceLastContact(client) {
    if (!client.lastContact) return 9999;
    return daysBetween(new Date(client.lastContact), TODAY);
  }

  // イベント発生 N ヶ月前から提案ウィンドウを開く設定
  const RULES = {
    education: { leadMonths: 36, action: '教育資金プラン提案', priority: 80 },
    retirement: { leadMonths: 60, action: '退職・年金設計提案', priority: 75 },
    health: { leadMonths: 24, action: '医療・介護費備え提案', priority: 70 },
    inherit: { leadMonths: 36, action: '相続・贈与対策提案', priority: 85 },
    finance: { leadMonths: 12, action: '資産配分見直し提案', priority: 60 },
    family: { leadMonths: 12, action: '家族構成変化対応', priority: 65 },
  };

  function recommendForClient(client, events) {
    const recs = [];

    // 接触頻度ベース
    const dslc = daysSinceLastContact(client);
    if (dslc >= 365) {
      recs.push({
        action: '定期レビュー (1年以上未接触)',
        reason: `最終接触 ${dslc}日前`,
        priority: 90,
        dueDate: TODAY,
      });
    } else if (dslc >= 180 && client.status !== 'dormant') {
      recs.push({
        action: '定期フォロー (半年経過)',
        reason: `最終接触 ${dslc}日前`,
        priority: 55,
        dueDate: TODAY,
      });
    }

    // ライフイベントベース
    events.forEach(ev => {
      const rule = RULES[ev.cat];
      if (!rule) return;
      const daysToEvent = daysBetween(TODAY, ev.date);
      const leadDays = rule.leadMonths * 30;
      if (daysToEvent <= leadDays && daysToEvent >= 0) {
        // major イベント、または直近6ヶ月以内のみレコメンド
        if (ev.major || daysToEvent <= 180) {
          recs.push({
            action: rule.action,
            reason: `${ev.who} : ${ev.label} (${formatRelative(ev.date)})`,
            priority: rule.priority + (ev.major ? 10 : 0) + Math.max(0, 30 - Math.floor(daysToEvent / 30)),
            dueDate: ev.date,
            event: ev,
          });
        }
      }
    });

    // 提案中の案件があれば優先
    (client.proposals || []).forEach(p => {
      if (p.result === '提案中' || p.result === '検討中') {
        const daysSince = daysBetween(new Date(p.date), TODAY);
        if (daysSince >= 14) {
          recs.push({
            action: 'フォローアップ : ' + p.title,
            reason: `${p.result} のまま ${daysSince}日経過`,
            priority: 70 + Math.min(20, Math.floor(daysSince / 30)),
            dueDate: TODAY,
          });
        }
      }
    });

    recs.sort((a, b) => b.priority - a.priority);
    return recs;
  }

  function formatRelative(date) {
    const diffDays = Math.round((date - TODAY) / ONE_DAY);
    if (diffDays < 0) return `${Math.abs(diffDays)}日前`;
    if (diffDays === 0) return '今日';
    if (diffDays < 30) return `${diffDays}日後`;
    const diffMonths = Math.round(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}ヶ月後`;
    return `${(diffDays / 365).toFixed(1)}年後`;
  }

  // 全顧客分の "今週話すべき" 上位リストを作る
  function topActionsAcrossClients(clients, limit) {
    const all = [];
    clients.forEach(c => {
      const events = window.LifeEvents.generate(c);
      const recs = recommendForClient(c, events);
      if (recs.length > 0) {
        all.push({
          client: c,
          topAction: recs[0],
          totalRecs: recs.length,
        });
      }
    });
    all.sort((a, b) => b.topAction.priority - a.topAction.priority);
    return all.slice(0, limit || 10);
  }

  window.Recommender = {
    forClient: recommendForClient,
    topAcrossClients: topActionsAcrossClients,
    daysSinceLastContact: daysSinceLastContact,
  };
})();
