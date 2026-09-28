/* ============================================================
   state.js — S, history, undo/redo, storage, selection
   Мультидокументная модель поверх IndexedDB.
   Зависит от: utils, db
   ============================================================ */

window.App = window.App || {};

window.App.state = (() => {
"use strict";

const U = window.App.utils;
const DB = window.App.db;

const {
  HISTORY_LIMIT, INPUT_DEBOUNCE, SAVE_DEBOUNCE, TRASH_TTL_DAYS,
  $, $$, uid, now, toast,
  normalizeDocument, normalizeFolder, normalizeTag, normalizeTemplate,
  normalizeUI, normalizeSettings
} = U;

/* ---------- State ---------- */

const S = {
  documents: {},
  folders: {},
  tags: {},
  templates: {},
  backlinks: {},          /* targetId → [{fromId, snippet, anchor, at}, ...] */
  ui:       normalizeUI(null),
  settings: normalizeSettings(null),
  activeDocId: null
};

const histories = {};
const futures  = {};

let active       = null;
let slashBlockId = null;
let draggedId    = null;

/* Таймеры */
let saveTimer    = null;
let historyTimer = null;
let backupTimer  = null;
let unsavedTimer = null;

/* ---------- Индикатор сохранения ---------- */

function setStatus(text, state){
  const s = $("#status");
  if (!s) return;
  s.textContent = text;
  if (state) s.dataset.state = state;
  else delete s.dataset.state;
}

function markDirty(){
  setStatus("Изменения…", "dirty");
  clearTimeout(unsavedTimer);
  unsavedTimer = setTimeout(() => {
    const s = $("#status");
    if (s?.dataset.state === "dirty"){
      setStatus("Не сохранено", "unsaved");
    }
  }, 2000);
}

function markSaved(){
  clearTimeout(unsavedTimer);
  setStatus("Сохранено", "saved");
}

function markError(){
  clearTimeout(unsavedTimer);
  setStatus("Ошибка", "error");
}

/* ---------- Активный документ ---------- */

function getActiveDoc(){
  return S.activeDocId ? S.documents[S.activeDocId] : null;
}

function getBlocks(){
  const doc = getActiveDoc();
  return doc ? doc.blocks : [];
}

Object.defineProperty(S, "blocks", {
  get(){ return getBlocks(); },
  set(v){
    const doc = getActiveDoc();
    if (doc) doc.blocks = v;
  },
  configurable: true
});

Object.defineProperty(S, "title", {
  get(){ return getActiveDoc()?.title || ""; },
  set(v){
    const doc = getActiveDoc();
    if (doc) doc.title = String(v || "");
  },
  configurable: true
});

Object.defineProperty(S, "theme", {
  get(){ return S.ui.theme; },
  set(v){ S.ui.theme = v; },
  configurable: true
});

Object.defineProperty(S, "fonts", {
  get(){ return S.ui.fonts; },
  set(v){ S.ui.fonts = v; },
  configurable: true
});

Object.defineProperty(S, "selectedId", {
  get(){ return S.ui.selectedId || null; },
  set(v){ S.ui.selectedId = v; },
  configurable: true
});

Object.defineProperty(S, "selectedRange", {
  get(){ return S.ui.selectedRange || null; },
  set(v){ S.ui.selectedRange = v; },
  configurable: true
});

/* ---------- Setters ---------- */

function setActive(v){ active = v; }
function setSlashBlockId(v){ slashBlockId = v; }
function setDraggedId(v){ draggedId = v; }

/* ---------- Snapshot / история ---------- */

function snapshot(){
  const doc = getActiveDoc();
  if (!doc) return "{}";
  return JSON.stringify({ title: doc.title, blocks: doc.blocks });
}

function ensureHistory(docId){
  if (!histories[docId]) histories[docId] = [];
  if (!futures[docId])   futures[docId]   = [];
}

function pushHistory(before){
  const doc = getActiveDoc();
  if (!doc) return;
  ensureHistory(doc.id);
  const h = histories[doc.id];

  const after = snapshot();
  if (before === after) return;

  h.push(before);
  if (h.length > HISTORY_LIMIT) h.shift();
  futures[doc.id].length = 0;
  save();
}

function commit(before){ pushHistory(before); }

function commitDebounced(before){
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => pushHistory(before), U.INPUT_DEBOUNCE);
}

/* ---------- Хранилище ---------- */

async function load(){
  await DB.init();

  const docs = await DB.listDocuments();
  S.documents = {};
  for (const raw of docs){
    const doc = normalizeDocument(raw);
    if (doc) S.documents[doc.id] = doc;
  }

  const folders = await DB.all("folders");
  S.folders = {};
  for (const raw of folders){
    const f = normalizeFolder(raw);
    if (f) S.folders[f.id] = f;
  }

  const tags = await DB.all("tags");
  S.tags = {};
  for (const raw of tags){
    const t = normalizeTag(raw);
    if (t) S.tags[t.id] = t;
  }

  /* шаблоны */
  const tpls = await DB.listTemplates();
  S.templates = {};
  for (const raw of tpls){
    const t = normalizeTemplate(raw);
    if (t) S.templates[t.id] = t;
  }

  /* backlinks */
  const bl = await DB.getMeta("backlinks");
  S.backlinks = (bl && typeof bl === "object") ? bl : {};

  S.ui       = normalizeUI(await DB.getMeta("ui"));
  S.settings = normalizeSettings(await DB.getMeta("settings"));

  const activeId = await DB.getMeta("activeDocId");
  S.activeDocId  = (activeId && S.documents[activeId]) ? activeId : (Object.keys(S.documents)[0] || null);

  if (!S.activeDocId){
    const doc = normalizeDocument({});
    S.documents[doc.id] = doc;
    S.activeDocId = doc.id;
    await DB.saveDocument(doc);
    await DB.setMeta("activeDocId", doc.id);
  }

  S.ui.selectedId    = null;
  S.ui.selectedRange = null;

  /* Пересобираем backlinks для всех документов после загрузки */
  try {
    for (const id of Object.keys(S.documents)){
      rebuildBacklinks(id);
    }
  } catch(e){
    console.warn("backlinks rebuild failed:", e);
  }
}

function saveNow(){
  const doc = getActiveDoc();
  if (!doc) return;

  /* ПАТЧ 2.3.1: синхронизируем строки со content перед сохранением */
  for (const b of doc.blocks || []){
    if (U.LINE_TYPES && U.LINE_TYPES.has(b.type)){
      U.syncBlockLines(b);
    }
  }

  U.recomputeDocStats(doc);

  DB.saveDocument(doc)
    .then(() => {
      markSaved();
      rebuildBacklinks(doc.id);
    })
    .catch(err => {
      console.error("save error:", err);
      markError();
      toast("Не удалось сохранить документ");
    });

  DB.setMeta("ui", uiSnapshot());
  DB.setMeta("activeDocId", S.activeDocId);
}

function save(){
  clearTimeout(saveTimer);
  markDirty();
  saveTimer = setTimeout(saveNow, S.settings.saveDebounceMs || SAVE_DEBOUNCE);
}

function uiSnapshot(){
  return {
    sidebarOpen:  S.ui.sidebarOpen,
    sidebarWidth: S.ui.sidebarWidth,
    cardMode:     S.ui.cardMode,
    sortMode:     S.ui.sortMode,
    groupMode:    S.ui.groupMode,
    section:      S.ui.section,
    openTabs:     S.ui.openTabs,
    theme:        S.ui.theme,
    fonts:        S.ui.fonts,
    history:      S.ui.history,
    historyIndex: S.ui.historyIndex
  };
}

/* ---------- Undo / Redo ---------- */

function undo(){
  const doc = getActiveDoc();
  if (!doc) return;
  ensureHistory(doc.id);
  const h = histories[doc.id];
  if (!h.length) return;

  futures[doc.id].push(snapshot());
  const restored = JSON.parse(h.pop());
  doc.title  = restored.title  || "";
  doc.blocks = (restored.blocks || []).map(U.normalizeBlock).filter(Boolean);
  if (!doc.blocks.length) doc.blocks = [U.block("text", "")];

  S.ui.selectedId = null;
  S.ui.selectedRange = null;

  window.App.render.render();
  window.App.render.applySavedFonts();
  save();
}

function redo(){
  const doc = getActiveDoc();
  if (!doc) return;
  ensureHistory(doc.id);
  const f = futures[doc.id];
  if (!f.length) return;

  histories[doc.id].push(snapshot());
  const restored = JSON.parse(f.pop());
  doc.title  = restored.title  || "";
  doc.blocks = (restored.blocks || []).map(U.normalizeBlock).filter(Boolean);
  if (!doc.blocks.length) doc.blocks = [U.block("text", "")];

  S.ui.selectedId = null;
  S.ui.selectedRange = null;

  window.App.render.render();
  window.App.render.applySavedFonts();
  save();
}

/* ---------- Selection ---------- */

function setSelectedBlock(id){
  if (S.ui.selectedId === id) return;
  S.ui.selectedId = id;

  $$("#editor .block.selected").forEach(w =>
    w.classList.remove("selected"));

  if (id){
    const w = $(`[data-id="${id}"]`);
    if (w) w.classList.add("selected");
  }
  if (!id) S.ui.selectedRange = null;
}

function setSelectedRange(startId, endId){
  S.ui.selectedRange = (!startId || !endId) ? null : { startId, endId };
  syncInSelectionClass();
}

function clearSelectedRange(){
  if (!S.ui.selectedRange) return;
  S.ui.selectedRange = null;
  syncInSelectionClass();
}

function syncInSelectionClass(){
  const all = $$("#editor .block");
  if (!S.ui.selectedRange){
    all.forEach(w => w.classList.remove("in-selection"));
    return;
  }
  const ids = new Set(blockIdsInRange(S.ui.selectedRange));
  all.forEach(w => {
    w.classList.toggle("in-selection", ids.has(w.dataset.id));
  });
}

function blockIdsInRange(range){
  if (!range) return [];
  const blocks = getBlocks();
  const i = blocks.findIndex(b => b.id === range.startId);
  const j = blocks.findIndex(b => b.id === range.endId);
  if (i < 0 || j < 0) return [];
  const [a, b] = i <= j ? [i, j] : [j, i];
  return blocks.slice(a, b + 1).map(x => x.id);
}

function clearSelection(){
  setSelectedBlock(null);
  clearSelectedRange();
}

/* ============================================================
   CRUD документов
   ============================================================ */

async function createDocument(opts = {}){
  const doc = normalizeDocument({
    title: opts.title || "",
    blocks: opts.blocks || [U.block("text", "")],
    folderId: opts.folderId || null,
    icon: opts.icon || "",
    color: opts.color || ""
  });
  S.documents[doc.id] = doc;
  await DB.saveDocument(doc);
  return doc;
}

async function setActiveDoc(id){
  if (!S.documents[id]) return;
  if (S.activeDocId === id) return;

  const prev = getActiveDoc();
  if (prev){
    for (const b of prev.blocks || []){
      if (U.LINE_TYPES && U.LINE_TYPES.has(b.type)) U.syncBlockLines(b);
    }
    U.recomputeDocStats(prev);
    await DB.saveDocument(prev);
  }

  S.activeDocId = id;
  S.ui.selectedId = null;
  S.ui.selectedRange = null;

  if (!S.ui.openTabs.includes(id)) S.ui.openTabs.push(id);
  pushToHistory(id);

  await DB.setMeta("activeDocId", id);
  await DB.setMeta("ui", uiSnapshot());

  window.App.render.render();
  window.App.render.applySavedFonts();
  window.App.sidebar?.render();
  window.App.tabs?.render();
  window.App.backlinks?.render();
}

async function renameDocument(id, name){
  const doc = S.documents[id];
  if (!doc) return;

  const oldTitle = (doc.title || "").trim();
  const newTitle = String(name || "").slice(0, 200);

  doc.title = newTitle;
  doc.updatedAt = now();

  /* ПАТЧ 2.3.1: автопереименование с поддержкой тройной адресации */
  if (oldTitle && oldTitle !== newTitle){
    const escapedOld = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reNoAnchor   = new RegExp(`\\[\\[\\s*${escapedOld}\\s*\\]\\]`, "g");
    const reWithAnchor = new RegExp(`\\[\\[\\s*${escapedOld}\\s*#([^\\]]+)\\]\\]`, "g");

    const replaceIn = (html) => {
      if (typeof html !== "string") return html;
      let out = html.replace(reWithAnchor, (_, anchor) => `[[${newTitle}#${anchor.trim()}]]`);
      out = out.replace(reNoAnchor, `[[${newTitle}]]`);
      return out;
    };

    for (const other of Object.values(S.documents)){
      if (other.id === id) continue;
      let changed = false;

      for (const b of other.blocks || []){
        if (b.type === "code") continue;

        if (typeof b.content === "string"){
          const next = replaceIn(b.content);
          if (next !== b.content){ b.content = next; changed = true; }
        }
        if (b.type === "table" && Array.isArray(b.rows)){
          for (const row of b.rows){
            for (let i = 0; i < row.length; i++){
              if (typeof row[i] === "string"){
                const next = replaceIn(row[i]);
                if (next !== row[i]){ row[i] = next; changed = true; }
              }
            }
          }
        }
        if (b.type === "columns" && Array.isArray(b.content)){
          for (let i = 0; i < b.content.length; i++){
            if (typeof b.content[i] === "string"){
              const next = replaceIn(b.content[i]);
              if (next !== b.content[i]){ b.content[i] = next; changed = true; }
            }
          }
        }

        /* ПАТЧ 2.3.1: строки */
        if (Array.isArray(b.lines)){
          for (const ln of b.lines){
            if (typeof ln.text === "string"){
              const next = replaceIn(ln.text);
              if (next !== ln.text){ ln.text = next; changed = true; }
            }
          }
        }
      }

      if (changed){
        other.updatedAt = now();
        try { await DB.saveDocument(other); } catch(e){}
      }
    }
  }

  await DB.saveDocument(doc);

  const titleEl = $("#title");
  if (id === S.activeDocId && titleEl && document.activeElement !== titleEl){
    if (titleEl.textContent !== doc.title){
      titleEl.textContent = doc.title;
    }
  }

  for (const other of Object.values(S.documents)){
    try { rebuildBacklinks(other.id); } catch(e){}
  }
  DB.setMeta("backlinks", S.backlinks);

  window.App.sidebar?.render();
  window.App.tabs?.render();
  window.App.backlinks?.render();
}

async function setDocumentField(id, key, value){
  const doc = S.documents[id];
  if (!doc) return;
  doc[key] = value;
  doc.updatedAt = now();
  await DB.saveDocument(doc);
  window.App.sidebar?.render();
  window.App.tabs?.render();
}

async function duplicateDocument(id){
  const src = S.documents[id];
  if (!src) return null;

  /* ПАТЧ 2.3.1: глубокая копия с регенерацией lineId и customId */
  const clone = JSON.parse(JSON.stringify(src));

  /* Перегенерировать lineId (не оставлять те же) */
  if (Array.isArray(clone.blocks)){
    for (const b of clone.blocks){
      if (Array.isArray(b.lines)){
        for (const ln of b.lines){
          ln.id = U.shortId();
          ln.customId = "";
          if (Array.isArray(ln.fragments)){
            ln.fragments = ln.fragments.map(f => ({
              ...f,
              id: U.shortId(),
              customId: ""
            }));
          }
        }
      }
    }
  }

  const copy = normalizeDocument(clone);
  copy.id = uid();
  copy.title = (src.title || "Без названия") + " (копия)";
  copy.createdAt = now();
  copy.updatedAt = now();
  copy.trashed = false;
  copy.trashedAt = null;

  S.documents[copy.id] = copy;
  await DB.saveDocument(copy);
  window.App.sidebar?.render();
  return copy;
}

async function trashDocument(id){
  const doc = S.documents[id];
  if (!doc) return;
  doc.trashed = true;
  doc.trashedAt = now();
  doc.updatedAt = now();
  await DB.saveDocument(doc);

  if (id === S.activeDocId){
    const next = firstAvailableDoc();
    if (next) await setActiveDoc(next.id);
  }

  for (const other of Object.values(S.documents)){
    try { rebuildBacklinks(other.id); } catch(e){}
  }
  DB.setMeta("backlinks", S.backlinks);

  window.App.sidebar?.render();
  window.App.tabs?.render();
  window.App.backlinks?.render();
}

async function restoreDocument(id){
  const doc = S.documents[id];
  if (!doc) return;
  doc.trashed = false;
  doc.trashedAt = null;
  doc.updatedAt = now();
  await DB.saveDocument(doc);
  window.App.sidebar?.render();
  window.App.backlinks?.render();
}

async function purgeDocument(id){
  delete S.documents[id];
  S.ui.openTabs = S.ui.openTabs.filter(x => x !== id);

  delete S.backlinks[id];
  for (const k of Object.keys(S.backlinks)){
    S.backlinks[k] = S.backlinks[k].filter(x => x.fromId !== id);
    if (!S.backlinks[k].length) delete S.backlinks[k];
  }

  await DB.deleteDocument(id);
  await DB.setMeta("backlinks", S.backlinks);
  await DB.setMeta("ui", uiSnapshot());

  if (id === S.activeDocId){
    const next = firstAvailableDoc();
    if (next) await setActiveDoc(next.id);
    else {
      const doc = await createDocument({});
      await setActiveDoc(doc.id);
    }
  }
  window.App.sidebar?.render();
  window.App.tabs?.render();
  window.App.backlinks?.render();
}

async function emptyTrash(){
  const ids = Object.values(S.documents)
    .filter(d => d.trashed)
    .map(d => d.id);
  if (!ids.length) return 0;

  ids.forEach(id => { delete S.documents[id]; delete S.backlinks[id]; });
  for (const k of Object.keys(S.backlinks)){
    S.backlinks[k] = S.backlinks[k].filter(x => !ids.includes(x.fromId));
    if (!S.backlinks[k].length) delete S.backlinks[k];
  }

  await DB.deleteDocuments(ids);
  await DB.setMeta("backlinks", S.backlinks);
  window.App.sidebar?.render();
  return ids.length;
}

async function autoCleanTrash(){
  const ttl = S.settings.trashTtlDays * 24 * 60 * 60 * 1000;
  const t = now();
  const ids = Object.values(S.documents)
    .filter(d => d.trashed && d.trashedAt && (t - d.trashedAt) > ttl)
    .map(d => d.id);
  if (!ids.length) return 0;

  ids.forEach(id => { delete S.documents[id]; delete S.backlinks[id]; });
  for (const k of Object.keys(S.backlinks)){
    S.backlinks[k] = S.backlinks[k].filter(x => !ids.includes(x.fromId));
    if (!S.backlinks[k].length) delete S.backlinks[k];
  }

  await DB.deleteDocuments(ids);
  await DB.setMeta("backlinks", S.backlinks);
  return ids.length;
}

function firstAvailableDoc(){
  const list = Object.values(S.documents)
    .filter(d => !d.trashed)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return list[0] || null;
}

function listDocuments({ section = S.ui.section, folderId = undefined, query = "" } = {}){
  let arr = Object.values(S.documents);

  if (section === "trash"){
    arr = arr.filter(d => d.trashed);
  } else if (section === "archive"){
    arr = arr.filter(d => !d.trashed && d.archived);
  } else {
    arr = arr.filter(d => !d.trashed && !d.archived);
  }

  if (section === "favorite"){
    arr = arr.filter(d => d.favorite);
  }
  if (section === "today"){
    const start = new Date(); start.setHours(0,0,0,0);
    arr = arr.filter(d => d.updatedAt >= start.getTime());
  }
  if (section === "week"){
    const t = now() - 7 * 24 * 60 * 60 * 1000;
    arr = arr.filter(d => d.updatedAt >= t);
  }
  if (section === "earlier"){
    const t = now() - 7 * 24 * 60 * 60 * 1000;
    arr = arr.filter(d => d.updatedAt < t);
  }

  if (folderId !== undefined){
    arr = arr.filter(d => (d.folderId || null) === (folderId || null));
  }

  if (query){
    const q = query.toLowerCase();
    arr = arr.filter(d =>
      (d.title || "").toLowerCase().includes(q) ||
      (d.description || "").toLowerCase().includes(q)
    );
  }

  const mode = S.ui.sortMode;
  arr.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (mode === "created") return b.createdAt - a.createdAt;
    if (mode === "title")   return (a.title || "").localeCompare(b.title || "");
    if (mode === "size")    return (b.charCount || 0) - (a.charCount || 0);
    return b.updatedAt - a.updatedAt;
  });

  return arr;
}

