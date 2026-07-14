// FP Compass Chrome拡張 install ガイド — 荒島 pipeline を そのまま 転用
// 5段階カメラワーク + 累積秒同期 + 疑似Chrome UI (荒島 phone frame と同じ考え方)
import pwPkg from '/Users/tsukasayoshida/.skeleton-pegat/node_modules/playwright/index.js';
const { chromium } = pwPkg;
import { mkdirSync, readdirSync, renameSync, statSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';

const OUT_DIR = '/Users/tsukasayoshida/Desktop/fp-compass-app/chrome-ext-install-video-src/video';
mkdirSync(OUT_DIR, { recursive: true });

// mp3 実測秒
const AUDIO_DUR = {
  '01-open-chrome':     6.6,
  '02-extensions-url': 12.0,
  '03-developer-mode':  9.0,
  '04-load-folder':    14.9,
  '05-pin':            15.0,
  '06-test':           18.8,
};

const HIGHLIGHT_CSS = `
body { transition: transform 0.7s cubic-bezier(.4,0,.2,1); margin: 0; background: #E9EAED; overflow: hidden; font-family: 'Noto Sans JP', -apple-system, 'Hiragino Kaku Gothic ProN', sans-serif; }
html.fp-zooming, html.fp-zooming body { overflow: hidden !important; }
.fp-spot {
  position: absolute !important; border: 4px solid #C1462C !important; border-radius: 8px !important;
  box-shadow: 0 0 0 8px rgba(193,70,44,0.28), 0 0 40px rgba(193,70,44,0.85), 0 0 90px rgba(193,70,44,0.5) !important;
  pointer-events: none !important; z-index: 99998 !important;
  animation: fp-pulse 1.1s ease-in-out infinite;
  transition: left .35s, top .35s, width .35s, height .35s;
}
.fp-hint {
  position: absolute !important; border: 2px solid rgba(193,70,44,0.55) !important; border-radius: 6px !important;
  box-shadow: 0 0 0 6px rgba(193,70,44,0.14) !important;
  pointer-events: none !important; z-index: 99997 !important;
  animation: fp-hint-in .4s ease;
  transition: left .35s, top .35s, width .35s, height .35s;
}
.fp-arrow {
  position: absolute !important; pointer-events: none !important; z-index: 99999 !important;
  background: #0E0E0C; color: #F2EDE3;
  font-weight: 700; font-size: 15px; padding: 9px 16px; border-radius: 3px;
  box-shadow: 0 6px 20px rgba(0,0,0,.35); white-space: nowrap;
  border-left: 3px solid #C1462C;
  animation: fp-fadein .3s ease;
}
.fp-ring {
  position: absolute; pointer-events: none; z-index: 100000;
  border: 4px solid #C1462C; border-radius: 50%;
  animation: fp-ring 0.6s cubic-bezier(.2,.8,.4,1) forwards;
}
@keyframes fp-pulse {
  0%,100% { box-shadow: 0 0 0 8px rgba(193,70,44,0.28), 0 0 40px rgba(193,70,44,0.85), 0 0 90px rgba(193,70,44,0.5); }
  50%     { box-shadow: 0 0 0 14px rgba(193,70,44,0.14), 0 0 55px rgba(193,70,44,0.95), 0 0 120px rgba(193,70,44,0.4); }
}
@keyframes fp-hint-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes fp-fadein { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
@keyframes fp-ring {
  from { transform: scale(0.25); opacity: 1; }
  to   { transform: scale(2.6);  opacity: 0; }
}
.fp-title {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 99995; padding: 32px 48px;
  background: rgba(14,14,12,0.95); color: #F2EDE3;
  border-left: 4px solid #C1462C;
  border-radius: 3px;
  font-weight: 700; font-size: 34px; letter-spacing: 0.02em;
  box-shadow: 0 30px 80px rgba(0,0,0,.5);
  animation: fp-fadein .35s ease;
  min-width: 400px; text-align: center; line-height: 1.5;
}
.fp-title small {
  display: block; font-size: 13px; color: #B8893B;
  letter-spacing: 0.24em; font-weight: 700;
  margin-bottom: 12px;
}
.fp-caption {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 99993; padding: 12px 24px;
  background: rgba(14,14,12,0.92); color: #F2EDE3;
  border-left: 3px solid #B8893B;
  border-radius: 3px;
  font-weight: 500; font-size: 15px; letter-spacing: 0.03em;
  box-shadow: 0 12px 32px rgba(0,0,0,.4);
  animation: fp-fadein-up .3s ease;
  max-width: 900px; line-height: 1.7;
}
@keyframes fp-fadein-up { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }

/* ─── 疑似Chrome UI ─── */
.chrome-window {
  position: fixed; top: 0; left: 0; width: 1280px; height: 720px;
  background: #DEE1E6; display: flex; flex-direction: column;
}
.chrome-titlebar {
  height: 32px; background: #DEE1E6; display: flex; align-items: center;
  padding: 0 12px; gap: 8px;
}
.chrome-dot { width: 12px; height: 12px; border-radius: 50%; }
.chrome-tabs {
  background: #DEE1E6; display: flex; align-items: flex-end; padding: 0 8px; height: 40px;
}
.chrome-tab {
  background: #FFF; border-radius: 8px 8px 0 0; padding: 8px 20px 10px 16px;
  display: flex; align-items: center; gap: 8px; font-size: 13px; color: #202124;
  max-width: 240px; overflow: hidden; white-space: nowrap;
}
.chrome-tab__fav {
  width: 16px; height: 16px; background: #C1462C; color: #fff;
  border-radius: 3px; display: grid; place-items: center; font-size: 10px; font-weight: 700;
}
.chrome-toolbar {
  height: 48px; background: #FFF; display: flex; align-items: center;
  padding: 0 12px; gap: 8px; border-bottom: 1px solid #E0E0E0;
}
.chrome-nav-btn {
  width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  color: #5F6368; font-size: 18px;
}
.chrome-urlbar {
  flex: 1; height: 36px; background: #F1F3F4; border-radius: 18px;
  display: flex; align-items: center; padding: 0 16px; gap: 10px;
  font-size: 13px; color: #202124;
}
.chrome-urlbar__lock { color: #5F6368; font-size: 14px; }
.chrome-ext-icon {
  width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  color: #5F6368; font-size: 18px;
}
.chrome-body {
  flex: 1; background: #FFF; overflow: hidden; position: relative;
}

/* ─── Dock (bottom for chapter 01) ─── */
.mac-dock {
  position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
  background: rgba(255,255,255,0.55); backdrop-filter: blur(20px);
  border-radius: 18px; padding: 8px 12px; display: flex; gap: 8px;
  box-shadow: 0 6px 24px rgba(0,0,0,.15), inset 0 0 0 1px rgba(255,255,255,0.6);
  z-index: 99988;
}
.mac-dock__app {
  width: 56px; height: 56px; border-radius: 12px;
  display: grid; place-items: center; font-size: 30px;
  background: linear-gradient(180deg, #f6f7f9, #dcdfe4);
  box-shadow: 0 2px 6px rgba(0,0,0,.15);
}
.mac-dock__app.chrome {
  background: conic-gradient(from 0deg, #EA4335 0deg 120deg, #FBBC04 120deg 240deg, #34A853 240deg 360deg);
  position: relative;
}
.mac-dock__app.chrome::after {
  content: ''; position: absolute; width: 22px; height: 22px; border-radius: 50%;
  background: #4285F4; border: 3px solid #FFF; top: 14px; left: 14px;
}

/* ─── Desktop wallpaper (for chapter 01) ─── */
.desktop-bg {
  position: fixed; inset: 0;
  background: linear-gradient(160deg, #1a3a5c 0%, #2d5a8f 55%, #4a7ab5 100%);
  z-index: -1;
}

/* ─── chrome://extensions page mock ─── */
.ext-page {
  background: #FFF; height: 100%; padding: 24px 40px; overflow: hidden;
}
.ext-page__hdr {
  display: flex; align-items: center; gap: 16px; margin-bottom: 24px;
}
.ext-page__title { font-size: 22px; color: #202124; font-weight: 500; }
.ext-page__toolbar {
  display: flex; align-items: center; gap: 20px; padding: 12px 0 24px;
  border-bottom: 1px solid #E8EAED;
}
.ext-page__btn {
  padding: 8px 18px; background: #1A73E8; color: #FFF;
  border-radius: 4px; font-size: 13px; font-weight: 500;
}
.ext-page__btn.secondary { background: #FFF; color: #1A73E8; border: 1px solid #DADCE0; }
.dev-toggle {
  display: flex; align-items: center; gap: 12px; margin-left: auto;
  font-size: 14px; color: #202124;
}
.dev-toggle__switch {
  width: 40px; height: 22px; background: #BDC1C6; border-radius: 11px; position: relative;
  transition: background .25s;
}
.dev-toggle__switch::after {
  content: ''; position: absolute; width: 18px; height: 18px; border-radius: 50%;
  background: #FFF; top: 2px; left: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.2);
  transition: left .25s;
}
.dev-toggle__switch.on { background: #1A73E8; }
.dev-toggle__switch.on::after { left: 20px; }
.dev-actions {
  display: none; gap: 12px; margin-top: 20px;
}
.dev-actions.show { display: flex; }
.dev-btn {
  padding: 8px 16px; background: #FFF; color: #1A73E8;
  border: 1px solid #DADCE0; border-radius: 4px; font-size: 13px; font-weight: 500;
}
.ext-empty {
  margin-top: 60px; text-align: center; color: #5F6368; font-size: 14px;
}
.ext-card {
  margin-top: 24px; padding: 20px 24px; background: #FFF;
  border: 1px solid #DADCE0; border-radius: 8px;
  display: flex; align-items: center; gap: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,.05);
}
.ext-card__icon {
  width: 48px; height: 48px; background: #C1462C; color: #FFF;
  border-radius: 8px; display: grid; place-items: center; font-size: 20px; font-weight: 700;
}
.ext-card__body { flex: 1; }
.ext-card__name { font-size: 16px; color: #202124; font-weight: 500; }
.ext-card__desc { font-size: 12px; color: #5F6368; margin-top: 4px; }
.ext-card__toggle {
  width: 34px; height: 18px; background: #1A73E8; border-radius: 9px; position: relative;
}
.ext-card__toggle::after {
  content: ''; position: absolute; width: 14px; height: 14px; border-radius: 50%;
  background: #FFF; top: 2px; right: 2px;
}

/* ─── Folder picker (macOS Finder style dialog) ─── */
.finder-dialog {
  position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
  width: 720px; height: 460px; background: #ECECEC; border-radius: 10px;
  box-shadow: 0 30px 80px rgba(0,0,0,.4);
  z-index: 99991; display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid rgba(0,0,0,.15);
}
.finder-hdr {
  background: #D8D8D8; padding: 10px 14px; display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid #C8C8C8;
}
.finder-hdr__title { flex: 1; text-align: center; font-size: 13px; color: #333; font-weight: 500; }
.finder-body { flex: 1; display: flex; overflow: hidden; }
.finder-side {
  width: 180px; background: #F5F5F5; padding: 14px 8px;
  border-right: 1px solid #DDD; font-size: 12px; color: #444;
}
.finder-side__item { padding: 6px 10px; display: flex; align-items: center; gap: 8px; border-radius: 4px; }
.finder-side__item.active { background: #C7E1F9; color: #202124; }
.finder-main { flex: 1; background: #FFF; padding: 12px; overflow: auto; }
.finder-item {
  display: flex; align-items: center; gap: 10px; padding: 6px 8px; font-size: 13px; color: #202124;
  border-radius: 4px;
}
.finder-item.selected { background: #C7E1F9; }
.finder-item__icon { font-size: 18px; }
.finder-foot {
  padding: 10px 14px; background: #ECECEC;
  display: flex; justify-content: flex-end; gap: 10px;
  border-top: 1px solid #DDD;
}
.finder-btn {
  padding: 6px 16px; background: #FFF; border: 1px solid #C8C8C8;
  border-radius: 5px; font-size: 12px; color: #333;
}
.finder-btn.primary { background: linear-gradient(180deg, #4a90e2, #1a73e8); color: #FFF; border-color: #1a73e8; }

/* ─── Puzzle popup (extension menu) ─── */
.ext-popup {
  position: fixed; top: 92px; right: 130px;
  width: 320px; background: #FFF; border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,.25); padding: 12px;
  z-index: 99991; font-size: 13px;
}
.ext-popup__title { font-size: 13px; color: #5F6368; padding: 6px 8px; margin-bottom: 4px; }
.ext-popup__row {
  display: flex; align-items: center; gap: 10px; padding: 8px;
  border-radius: 4px;
}
.ext-popup__row.hi { background: #F1F3F4; }
.ext-popup__row__icon {
  width: 24px; height: 24px; background: #C1462C; color: #FFF;
  border-radius: 4px; display: grid; place-items: center; font-size: 11px; font-weight: 700;
}
.ext-popup__row__name { flex: 1; color: #202124; }
.pin-icon { color: #5F6368; font-size: 16px; }
.pin-icon.pinned { color: #1A73E8; }

/* ─── Pinned extension in toolbar ─── */
.pinned-ext {
  width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  background: #C1462C; color: #FFF; font-size: 10px; font-weight: 700;
}

/* ─── YouTube page mock ─── */
.yt-page { background: #0F0F0F; height: 100%; color: #FFF; display: flex; flex-direction: column; }
.yt-hdr {
  height: 56px; background: #0F0F0F; display: flex; align-items: center; padding: 0 24px; gap: 20px;
  border-bottom: 1px solid #272727;
}
.yt-logo { font-size: 22px; font-weight: 700; }
.yt-logo span { color: #FF0000; }
.yt-search {
  flex: 1; max-width: 600px; height: 36px; background: #121212; border: 1px solid #303030;
  border-radius: 18px 0 0 18px; padding: 0 16px; font-size: 14px; color: #FFF;
  display: flex; align-items: center;
}
.yt-video {
  flex: 1; padding: 24px; display: flex; gap: 24px;
}
.yt-player {
  flex: 1; background: #000; border-radius: 8px; aspect-ratio: 16/9; position: relative;
  overflow: hidden;
}
.yt-player__img {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #1a1a1a 0%, #2a3a4a 50%, #3a5568 100%);
  display: grid; place-items: center;
}
.yt-player__title {
  color: #FFF; font-size: 24px; font-weight: 500;
}
.yt-side { width: 320px; }
.yt-title { color: #FFF; font-size: 18px; font-weight: 500; margin-top: 12px; }

/* ─── Recording popup (open from pinned ext) ─── */
.rec-popup {
  position: fixed; top: 92px; right: 84px;
  width: 320px; background: #FFF; border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,.35);
  z-index: 99991; padding: 20px;
}
.rec-popup__title {
  font-size: 15px; color: #202124; font-weight: 600; margin-bottom: 14px;
  display: flex; align-items: center; gap: 10px;
}
.rec-popup__icon {
  width: 28px; height: 28px; background: #C1462C; color: #FFF;
  border-radius: 6px; display: grid; place-items: center; font-size: 12px; font-weight: 700;
}
.rec-popup__btn {
  width: 100%; padding: 12px; background: #C1462C; color: #FFF;
  border-radius: 6px; font-size: 14px; font-weight: 600; text-align: center;
  margin-bottom: 8px;
}
.rec-popup__btn.stop { background: #202124; }
.rec-popup__hint { font-size: 11px; color: #5F6368; text-align: center; margin-top: 6px; }
.rec-popup__timer {
  text-align: center; font-family: 'Menlo', monospace;
  font-size: 22px; color: #C1462C; font-weight: 700; margin: 8px 0;
}
`;

async function injectHelper(p) {
  await p.evaluate((css) => {
    if (window.fpHelp) return;
    window.fpHelp = {};
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    window.fpHelp.getTarget = (sel) => (typeof sel === 'string' ? document.querySelector(sel) : sel);
    window.fpHelp.spot = (sel, label, kind) => {
      const t = window.fpHelp.getTarget(sel); if (!t) return;
      const r = t.getBoundingClientRect();
      const s = document.createElement('div');
      s.className = (kind === 'hint') ? 'fp-hint' : 'fp-spot';
      const pad = 6;
      s.style.left = (r.left - pad + window.scrollX) + 'px';
      s.style.top  = (r.top  - pad + window.scrollY) + 'px';
      s.style.width  = (r.width  + pad * 2) + 'px';
      s.style.height = (r.height + pad * 2) + 'px';
      document.body.appendChild(s);
      if (label) {
        const arr = document.createElement('div');
        arr.className = 'fp-arrow';
        arr.textContent = label;
        if (r.right + 260 > window.innerWidth) {
          arr.style.left = Math.max(10, r.left - 240 + window.scrollX) + 'px';
        } else {
          arr.style.left = (r.right + 20 + window.scrollX) + 'px';
        }
        arr.style.top  = (r.top + r.height / 2 - 18 + window.scrollY) + 'px';
        document.body.appendChild(arr);
      }
    };
    window.fpHelp.clearSpots = () => {
      document.querySelectorAll('.fp-spot, .fp-hint, .fp-arrow, .fp-ring').forEach(el => el.remove());
    };
    window.fpHelp.zoom = (sel, label, opts) => {
      opts = opts || {};
      const scale = opts.scale || 1.5;
      const t = window.fpHelp.getTarget(sel); if (!t) return;
      document.documentElement.classList.add('fp-zooming');
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const w = window.innerWidth, h = window.innerHeight;
      const tx = w / 2 - cx;
      const ty = h / 2 - cy;
      document.body.style.transformOrigin = 'top left';
      document.body.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      setTimeout(() => {
        if (label) window.fpHelp.spot(t, label);
        else window.fpHelp.spot(t, '');
      }, 750);
    };
    window.fpHelp.zoomOut = () => {
      window.fpHelp.clearSpots();
      document.body.style.transform = '';
      document.documentElement.classList.remove('fp-zooming');
    };
    window.fpHelp.clickRing = (sel) => {
      const t = window.fpHelp.getTarget(sel); if (!t) return;
      const r = t.getBoundingClientRect();
      const ring = document.createElement('div');
      ring.className = 'fp-ring';
      ring.style.left = (r.left + r.width / 2 - 30 + window.scrollX) + 'px';
      ring.style.top  = (r.top + r.height / 2 - 30 + window.scrollY) + 'px';
      ring.style.width = '60px';
      ring.style.height = '60px';
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 700);
    };
    window.fpHelp.caption = (text) => {
      document.querySelectorAll('.fp-caption').forEach(el => el.remove());
      const el = document.createElement('div');
      el.className = 'fp-caption';
      el.innerHTML = text;
      document.body.appendChild(el);
    };
    window.fpHelp.clearCaption = () => {
      document.querySelectorAll('.fp-caption').forEach(el => el.remove());
    };
    window.fpHelp.title = (text, eyebrow) => {
      const el = document.createElement('div');
      el.className = 'fp-title';
      el.innerHTML = (eyebrow ? `<small>${eyebrow}</small>` : '') + text;
      document.body.appendChild(el);
    };
    window.fpHelp.clearTitle = () => {
      document.querySelectorAll('.fp-title').forEach(el => el.remove());
    };
  }, HIGHLIGHT_CSS);
}

