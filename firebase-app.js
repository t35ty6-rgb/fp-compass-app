// FP Compass — Email + Password auth + Firestore tenant-scoped client list
// Uses Firebase JS SDK v10 via CDN modular imports.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, initializeFirestore, doc, getDoc, setDoc, serverTimestamp, collection, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmVAEe9l9e1Yo_dzzJdbTVU35wWKd2sH4",
  authDomain: "skeleton-fp-compass-632026.firebaseapp.com",
  projectId: "skeleton-fp-compass-632026",
  storageBucket: "skeleton-fp-compass-632026.firebasestorage.app",
  messagingSenderId: "833972948597",
  appId: "1:833972948597:web:b7310cc22ce41d9738f23c",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// 🚨 experimentalAutoDetectLongPolling: Chrome拡張/NW で onSnapshot WebChannel が silent block される罠対策
// memory: feedback_firestore_webchannel_blocked_longpolling.md
let db;
try {
  db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
} catch (_) {
  // 既に別モジュールで initialize 済みの場合は getFirestore で取得
  db = getFirestore(app);
}
// ブラウザを閉じても (30日まで) 自動ログイン維持
setPersistence(auth, browserLocalPersistence).catch(console.error);

// ★ 2026-06-26: 全 Cloud Run API call で Firebase ID Token Bearer 付与 (auth gate 対応)
window.getFpAuthHeaders = async function (extra) {
  const u = auth.currentUser;
  if (!u) return Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  try {
    const tok = await u.getIdToken();
    return Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok }, extra || {});
  } catch (_) {
    return Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  }
};

// ============ 紹介パラメータ捕捉 (?ref / ?agent) ============
// 初回アクセス時に localStorage に保存、サインアップ時に tenant に紐付け
(function captureReferral() {
  try {
    const u = new URL(window.location.href);
    const ref = u.searchParams.get("ref");
    const agent = u.searchParams.get("agent");
    if (ref) {
      localStorage.setItem("fpc.ref", ref);
      localStorage.setItem("fpc.ref.ts", String(Date.now()));
    }
    if (agent) {
      localStorage.setItem("fpc.agent", agent);
      localStorage.setItem("fpc.agent.ts", String(Date.now()));
    }
    // URL クリーンアップ (UX のため、 ?ref/?agent をアドレスバーから消す)
    if (ref || agent) {
      u.searchParams.delete("ref");
      u.searchParams.delete("agent");
      history.replaceState(null, "", u.pathname + (u.search || ""));
    }
  } catch (e) { console.warn("ref capture failed:", e); }
})();

function readReferral() {
  const ref = localStorage.getItem("fpc.ref");
  const agent = localStorage.getItem("fpc.agent");
  // 90 日経過したものは無視
  const NINETY_DAYS = 90 * 24 * 3600 * 1000;
  const now = Date.now();
  const refOk = ref && (now - Number(localStorage.getItem("fpc.ref.ts") || 0) < NINETY_DAYS);
  const agentOk = agent && (now - Number(localStorage.getItem("fpc.agent.ts") || 0) < NINETY_DAYS);
  return { ref: refOk ? ref : null, agent: agentOk ? agent : null };
}
function clearReferralAfterUse() {
  localStorage.removeItem("fpc.ref");
  localStorage.removeItem("fpc.ref.ts");
  localStorage.removeItem("fpc.agent");
  localStorage.removeItem("fpc.agent.ts");
}

const $ = (id) => document.getElementById(id);
const loginEl = $("login");
const appEl = $("app");
const msgEl = $("login-msg");

function msg(kind, text) {
  msgEl.className = "login-msg " + kind;
  msgEl.textContent = text;
}