/* ============================================================
   Wikilinks / backlinks
   ============================================================ */

function resolveDocByName(name){
  if (!name) return null;
  const target = String(name).trim().toLowerCase();
  if (!target) return null;

  const matches = Object.values(S.documents).filter(d =>
    !d.trashed && (d.title || "").trim().toLowerCase() === target
  );

  if (!matches.length) return null;

  matches.sort((a, b) => b.updatedAt - a.updatedAt);
  return { doc: matches[0], count: matches.length };
}

/* ПАТЧ 2.3.1: возвращает [{name, blockAnchor, lineAnchor, fragmentAnchor}] */
function extractWikilinksFromBlock(b){
  const out = [];
  if (!b || b.type === "code") return out;

  const pushAll = (html) => {
    U.extractWikilinks(html).forEach(l => out.push(l));
  };

  if (b.type === "table" && Array.isArray(b.rows)){
    for (const row of b.rows){
      for (const cell of row){
        pushAll(cell || "");
      }
    }
  } else if (b.type === "columns" && Array.isArray(b.content)){
    for (const col of b.content){
      pushAll(col || "");
    }
  } else if (Array.isArray(b.lines) && b.lines.length){
    /* ПАТЧ 2.3.1: строки */
    for (const ln of b.lines){
      pushAll(ln.text || "");
    }
  } else if (typeof b.content === "string"){
    pushAll(b.content);
  }
  return out;
}

