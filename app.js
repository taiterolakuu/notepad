/* ============================================================
   Paper — Personal Notebook
   Путь B: модель хранит HTML, рендер вставляет HTML как есть.
   Drag — только через ручку, чтобы не мешать выделению текста.
   Шрифты — CDN + Command Palette + меню во floatbar.
   История — snapshot-based, с debounce для текстового ввода.
   Новое: выделение блока, меню ручки (bg/font/tag/indent).
   ============================================================ */

(() => {
"use strict";

/* ---------- Shortcuts ---------- */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- Constants ---------- */

const KEY = "paper-notebook-v1";
const HISTORY_LIMIT = 80;
const INPUT_DEBOUNCE = 400;
const SAVE_DEBOUNCE  = 150;
const MAX_IMG_BYTES  = 3 * 1024 * 1024;

const types = [
  ["text",    "Текст",         "Обычный абзац"],
  ["h1",      "Заголовок 1",   "Большой заголовок"],
  ["h2",      "Заголовок 2",   "Заголовок"],
  ["h3",      "Заголовок 3",   "Маленький заголовок"],
  ["ul",      "Список",        "Маркированный"],
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

/* ---------- State ---------- */

const S = {
  title: "",
  blocks: [],
  theme: "paper",
  fonts: {},
  selectedId: null
};

const history = [];
const future  = [];

let active       = null;
let slashBlockId = null;
let draggedId    = null;
let cmdIndex     = 0;
let lastCmdLen   = -1;

let saveTimer    = null;
let historyTimer = null;
let lastRange    = null;

let fontMenuOpen   = false;
let handleMenuOpen = false;
let handleMenuBlock = null;

/* ---------- Helpers ---------- */

function uid(){
  return (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "b-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function block(type = "text", content = ""){
  const b = {
    id: uid(),
    type: VALID_TYPES.has(type) ? type : "text",
    content: typeof content === "string" ? content : "",
    checked: false,
    rows: null,
    cols: null,
    bg: "",
    font: "",
    indent: 0
  };
  if (b.type === "table")   b.rows = [["",""],["",""]];
  if (b.type === "columns"){ b.cols = 2; b.content = ["", ""]; }
  return b;
}

function seed(){
  if (!S.blocks.length) S.blocks = [block("text", "")];
}

function snapshot(){
  return JSON.stringify(S);
}

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

/* ---------- Block normalization ---------- */

function normalizeBlock(raw){
  if (!raw || typeof raw !== "object") return null;

  const b = {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    type: VALID_TYPES.has(raw.type) ? raw.type : "text",
    content: raw.content,
    checked: !!raw.checked,
    rows: null,
    cols: null,
    bg: VALID_BG.has(raw.bg) ? raw.bg : "",
    font: VALID_FONT.has(raw.font) ? raw.font : "",
    indent: VALID_INDENT.has(raw.indent) ? raw.indent : 0
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
  }
  else {
    b.content = typeof raw.content === "string" ? raw.content : "";
  }

  return b;
}

function normalizeState(raw){
  const out = {
    title: typeof raw?.title === "string" ? raw.title : "",
    theme: ["paper","sepia","mint","dark"].includes(raw?.theme) ? raw.theme : "paper",
    fonts: {},
    blocks: [],
    selectedId: null
  };

  if (raw?.fonts && typeof raw.fonts === "object"){
    for (const role of ["body","head","serif","mono"]){
      if (typeof raw.fonts[role] === "string"){
        out.fonts[role] = raw.fonts[role];
      }
    }
  }

  if (Array.isArray(raw?.blocks)){
    out.blocks = raw.blocks.map(normalizeBlock).filter(Boolean);
  }
  if (!out.blocks.length){
    out.blocks = [block("text", "")];
  }

  return out;
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
  a: ["href"],
  span: [],
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
          const href = child.getAttribute("href") || "";
          if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute("href");
          else {
            child.setAttribute("target","_blank");
            child.setAttribute("rel","noopener noreferrer");
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

/* ---------- Storage ---------- */

function saveNow(){
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    $("#status").textContent = "Сохранено";
  } catch (e){
    console.error("save error:", e);
    if (e && /quota/i.test(e.name + " " + e.message)){
      $("#status").textContent = "Переполнено";
      toast("Хранилище переполнено. Удалите большие изображения.");
    } else {
      $("#status").textContent = "Ошибка сохранения";
    }
  }
}

function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE);
}

function load(){
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch (e){
    console.warn("load error:", e);
  }

  const clean = normalizeState(raw);
  S.title  = clean.title;
  S.theme  = clean.theme;
  S.fonts  = clean.fonts;
  S.blocks = clean.blocks;
  S.selectedId = null;
}

/* ---------- History ---------- */

function pushHistory(before){
  const now = snapshot();
  if (before === now) return;
  history.push(before);
  if (history.length > HISTORY_LIMIT) history.shift();
  future.length = 0;
  save();
}

function commit(before){ pushHistory(before); }

function commitDebounced(before){
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => pushHistory(before), INPUT_DEBOUNCE);
}

function undo(){
  if (!history.length) return;
  future.push(snapshot());
  const restored = normalizeState(JSON.parse(history.pop()));
  S.title  = restored.title;
  S.theme  = restored.theme;
  S.fonts  = restored.fonts;
  S.blocks = restored.blocks;
  if (!S.blocks.find(b => b.id === S.selectedId)) S.selectedId = null;
  render();
  applySavedFonts();
}

function redo(){
  if (!future.length) return;
  history.push(snapshot());
  const restored = normalizeState(JSON.parse(future.pop()));
  S.title  = restored.title;
  S.theme  = restored.theme;
  S.fonts  = restored.fonts;
  S.blocks = restored.blocks;
  if (!S.blocks.find(b => b.id === S.selectedId)) S.selectedId = null;
  render();
  applySavedFonts();
}

/* ---------- Selection ---------- */

function setSelectedBlock(id){
  if (S.selectedId === id) return;
  S.selectedId = id;

  /* снять выделение с прошлого */
  $$("#editor .block.selected").forEach(w =>
    w.classList.remove("selected"));

  /* поставить на новый */
  if (id){
    const w = $(`[data-id="${id}"]`);
    if (w) w.classList.add("selected");
  }
}

function clearSelection(){
  setSelectedBlock(null);
}

/* ---------- Block renderers ---------- */

function renderBlock(b){
  const w = el("div", "block");
  w.dataset.id = b.id;

  if (b.bg)     w.dataset.bg = b.bg;
  if (b.font)   w.dataset.font = b.font;
  if (b.indent) w.dataset.indent = b.indent;

  if (S.selectedId === b.id) w.classList.add("selected");

  const h = el("div", "handle");
  h.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <circle cx="9" cy="6" r="1"/>
      <circle cx="9" cy="12" r="1"/>
      <circle cx="9" cy="18" r="1"/>
      <circle cx="15" cy="6" r="1"/>
      <circle cx="15" cy="12" r="1"/>
      <circle cx="15" cy="18" r="1"/>
    </svg>`;
  w.append(h);

  /* выделение при клике */
  w.addEventListener("mousedown", () => {
    active = b.id;
    setSelectedBlock(b.id);
  });

  let body;

  if (b.type === "divider"){
    body = el("div", "body divider");
    w.append(body);
    return w;
  }

  if (b.type === "image"){
    body = el("div", "body");
    body.innerHTML = b.content
      ? `<img class="noteimg" src="${escape(b.content)}"><div class="caption">Изображение</div>`
      : "Перетащите изображение сюда";
    w.append(body);
    return w;
  }

  if (b.type === "table"){
    body = renderTable(b);
    w.append(body);
    return w;
  }

  if (b.type === "columns"){
    body = renderColumns(b);
    w.append(body);
    return w;
  }

  if (b.type === "todo"){
    body = el("div", "body todo " + (b.checked ? "done" : ""));
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = !!b.checked;
    c.onchange = () => {
      const old = snapshot();
      b.checked = c.checked;
      commit(old);
      render();
    };
    body.append(c);

    const t = el("div");
    t.contentEditable = true;
    t.spellcheck = true;
    t.innerHTML = b.content || "";
    t.onfocus = () => { active = b.id; setSelectedBlock(b.id); };
    t.oninput = () => {
      const wasEmpty = b.content === "";
      b.content = t.innerHTML;
      if (wasEmpty) commit(snapshot());
      else          commitDebounced(snapshot());
      save();
    };
    t.onpaste = makePasteHandler(t);
    body.append(t);

    w.append(body);
    return w;
  }

  const tag =
    b.type === "h1" ? "h1" :
    b.type === "h2" ? "h2" :
    b.type === "h3" ? "h3" :
    b.type === "ul" ? "ul" :
    b.type === "ol" ? "ol" : "div";

  body = el(tag,
    "body " +
    (b.type === "quote" ? "quote" : "") +
    (b.type === "code"  ? " code"  : "")
  );

  body.innerHTML = b.content || "";

  body.contentEditable = true;
  body.spellcheck = b.type !== "code";
  body.dataset.placeholder =
    b.type === "code" ? "Код…" : "Пишите здесь…";

  body.onfocus = () => { active = b.id; setSelectedBlock(b.id); };
  body.oninput = () => {
    const before = snapshot();
    b.content = body.innerHTML;
    save();
    if (checkInputRules(b, body)) return;
    commitDebounced(before);
  };
  body.onkeydown = e => keyBlock(e, b, body);
  body.onpaste = makePasteHandler(body);

  w.append(body);
  return w;
}

/* ---------- Paste handler ---------- */

function makePasteHandler(target){
  return function(e){
    const html = e.clipboardData?.getData("text/html");
    const text = e.clipboardData?.getData("text/plain");
    if (!html && !text) return;
    e.preventDefault();

    let clean;
    if (html) clean = sanitize(html);
    else      clean = escape(text).replace(/\n/g, "<br>");

    document.execCommand("insertHTML", false, clean);
  };
}

/* ---------- Table ---------- */

function renderTable(b){
  const box = el("div", "body");
  const t = document.createElement("table");

  const width = b.rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  b.rows.forEach(r => {
    while (r.length < width) r.push("");
  });

  b.rows.forEach((row, ri) => {
    const tr = document.createElement("tr");
    row.forEach((v, ci) => {
      const c = document.createElement(ri === 0 ? "th" : "td");
      c.contentEditable = true;
      c.innerHTML = v || "";
      c.onfocus = () => { active = b.id; setSelectedBlock(b.id); };
      c.oninput = () => {
        b.rows[ri][ci] = c.innerHTML;
        save();
        commitDebounced(snapshot());
      };
      c.onkeydown = e => {
        if (e.key === "Tab"){
          e.preventDefault();
          const lastRow = ri === b.rows.length - 1;
          const lastCol = ci === row.length - 1;
          const needNew = lastRow && lastCol;
          if (needNew) b.rows.push(Array(width).fill(""));
          render();
          setTimeout(() => {
            focusCell(b, ri + (needNew ? 1 : 0), needNew ? 0 : ci + 1);
          }, 0);
        } else if (e.key === "Backspace" && c.innerText === ""){
          e.stopPropagation();
        }
      };
      tr.append(c);
    });
    t.append(tr);
  });

  box.append(t);

  /* tablebar виден только у выделенного блока — CSS решает,
     но оставим в DOM, чтобы клики работали после выделения */
  const bar = el("div", "tablebar");
  [
    ["＋ строка", () => b.rows.push(Array(width).fill(""))],
    ["＋ колонка", () => b.rows.forEach(r => r.push(""))],
    ["− строка", () => { if (b.rows.length > 1) b.rows.pop(); }],
    ["− колонка", () => {
      if (width > 1) b.rows.forEach(r => r.pop());
    }]
  ].forEach(([label, fn]) => {
    const q = document.createElement("button");
    q.textContent = label;
    q.onclick = () => {
      const old = snapshot();
      fn();
      commit(old);
      render();
      setSelectedBlock(b.id);
    };
    bar.append(q);
  });
  box.append(bar);

  return box;
}

function focusCell(b, r, c){
  const wrap = $(`[data-id="${b.id}"]`);
  if (!wrap) return;
  const cells = wrap.querySelectorAll("td,th");
  if (!cells.length) return;
  const width = b.rows[0]?.length || 1;
  const idx = Math.min(Math.max(r, 0), b.rows.length - 1) * width +
              Math.min(Math.max(c, 0), width - 1);
  cells[idx]?.focus();
}

/* ---------- Columns ---------- */

function renderColumns(b){
  const box = el("div", "body");
  const g = el("div", "cols");
  g.dataset.n = b.cols;

  if (!Array.isArray(b.content)){
    b.content = Array(b.cols).fill("");
  }

  for (let i = 0; i < b.cols; i++){
    const c = el("div", "col");
    const q = el("div", "body");
    q.contentEditable = true;
    q.dataset.col = i;
    q.dataset.placeholder = "Колонка…";
    q.innerHTML = b.content[i] || "";
    q.onfocus = () => { active = b.id; setSelectedBlock(b.id); };
    q.oninput = () => {
      b.content[i] = q.innerHTML;
      save();
      commitDebounced(snapshot());
    };
    q.onpaste = makePasteHandler(q);
    c.append(q);
    g.append(c);
  }
  box.append(g);

  const bar = el("div", "tablebar");
  [2, 3, 4].forEach(n => {
    const q = document.createElement("button");
    q.textContent = n + " кол.";
    q.onclick = () => {
      const old = snapshot();
      b.cols = n;
      b.content = Array.from({ length: n }, (_, i) => b.content[i] || "");
      commit(old);
      render();
      setSelectedBlock(b.id);
    };
    bar.append(q);
  });
  box.append(bar);

  return box;
}

/* ---------- Main render ---------- */

function render(){
  $("#title").textContent = S.title || "";
  $("#editor").replaceChildren(...S.blocks.map(renderBlock));
  document.documentElement.dataset.theme =
    S.theme === "paper" ? "" : S.theme;

  [...$("#editor").querySelectorAll(".block")].forEach(w => {
    const handle = w.querySelector(".handle");

    handle?.addEventListener("mousedown", () => {
      draggedId = w.dataset.id;
      w.draggable = true;
    });

    w.addEventListener("dragstart", e => {
      const startedFromHandle =
        e.target === handle || handle?.contains(e.target);
      if (!startedFromHandle){
        e.preventDefault();
        w.draggable = false;
        draggedId = null;
        return;
      }
      draggedId = w.dataset.id;
      e.dataTransfer.setData("text/plain", draggedId);
      e.dataTransfer.effectAllowed = "move";
      w.classList.add("dragging");
    });

    w.addEventListener("dragend", () => {
      w.draggable = false;
      w.classList.remove("dragging");
      draggedId = null;
    });

    w.addEventListener("dragover", e => {
      if (draggedId) e.preventDefault();
    });

    w.addEventListener("drop", e => {
      e.preventDefault();
      const fromId = draggedId || e.dataTransfer.getData("text/plain");
      const toId = w.dataset.id;
      draggedId = null;
      w.draggable = false;
      w.classList.remove("dragging");

      const from = S.blocks.findIndex(x => x.id === fromId);
      const to   = S.blocks.findIndex(x => x.id === toId);
      if (from < 0 || to < 0 || from === to) return;

      const old = snapshot();
      const [x] = S.blocks.splice(from, 1);
      S.blocks.splice(to, 0, x);
      commit(old);
      render();
      setSelectedBlock(x.id);
    });

    w.addEventListener("mouseup", () => {
      setTimeout(() => {
        if (!w.classList.contains("dragging")){
          w.draggable = false;
          draggedId = null;
        }
      }, 0);
    });
  });
}

/* ---------- Block manipulation ---------- */

function add(type = "text", at = S.blocks.length){
  const b = block(type);
  S.blocks.splice(at, 0, b);
  active = b.id;
  render();
  setSelectedBlock(b.id);
  setTimeout(() => focusActive(), 0);
  save();
}

function focusActive(){
  const w = $(`[data-id="${active}"]`);
  w?.querySelector("[contenteditable]")?.focus();
}

/* ---------- Markdown input rules ---------- */

function checkInputRules(b, body){
  if (b.type !== "text") return false;

  const onlyText =
    [...body.childNodes].every(n =>
      n.nodeType === Node.TEXT_NODE ||
      (n.nodeType === Node.ELEMENT_NODE && n.tagName === "BR")
    );
  if (!onlyText) return false;

  const t = body.innerText;

  const rules = [
    [/^# $/,         "h1"],
    [/^## $/,        "h2"],
    [/^### $/,       "h3"],
    [/^- $/,         "ul"],
    [/^\* $/,        "ul"],
    [/^1\. $/,       "ol"],
    [/^> $/,         "quote"],
    [/^---$/,        "divider"],
    [/^- \[ \] $/,   "todo"]
  ];

  for (const [re, type] of rules){
    if (re.test(t)){
      const old = snapshot();
      b.type = type;
      b.content = "";
      commit(old);
      render();
      setSelectedBlock(b.id);
      setTimeout(focusActive, 0);
      return true;
    }
  }

  if (/^\|.+\|$/.test(t) && t.includes("|")){
    const cells = t.split("|").slice(1, -1).map(x => x.trim());
    if (cells.length){
      const old = snapshot();
      b.type = "table";
      b.rows = [cells, Array(cells.length).fill("")];
      commit(old);
      render();
      setSelectedBlock(b.id);
      return true;
    }
  }
  return false;
}

/* ---------- Keyboard inside block ---------- */

function keyBlock(e, b, body){
  if (e.key === "Enter" && !e.shiftKey &&
      b.type !== "code" && b.type !== "ul" && b.type !== "ol"){
    e.preventDefault();
    const i = S.blocks.findIndex(x => x.id === b.id);
    add("text", i + 1);
    return;
  }

  if (e.key === "Backspace" &&
      (body.innerText === "" || body.innerHTML === "<br>") &&
      S.blocks.length > 1){
    e.preventDefault();
    const i = S.blocks.findIndex(x => x.id === b.id);
    const old = snapshot();
    S.blocks.splice(i, 1);
    const nextId = S.blocks[Math.max(0, i - 1)].id;
    active = nextId;
    commit(old);
    render();
    setSelectedBlock(nextId);
    focusActive();
    return;
  }

  if (e.key === "/" && body.innerText === ""){
    setTimeout(() => openSlash(body, b.id), 0);
  }
}

/* ---------- Slash menu ---------- */

function openSlash(body, blockId){
  slashBlockId = blockId;
  const r = body.getBoundingClientRect();
  const m = $("#slash");
  m.style.left = Math.min(r.left, innerWidth - 315) + "px";
  m.style.top  = (r.bottom + 4) + "px";
  m.style.display = "block";
  $("#slashinput").value = "";
  slashRender();
}

function slashRender(){
  const q = $("#slashinput").value.toLowerCase();
  const arr = types.filter(x =>
    (x[0] + x[1] + x[2]).toLowerCase().includes(q));

  $("#slashresults").innerHTML = arr.map((x, i) =>
    `<div class="result ${i === 0 ? "sel" : ""}" data-type="${x[0]}">
       <b>${x[1]}</b><small>${x[2]}</small>
     </div>`
  ).join("");

  $$(".slash .result").forEach(x =>
    x.onclick = () => slashChoose(x.dataset.type));
}

function slashChoose(type){
  const b = S.blocks.find(x => x.id === slashBlockId);
  if (b && b.type === "text"){
    const old = snapshot();
    b.type = type;
    b.content = "";
    if (type === "columns"){ b.cols = 2; b.content = ["", ""]; }
    if (type === "table")  { b.rows = [["",""],["",""]]; }
    commit(old);
    render();
    active = b.id;
    setSelectedBlock(b.id);
    focusActive();
  }
  slashBlockId = null;
  $("#slash").style.display = "none";
}

/* ---------- Command palette ---------- */

const commands = [
  ["Новый документ",   "Создать чистую страницу",   "new"],
  ["Текст",            "Добавить абзац",            "text"],
  ["Заголовок 1",      "Добавить H1",               "h1"],
  ["Заголовок 2",      "Добавить H2",               "h2"],
  ["Чек-лист",         "Добавить задачу",           "todo"],
  ["Таблица",          "Добавить таблицу",          "table"],
  ["Колонки",          "Добавить колонки",          "columns"],
  ["Изображение",      "Добавить изображение",      "image"],
  ["Разделитель",      "Добавить линию",            "divider"],
  ["Сохранить",        "Сохранить сейчас",          "save"],
  ["Экспорт HTML",     "Скачать автономный HTML",   "export"],
  ["Экспорт Markdown", "Скачать Markdown",          "md"],
  ["Печать / PDF",     "Открыть печать",            "print"],

  ["Шрифт: Inter",             "Основной, по умолчанию",  "font:body:Inter"],
  ["Шрифт: Open Sans",         "Основной, гуманистический","font:body:Open Sans"],
  ["Шрифт: Plus Jakarta Sans", "Основной, современный",   "font:body:Plus Jakarta Sans"],

  ["Шрифт H: Montserrat",      "Заголовки, геометрия",    "font:head:Montserrat"],
  ["Шрифт H: Manrope",         "Заголовки, сглаженный",   "font:head:Manrope"],
  ["Шрифт H: Outfit",          "Заголовки, премиум",      "font:head:Outfit"],
  ["Шрифт H: Inter",           "Заголовки, как текст",    "font:head:Inter"],

  ["Шрифт S: Lora",            "Каллиграфический",        "font:serif:Lora"],
  ["Шрифт S: PT Serif",        "Экранная антиква",        "font:serif:PT Serif"],
  ["Шрифт S: Merriweather",    "Для чтения",              "font:serif:Merriweather"],

  ["Шрифт M: JetBrains Mono",  "Код, по умолчанию",       "font:mono:JetBrains Mono"],
  ["Шрифт M: Fira Code",       "Код, гуманистический",    "font:mono:Fira Code"],

  ["Тема: Paper",      "Светлая бумага",            "theme:paper"],
  ["Тема: Sepia",      "Тёплая бумага",             "theme:sepia"],
  ["Тема: Mint",       "Мята",                      "theme:mint"],
  ["Тема: Dark",       "Тёмная",                    "theme:dark"]
];

function openPalette(){
  $("#palette").style.display = "block";
  $("#backdrop").style.display = "block";
  $("#cmdinput").value = "";
  cmdIndex = 0;
  lastCmdLen = -1;
  cmdRender();
  $("#cmdinput").focus();
}

function closeMenus(){
  $("#palette").style.display = "none";
  $("#slash").style.display = "none";
  $("#backdrop").style.display = "none";
}

function cmdRender(){
  const q = $("#cmdinput").value.toLowerCase();
  const a = commands.filter(x =>
    (x[0] + x[1]).toLowerCase().includes(q));

  if (a.length !== lastCmdLen){
    cmdIndex = 0;
    lastCmdLen = a.length;
  }
  if (a.length === 0) cmdIndex = 0;
  if (cmdIndex >= a.length) cmdIndex = Math.max(0, a.length - 1);

  $("#cmdresults").innerHTML = a.map((x, i) =>
    `<div class="result ${i === cmdIndex ? "sel" : ""}" data-c="${x[2]}">
       ${x[0]}<small>${x[1]}</small>
     </div>`
  ).join("");

  $$("#cmdresults .result").forEach(x =>
    x.onclick = () => run(x.dataset.c));
}

function run(c){
  closeMenus();

  if (c === "new"){
    if (confirm("Создать новый документ?")){
      const old = snapshot();
      history.push(old);
      S.title = "";
      S.blocks = [block("text", "")];
      S.selectedId = null;
      render();
      focusActive();
      save();
    }
  }
  else if (c === "save")  { saveNow(); toast("Сохранено"); }
  else if (c === "export"){ download("notebook.html", makeHTML()); }
  else if (c === "md")    { download("notebook.md", toMD()); }
  else if (c === "print") { print(); }
  else if (c.startsWith("theme:")){
    const old = snapshot();
    S.theme = c.slice(6);
    commit(old);
    render();
  }
  else if (c.startsWith("font:")){
    const parts = c.split(":");
    const role = parts[1];
    const name = parts.slice(2).join(":");
    const varMap = {
      body:  "--font-current",
      head:  "--font-heading-current",
      serif: "--font-serif",
      mono:  "--font-mono-current"
    };
    const cssVar = varMap[role];
    if (!cssVar) return;

    const fallback =
      role === "mono"  ? "ui-monospace, Consolas, monospace" :
      role === "serif" ? "Georgia, serif" :
                         "system-ui, sans-serif";

    document.documentElement.style.setProperty(cssVar, `'${name}', ${fallback}`);

    if (!S.fonts) S.fonts = {};
    S.fonts[role] = name;
    save();
    toast(`Шрифт: ${name}`);
  }
  else if (c === "image"){ $("#file").click(); }
  else if (["text","h1","h2","todo","table","columns","divider"].includes(c)){
    add(c);
  }
}

/* ---------- Apply saved fonts ---------- */

function applySavedFonts(){
  const varMap = {
    body:  "--font-current",
    head:  "--font-heading-current",
    serif: "--font-serif",
    mono:  "--font-mono-current"
  };
  const fallbacks = {
    body:  "system-ui, sans-serif",
    head:  "system-ui, sans-serif",
    serif: "Georgia, serif",
    mono:  "ui-monospace, Consolas, monospace"
  };
  for (const role of Object.keys(S.fonts || {})){
    const name = S.fonts[role];
    if (varMap[role] && name){
      document.documentElement.style.setProperty(
        varMap[role], `'${name}', ${fallbacks[role]}`
      );
    }
  }
}

/* ---------- Export ---------- */

function download(name, data){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], {
    type: name.endsWith(".html") ? "text/html" : "text/markdown"
  }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function makeHTML(){
  const clone = document.documentElement.cloneNode(true);
  clone.querySelector("#editor").innerHTML = $("#editor").innerHTML;
  clone.querySelector("#title").textContent = S.title;
  return "<!doctype html>\n" + clone.outerHTML;
}

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
            out += href ? `[${inner}](${href})` : inner;
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

function toMD(){
  let out = `# ${S.title || "Без названия"}\n\n`;

  for (const b of S.blocks){
    if (b.type === "divider") out += "---\n\n";
    else if (["h1","h2","h3"].includes(b.type))
      out += `${"#".repeat(+b.type[1])} ${htmlToMD(b.content)}\n\n`;
    else if (b.type === "ul" || b.type === "ol"){
      const txt = htmlToText(b.content);
      const lines = txt.split("\n").filter(Boolean);
      out += lines.map((x, i) =>
        b.type === "ul" ? `- ${x}` : `${i + 1}. ${x}`
      ).join("\n") + "\n\n";
    }
    else if (b.type === "todo")
      out += `- [${b.checked ? "x" : " "}] ${htmlToMD(b.content)}\n\n`;
    else if (b.type === "quote")
      out += "> " + htmlToMD(b.content) + "\n\n";
    else if (b.type === "code")
      out += "```\n" + htmlToText(b.content) + "\n```\n\n";
    else if (b.type === "table"){
      if (!b.rows.length) continue;
      const width = b.rows[0].length;
      const header  = "| " + b.rows[0].map(htmlToMD).join(" | ") + " |";
      const sep     = "| " + Array(width).fill("---").join(" | ") + " |";
      const bodyRows = b.rows.slice(1).map(r =>
        "| " + r.map(htmlToMD).join(" | ") + " |"
      );
      out += [header, sep, ...bodyRows].join("\n") + "\n\n";
    }
    else if (b.type === "image")
      out += `![image](${b.content})\n\n`;
    else
      out += htmlToMD(b.content) + "\n\n";
  }

  out += "\n<!-- Изображения встроены как data:URL и могут увеличивать размер файла -->\n";
  return out;
}

/* ---------- Toast ---------- */

function toast(s){
  const t = $("#toast");
  t.textContent = s;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1400);
}

/* ---------- UI bindings ---------- */

$("#title").oninput = () => {
  const wasEmpty = S.title === "";
  S.title = $("#title").innerText;
  if (wasEmpty) commit(snapshot());
  else          commitDebounced(snapshot());
  save();
};

$("#undo").onclick  = undo;
$("#redo").onclick  = redo;
$("#new").onclick   = () => run("new");
$("#menu").onclick  = openPalette;
$("#theme").onclick = () => {
  const a = ["paper","sepia","mint","dark"];
  const i = a.indexOf(S.theme);
  const old = snapshot();
  S.theme = a[(i + 1) % a.length];
  commit(old);
  render();
};

$("#backdrop").onclick = closeMenus;

$("#cmdinput").oninput = cmdRender;
$("#cmdinput").onkeydown = e => {
  const items = $$("#cmdresults .result");
  const n = items.length;
  if (e.key === "ArrowDown"){
    e.preventDefault();
    if (!n) return;
    cmdIndex = (cmdIndex + 1) % n;
    cmdRender();
  } else if (e.key === "ArrowUp"){
    e.preventDefault();
    if (!n) return;
    cmdIndex = (cmdIndex + n - 1) % n;
    cmdRender();
  } else if (e.key === "Enter"){
    if (!n) return;
    items[Math.min(cmdIndex, n - 1)]?.click();
  } else if (e.key === "Escape"){
    closeMenus();
  }
};

$("#slashinput").oninput = slashRender;
$("#slashinput").onkeydown = e => {
  if (e.key === "Escape") { slashBlockId = null; closeMenus(); }
  if (e.key === "Enter")  $$("#slashresults .result")[0]?.click();
};

$("#find").oninput = e => {
  const q = e.target.value.toLowerCase();
  $$(".block").forEach(w => {
    w.style.display =
      !q || w.innerText.toLowerCase().includes(q) ? "" : "none";
  });
};

/* ---------- Floatbar ---------- */

$$(".floatbar button").forEach(b => {
  b.onmousedown = e => {
    const s = getSelection();
    if (s.rangeCount && !s.isCollapsed) lastRange = s.getRangeAt(0).cloneRange();
    e.preventDefault();
  };

  b.onclick = () => {
    const cmd = b.dataset.cmd;

    if (cmd === "font"){
      restoreLastRange();
      openFontMenu(b);
      return;
    }

    if (cmd === "link"){
      const url = prompt("URL:", "https://");
      if (url) document.execCommand("createLink", false, url);
    }
    else if (cmd === "highlight"){
      document.execCommand("hiliteColor", false, "#f3e4a6");
    }
    else if (cmd === "clear"){
      document.execCommand("removeFormat", false, null);
      document.execCommand("unlink", false, null);
    }
    else if (cmd === "h1"){
      const sel = getSelection();
      const node = sel.anchorNode?.parentElement;
      const body = node?.closest(".body");
      const wrap = body?.closest(".block");
      const blockData = S.blocks.find(x => x.id === wrap?.dataset.id);
      if (blockData){
        const old = snapshot();
        blockData.type = "h1";
        commit(old);
        render();
        setSelectedBlock(blockData.id);
        setTimeout(() => focusActive(), 0);
      }
    }
    else {
      document.execCommand(cmd, false, null);

      const sel = getSelection();
      const node = sel.anchorNode?.parentElement;
      const body = node?.closest(".body");
      const wrap = body?.closest(".block");
      const blockData = S.blocks.find(x => x.id === wrap?.dataset.id);
      if (blockData && body){
        blockData.content = body.innerHTML;
        save();
        commitDebounced(snapshot());
      }
    }

    updateFloatbarState();
  };
});

function restoreLastRange(){
  if (!lastRange) return;
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(lastRange);
}

document.addEventListener("selectionchange", () => {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed){
    $("#floatbar").style.display = "none";
    return;
  }
  const n = s.anchorNode?.parentElement;
  if (!n?.closest(".editor")){
    $("#floatbar").style.display = "none";
    return;
  }

  const r = s.getRangeAt(0).getBoundingClientRect();
  const f = $("#floatbar");
  f.style.left = Math.max(8, r.left) + "px";
  f.style.top  = Math.max(65, r.top - 46) + "px";
  f.style.display = "flex";

  updateFloatbarState();
});

