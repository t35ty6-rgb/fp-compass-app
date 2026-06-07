// FP顧客管理ツール デモ用ダミーデータ
// 30人分。100人規模のリアルさが伝わるよう多様な家族構成・年齢・ステージを散らしている。

(function () {
  // Version marker — used by index.html diagnostic banner to detect stale cache
  window.DUMMY_CLIENTS_VERSION = 'v2-line-history-20260602';

  const today = new Date('2026-05-27');
  const Y = today.getFullYear();

  function ymd(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  function daysAgo(n) {
    const d = new Date(today); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  window.DUMMY_CLIENTS = [
    {
      // ★テスト客 (デモ用架空) — 実LINE userIdで本物の送受信デモ可能
      id: 'c000', name: '[テスト] サンプル 太郎', kana: 'さんぷる たろう',
      birth: ymd(Y - 35, 6, 15), gender: 'M', occupation: '会社経営 (IT)',
      family: [
        { rel: 'spouse', name: 'サンプル 花子', birth: ymd(Y - 33, 3, 10) },
      ],
      source: 'デモテスト', status: 'important', aum: 12_000_000,
      lastContact: daysAgo(45),
      proposals: [
        { date: daysAgo(60), title: '資産配分レビュー (NISA枠フル活用)', result: '検討中' },
      ],
      note: '★デモテスト用。本番フロー検証中。',
      lineFriendId: 'U5b483d87fba587b07696daadda350693',
      lineSubscribed: true,
      cancellations: [],
      lineHistory: [
        { direction: 'in', ts: '2026-04-18 10:00', text: 'お世話になっております。資産運用のご相談したく、ご連絡しました。' },
        { direction: 'out', ts: '2026-04-18 10:30', text: 'サンプル様\n\nご連絡ありがとうございます、FPの福田です。お話伺うのが楽しみです。アンケートよろしくお願いいたします。', label: '初回返信' },
      ],
    },
    {
      id: 'c001', name: '田中 健一', kana: 'たなか けんいち',
      birth: ymd(Y - 38, 4, 12), gender: 'M', occupation: '会社員 (IT)',
      family: [
        { rel: 'spouse', name: '田中 美咲', birth: ymd(Y - 36, 7, 3) },
        { rel: 'child', name: '田中 大翔', birth: ymd(Y - 8, 2, 19) },
        { rel: 'child', name: '田中 結愛', birth: ymd(Y - 5, 11, 8) },
      ],
      source: '紹介 (鈴木様)', status: 'active', aum: 8_500_000,
      mortgage: { remainingYears: 28, monthly: 118_000 },
      lastContact: daysAgo(45),
      proposals: [
        { date: daysAgo(180), title: '学資保険 (大翔様)', result: '成約' },
        { date: daysAgo(45), title: 'iDeCo拠出額見直し', result: '検討中' },
      ],
      note: '長期積立に積極。来年マイホーム買い替え検討中。',
      lineFriendId: 'U001a4b8e1f6c3d2e9001',
      lineSubscribed: true,
      cancellations: [
        { date: daysAgo(120), slot: '10:00〜11:00', reason: '今は忙しい' },
        { date: daysAgo(8), slot: '19:00〜20:00', reason: '日程が合わなかった' },
      ],
      lineHistory: [
        { direction: 'in', ts: daysAgo(180) + ' 10:23', text: 'ご連絡ありがとうございます、初めての相談で緊張しています。' },
        { direction: 'out', ts: daysAgo(180) + ' 10:35', text: '田中様\n\nお問い合わせありがとうございます。FP福田です。緊張なさらず、率直なお話ができればと思います。アンケートのご回答お待ちしております。', label: '初回返信' },
        { direction: 'in', ts: daysAgo(170) + ' 21:08', text: 'アンケートを回答しました。子供の大学資金が一番気になっています。' },
        { direction: 'out', ts: daysAgo(169) + ' 09:42', text: '田中様\n\nアンケートありがとうございました。大翔様の大学進学(教育費ピーク)について資料をまとめました。下記候補で面談いかがでしょうか。', label: '面談案内' },
        { direction: 'in', ts: daysAgo(165) + ' 12:11', text: '候補日3で予約します。' },
        { direction: 'out', ts: daysAgo(165) + ' 12:12', text: '✅ ご予約承りました 6/1 14:00〜15:00 Zoom URL: https://zoom.us/...', label: '予約確定 (自動)' },
        { direction: 'out', ts: daysAgo(45) + ' 11:00', text: '田中様\n\n先日ご提案させていただいた「iDeCo拠出額の見直し」、その後ご検討状況はいかがでしょうか。ご質問やご懸念があれば、お気軽にお聞かせください。', label: 'フォローアップ' },
        { direction: 'in', ts: daysAgo(8) + ' 19:30', text: '6/5の面談キャンセルさせてください。' },
        { direction: 'out', ts: daysAgo(8) + ' 19:35', text: '田中様\n\nキャンセル承りました。またご都合つけば日程ご相談ください。', label: 'キャンセル対応 (自動)' },
      ],
    },
    {
      id: 'c002', name: '佐藤 由美', kana: 'さとう ゆみ',
      birth: ymd(Y - 52, 8, 24), gender: 'F', occupation: '看護師',
      family: [
        { rel: 'spouse', name: '佐藤 正樹', birth: ymd(Y - 55, 1, 11) },
        { rel: 'child', name: '佐藤 翔太', birth: ymd(Y - 19, 5, 30) },
      ],
      source: 'セミナー', status: 'active', aum: 22_000_000,
      lastContact: daysAgo(95),
      proposals: [
        { date: daysAgo(400), title: '個人年金保険', result: '成約' },
        { date: daysAgo(95), title: '退職金準備プラン', result: '検討中' },
      ],
      note: '夫婦とも医療職、退職後の資金プラン真剣に検討中。',
      lineFriendId: 'U002a4b8e1f6c3d2e9002',
      lineSubscribed: true,
      cancellations: [
        { date: daysAgo(50), slot: '14:00〜15:00', reason: '日程が合わなかった' },
      ],
      lineHistory: [
        { direction: 'in', ts: daysAgo(400) + ' 14:08', text: 'セミナーありがとうございました。個人年金について詳しく聞きたいです。' },
        { direction: 'out', ts: daysAgo(400) + ' 18:30', text: '佐藤様\n\nセミナーへのご参加ありがとうございました。個人年金保険、看護師の方の退職時期に合わせたプランをご提案できます。', label: '初回返信' },
        { direction: 'out', ts: daysAgo(400) + ' 18:31', text: '【ご提案】個人年金保険プラン_佐藤様向け.pdf' , label: '資料送付' },
        { direction: 'in', ts: daysAgo(95) + ' 21:15', text: '退職金準備プラン、内容まだ少し検討中です。' },
        { direction: 'out', ts: daysAgo(95) + ' 22:00', text: '佐藤様\n\nお返事ありがとうございます。じっくりご検討ください。ご不明な点があればいつでもお声がけください。', label: 'フォローアップ' },
        { direction: 'out', ts: daysAgo(50) + ' 10:00', text: '佐藤様\n\n6/2 14:00 で承りました。当日はよろしくお願いします。Zoom URL: https://zoom.us/...', label: '予約確定 (自動)' },
        { direction: 'in', ts: daysAgo(50) + ' 13:50', text: '申し訳ない、急用が入ってしまいキャンセルさせてください。' },
        { direction: 'out', ts: daysAgo(50) + ' 14:00', text: '佐藤様\n\nキャンセル承りました。また別日でも改めてご案内させてください。', label: 'キャンセル対応 (自動)' },
      ],
    },
    {
      id: 'c003', name: '鈴木 大輔', kana: 'すずき だいすけ',
      birth: ymd(Y - 45, 11, 3), gender: 'M', occupation: '自営業 (建築)',
      family: [
        { rel: 'spouse', name: '鈴木 香織', birth: ymd(Y - 42, 3, 18) },
        { rel: 'child', name: '鈴木 颯太', birth: ymd(Y - 14, 9, 2) },
        { rel: 'child', name: '鈴木 莉子', birth: ymd(Y - 11, 6, 25) },
        { rel: 'child', name: '鈴木 陽向', birth: ymd(Y - 7, 1, 14) },
      ],
      source: '紹介 (田中様)', status: 'important', aum: 35_000_000,
      lastContact: daysAgo(20),
      proposals: [
        { date: daysAgo(720), title: '小規模企業共済', result: '成約' },
        { date: daysAgo(380), title: '事業保険', result: '成約' },
        { date: daysAgo(20), title: '子3名分の教育資金一括設計', result: '提案中' },
      ],
      note: '紹介力強い。経営者向けセミナー誘致候補。',
      lineFriendId: 'U003a4b8e1f6c3d2e9003',
      lineSubscribed: true,
    },
    {
      id: 'c004', name: '高橋 真理子', kana: 'たかはし まりこ',
      birth: ymd(Y - 62, 6, 8), gender: 'F', occupation: '主婦 (元教員)',
      family: [
        { rel: 'spouse', name: '高橋 弘', birth: ymd(Y - 66, 10, 22) },
      ],
      source: 'HP問い合わせ', status: 'active', aum: 48_000_000,
      lastContact: daysAgo(130),
      proposals: [
        { date: daysAgo(500), title: '相続対策プラン', result: '成約' },
        { date: daysAgo(130), title: '生前贈与プラン', result: '検討中' },
      ],
      note: '夫の退職金運用で初訪問。相続見据えた長期視点。',
      lineFriendId: 'U004a4b8e1f6c3d2e9004',
      lineSubscribed: true,
    },
    {
      id: 'c005', name: '伊藤 拓海', kana: 'いとう たくみ',
      birth: ymd(Y - 29, 2, 17), gender: 'M', occupation: '会社員 (商社)',
      family: [],
      source: 'Instagram', status: 'new', aum: 1_200_000,
      lastContact: daysAgo(10),
      proposals: [
        { date: daysAgo(10), title: 'NISA活用プラン', result: '提案中' },
      ],
      note: '結婚予定あり。若年層リファラル候補。',
      lineFriendId: 'U005a4b8e1f6c3d2e9005',
      lineSubscribed: true,
    },
    {
      id: 'c006', name: '渡辺 さくら', kana: 'わたなべ さくら',
      birth: ymd(Y - 34, 9, 5), gender: 'F', occupation: '会社員 (広告)',
      family: [
        { rel: 'spouse', name: '渡辺 健', birth: ymd(Y - 36, 12, 14) },
        { rel: 'child', name: '渡辺 心春', birth: ymd(Y - 2, 4, 1) },
      ],
      source: '紹介 (佐藤様)', status: 'active', aum: 6_800_000,
      mortgage: { remainingYears: 33, monthly: 95_000 },
      lastContact: daysAgo(60),
      proposals: [
        { date: daysAgo(280), title: '住宅ローン団信見直し', result: '成約' },
      ],
      note: '第2子検討中。教育資金プランの仮設計済。',
      lineFriendId: 'U006a4b8e1f6c3d2e9006',
      lineSubscribed: true,
    },
    {
      id: 'c007', name: '山本 雄一', kana: 'やまもと ゆういち',
      birth: ymd(Y - 58, 3, 30), gender: 'M', occupation: '会社員 (役員)',
      family: [
        { rel: 'spouse', name: '山本 久美子', birth: ymd(Y - 56, 8, 19) },
        { rel: 'child', name: '山本 健太', birth: ymd(Y - 26, 5, 12) },
        { rel: 'child', name: '山本 美咲', birth: ymd(Y - 23, 11, 7) },
      ],
      source: '紹介', status: 'important', aum: 68_000_000,
      lastContact: daysAgo(15),
      proposals: [
        { date: daysAgo(800), title: '事業承継プラン基礎', result: '成約' },
        { date: daysAgo(200), title: '退職金分散運用', result: '成約' },
        { date: daysAgo(15), title: '相続対策 法人活用', result: '提案中' },
      ],
      note: '会社役員。事業承継・相続セットで継続案件化。',
      lineFriendId: 'U007a4b8e1f6c3d2e9007',
      lineSubscribed: true,
    },
    {
      id: 'c008', name: '中村 美穂', kana: 'なかむら みほ',
      birth: ymd(Y - 41, 7, 22), gender: 'F', occupation: 'パート',
      family: [
        { rel: 'spouse', name: '中村 翔', birth: ymd(Y - 43, 2, 9) },
        { rel: 'child', name: '中村 蓮', birth: ymd(Y - 12, 6, 18) },
        { rel: 'child', name: '中村 葵', birth: ymd(Y - 9, 10, 24) },
      ],
      source: 'セミナー', status: 'dormant', aum: 4_200_000,
      lastContact: daysAgo(380),
      proposals: [
        { date: daysAgo(380), title: '学資保険 (蓮様)', result: '見送り' },
      ],
      note: '前回提案見送り。教育費負担増のタイミングで再アプローチ。',
      lineFriendId: 'U008a4b8e1f6c3d2e9008',
      lineSubscribed: true,
    },
    {
      id: 'c009', name: '小林 浩', kana: 'こばやし ひろし',
      birth: ymd(Y - 71, 1, 8), gender: 'M', occupation: '無職 (退職)',
      family: [
        { rel: 'spouse', name: '小林 静子', birth: ymd(Y - 69, 5, 16) },
      ],
      source: '紹介', status: 'important', aum: 92_000_000,
      lastContact: daysAgo(35),
      proposals: [
        { date: daysAgo(1100), title: '退職金一括運用', result: '成約' },
        { date: daysAgo(35), title: '相続税対策 (孫含む)', result: '提案中' },
      ],
      note: '孫3名への暦年贈与継続中。後期高齢直前で総点検フェーズ。',
      lineFriendId: 'U009a4b8e1f6c3d2e9009',
      lineSubscribed: true,
    },
    {
      id: 'c010', name: '加藤 麻衣', kana: 'かとう まい',
      birth: ymd(Y - 36, 4, 14), gender: 'F', occupation: '会社員 (金融)',
      family: [
        { rel: 'child', name: '加藤 蒼', birth: ymd(Y - 6, 8, 3) },
      ],
      source: '紹介', status: 'active', aum: 12_500_000,
      lastContact: daysAgo(75),
      proposals: [
        { date: daysAgo(200), title: 'シングル世帯保障設計', result: '成約' },
        { date: daysAgo(75), title: 'NISA枠フル活用', result: '検討中' },
      ],
      note: 'シングルマザー。万一時の保障厚めで設計済。',
      lineFriendId: 'U010a4b8e1f6c3d2e9010',
      lineSubscribed: true,
    },
    {
      id: 'c011', name: '吉田 翔太', kana: 'よしだ しょうた',
      birth: ymd(Y - 31, 10, 27), gender: 'M', occupation: '会社員 (メーカー)',
      family: [
        { rel: 'spouse', name: '吉田 茜', birth: ymd(Y - 30, 6, 11) },
      ],
      source: 'HP問い合わせ', status: 'new', aum: 2_800_000,
      lastContact: daysAgo(5),
      proposals: [
        { date: daysAgo(5), title: '結婚後の家計設計', result: '提案中' },
      ],
      note: '新婚。第1子を1〜2年内に計画。',
      lineFriendId: 'U011a4b8e1f6c3d2e9011',
      lineSubscribed: true,
    },
    {
      id: 'c012', name: '山田 智子', kana: 'やまだ ともこ',
      birth: ymd(Y - 47, 1, 30), gender: 'F', occupation: '医師',
      family: [
        { rel: 'spouse', name: '山田 直樹', birth: ymd(Y - 49, 9, 5) },
        { rel: 'child', name: '山田 陸', birth: ymd(Y - 17, 3, 22) },
        { rel: 'child', name: '山田 結菜', birth: ymd(Y - 14, 7, 9) },
      ],
      source: '紹介', status: 'important', aum: 55_000_000,
      lastContact: daysAgo(25),
      proposals: [
        { date: daysAgo(600), title: '不動産投資', result: '成約' },
        { date: daysAgo(25), title: '大学進学資金 (陸様)', result: '提案中' },
      ],
      note: '長男1年後に大学受験。理系想定で資金厚め。',
      lineFriendId: 'U012a4b8e1f6c3d2e9012',
      lineSubscribed: true,
    },
    {
      id: 'c013', name: '佐々木 大樹', kana: 'ささき だいき',
      birth: ymd(Y - 39, 12, 2), gender: 'M', occupation: '自営業 (飲食)',
      family: [
        { rel: 'spouse', name: '佐々木 麻奈', birth: ymd(Y - 38, 5, 28) },
        { rel: 'child', name: '佐々木 太陽', birth: ymd(Y - 10, 11, 15) },
        { rel: 'child', name: '佐々木 月', birth: ymd(Y - 7, 4, 6) },
      ],
      source: 'セミナー', status: 'active', aum: 9_500_000,
      lastContact: daysAgo(110),
      proposals: [
        { date: daysAgo(300), title: '小規模企業共済', result: '成約' },
        { date: daysAgo(110), title: '事業保険見直し', result: '検討中' },
      ],
      note: '飲食店2店舗経営。3店舗目検討中で資金繰り相談あり。',
      lineFriendId: 'U013a4b8e1f6c3d2e9013',
      lineSubscribed: true,
    },
    {
      id: 'c014', name: '松本 ゆかり', kana: 'まつもと ゆかり',
      birth: ymd(Y - 55, 8, 11), gender: 'F', occupation: 'パート',
      family: [
        { rel: 'spouse', name: '松本 隆', birth: ymd(Y - 58, 2, 27) },
        { rel: 'child', name: '松本 慎一', birth: ymd(Y - 27, 7, 4) },
      ],
      source: 'HP問い合わせ', status: 'dormant', aum: 7_200_000,
      lastContact: daysAgo(420),
      proposals: [
        { date: daysAgo(420), title: 'iDeCo加入', result: '見送り' },
      ],
      note: '長く休眠。夫退職5年前で再アプローチタイミング。',
      lineFriendId: 'U014a4b8e1f6c3d2e9014',
      lineSubscribed: true,
    },
    {
      id: 'c015', name: '井上 健', kana: 'いのうえ けん',
      birth: ymd(Y - 44, 3, 8), gender: 'M', occupation: '会社員 (公務員)',
      family: [
        { rel: 'spouse', name: '井上 沙織', birth: ymd(Y - 41, 10, 17) },
        { rel: 'child', name: '井上 凛', birth: ymd(Y - 9, 5, 21) },
      ],
      source: '紹介', status: 'active', aum: 14_800_000,
      mortgage: { remainingYears: 22, monthly: 128_000 },
      lastContact: daysAgo(80),
      proposals: [
        { date: daysAgo(350), title: '団信見直し+収入保障', result: '成約' },
      ],
      note: '公務員夫婦で堅実。長期積立ベース。',
      lineFriendId: 'U015a4b8e1f6c3d2e9015',
      lineSubscribed: true,
    },
    {
      id: 'c016', name: '木村 美月', kana: 'きむら みづき',
      birth: ymd(Y - 28, 5, 14), gender: 'F', occupation: 'フリーランス',
      family: [],
      source: 'Instagram', status: 'new', aum: 800_000,
      lastContact: daysAgo(18),
      proposals: [
        { date: daysAgo(18), title: '個人事業主向け保障', result: '提案中' },
      ],
      note: '20代フリーランス。SNS経由若年層接点の試金石。',
      lineFriendId: 'U016a4b8e1f6c3d2e9016',
      lineSubscribed: true,
    },
    {
      id: 'c017', name: '林 浩二', kana: 'はやし こうじ',
      birth: ymd(Y - 63, 11, 19), gender: 'M', occupation: '会社員 (定年再雇用)',
      family: [
        { rel: 'spouse', name: '林 智恵', birth: ymd(Y - 60, 4, 7) },
        { rel: 'child', name: '林 大地', birth: ymd(Y - 33, 8, 25) },
        { rel: 'child', name: '林 千尋', birth: ymd(Y - 30, 12, 11) },
      ],
      source: '紹介', status: 'active', aum: 38_000_000,
      lastContact: daysAgo(50),
      proposals: [
        { date: daysAgo(900), title: '退職金一括運用', result: '成約' },
        { date: daysAgo(50), title: '老後生活費キャッシュフロー', result: '検討中' },
      ],
      note: '再雇用65歳まで。年金繰下げ検討中。',
      lineFriendId: 'U017a4b8e1f6c3d2e9017',
      lineSubscribed: true,
    },
    {
      id: 'c018', name: '清水 由香', kana: 'しみず ゆか',
      birth: ymd(Y - 33, 7, 6), gender: 'F', occupation: '会社員 (出版)',
      family: [
        { rel: 'spouse', name: '清水 直人', birth: ymd(Y - 35, 1, 23) },
        { rel: 'child', name: '清水 怜', birth: ymd(Y - 4, 9, 18) },
      ],
      source: 'セミナー', status: 'active', aum: 5_500_000,
      lastContact: daysAgo(160),
      proposals: [
        { date: daysAgo(420), title: '学資保険', result: '成約' },
      ],
      note: '次年度第2子検討。教育資金プラン更新待ち。',
      lineFriendId: 'U018a4b8e1f6c3d2e9018',
      lineSubscribed: true,
    },
    {
      id: 'c019', name: '森 慎一郎', kana: 'もり しんいちろう',
      birth: ymd(Y - 51, 2, 26), gender: 'M', occupation: '会社員 (商社)',
      family: [
        { rel: 'spouse', name: '森 香奈', birth: ymd(Y - 48, 7, 14) },
        { rel: 'child', name: '森 大輔', birth: ymd(Y - 21, 4, 30) },
        { rel: 'child', name: '森 由依', birth: ymd(Y - 18, 10, 8) },
      ],
      source: '紹介', status: 'important', aum: 41_000_000,
      lastContact: daysAgo(40),
      proposals: [
        { date: daysAgo(500), title: '退職金準備プラン', result: '成約' },
        { date: daysAgo(40), title: '大学費用ラストスパート', result: '検討中' },
      ],
      note: '長女今年大学受験。教育費ピーク期。',
      lineFriendId: 'U019a4b8e1f6c3d2e9019',
      lineSubscribed: true,
    },
    {
      id: 'c020', name: '池田 さやか', kana: 'いけだ さやか',
      birth: ymd(Y - 42, 9, 9), gender: 'F', occupation: '会社員 (商社)',
      family: [
        { rel: 'spouse', name: '池田 哲也', birth: ymd(Y - 44, 3, 17) },
        { rel: 'child', name: '池田 結希', birth: ymd(Y - 11, 12, 4) },
        { rel: 'child', name: '池田 朔', birth: ymd(Y - 8, 5, 27) },
      ],
      source: 'HP問い合わせ', status: 'active', aum: 16_000_000,
      lastContact: daysAgo(95),
      proposals: [
        { date: daysAgo(250), title: '共働き世帯保障設計', result: '成約' },
        { date: daysAgo(95), title: '中学受験資金', result: '提案中' },
      ],
      note: '長女中学受験予定。短期資金需要あり。',
      lineFriendId: 'U020a4b8e1f6c3d2e9020',
      lineSubscribed: true,
    },
    {
      id: 'c021', name: '橋本 隆志', kana: 'はしもと たかし',
      birth: ymd(Y - 49, 6, 13), gender: 'M', occupation: '会社員 (製造)',
      family: [
        { rel: 'spouse', name: '橋本 智美', birth: ymd(Y - 47, 11, 28) },
        { rel: 'child', name: '橋本 大樹', birth: ymd(Y - 16, 8, 14) },
      ],
      source: '紹介', status: 'active', aum: 18_500_000,
      mortgage: { remainingYears: 14, monthly: 95_000 },
      lastContact: daysAgo(70),
      proposals: [
        { date: daysAgo(400), title: '繰上返済シミュレーション', result: '成約' },
      ],
      note: '住宅ローン残14年。繰上 vs 運用バランス相談中。',
      lineFriendId: 'U021a4b8e1f6c3d2e9021',
      lineSubscribed: true,
    },
    {
      id: 'c022', name: '阿部 理恵', kana: 'あべ りえ',
      birth: ymd(Y - 38, 1, 21), gender: 'F', occupation: '会社員 (IT)',
      family: [
        { rel: 'child', name: '阿部 颯', birth: ymd(Y - 7, 6, 9) },
      ],
      source: 'Instagram', status: 'active', aum: 7_900_000,
      lastContact: daysAgo(40),
      proposals: [
        { date: daysAgo(180), title: '離婚後の家計再設計', result: '成約' },
      ],
      note: 'シングルマザー。生活防衛資金最優先。',
      lineFriendId: 'U022a4b8e1f6c3d2e9022',
      lineSubscribed: true,
    },
    {
      id: 'c023', name: '岡田 雅人', kana: 'おかだ まさと',
      birth: ymd(Y - 56, 4, 4), gender: 'M', occupation: '自営業 (士業)',
      family: [
        { rel: 'spouse', name: '岡田 京子', birth: ymd(Y - 53, 9, 12) },
      ],
      source: '紹介', status: 'important', aum: 62_000_000,
      lastContact: daysAgo(28),
      proposals: [
        { date: daysAgo(620), title: '小規模企業共済+iDeCo', result: '成約' },
        { date: daysAgo(28), title: '事業承継/廃業選択肢比較', result: '提案中' },
      ],
      note: '士業事務所単独経営。承継 or 廃業の決断時期。',
      lineFriendId: 'U023a4b8e1f6c3d2e9023',
      lineSubscribed: true,
    },
    {
      id: 'c024', name: '前田 恵子', kana: 'まえだ けいこ',
      birth: ymd(Y - 67, 12, 17), gender: 'F', occupation: '無職',
      family: [
        { rel: 'spouse', name: '前田 純一', birth: ymd(Y - 70, 5, 3) },
      ],
      source: 'セミナー', status: 'active', aum: 31_000_000,
      lastContact: daysAgo(150),
      proposals: [
        { date: daysAgo(700), title: '年金繰下げ判定', result: '成約' },
        { date: daysAgo(150), title: '介護費用準備', result: '検討中' },
      ],
      note: '夫の介護リスク具体化。施設費の積立検討中。',
      lineFriendId: 'U024a4b8e1f6c3d2e9024',
      lineSubscribed: true,
    },
    {
      id: 'c025', name: '長谷川 翔', kana: 'はせがわ しょう',
      birth: ymd(Y - 35, 8, 8), gender: 'M', occupation: '会社員 (金融)',
      family: [
        { rel: 'spouse', name: '長谷川 みき', birth: ymd(Y - 34, 2, 16) },
        { rel: 'child', name: '長谷川 樹', birth: ymd(Y - 3, 7, 20) },
      ],
      source: '紹介 (サンプル様)', status: 'active', aum: 11_200_000,
      lastContact: daysAgo(55),
      proposals: [
        { date: daysAgo(220), title: '住宅購入資金プラン', result: '成約' },
      ],
      note: 'マイホーム購入直前。FP伴走で住宅ローン確定。',
      lineFriendId: 'U025a4b8e1f6c3d2e9025',
      lineSubscribed: true,
    },
    {
      id: 'c026', name: '近藤 真理', kana: 'こんどう まり',
      birth: ymd(Y - 46, 10, 23), gender: 'F', occupation: '会社員 (人事)',
      family: [
        { rel: 'spouse', name: '近藤 達也', birth: ymd(Y - 48, 6, 1) },
        { rel: 'child', name: '近藤 ひかり', birth: ymd(Y - 15, 4, 12) },
      ],
      source: 'HP問い合わせ', status: 'active', aum: 19_500_000,
      lastContact: daysAgo(35),
      proposals: [
        { date: daysAgo(35), title: '高校卒業後の進路別資金比較', result: '提案中' },
      ],
      note: '娘の進路 (大学or留学) 並行比較中。',
      lineFriendId: 'U026a4b8e1f6c3d2e9026',
      lineSubscribed: true,
    },
    {
      id: 'c027', name: '坂本 直人', kana: 'さかもと なおと',
      birth: ymd(Y - 30, 6, 26), gender: 'M', occupation: '会社員 (IT)',
      family: [
        { rel: 'spouse', name: '坂本 杏', birth: ymd(Y - 29, 11, 30) },
      ],
      source: 'Instagram', status: 'new', aum: 1_800_000,
      lastContact: daysAgo(12),
      proposals: [
        { date: daysAgo(12), title: '新婚世帯の家計棚卸し', result: '提案中' },
      ],
      note: '結婚2年目。住宅 or 子育てどちら先か相談。',
      lineFriendId: 'U027a4b8e1f6c3d2e9027',
      lineSubscribed: true,
    },
    {
      id: 'c028', name: '青木 美香', kana: 'あおき みか',
      birth: ymd(Y - 59, 2, 19), gender: 'F', occupation: '会社員 (教育)',
      family: [
        { rel: 'spouse', name: '青木 浩一', birth: ymd(Y - 62, 7, 7) },
        { rel: 'child', name: '青木 翔平', birth: ymd(Y - 29, 9, 13) },
      ],
      source: '紹介', status: 'active', aum: 27_500_000,
      lastContact: daysAgo(85),
      proposals: [
        { date: daysAgo(85), title: '退職金事前シミュレーション', result: '検討中' },
      ],
      note: '夫退職目前。退職金受け取り方法 (一時金 vs 年金)。',
      lineFriendId: 'U028a4b8e1f6c3d2e9028',
      lineSubscribed: true,
    },
    {
      id: 'c029', name: '杉山 健介', kana: 'すぎやま けんすけ',
      birth: ymd(Y - 41, 4, 17), gender: 'M', occupation: '会社員 (商社)',
      family: [
        { rel: 'spouse', name: '杉山 美緒', birth: ymd(Y - 39, 8, 24) },
        { rel: 'child', name: '杉山 蒼空', birth: ymd(Y - 11, 1, 5) },
        { rel: 'child', name: '杉山 紗良', birth: ymd(Y - 8, 6, 19) },
      ],
      source: 'セミナー', status: 'active', aum: 13_800_000,
      mortgage: { remainingYears: 26, monthly: 142_000 },
      lastContact: daysAgo(170),
      proposals: [
        { date: daysAgo(450), title: '教育資金 + 住宅ローン総合', result: '成約' },
      ],
      note: '海外赴任の可能性あり。プラン全体見直し時期。',
      lineFriendId: 'U029a4b8e1f6c3d2e9029',
      lineSubscribed: true,
    },
    {
      id: 'c030', name: '原田 美咲', kana: 'はらだ みさき',
      birth: ymd(Y - 26, 11, 2), gender: 'F', occupation: '会社員 (アパレル)',
      family: [],
      source: 'Instagram', status: 'new', aum: 600_000,
      lastContact: daysAgo(7),
      proposals: [
        { date: daysAgo(7), title: '20代の貯蓄スタートプラン', result: '提案中' },
      ],
      note: '社会人3年目。母世代経由の紹介起点として育てる。',
      lineFriendId: 'U030a4b8e1f6c3d2e9030',
      lineSubscribed: true,
    },
  ];
})();
