/* ============================================================
   menus.js — slash, palette, floatbar, font menu, handle menu,
              список документов, глобальный поиск
   Зависит от: utils, state, render, io, sidebar, tabs
   ============================================================ */

window.App = window.App || {};

window.App.menus = (() => {
"use strict";

const U = window.App.utils;
const {
  $,$$, types, htmlToText, uid, toast, escape,
  LINE_TYPES, newLine: newLineFn, shortId
} = U;

const St = () => window.App.state.S;
const setActive = v => window.App.state.setActive(v);
const setSlashBlockId = v => window.App.state.setSlashBlockId(v);
const getSlashBlockId = () => window.App.state.slashBlockId;
const setSelectedBlock = v => window.App.state.setSelectedBlock(v);
const setSelectedRange = (a, b) => window.App.state.setSelectedRange(a, b);
const clearSelectedRange = () => window.App.state.clearSelectedRange();
const clearSelection = () => window.App.state.clearSelection();

const snapshot = () => window.App.state.snapshot();
const commit = b => window.App.state.commit(b);
const commitDebounced = b => window.App.state.commitDebounced(b);
const save = () => window.App.state.save();
const saveNow = () => window.App.state.saveNow();
const undo = () => window.App.state.undo();
const redo = () => window.App.state.redo();
const getActiveDoc = () => window.App.state.getActiveDoc();

const render = () => window.App.render.render();
const add = (...a) => window.App.render.add(...a);
const focusActive = () => window.App.render.focusActive();

let lastRange         = null;
let fontMenuOpen      = false;
let handleMenuOpen    = false;
let handleMenuBlock   = null;
let markerMenuOpen    = false;
let floatbarDragging  = false;
let cmdIndex          = 0;
let lastCmdLen        = -1;
let slashBody         = null;
let paletteMode       = "commands";
let linesPanelOpen    = false;

const ALIGN_CMDS = new Set(["align-left","align-center","align-right"]);

/* ---------- Slash ---------- */

function openSlash(body, blockId){
  slashBody = body;
  setSlashBlockId(blockId);
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

/* ПАТЧ 2.3.1: при создании блока учитываем LINE_TYPES */
function slashChoose(type){
  const b = St().blocks.find(x => x.id === getSlashBlockId());
  if (b && b.type === "text"){
    const old = snapshot();
    b.type = type;
    if (type === "columns"){
      b.cols = 2;
      b.content = ["", ""];
      b.widths = [0.5, 0.5];
      b.gap = 14;
      b.valign = "top";
      b.padding = 0;
      b.lines = [];
    }
    else if (type === "table"){
      b.rows = [["",""],["",""]];
      b.content = "";
      b.lines = [];
    }
    else if (type === "ul" || type === "ol"){
      b.content = "<li><br></li>";
      b.lines = [];
      if (type === "ul" && !b.marker) b.marker = "disc";
    }
    else if (LINE_TYPES.has(type)){
      /* ПАТЧ 2.3.1: LINE_TYPE — создаём одну пустую строку */
      b.content = "";
      b.lines = [ newLineFn("") ];
    }
    else {
      b.content = "";
      b.lines = [];
    }
    commit(old);
    render();
    setActive(b.id);
    setSelectedBlock(b.id);
    focusActive();
  }
  setSlashBlockId(null);
  slashBody = null;
  $("#slash").style.display = "none";
}

/* ============================================================
   Command palette
   ============================================================ */

const commands = [
  ["Заблокировать сейчас", "Требуется пароль", "lock:now", "Навигация"],
  /* --- документы --- */
  ["Новый документ",       "Создать чистый",               "doc:new",            "Документы"],
  ["Новый из шаблона…",    "Заметка, Встреча, Рецепт…",    "doc:newTemplate",    "Документы"],
  ["Сохранить как шаблон", "Из текущего документа",        "doc:saveAsTemplate", "Документы"],
  ["Импорт шаблона…",      "Файл или JSON",                "doc:importTemplate", "Документы"],
  ["Экспорт всех шаблонов","Скачать .zip",                 "doc:exportTemplates","Документы"],
  ["Открыть документ…",    "Выбрать из списка",            "doc:open",           "Документы"],
  ["Переименовать",        "Изменить название текущего",   "doc:rename",         "Документы"],
  ["Дублировать",          "Копия текущего",               "doc:duplicate",      "Документы"],
  ["Свойства документа",   "Иконка, цвет, описание",       "doc:props",          "Документы"],
  ["В корзину",            "Удалить текущий",              "doc:trash",          "Документы"],
  ["Очистить корзину",     "Удалить навсегда",             "doc:emptyTrash",     "Документы"],

  /* --- блоки --- */
  ["Текст",              "Добавить абзац",               "block:text",        "Блоки"],
  ["Заголовок 1",        "Добавить H1",                  "block:h1",          "Блоки"],
  ["Заголовок 2",        "Добавить H2",                  "block:h2",          "Блоки"],
  ["Чек-лист",           "Добавить задачу",              "block:todo",        "Блоки"],
  ["Таблица",            "Добавить таблицу",             "block:table",       "Блоки"],
  ["Колонки",            "Добавить колонки",             "block:columns",     "Блоки"],
  ["Изображение",        "Добавить изображение",         "block:image",       "Блоки"],
  ["Разделитель",        "Горизонтальная линия",         "block:divider",     "Блоки"],
  ["Новый блок",         "Ctrl+Enter",                   "block:new",         "Блоки"],
  ["Удалить блок",       "Ctrl+Backspace",               "block:delete",      "Блоки"],

  /* --- форматирование --- */
  ["Жирный",             "Bold",                          "fmt:bold",          "Формат"],
  ["Курсив",             "Italic",                        "fmt:italic",        "Формат"],
  ["Подчёркнутый",       "Underline",                     "fmt:underline",     "Формат"],
  ["Зачёркнутый",        "Strike",                        "fmt:strike",        "Формат"],
  ["Убрать формат",      "Clear",                         "fmt:clear",         "Формат"],
  ["Маркированный список","Bullets",                      "fmt:bullets",       "Формат"],
  ["Нумерованный список","Numbered",                      "fmt:numbered",      "Формат"],

  /* --- файлы --- */
  ["Сохранить",          "Сохранить сейчас",              "file:save",         "Файл"],
  ["Экспорт HTML",       "Активный документ",             "file:exportHTML",   "Файл"],
  ["Экспорт Markdown",   "Активный документ",             "file:exportMD",     "Файл"],
  ["Экспорт JSON",       "Активный документ",             "file:exportJSON",   "Файл"],
  ["Экспорт PDF",        "Открыть печать активного",      "file:exportPDF",    "Файл"],
  ["Экспорт всех (.zip)","Все документы",                 "file:exportAll",    "Файл"],
  ["Импорт…",            "HTML / MD / JSON",              "file:import",       "Файл"],
  ["Печать / PDF",       "Открыть печать",                "file:print",        "Файл"],
  ["Сброс всех данных",  "Полная очистка хранилища",      "data:reset",        "Файл"],

  /* --- навигация --- */
  ["Поиск по содержимому","Все документы (Ctrl+Shift+F)", "nav:search",        "Навигация"],
  ["Строки блока",       "Ctrl+Shift+L",                  "lines:panel",       "Навигация"],
  ["Следующий документ", "Ctrl+Tab",                      "nav:nextDoc",       "Навигация"],
  ["Предыдущий документ","Ctrl+Shift+Tab",                "nav:prevDoc",       "Навигация"],
  ["Свернуть панель",    "Ctrl+\\",                       "nav:toggleSidebar", "Навигация"],

  /* --- шрифты --- */
  ["Шрифт: Inter",             "Основной, по умолчанию",  "font:body:Inter",          "Шрифты"],
  ["Шрифт: Open Sans",         "Основной, гуманистический","font:body:Open Sans",      "Шрифты"],
  ["Шрифт: Plus Jakarta Sans", "Основной, современный",   "font:body:Plus Jakarta Sans","Шрифты"],

  ["Шрифт H: Montserrat",      "Заголовки, геометрия",    "font:head:Montserrat",     "Шрифты"],
  ["Шрифт H: Manrope",         "Заголовки, сглаженный",   "font:head:Manrope",        "Шрифты"],
  ["Шрифт H: Outfit",          "Заголовки, премиум",      "font:head:Outfit",         "Шрифты"],
  ["Шрифт H: Inter",           "Заголовки, как текст",    "font:head:Inter",          "Шрифты"],

  ["Шрифт S: Lora",            "Каллиграфический",        "font:serif:Lora",          "Шрифты"],
  ["Шрифт S: PT Serif",        "Экранная антиква",        "font:serif:PT Serif",      "Шрифты"],
  ["Шрифт S: Merriweather",    "Для чтения",              "font:serif:Merriweather",  "Шрифты"],

  ["Шрифт M: JetBrains Mono",  "Код, по умолчанию",       "font:mono:JetBrains Mono", "Шрифты"],
  ["Шрифт M: Fira Code",       "Код, гуманистический",    "font:mono:Fira Code",      "Шрифты"],

  /* --- темы --- */
  ["Тема: Paper",      "Светлая бумага",            "theme:paper", "Темы"],
  ["Тема: Sepia",      "Тёплая бумага",             "theme:sepia", "Темы"],
  ["Тема: Mint",       "Мята",                      "theme:mint",  "Темы"],
  ["Тема: Dark",       "Тёмная",                    "theme:dark",  "Темы"]
];

function openPalette(initialMode){
  const p = $("#palette");
  const b = $("#backdrop");
  if (!p) return;

  p.style.display = "block";
  if (b) b.style.display = "block";

  const inp = $("#cmdinput");
  if (inp){
    inp.value = "";
    inp.placeholder = "Введите команду…  ·  > команды · # документы · / блоки · @ шрифты · ~ темы";
  }

  paletteMode = initialMode || "commands";
  cmdIndex = 0;
  lastCmdLen = -1;
  cmdRender();
  inp?.focus();
}

function closeMenus(){
  const p = $("#palette");
  const s = $("#slash");
  const b = $("#backdrop");
  if (p) p.style.display = "none";
  if (s) s.style.display = "none";
  if (b) b.style.display = "none";
  setSlashBlockId(null);
  paletteMode = "commands";
}

function detectMode(q){
  if (!q) return "commands";
  const c = q[0];
  if (c === ">") return "commands";
  if (c === "#") return "docs";
  if (c === "/") return "blocks";
  if (c === "@") return "fonts";
  if (c === "~") return "themes";
  return "mixed";
}

function stripPrefix(q){
  if (!q) return "";
  const c = q[0];
  if (">#/@~".includes(c)) return q.slice(1).trimStart();
  return q;
}

function cmdRender(){
  const inp = $("#cmdinput");
  if (!inp) return;

  const raw = inp.value;
  const mode = detectMode(raw);
  const q = stripPrefix(raw).toLowerCase();

  let html = "";

  if (mode === "docs" || (mode === "mixed" && !q) || mode === "commands"){
    if (mode === "docs"){
      html += renderDocsSection(q);
    }
  }

  if (mode === "commands" || mode === "mixed"){
    html += renderCommandsSection(q);
  }

  if (mode === "blocks"){
    html += renderBlocksSection(q);
  }

  if (mode === "fonts"){
    html += renderFontsSection(q);
  }

  if (mode === "themes"){
    html += renderThemesSection(q);
  }

  if (!html){
    html = `<div class="results-empty">Ничего не найдено</div>`;
  }

  const res = $("#cmdresults");
  res.innerHTML = html;

  $$("#cmdresults .result").forEach(el => {
    el.onclick = () => {
      const c = el.dataset.c;
      const d = el.dataset.doc;
      if (d) openDocById(d);
      else if (c) run(c);
    };
  });

  const items = $$("#cmdresults .result");
  if (items.length){
    if (cmdIndex >= items.length) cmdIndex = items.length - 1;
    if (cmdIndex < 0) cmdIndex = 0;
    items[cmdIndex]?.classList.add("sel");
  }
}

function renderCommandsSection(q){
  const arr = commands.filter(x =>
    !q || (x[0] + x[1] + x[3]).toLowerCase().includes(q));

  if (!arr.length) return "";

  let html = `<div class="results-group">Команды</div>`;
  html += arr.map((x, i) => {
    const sel = i === cmdIndex ? "sel" : "";
    return `<div class="result ${sel}" data-c="${x[2]}">
      <b>${escape(x[0])}</b>
      <small>${escape(x[3])}</small>
    </div>`;
  }).join("");
  return html;
}

function renderBlocksSection(q){
  const arr = types.filter(x =>
    !q || (x[0] + x[1] + x[2]).toLowerCase().includes(q));

  let html = `<div class="results-group">Блоки</div>`;
  html += arr.map((x, i) => {
    const sel = i === cmdIndex ? "sel" : "";
    return `<div class="result ${sel}" data-c="block:${x[0]}">
      <b>${escape(x[1])}</b><small>${escape(x[2])}</small>
    </div>`;
  }).join("");
  return html;
}

function renderFontsSection(q){
  const FONTS = [
    ["Inter","sans"],["Open Sans","sans"],["Plus Jakarta Sans","sans"],
    ["Montserrat","head"],["Manrope","head"],["Outfit","head"],
    ["Lora","serif"],["PT Serif","serif"],["Merriweather","serif"],
    ["JetBrains Mono","mono"],["Fira Code","mono"]
  ];
  const arr = FONTS.filter(f => !q || f[0].toLowerCase().includes(q));

  let html = `<div class="results-group">Шрифты</div>`;
  html += arr.map(([name, role], i) => {
    const sel = i === cmdIndex ? "sel" : "";
    return `<div class="result ${sel}" data-c="font:${role}:${name}">
      <b style="font-family:'${name}',system-ui,sans-serif">${name}</b>
      <small>${role}</small>
    </div>`;
  }).join("");
  return html;
}

function renderThemesSection(q){
  const THEMES = [
    ["paper","Светлая бумага"],["sepia","Тёплая бумага"],
    ["mint","Мята"],["dark","Тёмная"]
  ];
  const arr = THEMES.filter(t => !q || t[0].includes(q) || t[1].toLowerCase().includes(q));

  let html = `<div class="results-group">Темы</div>`;
  html += arr.map(([key, name], i) => {
    const sel = i === cmdIndex ? "sel" : "";
    return `<div class="result ${sel}" data-c="theme:${key}">
      <b>${name}</b><small>${key}</small>
    </div>`;
  }).join("");
  return html;
}

function renderDocsSection(q){
  const arr = window.App.state.listDocuments({ query: q }).slice(0, 30);

  let html = `<div class="results-group">Документы</div>`;

  if (!arr.length){
    html += `<div class="results-empty">Ничего не найдено</div>`;
    return html;
  }

  html += arr.map((d, i) => {
    const sel = i === cmdIndex ? "sel" : "";
    const title = escape(d.title || "Без названия");
    const meta = new Date(d.updatedAt).toLocaleDateString("ru-RU", { day:"2-digit", month:"short" });
    return `<div class="result ${sel}" data-doc="${d.id}">
      <b>${title}</b>
      <small>${meta}</small>
    </div>`;
  }).join("");

  return html;
}

async function openDocById(id){
  closeMenus();
  await window.App.state.setActiveDoc(id);
  window.App.tabs.render();
}

function run(c){
  closeMenus();

  if (c === "doc:new")       { window.App.sidebar?.createNewDocument(); return; }
  if (c === "doc:newTemplate"){ window.App.sidebar?.createFromTemplate(); return; }
  if (c === "doc:open")      { openPalette("docs"); return; }
  if (c === "lock:now"){ window.App.lock?.lock?.(); return; }
  if (c === "doc:saveAsTemplate"){
    const doc = getActiveDoc();
    if (doc) window.App.sidebar?.saveCurrentAsTemplate(doc.id);
    return;
  }
  if (c === "doc:importTemplate"){
    window.App.sidebar?.importTemplateDialog();
    return;
  }
  if (c === "doc:exportTemplates"){
    window.App.sidebar?.exportAllTemplates();
    return;
  }

  if (c === "doc:rename"){
    const doc = getActiveDoc();
    if (doc){
      const name = prompt("Новое название:", doc.title || "");
      if (name !== null){
        window.App.state.renameDocument(doc.id, name);
        window.App.tabs?.render();
        window.App.sidebar?.render();
      }
    }
    return;
  }

  if (c === "doc:duplicate"){
    const doc = getActiveDoc();
    if (doc){
      window.App.state.duplicateDocument(doc.id).then(() => {
        window.App.sidebar?.render();
        toast("Дубликат создан");
      });
    }
    return;
  }

  if (c === "doc:props"){
    const doc = getActiveDoc();
    if (doc) window.App.sidebar?.openProperties(doc.id);
    return;
  }

  if (c === "doc:trash"){
    const doc = getActiveDoc();
    if (doc){
      window.App.state.trashDocument(doc.id).then(() => {
        window.App.sidebar?.render();
        window.App.tabs?.render();
        toast("В корзине");
      });
    }
    return;
  }

  if (c === "doc:emptyTrash"){
    if (!confirm("Удалить все документы из корзины безвозвратно?")) return;
    window.App.state.emptyTrash().then(n => {
      window.App.sidebar?.render();
      toast(`Удалено: ${n}`);
    });
    return;
  }

  if (c.startsWith("block:")){
    const type = c.slice(6);

    /* ПАТЧ 2.3.1: block:new — создать блок после текущего */
    if (type === "new"){
      const activeEl = document.activeElement;
      const blockEl = activeEl?.closest?.(".block");
      if (blockEl){
        const bid = blockEl.dataset.id;
        const blocks = St().blocks;
        const idx = blocks.findIndex(b => b.id === bid);
        if (idx >= 0){ add("text", idx + 1); return; }
      }
      add("text");
      return;
    }

    if (type === "delete"){
      const ev = new KeyboardEvent("keydown", {
        key: "Backspace",
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true
      });
      (document.activeElement || document.body).dispatchEvent(ev);
      return;
    }

    if (["text","h1","h2","todo","table","columns","divider","image"].includes(type)){
      if (type === "image") window.App.io.openImagePicker();
      else add(type);
    }
    return;
  }

  if (c.startsWith("fmt:")){
    const cmd = c.slice(4);
    if (cmd === "clear"){
      document.execCommand("removeFormat", false, null);
      document.execCommand("unlink", false, null);
    } else if (cmd === "bullets"){
      toggleListForSelection("ul");
    } else if (cmd === "numbered"){
      toggleListForSelection("ol");
    } else {
      document.execCommand(cmd, false, null);
    }
    return;
  }

  if (c === "file:save")       { saveNow(); toast("Сохранено"); return; }
  if (c === "file:exportHTML") { window.App.io.downloadHTML(St().activeDocId); return; }
  if (c === "file:exportMD")   { window.App.io.downloadMD(St().activeDocId); return; }
  if (c === "file:exportJSON") { window.App.io.downloadJSON(St().activeDocId); return; }
  if (c === "file:exportPDF")  { window.App.io.downloadPDF(St().activeDocId); return; }
  if (c === "file:exportAll")  { window.App.io.downloadAllAsZip("html"); return; }
  if (c === "file:import")     { window.App.io.openImportPicker(); return; }
  if (c === "file:print")      { print(); return; }

  if (c === "data:reset"){
    if (!confirm("Удалить ВСЕ документы, папки и настройки?")) return;
    if (!confirm("Это действие необратимо. Продолжить?")) return;
    window.App.db.clearAll().then(() => {
      try { localStorage.clear(); } catch(e){}
      location.reload();
    });
    return;
  }

  if (c === "nav:search")      { openGlobalSearch(); return; }
  if (c === "lines:panel")     { openLinesPanel(); return; }
  if (c === "nav:nextDoc")     { window.App.tabs?.nextTab(); return; }
  if (c === "nav:prevDoc")     { window.App.tabs?.prevTab(); return; }
  if (c === "nav:toggleSidebar"){ window.App.sidebar?.toggleSidebar(); return; }

  if (c.startsWith("font:")){
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

    if (!St().fonts) St().ui.fonts = {};
    St().ui.fonts[role] = name;
    window.App.state.setUI("fonts", St().ui.fonts);
    save();
    toast(`Шрифт: ${name}`);
    return;
  }

  if (c.startsWith("theme:")){
    const old = snapshot();
    window.App.state.setUI("theme", c.slice(6));
    commit(old);
    render();
    return;
  }
}

/* ---------- Глобальный поиск по содержимому ---------- */

function openGlobalSearch(){
  const p = $("#palette");
  const b = $("#backdrop");
  if (!p) return;

  p.style.display = "block";
  if (b) b.style.display = "block";

  const inp = $("#cmdinput");
  if (inp){
    inp.value = "# ";
    inp.placeholder = "Поиск по всем документам…";
  }
  paletteMode = "search";
  cmdIndex = 0;
  lastCmdLen = -1;
  globalSearchRender("");
  inp?.focus();
}

function globalSearchRender(q){
  const query = q.toLowerCase().trim();
  const res = $("#cmdresults");
  if (!res) return;

  if (!query){
    res.innerHTML = `<div class="results-group">Введите запрос</div>`;
    return;
  }

  const hits = [];
  for (const id of Object.keys(St().documents)){
    const doc = St().documents[id];
    if (doc.trashed) continue;

    if ((doc.title || "").toLowerCase().includes(query) ||
        (doc.description || "").toLowerCase().includes(query)){
      hits.push({ doc, snippet: doc.title });
      continue;
    }

    for (const b of doc.blocks || []){
      let text = "";
      /* ПАТЧ 2.3.1: учитываем строки */
      if (Array.isArray(b.lines) && b.lines.length){
        text = b.lines.map(l => htmlToText(l.text || "")).join(" ");
      } else {
        text = htmlToText(b.content || "");
      }
      if (text.toLowerCase().includes(query)){
        const idx = text.toLowerCase().indexOf(query);
        const snippet = text.slice(Math.max(0, idx - 30), idx + 60);
        hits.push({ doc, snippet });
        break;
      }
    }

    if (hits.length >= 40) break;
  }

  if (!hits.length){
    res.innerHTML = `<div class="results-empty">Ничего не найдено</div>`;
    return;
  }

  let html = `<div class="results-group">Найдено: ${hits.length}</div>`;
  html += hits.map((h, i) => {
    const sel = i === cmdIndex ? "sel" : "";
    const title = escape(h.doc.title || "Без названия");
    const sn = escape(h.snippet || "").replace(new RegExp(query,"ig"), m => `<mark>${m}</mark>`);
    return `<div class="result ${sel}" data-doc="${h.doc.id}">
      <b>${title}</b>
      <small>${sn}</small>
    </div>`;
  }).join("");

  res.innerHTML = html;

  $$("#cmdresults .result").forEach(el => {
    el.onclick = () => {
      const id = el.dataset.doc;
      if (id) openDocById(id);
    };
  });
}

/* ============================================================
   ПАТЧ 2.3.1: панель строк (Ctrl+F)
   ============================================================ */

/* Открывает панель со списком строк текущего блока (или всех блоков),
   показывает их id / customId, кнопки копирования, перехода */
function openLinesPanel(){
  const panel = $("#lines-panel");
  if (!panel){
    /* Fallback: если нет элемента в HTML — открываем palette с командой */
    openPalette();
    return;
  }

  const activeEl = document.activeElement;
  const blockEl = activeEl?.closest?.(".block");
  let b = null;
  if (blockEl){
    b = St().blocks.find(x => x.id === blockEl.dataset.id);
  }
  /* Если не нашли — берём первый LINE_TYPE блок */
  if (!b || !LINE_TYPES.has(b.type)){
    b = St().blocks.find(x => LINE_TYPES.has(x.type));
  }

  if (!b){
    toast("Нет строк в документе");
    return;
  }

  panel.dataset.blockId = b.id;

  const list = $("#lines-panel-list");
  if (!list) return;

  if (!Array.isArray(b.lines) || !b.lines.length){
    list.innerHTML = `<div class="lsp-empty">Нет строк</div>`;
  } else {
    list.innerHTML = b.lines.map((ln, i) => {
      const id = ln.customId || ln.id;
      const text = htmlToText(ln.text || "") || "(пусто)";
      return `
        <div class="lsp-item" data-line-id="${escape(id)}" data-line-index="${i}">
          <span class="lsp-num">${i + 1}</span>
          <span class="lsp-text">${escape(text.slice(0, 60))}</span>
          <span class="lsp-id">#${escape(id)}</span>
          <button class="lsp-btn" data-action="copy-id"     title="Копировать ID">ID</button>
          <button class="lsp-btn" data-action="copy-link"   title="Копировать ссылку">🔗</button>
          <button class="lsp-btn" data-action="edit-id"     title="Изменить ID">✎</button>
          <button class="lsp-btn danger" data-action="remove-id" title="Удалить ID">✗</button>
        </div>`;
    }).join("");
  }

  /* Заголовок панели — ссылка на весь блок */
  const head = $("#lines-panel-head");
  if (head){
    const doc = getActiveDoc();
    const blockId = b.customId || b.id;
    head.innerHTML = `
      <div class="lsp-title">Строки блока</div>
      <div class="lsp-block">
        #${escape(blockId)}
        <button class="lsp-btn" data-action="copy-block-id"   title="Копировать ID блока">ID</button>
        <button class="lsp-btn" data-action="copy-block-link" title="Копировать ссылку на блок">🔗</button>
      </div>`;
  }

  panel.style.display = "block";
  linesPanelOpen = true;
}

function closeLinesPanel(){
  const panel = $("#lines-panel");
  if (panel) panel.style.display = "none";
  linesPanelOpen = false;
}

function isLinesPanelOpen(){ return linesPanelOpen; }

/* ============================================================
   Списки: работа на уровне блоков
   ============================================================ */

function getSelectedBlockRange(){
  const sel = getSelection();
  if (!sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const blockEls = $$("#editor .block");
  return blockEls.filter(w => {
    try { return range.intersectsNode(w); } catch(e){ return false; }
  });
}

function listItemsHTML(content){
  const tmp = document.createElement("div");
  tmp.innerHTML = content || "";
  const lis = [...tmp.querySelectorAll("li")];
  return lis.map(li => li.innerHTML || "<br>");
}

function blockToOneLi(b){
  if (b.type === "ul" || b.type === "ol"){
    return listItemsHTML(b.content);
  }
  /* ПАТЧ 2.3.1: если у блока есть строки — берём их */
  if (Array.isArray(b.lines) && b.lines.length){
    return b.lines.map(l => l.text || "<br>");
  }
  return [b.content || "<br>"];
}

function mergeBlocksIntoList(ids, kind, marker){
  const blocks = St().blocks;
  const indices = ids
    .map(id => blocks.findIndex(b => b.id === id))
    .filter(i => i >= 0)
    .sort((a, b) => a - b);
  if (!indices.length) return;

  const firstIdx = indices[0];
  const lastIdx  = indices[indices.length - 1];

  const items = [];
  for (let i = firstIdx; i <= lastIdx; i++){
    const b = blocks[i];
    if (!b) continue;
    blockToOneLi(b).forEach(html => items.push(html));
  }

  const newBlock = U.block(kind, "");
  newBlock.content = items.map(h => `<li>${h}</li>`).join("");
  newBlock.lines = [];
  if (kind === "ul") newBlock.marker = marker || "disc";

  const src = blocks[firstIdx];
  newBlock.bg     = src.bg     || "";
  newBlock.font   = src.font   || "";
  newBlock.indent = src.indent || 0;
  newBlock.align  = src.align  || "left";

  blocks.splice(firstIdx, lastIdx - firstIdx + 1, newBlock);
  return newBlock;
}

function splitListBlock(block){
  const blocks = St().blocks;
  const i = blocks.findIndex(b => b.id === block.id);
  if (i < 0) return null;

  const items = listItemsHTML(block.content);
  if (!items.length){
    const text = U.block("text", "");
    text.bg     = block.bg     || "";
    text.font   = block.font   || "";
    text.indent = block.indent || 0;
    text.align  = block.align  || "left";
    blocks.splice(i, 1, text);
    return text;
  }

  const replacements = items.map(html => {
    const t = U.block("text", html === "<br>" ? "" : html);
    t.bg     = block.bg     || "";
    t.font   = block.font   || "";
    t.indent = block.indent || 0;
    t.align  = block.align  || "left";
    return t;
  });
  blocks.splice(i, 1, ...replacements);
  return replacements[0];
}

function classifySelection(blocks){
  const allUl = blocks.length && blocks.every(b =>
    b.type === "ul" &&
    (b.marker || "disc") === (blocks[0].marker || "disc"));
  const allOl = blocks.length && blocks.every(b => b.type === "ol");
  return { allUl, allOl };
}

function toggleListForSelection(kind, marker){
  const els = getSelectedBlockRange();
  let blocks;

  if (els.length){
    const ids = els.map(w => w.dataset.id);
    blocks = St().blocks.filter(b => ids.includes(b.id));
  } else {
    const b = getBlockUnderCaret();
    if (!b) return;
    blocks = [b];
  }

  if (!blocks.length) return;

  const { allUl, allOl } = classifySelection(blocks);
  const old = snapshot();

  if (kind === "ul" && allUl && (blocks[0].marker || "disc") === (marker || "disc")){
    const first = blocks[0];
    splitListBlock(first);
    for (let k = 1; k < blocks.length; k++){
      const b = blocks[k];
      if (b.type === "ul") splitListBlock(b);
    }
  } else if (kind === "ol" && allOl){
    blocks.forEach(b => splitListBlock(b));
  } else {
    const ids = blocks.map(b => b.id);
    const nb = mergeBlocksIntoList(ids, kind, marker);
    if (nb) setActive(nb.id);
  }

  commit(old);
  render();
  if (blocks[0]?.id) setSelectedBlock(blocks[0].id);
  setTimeout(() => focusActive(), 0);
}

function applyMarkerToSelection(marker){
  toggleListForSelection("ul", marker || "disc");
}
function applyOlToSelection(){
  toggleListForSelection("ol");
}

/* ---------- Strike ---------- */

const STRIKE_TAGS = ["S","STRIKE","DEL"];

function selectionHasStrike(){
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const frag = range.cloneContents();
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node){
    if (STRIKE_TAGS.includes(node.tagName)) return true;
    node = walker.nextNode();
  }
  const anchor = sel.anchorNode?.parentElement;
  if (anchor?.closest?.("s, strike, del")) return true;
  return false;
}

function applyStrike(){
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;

  if (selectionHasStrike()){
    document.execCommand("strikeThrough", false, null);
    const range = sel.getRangeAt(0);
    unwrapTagsInRange(range, STRIKE_TAGS);
  } else {
    document.execCommand("strikeThrough", false, null);
  }
}

function unwrapTagsInRange(range, tags){
  const container = range.commonAncestorContainer;
  const root = container.nodeType === 1 ? container : container.parentElement;
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toUnwrap = [];
  let n = walker.nextNode();
  while (n){
    if (tags.includes(n.tagName)) toUnwrap.push(n);
    n = walker.nextNode();
  }
  toUnwrap.forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
}

/* ---------- Floatbar ---------- */

function bindFloatbar(){
  $$(".floatbar button").forEach(b => {
    b.onmousedown = e => {
      floatbarDragging = true;
      const s = getSelection();
      if (s.rangeCount && !s.isCollapsed){
        lastRange = s.getRangeAt(0).cloneRange();
      }
      e.preventDefault();
    };

    b.onclick = () => {
      try {
        restoreLastRange();

        const cmd = b.dataset.cmd;

        if (cmd === "font"){
          openFontMenu(b);
          return;
        }

        if (ALIGN_CMDS.has(cmd)){
          const els = getSelectedBlockRange();
          const ids = els.length
            ? els.map(w => w.dataset.id)
            : (() => {
                const blk = getActiveBlockForToolbar();
                return blk ? [blk.id] : [];
              })();
          if (ids.length){
            const old = snapshot();
            ids.forEach(id => {
              const blk = St().blocks.find(x => x.id === id);
              if (blk) blk.align =
                cmd === "align-left"   ? "left"   :
                cmd === "align-center" ? "center" : "right";
            });
            commit(old);
            render();
          }
          restoreLastRange();
          updateFloatbarState();
          return;
        }

        if (cmd === "bullets"){
          toggleMarkerMenu(b);
          return;
        }
        if (cmd === "numbered"){
          applyOlToSelection();
          updateFloatbarState();
          return;
        }

        if (cmd === "strike"){
          applyStrike();
          syncContentFromSelection();
          updateFloatbarState();
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
          const blk = getActiveBlockForToolbar();
          if (blk){
            const old = snapshot();
            blk.type = "h1";
            commit(old);
            render();
            setSelectedBlock(blk.id);
            setTimeout(() => {
              focusActive();
              updateFloatbarState();
            }, 0);
          }
          return;
        }
        else {
          document.execCommand(cmd, false, null);
        }

        restoreLastRange();
        syncContentFromSelection();
        updateFloatbarState();
      } finally {
        floatbarDragging = false;
      }
    };
  });
}

function getBlockUnderCaret(){
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const node = sel.anchorNode;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const wrap = el?.closest(".block");
  return St().blocks.find(x => x.id === wrap?.dataset.id) || null;
}

function getBlockFromLastRange(){
  if (!lastRange) return null;
  const node = lastRange.startContainer;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const wrap = el?.closest(".block");
  return St().blocks.find(x => x.id === wrap?.dataset.id) || null;
}

function getActiveBlockForToolbar(){
  return getBlockUnderCaret()
      || getBlockFromLastRange()
      || (St().selectedId
            ? St().blocks.find(b => b.id === St().selectedId) || null
            : null);
}

function syncContentFromSelection(){
  const blk = getActiveBlockForToolbar();
  if (!blk) return;
  const sel = getSelection();
  const node = sel.anchorNode?.parentElement;
  /* ПАТЧ 2.3.1: для LINE_TYPES содержимое в .line, а не в .body */
  const lineEl = node?.closest?.(".line");
  if (lineEl && blk.lines){
    const idx = parseInt(lineEl.dataset.lineIndex, 10);
    if (blk.lines[idx]){
      blk.lines[idx].text = window.App.render.toSourceHTML(lineEl.innerHTML);
      blk.content = blk.lines.map(l => l.text).join("<br>");
      save();
      commitDebounced(snapshot());
      return;
    }
  }
  const body = node?.closest(".body")
    || lastRange?.startContainer?.parentElement?.closest?.(".body");
  if (body){
    window.App.render.cleanupEmptyLis(body);
    blk.content = window.App.render.toSourceHTML(body.innerHTML);
    save();
    commitDebounced(snapshot());
  }
}

function restoreLastRange(){
  if (!lastRange) return;
  try {
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(lastRange);
  } catch(e){}
}

function updateFloatbarState(){
  const checks = {
    bold:      document.queryCommandState("bold"),
    italic:    document.queryCommandState("italic"),
    underline: document.queryCommandState("underline")
  };

  const blk = getActiveBlockForToolbar();
  const strikeOn = selectionHasStrike();

  $$(".floatbar button").forEach(b => {
    const cmd = b.dataset.cmd;
    if (cmd in checks){
      b.classList.toggle("on", !!checks[cmd]);
      return;
    }
    if (cmd === "strike")       b.classList.toggle("on", strikeOn);
    if (cmd === "align-left")   b.classList.toggle("on", !blk || blk.align === "left" || !blk.align);
    if (cmd === "align-center") b.classList.toggle("on", blk?.align === "center");
    if (cmd === "align-right")  b.classList.toggle("on", blk?.align === "right");
    if (cmd === "numbered")     b.classList.toggle("on", blk?.type === "ol");
    if (cmd === "bullets")      b.classList.toggle("on", blk?.type === "ul");
  });
}

/* ---------- Marker menu ---------- */

function toggleMarkerMenu(anchor){
  const menu = $("#markermenu");
  if (!menu) return;

  if (markerMenuOpen){
    closeMarkerMenu();
    return;
  }

  menu.dataset.display = "flex";
  menu.style.display = "flex";

  const r = anchor.getBoundingClientRect();
  U.positionFloating(menu, r, { preferBelow: true, gap: 6, margin: 8 });

  menu.querySelectorAll("button").forEach(btn => {
    btn.classList.remove("on");
    btn.onmousedown = e => e.preventDefault();
    btn.onclick = () => {
      const m = btn.dataset.marker;
      applyMarkerToSelection(m === "none" ? "" : m);
      closeMarkerMenu();
    };
  });

  markerMenuOpen = true;
}

function closeMarkerMenu(){
  const menu = $("#markermenu");
  if (menu) menu.style.display = "none";
  markerMenuOpen = false;
}

/* ---------- Font menu ---------- */

const FONT_LIST = [
  { group: "Основной",  name: "Inter",            tag: "sans" },
  { group: "Основной",  name: "Open Sans",        tag: "sans" },
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

  menu.dataset.display = "block";
  menu.style.display = "block";

  const r = anchor.getBoundingClientRect();
  U.positionFloating(menu, r, { preferBelow: true, gap: 6, margin: 8 });

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
  syncContentFromSelection();
  toast(`Шрифт: ${name}`);
}

/* ============================================================
   Handle menu
   ============================================================ */

function fillIdSection(b){
  const idValue = document.getElementById("hm-id-value");
  const idInput = document.getElementById("hm-id-input");
  if (!idValue || !idInput) return;

  idValue.textContent = b.customId || b.id;
  idValue.hidden = false;
  idInput.hidden = true;
  idInput.value = "";
}

function bindIdInputOnce(){
  const idInput = document.getElementById("hm-id-input");
  const idValue = document.getElementById("hm-id-value");
  if (!idInput || idInput.dataset.bound) return;
  idInput.dataset.bound = "1";

  const commitId = () => {
    const b = St().blocks.find(x => x.id === handleMenuBlock);
    if (!b) return;

    const raw = String(idInput.value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, "")
      .slice(0, 64);

    if (!raw || raw === b.id){
      const old = snapshot();
      b.customId = "";
      commit(old);
      render();
      setSelectedBlock(b.id);
      idValue.textContent = b.id;
      return;
    }

    const doc = getActiveDoc();
    const dup = doc?.blocks.find(x =>
      x.id !== b.id && (x.customId === raw || x.id === raw)
    );

    let finalId = raw;
    if (dup){
      let n = 2;
      while (doc.blocks.some(x =>
        x.id !== b.id && (x.customId === `${raw}-${n}` || x.id === `${raw}-${n}`)
      )){
        n++;
      }
      finalId = `${raw}-${n}`;
      toast(`ID занят, использован #${finalId}`);
    }

    const old = snapshot();
    b.customId = finalId;
    commit(old);
    render();
    setSelectedBlock(b.id);
    idValue.textContent = finalId;
  };

  idInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter"){
      e.preventDefault();
      commitId();
      idInput.hidden = true;
      idValue.hidden = false;
    } else if (e.key === "Escape"){
      e.preventDefault();
      idInput.hidden = true;
      idValue.hidden = false;
      const b = St().blocks.find(x => x.id === handleMenuBlock);
      if (b) idValue.textContent = b.customId || b.id;
    }
  });

  idInput.addEventListener("blur", () => {
    if (!idInput.hidden){
      commitId();
      idInput.hidden = true;
      idValue.hidden = false;
    }
  });
}

