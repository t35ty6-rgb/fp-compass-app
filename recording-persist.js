// ============================================================================
// recording-persist.js — 議事録 録音 の 途中 復帰 用 IndexedDB 永続化 layer
// ★ 2026-08-12 owner「Wi-Fi 切れた ら 途中 から 復帰」 対応 (B案)
//
// 責務:
//   1. MediaRecorder chunk を 逐次 IndexedDB に 保存 (tab 落ち · Wi-Fi 断 で 消失 防止)
//   2. onstop 時 に meta (customerName, mimeType, booking) を 保存
//   3. Drive/AI 送信 の retry wrapper 提供 (Wi-Fi 復帰 で 自動 再送)
//   4. 起動 時 に 未 送信 の 録音 を scan → 自動 再送
//
// 使い方:
//   const persist = window.RecordingPersist;
//   await persist.saveChunk(bookingTs, blobPart);           // ondataavailable 内
//   await persist.setMeta(bookingTs, {customerName, ...});  // onstop の 頭
//   const blob = await persist.rebuildBlob(bookingTs);      // 復帰 時
//   await persist.markUploaded(bookingTs);                  // Drive/AI 両方 完了 で 削除
// ============================================================================
(function () {
  'use strict';
  const DB_NAME = 'fp-recording-persist-v1';
  const STORE_CHUNKS = 'chunks';   // key: `${bookingTs}::${index}`, val: Blob
  const STORE_META   = 'meta';     // key: bookingTs, val: {customerName, mimeType, booking, createdAt, uploadedDrive:bool, uploadedAI:bool, retries:{drive:n, ai:n}}

  let _dbPromise = null;
  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) db.createObjectStore(STORE_CHUNKS);
        if (!db.objectStoreNames.contains(STORE_META))   db.createObjectStore(STORE_META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  async function tx(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let result;
      Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('tx abort'));
    });
  }

  async function saveChunk(bookingTs, index, blobPart) {
    if (!bookingTs || !blobPart || blobPart.size === 0) return;
    const key = `${bookingTs}::${String(index).padStart(6, '0')}`;
    await tx(STORE_CHUNKS, 'readwrite', s => s.put(blobPart, key));
  }

  async function loadChunks(bookingTs) {
    return tx(STORE_CHUNKS, 'readonly', s => new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(`${bookingTs}::`, `${bookingTs}::￿`);
      const chunks = [];
      const req = s.openCursor(range);
      req.onsuccess = () => {
        const c = req.result;
        if (c) { chunks.push(c.value); c.continue(); }
        else resolve(chunks);
      };
      req.onerror = () => reject(req.error);
    }));
  }

  async function rebuildBlob(bookingTs, mimeType) {
    const chunks = await loadChunks(bookingTs);
    if (!chunks.length) return null;
    return new Blob(chunks, { type: mimeType || 'audio/webm' });
  }

  async function setMeta(bookingTs, patch) {
    if (!bookingTs) return;
    await tx(STORE_META, 'readwrite', async s => {
      const existing = await new Promise((res, rej) => {
        const r = s.get(bookingTs);
        r.onsuccess = () => res(r.result || {});
        r.onerror = () => rej(r.error);
      });
      const merged = { ...existing, ...patch, updatedAt: Date.now() };
      if (!merged.createdAt) merged.createdAt = Date.now();
      s.put(merged, bookingTs);
    });
  }

  async function getMeta(bookingTs) {
    return tx(STORE_META, 'readonly', s => new Promise((res, rej) => {
      const r = s.get(bookingTs);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    }));
  }

  async function listPending() {
    return tx(STORE_META, 'readonly', s => new Promise((res, rej) => {
      const items = [];
      const req = s.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          const m = c.value || {};
          const finished = m.uploadedDrive && m.uploadedAI;
          if (!finished) items.push({ bookingTs: c.key, meta: m });
          c.continue();
        } else res(items);
      };
      req.onerror = () => rej(req.error);
    }));
  }

  async function clear(bookingTs) {
    await tx(STORE_CHUNKS, 'readwrite', s => new Promise((res, rej) => {
      const range = IDBKeyRange.bound(`${bookingTs}::`, `${bookingTs}::￿`);
      const req = s.openCursor(range);
      req.onsuccess = () => {
        const c = req.result;
        if (c) { c.delete(); c.continue(); }
        else res();
      };
      req.onerror = () => rej(req.error);
    }));
    await tx(STORE_META, 'readwrite', s => s.delete(bookingTs));
  }

  async function markUploadedDrive(bookingTs) { await setMeta(bookingTs, { uploadedDrive: true }); await maybeClear(bookingTs); }
  async function markUploadedAI(bookingTs)    { await setMeta(bookingTs, { uploadedAI: true });    await maybeClear(bookingTs); }
  async function maybeClear(bookingTs) {
    const m = await getMeta(bookingTs);
    if (m && m.uploadedDrive && m.uploadedAI) await clear(bookingTs);
  }

  // ============================================================
  // retry wrapper — Wi-Fi 断 の 復帰 を 待って から fetch
  // ============================================================
  function waitForOnline(timeoutMs = 5 * 60 * 1000) {
    return new Promise((resolve) => {
      if (navigator.onLine) return resolve(true);
      let done = false;
      const finish = (v) => { if (done) return; done = true; window.removeEventListener('online', onOnline); clearTimeout(t); resolve(v); };
      const onOnline = () => finish(true);
      window.addEventListener('online', onOnline);
      const t = setTimeout(() => finish(false), timeoutMs);
    });
  }

  async function fetchWithRetry(url, options, opts) {
    const maxRetries = (opts && opts.maxRetries) || 6;   // total 7 tries
    const baseBackoff = (opts && opts.baseBackoff) || 2000; // 2,4,8,16,32,60,60s
    const capBackoff = 60000;
    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (!navigator.onLine) {
        const back = await waitForOnline();
        if (!back) throw new Error('offline (timeout)');
      }
      try {
        const res = await fetch(url, options);
        // 5xx → retry-able
        if (res.status >= 500 && res.status < 600) {
          lastErr = new Error(`server ${res.status}`);
        } else {
          return res;
        }
      } catch (e) {
        lastErr = e;
      }
      if (attempt === maxRetries) break;
      const wait = Math.min(capBackoff, baseBackoff * Math.pow(2, attempt));
      await new Promise(r => setTimeout(r, wait));
    }
    throw lastErr || new Error('fetch failed');
  }

  window.RecordingPersist = {
    saveChunk, loadChunks, rebuildBlob,
    setMeta, getMeta, listPending, clear,
    markUploadedDrive, markUploadedAI,
    fetchWithRetry, waitForOnline,
  };
})();
