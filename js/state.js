/* ============================================================
   state.js — S, history, undo/redo, storage, selection
   Мультидокументная модель поверх IndexedDB.

   [Пакет 2]  commit привязан к docId, flushPending, _imgStore.
   [Пакет 6]  rebuildBacklinks при create/restore/duplicate;
              renameDocument — escape newTitle, регистронезависимо.
   [Пакет 9]  Object.create(null) для словарей; валидация id.
   [Пакет 11] uiSnapshot; onTabClose/startupMode/autoRename;
              undo темы (theme+fonts в снапшоте).
   [Пакет 12] scrollToAnchorPath — CSS.escape, data-line-anchor;
              convertBlockType.
   [Пакет 13] lines — источник истины; snapshot через stripImages;
              setActiveDoc сохраняет prev только если dirty;
              кэш findUnlinkedMentions; persistent _imgStore.
   [Пакет 14] trash/emptyTrash/autoCleanTrash чистят activeDocId,
              openTabs, history.

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
  normalizeUI, normalizeSettings,
  LINE_TYPES, syncBlockLines
} = U;

/* ============================================================
   [Пакет 9] Object.create(null) — защита от __proto__ атаки
   ============================================================ */

/* Валидация id: разрешаем только безопасные символы */
function _isValidId(id){
  return typeof id === "string"
    && id.length >= 1
    && id.length <= 128
    && /^[a-zA-Z0-9\-_]+$/.test(id)
    && id !== "__proto__"
    && id !== "constructor"
    && id !== "prototype";
}

/* Достаёт значение из безопасного словаря */
function _safeGet(dict, key){
  if (!_isValidId(key)) return undefined;
  return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined;
}

/* Кладёт значение в безопасный словарь */
function _safeSet(dict, key, value){
  if (!_isValidId(key)) return false;
  dict[key] = value;
  return true;
}

/* Безопасное удаление */
function _safeDel(dict, key){
  if (!_isValidId(key)) return false;
  if (!Object.prototype.hasOwnProperty.call(dict, key)) return false;
  delete dict[key];
  return true;
}

/* ---------- State ---------- */

/* [Пакет 9] Все словари через Object.create(null) — нет цепочки прототипов */
const S = {
  documents: Object.create(null),
  folders:   Object.create(null),
  tags:      Object.create(null),
  templates: Object.create(null),
  backlinks: Object.create(null),
  ui:       normalizeUI(null),
  settings: normalizeSettings(null),
  activeDocId: null
};

const histories = Object.create(null);
const futures   = Object.create(null);

let active       = null;
let slashBlockId = null;
let draggedId    = null;

/* Таймеры */
let saveTimer    = null;
let backupTimer  = null;
let unsavedTimer = null;

/* [Пакет 2] отложенный commit привязан к документу */
let _pendingBefore  = null;
let _pendingDocId   = null;
let _pendingTimer   = null;

/* [Пакет 13] dirty-флаг по документу */
const _dirtyDocs = new Set();

/* [Пакет 13] Кэш findUnlinkedMentions: docId → { stamp, data } */
const _mentionsCache = new Map();

/* ---------- Индикатор сохранения ---------- */

function setStatus(text, state){
  const s = $("#status");
  if (!s) return;
  s.textContent = text;
  if (state) s.dataset.state = state;
  else delete s.dataset.state;
}

function markDirty(docId){
  if (docId) _dirtyDocs.add(docId);
  else if (S.activeDocId) _dirtyDocs.add(S.activeDocId);

  setStatus("Изменения…", "dirty");
  clearTimeout(unsavedTimer);
  unsavedTimer = setTimeout(() => {
    const s = $("#status");
    if (s?.dataset.state === "dirty"){
      setStatus("Не сохранено", "unsaved");
    }
  }, 2000);
}

function markSaved(docId){
  if (docId) _dirtyDocs.delete(docId);
  else if (S.activeDocId) _dirtyDocs.delete(S.activeDocId);

  clearTimeout(unsavedTimer);
  setStatus("Сохранено", "saved");
}

function markError(){
  clearTimeout(unsavedTimer);
  setStatus("Ошибка", "error");
}