function openHandleMenu(anchor, blockId){
  const menu = $("#handlemenu");
  if (!menu) return;

  handleMenuBlock = blockId;

  const b = St().blocks.find(x => x.id === blockId);

  const markerSection = menu.querySelector('[data-section="marker"]');
  if (markerSection) markerSection.hidden = (b?.type !== "ul");

  const colsSection = menu.querySelector('[data-section="columns"]');
  if (colsSection){
    colsSection.hidden = (b?.type !== "columns");
    if (b?.type === "columns") fillColsRatioButtons(colsSection, b);
  }

  /* ПАТЧ 2.3.1: секция «Строки» — только для LINE_TYPES с 2+ строками */
  const linesSection = menu.querySelector('[data-section="lines"]');
  if (linesSection){
    const showLines = b && LINE_TYPES.has(b.type) && Array.isArray(b.lines) && b.lines.length > 1;
    linesSection.hidden = !showLines;
    if (showLines) fillLinesList(linesSection, b);
  }

  if (b) fillIdSection(b);

  menu.dataset.display = "block";
  menu.style.display = "block";

  const r = anchor.getBoundingClientRect();
  U.positionFloating(menu, r, { preferBelow: true, gap: 6, margin: 8 });

  syncHandleMenuState();
  handleMenuOpen = true;
}