function updateFloatbarState(){
  const checks = {
    bold:      document.queryCommandState("bold"),
    italic:    document.queryCommandState("italic"),
    underline: document.queryCommandState("underline"),
    strike:    document.queryCommandState("strikeThrough")
  };
  $$(".floatbar button").forEach(b => {
    const cmd = b.dataset.cmd;
    if (cmd in checks) b.classList.toggle("on", !!checks[cmd]);
  });
}

/* ---------- Font menu ---------- */

const FONT_LIST = [
  { group: "Основной",  name: "Inter",             tag: "sans" },
  { group: "Основной",  name: "Open Sans",         tag: "sans" },
  { group: "Основной",  name: "Plus Jakarta Sans", tag: "sans" },

  { group: "Заголовки", name: "Montserrat",        tag: "head" },
  { group: "Заголовки", name: "Manrope",           tag: "head" },
  { group: "Заголовки", name: "Outfit",            tag: "head" },
  { group: "Заголовки", name: "Inter",             tag: "head" },

  { group: "Serif",     name: "Lora",              tag: "serif" },
  { group: "Serif",     name: "PT Serif",          tag: "serif" },
  { group: "Serif",     name: "Merriweather",      tag: "serif" },

  { group: "Mono",      name: "JetBrains Mono",    tag: "mono" },
  { group: "Mono",      name: "Fira Code",         tag: "mono" }
];

