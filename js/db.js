/* ============================================================
   db.js — обёртка IndexedDB + миграция из localStorage

   [Пакет 7]  транзакции, oncomplete/onabort, onversionchange,
              кэш промиса, persist, guard в tx(), убран индекс trashed.
   [Пакет 8]  putMany/delMany — onabort.
   [Пакет 13] новый store imgStore — persistent-кэш картинок
              (id → dataUrl) для истории undo/redo.
   ============================================================ */

window.App = window.App || {};

window.App.db = (() => {
"use strict";

const DB_NAME    = "paper-notebook";
/* [Пакет 13] v3 — добавлен store imgStore */
const DB_VERSION = 3;

const STORES = {
  documents: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["folderId", "folderId"]] },
  folders:   { keyPath: "id" },
  tags:      { keyPath: "id" },
  templates: { keyPath: "id" },
  meta:      { keyPath: "key" },
  backup:    { keyPath: "id" },
  /* [Пакет 13] id → dataUrl (base64 картинок вне истории) */
  imgStore:  { keyPath: "id" }
};

const OLD_LOCALSTORAGE_KEY = "paper-notebook-v1";

/* [Пакет 7] кэшируем промис, а не значение — защита от параллельных open() */
let _dbPromise = null;
let _db        = null;

function open(){
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)){
      reject(new Error("IndexedDB не поддерживается"));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      for (const [name, spec] of Object.entries(STORES)){
        let store;
        if (!db.objectStoreNames.contains(name)){
          store = db.createObjectStore(name, { keyPath: spec.keyPath });
        } else {
          store = e.target.transaction.objectStore(name);
        }
        (spec.indexes || []).forEach(([idxName, keyPath]) => {
          if (!store.indexNames.contains(idxName)){
            store.createIndex(idxName, keyPath, { unique: false });
          }
        });
      }

      /* [Пакет 7] чистим устаревший индекс trashed, если он есть */
      try {
        const docsStore = e.target.transaction.objectStore("documents");
        if (docsStore.indexNames.contains("trashed")){
          docsStore.deleteIndex("trashed");
        }
      } catch(_){}
    };

    req.onsuccess = () => {
      _db = req.result;

      /* [Пакет 7] другая вкладка апгрейдит схему — закрываем текущее соединение */
      _db.onversionchange = () => {
        try { _db.close(); } catch(_){}
        _db = null;
        _dbPromise = null;
        console.warn("[db] IndexedDB connection closed (versionchange)");
      };

      resolve(_db);
    };

    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };

    /* [Пакет 7] другая вкладка держит старую версию БД */
    req.onblocked = () => {
      console.warn("[db] upgrade blocked by another tab — close it");
    };
  });

  return _dbPromise;
}

/* [Пакет 7] guard на _db */
function tx(storeName, mode = "readonly"){
  if (!_db){
    throw new Error("[db] not initialized — call db.init() first");
  }
  return _db.transaction(storeName, mode).objectStore(storeName);
}

/* [Пакет 7] ждём oncomplete транзакции, а не req.onsuccess. */
function writeTx(storeName, executor){
  return new Promise((resolve, reject) => {
    if (!_db){
      reject(new Error("[db] not initialized"));
      return;
    }

    let t;
    try {
      t = _db.transaction(storeName, "readwrite");
    } catch(e){
      reject(e);
      return;
    }

    const s = t.objectStore(storeName);

    let aborted = false;
    t.oncomplete = () => { if (!aborted) resolve(); };
    t.onerror    = () => { aborted = true; reject(t.error); };
    t.onabort    = () => { aborted = true; reject(t.error || new Error("aborted")); };

    try {
      executor(s);
    } catch(e){
      try { t.abort(); } catch(_){}
      aborted = true;
      reject(e);
    }
  });
}

function readTx(storeName, executor){
  return new Promise((resolve, reject) => {
    if (!_db){
      reject(new Error("[db] not initialized"));
      return;
    }

    let t;
    try {
      t = _db.transaction(storeName, "readonly");
    } catch(e){
      reject(e);
      return;
    }

    const s = t.objectStore(storeName);
    let result;

    try {
      result = executor(s);
    } catch(e){
      reject(e);
      return;
    }

    t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error || new Error("aborted"));
  });
}

/* ---------- Примитивы ---------- */

function get(store, key){
  return new Promise((resolve, reject) => {
    if (!_db){
      reject(new Error("[db] not initialized"));
      return;
    }
    let t;
    try {
      t = _db.transaction(store, "readonly");
    } catch(e){ reject(e); return; }

    const s = t.objectStore(store);
    const req = s.get(key);
    let value;
    req.onsuccess = () => { value = req.result; };
    t.oncomplete  = () => resolve(value);
    t.onerror     = () => reject(t.error);
    t.onabort     = () => reject(t.error || new Error("aborted"));
  });
}

function all(store){
  return new Promise((resolve, reject) => {
    if (!_db){
      reject(new Error("[db] not initialized"));
      return;
    }
    let t;
    try {
      t = _db.transaction(store, "readonly");
    } catch(e){ reject(e); return; }

    const s = t.objectStore(store);
    const req = s.getAll();
    let value = [];
    req.onsuccess = () => { value = req.result || []; };
    t.oncomplete  = () => resolve(value);
    t.onerror     = () => reject(t.error);
    t.onabort     = () => reject(t.error || new Error("aborted"));
  });
}

function put(store, value){
  return writeTx(store, s => { s.put(value); }).then(() => value);
}