function closeHandleMenu(){
  const menu = $("#handlemenu");
  if (menu) menu.style.display = "none";

  const idInput = document.getElementById("hm-id-input");
  const idValue = document.getElementById("hm-id-value");
  if (idInput && idValue){
    idInput.hidden = true;
    idValue.hidden = false;
  }

  handleMenuOpen = false;
  handleMenuBlock = null;
}

/* ПАТЧ 2.3.1: заполняет секцию «Строки» списком строк блока */
function fillLinesList(section, b){
  const list = section.querySelector('[data-group="lines-list"]');
  if (!list) return;

  list.innerHTML = b.lines.map((ln, i) => {
    const id = ln.customId || ln.id;
    const text = htmlToText(ln.text || "") || "(пусто)";
    return `
      <div class="hm-line-row" data-line-id="${escape(id)}" data-line-index="${i}">
        <span class="hm-line-num">${i + 1}</span>
        <span class="hm-line-text">${escape(text.slice(0, 40))}</span>
        <span class="hm-line-id">#${escape(id)}</span>
        <button class="hm-id-btn" data-action="line-copy-id"   type="button" title="Копировать ID строки">ID</button>
        <button class="hm-id-btn" data-action="line-copy-link" type="button" title="Копировать ссылку на строку">🔗</button>
        <button class="hm-id-btn" data-action="line-edit-id"   type="button" title="Изменить ID строки">✎</button>
        <button class="hm-id-btn" data-action="line-remove-id" type="button" title="Удалить ID строки">✗</button>
      </div>`;
  }).join("");
}