/* ПАТЧ 2.3.1: собираем анкор-строку для backlink */
function anchorToString(blockAnchor, lineAnchor, fragmentAnchor){
  return [blockAnchor, lineAnchor, fragmentAnchor]
    .filter(Boolean)
    .join("#");
}

/* ПАТЧ 2.3.1: пересобирает backlinks с учётом тройной адресации */
function rebuildBacklinks(docId){
  const doc = S.documents[docId];
  if (!doc) return;

  /* 1. Убираем всё, что было от этого документа */
  for (const targetId of Object.keys(S.backlinks)){
    S.backlinks[targetId] = S.backlinks[targetId].filter(x => x.fromId !== docId);
    if (!S.backlinks[targetId].length) delete S.backlinks[targetId];
  }

  /* 2. Собираем ссылки */
  const links = [];
  for (const b of doc.blocks || []){
    extractWikilinksFromBlock(b).forEach(l => links.push(l));
  }

  /* 3. Резолвим в id и пишем */
  const snippet = (doc.title || "Без названия").slice(0, 80);
  const seen = new Set();

  for (const { name, blockAnchor, lineAnchor, fragmentAnchor } of links){
    const r = resolveDocByName(name);
    if (!r) continue;
    const targetId = r.doc.id;
    if (targetId === docId) continue;

    const anchorStr = anchorToString(blockAnchor, lineAnchor, fragmentAnchor);
    const pairKey = targetId + "\u0000" + anchorStr;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    if (!S.backlinks[targetId]) S.backlinks[targetId] = [];
    S.backlinks[targetId].push({
      fromId:  docId,
      snippet: snippet,
      anchor:  anchorStr,     /* "block#line#fragment" или "" */
      at:      now()
    });
  }
}

