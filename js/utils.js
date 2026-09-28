/* ============================================================
   utils.js — константы, хелперы, sanitizer, нормализация
   ============================================================ */

window.App = window.App || {};

window.App.utils = (() => {
"use strict";

const KEY = "paper-notebook-v1";
const HISTORY_LIMIT = 80;
const INPUT_DEBOUNCE = 400;
const SAVE_DEBOUNCE  = 150;
const MAX_IMG_BYTES  = 3 * 1024 * 1024;
const TRASH_TTL_DAYS = 30;

const types = [
  ["text",    "Текст",         "Обычный абзац"],
  ["h1",      "Заголовок 1",   "Большой заголовок"],
  ["h2",      "Заголовок 2",   "Заголовок"],
  ["h3",      "Заголовок 3",   "Маленький заголовок"],
  ["ul",      "Маркеры",       "Маркированный список"],
  ["ol",      "Нумерованный",  "Нумерованный список"],
  ["todo",    "Чек-лист",      "Задача"],
  ["quote",   "Цитата",        "Выделенный текст"],
  ["code",    "Код",           "Моноширинный блок"],
  ["table",   "Таблица",       "Интерактивная таблица"],
  ["columns", "Колонки",       "2–4 колонки"],
  ["divider", "Разделитель",   "Горизонтальная линия"],
  ["image",   "Изображение",   "Перетащить файл"]
];

const VALID_TYPES  = new Set(types.map(t => t[0]));
const VALID_BG     = new Set(["","soft","warm","rose","sky","lilac","mint","sand"]);
const VALID_FONT   = new Set(["","sans","serif","mono"]);
const VALID_INDENT = new Set([0,1,2,3]);
const VALID_ALIGN  = new Set(["left","center","right"]);
const VALID_MARKER = new Set(["disc","circle","square","diamond","dot","arrow"]);
/* ПАТЧ 2.1 */
const VALID_VALIGN = new Set(["top","center","bottom"]);
/* ПАТЧ 2.2 */
const VALID_LINE_NUMBER_FORMATS = new Set(["1.","1)","#1","L1"]);

const EMOJI_PRESETS = ["📝","📔","📚","💡","⭐","✅","🎯","🍳","✈️","💼","🎨","🔬","🏠","❤️","⚡"];
const COLOR_PRESETS = ["#829b91","#a78663","#c46a63","#c98a3c","#8a7bc4","#6a8dc4","#5fa57a","#7a7a7a"];

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- Время / id ---------- */

/* ПАТЧ 2.1: короткий base36-идентификатор для блоков (6 символов).
   Для документов/папок/тегов/шаблонов оставляем криптослучайный UUID. */
function shortId(){
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 6; i++) s += chars[arr[i] % 36];
  return s;
}

function uid(){
  return (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "b-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function now(){
  return Date.now();
}

/* ---------- Хелперы ---------- */

function escape(s){
  return String(s).replace(/[&<>"]/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"
  }[c]));
}

function el(tag, cls = ""){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function isArrayOfArrays(x){
  return Array.isArray(x) && x.every(r => Array.isArray(r));
}

/* ---------- Валидация анкора (ПАТЧ 2.2) ---------- */

/* Разрешённые символы: a-z, 0-9, дефис, подчёркивание. До 64 символов.
   Если приходит мусор — очищаем. */
function sanitizeAnchor(str){
  if (typeof str !== "string") return "";
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, "")
    .slice(0, 64);
}

/* ПАТЧ 2.1: block() использует shortId(), добавлены поля колонок.
   ПАТЧ 2.2: добавлены customId, lineNumber, blockMarker, blockMarkerColor. */
function block(type = "text", content = ""){
  const b = {
    id: shortId(),
    type: VALID_TYPES.has(type) ? type : "text",
    content: typeof content === "string" ? content : "",
    checked: false,
    rows: null,
    cols: null,
    bg: "",
    font: "",
    indent: 0,
    align: "left",
    offsetX: 0,
    marker: "disc",
    /* ПАТЧ 2.1 — поля для columns */
    widths:  null,
    gap:     null,
    valign:  "top",
    padding: 0,
    /* ПАТЧ 2.2 — ID, нумерация, маркер блока */
    customId: "",
    lineNumber: null,
    blockMarker: "",
    blockMarkerColor: ""
  };
  if (b.type === "table")   b.rows = [["",""],["",""]];
  if (b.type === "columns"){
    b.cols = 2;
    b.content = ["", ""];
    b.widths = [1, 1];
    b.gap = 14;
  }
  return b;
}

function toast(s){
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = s;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1400);
}