function fillColsRatioButtons(section, b){
  if (!section) return;
  const row = section.querySelector('[data-group="cols-ratio"]');
  if (!row) return;
  row.innerHTML = "";

  const presets = {
    2: [
      { label: "1:1", w: [1,1] },
      { label: "2:1", w: [2,1] },
      { label: "1:2", w: [1,2] },
      { label: "3:1", w: [3,1] }
    ],
    3: [
      { label: "1:1:1", w: [1,1,1] },
      { label: "2:1:1", w: [2,1,1] },
      { label: "1:2:1", w: [1,2,1] },
      { label: "1:1:2", w: [1,1,2] }
    ],
    4: [
      { label: "1:1:1:1", w: [1,1,1,1] }
    ]
  };

  const arr = presets[b.cols] || presets[2];
  arr.forEach(p => {
    const btn = document.createElement("button");
    btn.dataset.val = JSON.stringify(p.w);
    btn.textContent = p.label;
    btn.style.fontFamily = "var(--font-mono-current)";
    btn.style.fontSize = "11.5px";

    const sum = p.w.reduce((a,x)=>a+x,0) || 1;
    const cur = b.widths || [];
    const sumCur = cur.reduce((a,x)=>a+x,0) || 1;
    const same = cur.length === p.w.length &&
      p.w.every((w, i) => Math.abs(w/sum - cur[i]/sumCur) < 0.03);
    if (same) btn.classList.add("on");

    btn.onmousedown = e => e.preventDefault();
    row.append(btn);
  });
}