function del(store, key){
  return writeTx(store, s => { s.delete(key); });
}

function clear(store){
  return writeTx(store, s => { s.clear(); });
}

function putMany(store, values){
  return writeTx(store, s => {
    values.forEach(v => s.put(v));
  }).then(() => values.length);
}

function delMany(store, keys){
  return writeTx(store, s => {
    keys.forEach(k => s.delete(k));
  }).then(() => keys.length);
}

/* ---------- Инициализация ---------- */

async function init(){
  await open();

  /* [Пакет 7] Persistent Storage */
  try {
    if (navigator.storage && navigator.storage.persist){
      const persisted = await navigator.storage.persisted?.() ?? false;
      if (!persisted){
        const granted = await navigator.storage.persist();
        if (!granted){
          console.warn("[db] persistent storage not granted — data may be evicted");
        }
      }
    }
  } catch(e){
    console.warn("[db] persist() error:", e);
  }

  await migrateFromLocalStorage();
}

/* [Пакет 7] миграция одной транзакцией */
async function migrateFromLocalStorage(){
  const migrated = await get("meta", "migratedFromLocalStorage");
  if (migrated && migrated.value) return false;

  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(OLD_LOCALSTORAGE_KEY) || "null");
  } catch(e){}

  const U = window.App.utils;

  if (!raw || typeof raw !== "object"){
    await put("meta", { key: "migratedFromLocalStorage", value: U.now() });
    return false;
  }

  const now = U.now();
  const docId = U.uid();
  const doc = {
    id: docId,
    title: typeof raw.title === "string" ? raw.title : "",
    icon: "",
    color: "",
    description: "",
    blocks: Array.isArray(raw.blocks) ? raw.blocks : [],
    tags: [],
    folderId: null,
    favorite: false,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    customFields: {},
    blockCount: Array.isArray(raw.blocks) ? raw.blocks.length : 0,
    charCount: 0,
    wordCount: 0
  };

  await new Promise((resolve, reject) => {
    if (!_db){
      reject(new Error("[db] not initialized"));
      return;
    }
    let t;
    try {
      t = _db.transaction(["documents", "meta"], "readwrite");
    } catch(e){ reject(e); return; }

    const docsStore = t.objectStore("documents");
    const metaStore = t.objectStore("meta");

    docsStore.put(doc);
    metaStore.put({ key: "activeDocId", value: docId });
    metaStore.put({ key: "ui", value: {
      sidebarOpen: true,
      cardMode: "normal",
      sortMode: "updated",
      groupMode: "date",
      openTabs: [docId],
      theme: raw.theme || "paper",
      fonts: raw.fonts || {}
    }});
    metaStore.put({ key: "settings", value: {
      saveDebounceMs: 150,
      inputDebounceMs: 400,
      trashTtlDays: 30,
      backupEveryHours: 24,
      allowExternalRequests: false
    }});
    metaStore.put({ key: "migratedFromLocalStorage", value: now });

    t.oncomplete = () => resolve();
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error || new Error("aborted"));
  });

  try { localStorage.removeItem(OLD_LOCALSTORAGE_KEY); } catch(e){}
  return true;
}

/* ---------- Документы ---------- */

async function listDocuments(){ return all("documents"); }
async function getDocument(id){ return get("documents", id); }
async function saveDocument(doc){
  doc.updatedAt = window.App.utils.now();
  await put("documents", doc);
  return doc;
}
async function deleteDocument(id){ return del("documents", id); }
async function deleteDocuments(ids){ return delMany("documents", ids); }

/* ---------- Шаблоны ---------- */

async function listTemplates(){ return all("templates"); }
async function getTemplate(id){ return get("templates", id); }
async function saveTemplate(tpl){ return put("templates", tpl); }
async function deleteTemplate(id){ return del("templates", id); }

/* ---------- Мета ---------- */

async function getMeta(key){
  const row = await get("meta", key);
  return row ? row.value : undefined;
}

async function setMeta(key, value){
  await put("meta", { key, value });
}

/* ---------- Бэкап ---------- */

async function createBackup(payload){
  const id = window.App.utils.now();
  await put("backup", { id, at: new Date().toISOString(), payload });
  return id;
}

async function listBackups(){ return all("backup"); }
async function deleteBackup(id){ return del("backup", id); }

/* ============================================================
   [Пакет 13] imgStore — persistent-кэш картинок
   ============================================================ */

async function listImages(){ return all("imgStore"); }
async function getImage(id){ return get("imgStore", id); }
async function putImage(id, dataUrl){ return put("imgStore", { id, dataUrl }); }
async function deleteImage(id){ return del("imgStore", id); }

async function clearImages(){ return clear("imgStore"); }

/* ---------- Очистка ---------- */

async function clearAll(){
  await clear("documents");
  await clear("folders");
  await clear("tags");
  await clear("templates");
  await clear("meta");
  await clear("backup");
  /* [Пакет 13] чистим и картинки */
  await clear("imgStore");
}

return {
  DB_NAME, DB_VERSION, STORES,
  init, open,
  get, all, put, del, clear,
  putMany, delMany,
  listDocuments, getDocument, saveDocument, deleteDocument, deleteDocuments,
  listTemplates, getTemplate, saveTemplate, deleteTemplate,
  getMeta, setMeta,
  createBackup, listBackups, deleteBackup,
  /* [Пакет 13] картинки */
  listImages, getImage, putImage, deleteImage, clearImages,
  clearAll,
  migrateFromLocalStorage
};

})();