/* ---------- Активный документ ---------- */

function getActiveDoc(){
  return S.activeDocId ? _safeGet(S.documents, S.activeDocId) : null;
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

/* ============================================================
   [Пакет 13] Snapshot / история — картинки не таскаем в историю.
              _imgStore теперь persistent (DB.store "imgStore").
   ============================================================ */

const _imgStore = new Map();        /* dataUrl → id */
const _imgStoreById = new Map();    /* id → dataUrl */
let _imgStoreLoaded = false;

async function _loadImgStore(){
  if (_imgStoreLoaded) return;
  _imgStoreLoaded = true;
  try {
    const rows = await DB.all("imgStore");
    for (const row of rows || []){
      if (row && typeof row.id === "string" && typeof row.dataUrl === "string"){
        _imgStore.set(row.dataUrl, row.id);
        _imgStoreById.set(row.id, row.dataUrl);
      }
    }
  } catch(e){
    console.warn("imgStore load error:", e);
  }
}

function _imgRef(dataUrl){
  let id = _imgStore.get(dataUrl);
  if (!id){
    id = "img_" + Math.random().toString(36).slice(2, 10);
    _imgStore.set(dataUrl, id);
    _imgStoreById.set(id, dataUrl);
    /* persist — fire and forget */
    DB.put("imgStore", { id, dataUrl }).catch(() => {});
  }
  return id;
}

function _imgByRef(id){
  return _imgStoreById.get(id) || "";
}

function _stripImages(doc){
  if (!doc) return doc;
  const clone = { title: doc.title, blocks: [] };
  for (const b of doc.blocks || []){
    const nb = { ...b };
    if (typeof nb.content === "string" && nb.content.startsWith("data:image/")){
      nb.content = `#img-ref:${_imgRef(nb.content)}`;
    }
    if (Array.isArray(nb.lines)){
      nb.lines = nb.lines.map(ln => {
        if (typeof ln.text === "string" && ln.text.startsWith("data:image/")){
          return { ...ln, text: `#img-ref:${_imgRef(ln.text)}` };
        }
        return ln;
      });
    }
    clone.blocks.push(nb);
  }
  return clone;
}

function _restoreImages(restored){
  if (!restored || !Array.isArray(restored.blocks)) return restored;

  for (const b of restored.blocks){
    if (typeof b.content === "string" && b.content.startsWith("#img-ref:")){
      const id = b.content.slice(9);
      b.content = _imgByRef(id);
    }
    if (Array.isArray(b.lines)){
      b.lines = b.lines.map(ln => {
        if (typeof ln.text === "string" && ln.text.startsWith("#img-ref:")){
          const id = ln.text.slice(9);
          return { ...ln, text: _imgByRef(id) };
        }
        return ln;
      });
    }
  }
  return restored;
}

/* [Пакет 11] snapshot включает theme и fonts */
function snapshot(){
  const doc = getActiveDoc();
  if (!doc) return "{}";
  return JSON.stringify({
    title: doc.title,
    blocks: _stripImages(doc).blocks,
    theme: S.ui.theme,
    fonts: S.ui.fonts ? { ...S.ui.fonts } : {}
  });
}

function snapshotForHistory(){
  return snapshot();
}

function ensureHistory(docId){
  if (!histories[docId]) histories[docId] = [];
  if (!futures[docId])   futures[docId]   = [];
}

function _pushHistoryFor(docId, beforeRaw){
  if (!histories[docId]) histories[docId] = [];
  if (!futures[docId])   futures[docId]   = [];

  const doc = _safeGet(S.documents, docId);
  if (!doc) return;

  const afterRaw = JSON.stringify({
    title: doc.title,
    blocks: _stripImages(doc).blocks,
    theme: S.ui.theme,
    fonts: S.ui.fonts ? { ...S.ui.fonts } : {}
  });

  if (beforeRaw === afterRaw) return;

  const h = histories[docId];
  h.push(beforeRaw);
  if (h.length > HISTORY_LIMIT) h.shift();
  futures[docId].length = 0;
}

function commit(before){
  const doc = getActiveDoc();
  if (!doc) return;
  _pushHistoryFor(doc.id, before);
  _pendingBefore = null;
  _pendingDocId  = null;
  clearTimeout(_pendingTimer);
  save();
}

function commitDebounced(before){
  const doc = getActiveDoc();
  if (!doc) return;

  if (_pendingDocId && _pendingDocId !== doc.id){
    flushPending();
  }

  if (_pendingBefore === null){
    _pendingBefore = before;
    _pendingDocId  = doc.id;
  }

  clearTimeout(_pendingTimer);
  _pendingTimer = setTimeout(flushPending, U.INPUT_DEBOUNCE);
}

function flushPending(){
  clearTimeout(_pendingTimer);
  _pendingTimer = null;

  if (_pendingBefore === null || !_pendingDocId){
    _pendingBefore = null;
    _pendingDocId = null;
    return;
  }

  const docId  = _pendingDocId;
  const before = _pendingBefore;

  _pendingBefore = null;
  _pendingDocId = null;

  _pushHistoryFor(docId, before);
  save();
}

/* ============================================================
   [Пакет 13] lines — источник истины, content — вычисляемое
   ============================================================ */

function _normalizeBlockSources(doc){
  if (!doc) return;
  for (const b of doc.blocks || []){
    if (LINE_TYPES.has(b.type)){
      if (!Array.isArray(b.lines) || !b.lines.length){
        syncBlockLines(b);
      }
    }
  }
}

/* ============================================================
   [Пакет 12] Конвертер типов блоков
   Меняет b.type, перенося содержимое:
     - в LINE_TYPES:  b.lines[0].text ← текущий HTML
     - в ul/ol:       HTML разбивается на <li> по строкам
     - в table:       HTML остаётся текстом первой ячейки
     - из ul/ol в text:  <li> разворачиваются в <br>-joined строки
   ============================================================ */

function convertBlockType(b, newType){
  if (!b || !newType) return;
  const oldType = b.type;
  if (oldType === newType) return;

  /* Собираем текущее HTML-содержимое блока */
  let html = "";
  if (LINE_TYPES.has(oldType)){
    if (Array.isArray(b.lines) && b.lines.length){
      html = b.lines.map(l => l.text || "").join("<br>");
    } else {
      html = typeof b.content === "string" ? b.content : "";
    }
  } else if (oldType === "ul" || oldType === "ol"){
    html = typeof b.content === "string" ? b.content : "";
  } else if (oldType === "table"){
    if (Array.isArray(b.rows)){
      html = b.rows.map(row => row.map(c => c || "").join(" ")).join("<br>");
    }
  } else if (oldType === "columns"){
    if (Array.isArray(b.content)){
      html = b.content.filter(Boolean).join("<br>");
    }
  } else {
    html = typeof b.content === "string" ? b.content : "";
  }

  b.type = newType;

  /* Заполняем поля нового типа */
  if (LINE_TYPES.has(newType)){
    b.lines = [ U.line(html) ];
    b.content = html;
    b.rows = null;
    b.cols = null;
    b.widths = null;
    b.gap = null;
  } else if (newType === "ul" || newType === "ol"){
    /* Из HTML вытаскиваем список: <li>...</li> либо разбиваем по <br> */
    const tmpl = document.createElement("div");
    tmpl.innerHTML = html || "";
    let lis = [...tmpl.querySelectorAll("li")];
    if (!lis.length){
      /* Нет <li> — делаем один <li> с содержимым */
      lis = [];
      const parts = (tmpl.innerHTML || "").split(/<br\s*\/?>/i);
      for (const p of parts){
        lis.push({ innerHTML: p });
      }
    }
    b.content = lis.map(li => `<li>${li.innerHTML || "<br>"}</li>`).join("") || "<li><br></li>";
    b.lines = [];
    b.rows = null;
    b.cols = null;
    if (newType === "ul" && !b.marker) b.marker = "disc";
  } else if (newType === "table"){
    /* Простейшее: весь HTML в первую ячейку, остальные пустые */
    const plain = U.htmlToText(html || "");
    b.rows = [[plain, ""], ["", ""]];
    b.content = "";
    b.lines = [];
  } else if (newType === "columns"){
    const plain = html || "";
    b.cols = b.cols || 2;
    b.content = [plain, ""];
    while (b.content.length < b.cols) b.content.push("");
    b.widths = Array(b.cols).fill(1 / b.cols);
    b.gap = 14;
    b.valign = "top";
    b.lines = [];
    b.rows = null;
  } else if (newType === "code"){
    b.content = U.htmlToText(html || "");
    b.lines = [];
    b.rows = null;
    b.cols = null;
  } else {
    /* text/h1/h2/h3/quote/divider/image — простые */
    b.content = typeof html === "string" ? html : "";
    b.lines = [];
    b.rows = null;
    b.cols = null;
  }

  /* Сброс полей, которые не применимы */
  if (newType !== "divider" && newType !== "image"){
    b.checked = false;
  }
}

/* ============================================================
   Хранилище
   ============================================================ */

async function load(){
  await DB.init();
  await _loadImgStore();

  const docs = await DB.listDocuments();
  S.documents = Object.create(null);
  for (const raw of docs){
    const doc = normalizeDocument(raw);
    if (doc && _isValidId(doc.id)){
      _normalizeBlockSources(doc);
      _safeSet(S.documents, doc.id, doc);
    }
  }

  const folders = await DB.all("folders");
  S.folders = Object.create(null);
  for (const raw of folders){
    const f = normalizeFolder(raw);
    if (f && _isValidId(f.id)) _safeSet(S.folders, f.id, f);
  }

  const tags = await DB.all("tags");
  S.tags = Object.create(null);
  for (const raw of tags){
    const t = normalizeTag(raw);
    if (t && _isValidId(t.id)) _safeSet(S.tags, t.id, t);
  }

  const tpls = await DB.listTemplates();
  S.templates = Object.create(null);
  for (const raw of tpls){
    const t = normalizeTemplate(raw);
    if (t && _isValidId(t.id)) _safeSet(S.templates, t.id, t);
  }

  const bl = await DB.getMeta("backlinks");
  S.backlinks = Object.create(null);
  if (bl && typeof bl === "object" && !Array.isArray(bl)){
    for (const k of Object.keys(bl)){
      if (_isValidId(k)) S.backlinks[k] = bl[k];
    }
  }

  S.ui       = normalizeUI(await DB.getMeta("ui"));
  S.settings = normalizeSettings(await DB.getMeta("settings"));

  const activeId = await DB.getMeta("activeDocId");
  S.activeDocId  = (_isValidId(activeId) && _safeGet(S.documents, activeId))
    ? activeId
    : (Object.keys(S.documents)[0] || null);

  if (!S.activeDocId){
    const doc = normalizeDocument({});
    S.documents[doc.id] = doc;
    S.activeDocId = doc.id;
    await DB.saveDocument(doc);
    await DB.setMeta("activeDocId", doc.id);
  }

  S.ui.selectedId    = null;
  S.ui.selectedRange = null;

  try {
    for (const id of Object.keys(S.documents)){
      rebuildBacklinks(id);
    }
  } catch(e){
    console.warn("backlinks rebuild failed:", e);
  }
}

function saveNow(docId){
  const id = docId || S.activeDocId;
  const doc = _safeGet(S.documents, id);
  if (!doc) return;

  for (const b of doc.blocks || []){
    if (LINE_TYPES.has(b.type)){
      syncBlockLines(b);
    }
  }

  U.recomputeDocStats(doc);

  DB.saveDocument(doc)
    .then(() => {
      markSaved(doc.id);
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
  markDirty(S.activeDocId);
  saveTimer = setTimeout(() => saveNow(), S.settings.saveDebounceMs || SAVE_DEBOUNCE);
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
    historyIndex: S.ui.historyIndex,
    showPreview:      S.ui.showPreview,
    showDate:         S.ui.showDate,
    hidePreview:      S.ui.hidePreview,
    newDocFolder:     S.ui.newDocFolder,
    onTabClose:       S.ui.onTabClose,
    startupMode:      S.ui.startupMode,
    autoRename:       S.ui.autoRename,
    backlinksExpanded:S.ui.backlinksExpanded,
    showHiddenTemplates: S.ui.showHiddenTemplates
  };
}

/* ============================================================
   [Пакет 11] Undo/Redo — тема и шрифты тоже откатываются
   ============================================================ */

function _applyRestoredUI(restored){
  if (!restored) return;
  if (typeof restored.theme === "string"){
    S.ui.theme = restored.theme;
    document.documentElement.dataset.theme =
      S.ui.theme === "paper" ? "" : S.ui.theme;
  }
  if (restored.fonts && typeof restored.fonts === "object"){
    S.ui.fonts = { ...restored.fonts };
    window.App.render?.applySavedFonts?.();
  }
}

function undo(){
  flushPending();

  const doc = getActiveDoc();
  if (!doc) return;
  ensureHistory(doc.id);
  const h = histories[doc.id];
  if (!h.length) return;

  futures[doc.id].push(snapshot());
  const restored = _restoreImages(JSON.parse(h.pop()));

  doc.title  = restored.title  || "";
  doc.blocks = (restored.blocks || []).map(U.normalizeBlock).filter(Boolean);
  if (!doc.blocks.length) doc.blocks = [U.block("text", "")];
  _normalizeBlockSources(doc);
  _applyRestoredUI(restored);

  S.ui.selectedId = null;
  S.ui.selectedRange = null;
  markDirty(doc.id);

  window.App.render.render();
  save();
}

function redo(){
  flushPending();

  const doc = getActiveDoc();
  if (!doc) return;
  ensureHistory(doc.id);
  const f = futures[doc.id];
  if (!f.length) return;

  histories[doc.id].push(snapshot());
  const restored = _restoreImages(JSON.parse(f.pop()));

  doc.title  = restored.title  || "";
  doc.blocks = (restored.blocks || []).map(U.normalizeBlock).filter(Boolean);
  if (!doc.blocks.length) doc.blocks = [U.block("text", "")];
  _normalizeBlockSources(doc);
  _applyRestoredUI(restored);

  S.ui.selectedId = null;
  S.ui.selectedRange = null;
  markDirty(doc.id);

  window.App.render.render();
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
  if (!_isValidId(doc.id)){
    console.error("[state] invalid doc id, regenerating:", doc.id);
    doc.id = uid();
  }
  _safeSet(S.documents, doc.id, doc);
  await DB.saveDocument(doc);
  try { rebuildBacklinks(doc.id); } catch(e){}
  return doc;
}

async function setActiveDoc(id){
  if (!_safeGet(S.documents, id)) return;
  if (S.activeDocId === id) return;

  flushPending();

  const prev = getActiveDoc();
  if (prev){
    for (const b of prev.blocks || []){
      if (LINE_TYPES.has(b.type)) syncBlockLines(b);
    }
    U.recomputeDocStats(prev);

    if (_dirtyDocs.has(prev.id)){
      try {
        await DB.saveDocument(prev);
        markSaved(prev.id);
      } catch(e){ console.warn("save prev error:", e); }
    }
  }

  S.activeDocId = id;
  S.ui.selectedId = null;
  S.ui.selectedRange = null;

  if (!S.ui.openTabs.includes(id)) S.ui.openTabs.push(id);
  pushToHistory(id);

  await DB.setMeta("activeDocId", id);
  await DB.setMeta("ui", uiSnapshot());

  /* [Пакет 11] авто-переименование из первой строки, если включено */
  _maybeAutoRename(S.documents[id]);

  window.App.render.render();
  window.App.render.applySavedFonts();
  window.App.sidebar?.render();
  window.App.tabs?.render();
  window.App.backlinks?.render();
}

/* [Пакет 11] Автопереименование: если autoRename и пустой title — взять первую строку */
function _maybeAutoRename(doc){
  if (!doc) return;
  if (S.ui.autoRename === false) return;
  if ((doc.title || "").trim()) return;

  let first = "";
  for (const b of doc.blocks || []){
    if (!LINE_TYPES.has(b.type) && b.type !== "ul" && b.type !== "ol") continue;
    const txt = U.getBlockText(b).trim();
    if (txt){ first = txt.split("\n")[0].trim(); break; }
  }
  if (!first) return;
  if (first.length > 80) first = first.slice(0, 80);
  doc.title = first;
  DB.saveDocument(doc).catch(() => {});
}

async function renameDocument(id, name, prevTitle){
  const doc = _safeGet(S.documents, id);
  if (!doc) return;

  const oldTitle = (prevTitle !== undefined
    ? String(prevTitle == null ? "" : prevTitle)
    : String(doc.title || "")
  ).trim();

  const newTitle = String(name || "").slice(0, 200);

  doc.title = newTitle;
  doc.updatedAt = now();
  markDirty(doc.id);

  if (oldTitle && newTitle && oldTitle.toLowerCase() !== newTitle.toLowerCase()){
    const escapedOld = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reNoAnchor   = new RegExp(`\\[\\[\\s*${escapedOld}\\s*\\]\\]`, "gi");
    const reWithAnchor = new RegExp(`\\[\\[\\s*${escapedOld}\\s*#([^\\]]+)\\]\\]`, "gi");

    const replaceIn = (html) => {
      if (typeof html !== "string") return html;
      let out = html.replace(reWithAnchor, (_, anchor) =>
        `[[${newTitle}#${anchor.trim()}]]`);
      out = out.replace(reNoAnchor, () => `[[${newTitle}]]`);
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
        markDirty(other.id);
        try { await DB.saveDocument(other); markSaved(other.id); } catch(e){}
      }
    }
  }

  await DB.saveDocument(doc);
  markSaved(doc.id);

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
  const doc = _safeGet(S.documents, id);
  if (!doc) return;
  doc[key] = value;
  doc.updatedAt = now();
  markDirty(doc.id);
  await DB.saveDocument(doc);
  markSaved(doc.id);
  window.App.sidebar?.render();
  window.App.tabs?.render();
}

async function duplicateDocument(id){
  const src = _safeGet(S.documents, id);
  if (!src) return null;

  const clone = JSON.parse(JSON.stringify(src));

  if (Array.isArray(clone.blocks)){
    for (const b of clone.blocks){
      if (b.customId) b.customId = "";
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

  _safeSet(S.documents, copy.id, copy);
  await DB.saveDocument(copy);
  try { rebuildBacklinks(copy.id); } catch(e){}
  window.App.sidebar?.render();
  return copy;
}

/* ============================================================
   [Пакет 14] Корзина и activeDocId
   ============================================================ */

function _cleanupDocFromMemory(id){
  _safeDel(S.documents, id);
  S.ui.openTabs = (S.ui.openTabs || []).filter(x => x !== id);
  S.ui.history  = (S.ui.history || []).filter(x => x !== id);
  if (S.ui.historyIndex >= S.ui.history.length) S.ui.historyIndex = S.ui.history.length - 1;
  _dirtyDocs.delete(id);
  _mentionsCache.delete(id);

  delete S.backlinks[id];
  for (const k of Object.keys(S.backlinks)){
    S.backlinks[k] = S.backlinks[k].filter(x => x.fromId !== id);
    if (!S.backlinks[k].length) delete S.backlinks[k];
  }
}

async function _fallbackAfterRemoval(id){
  if (id !== S.activeDocId) return;
  const next = firstAvailableDoc();
  if (next){
    S.activeDocId = null;
    await setActiveDoc(next.id);
  } else {
    const doc = await createDocument({});
    S.activeDocId = null;
    await setActiveDoc(doc.id);
  }
}

/* [Пакет 11] onTabClose: "keep" | "archive" | "trash" */
async function _applyOnTabClose(docId){
  const mode = S.ui.onTabClose || "keep";
  if (mode === "keep") return;
  const doc = _safeGet(S.documents, docId);
  if (!doc) return;
  if (mode === "archive"){
    doc.archived = true;
    doc.updatedAt = now();
    await DB.saveDocument(doc);
  } else if (mode === "trash"){
    await trashDocument(docId);
  }
}

async function trashDocument(id){
  const doc = _safeGet(S.documents, id);
  if (!doc) return;
  doc.trashed = true;
  doc.trashedAt = now();
  doc.updatedAt = now();
  markDirty(doc.id);
  await DB.saveDocument(doc);
  markSaved(doc.id);

  if (id === S.activeDocId){
    S.activeDocId = null;
    await _fallbackAfterRemoval(id);
  }

  for (const other of Object.values(S.documents)){
    try { rebuildBacklinks(other.id); } catch(e){}
  }
  DB.setMeta("backlinks", S.backlinks);
  _mentionsCache.clear();

  window.App.sidebar?.render();
  window.App.tabs?.render();
  window.App.backlinks?.render();
}

async function restoreDocument(id){
  const doc = _safeGet(S.documents, id);
  if (!doc) return;
  doc.trashed = false;
  doc.trashedAt = null;
  doc.updatedAt = now();
  markDirty(doc.id);
  await DB.saveDocument(doc);
  markSaved(doc.id);

  try { rebuildBacklinks(id); } catch(e){}
  for (const other of Object.values(S.documents)){
    try { rebuildBacklinks(other.id); } catch(e){}
  }
  DB.setMeta("backlinks", S.backlinks);
  _mentionsCache.clear();

  window.App.sidebar?.render();
  window.App.tabs?.render();
  window.App.backlinks?.render();
}

async function purgeDocument(id){
  _cleanupDocFromMemory(id);

  await DB.deleteDocument(id);
  await DB.setMeta("backlinks", S.backlinks);
  await DB.setMeta("ui", uiSnapshot());

  if (id === S.activeDocId){
    S.activeDocId = null;
    await _fallbackAfterRemoval(id);
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

  for (const id of ids) _cleanupDocFromMemory(id);

  await DB.deleteDocuments(ids);
  await DB.setMeta("backlinks", S.backlinks);
  await DB.setMeta("ui", uiSnapshot());

  if (!S.activeDocId || !S.documents[S.activeDocId]){
    S.activeDocId = null;
    await _fallbackAfterRemoval(null);
  }

  window.App.sidebar?.render();
  window.App.tabs?.render();
  return ids.length;
}

async function autoCleanTrash(){
  const ttl = S.settings.trashTtlDays * 24 * 60 * 60 * 1000;
  const t = now();
  const ids = Object.values(S.documents)
    .filter(d => d.trashed && d.trashedAt && (t - d.trashedAt) > ttl)
    .map(d => d.id);
  if (!ids.length) return 0;

  for (const id of ids) _cleanupDocFromMemory(id);

  await DB.deleteDocuments(ids);
  await DB.setMeta("backlinks", S.backlinks);
  await DB.setMeta("ui", uiSnapshot());

  if (!S.activeDocId || !S.documents[S.activeDocId]){
    S.activeDocId = null;
    await _fallbackAfterRemoval(null);
  }
  return ids.length;
}

function firstAvailableDoc(){
  const list = Object.values(S.documents)
    .filter(d => !d.trashed)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return list[0] || null;
}

/* [Пакет 11] startupMode: "last" | "list" */
function _applyStartupMode(){
  const mode = S.ui.startupMode || "last";
  if (mode === "list"){
    S.ui.section = "all";
  }
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
    for (const ln of b.lines){
      pushAll(ln.text || "");
    }
  } else if (typeof b.content === "string"){
    pushAll(b.content);
  }
  return out;
}

function anchorToString(blockAnchor, lineAnchor, fragmentAnchor){
  return [blockAnchor, lineAnchor, fragmentAnchor]
    .filter(Boolean)
    .join("#");
}

function rebuildBacklinks(docId){
  const doc = _safeGet(S.documents, docId);
  if (!doc) return;

  for (const targetId of Object.keys(S.backlinks)){
    S.backlinks[targetId] = S.backlinks[targetId].filter(x => x.fromId !== docId);
    if (!S.backlinks[targetId].length) delete S.backlinks[targetId];
  }

  const links = [];
  for (const b of doc.blocks || []){
    extractWikilinksFromBlock(b).forEach(l => links.push(l));
  }

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
      anchor:  anchorStr,
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

/* [Пакет 13] findUnlinkedMentions — кэш по updatedAt */
function findUnlinkedMentions(docId){
  const doc = _safeGet(S.documents, docId);
  if (!doc) return [];

  const name = (doc.title || "").trim();
  if (!name || name.length < 3) return [];

  /* Кэш-хит */
  const stamp = doc.updatedAt || 0;
  const cached = _mentionsCache.get(docId);
  if (cached && cached.stamp === stamp){
    return cached.data;
  }

  const needle = name.toLowerCase();
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu");
  } catch(e){
    re = new RegExp(`\\b${escaped}\\b`, "g");
  }

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

  _mentionsCache.set(docId, { stamp, data: out });
  return out;
}

/* ============================================================
   [Пакет 12] scrollToAnchorPath — CSS.escape + data-line-anchor
   ============================================================ */

function _cssEscape(s){
  if (window.CSS && typeof CSS.escape === "function"){
    return CSS.escape(String(s));
  }
  return String(s).replace(/[^a-zA-Z0-9\-_]/g, "\\$&");
}

function scrollToAnchorPath(docId, blockAnchor, lineAnchor, fragmentAnchor){
  if (!blockAnchor && !lineAnchor) return;
  const doc = _safeGet(S.documents, docId);
  if (!doc) return;

  let block = null;
  if (blockAnchor){
    block = (doc.blocks || []).find(b => b.customId && b.customId === blockAnchor);
    if (!block) block = (doc.blocks || []).find(b => b.id === blockAnchor);
  }
  if (!block) return;

  requestAnimationFrame(() => {
    const blockEl = document.querySelector(
      `#editor .block[data-id="${_cssEscape(block.id)}"]`
    );
    if (!blockEl) return;

    let targetEl = blockEl;

    if (lineAnchor){
      const esc = _cssEscape(lineAnchor);
      const lineEl =
        blockEl.querySelector(`.line[data-line-id="${esc}"]`) ||
        blockEl.querySelector(`.line[data-line-anchor="${esc}"]`);
      if (lineEl) targetEl = lineEl;
    }

    try {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch(e){
      targetEl.scrollIntoView();
    }

    targetEl.classList.remove("anchor-highlight");
    void targetEl.offsetWidth;
    targetEl.classList.add("anchor-highlight");
    setTimeout(() => targetEl.classList.remove("anchor-highlight"), 1600);
  });
}

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

function _isAlive(id){
  const doc = _safeGet(S.documents, id);
  return !!doc && !doc.trashed;
}

function historyBack(){
  let i = S.ui.historyIndex;
  while (i > 0){
    i--;
    const id = S.ui.history[i];
    if (_isAlive(id)){
      S.ui.historyIndex = i;
      return id;
    }
  }
  return null;
}

function historyForward(){
  let i = S.ui.historyIndex;
  while (i < S.ui.history.length - 1){
    i++;
    const id = S.ui.history[i];
    if (_isAlive(id)){
      S.ui.historyIndex = i;
      return id;
    }
  }
  return null;
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

  snapshot, snapshotForHistory,
  commit, commitDebounced, flushPending,
  save, saveNow, load,
  undo, redo,
  setSelectedBlock, clearSelection,
  setSelectedRange, clearSelectedRange,
  blockIdsInRange,

  createDocument, setActiveDoc, renameDocument, setDocumentField,
  duplicateDocument, trashDocument, restoreDocument, purgeDocument,
  emptyTrash, autoCleanTrash, listDocuments,

  /* [Пакет 12] конвертер типов */
  convertBlockType,

  /* [Пакет 11] применить startupMode */
  applyStartupMode: _applyStartupMode,

  /* [Пакет 11] автопереименование из текста */
  maybeAutoRename: _maybeAutoRename,

  resolveDocByName, rebuildBacklinks, getBacklinks, findUnlinkedMentions,
  scrollToAnchor,
  scrollToAnchorPath,
  anchorToString,

  historyBack, historyForward,
  setUI,
  maybeBackup, startTimers,
  markSaved, markDirty, markError,

  /* helpers для интеграции */
  isValidId: _isValidId
};

})();