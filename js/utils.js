/* ============================================================
   utils.js — константы, хелперы, sanitizer, нормализация
   Зависит от: —
   Используют: db, state, render, menus, sidebar, backlinks
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

/* ПАТЧ 2.3.1: типы блоков, которые поддерживают строки */
const LINE_TYPES = new Set(["text", "h1", "h2", "h3", "quote", "code", "todo"]);

const EMOJI_PRESETS = ["📝","📔","📚","💡","⭐","✅","🎯","🍳","✈️","💼","🎨","🔬","🏠","❤️","⚡"];
const COLOR_PRESETS = ["#829b91","#a78663","#c46a63","#c98a3c","#8a7bc4","#6a8dc4","#5fa57a","#7a7a7a"];

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- Время / id ---------- */

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

/* ---------- Валидация анкора ---------- */

function sanitizeAnchor(str){
  if (typeof str !== "string") return "";
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, "")
    .slice(0, 64);
}

/* ============================================================
   ПАТЧ 2.3.1: строки
   ============================================================ */

/* Фабрика строки: { id, text, customId, fragments }
   - id        — авто-ID (base36, 6 символов)
   - text      — HTML-содержимое строки (без <br>)
   - customId  — пользовательский анкор ("" = не задан)
   - fragments — массив { id, from, to, customId } — фрагменты внутри строки (этап 2.3.4) */
function line(text = ""){
  return {
    id: shortId(),
    text: typeof text === "string" ? text : "",
    customId: "",
    fragments: []
  };
}

/* Нормализация строки */
function normalizeLine(raw){
  if (!raw || typeof raw !== "object"){
    return line(typeof raw === "string" ? raw : "");
  }

  const l = {
    id: (typeof raw.id === "string" && raw.id) ? raw.id : shortId(),
    text: typeof raw.text === "string" ? raw.text : "",
    customId: sanitizeAnchor(raw.customId),
    fragments: []
  };

  /* fragments — пока оставляем пустым, реализуем в 2.3.4 */
  if (Array.isArray(raw.fragments)){
    l.fragments = raw.fragments
      .filter(f => f && typeof f === "object")
      .map(f => ({
        id: (typeof f.id === "string" && f.id) ? f.id : shortId(),
        from: Number.isFinite(f.from) ? f.from : 0,
        to: Number.isFinite(f.to) ? f.to : 0,
        customId: sanitizeAnchor(f.customId)
      }));
  }

  return l;
}

/* Синхронизация block.content ↔ block.lines.
   - Разбивает content по <br> (жёсткий перенос = строка)
   - Сопоставляет с существующими lines по индексу (сохраняет ID)
   - Создаёт новые строки для новых сегментов, удаляет лишние
   - Обновляет block.content (собирает обратно через <br>) */
function syncBlockLines(b){
  if (!b || !LINE_TYPES.has(b.type)) return;

  /* Если type не поддерживает строки — обнуляем */
  if (!Array.isArray(b.lines)) b.lines = [];

  /* Разбить content по <br> (и <br/>, <br />) */
  const raw = typeof b.content === "string" ? b.content : "";
  const parts = raw.split(/<br\s*\/?>/i);

  /* Собрать новые lines: сопоставляем по индексу со старыми */
  const nextLines = parts.map((html, i) => {
    const existing = b.lines[i];
    if (existing && typeof existing === "object"){
      return { ...existing, text: html };
    }
    return line(html);
  });

  b.lines = nextLines;

  /* Обратно собрать content — на случай, если что-то поменялось */
  b.content = b.lines.map(l => l.text).join("<br>");
}

/* Собрать текстовое содержимое блока (учитывая lines) */
function getBlockText(b){
  if (!b) return "";
  if (LINE_TYPES.has(b.type) && Array.isArray(b.lines) && b.lines.length){
    return b.lines.map(l => htmlToText(l.text || "")).join("\n");
  }
  return htmlToText(b.content || "");
}