function openFontMenu(anchor){
  const menu = $("#fontmenu");
  const input = $("#fontmenu-input");
  if (!menu || !input) return;

  const r = anchor.getBoundingClientRect();
  const w = 230;
  const left = Math.min(r.left, window.innerWidth - w - 8);
  const top = r.bottom + 6;

  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.style.display = "block";

  input.value = "";
  fontMenuRender("");
  fontMenuOpen = true;
}

function closeFontMenu(){
  const menu = $("#fontmenu");
  if (menu) menu.style.display = "none";
  fontMenuOpen = false;
}

function fontMenuRender(query){
  const list = $("#fontmenu-list");
  if (!list) return;

  const q = query.toLowerCase().trim();
  let html = "";
  let lastGroup = "";

  FONT_LIST.forEach(f => {
    if (q && !f.name.toLowerCase().includes(q)) return;
    if (f.group !== lastGroup){
      html += `<div class="fontmenu-group">${f.group}</div>`;
      lastGroup = f.group;
    }
    html += `
      <div class="fontmenu-item" data-font="${f.name}">
        <span class="fname" style="font-family:'${f.name}', system-ui, sans-serif">
          ${f.name}
        </span>
        <span class="ftag">${f.tag}</span>
      </div>`;
  });

  if (!html) html = `<div class="fontmenu-group">Ничего не найдено</div>`;
  list.innerHTML = html;

  list.querySelectorAll(".fontmenu-item").forEach(item => {
    item.onmousedown = e => e.preventDefault();
    item.onclick = () => {
      applyFontToSelection(item.dataset.font);
      closeFontMenu();
    };
  });
}