// ============ ログイン/新規登録 タブ切替 ============
let mode = "login";
function setMode(newMode) {
  mode = newMode;
  const isLogin = newMode === "login";
  $("tab-login").style.background  = isLogin ? "#fff" : "transparent";
  $("tab-login").style.color       = isLogin ? "var(--ink)" : "var(--ink-2)";
  $("tab-login").style.boxShadow   = isLogin ? "0 1px 3px rgba(15,23,42,0.08)" : "none";
  $("tab-signup").style.background = isLogin ? "transparent" : "#fff";
  $("tab-signup").style.color      = isLogin ? "var(--ink-2)" : "var(--ink)";
  $("tab-signup").style.boxShadow  = isLogin ? "none" : "0 1px 3px rgba(15,23,42,0.08)";
  $("login-tagline").style.display  = isLogin ? "" : "none";
  $("signup-tagline").style.display = isLogin ? "none" : "";
  $("row-fpname").style.display     = isLogin ? "none" : "";
  $("row-pwconfirm").style.display  = isLogin ? "none" : "";
  $("login-btn").style.display      = isLogin ? "" : "none";
  $("signup-btn").style.display     = isLogin ? "none" : "";
  $("password-input").setAttribute("autocomplete", isLogin ? "current-password" : "new-password");
  $("pw-label").textContent = isLogin ? "パスワード" : "パスワード (8文字以上)";
  msgEl.style.display = "none";
}
$("tab-login").addEventListener("click", () => setMode("login"));
$("tab-signup").addEventListener("click", () => setMode("signup"));

