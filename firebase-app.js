// FP Compass — Email + Password auth + Firestore tenant-scoped client list
// Uses Firebase JS SDK v10 via CDN modular imports.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, getDocs,
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

// ============ ログイン ============
$("login-btn").addEventListener("click", doLogin);
$("password-input").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
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
      "auth/user-not-found":     "このメールアドレスは登録されていません。",
      "auth/wrong-password":     "パスワードが違います。",
      "auth/too-many-requests":  "ログイン試行回数が多すぎます。少し時間をおいて再度お試しください。",
      "auth/network-request-failed": "ネットワーク接続を確認してください。",
    };
    msg("err", map[e.code] || ("ログイン失敗: " + (e.message || e.code)));
    btn.disabled = false; btn.textContent = "ログイン";
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