function applyFontToSelection(name){
  restoreLastRange();
  document.execCommand("fontName", false, name);

  const sel = getSelection();
  const node = sel.anchorNode?.parentElement;
  const body = node?.closest(".body");
  const wrap = body?.closest(".block");
  const blockData = S.blocks.find(x => x.id === wrap?.dataset.id);
  if (blockData && body){
    blockData.content = body.innerHTML;
    save();
    commitDebounced(snapshot());
  }

  toast(`Шрифт: ${name}`);
}

const fontInput = $("#fontmenu-input");
if (fontInput){
  fontInput.addEventListener("input", e => fontMenuRender(e.target.value));
  fontInput.addEventListener("keydown", e => {
    if (e.key === "Escape"){ closeFontMenu(); return; }
    if (e.key === "Enter"){
      const first = $("#fontmenu-list .fontmenu-item");
      if (first) first.click();
    }
  });
}

/* ---------- Handle menu (настройки блока) ---------- */

function openHandleMenu(anchor, blockId){
  const menu = $("#handlemenu");
  if (!menu) return;

  handleMenuBlock = blockId;

  const r = anchor.getBoundingClientRect();
  const w = 260;
  const left = Math.min(r.left + 24, window.innerWidth - w - 8);
  const top  = Math.min(r.top + 4, Math.max(8, window.innerHeight - 460));

  menu.style.left = left + "px";
  menu.style.top  = top + "px";
  menu.style.display = "block";

  syncHandleMenuState();
  handleMenuOpen = true;
}