// ============ ログイン ============
$("login-btn").addEventListener("click", doLogin);
$("signup-btn").addEventListener("click", doSignup);
$("password-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { mode === "login" ? doLogin() : (e.target === $("password-input") && $("row-pwconfirm").style.display !== "none" ? $("pwconfirm-input").focus() : doSignup()); } });
$("email-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("password-input").focus(); });

async function doLogin() {
  const email = $("email-input").value.trim();
  const password = $("password-input").value;
  if (!email || !email.includes("@")) { msg("err", "有効なメールアドレスを入力してください。"); return; }
  if (!password) { msg("err", "パスワードを入力してください。"); return; }
  const btn = $("login-btn");
  btn.disabled = true; btn.textContent = "認証中…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged が後続処理を引き継ぐ
  } catch (e) {
    console.error(e);
    const map = {
      "auth/invalid-credential": "メールアドレスまたはパスワードが違います。",
      "auth/user-not-found":     "このメールアドレスは登録されていません。新規登録タブで作成してください。",
      "auth/wrong-password":     "パスワードが違います。",
      "auth/too-many-requests":  "ログイン試行回数が多すぎます。少し時間をおいて再度お試しください。",
      "auth/network-request-failed": "ネットワーク接続を確認してください。",
    };
    msg("err", map[e.code] || ("ログイン失敗: " + (e.message || e.code)));
    btn.disabled = false; btn.textContent = "ログイン";
  }
}

// ============ 新規登録 (セルフサービス) ============
async function doSignup() {
  const fpName = $("fpname-input").value.trim();
  const email = $("email-input").value.trim();
  const password = $("password-input").value;
  const pwConfirm = $("pwconfirm-input").value;
  if (!fpName) { msg("err", "FP事務所名を入力してください。"); return; }
  if (!email || !email.includes("@")) { msg("err", "有効なメールアドレスを入力してください。"); return; }
  if (password.length < 8) { msg("err", "パスワードは8文字以上にしてください。"); return; }
  if (password !== pwConfirm) { msg("err", "パスワードと確認用が一致しません。"); return; }

  const btn = $("signup-btn");
  btn.disabled = true; btn.textContent = "作成中…";
  signupInProgress = true;
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
    signupInProgress = false;
    console.error(e);
    const map = {
      "auth/email-already-in-use": "このメールアドレスは既に登録されています。ログインタブから入ってください。",
      "auth/invalid-email":        "メールアドレスの形式が正しくありません。",
      "auth/weak-password":        "パスワードが弱すぎます (8文字以上推奨)。",
      "auth/operation-not-allowed":"新規登録が無効化されています。Skeleton 管理者にお問い合わせください。",
      "auth/network-request-failed":"ネットワーク接続を確認してください。",
    };
    msg("err", map[e.code] || ("作成失敗: " + (e.message || e.code)));
    btn.disabled = false; btn.textContent = "アカウント作成";
    return;
  }
  // tenantId = メアドの local part を slug 化 + UID 末尾4桁で衝突回避
  const slug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "tenant";
  const tenantId = `${slug}-${cred.user.uid.slice(-6)}`;
  // 紹介情報を取り込む
  const { ref, agent } = readReferral();
  // 紹介トークン: agent優先 (代理店経由 = 現金コミッション発生)
  // refとagent両方ある場合は agent が優先 (Skeleton への売上影響大きいから)
  try {
    const tenantDoc = {
      name: fpName, plan: "starter", status: "active",
      isDemo: false, isSelfSignup: true,
      contractStartedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      ownerEmail: email,
      // 紹介関連
      referralSource: agent ? "agent" : (ref ? "fp_referral" : "direct"),
      referredByAgent: agent || null,
      referredByFp: agent ? null : (ref || null),  // agent 優先で fp_ref はクリア
      // 課金関連 (Stripe 連携前の placeholder)
      billing: {
        baseMonthly: 19800,
        discountPerReferral: 3500,
        currentDiscount: 0,
        nextMonthAmount: 19800,
        stripeCustomerId: null,        // TODO: Stripe webhook で更新
        stripeSubscriptionId: null,    // TODO: Stripe webhook で更新
        status: "trial",               // trial → active → past_due → canceled
        trialEndsAt: null,             // TODO: Stripe webhook で更新
      },
    };
    await setDoc(doc(db, "tenants", tenantId), tenantDoc);
    await setDoc(doc(db, "users", cred.user.uid), {
      email, role: "fp_owner", tenantId,
      createdAt: serverTimestamp(),
    });
    // referral_ledger に記録 (紹介者の dashboard で表示用)
    if (agent) {
      await setDoc(doc(db, "referral_ledger", `agent_${agent}_${tenantId}`), {
        type: "agent",
        agentCode: agent,
        referredTenantId: tenantId,
        referredTenantName: fpName,
        referredEmail: email,
        status: "trial",
        commissionPerMonth: 7000,
        signupBonus: 15000,
        bonusEligibleAt: null,  // TODO: Stripe webhook で 3ヶ月継続後にセット
        createdAt: serverTimestamp(),
      });
    } else if (ref) {
      await setDoc(doc(db, "referral_ledger", `fp_${ref}_${tenantId}`), {
        type: "fp_referral",
        referrerTenantId: ref,
        referredTenantId: tenantId,
        referredTenantName: fpName,
        referredEmail: email,
        status: "trial",
        discountPerMonth: 3500,
        createdAt: serverTimestamp(),
      });
    }
    clearReferralAfterUse();
    msg("ok", `${fpName} を作成しました。ログイン中…`);
    signupInProgress = false;
    // onAuthStateChanged の retry がこのタイミングで成功する
  } catch (e) {
    console.error(e);
    signupInProgress = false;
    msg("err", "テナント作成に失敗: " + e.message + "。Skeleton 管理者にご連絡ください。");
    btn.disabled = false; btn.textContent = "アカウント作成";
  }
}