/* ---------- Sanitizer ---------- */

const ALLOWED_TAGS = new Set([
  "b","strong","i","em","u","s","strike","del","ins","mark",
  "code","br","span","a","p",
  "h1","h2","h3","h4","h5","h6",
  "ul","ol","li","blockquote","pre","hr",
  "table","thead","tbody","tr","td","th",
  "font"
]);

const ALLOWED_ATTRS = {
  a: ["href","class","data-wikilink","data-wikilink-anchor","data-wikilink-id","title"],
  span: ["class","data-checked"],
  p: [],
  td: ["colspan","rowspan"],
  th: ["colspan","rowspan"],
  font: ["face"]
};

function sanitize(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  tmp.querySelectorAll(
    "script,style,meta,link,iframe,object,embed,noscript,o\\:p"
  ).forEach(n => n.remove());

  const walk = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE){
        const tag = child.tagName.toLowerCase();

        if (!ALLOWED_TAGS.has(tag)){
          const frag = document.createDocumentFragment();
          while (child.firstChild) frag.append(child.firstChild);
          child.replaceWith(frag);
          walk(node);
          return;
        }

        const allowed = ALLOWED_ATTRS[tag] || [];
        [...child.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          if (!allowed.includes(name)) child.removeAttribute(attr.name);
        });

        if (tag === "a"){
          const isWikilink = child.classList.contains("wikilink");
          const href = child.getAttribute("href") || "";
          if (isWikilink){
            child.removeAttribute("target");
            child.removeAttribute("rel");
          } else if (/^(https?:|mailto:)/i.test(href)){
            child.setAttribute("target","_blank");
            child.setAttribute("rel","noopener noreferrer");
          } else {
            child.removeAttribute("href");
          }
        }

        walk(child);
      } else if (child.nodeType === Node.COMMENT_NODE){
        child.remove();
      }
    });
  };
  walk(tmp);

  return tmp.innerHTML;
}

/* ---------- Нормализация блоков ---------- */