function getBacklinks(docId){
  const list = S.backlinks[docId] || [];
  return list
    .map(x => ({ ...x, doc: S.documents[x.fromId] }))
    .filter(x => x.doc && !x.doc.trashed)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

/* ПАТЧ 2.3.1: findUnlinkedMentions — links теперь [{name, blockAnchor,...}] */
function findUnlinkedMentions(docId){
  const doc = S.documents[docId];
  if (!doc) return [];

  const name = (doc.title || "").trim();
  if (!name || name.length < 3) return [];

  const needle = name.toLowerCase();
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "g");

  const out = [];
  for (const other of Object.values(S.documents)){
    if (other.id === docId || other.trashed) continue;

    let count = 0;
    for (const b of other.blocks || []){
      if (b.type === "code") continue;

      const texts = [];
      if (b.type === "table" && Array.isArray(b.rows)){
        for (const row of b.rows) for (const cell of row) texts.push(cell || "");
      } else if (b.type === "columns" && Array.isArray(b.content)){
        for (const col of b.content) texts.push(col || "");
      } else if (Array.isArray(b.lines) && b.lines.length){
        for (const ln of b.lines) texts.push(ln.text || "");
      } else if (typeof b.content === "string"){
        texts.push(b.content);
      }

      for (const html of texts){
        const links = U.extractWikilinks(html);
        if (links.some(l => (l.name || "").trim().toLowerCase() === needle)) continue;

        const plain = U.htmlToText(html).toLowerCase();
        if (!plain) continue;
        const m = plain.match(re);
        if (m) count += m.length;
      }
    }
    if (count > 0) out.push({ doc: other, count });
  }
  return out;
}