async function wait(p, ms) { await p.waitForTimeout(ms); }

class Sync {
  constructor(p) { this.p = p; this.t0 = Date.now(); this.acc = 0; }
  async segEnd(dur) {
    this.acc += dur;
    const elapsed = (Date.now() - this.t0) / 1000;
    const remain = this.acc - elapsed;
    if (remain > 0.05) await wait(this.p, remain * 1000);
  }
}

async function hint(p, sel, label = '') {
  await p.evaluate(({ s, l }) => window.fpHelp.spot(s, l, 'hint'), { s: sel, l: label });
}
async function spot(p, sel, label = '') {
  await p.evaluate(({ s, l }) => { window.fpHelp.clearSpots(); window.fpHelp.spot(s, l); }, { s: sel, l: label });
}
async function clearSpots(p) { await p.evaluate(() => window.fpHelp.clearSpots()); }
async function zoomIn(p, sel, label = '', scale = 1.5) {
  await p.evaluate(({ s, l, sc }) => window.fpHelp.zoom(s, l, { scale: sc }), { s: sel, l: label, sc: scale });
}
async function zoomOut(p) { await p.evaluate(() => window.fpHelp.zoomOut()); }
async function clickRing(p, sel) { await p.evaluate((s) => window.fpHelp.clickRing(s), sel); }
async function caption(p, text) { await p.evaluate((t) => window.fpHelp.caption(t), text); }
async function clearCaption(p) { await p.evaluate(() => window.fpHelp.clearCaption()); }