function normalizeBlock(raw){
  if (!raw || typeof raw !== "object") return null;

  /* ПАТЧ 2.1: если у старого блока id не короткий (UUID) — оставляем как есть.
     Новые получают shortId() при создании через block(). */
  const b = {
    id: typeof raw.id === "string" && raw.id ? raw.id : shortId(),
    type: VALID_TYPES.has(raw.type) ? raw.type : "text",
    content: raw.content,
    checked: !!raw.checked,
    rows: null,
    cols: null,
    bg: VALID_BG.has(raw.bg) ? raw.bg : "",
    font: VALID_FONT.has(raw.font) ? raw.font : "",
    indent: VALID_INDENT.has(raw.indent) ? raw.indent : 0,
    align: VALID_ALIGN.has(raw.align) ? raw.align : "left",
    offsetX: Number.isFinite(raw.offsetX) ? raw.offsetX : 0,
    marker: VALID_MARKER.has(raw.marker) ? raw.marker : "disc",
    /* ПАТЧ 2.1 */
    widths:  null,
    gap:     null,
    valign:  VALID_VALIGN.has(raw.valign) ? raw.valign : "top",
    padding: Number.isFinite(raw.padding) ? Math.max(0, Math.min(64, raw.padding)) : 0,
    /* ПАТЧ 2.2 */
    customId: sanitizeAnchor(raw.customId),
    lineNumber: Number.isFinite(raw.lineNumber) && raw.lineNumber > 0
      ? Math.floor(raw.lineNumber)
      : null,
    blockMarker: (typeof raw.blockMarker === "string")
      ? raw.blockMarker.slice(0, 4)
      : "",
    blockMarkerColor: (typeof raw.blockMarkerColor === "string")
      ? raw.blockMarkerColor.slice(0, 32)
      : ""
  };

  if (b.type === "table"){
    b.rows = isArrayOfArrays(raw.rows) && raw.rows.length
      ? raw.rows.map(r => r.map(v => typeof v === "string" ? v : String(v ?? "")))
      : [["",""],["",""]];
    b.content = "";
  }
  else if (b.type === "columns"){
    const n = [2,3,4].includes(raw.cols) ? raw.cols : 2;
    const arr = Array.isArray(raw.content) ? raw.content.slice(0, n) : [];
    while (arr.length < n) arr.push("");
    b.cols = n;
    b.content = arr.map(v => typeof v === "string" ? v : "");

    /* ПАТЧ 2.1: widths — нормализуем к 1 */
    let widths = Array.isArray(raw.widths) ? raw.widths.slice(0, n) : [];
    while (widths.length < n) widths.push(1);
    widths = widths.map(w => (Number.isFinite(w) && w > 0) ? w : 1);
    const sum = widths.reduce((a, w) => a + w, 0) || 1;
    b.widths = widths.map(w => w / sum);

    b.gap = Number.isFinite(raw.gap) ? Math.max(0, Math.min(64, raw.gap)) : 14;
  }
  else {
    b.content = typeof raw.content === "string" ? raw.content : "";
  }

  return b;
}

/* ---------- Нормализация документа ---------- */

function normalizeDocument(raw){
  if (!raw || typeof raw !== "object") return null;

  const t = now();
  const doc = {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    title: typeof raw.title === "string" ? raw.title.slice(0, 200) : "",
    icon: typeof raw.icon === "string" ? raw.icon : "",
    color: typeof raw.color === "string" ? raw.color : "",
    description: typeof raw.description === "string" ? raw.description.slice(0, 200) : "",
    blocks: Array.isArray(raw.blocks) ? raw.blocks.map(normalizeBlock).filter(Boolean) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter(x => typeof x === "string") : [],
    folderId: typeof raw.folderId === "string" ? raw.folderId : null,
    favorite: !!raw.favorite,
    pinned:   !!raw.pinned,
    archived: !!raw.archived,
    trashed: !!raw.trashed,
    trashedAt: raw.trashed && Number.isFinite(raw.trashedAt) ? raw.trashedAt : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : t,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : t,
    customFields: (raw.customFields && typeof raw.customFields === "object") ? raw.customFields : {},
    /* ПАТЧ 2.2: нумерация строк документа */
    showLineNumbers:  !!raw.showLineNumbers,
    lineNumberFormat: VALID_LINE_NUMBER_FORMATS.has(raw.lineNumberFormat)
      ? raw.lineNumberFormat
      : "1.",
    blockCount: 0,
    charCount: 0,
    wordCount: 0
  };

  if (!doc.blocks.length){
    doc.blocks = [block("text", "")];
  }

  recomputeDocStats(doc);
  return doc;
}

/* ---------- Нормализация шаблона ---------- */

function normalizeTemplate(raw){
  if (!raw || typeof raw !== "object") return null;

  const t = now();
  const blocks = Array.isArray(raw.blocks)
    ? raw.blocks.map(normalizeBlock).filter(Boolean)
    : [];

  if (!blocks.length) return null;

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    name: typeof raw.name === "string" ? raw.name.slice(0, 100) : "Шаблон",
    icon: typeof raw.icon === "string" ? raw.icon : "📄",
    description: typeof raw.description === "string" ? raw.description.slice(0, 200) : "",
    builtin: !!raw.builtin,
    hidden:  !!raw.hidden,
    blocks,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : t
  };
}