/* Собрать HTML содержимое блока (учитывая lines) */
function getBlockHTML(b){
  if (!b) return "";
  if (LINE_TYPES.has(b.type) && Array.isArray(b.lines) && b.lines.length){
    return b.lines.map(l => l.text || "").join("<br>");
  }
  return b.content || "";
}

/* Найти строку по id или customId в массиве lines */
function findLine(b, lineAnchor){
  if (!b || !Array.isArray(b.lines) || !lineAnchor) return null;
  return b.lines.find(l =>
    l.id === lineAnchor || (l.customId && l.customId === lineAnchor)
  ) || null;
}

/* Индекс строки */
function findLineIndex(b, lineAnchor){
  if (!b || !Array.isArray(b.lines) || !lineAnchor) return -1;
  return b.lines.findIndex(l =>
    l.id === lineAnchor || (l.customId && l.customId === lineAnchor)
  );
}

/* ============================================================
   Блоки
   ============================================================ */

/* ПАТЧ 2.1: block() использует shortId(), добавлены поля колонок.
   ПАТЧ 2.2: добавлен customId.
   ПАТЧ 2.3.0: убраны lineNumber, blockMarker, blockMarkerColor.
   ПАТЧ 2.3.1: добавлено поле lines для LINE_TYPES. */
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
    /* ПАТЧ 2.1 — columns */
    widths:  null,
    gap:     null,
    valign:  "top",
    padding: 0,
    /* ПАТЧ 2.2 — ID блока */
    customId: "",
    /* ПАТЧ 2.3.1 — строки */
    lines: []
  };
  if (b.type === "table")   b.rows = [["",""],["",""]];
  if (b.type === "columns"){
    b.cols = 2;
    b.content = ["", ""];
    b.widths = [1, 1];
    b.gap = 14;
  }

  /* ПАТЧ 2.3.1: для LINE_TYPES — инициализируем lines из content */
  if (LINE_TYPES.has(b.type)){
    syncBlockLines(b);
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
  a: ["href","class","data-wikilink","data-wikilink-id",
      "data-wikilink-block-anchor","data-wikilink-line-anchor",
      "data-wikilink-fragment-anchor","title"],
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
    /* ПАТЧ 2.3.1 */
    lines: []
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

  /* ПАТЧ 2.3.1: lines */
  if (LINE_TYPES.has(b.type)){
    /* Если в raw есть нормальный массив lines — берём его */
    if (Array.isArray(raw.lines) && raw.lines.length){
      b.lines = raw.lines.map(normalizeLine);
    } else {
      b.lines = [];
    }
    /* Синхронизируем с content — так гарантируем, что каждая <br>-секция
       имеет свою строку */
    syncBlockLines(b);
  } else {
    b.lines = [];
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
   Wikilinks: [[doc]], [[doc#block]], [[doc#block#line]],
   [[doc#block#line#fragment]]
   ============================================================ */

/* Разбирает строку анкора вида "block#line#fragment" на части.
   Возвращает { blockAnchor, lineAnchor, fragmentAnchor }. */
function parseAnchorString(raw){
  const out = { blockAnchor: "", lineAnchor: "", fragmentAnchor: "" };
  if (!raw) return out;

  const parts = String(raw).split("#").map(p => p.trim());
  out.blockAnchor    = parts[0] || "";
  out.lineAnchor     = parts[1] || "";
  out.fragmentAnchor = parts[2] || "";
  return out;
}

/* extractWikilinks → возвращает [{ name, blockAnchor, lineAnchor, fragmentAnchor }] */
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

    /* name — до первого #, остальное — анкоры */
    const hashIdx = raw.indexOf("#");
    let name, anchorStr;
    if (hashIdx >= 0){
      name = raw.slice(0, hashIdx).trim();
      anchorStr = raw.slice(hashIdx + 1).trim();
    } else {
      name = raw;
      anchorStr = "";
    }
    if (!name) continue;

    const { blockAnchor, lineAnchor, fragmentAnchor } = parseAnchorString(anchorStr);

    const key = name + "\u0000" + blockAnchor + "\u0000" + lineAnchor + "\u0000" + fragmentAnchor;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, blockAnchor, lineAnchor, fragmentAnchor });
  }
  return out;
}

/* renderWikilinks — три data-атрибута для анкоров */
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

      const hashIdx = raw.indexOf("#");
      let name, anchorStr;
      if (hashIdx >= 0){
        name = raw.slice(0, hashIdx).trim();
        anchorStr = raw.slice(hashIdx + 1).trim();
      } else {
        name = raw;
        anchorStr = "";
      }
      if (!name) return full;

      const { blockAnchor, lineAnchor, fragmentAnchor } = parseAnchorString(anchorStr);

      let info = null;
      try { info = resolver(name); } catch(e){ info = null; }
      const id = info?.id || "";
      const missing = !info?.id;
      const cls = "wikilink" + (missing ? " missing" : "");

      /* Тултип */
      let title;
      if (missing){
        title = `Создать «${escape(name)}»`;
      } else if (blockAnchor || lineAnchor || fragmentAnchor){
        const parts = [blockAnchor, lineAnchor, fragmentAnchor].filter(Boolean);
        title = `Открыть «${escape(name)}» → #${escape(parts.join("#"))}`;
      } else {
        title = `Открыть «${escape(name)}»`;
      }

      /* Визуальный анкор — показываем всю цепочку после # */
      const visibleAnchor = [blockAnchor, lineAnchor, fragmentAnchor].filter(Boolean).join("#");
      const anchorHTML = visibleAnchor
        ? `<span class="wl-anchor">#${escape(visibleAnchor)}</span>`
        : "";

      return `<a class="${cls}" data-wikilink="${escape(name)}" data-wikilink-id="${escape(id)}" data-wikilink-block-anchor="${escape(blockAnchor)}" data-wikilink-line-anchor="${escape(lineAnchor)}" data-wikilink-fragment-anchor="${escape(fragmentAnchor)}" title="${title}">${escape(name)}${anchorHTML}</a>`;
    });
  };

  walk(tmp);
  return tmp.innerHTML;
}