/* ============================================================
   ПАТЧ 2.3.1: scrollToAnchorPath — переход к блоку/строке/фрагменту
   ============================================================ */

/* Прокручивает к блоку, строке или фрагменту в указанном документе.
   - blockAnchor: id или customId блока
   - lineAnchor: id или customId строки
   - fragmentAnchor: id фрагмента (этап 2.3.4, пока игнорируется) */
function scrollToAnchorPath(docId, blockAnchor, lineAnchor, fragmentAnchor){
  if (!blockAnchor && !lineAnchor) return;
  const doc = S.documents[docId];
  if (!doc) return;

  /* Ищем блок по customId → id */
  let block = null;
  if (blockAnchor){
    block = (doc.blocks || []).find(b => b.customId && b.customId === blockAnchor);
    if (!block) block = (doc.blocks || []).find(b => b.id === blockAnchor);
  }
  if (!block) return;

  requestAnimationFrame(() => {
    const blockEl = document.querySelector(`#editor .block[data-id="${block.id}"]`);
    if (!blockEl) return;

    let targetEl = blockEl;

    /* Если указана строка — ищем внутри блока */
    if (lineAnchor){
      const lineEl = blockEl.querySelector(`.line[data-line-id="${lineAnchor}"]`);
      if (lineEl) targetEl = lineEl;
    }

    try {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch(e){
      targetEl.scrollIntoView();
    }

    /* Подсветка */
    targetEl.classList.remove("anchor-highlight");
    void targetEl.offsetWidth;
    targetEl.classList.add("anchor-highlight");
    setTimeout(() => targetEl.classList.remove("anchor-highlight"), 1600);
  });
}

/* Обратная совместимость: старая подпись scrollToAnchor(docId, anchor).
   Если anchor содержит # — разбираем как block#line#fragment. */
function scrollToAnchor(docId, anchor){
  if (!anchor) return;
  const parts = String(anchor).split("#").map(p => p.trim());
  return scrollToAnchorPath(docId, parts[0] || "", parts[1] || "", parts[2] || "");
}

/* ---------- История навигации ---------- */

function pushToHistory(id){
  const h = S.ui.history;
  const i = S.ui.historyIndex;
  if (h[i] === id) return;
  h.splice(i + 1);
  h.push(id);
  if (h.length > 100) h.shift();
  S.ui.historyIndex = h.length - 1;
}

function historyBack(){
  const i = S.ui.historyIndex;
  if (i <= 0) return null;
  S.ui.historyIndex = i - 1;
  return S.ui.history[S.ui.historyIndex];
}

function historyForward(){
  const i = S.ui.historyIndex;
  if (i >= S.ui.history.length - 1) return null;
  S.ui.historyIndex = i + 1;
  return S.ui.history[S.ui.historyIndex];
}

/* ---------- UI-настройки ---------- */

function setUI(key, value){
  S.ui[key] = value;
  DB.setMeta("ui", uiSnapshot());
  return S.ui[key];
}

/* ---------- Автобэкап ---------- */

async function maybeBackup(){
  const last = await DB.getMeta("lastBackupAt");
  const every = S.settings.backupEveryHours * 60 * 60 * 1000;
  if (last && (now() - last) < every) return;
  const payload = {
    documents: S.documents,
    folders: S.folders,
    tags: S.tags,
    templates: S.templates,
    backlinks: S.backlinks,
    ui: uiSnapshot()
  };
  try {
    await DB.createBackup(payload);
    await DB.setMeta("lastBackupAt", now());
  } catch(e){
    console.warn("backup error:", e);
  }
}

function startTimers(){
  clearInterval(backupTimer);
  backupTimer = setInterval(async () => {
    try { await maybeBackup(); } catch(e){}
    try { await autoCleanTrash(); } catch(e){}
  }, 60 * 60 * 1000);

  maybeBackup().catch(()=>{});
  autoCleanTrash().catch(()=>{});
}

/* ---------- Public API ---------- */

return {
  S, histories, futures,

  get active(){ return active; },
  get slashBlockId(){ return slashBlockId; },
  get draggedId(){ return draggedId; },

  setActive, setSlashBlockId, setDraggedId,

  getActiveDoc, getBlocks,

  snapshot, pushHistory, commit, commitDebounced,
  save, saveNow, load,
  undo, redo,
  setSelectedBlock, clearSelection,
  setSelectedRange, clearSelectedRange,
  blockIdsInRange,

  createDocument, setActiveDoc, renameDocument, setDocumentField,
  duplicateDocument, trashDocument, restoreDocument, purgeDocument,
  emptyTrash, autoCleanTrash, listDocuments,

  /* wikilinks / backlinks */
  resolveDocByName, rebuildBacklinks, getBacklinks, findUnlinkedMentions,
  /* ПАТЧ 2.2 */
  scrollToAnchor,
  /* ПАТЧ 2.3.1 */
  scrollToAnchorPath,
  anchorToString,

  historyBack, historyForward,
  setUI,
  maybeBackup, startTimers,
  markSaved, markDirty, markError
};

})();