/* ============================================================
   Wikilinks: [[Имя документа]] и [[Имя документа#anchor]]
   ============================================================ */

/* ПАТЧ 2.2: возвращает массив объектов { name, anchor }.
   - name   — название документа (может содержать пробелы, кириллицу)
   - anchor — ID блока внутри документа (может быть пустым) */
function extractWikilinks(html){
  if (!html) return [];
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  tmp.querySelectorAll("code, pre").forEach(n => n.remove());

  const text = tmp.textContent || "";
  const out = [];
  const seen = new Set();
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text))){
    const raw = m[1].trim();
    if (!raw) continue;

    /* ПАТЧ 2.2: разбираем на name + anchor */
    const hashIdx = raw.indexOf("#");
    let name, anchor;
    if (hashIdx >= 0){
      name   = raw.slice(0, hashIdx).trim();
      anchor = raw.slice(hashIdx + 1).trim();
    } else {
      name   = raw;
      anchor = "";
    }
    if (!name) continue;

    const key = name + "\u0000" + anchor;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, anchor });
  }
  return out;
}

/* ПАТЧ 2.2: рендер [[doc#anchor]] — с data-wikilink-anchor и визуальным #anchor */
function renderWikilinks(html, resolver){
  if (!html) return "";

  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  const walk = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.TEXT_NODE){
        const text = child.textContent;
        if (text.indexOf("[[") === -1) return;
        const replaced = replaceText(text, resolver);
        if (replaced !== text){
          const frag = document.createRange().createContextualFragment(replaced);
          child.replaceWith(frag);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE){
        const tag = child.tagName.toLowerCase();
        if (tag === "code" || tag === "pre" || tag === "a") return;
        walk(child);
      }
    });
  };

  const replaceText = (text, resolver) => {
    return text.replace(/\[\[([^\]]+)\]\]/g, (full, rawName) => {
      const raw = rawName.trim();
      if (!raw) return full;

      /* ПАТЧ 2.2: разбираем name#anchor */
      const hashIdx = raw.indexOf("#");
      let name, anchor;
      if (hashIdx >= 0){
        name   = raw.slice(0, hashIdx).trim();
        anchor = raw.slice(hashIdx + 1).trim();
      } else {
        name   = raw;
        anchor = "";
      }
      if (!name) return full;

      let info = null;
      try { info = resolver(name); } catch(e){ info = null; }
      const id = info?.id || "";
      const missing = !info?.id;
      const cls = "wikilink" + (missing ? " missing" : "");

      /* ПАТЧ 2.2: тултип с анкором */
      let title;
      if (missing){
        title = `Создать «${escape(name)}»`;
      } else if (anchor){
        title = `Открыть «${escape(name)}» → #${escape(anchor)}`;
      } else {
        title = `Открыть «${escape(name)}»`;
      }

      const anchorHTML = anchor
        ? `<span class="wl-anchor">#${escape(anchor)}</span>`
        : "";

      return `<a class="${cls}" data-wikilink="${escape(name)}" data-wikilink-id="${escape(id)}" data-wikilink-anchor="${escape(anchor)}" title="${title}">${escape(name)}${anchorHTML}</a>`;
    });
  };

  walk(tmp);
  return tmp.innerHTML;
}

/* ============================================================
   HTML для превью и экспорта
   ============================================================ */

/* ПАТЧ 2.1: blockToHTML учитывает widths/gap/valign для columns.
   ПАТЧ 2.2: blockToHTML оборачивает в якорь при customId. */