// 5段階カメラワーク
async function focusFlow(p, sel, label, opts = {}) {
  const holdMs = opts.holdMs ?? 2500;
  const scale = opts.scale ?? 1.5;
  const doClick = opts.click === true;
  await wait(p, 400);
  await hint(p, sel, label);
  await wait(p, 700);
  await zoomIn(p, sel, label, scale);
  await wait(p, 800);
  await wait(p, holdMs);
  if (doClick) { await clickRing(p, sel); await wait(p, 500); }
  await zoomOut(p);
  await wait(p, 350);
}

async function pointAt(p, sel, label, holdMs = 1200) {
  await hint(p, sel, label);
  await wait(p, 350);
  await spot(p, sel, label);
  await wait(p, holdMs);
  await clearSpots(p);
  await wait(p, 200);
}

// ─── 疑似 Chrome UI ヘルパー ─────────────────────────
async function setChromeScene(p, opts = {}) {
  const { tabTitle = 'FP Compass', url = 'about:blank', devMode = false, hasExt = false, pinnedExt = false, bodyHtml = '' } = opts;
  await p.evaluate((o) => {
    // 全体 reset
    document.body.innerHTML = '';
    document.body.style.background = '#E9EAED';
    const win = document.createElement('div');
    win.className = 'chrome-window';
    win.innerHTML = `
      <div class="chrome-titlebar">
        <div class="chrome-dot" style="background:#FF5F57;"></div>
        <div class="chrome-dot" style="background:#FEBC2E;"></div>
        <div class="chrome-dot" style="background:#28C840;"></div>
      </div>
      <div class="chrome-tabs">
        <div class="chrome-tab">
          <div class="chrome-tab__fav">${o.tabTitle === 'FP Compass' ? 'F' : (o.tabTitle === 'YouTube' ? '▶' : 'C')}</div>
          <span>${o.tabTitle}</span>
        </div>
      </div>
      <div class="chrome-toolbar">
        <div class="chrome-nav-btn">←</div>
        <div class="chrome-nav-btn">→</div>
        <div class="chrome-nav-btn">↻</div>
        <div class="chrome-urlbar">
          <span class="chrome-urlbar__lock">🔒</span>
          <span id="fp-url">${o.url}</span>
        </div>
        ${o.pinnedExt ? '<div class="pinned-ext" id="fp-pinned">F</div>' : ''}
        <div class="chrome-ext-icon" id="fp-puzzle">🧩</div>
        <div class="chrome-nav-btn">⋮</div>
      </div>
      <div class="chrome-body" id="fp-body">${o.bodyHtml}</div>
    `;
    document.body.appendChild(win);
  }, { tabTitle, url, devMode, hasExt, pinnedExt, bodyHtml });
}

