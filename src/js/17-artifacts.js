/* ============ 17 产物持久化：IndexedDB 存字节，刷新后仍可下载 ============ */
/* 背景：会话消息存 localStorage，Blob 无法序列化，刷新后 art.blob 会变成空对象，
   点下载就什么都不发生。这里把产物的字节单独存进 IndexedDB，按 id 取回。 */
const ArtifactStore = {
  DB: 'aaim-artifacts',
  VER: 1,
  STORE: 'files',
  _db: null,

  open() {
    if (this._db) return Promise.resolve(this._db);
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('浏览器不支持 IndexedDB'));
    return new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(this.DB, this.VER); }
      catch (e) { return rej(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          const os = db.createObjectStore(this.STORE, { keyPath: 'id' });
          os.createIndex('ts', 'ts');
        }
      };
      req.onsuccess = () => { this._db = req.result; res(this._db); };
      req.onerror = () => rej(req.error || new Error('IndexedDB 打开失败'));
      req.onblocked = () => rej(new Error('IndexedDB 被其它标签页占用'));
    });
  },

  async _tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(this.STORE, mode);
      let out;
      try { out = fn(tx.objectStore(this.STORE)); } catch (e) { return rej(e); }
      tx.oncomplete = () => res(out && out.__req ? out.__req.result : out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('事务中断'));
    });
  },

  /** 存一个产物（art: {id,name,mime,size,kind,blob}） */
  async put(art) {
    try {
      if (!art || !art.id) return false;
      const blob = art.blob;
      if (!(blob instanceof Blob)) return false;
      const buf = await blob.arrayBuffer();
      await this._tx('readwrite', (os) => os.put({
        id: art.id, name: art.name, mime: art.mime, size: art.size,
        kind: art.kind, ts: Date.now(), buf
      }));
      return true;
    } catch (e) {
      console.warn('[ArtifactStore] 保存失败', art && art.name, e);
      return false;
    }
  },

  /** 按 id 取回 Blob（找不到返回 null） */
  async get(id) {
    try {
      const db = await this.open();
      const rec = await new Promise((res, rej) => {
        const tx = db.transaction(this.STORE, 'readonly');
        const rq = tx.objectStore(this.STORE).get(id);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
      if (!rec || !rec.buf) return null;
      return new Blob([rec.buf], { type: rec.mime || 'application/octet-stream' });
    } catch (e) {
      console.warn('[ArtifactStore] 读取失败', id, e);
      return null;
    }
  },

  async has(id) {
    try {
      const db = await this.open();
      const n = await new Promise((res, rej) => {
        const tx = db.transaction(this.STORE, 'readonly');
        const rq = tx.objectStore(this.STORE).count(id);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
      return n > 0;
    } catch { return false; }
  },

  async del(id) { try { await this._tx('readwrite', (os) => os.delete(id)); } catch { } },
  async clear() { try { await this._tx('readwrite', (os) => os.clear()); } catch { } },

  async list() {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const tx = db.transaction(this.STORE, 'readonly');
        const rq = tx.objectStore(this.STORE).getAll();
        rq.onsuccess = () => res((rq.result || []).map((r) => ({ id: r.id, name: r.name, size: r.size, kind: r.kind, ts: r.ts })));
        rq.onerror = () => rej(rq.error);
      });
    } catch { return []; }
  },

  /** 清理：超过 maxAge 天的，或总量超过 maxCount 个的旧记录 */
  async prune({ maxAge = 14 * 864e5, maxCount = 80 } = {}) {
    try {
      const all = await this.list();
      if (!all.length) return 0;
      const now = Date.now();
      const old = all.filter((r) => now - (r.ts || 0) > maxAge);
      const sorted = all.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const over = sorted.slice(maxCount);
      const kill = new Set([...old, ...over].map((r) => r.id));
      for (const id of kill) await this.del(id);
      return kill.size;
    } catch { return 0; }
  }
};

/** 把产物解析成可用的 Blob：内存里有效就直接用，否则回 IndexedDB 取 */
async function resolveArtifactBlob(art) {
  if (!art) return null;
  if (art.blob instanceof Blob) return art.blob;
  if (!art.id) return null;
  const b = await ArtifactStore.get(art.id);
  if (b) art.blob = b;                 // 回填，下次直接用
  return b;
}

/** 下载产物（异步解析，兼容刷新后的历史记录） */
async function downloadArtifact(art) {
  if (!art) return toast('找不到这个文件', 'err');
  const t = (art.blob instanceof Blob) ? null : toast('正在从本地存储恢复文件…', '', 8000);
  let blob = null;
  try { blob = await resolveArtifactBlob(art); }
  finally { if (t) t.remove(); }
  if (!blob) {
    toast(`「${art.name}」的原始内容已不在本地（只保留了文件名）。请让 Agent 重新生成一次。`, 'err', 6500);
    return false;
  }
  downloadBlob(blob, art.name);
  return true;
}

/** 在新窗口打开 HTML 类产物 */
async function openArtifact(art) {
  if (!art) return;
  const t = (art.blob instanceof Blob) ? null : toast('正在恢复文件…', '', 8000);
  let blob = null;
  try { blob = await resolveArtifactBlob(art); }
  finally { if (t) t.remove(); }
  if (!blob) return toast(`「${art.name}」的内容已不在本地，请重新生成。`, 'err', 6000);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) toast('浏览器拦截了新窗口，请允许弹窗后重试', 'err');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** 判断某个产物现在能不能下载（用于 UI 置灰） */
function artifactReady(art) {
  return !!(art && (art.blob instanceof Blob));
}