function blockToHTML(b){
  if (!b) return "";
  if (b.type === "divider") return `<hr class="divider">`;
  if (b.type === "image"){
    return b.content ? `<img src="${escape(b.content)}" alt="">` : "";
  }
  if (b.type === "table"){
    let h = "<table>";
    b.rows.forEach((row, ri) => {
      h += "<tr>";
      row.forEach(cell => {
        h += `<${ri===0?"th":"td"}>${cell || ""}</${ri===0?"th":"td"}>`;
      });
      h += "</tr>";
    });
    h += "</table>";
    return h;
  }
  if (b.type === "columns"){
    const widths = Array.isArray(b.widths) && b.widths.length === b.cols
      ? b.widths.map(w => `${w}fr`).join(" ")
      : `repeat(${b.cols},1fr)`;
    const gap = Number.isFinite(b.gap) ? b.gap : 14;
    const valign = b.valign || "top";
    const alignItems = valign === "center" ? "center" :
                       valign === "bottom" ? "end"    : "start";
    return `<div style="display:grid;grid-template-columns:${widths};gap:${gap}px;align-items:${alignItems}">
      ${(b.content || []).map(c => `<div>${c || ""}</div>`).join("")}
    </div>`;
  }
  if (b.type === "ul" || b.type === "ol"){
    return `<${b.type}>${b.content || ""}</${b.type}>`;
  }
  if (b.type === "todo"){
    return `<div>${b.checked ? "☑" : "☐"} ${b.content || ""}</div>`;
  }
  if (b.type === "code"){
    return `<pre class="code">${escape(htmlToText(b.content || ""))}</pre>`;
  }
  if (b.type === "quote"){
    return `<blockquote class="quote">${b.content || ""}</blockquote>`;
  }
  if (b.type === "h1" || b.type === "h2" || b.type === "h3"){
    return `<${b.type}>${b.content || ""}</${b.type}>`;
  }
  return `<div>${b.content || ""}</div>`;
}

function recomputeDocStats(doc){
  const blocks = doc.blocks || [];
  doc.blockCount = blocks.length;

  let chars = 0, words = 0;
  for (const b of blocks){
    const text = htmlToText(b.content || "");
    chars += text.length;
    words += (text.match(/\S+/g) || []).length;
    if (b.type === "table" && Array.isArray(b.rows)){
      for (const row of b.rows){
        for (const cell of row){
          const t = htmlToText(cell || "");
          chars += t.length;
          words += (t.match(/\S+/g) || []).length;
        }
      }
    }
    if (b.type === "columns" && Array.isArray(b.content)){
      for (const col of b.content){
        const t = htmlToText(col || "");
        chars += t.length;
        words += (t.match(/\S+/g) || []).length;
      }
    }
  }
  doc.charCount = chars;
  doc.wordCount = words;
  return doc;
}

/* ---------- Нормализация папок, тегов, meta ---------- */

function normalizeFolder(raw){
  if (!raw || typeof raw !== "object") return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    name: typeof raw.name === "string" ? raw.name : "Папка",
    parentId: typeof raw.parentId === "string" ? raw.parentId : null,
    color: typeof raw.color === "string" ? raw.color : "",
    icon: typeof raw.icon === "string" ? raw.icon : "",
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now()
  };
}

function normalizeTag(raw){
  if (!raw || typeof raw !== "object") return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    name: typeof raw.name === "string" ? raw.name : "tag",
    color: typeof raw.color === "string" ? raw.color : "",
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now()
  };
}

function normalizeUI(raw){
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    sidebarOpen:  r.sidebarOpen !== false,
    sidebarWidth: Number.isFinite(r.sidebarWidth) ? r.sidebarWidth : 260,
    cardMode:     ["mini","normal","detailed"].includes(r.cardMode) ? r.cardMode : "normal",
    sortMode:     ["updated","created","title","size"].includes(r.sortMode) ? r.sortMode : "updated",
    groupMode:    ["date","folder","tag","none"].includes(r.groupMode) ? r.groupMode : "date",
    section:      ["favorite","all","today","week","earlier","archive","trash"].includes(r.section) ? r.section : "all",
    openTabs:     Array.isArray(r.openTabs) ? r.openTabs.filter(x => typeof x === "string") : [],
    theme:        ["paper","sepia","mint","dark"].includes(r.theme) ? r.theme : "paper",
    fonts:        (r.fonts && typeof r.fonts === "object") ? r.fonts : {},
    history:      Array.isArray(r.history) ? r.history.filter(x => typeof x === "string") : [],
    historyIndex: Number.isFinite(r.historyIndex) ? r.historyIndex : -1,
    showHiddenTemplates: !!r.showHiddenTemplates
  };
}