// ============ 認証状態の監視 ============
let signupInProgress = false;
async function fetchUserDocWithRetry(uid, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) return snap;
    if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 800));
  }
  return null;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loginEl.style.display = "grid";
    appEl.style.display = "none";
    return;
  }
  // 新規登録進行中なら、users/{uid} のセット完了を待つ
  let userDoc;
  try {
    userDoc = await fetchUserDocWithRetry(user.uid, signupInProgress ? 10 : 3);
  } catch (e) {
    msg("err", "ユーザー情報の取得に失敗: " + e.message);
    return;
  }
  if (!userDoc) {
    loginEl.style.display = "grid";
    msg("err", `${user.email} は Skeleton 側にまだ登録されていません。新規登録タブで作成してください。`);
    try { _clearFpLocalState(); } catch (_) {}
    await signOut(auth);
    return;
  }
  const userData = userDoc.data();
  const tenantId = userData.tenantId;

  // ★ line-app.js / app.js から 参照する ため グローバル expose
  window.AccountInfo = { tenantId, uid: user.uid, email: user.email, role: userData.role };
  try { localStorage.setItem('fp-tenantId', tenantId); } catch(_) {}

  loginEl.style.display = "none";
  appEl.style.display = "block";

  $("user-email").textContent = user.email;
  $("user-tenant").textContent = tenantId.toUpperCase();
  $("audit-tenant").textContent = tenantId;
  $("audit-uid").textContent = user.uid.slice(0, 12) + "…";

  let tenantName = tenantId;
  try {
    if (tenantId && tenantId !== "__skeleton__") {
      const tDoc = await getDoc(doc(db, "tenants", tenantId));
      if (tDoc.exists()) tenantName = tDoc.data().name || tenantId;
    } else {
      tenantName = "Skeleton 管理者";
    }
  } catch (_) {}
  $("welcome").textContent = `ようこそ、${tenantName} の管理画面へ`;

  if (tenantId === "__skeleton__") {
    $("client-list").innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚙️</div>
        Skeleton 管理者アカウントです。<br>顧客一覧は各テナント (fukuda 等) でログインしてください。
      </div>`;
    $("stat-total").textContent = "—";
    $("stat-active").textContent = "—";
    $("stat-lead").textContent = "—";
    return;
  }

  try {
    const snap = await getDocs(collection(db, "tenants", tenantId, "customers"));
    const clients = [];
    snap.forEach((d) => clients.push({ id: d.id, ...d.data() }));
    renderClients(clients);
  } catch (e) {
    console.error(e);
    $("client-list").innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>顧客データの取得に失敗: ${e.message}</div>`;
  }
});

function renderClients(clients) {
  $("stat-total").textContent = clients.length;
  $("stat-active").textContent = clients.filter(c => c.stage === "active").length;
  $("stat-lead").textContent = clients.filter(c => c.stage === "lead").length;
  $("client-count").textContent = `${clients.length} 件`;

  if (!clients.length) {
    $("client-list").innerHTML = `<div class="empty"><div class="empty-icon">📋</div>まだ顧客が登録されていません。</div>`;
    return;
  }
  const stageLabel = { lead: "見込み客", active: "アクティブ", followup: "フォロー中", closed: "完了" };
  const html = clients.map(c => {
    const initial = (c.name || "?").slice(0, 1);
    const meta = [];
    if (c.age) meta.push(`${c.age}歳`);
    if (c.kana) meta.push(c.kana);
    return `
      <div class="client">
        <div class="client-avatar">${escapeHtml(initial)}</div>
        <div class="client-info">
          <div class="client-name">${escapeHtml(c.name || "(名前未設定)")}</div>
          <div class="client-meta">${escapeHtml(meta.join(" · "))}</div>
        </div>
        <div class="client-stage">${escapeHtml(stageLabel[c.stage] || c.stage || "—")}</div>
      </div>`;
  }).join("");
  $("client-list").innerHTML = html;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

// ============ ログアウト ============
// ★ Critical-C: 端末共有/離席時の PII 漏洩 防止
//   signOut 前に localStorage の fp-* キー (顧客台帳/lineHistory/議事録キャッシュ) を 全 wipe
function _clearFpLocalState() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(k => {
      // fp- prefix (顧客台帳/lineHistory/cache) + fp-livedata + fp-tenantId + fpc.ref/agent も含める
      if (k.startsWith('fp-') || k.startsWith('fpc.') || k === 'fp-tenantId') {
        try { localStorage.removeItem(k); } catch (_) {}
      }
    });
  } catch (_) {}
}

$("logout-btn").addEventListener("click", async () => {
  _clearFpLocalState();
  await signOut(auth);
  window.location.reload();
});
