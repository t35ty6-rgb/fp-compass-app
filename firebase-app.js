// FP Compass — Email + Password auth + Firestore tenant-scoped client list
// Uses Firebase JS SDK v10 via CDN modular imports.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, getDocs,
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
const db = getFirestore(app);
// ブラウザを閉じても (30日まで) 自動ログイン維持
setPersistence(auth, browserLocalPersistence).catch(console.error);

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
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
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
  try {
    await setDoc(doc(db, "tenants", tenantId), {
      name: fpName, plan: "starter", status: "active",
      isDemo: false, isSelfSignup: true,
      contractStartedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      ownerEmail: email,
    });
    await setDoc(doc(db, "users", cred.user.uid), {
      email, role: "fp_owner", tenantId,
      createdAt: serverTimestamp(),
    });
    msg("ok", `${fpName} を作成しました。ログイン中…`);
    // onAuthStateChanged が自動で続きを処理する
  } catch (e) {
    console.error(e);
    msg("err", "テナント作成に失敗: " + e.message + "。Skeleton 管理者にご連絡ください。");
    btn.disabled = false; btn.textContent = "アカウント作成";
  }
}

// ============ 認証状態の監視 ============
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loginEl.style.display = "grid";
    appEl.style.display = "none";
    return;
  }
  let userDoc;
  try {
    userDoc = await getDoc(doc(db, "users", user.uid));
  } catch (e) {
    msg("err", "ユーザー情報の取得に失敗: " + e.message);
    return;
  }
  if (!userDoc.exists()) {
    loginEl.style.display = "grid";
    msg("err", `${user.email} は Skeleton 側にまだ登録されていません。管理者にご連絡ください。`);
    await signOut(auth);
    return;
  }
  const userData = userDoc.data();
  const tenantId = userData.tenantId;

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
$("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.reload();
});