function normalizeSettings(raw){
  const r = raw && typeof raw === "object" ? raw : {};

  /* ПАТЧ 1: добавлен "block:delete" */
  const HOTKEY_DEFAULTS = {
    "doc:new":        "mod+n",
    "doc:template":   "mod+shift+n",
    "doc:open":       "mod+o",
    "doc:save":       "mod+s",
    "doc:saveAs":     "mod+shift+s",
    "doc:close":      "mod+w",
    "doc:next":       "mod+tab",
    "doc:prev":       "mod+shift+tab",
    "doc:rename":     "F2",
    "doc:trash":      "Delete",
    "sidebar:toggle": "mod+\\",
    "search:global":  "mod+shift+f",
    "palette:open":   "mod+k",
    "settings:open":  "mod+,",
    "nav:back":       "alt+ArrowLeft",
    "nav:forward":    "alt+ArrowRight",
    "list:ol":        "mod+shift+7",
    "list:none":      "mod+shift+8",
    "edit:undo":      "mod+z",
    "edit:redo":      "mod+y",
    "find:focus":     "mod+f",
    "lock:now":       "",
    "block:delete":   "mod+Backspace"
  };

  const hotkeys = { ...HOTKEY_DEFAULTS };
  if (r.hotkeys && typeof r.hotkeys === "object"){
    for (const k of Object.keys(r.hotkeys)){
      if (typeof r.hotkeys[k] === "string"){
        hotkeys[k] = r.hotkeys[k];
      }
    }
  }

  return {
    saveDebounceMs:        Number.isFinite(r.saveDebounceMs) ? r.saveDebounceMs : SAVE_DEBOUNCE,
    inputDebounceMs:       Number.isFinite(r.inputDebounceMs) ? r.inputDebounceMs : INPUT_DEBOUNCE,
    trashTtlDays:          Number.isFinite(r.trashTtlDays) ? r.trashTtlDays : TRASH_TTL_DAYS,
    backupEveryHours:      Number.isFinite(r.backupEveryHours) ? r.backupEveryHours : 24,
    allowExternalRequests: r.allowExternalRequests !== false,
    autoLockMinutes:       Number.isFinite(r.autoLockMinutes) ? r.autoLockMinutes : 0,
    hotkeys
  };
}

function normalizeState(raw){
  const doc = normalizeDocument({
    title: raw?.title,
    blocks: raw?.blocks,
    id: uid()
  });
  return {
    documents: { [doc.id]: doc },
    folders: {},
    tags: {},
    ui: normalizeUI(raw),
    settings: normalizeSettings(null),
    activeDocId: doc.id
  };
}

/* ---------- HTML → text / Markdown ---------- */

function htmlToText(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.innerText;
}

function htmlToMD(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  const walk = node => {
    let out = "";
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE){
        out += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE){
        const tag = child.tagName.toLowerCase();
        const inner = walk(child);
        switch (tag){
          case "strong": case "b": out += `**${inner}**`; break;
          case "em":     case "i": out += `*${inner}*`; break;
          case "s":      case "strike": case "del": out += `~~${inner}~~`; break;
          case "code":   out += `\`${inner}\``; break;
          case "br":     out += "\n"; break;
          case "a": {
            const href = child.getAttribute("href") || "";
            const wikilink = child.getAttribute("data-wikilink");
            /* ПАТЧ 2.2: сохраняем анкор при экспорте в MD */
            const anchor = child.getAttribute("data-wikilink-anchor") || "";
            if (wikilink){
              out += anchor ? `[[${wikilink}#${anchor}]]` : `[[${wikilink}]]`;
            } else {
              out += href ? `[${inner}](${href})` : inner;
            }
            break;
          }
          case "font": {
            const face = child.getAttribute("face") || "";
            out += face ? `<span style="font-family:'${face}'">${inner}</span>` : inner;
            break;
          }
          default: out += inner;
        }
      }
    });
    return out;
  };
  return walk(tmp);
}