// ─── 各章 シナリオ ────────────────────────────────
const chapters = [

  // ─────────────── 01 Chrome を 開く (6.6s) ───────────────
  { name: '01-open-chrome', segments: [
    // 「まず、グーグル クローム を ひらきます。」(3.3s)
    { dur: 3.3, act: async (p) => {
      // Desktop wallpaper + Dock
      await p.evaluate(() => {
        document.body.innerHTML = '';
        document.body.style.background = '';
        const bg = document.createElement('div');
        bg.className = 'desktop-bg';
        document.body.appendChild(bg);
        // Menubar (simplified)
        const bar = document.createElement('div');
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:24px;background:rgba(0,0,0,0.35);backdrop-filter:blur(20px);color:#fff;display:flex;align-items:center;padding:0 14px;gap:16px;font-size:13px;z-index:99988;';
        bar.innerHTML = `<span></span><span style="font-weight:700;">Finder</span><span>ファイル</span><span>編集</span><span style="margin-left:auto;font-family:'SF Mono',monospace;">${new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>`;
        document.body.appendChild(bar);
        // Dock
        const dock = document.createElement('div');
        dock.className = 'mac-dock';
        dock.innerHTML = `
          <div class="mac-dock__app">🗒️</div>
          <div class="mac-dock__app">📷</div>
          <div class="mac-dock__app">📧</div>
          <div class="mac-dock__app chrome" id="fp-dock-chrome"></div>
          <div class="mac-dock__app">📅</div>
          <div class="mac-dock__app">🗑️</div>
        `;
        document.body.appendChild(dock);
      });
      await wait(p, 300);
      await p.evaluate(() => window.fpHelp.title('Chrome を 開く', 'STEP 1 / 6'));
    }},
    // 「がめん した の ドック に ある、くろーむ の アイコン を クリック して ください。」(3.3s)
    { dur: 3.3, act: async (p) => {
      await p.evaluate(() => window.fpHelp.clearTitle());
      await focusFlow(p, '#fp-dock-chrome', 'Chrome を クリック', { holdMs: 1000, scale: 2.0, click: true });
    }},
  ]},

  // ─────────────── 02 chrome://extensions/ (12s) ───────────────
  { name: '02-extensions-url', segments: [
    // 「つぎ に、うえ の アドレス バー に、」(3s)
    { dur: 3.0, act: async (p) => {
      await setChromeScene(p, { tabTitle: '新しいタブ', url: '', bodyHtml: '<div style="display:grid;place-items:center;height:100%;color:#5F6368;font-size:16px;">新しいタブ</div>' });
      await wait(p, 400);
      await p.evaluate(() => window.fpHelp.title('URL を 入力', 'STEP 2 / 6'));
      await wait(p, 600);
      await p.evaluate(() => window.fpHelp.clearTitle());
    }},
    // 「クロームコロンスラッシュスラッシュ〜と入力して、エンター」(6s)
    { dur: 6.0, act: async (p) => {
      await hint(p, '.chrome-urlbar', 'アドレス バー');
      await wait(p, 500);
      await zoomIn(p, '.chrome-urlbar', 'ここ に 入力', 2.0);
      await wait(p, 1000);
      // Type animation
      const url = 'chrome://extensions/';
      for (let i = 1; i <= url.length; i++) {
        await p.evaluate((s) => { const el = document.getElementById('fp-url'); if (el) el.textContent = s; }, url.slice(0, i));
        await wait(p, 90);
      }
      await wait(p, 500);
      await zoomOut(p);
      await wait(p, 300);
    }},
    // 「これ が、かくちょうきのう の 管理 がめん です。」(3s)
    { dur: 3.0, act: async (p) => {
      // 遷移: chrome://extensions/ page
      await setChromeScene(p, {
        tabTitle: '拡張機能',
        url: 'chrome://extensions/',
        bodyHtml: `
          <div class="ext-page">
            <div class="ext-page__hdr">
              <div style="font-size:22px;">☰</div>
              <div class="ext-page__title">拡張機能</div>
            </div>
            <div class="ext-page__toolbar">
              <div class="dev-toggle" id="fp-dev-toggle">
                <span>デベロッパー モード</span>
                <div class="dev-toggle__switch" id="fp-dev-switch"></div>
              </div>
            </div>
            <div class="dev-actions" id="fp-dev-actions">
              <div class="dev-btn" id="fp-load-btn">パッケージ化されていない拡張機能を読み込む</div>
              <div class="dev-btn">拡張機能をパック</div>
              <div class="dev-btn">更新</div>
            </div>
            <div class="ext-empty" id="fp-ext-empty">この端末で開発中の拡張機能はありません</div>
          </div>
        `
      });
      await wait(p, 500);
      await caption(p, '<strong style="color:#C1462C;">拡張機能 の 管理 画面</strong> が 開きました');
    }},
  ]},

  // ─────────────── 03 デベロッパーモード ON (9s) ───────────────
  { name: '03-developer-mode', segments: [
    // 「がめん の みぎうえ に、でべろっぱーもーど の スイッチ が あります。」(4.5s)
    { dur: 4.5, act: async (p) => {
      await clearCaption(p);
      await p.evaluate(() => window.fpHelp.title('デベロッパー モード<br>を ON', 'STEP 3 / 6'));
      await wait(p, 1400);
      await p.evaluate(() => window.fpHelp.clearTitle());
      await pointAt(p, '#fp-dev-toggle', 'デベロッパー モード', 2000);
    }},
    // 「これ を クリック して、オン に して ください。スイッチ が あお く なれ ば、オン じょうたい です。」(4.5s)
    { dur: 4.5, act: async (p) => {
      await zoomIn(p, '#fp-dev-toggle', 'クリック', 2.2);
      await wait(p, 800);
      await clickRing(p, '#fp-dev-switch');
      await wait(p, 200);
      // トグル ON演出 + load ボタン表示
      await p.evaluate(() => {
        document.getElementById('fp-dev-switch')?.classList.add('on');
        document.getElementById('fp-dev-actions')?.classList.add('show');
        document.getElementById('fp-ext-empty')?.remove();
      });
      await wait(p, 1500);
      await zoomOut(p);
      await wait(p, 300);
    }},
  ]},

  // ─────────────── 04 フォルダ 読み込む (14.9s) ───────────────
  { name: '04-load-folder', segments: [
    // 「つぎ に、ひだり うえ の 「パッケージ化されていない拡張機能を読み込む」 ボタン を クリック します。」(6s)
    { dur: 6.0, act: async (p) => {
      await clearCaption(p);
      await p.evaluate(() => window.fpHelp.title('フォルダ を<br>読み込む', 'STEP 4 / 6'));
      await wait(p, 1500);
      await p.evaluate(() => window.fpHelp.clearTitle());
      await focusFlow(p, '#fp-load-btn', 'このボタン', { holdMs: 1500, scale: 1.8, click: true });
    }},
    // 「フォルダ せんたく の まど が ひらく ので、デスクトップ に ある、FP Compass 拡張機能 と いう フォルダ を えらんで」(6s)
    { dur: 6.0, act: async (p) => {
      // Finder ダイアログ 表示
      await p.evaluate(() => {
        const dlg = document.createElement('div');
        dlg.className = 'finder-dialog';
        dlg.id = 'fp-finder';
        dlg.innerHTML = `
          <div class="finder-hdr">
            <div class="chrome-dot" style="background:#FF5F57;"></div>
            <div class="chrome-dot" style="background:#FEBC2E;"></div>
            <div class="chrome-dot" style="background:#28C840;"></div>
            <div class="finder-hdr__title">フォルダを選択</div>
          </div>
          <div class="finder-body">
            <div class="finder-side">
              <div style="color:#888;font-size:11px;padding:4px 10px;">お気に入り</div>
              <div class="finder-side__item">📄 最近</div>
              <div class="finder-side__item">📱 AirDrop</div>
              <div class="finder-side__item">🗂️ 書類</div>
              <div class="finder-side__item active">🖥️ デスクトップ</div>
              <div class="finder-side__item">📥 ダウンロード</div>
            </div>
            <div class="finder-main" id="fp-finder-main">
              <div class="finder-item"><span class="finder-item__icon">📁</span>スクリーンショット</div>
              <div class="finder-item"><span class="finder-item__icon">📁</span>プロジェクト</div>
              <div class="finder-item" id="fp-finder-target"><span class="finder-item__icon">📁</span>FP Compass 拡張機能</div>
              <div class="finder-item"><span class="finder-item__icon">📄</span>メモ.txt</div>
              <div class="finder-item"><span class="finder-item__icon">📁</span>写真</div>
            </div>
          </div>
          <div class="finder-foot">
            <div class="finder-btn">キャンセル</div>
            <div class="finder-btn primary" id="fp-finder-select">選択</div>
          </div>
        `;
        document.body.appendChild(dlg);
      });
      await wait(p, 800);
      await pointAt(p, '#fp-finder-target', 'FP Compass 拡張機能', 3000);
      await p.evaluate(() => document.getElementById('fp-finder-target')?.classList.add('selected'));
      await wait(p, 800);
    }},
    // 「「せんたく」 を おします。」(2.9s)
    { dur: 2.9, act: async (p) => {
      await focusFlow(p, '#fp-finder-select', '選択', { holdMs: 800, scale: 2.0, click: true });
      await wait(p, 200);
    }},
    // 拡張機能が追加された結果 (残り)
    { dur: 0.0, act: async (p) => { /* combined into next */ }},
  ]},
  // NOTE: 04 は 実尺 14.9s。 上記 6+6+2.9 = 14.9s 完璧

  // ─────────────── 05 ピン留め (15s) ───────────────
  { name: '05-pin', segments: [
    // 「かくちょうきのう が、いちらん に ついか されました。」(3s)
    { dur: 3.0, act: async (p) => {
      await clearCaption(p);
      // Finder 閉じる + 拡張カード追加
      await p.evaluate(() => {
        document.getElementById('fp-finder')?.remove();
        document.getElementById('fp-ext-empty')?.remove();
        const body = document.querySelector('.ext-page');
        if (body && !document.getElementById('fp-ext-card')) {
          const card = document.createElement('div');
          card.className = 'ext-card';
          card.id = 'fp-ext-card';
          card.innerHTML = `
            <div class="ext-card__icon">F</div>
            <div class="ext-card__body">
              <div class="ext-card__name">FP Compass 議事録レコーダー</div>
              <div class="ext-card__desc">タブ音声を録音し、議事録を自動生成します</div>
            </div>
            <div class="ext-card__toggle"></div>
          `;
          body.appendChild(card);
        }
      });
      await wait(p, 500);
      await pointAt(p, '#fp-ext-card', '追加 されました', 1800);
    }},
    // 「くろーむ の みぎ うえ に ある、パズル ピース の アイコン を クリック します。」(5s)
    { dur: 5.0, act: async (p) => {
      await p.evaluate(() => window.fpHelp.title('ピン 留め', 'STEP 5 / 6'));
      await wait(p, 1200);
      await p.evaluate(() => window.fpHelp.clearTitle());
      await focusFlow(p, '#fp-puzzle', 'パズル ピース', { holdMs: 1200, scale: 2.4, click: true });
    }},
    // 「FP Compass 議事録レコーダー の よこ の、ピン の アイコン を クリック すると、ツールバー に じょうじ ひょうじ されます。」(7s)
    { dur: 7.0, act: async (p) => {
      // popup 表示
      await p.evaluate(() => {
        const pop = document.createElement('div');
        pop.className = 'ext-popup';
        pop.id = 'fp-ext-popup';
        pop.innerHTML = `
          <div class="ext-popup__title">拡張機能</div>
          <div class="ext-popup__row hi">
            <div class="ext-popup__row__icon">F</div>
            <div class="ext-popup__row__name">FP Compass 議事録レコーダー</div>
            <div class="pin-icon" id="fp-pin-target">📌</div>
          </div>
          <div class="ext-popup__row">
            <div class="ext-popup__row__icon" style="background:#4285F4;">G</div>
            <div class="ext-popup__row__name">Google 翻訳</div>
            <div class="pin-icon">📌</div>
          </div>
        `;
        document.body.appendChild(pop);
      });
      await wait(p, 800);
      await focusFlow(p, '#fp-pin-target', 'ピン アイコン', { holdMs: 1200, scale: 2.2, click: true });
      // ピン ON → toolbar に icon 追加
      await p.evaluate(() => {
        document.getElementById('fp-pin-target')?.classList.add('pinned');
        // toolbar に icon 差し込み
        if (!document.getElementById('fp-pinned')) {
          const puzzle = document.getElementById('fp-puzzle');
          const pin = document.createElement('div');
          pin.className = 'pinned-ext';
          pin.id = 'fp-pinned';
          pin.textContent = 'F';
          puzzle?.parentNode?.insertBefore(pin, puzzle);
        }
        document.getElementById('fp-ext-popup')?.remove();
      });
      await wait(p, 600);
      await pointAt(p, '#fp-pinned', '常時 表示 されました', 2500);
    }},
  ]},

  // ─────────────── 06 YouTube 動作テスト (18.8s) ───────────────
  { name: '06-test', segments: [
    // 「さいご に、どうさ かくにん です。」(2.5s)
    { dur: 2.5, act: async (p) => {
      await clearCaption(p);
      await p.evaluate(() => window.fpHelp.title('動作 確認', 'STEP 6 / 6'));
      await wait(p, 1500);
      await p.evaluate(() => window.fpHelp.clearTitle());
    }},
    // 「ユーチューブ を ひらいて、どうが を さいせい して ください。」(4.5s)
    { dur: 4.5, act: async (p) => {
      // YouTube ページ に遷移 (pinnedExt 保持)
      await setChromeScene(p, {
        tabTitle: 'YouTube',
        url: 'https://www.youtube.com/',
        pinnedExt: true,
        bodyHtml: `
          <div class="yt-page">
            <div class="yt-hdr">
              <div style="font-size:22px;">☰</div>
              <div class="yt-logo">You<span>Tube</span></div>
              <div class="yt-search">検索</div>
            </div>
            <div class="yt-video">
              <div class="yt-player">
                <div class="yt-player__img">
                  <div class="yt-player__title">▶ 動画 再生 中</div>
                </div>
              </div>
              <div class="yt-side">
                <div class="yt-title">サンプル 動画</div>
                <div style="color:#AAA;font-size:13px;margin-top:6px;">1,234 回 視聴</div>
              </div>
            </div>
          </div>
        `
      });
      await wait(p, 700);
      await caption(p, 'YouTube を 開いて 動画 再生');
    }},
    // 「かくちょうきのう の アイコン を クリック して、ろくおん かいし、を おし、」(5s)
    { dur: 5.0, act: async (p) => {
      await clearCaption(p);
      await focusFlow(p, '#fp-pinned', '拡張 アイコン', { holdMs: 1000, scale: 2.4, click: true });
      // 録音 popup 表示
      await p.evaluate(() => {
        const pop = document.createElement('div');
        pop.className = 'rec-popup';
        pop.id = 'fp-rec-popup';
        pop.innerHTML = `
          <div class="rec-popup__title">
            <div class="rec-popup__icon">F</div>
            FP Compass 議事録
          </div>
          <div class="rec-popup__btn" id="fp-rec-start">● 録音 開始</div>
          <div class="rec-popup__hint">タブ の 音声 を 録音 します</div>
        `;
        document.body.appendChild(pop);
      });
      await wait(p, 500);
      await pointAt(p, '#fp-rec-start', '録音 開始', 1500);
    }},
    // 「ユーチューブ の タブ を えらび、じゅう びょう ほど まって、ていし、を おします。」(6s)
    { dur: 6.0, act: async (p) => {
      await clickRing(p, '#fp-rec-start');
      // 録音中 UIに切替
      await p.evaluate(() => {
        const pop = document.getElementById('fp-rec-popup');
        if (pop) {
          pop.innerHTML = `
            <div class="rec-popup__title">
              <div class="rec-popup__icon">F</div>
              録音 中
            </div>
            <div class="rec-popup__timer" id="fp-timer">00:00</div>
            <div class="rec-popup__btn stop" id="fp-rec-stop">■ 停止</div>
            <div class="rec-popup__hint">YouTube タブ を 録音 中</div>
          `;
        }
      });
      // タイマー を 秒 で 増やす
      for (let s = 1; s <= 10; s++) {
        await p.evaluate((sec) => {
          const el = document.getElementById('fp-timer');
          if (el) el.textContent = `00:${String(sec).padStart(2,'0')}`;
        }, s);
        await wait(p, 400);
      }
      await pointAt(p, '#fp-rec-stop', '停止', 800);
    }},
    // 「これ で、FP Compass Chrome 拡張機能 の セットアップ は かんりょう です。」(0.8s + fade)
    { dur: 0.8, act: async (p) => {
      await clickRing(p, '#fp-rec-stop');
      await p.evaluate(() => {
        document.getElementById('fp-rec-popup')?.remove();
        window.fpHelp.title('セットアップ 完了', 'END');
      });
    }},
  ]},

];