/* ============================================================
   HTML для превью и экспорта
   ============================================================ */

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
    return `<div>${b.checked ? "☑" : "☐"} ${getBlockHTML(b)}</div>`;
  }
  if (b.type === "code"){
    return `<pre class="code">${escape(getBlockText(b))}</pre>`;
  }
  if (b.type === "quote"){
    return `<blockquote class="quote">${getBlockHTML(b)}</blockquote>`;
  }
  if (b.type === "h1" || b.type === "h2" || b.type === "h3"){
    return `<${b.type}>${getBlockHTML(b)}</${b.type}>`;
  }
  return `<div>${getBlockHTML(b)}</div>`;
}

function recomputeDocStats(doc){
  const blocks = doc.blocks || [];
  doc.blockCount = blocks.length;

  let chars = 0, words = 0;
  for (const b of blocks){
    /* ПАТЧ 2.3.1: считаем через getBlockText, он учитывает lines */
    const text = getBlockText(b);
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
            const bAnchor = child.getAttribute("data-wikilink-block-anchor") || "";
            const lAnchor = child.getAttribute("data-wikilink-line-anchor") || "";
            const fAnchor = child.getAttribute("data-wikilink-fragment-anchor") || "";
            if (wikilink){
              const anchors = [bAnchor, lAnchor, fAnchor].filter(Boolean).join("#");
              out += anchors ? `[[${wikilink}#${anchors}]]` : `[[${wikilink}]]`;
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
  /* ПАТЧ 2.3.1 */
  LINE_TYPES,
  EMOJI_PRESETS, COLOR_PRESETS,
  $, $$, uid, shortId, now, escape, el, isArrayOfArrays, block, toast,
  sanitize,
  sanitizeAnchor,
  /* ПАТЧ 2.3.1 */
  line, normalizeLine, syncBlockLines, getBlockText, getBlockHTML,
  findLine, findLineIndex, parseAnchorString,
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