/* ============================================================
   ПАТЧ 1: утилиты для floatbar-позиционирования и чистки вставки
   ============================================================ */

function positionFloating(elTarget, anchorRect, opts = {}){
  const gap    = opts.gap    ?? 6;
  const margin = opts.margin ?? 8;
  const preferBelow = opts.preferBelow !== false;

  elTarget.style.visibility = "hidden";
  elTarget.style.display = elTarget.dataset.display || "block";
  const w = elTarget.offsetWidth;
  const h = elTarget.offsetHeight;

  let left, top;

  const belowTop = anchorRect.bottom + gap;
  const aboveTop = anchorRect.top - h - gap;

  if (preferBelow){
    if (belowTop + h + margin <= window.innerHeight){
      top = belowTop;
    } else if (aboveTop >= margin){
      top = aboveTop;
    } else {
      top = (anchorRect.top > window.innerHeight / 2)
        ? Math.max(margin, window.innerHeight - h - margin)
        : margin;
    }
  } else {
    if (aboveTop >= margin){
      top = aboveTop;
    } else if (belowTop + h + margin <= window.innerHeight){
      top = belowTop;
    } else {
      top = margin;
    }
  }

  left = anchorRect.left;
  if (left + w + margin > window.innerWidth){
    left = window.innerWidth - w - margin;
  }
  if (left < margin) left = margin;

  elTarget.style.left = left + "px";
  elTarget.style.top  = top + "px";
  elTarget.style.visibility = "visible";
}

function cleanPastedHTML(html){
  if (!html) return "";

  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  tmp.querySelectorAll("span.indent-tab").forEach(n => n.remove());

  tmp.querySelectorAll("p > p, p > div, div > p, div > div").forEach(n => {
    const parent = n.parentElement;
    if (!parent || parent === tmp) return;
    const br = document.createElement("br");
    n.replaceWith(br);
    while (n.firstChild) br.parentNode.insertBefore(n.firstChild, br);
  });

  tmp.querySelectorAll("li > p").forEach(p => {
    const frag = document.createDocumentFragment();
    while (p.firstChild) frag.append(p.firstChild);
    p.replaceWith(frag);
  });

  while (tmp.lastChild && tmp.lastChild.nodeName === "BR"){
    tmp.lastChild.remove();
  }

  tmp.innerHTML = tmp.innerHTML.replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>");

  return tmp.innerHTML;
}

return {
  KEY, HISTORY_LIMIT, INPUT_DEBOUNCE, SAVE_DEBOUNCE, MAX_IMG_BYTES, TRASH_TTL_DAYS,
  types, VALID_TYPES, VALID_BG, VALID_FONT, VALID_INDENT, VALID_ALIGN, VALID_MARKER,
  /* ПАТЧ 2.1 */
  VALID_VALIGN,
  /* ПАТЧ 2.2 */
  VALID_LINE_NUMBER_FORMATS,
  EMOJI_PRESETS, COLOR_PRESETS,
  /* ПАТЧ 2.1 + 2.2 */
  $, $$, uid, shortId, now, escape, el, isArrayOfArrays, block, toast,
  sanitize,
  /* ПАТЧ 2.2 */
  sanitizeAnchor,
  normalizeBlock, normalizeDocument, normalizeTemplate, normalizeFolder, normalizeTag,
  normalizeUI, normalizeSettings, normalizeState,
  recomputeDocStats,
  blockToHTML,
  extractWikilinks, renderWikilinks,
  htmlToText, htmlToMD,
  /* ПАТЧ 1 */
  positionFloating,
  cleanPastedHTML
};

})();