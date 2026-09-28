/* ============================================================
   db.js — обёртка IndexedDB + миграция из localStorage
   ============================================================ */

window.App = window.App || {};

window.App.db = (() => {
"use strict";

const DB_NAME    = "paper-notebook";
const DB_VERSION = 2;

const STORES = {
  documents: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["folderId", "folderId"], ["trashed", "trashed"]] },
  folders:   { keyPath: "id" },
  tags:      { keyPath: "id" },
  templates: { keyPath: "id" },
  meta:      { keyPath: "key" },
  backup:    { keyPath: "id" }
};

const OLD_LOCALSTORAGE_KEY = "paper-notebook-v1";

let _db = null;

function open(){
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
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
    };

    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

function tx(storeName, mode = "readonly"){
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function reqP(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function get(store, key){
  return reqP(tx(store).get(key));
}

function all(store){
  return reqP(tx(store).getAll());
}

function put(store, value){
  return reqP(tx(store, "readwrite").put(value));
}

function del(store, key){
  return reqP(tx(store, "readwrite").delete(key));
}

function clear(store){
  return reqP(tx(store, "readwrite").clear());
}

function putMany(store, values){
  return new Promise((resolve, reject) => {
    const t = _db.transaction(store, "readwrite");
    const s = t.objectStore(store);
    values.forEach(v => s.put(v));
    t.oncomplete = () => resolve(values.length);
    t.onerror    = () => reject(t.error);
  });
}

function delMany(store, keys){
  return new Promise((resolve, reject) => {
    const t = _db.transaction(store, "readwrite");
    const s = t.objectStore(store);
    keys.forEach(k => s.delete(k));
    t.oncomplete = () => resolve(keys.length);
    t.onerror    = () => reject(t.error);
  });
}

async function init(){
  await open();
  await migrateFromLocalStorage();
}

async function migrateFromLocalStorage(){
  const migrated = await get("meta", "migratedFromLocalStorage");
  if (migrated?.value) return;

  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(OLD_LOCALSTORAGE_KEY) || "null");
  } catch(e){}

  if (raw && typeof raw === "object"){
    const U = window.App.utils;
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

    await put("documents", doc);
    await put("meta", { key: "activeDocId", value: docId });
    await put("meta", { key: "ui", value: {
      sidebarOpen: true,
      cardMode: "normal",
      sortMode: "updated",
      groupMode: "date",
      openTabs: [docId],
      theme: raw.theme || "paper",
      fonts: raw.fonts || {}
    }});
    await put("meta", { key: "settings", value: {
      saveDebounceMs: 150,
      inputDebounceMs: 400,
      trashTtlDays: 30,
      backupEveryHours: 24,
      allowExternalRequests: false
    }});
    await put("meta", { key: "migratedFromLocalStorage", value: now });
    try { localStorage.removeItem(OLD_LOCALSTORAGE_KEY); } catch(e){}
    return true;
  }

  await put("meta", { key: "migratedFromLocalStorage", value: window.App.utils.now() });
  return false;
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

/* ---------- Очистка ---------- */

async function clearAll(){
  await clear("documents");
  await clear("folders");
  await clear("tags");
  await clear("templates");
  await clear("meta");
  await clear("backup");
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
  clearAll,
  migrateFromLocalStorage
};

})();