function closeHandleMenu(){
  const menu = $("#handlemenu");
  if (menu) menu.style.display = "none";
  handleMenuOpen = false;
  handleMenuBlock = null;
}

function syncHandleMenuState(){
  const menu = $("#handlemenu");
  if (!menu || !handleMenuBlock) return;

  const b = S.blocks.find(x => x.id === handleMenuBlock);
  if (!b) return;

  menu.querySelectorAll(".hm-row").forEach(row => {
    const group = row.dataset.group;
    row.querySelectorAll("button").forEach(btn => {
      const val = btn.dataset.val;
      let on = false;

      if (group === "type")   on = (b.type === val);
      if (group === "bg")     on = ((b.bg || "") === val);
      if (group === "font")   on = ((b.font || "") === val);
      if (group === "indent") on = (String(b.indent || 0) === val);

      btn.classList.toggle("on", on);
    });
  });
}

const handleMenu = $("#handlemenu");
if (handleMenu){
  handleMenu.addEventListener("mousedown", e => {
    if (e.target.closest(".hm-row button, .hm-actions button")) e.preventDefault();
  });

  handleMenu.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const b = S.blocks.find(x => x.id === handleMenuBlock);
    if (!b) return;

    /* actions */
    if (btn.dataset.action === "duplicate"){
      const old = snapshot();
      const copy = JSON.parse(JSON.stringify(b));
      copy.id = uid();
      const i = S.blocks.findIndex(x => x.id === b.id);
      S.blocks.splice(i + 1, 0, copy);
      commit(old);
      render();
      setSelectedBlock(copy.id);
      closeHandleMenu();
      return;
    }
    if (btn.dataset.action === "delete"){
      if (S.blocks.length <= 1) { toast("Нельзя удалить последний блок"); return; }
      const old = snapshot();
      const i = S.blocks.findIndex(x => x.id === b.id);
      S.blocks.splice(i, 1);
      const nextId = S.blocks[Math.max(0, i - 1)]?.id || null;
      commit(old);
      render();
      setSelectedBlock(nextId);
      closeHandleMenu();
      return;
    }

    /* row-properties */
    const row = btn.closest(".hm-row");
    if (!row) return;
    const group = row.dataset.group;
    const val   = btn.dataset.val;

    const old = snapshot();

    if (group === "type"){
      b.type = val;
      if (val === "table"){
        b.rows = b.rows || [["",""],["",""]];
        b.content = "";
      } else if (val === "columns"){
        b.cols = b.cols || 2;
        b.content = Array.isArray(b.content) ? b.content : ["", ""];
      } else {
        if (typeof b.content !== "string") b.content = "";
        if (val === "code") b.content = htmlToText(b.content);
      }
    }
    else if (group === "bg"){
      b.bg = val;
    }
    else if (group === "font"){
      b.font = val;
    }
    else if (group === "indent"){
      b.indent = parseInt(val, 10) || 0;
    }

    commit(old);
    render();
    setSelectedBlock(b.id);
    syncHandleMenuState();
  });
}

