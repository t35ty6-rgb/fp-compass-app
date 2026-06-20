// LINE公式連携モジュール
// セグメント定義 / メッセージテンプレ / 配信スケジュール / 送信ログ / セグメント評価

(function () {
  const TODAY = new Date('2026-05-27');

  // ============================
  // セグメント定義
  // 各セグメントは clients を絞り込む述語と表示メタを持つ
  // ============================
  window.SEGMENTS = [
    {
      id: 'seg-all', name: '全顧客 (LINE連携済)', icon: '👥',
      color: 'gray',
      desc: 'LINE友だち追加してくれている全員',
      filter: c => c.lineSubscribed,
    },
    {
      id: 'seg-vip', name: 'VIP (AUM 3,000万以上)', icon: '⭐',
      color: 'purple',
      desc: '管理資産が3,000万円以上の上位顧客',
      filter: c => c.lineSubscribed && c.aum >= 30_000_000,
    },
    {
      id: 'seg-mid', name: 'コア (AUM 1,000〜3,000万)', icon: '🎯',
      color: 'accent',
      desc: '中核層・継続フォロー対象',
      filter: c => c.lineSubscribed && c.aum >= 10_000_000 && c.aum < 30_000_000,
    },
    {
      id: 'seg-young', name: '若年層 (35歳未満)', icon: '🌱',
      color: 'green',
      desc: 'NISA・結婚・住宅購入期',
      filter: c => c.lineSubscribed && window.LifeEvents.currentAge(c) < 35,
    },
    {
      id: 'seg-edu', name: '子育て世帯', icon: '🎒',
      color: 'accent',
      desc: '小学生〜高校生の子供がいる世帯',
      filter: c => c.lineSubscribed && (c.family || []).some(m => {
        if (m.rel !== 'child') return false;
        const age = window.LifeEvents.currentAge({ birth: m.birth });
        return age >= 6 && age <= 18;
      }),
    },
    {
      id: 'seg-pre-retire', name: '退職前世代 (55〜64歳)', icon: '🏖️',
      color: 'yellow',
      desc: '退職金準備・年金繰下げ判定対象',
      filter: c => {
        const a = window.LifeEvents.currentAge(c);
        return c.lineSubscribed && a >= 55 && a < 65;
      },
    },
    {
      id: 'seg-senior', name: 'シニア (65歳以上)', icon: '🌸',
      color: 'red',
      desc: '相続・介護準備対象',
      filter: c => c.lineSubscribed && window.LifeEvents.currentAge(c) >= 65,
    },
    {
      id: 'seg-stale', name: '半年以上未接触', icon: '⏰',
      color: 'red',
      desc: 'フォロー必須・再接点づくり',
      filter: c => {
        if (!c.lineSubscribed) return false;
        const days = Math.round((TODAY - new Date(c.lastContact)) / 86400000);
        return days >= 180;
      },
    },
    {
      id: 'seg-new', name: '新規顧客', icon: '🆕',
      color: 'accent',
      desc: '関係構築フェーズ',
      filter: c => c.lineSubscribed && c.status === 'new',
    },
  ];

  // ============================
  // メッセージテンプレ
  // ============================
  window.LINE_TEMPLATES = [
    {
      id: 'tpl-birthday', name: '誕生日メッセージ', cat: 'event',
      target: '本人 / 配偶者 / 子供 (誕生日当日)',
      body: '{{name}} 様\n\nお誕生日おめでとうございます🎉\nいつもお世話になり、ありがとうございます。\n\n{{age}}歳の節目に、改めてライフプランの見直しをしてみませんか?\nご都合のよいタイミングでメッセージください。\n\n— {{fp_name}}',
    },
    {
      id: 'tpl-monthly', name: '月次市場レポート', cat: 'broadcast',
      target: 'コア顧客以上',
      body: '{{name}} 様\n\n5月の運用レポートをお届けします📊\n\n■ 国内株: +2.4%\n■ 米国株: +1.8%\n■ 為替: 円高基調\n\n詳細レポート → {{report_url}}\n\nご質問はお気軽にどうぞ。',
    },
    {
      id: 'tpl-edu-summer', name: '夏休み・教育費お役立ち', cat: 'broadcast',
      target: '子育て世帯',
      body: '{{name}} 様\n\n夏休み前のお役立ち情報🎒\n\n児童手当・高校無償化の最新情報と、塾代・習い事の家計影響をまとめました。\n\n→ {{article_url}}\n\nお子様の教育資金について、いつでもご相談ください。',
    },
    {
      id: 'tpl-retirement', name: '退職前リマインド', cat: 'event',
      target: '55〜64歳',
      body: '{{name}} 様\n\n退職まで{{years_to_retire}}年。\n退職金受取方法 (一時金 vs 年金) で生涯手取りが数百万円変わることをご存知ですか?\n\n判定シート → {{tool_url}}\n\n一度シミュレーションしてみませんか?',
    },
    {
      id: 'tpl-stale-followup', name: '半年フォロー', cat: 'event',
      target: '半年以上未接触',
      body: '{{name}} 様\n\nお久しぶりです。お変わりありませんでしょうか?\n\n前回お話してから時間が経ちましたので、近況伺いも兼ねて15分ほどお時間いただけませんか?\n\nお気軽にメッセージください。',
    },
    {
      id: 'tpl-season-newyear', name: '新年のご挨拶', cat: 'season',
      target: '全顧客',
      body: '{{name}} 様\n\n新年あけましておめでとうございます🎍\n\n旧年中はお世話になりました。\n本年もご家族のライフプランを一緒に考えていきます。\nよろしくお願いいたします。',
    },
    {
      id: 'tpl-season-summer', name: '夏のご挨拶', cat: 'season',
      target: '全顧客',
      body: '{{name}} 様\n\n暑中お見舞い申し上げます🌻\n\nお盆休暇のご家族時間、いかがお過ごしですか?\nお子様の教育費・帰省時の親御様との相続話など、お盆をきっかけにご相談増える時期です。\n\nお気軽にどうぞ。',
    },
    {
      id: 'tpl-inherit', name: '相続対策ご案内', cat: 'event',
      target: '65歳以上',
      body: '{{name}} 様\n\n相続税制の改正情報をお届けします📜\n\n暦年贈与の見直しや生前対策で、お孫様に残せる金額が大きく変わります。\n\n面談ご希望の方はこちらから → {{calendar_url}}',
    },
  ];

  // ============================
  // 配信スケジュール
  // ============================
  window.LINE_SCHEDULES = [
    {
      id: 'sch-1', name: '月次市場レポート (コア+VIP)',
      segment: 'seg-mid', templateId: 'tpl-monthly',
      cadence: 'monthly', schedule: '毎月 第1月曜 10:00', enabled: true,
      lastSent: '2026-05-04', nextSend: '2026-06-01',
    },
    {
      id: 'sch-2', name: 'VIPデイリーマーケット情報',
      segment: 'seg-vip', templateId: 'tpl-monthly',
      cadence: 'weekly', schedule: '毎週 月曜 8:00', enabled: true,
      lastSent: '2026-05-26', nextSend: '2026-06-01',
    },
    {
      id: 'sch-3', name: '子育て世帯・教育費お役立ち',
      segment: 'seg-edu', templateId: 'tpl-edu-summer',
      cadence: 'monthly', schedule: '毎月 15日 10:00', enabled: true,
      lastSent: '2026-05-15', nextSend: '2026-06-15',
    },
    {
      id: 'sch-4', name: '退職前世代・年金準備リマインド',
      segment: 'seg-pre-retire', templateId: 'tpl-retirement',
      cadence: 'monthly', schedule: '毎月 1日 10:00', enabled: true,
      lastSent: '2026-05-01', nextSend: '2026-06-01',
    },
    {
      id: 'sch-5', name: '誕生日自動メッセージ',
      segment: 'auto-birthday', templateId: 'tpl-birthday',
      cadence: 'birthday', schedule: '対象者の誕生日当日 9:00', enabled: true,
      lastSent: '2026-05-25', nextSend: '本日 9:00 (3名)',
    },
    {
      id: 'sch-6', name: 'シニア・相続対策お役立ち',
      segment: 'seg-senior', templateId: 'tpl-inherit',
      cadence: 'monthly', schedule: '毎月 20日 10:00', enabled: true,
      lastSent: '2026-04-20', nextSend: '2026-06-20',
    },
    {
      id: 'sch-7', name: '半年フォロー (自動)',
      segment: 'seg-stale', templateId: 'tpl-stale-followup',
      cadence: 'weekly', schedule: '毎週 火曜 14:00', enabled: false,
      lastSent: null, nextSend: '— (停止中)',
    },
  ];

  // ============================
  // 送信ログ (直近)
  // ============================
  window.LINE_LOG = [
    { date: '2026-05-26 08:00', scheduleId: 'sch-2', segment: 'VIP', recipients: 5, success: 5, fail: 0, template: '月次市場レポート' },
    { date: '2026-05-25 09:00', scheduleId: 'sch-5', segment: '誕生日 (5/25)', recipients: 1, success: 1, fail: 0, template: '誕生日メッセージ', detail: '小林 浩 様 (孫: 結菜さん 誕生日)' },
    { date: '2026-05-20 10:00', scheduleId: 'sch-6', segment: 'シニア', recipients: 4, success: 4, fail: 0, template: '相続対策ご案内' },
    { date: '2026-05-19 08:00', scheduleId: 'sch-2', segment: 'VIP', recipients: 5, success: 5, fail: 0, template: '月次市場レポート' },
    { date: '2026-05-15 10:00', scheduleId: 'sch-3', segment: '子育て世帯', recipients: 9, success: 9, fail: 0, template: '教育費お役立ち' },
    { date: '2026-05-12 08:00', scheduleId: 'sch-2', segment: 'VIP', recipients: 5, success: 5, fail: 0, template: '月次市場レポート' },
    { date: '2026-05-04 10:00', scheduleId: 'sch-1', segment: 'コア+VIP', recipients: 15, success: 14, fail: 1, template: '月次市場レポート', detail: '中村様 ブロック解除待ち' },
    { date: '2026-05-01 10:00', scheduleId: 'sch-4', segment: '退職前世代', recipients: 6, success: 6, fail: 0, template: '退職金受取シミュ案内' },
  ];

  // ============================
  // 誕生日抽出 (向こう30日)
  // ============================
  function upcomingBirthdays(days) {
    days = days || 30;
    const result = [];
    const clients = window.DUMMY_CLIENTS || [];
    // ★ rel ラベルマップ (家系図 拡張13区分対応 / 退化バグ修正 2026-06-20)
    const REL_LABEL = {
      self: '本人',
      grandparent: '祖父母', parent: '親', parent_in_law: '義父母', uncle: 'おじ・おば',
      spouse: '配偶者', sibling: 'ご兄弟', sibling_in_law: '義兄弟', cousin: 'いとこ',
      child: 'お子様', child_in_law: '子の配偶者', nephew: '甥・姪', grandchild: 'お孫さん',
      other: 'その他',
    };
    clients.forEach(c => {
      // ★ filter 緩和: lineSubscribed 必須 → lineFriendId/userId/source=line_survey でも 通す (Firestore 客対応)
      const hasLineLink = c.lineSubscribed || c.lineFriendId || c.userId || c.source === 'line_survey' || c.source === 'line_follow';
      if (!hasLineLink) return;
      // 本人
      addBirthday(result, c, c, '本人', days);
      // 家族
      (c.family || []).forEach(m => {
        const rel = REL_LABEL[m.rel] || m.rel || 'その他';
        addBirthday(result, c, m, rel, days);
      });
    });
    result.sort((a, b) => a.daysAhead - b.daysAhead);
    return result;
  }

  function addBirthday(arr, client, person, rel, days) {
    if (!person.birth) return;
    const b = new Date(person.birth);
    const thisYear = new Date(TODAY.getFullYear(), b.getMonth(), b.getDate());
    let target = thisYear;
    if (target < TODAY) {
      // 今年は過ぎてるので来年
      target = new Date(TODAY.getFullYear() + 1, b.getMonth(), b.getDate());
    }
    const daysAhead = Math.round((target - TODAY) / 86400000);
    if (daysAhead >= 0 && daysAhead <= days) {
      const age = target.getFullYear() - b.getFullYear();
      arr.push({
        client: client,
        personName: person.name || person.kana,
        rel: rel,
        date: target,
        daysAhead: daysAhead,
        age: age,
      });
    }
  }

  // ============================
  // セグメント評価 (動的)
  // ============================
  function evaluateSegment(segId) {
    const seg = window.SEGMENTS.find(s => s.id === segId);
    if (!seg) return [];
    return (window.DUMMY_CLIENTS || []).filter(seg.filter);
  }

  // ============================
  // リード獲得導線 (友だち追加 → ステップ配信 → アンケート → Zoom予約 → CRM登録)
  // ============================

  // ステップ配信シナリオ
  window.LEAD_SCENARIO = {
    name: '初回相談獲得シナリオ',
    trigger: 'LINE友だち追加',
    enabled: true,
    steps: [
      { day: 0, time: '即時', title: 'ウェルカムメッセージ',
        body: 'はじめまして！🌱\n友だち追加ありがとうございます。\n\n私はファイナンシャルプランナーの山田です。\nお金・保険・住宅・教育費・老後など、人生のお金の話を一緒に考えるパートナーです。\n\nまずは1分の自己紹介動画をどうぞ → {{intro_video}}' },
      { day: 1, time: '10:00', title: 'お役立ち資料',
        body: '昨日はありがとうございました📊\n\nまずは無料の「家計診断シート」をどうぞ。\nこれだけで月3万円浮く人もいます。\n\nダウンロード → {{sheet_url}}' },
      { day: 3, time: '10:00', title: 'お悩みヒアリング',
        body: '3問だけお伺いさせてください🙏\n\n回答してくれた方には、あなたに合うライフプラン無料相談 (60分・通常¥11,000) をプレゼント中です。\n\n回答する → {{form_url}}' },
      { day: 5, time: '20:00', title: 'リマインド (未回答者のみ)',
        body: '先日のアンケート、まだの方へ✋\n\n1分で終わります。\n回答完了で60分無料相談が受けられます。\n\n→ {{form_url}}' },
      { day: 7, time: '10:00', title: '相談予約のご案内 (回答済のみ)',
        body: 'アンケートのご回答ありがとうございました📩\n\n{{name}}様のお悩みを伺って、私からご提案できることが3つほどあります。\n\nZoomで60分、ご都合のよい日時を選んでください。\n→ {{booking_url}}' },
    ],
  };

  // ヒアリングアンケート項目
  window.LEAD_FORM = {
    title: '無料相談前のヒアリング (1分)',
    questions: [
      { id: 'q1', type: 'choice', label: '一番気になっているテーマは?',
        options: ['老後資金', '教育費・学資', '住宅購入・ローン', '保険見直し', '相続・贈与', 'NISA・投資', 'その他'] },
      { id: 'q2', type: 'choice', label: 'ご年齢は?',
        options: ['20代', '30代', '40代', '50代', '60代', '70代以上'] },
      { id: 'q3', type: 'choice', label: 'ご家族構成は?',
        options: ['独身', '夫婦のみ', '夫婦+子供', 'シングル+子供', 'シニア夫婦', 'その他'] },
      { id: 'q4', type: 'choice', label: '世帯年収は?',
        options: ['〜400万', '400〜700万', '700〜1000万', '1000〜1500万', '1500万〜', '回答しない'] },
      { id: 'q5', type: 'text', label: '相談で解決したいこと (一言)' },
    ],
  };

  // ファネル KPI (直近30日)
  window.LEAD_FUNNEL = {
    days: 30,
    friendAdded: 42,
    answeredSurvey: 18,
    booked: 11,
    completed: 8,
    converted: 5,
  };

  // 直近の予約 (実顧客の Firestore データで動的注入されるため空で初期化)
  window.UPCOMING_BOOKINGS = [];

  // アンケート回答済・未予約 (ホットリード) — 実顧客データで動的注入のため空
  window.HOT_LEADS = [];

  // アンケート回答 + 候補日 (実顧客 Firestore データ で動的注入のため空)
  window.SURVEY_DEMO = [];
  /* ↓ 旧デモデータ 全削除 (実顧客 leak 防止)
  window.SURVEY_DEMO_LEGACY = [
    {
      ts: '2026-05-27T14:30:00.000Z',
      userId: 'Udemo1a4b8e1f6c3d2e9001',
      displayName: '佐々木 麻奈',
      q1_テーマ: '老後資金',
      q2_年代: '50代',
      q3_家族: '夫婦のみ',
      q4_年収: '1000〜1500万',
      q5_悩み: '退職金2,000万の運用方法を相談したい',
      q6_候補1: '2026-06-02 午後 14:00',
      q7_候補2: '2026-06-04 夜 20:00',
      q8_候補3: '2026-06-07 午前 10:00',
      confirmedSlot: '',
    },
    {
      ts: '2026-05-27T18:45:00.000Z',
      userId: 'Udemo2a4b8e1f6c3d2e9002',
      displayName: '佐藤 翔太',
      q1_テーマ: '教育費・学資',
      q2_年代: '30代',
      q3_家族: '夫婦+子供',
      q4_年収: '700〜1000万',
      q5_悩み: '小1の娘の中学受験を考えていて費用が不安',
      q6_候補1: '2026-06-01 夜 19:00',
      q7_候補2: '2026-06-03 午後 16:00',
      q8_候補3: '2026-06-05 午後 14:00',
      confirmedSlot: '',
    },
    {
      ts: '2026-05-26T10:15:00.000Z',
      userId: 'Udemo3a4b8e1f6c3d2e9003',
      displayName: '近藤 達也',
      q1_テーマ: '住宅購入・ローン',
      q2_年代: '30代',
      q3_家族: '夫婦のみ',
      q4_年収: '700〜1000万',
      q5_悩み: '住宅ローン頭金いくら入れるか迷っています',
      q6_候補1: '2026-06-02 午前 11:00',
      q7_候補2: '2026-06-06 午後 15:00',
      q8_候補3: '2026-06-08 夜 19:00',
      confirmedSlot: '',
    },
    {
      ts: '2026-05-25T09:30:00.000Z',
      userId: 'Udemo4a4b8e1f6c3d2e9004',
      displayName: '木下 さおり',
      q1_テーマ: '相続・贈与',
      q2_年代: '60代',
      q3_家族: 'シニア夫婦',
      q4_年収: '1500万〜',
      q5_悩み: '親の相続が発生、どこから手をつけるべきか',
      q6_候補1: '2026-05-30 午後 14:00',
      q7_候補2: '2026-06-01 午後 15:00',
      q8_候補3: '2026-06-03 午前 10:00',
      confirmedSlot: '',
    },
  ];

  // 年末カレンダー配布 デモデータ (実LIVEが空の時のみ表示)
  // 住所は福井市内の Google マップで100%ヒットする実在地名のみ使用
  window.CALENDAR_DEMO = [
    { name: '田中 健一', status: '要', address: '福井県福井市中央1丁目1-1', phone: '090-1234-5678', note: '平日午前希望', userId: 'demo-1' },
    { name: '佐藤 由美', status: '要', address: '福井県福井市大手3丁目10-1', phone: '080-2345-6789', note: '玄関前置きOK', userId: 'demo-2' },
    { name: '鈴木 大輔', status: '要', address: '福井県福井市花堂南2丁目16-1', phone: '', note: '土曜の午後がよい', userId: 'demo-3' },
    { name: '高橋 真理子', status: '要', address: '福井県福井市大和田2丁目1212', phone: '0776-22-3344', note: '', userId: 'demo-4' },
    { name: '山本 雄一', status: '要', address: '福井県福井市田原1丁目13-6', phone: '0776-12-3456', note: '', userId: 'demo-5' },
    { name: '中村 美穂', status: '要', address: '福井県福井市文京3丁目9-1', phone: '0776-33-4455', note: '在宅勤務日に', userId: 'demo-6' },
    { name: '伊藤 拓海', status: '要', address: '', phone: '', note: '', userId: 'demo-7' },
    { name: '渡辺 さくら', status: '要', address: '', phone: '', note: '', userId: 'demo-8' },
    { name: '小林 浩', status: '不要', address: '', phone: '', note: '', userId: 'demo-9' },
    { name: '加藤 麻衣', status: '不要', address: '', phone: '', note: '', userId: 'demo-10' },
    { name: '吉田 翔太', status: '', address: '', phone: '', note: '', userId: 'demo-11' },
    { name: '山田 智子', status: '', address: '', phone: '', note: '', userId: 'demo-12' },
  ];
  */
  window.CALENDAR_DEMO = [];

  window.LineCRM = {
    evaluateSegment: evaluateSegment,
    upcomingBirthdays: upcomingBirthdays,
    TODAY: TODAY,
    // 予約 → CRM新規顧客 自動登録
    convertBookingToClient: function (booking) {
      if (booking.addedToCrm) return null;
      const newClient = {
        id: 'c' + String(Date.now()).slice(-5),
        name: booking.name,
        kana: '',
        birth: '1985-01-01', // アンケート年代から推定 (デモ)
        gender: 'O',
        occupation: '',
        family: [],
        source: 'LINE無料相談',
        status: 'new',
        aum: 0,
        lastContact: booking.date,
        proposals: [],
        note: '【アンケート回答】\n' +
              `テーマ: ${booking.answers.q1}\n` +
              `年代: ${booking.answers.q2}\n` +
              `家族: ${booking.answers.q3}\n` +
              `年収: ${booking.answers.q4}\n` +
              `お悩み: ${booking.answers.q5}\n\n` +
              `Zoom面談: ${booking.date} ${booking.time}`,
        lineFriendId: 'U-lead-' + booking.id,
        lineSubscribed: true,
      };
      booking.addedToCrm = true;
      (window.DUMMY_CLIENTS || []).push(newClient);
      try { localStorage.setItem('fp-crm-clients-v1', JSON.stringify(window.DUMMY_CLIENTS)); } catch (e) {}
      return newClient;
    },
  };
})();