// ─── main ─────────────────────────────────────
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
});
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PE:', e.message.slice(0, 80)));

// 空 blank page で helper 注入
await p.goto('data:text/html,<html><head><meta charset="utf-8"><title>FP Compass Chrome Ext Guide</title></head><body></body></html>', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(400);
await injectHelper(p);
console.log('  ✓ helper injected');

const timeline = [];
const t0 = Date.now();
const ONLY_ARG = process.argv[2] || '';
for (const f of chapters) {
  if (ONLY_ARG && !f.name.includes(ONLY_ARG)) continue;
  // 各章開始時に body リセットして helper 再注入
  await p.evaluate(() => { document.body.innerHTML = ''; document.body.style.transform = ''; document.documentElement.classList.remove('fp-zooming'); });
  await injectHelper(p);
  const start = (Date.now() - t0) / 1000;
  const target = AUDIO_DUR[f.name] || 15;
  console.log(`🎬 [${start.toFixed(1)}s] ${f.name} (target ${target}s, ${f.segments.length} seg)`);

  const sync = new Sync(p);
  try {
    for (let i = 0; i < f.segments.length; i++) {
      const seg = f.segments[i];
      if (seg.dur <= 0) continue;
      await seg.act(p, sync);
      await sync.segEnd(seg.dur);
    }
  } catch (e) {
    console.log(`  err: ${e.message.slice(0, 120)}`);
  }
  const end = (Date.now() - t0) / 1000;
  const actualDur = end - start;
  console.log(`  actual ${actualDur.toFixed(1)}s (target ${target.toFixed(1)}, diff ${(actualDur - target).toFixed(1)})`);
  timeline.push({ name: f.name, start, end, dur: actualDur });
}

await ctx.close();
await b.close();

writeFileSync(`${OUT_DIR}/_timeline.json`, JSON.stringify(timeline, null, 2));
const files = readdirSync(OUT_DIR).filter(f => f.endsWith('.webm') && !f.match(/^\d{2}-/));
if (files.length) {
  const newest = files.sort((a,b) => statSync(`${OUT_DIR}/${b}`).mtimeMs - statSync(`${OUT_DIR}/${a}`).mtimeMs)[0];
  const target = `${OUT_DIR}/_all.webm`;
  if (existsSync(target)) unlinkSync(target);
  renameSync(`${OUT_DIR}/${newest}`, target);
  console.log(`\n✅ saved: _all.webm + _timeline.json`);
} else {
  console.log('\n✗ no webm');
}