/* клик по ручке — открыть меню (не мешает drag) */
document.addEventListener("click", e => {
  const handle = e.target.closest(".handle");
  if (!handle) return;
  const blockEl = handle.closest(".block");
  if (!blockEl) return;
  if (blockEl.classList.contains("dragging")) return;

  e.preventDefault();
  e.stopPropagation();

  const id = blockEl.dataset.id;
  active = id;
  setSelectedBlock(id);
  openHandleMenu(handle, id);
});

/* ---------- Снятие выделения при клике вне блока ---------- */

document.addEventListener("mousedown", e => {
  /* font menu */
  if (fontMenuOpen){
    if (!e.target.closest("#fontmenu") &&
        !e.target.closest('.floatbar button[data-cmd="font"]')){
      closeFontMenu();
    }
  }

  /* handle menu */
  if (handleMenuOpen){
    if (!e.target.closest("#handlemenu") &&
        !e.target.closest(".handle")){
      closeHandleMenu();
    }
  }

  /* снятие выделения блока */
  if (e.target.closest("#floatbar"))  return;
  if (e.target.closest("#palette"))   return;
  if (e.target.closest("#slash"))     return;
  if (e.target.closest("#fontmenu"))  return;
  if (e.target.closest("#handlemenu"))return;
  if (e.target.closest(".block"))     return;
  if (e.target.closest("header"))     return;
  if (e.target.closest(".title"))     return;

  clearSelection();
});