function syncHandleMenuState(){
  const menu = $("#handlemenu");
  if (!menu || !handleMenuBlock) return;

  const b = St().blocks.find(x => x.id === handleMenuBlock);
  if (!b) return;

  menu.querySelectorAll("[data-group]").forEach(groupEl => {
    const group = groupEl.dataset.group;
    /* пропускаем список строк и динамические кнопки пресетов */
    if (group === "lines-list" || group === "cols-ratio") return;

    groupEl.querySelectorAll("button").forEach(btn => {
      const val = btn.dataset.val;
      let on = false;

      if (group === "type")   on = (b.type === val);
      if (group === "bg")     on = ((b.bg || "") === val);
      if (group === "font")   on = ((b.font || "") === val);
      if (group === "indent") on = (String(b.indent || 0) === val);
      if (group === "marker") on = ((b.marker || "disc") === val);
      if (group === "cols-count")  on = (String(b.cols) === val);
      if (group === "cols-valign") on = ((b.valign || "top") === val);
      if (group === "cols-gap")    on = (String(b.gap ?? 14) === val);

      btn.classList.toggle("on", on);
    });
  });
}

/* ============================================================
   Bind UI
   ============================================================ */

function bindMenus(){
  const slashInput = $("#slashinput");
  if (slashInput){
    slashInput.oninput = slashRender;
    slashInput.onkeydown = e => {
      if (e.key === "Escape"){ setSlashBlockId(null); closeMenus(); }
      if (e.key === "Enter") $$("#slashresults .result")[0]?.click();
    };
  }

  const cmdInput = $("#cmdinput");
  if (cmdInput){
    cmdInput.oninput = () => {
      const raw = cmdInput.value;
      const mode = detectMode(raw);
      if (paletteMode === "search" || mode === "docs"){
        globalSearchRender(stripPrefix(raw));
      } else {
        cmdIndex = 0;
        cmdRender();
      }
    };

    cmdInput.onkeydown = e => {
      const items = $$("#cmdresults .result");
      const n = items.length;

      if (e.key === "ArrowDown"){
        e.preventDefault();
        if (!n) return;
        cmdIndex = (cmdIndex + 1) % n;
        rerenderPalette();
      } else if (e.key === "ArrowUp"){
        e.preventDefault();
        if (!n) return;
        cmdIndex = (cmdIndex + n - 1) % n;
        rerenderPalette();
      } else if (e.key === "Enter"){
        e.preventDefault();
        if (!n) return;
        items[Math.min(cmdIndex, n - 1)]?.click();
      } else if (e.key === "Escape"){
        closeMenus();
      }
    };
  }

  function rerenderPalette(){
    const raw = cmdInput.value;
    const mode = detectMode(raw);
    if (paletteMode === "search" || mode === "docs"){
      globalSearchRender(stripPrefix(raw));
    } else {
      cmdRender();
    }
    const items = $$("#cmdresults .result");
    items.forEach((el, i) => el.classList.toggle("sel", i === cmdIndex));
  }

  const backdrop = $("#backdrop");
  if (backdrop) backdrop.onclick = closeMenus;

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

  bindIdInputOnce();

  const handleMenu = $("#handlemenu");
  if (handleMenu){
    handleMenu.addEventListener("mousedown", e => {
      if (e.target.closest("[data-group] button, .hm-actions button, .hm-id-btn, .hm-id-input, .hm-line-row button")) {
        e.preventDefault();
      }
    });

    handleMenu.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const b = St().blocks.find(x => x.id === handleMenuBlock);
      if (!b) return;

      /* ============================================================
         ПАТЧ 2.3.1: действия со строками
         ============================================================ */
      const lineRow = btn.closest(".hm-line-row");
      if (lineRow){
        const lineIdx = parseInt(lineRow.dataset.lineIndex, 10);
        const ln = b.lines && b.lines[lineIdx];
        if (!ln) return;

        const action = btn.dataset.action;
        if (action === "line-copy-id"){
          const id = ln.customId || ln.id;
          navigator.clipboard.writeText(id).then(
            () => toast("ID строки скопирован: " + id),
            () => toast("Не удалось скопировать")
          );
          return;
        }
        if (action === "line-copy-link"){
          const doc = getActiveDoc();
          const blockId = b.customId || b.id;
          const lineId = ln.customId || ln.id;
          const title = doc?.title || "Без названия";
          const link = `[[${title}#${blockId}#${lineId}]]`;
          navigator.clipboard.writeText(link).then(
            () => toast("Ссылка на строку скопирована"),
            () => toast("Не удалось скопировать")
          );
          return;
        }
        if (action === "line-edit-id"){
          const newId = prompt("Новый ID строки:", ln.customId || ln.id);
          if (newId === null) return;
          const clean = String(newId).trim().toLowerCase().replace(/[^a-z0-9\-_]/g, "").slice(0, 64);
          const old = snapshot();
          if (!clean || clean === ln.id){
            ln.customId = "";
          } else {
            /* Проверка уникальности в документе */
            const doc = getActiveDoc();
            let final = clean;
            let n = 2;
            while (doc.blocks.some(x => (x.lines || []).some(l =>
              l !== ln && (l.customId === final || l.id === final)
            ))){
              final = `${clean}-${n}`;
              n++;
            }
            ln.customId = final;
          }
          commit(old);
          render();
          setSelectedBlock(b.id);
          fillLinesList(handleMenu.querySelector('[data-section="lines"]'), b);
          return;
        }
        if (action === "line-remove-id"){
          if (!ln.customId) return;
          const old = snapshot();
          ln.customId = "";
          commit(old);
          render();
          setSelectedBlock(b.id);
          fillLinesList(handleMenu.querySelector('[data-section="lines"]'), b);
          return;
        }
      }

      /* --- Стандартные действия handle-menu --- */
      if (btn.dataset.action === "copy-id"){
        const id = b.customId || b.id;
        navigator.clipboard.writeText(id).then(
          () => toast("ID скопирован: " + id),
          () => toast("Не удалось скопировать")
        );
        return;
      }

      if (btn.dataset.action === "copy-link"){
        const doc = getActiveDoc();
        const id = b.customId || b.id;
        const title = doc?.title || "Без названия";
        const link = `[[${title}#${id}]]`;
        navigator.clipboard.writeText(link).then(
          () => toast("Ссылка скопирована"),
          () => toast("Не удалось скопировать")
        );
        return;
      }

      if (btn.dataset.action === "edit-id"){
        const idValue = document.getElementById("hm-id-value");
        const idInput = document.getElementById("hm-id-input");
        if (!idValue || !idInput) return;
        idInput.value = b.customId || b.id;
        idValue.hidden = true;
        idInput.hidden = false;
        idInput.focus();
        idInput.select();
        return;
      }

      if (btn.dataset.action === "duplicate"){
        const old = snapshot();
        const copy = JSON.parse(JSON.stringify(b));
        copy.id = shortId();
        copy.customId = "";
        /* ПАТЧ 2.3.1: регенерируем lineId, чтобы не было дубликатов */
        if (Array.isArray(copy.lines)){
          for (const ln of copy.lines){
            ln.id = shortId();
            ln.customId = "";
            if (Array.isArray(ln.fragments)){
              ln.fragments = ln.fragments.map(f => ({ ...f, id: shortId(), customId: "" }));
            }
          }
        }
        const i = St().blocks.findIndex(x => x.id === b.id);
        St().blocks.splice(i + 1, 0, copy);
        commit(old);
        render();
        setSelectedBlock(copy.id);
        closeHandleMenu();
        return;
      }

      if (btn.dataset.action === "delete"){
        if (St().blocks.length <= 1) { toast("Нельзя удалить последний блок"); return; }
        const old = snapshot();
        const i = St().blocks.findIndex(x => x.id === b.id);
        St().blocks.splice(i, 1);
        const nextId = St().blocks[Math.max(0, i - 1)]?.id || null;
        commit(old);
        render();
        setSelectedBlock(nextId);
        closeHandleMenu();
        return;
      }

      const groupContainer = btn.closest("[data-group]");
      if (!groupContainer) return;
      const group = groupContainer.dataset.group;
      const val   = btn.dataset.val;

      if (group === "cols-count"){
        const n = parseInt(val, 10);
        if (![2,3,4].includes(n)) return;
        const old = snapshot();
        b.cols = n;
        const arr = Array.isArray(b.content) ? b.content.slice(0, n) : [];
        while (arr.length < n) arr.push("");
        b.content = arr;
        const w = Array.isArray(b.widths) ? b.widths.slice(0, n) : [];
        while (w.length < n) w.push(1);
        const sum = w.reduce((a,x)=>a+x,0) || 1;
        b.widths = w.map(x => x / sum);
        commit(old);
        render();
        setSelectedBlock(b.id);
        fillColsRatioButtons(handleMenu.querySelector('[data-section="columns"]'), b);
        syncHandleMenuState();
        return;
      }

      if (group === "cols-ratio"){
        let w;
        try { w = JSON.parse(val); } catch(e){ return; }
        if (!Array.isArray(w) || w.length !== b.cols) return;
        const old = snapshot();
        const sum = w.reduce((a,x)=>a+x,0) || 1;
        b.widths = w.map(x => x / sum);
        commit(old);
        render();
        setSelectedBlock(b.id);
        fillColsRatioButtons(handleMenu.querySelector('[data-section="columns"]'), b);
        syncHandleMenuState();
        return;
      }

      if (group === "cols-valign"){
        const old = snapshot();
        b.valign = val;
        commit(old);
        render();
        setSelectedBlock(b.id);
        syncHandleMenuState();
        return;
      }

      if (group === "cols-gap"){
        const old = snapshot();
        b.gap = parseInt(val, 10) || 0;
        commit(old);
        render();
        setSelectedBlock(b.id);
        syncHandleMenuState();
        return;
      }

      const old = snapshot();

      if (group === "type"){
        b.type = val;
        if (val === "table"){
          b.rows = b.rows || [["",""],["",""]];
          b.content = "";
          b.lines = [];
        } else if (val === "columns"){
          b.cols = b.cols || 2;
          b.content = Array.isArray(b.content) ? b.content : ["", ""];
          if (!Array.isArray(b.widths) || b.widths.length !== b.cols){
            b.widths = Array(b.cols).fill(1 / b.cols);
          }
          if (!Number.isFinite(b.gap)) b.gap = 14;
          if (!b.valign) b.valign = "top";
          b.lines = [];
        } else if (val === "ul" || val === "ol"){
          if (typeof b.content !== "string") b.content = "";
          if (!/<\/?li/i.test(b.content)) b.content = "<li><br></li>";
          if (val === "ul" && !b.marker) b.marker = "disc";
          b.lines = [];
        } else if (LINE_TYPES.has(val)){
          /* ПАТЧ 2.3.1: LINE_TYPE — если lines не было, создаём одну */
          if (!Array.isArray(b.lines) || !b.lines.length){
            b.lines = [ newLineFn("") ];
            b.content = "";
          }
        } else {
          if (typeof b.content !== "string") b.content = "";
          if (val === "code") b.content = htmlToText(b.content);
          b.lines = [];
        }
      }
      else if (group === "bg")     b.bg = val;
      else if (group === "font")   b.font = val;
      else if (group === "indent") b.indent = parseInt(val, 10) || 0;
      else if (group === "marker") b.marker = val;

      commit(old);
      render();
      setSelectedBlock(b.id);
      syncHandleMenuState();

      /* Обновляем секции при смене типа */
      if (group === "type"){
        const cs = handleMenu.querySelector('[data-section="columns"]');
        if (cs){
          cs.hidden = (val !== "columns");
          if (val === "columns") fillColsRatioButtons(cs, b);
        }
        const ms = handleMenu.querySelector('[data-section="marker"]');
        if (ms) ms.hidden = (val !== "ul");
        const ls = handleMenu.querySelector('[data-section="lines"]');
        if (ls){
          const show = LINE_TYPES.has(val) && Array.isArray(b.lines) && b.lines.length > 1;
          ls.hidden = !show;
          if (show) fillLinesList(ls, b);
        }
      }
    });
  }

  /* === Панель строк: обработчики (bind один раз) === */
  const linesPanel = $("#lines-panel");
  if (linesPanel && !linesPanel.dataset.bound){
    linesPanel.dataset.bound = "1";

    linesPanel.addEventListener("mousedown", e => {
      if (e.target.closest("button, .lsp-item")) e.preventDefault();
    });

    linesPanel.addEventListener("click", e => {
      /* Кнопка закрытия */
      if (e.target.closest('[data-action="close"]')){
        closeLinesPanel();
        return;
      }

      const btn = e.target.closest("button");
      const panelBlockId = linesPanel.dataset.blockId;
      const b = St().blocks.find(x => x.id === panelBlockId);
      if (!b) return;

      /* Действия по строке */
      const row = e.target.closest(".lsp-item");
      if (row && btn){
        const lineIdx = parseInt(row.dataset.lineIndex, 10);
        const ln = b.lines && b.lines[lineIdx];
        if (!ln) return;

        const action = btn.dataset.action;
        if (action === "copy-id"){
          const id = ln.customId || ln.id;
          navigator.clipboard.writeText(id).then(
            () => toast("ID строки скопирован: " + id),
            () => toast("Не удалось скопировать")
          );
          return;
        }
        if (action === "copy-link"){
          const doc = getActiveDoc();
          const blockId = b.customId || b.id;
          const lineId = ln.customId || ln.id;
          const title = doc?.title || "Без названия";
          const link = `[[${title}#${blockId}#${lineId}]]`;
          navigator.clipboard.writeText(link).then(
            () => toast("Ссылка на строку скопирована"),
            () => toast("Не удалось скопировать")
          );
          return;
        }
        if (action === "edit-id"){
          const newId = prompt("Новый ID строки:", ln.customId || ln.id);
          if (newId === null) return;
          const clean = String(newId).trim().toLowerCase().replace(/[^a-z0-9\-_]/g, "").slice(0, 64);
          const old = snapshot();
          if (!clean || clean === ln.id){
            ln.customId = "";
          } else {
            const doc = getActiveDoc();
            let final = clean;
            let n = 2;
            while (doc.blocks.some(x => (x.lines || []).some(l =>
              l !== ln && (l.customId === final || l.id === final)
            ))){
              final = `${clean}-${n}`;
              n++;
            }
            ln.customId = final;
          }
          commit(old);
          render();
          setSelectedBlock(b.id);
          openLinesPanel();
          return;
        }
        if (action === "remove-id"){
          if (!ln.customId) return;
          const old = snapshot();
          ln.customId = "";
          commit(old);
          render();
          setSelectedBlock(b.id);
          openLinesPanel();
          return;
        }
        /* Клик по строке (без кнопки) — фокус */
        return;
      }

      /* Действия по блоку */
      if (btn && btn.dataset.action === "copy-block-id"){
        const id = b.customId || b.id;
        navigator.clipboard.writeText(id).then(
          () => toast("ID блока скопирован: " + id),
          () => toast("Не удалось скопировать")
        );
        return;
      }
      if (btn && btn.dataset.action === "copy-block-link"){
        const doc = getActiveDoc();
        const id = b.customId || b.id;
        const title = doc?.title || "Без названия";
        const link = `[[${title}#${id}]]`;
        navigator.clipboard.writeText(link).then(
          () => toast("Ссылка на блок скопирована"),
          () => toast("Не удалось скопировать")
        );
        return;
      }

      /* Клик по строке (не по кнопке) — скролл к строке + фокус */
      if (row && !btn){
        const lineId = row.dataset.lineId;
        window.App.state.scrollToAnchorPath(b.id === St().activeDocId ? St().activeDocId : St().activeDocId, b.customId || b.id, lineId, "");
        closeLinesPanel();
      }
    });

    /* Escape */
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && isLinesPanelOpen()){
        closeLinesPanel();
      }
    });
  }

  document.addEventListener("click", e => {
    const handle = e.target.closest(".handle");
    if (!handle) return;
    const blockEl = handle.closest(".block");
    if (!blockEl) return;
    if (blockEl.classList.contains("dragging")) return;

    e.preventDefault();
    e.stopPropagation();

    const id = blockEl.dataset.id;
    setActive(id);
    setSelectedBlock(id);
    openHandleMenu(handle, id);
  });

  document.addEventListener("mousedown", e => {
    if (fontMenuOpen){
      if (!e.target.closest("#fontmenu") &&
          !e.target.closest('.floatbar button[data-cmd="font"]')){
        closeFontMenu();
      }
    }
    if (handleMenuOpen){
      if (!e.target.closest("#handlemenu") &&
          !e.target.closest(".handle")){
        closeHandleMenu();
      }
    }
    if (markerMenuOpen){
      if (!e.target.closest("#markermenu") &&
          !e.target.closest('.floatbar button[data-cmd="bullets"]')){
        closeMarkerMenu();
      }
    }
    if (isLinesPanelOpen()){
      if (!e.target.closest("#lines-panel")){
        closeLinesPanel();
      }
    }

    if (e.target.closest("#floatbar"))   return;
    if (e.target.closest("#palette"))    return;
    if (e.target.closest("#slash"))      return;
    if (e.target.closest("#fontmenu"))   return;
    if (e.target.closest("#handlemenu")) return;
    if (e.target.closest("#markermenu")) return;
    if (e.target.closest("#lines-panel"))return;
    if (e.target.closest(".block"))      return;
    if (e.target.closest("header"))      return;
    if (e.target.closest(".title"))      return;

    clearSelection();
  });

  document.addEventListener("selectionchange", () => {
    if (floatbarDragging) return;

    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed){
      $("#floatbar").style.display = "none";
      clearSelectedRange();
      return;
    }
    const anchorEl = s.anchorNode?.parentElement;
    if (!anchorEl?.closest(".editor")){
      $("#floatbar").style.display = "none";
      clearSelectedRange();
      return;
    }

    const els = getSelectedBlockRange();
    if (els.length){
      const ids = els.map(w => w.dataset.id);
      const ordered = St().blocks.filter(b => ids.includes(b.id)).map(b => b.id);
      if (ordered.length){
        setSelectedRange(ordered[0], ordered[ordered.length - 1]);
      }
    } else {
      clearSelectedRange();
    }

    const range = s.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects && rects.length ? rects[0] : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)){
      $("#floatbar").style.display = "none";
      return;
    }

    const f = $("#floatbar");
    f.dataset.display = "flex";
    f.style.display = "flex";

    const anchorRect = {
      left:  rect.left,
      right: rect.right,
      top:   rect.top,
      bottom:rect.top - 4,
      width: rect.width,
      height: 0
    };

    U.positionFloating(f, anchorRect, {
      preferBelow: false,
      gap: 8,
      margin: 8
    });

    updateFloatbarState();
  });

  /* Ctrl+Backspace — удалить блок (не строку) */
  document.addEventListener("keydown", e => {
    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod || e.key !== "Backspace") return;
    /* Ctrl+Backspace внутри .line обрабатывает keyLine — не перехватываем */
    if (document.activeElement?.closest?.(".line")) return;

    const ae = document.activeElement;
    if (!ae) return;
    const inEditor = ae.isContentEditable && ae.closest?.("#editor");
    if (!inEditor) return;

    e.preventDefault();
    e.stopPropagation();

    const blocks = St().blocks;
    const els = getSelectedBlockRange();
    let ids = [];

    if (els.length){
      ids = els.map(w => w.dataset.id);
    } else {
      const b = getBlockUnderCaret();
      if (b) ids = [b.id];
    }
    if (!ids.length) return;

    if (blocks.length - ids.length < 1){
      const keep = blocks.find(b => !ids.includes(b.id)) || blocks[0];
      const old = snapshot();
      blocks.length = 0;
      if (keep){
        keep.content = "";
        keep.type = "text";
        keep.checked = false;
        keep.rows = null;
        keep.cols = null;
        keep.lines = [ newLineFn("") ];
        blocks.push(keep);
      } else {
        blocks.push(U.block("text", ""));
      }
      setActive(blocks[0].id);
      setSelectedBlock(blocks[0].id);
      commit(old);
      render();
      setTimeout(() => focusActive(), 0);
      return;
    }

    const old = snapshot();
    const firstIdx = blocks.findIndex(b => ids.includes(b.id));
    const remaining = blocks.filter(b => !ids.includes(b.id));
    blocks.length = 0;
    blocks.push(...remaining);

    const nextId = remaining[Math.min(firstIdx, remaining.length - 1)]?.id || null;
    setActive(nextId);
    setSelectedBlock(nextId);
    commit(old);
    render();
    setTimeout(() => focusActive(), 0);
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (markerMenuOpen)      closeMarkerMenu();
    else if (fontMenuOpen)   closeFontMenu();
    else if (handleMenuOpen) closeHandleMenu();
    else if (isLinesPanelOpen()) closeLinesPanel();
    else                     closeMenus();
  });
}

return {
  openSlash, slashRender, slashChoose,
  openPalette, closeMenus, cmdRender, run,
  openGlobalSearch,
  /* ПАТЧ 2.3.1 */
  openLinesPanel, closeLinesPanel, isLinesPanelOpen,
  openFontMenu, closeFontMenu,
  openHandleMenu, closeHandleMenu,
  bindFloatbar, bindMenus,
  get handleMenuOpen(){ return handleMenuOpen; }
};

})();