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
    { age: 55, label: '退職金準備強化期', cat: 'retirement', key: 'preRetire',
      cond: c => clientOccMatches(c, /会社員|公務員|専門職/) },
    { age: 60, label: '定年・退職金受取検討', cat: 'retirement', major: true, key: 'retire',
      cond: c => clientOccMatches(c, /会社員|公務員|専門職/) },
    { age: 65, label: '年金受給開始 / 繰下げ判定', cat: 'retirement', major: true }, // 全員
    { age: 70, label: 'NISA出口戦略', cat: 'finance',
      cond: c => clientHas(c, /NISA/i) },
    { age: 70, label: 'iDeCo 出口戦略', cat: 'finance',
      cond: c => clientHas(c, /iDeCo|企業型|個人型|DC/i) },
    { age: 75, label: '後期高齢者医療制度', cat: 'health', major: true }, // 全員
    { age: 80, label: '相続対策最終調整', cat: 'inherit' }, // 全員
  ];

  // 2026-11-20: 進学 は 年齢 では なく 「小学校 に 入る 年」 から 数える (plus = 入学 から 何 年 後 の 4 月 か)。
  //   旧: 6 歳 の 誕生日 の 年 の 4 月 → 4/2〜12 月 生まれ (= ほとんど の 子) で 1 年 早く 出て いた。
  const CHILD_EVENTS = [
    { plus: 0, label: '小学校入学', cat: 'education' },
    { plus: 6, label: '中学校入学', cat: 'education' },
    { plus: 9, label: '高校入学', cat: 'education' },
    { plus: 12, label: '大学入学 (教育費ピーク)', cat: 'education', major: true },
    { plus: 16, label: '就職', cat: 'family' },
    { age: 30, label: '結婚適齢期', cat: 'family' },
  ];
  // 家系図 の 続柄 (長男 / 長女 …) も お子様 と して 扱う。 旧: rel === 'child' だけ で、 家系図 から 入れた 子 は 進学 が 出なかった。
  const CHILD_RELS = { child: 1, son_1st: 1, daughter_1st: 1, son_2nd: 1, daughter_2nd: 1, son_3rd: 1, daughter_3rd: 1, child_other: 1 };
  const REL_JA = { spouse: '配偶者', child: 'お子様', son_1st: '長男', daughter_1st: '長女', son_2nd: '次男', daughter_2nd: '次女', son_3rd: '三男', daughter_3rd: '三女', child_other: 'お子様' };
  function isChildRel(rel) { return !!CHILD_RELS[String(rel || '')]; }
  function parseBirth(birth) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birth || ''));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  // 小学校 に 入る 年。 4/2 〜 翌 4/1 生まれ が 同じ 学年 (早生まれ は 6 歳 に なる 年、 それ 以外 は 7 歳 に なる 年)。
  function elemEntryYear(birth) {
    const b = parseBirth(birth);
    if (!b) return null;
    const mo = b.getMonth() + 1, da = b.getDate();
    const early = mo < 4 || (mo === 4 && da === 1);
    return b.getFullYear() + (early ? 6 : 7);
  }
  function validAge(v, lo, hi) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return (isFinite(n) && n >= lo && n <= hi) ? Math.round(n) : null;
  }

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
    const myAge = parseBirth(client.birth) ? age(client.birth, TODAY) : 40;
    const horizonYears = Math.max(30, 82 - myAge); // 最低30年、 上は82歳まで
    const horizonDate = new Date(TODAY);
    horizonDate.setFullYear(TODAY.getFullYear() + horizonYears);

    // 本人イベント (条件付きテンプレ — 持ってない商品/該当しない職業 は スキップ)
    //   2026-11-20: 退職 の 予定 年齢 (client.retireAge) が 分かって いる とき は、 60 歳 固定 では なく その 年齢 で 出す。
    //   生年月日 が 面談 で 聞いた 年齢 から の 逆算 (birthApprox) の とき は approx = おおよそ の 印 を 付ける。
    const selfBirthOk = !!parseBirth(client.birth);
    const selfApprox = !!(client.birthApprox && client.birthSource && client.birthSource.birth === client.birth);
    const selfSrc = selfApprox ? 'minutes' : '';
    const retireAge = validAge(client.retireAge, 45, 85);
    if (selfBirthOk) SELF_EVENTS.forEach(tpl => {
      let atAge = tpl.age, label = tpl.label, src = selfSrc;
      if (retireAge !== null && tpl.key === 'retire') {
        atAge = retireAge; label = '退職の予定 (' + retireAge + '歳)';
        if (client.retireAgeAuto) src = 'minutes';
      } else if (retireAge !== null && tpl.key === 'preRetire') {
        atAge = retireAge - 5;
      } else if (tpl.cond && !tpl.cond(client)) return; // 条件不一致なら スキップ
      const d = eventDate(client.birth, atAge);
      if (d >= TODAY && d <= horizonDate) {
        events.push({
          date: d,
          who: client.name,
          label: label,
          cat: tpl.cat,
          major: !!tpl.major,
          by: parseBirth(client.birth).getFullYear(),
          subject: 'self',
          approx: selfApprox,
          src: src,
        });
      }
    });

    // 家族イベント
    (client.family || []).forEach(member => {
      if (!member || !parseBirth(member.birth)) return;   // 生年月日 が 無い 人 は 計算 できない
      const who = member.name || REL_JA[member.rel] || 'ご家族';
      const src = member.addedByAI || member.birthApprox ? 'minutes' : '';
      if (isChildRel(member.rel)) {
        const entry = elemEntryYear(member.birth);
        // 学年 から 逆算 した 子 (aiGrade) は 進学 の 年 が ずれない。 年齢 だけ から の 子 は 1 年 ずれる こと が ある。
        const schoolApprox = !!member.birthApprox && !member.aiGrade;
        CHILD_EVENTS.forEach(tpl => {
          const bySchool = tpl.plus !== undefined;
          const d = bySchool ? new Date(entry + tpl.plus, 3, 1) : eventDate(member.birth, tpl.age);
          if (d >= TODAY && d <= horizonDate) {
            events.push({
              date: d,
              who: who,
              label: tpl.label,
              cat: tpl.cat,
              major: !!tpl.major,
              by: parseBirth(member.birth).getFullYear(),
              subject: 'child',
              approx: bySchool ? schoolApprox : !!member.birthApprox,
              month: bySchool,          // 進学 は 4 月 と 決まって いる
              src: src,
            });
          }
        });
      } else if (member.rel === 'spouse') {
        const spRetire = validAge(member.retireAge, 45, 85);
        SPOUSE_EVENTS.forEach(tpl => {
          let atAge = tpl.age, label = tpl.label, s2 = src;
          if (spRetire !== null && tpl.age === 60) {
            atAge = spRetire; label = '配偶者・退職の予定 (' + spRetire + '歳)';
            if (member.retireAgeAuto) s2 = 'minutes';
          }
          const d = eventDate(member.birth, atAge);
          if (d >= TODAY && d <= horizonDate) {
            events.push({
              date: d,
              who: who,
              label: label,
              cat: tpl.cat,
              major: !!tpl.major,
              by: parseBirth(member.birth).getFullYear(),
              subject: 'spouse',
              approx: !!member.birthApprox,
              src: s2,
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
          // 自動 で 作った 予定 (auto) は 「議事録 から」 の 印 を 画面 側 で 付ける ので、 絵文字 は 付けない
          label: (ev.auto ? '' : '🎙 ') + (ev.label || '面談で言及'),
          cat: ev.cat || 'family',
          major: (ev.confidence || 0) >= 0.8,
          source: ev.source || 'AI抽出',
          confidence: ev.confidence,
          approx: /^\d{4}$/.test(String(ev.date)),   // 年 だけ 分かって いる 予定
          month: /^\d{4}-\d{2}/.test(String(ev.date)),
          src: 'minutes',
          customId: ev.id || '',
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

  // 画面 に 出す 小さな 印 の 文言。 src='minutes' = 面談 の 記録 から 自動 で 入れた もの、 approx = 時期 が おおよそ。
  function tagText(ev) {
    if (!ev) return '';
    if (ev.src === 'minutes') return ev.approx ? '議事録から・おおよそ' : '議事録から';
    return ev.approx ? 'おおよそ' : '';
  }

  window.LifeEvents = {
    generate: generateEventsCached,
    currentAge: currentAge,
    formatRelative: formatRelative,
    TODAY: TODAY,
    // 家族 / 生年月日 / 予定 を 書き換えた 後 に 呼ぶ (同じ client の 計算 結果 を 捨てる)
    invalidate: function (client) { try { if (client && typeof client === 'object') _genCache.delete(client); } catch (_) {} },
    isChildRel: isChildRel,
    elemEntryYear: elemEntryYear,
    relLabel: function (rel) { return REL_JA[rel] || ''; },
    tagText: tagText,
  };
})();