/* ---------- Global hotkeys ---------- */

document.addEventListener("keydown", e => {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (ctrl && key === "k"){ e.preventDefault(); openPalette(); }
  if (ctrl && key === "z"){
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  }
  if (ctrl && key === "y"){ e.preventDefault(); redo(); }
  if (ctrl && key === "f"){ e.preventDefault(); $("#find").focus(); }
  if (e.key === "Escape"){
    if (fontMenuOpen)        closeFontMenu();
    else if (handleMenuOpen) closeHandleMenu();
    else                     closeMenus();
  }
});

/* ---------- Image: file input ---------- */

$("#file").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > MAX_IMG_BYTES){
    if (!confirm("Изображение больше 3 МБ. Хранилище может быстро переполниться. Продолжить?")){
      e.target.value = "";
      return;
    }
  }
  const r = new FileReader();
  r.onload = () => {
    const old = snapshot();
    const i = S.blocks.findIndex(x => x.id === active);
    const b = block("image", r.result);
    S.blocks.splice(Math.max(0, i + 1), 0, b);
    active = b.id;
    commit(old);
    render();
    setSelectedBlock(b.id);
    save();
  };
  r.readAsDataURL(f);
  e.target.value = "";
};

/* ---------- Image: drag & drop в редактор ---------- */

$("#editor").addEventListener("dragover", e => {
  if ([...e.dataTransfer.items].some(x => x.kind === "file"))
    e.preventDefault();
});

$("#editor").addEventListener("drop", e => {
  const f = e.dataTransfer.files[0];
  if (!f?.type.startsWith("image/")) return;
  if (f.size > MAX_IMG_BYTES &&
      !confirm("Изображение больше 3 МБ. Хранилище может быстро переполниться. Продолжить?")){
    return;
  }
  e.preventDefault();
  const r = new FileReader();
  r.onload = () => {
    const old = snapshot();
    S.blocks.push(block("image", r.result));
    commit(old);
    render();
  };
  r.readAsDataURL(f);
});

/* ---------- Init ---------- */

load();
applySavedFonts();
render();
active = S.blocks[0]?.id;

})();