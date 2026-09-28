/* ============================================================
   menus/palette.js — командная палитра (Ctrl+K), run()

   [Пакет 3]  guard lock.isLocked() в openPalette и run;
              data:reset требует пароль.
   [Пакет 9]  openPalette("docs") работает; run для h3/quote/
              code/ul/ol; шаблонные команды → реальные функции.
   [Пакет 15] role="listbox"/role="option", aria-selected.

   Зависит от: menus/_shared, menus/slash
   ============================================================ */

window.App = window.App || {};

window.App.menusPalette = (() => {
"use strict";

const S = window.App.menusShared;
const {
  $, $$, toast, escape,
  St, setActive, setSlashBlockId,
  snapshot, commit, save, saveNow,
  getActiveDoc,
  render
} = S;

const setUI = (k, v) => window.App.state.setUI(k, v);

/* ---------- [Пакет 3] guard под замком ---------- */

function _isLocked(){
  return !!window.App.lock?.isLocked?.();
}

/* ---------- Реестр команд ---------- */

const commands = [
  ["Заблокировать сейчас", "Требуется пароль", "lock:now", "Навигация"],

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

  ["Текст",              "Добавить абзац",               "block:text",        "Блоки"],
  ["Заголовок 1",        "Добавить H1",                  "block:h1",          "Блоки"],
  ["Заголовок 2",        "Добавить H2",                  "block:h2",          "Блоки"],
  ["Заголовок 3",        "Добавить H3",                  "block:h3",          "Блоки"],
  ["Маркеры",            "Маркированный список",         "block:ul",          "Блоки"],
  ["Нумерованный",       "Нумерованный список",          "block:ol",          "Блоки"],
  ["Чек-лист",           "Добавить задачу",              "block:todo",        "Блоки"],
  ["Цитата",             "Выделенный текст",             "block:quote",       "Блоки"],
  ["Код",                "Моноширинный блок",            "block:code",        "Блоки"],
  ["Таблица",            "Добавить таблицу",             "block:table",       "Блоки"],
  ["Колонки",            "Добавить колонки",             "block:columns",     "Блоки"],
  ["Изображение",        "Добавить изображение",         "block:image",       "Блоки"],
  ["Разделитель",        "Горизонтальная линия",         "block:divider",     "Блоки"],
  ["Новый блок",         "Ctrl+Enter",                   "block:new",         "Блоки"],
  ["Удалить блок",       "Ctrl+Backspace",               "block:delete",      "Блоки"],

  ["Жирный",             "Bold",                          "fmt:bold",          "Формат"],
  ["Курсив",             "Italic",                        "fmt:italic",        "Формат"],
  ["Подчёркнутый",       "Underline",                     "fmt:underline",     "Формат"],
  ["Зачёркнутый",        "Strike",                        "fmt:strike",        "Формат"],
  ["Убрать формат",      "Clear",                         "fmt:clear",         "Формат"],
  ["Маркированный список","Bullets",                      "fmt:bullets",       "Формат"],
  ["Нумерованный список","Numbered",                      "fmt:numbered",      "Формат"],

  ["Сохранить",          "Сохранить сейчас",              "file:save",         "Файл"],
  ["Экспорт HTML",       "Активный документ",             "file:exportHTML",   "Файл"],
  ["Экспорт Markdown",   "Активный документ",             "file:exportMD",     "Файл"],
  ["Экспорт JSON",       "Активный документ",             "file:exportJSON",   "Файл"],
  ["Экспорт PDF",        "Открыть печать активного",      "file:exportPDF",    "Файл"],
  ["Экспорт всех (.zip)","Все документы",                 "file:exportAll",    "Файл"],
  ["Импорт…",            "HTML / MD / JSON",              "file:import",       "Файл"],
  ["Печать / PDF",       "Открыть печать",                "file:print",        "Файл"],
  ["Сброс всех данных",  "Полная очистка хранилища",      "data:reset",        "Файл"],

  ["Поиск по содержимому","Все документы (Ctrl+Shift+F)", "nav:search",        "Навигация"],
  ["Строки блока",       "Ctrl+Shift+L",                  "lines:panel",       "Навигация"],
  ["Следующий документ", "Alt+Tab",                       "nav:nextDoc",       "Навигация"],
  ["Предыдущий документ","Alt+Shift+Tab",                 "nav:prevDoc",       "Навигация"],
  ["Свернуть панель",    "Ctrl+\\",                       "nav:toggleSidebar", "Навигация"],

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

  ["Тема: Paper",      "Светлая бумага",            "theme:paper", "Темы"],
  ["Тема: Sepia",      "Тёплая бумага",             "theme:sepia", "Темы"],
  ["Тема: Mint",       "Мята",                      "theme:mint",  "Темы"],
  ["Тема: Dark",       "Тёмная",                    "theme:dark",  "Темы"]
];

/* ---------- Открытие / закрытие ---------- */

function openPalette(initialMode){
  /* [Пакет 3] под замком палитра не открывается */
  if (_isLocked()) return;

  const p = $("#palette");
  const b = $("#backdrop");
  if (!p) return;

  p.style.display = "block";
  p.setAttribute("role", "dialog");
  p.setAttribute("aria-modal", "true");
  if (b) b.style.display = "block";

  const inp = $("#cmdinput");
  if (inp){
    inp.value = "";
    inp.placeholder = "Введите команду…  ·  > команды · # документы · / блоки · @ шрифты · ~ темы";
  }

  S.paletteMode = initialMode || "commands";
  S.cmdIndex = 0;
  S.lastCmdLen = -1;

  if (S.paletteMode === "docs" && inp){
    inp.value = "#";
  }

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
  S.paletteMode = "commands";
}

/* ---------- Определение режима ---------- */

function detectMode(q){
  if (!q) return S.paletteMode === "docs" ? "docs" : "commands";
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

/* ---------- Рендер палитры ---------- */

function cmdRender(){
  const inp = $("#cmdinput");
  if (!inp) return;

  const raw = inp.value;
  const mode = detectMode(raw);
  const q = stripPrefix(raw).toLowerCase();

  let html = "";

  if (mode === "docs"){
    html += renderDocsSection(q);
  }
  else if (mode === "blocks"){
    html += renderBlocksSection(q);
  }
  else if (mode === "fonts"){
    html += renderFontsSection(q);
  }
  else if (mode === "themes"){
    html += renderThemesSection(q);
  }
  else {
    html += renderCommandsSection(q);
  }

  if (!html){
    html = `<div class="results-empty">Ничего не найдено</div>`;
  }

  const res = $("#cmdresults");
  res.innerHTML = html;
  res.setAttribute("role", "listbox");

  $$("#cmdresults .result").forEach(el => {
    el.setAttribute("role", "option");
    const isSel = el.classList.contains("sel");
    el.setAttribute("aria-selected", isSel ? "true" : "false");
    el.tabIndex = -1;
    el.onclick = () => {
      const c = el.dataset.c;
      const d = el.dataset.doc;
      if (d) openDocById(d);
      else if (c) run(c);
    };
  });

  const items = $$("#cmdresults .result");
  if (items.length){
    if (S.cmdIndex >= items.length) S.cmdIndex = items.length - 1;
    if (S.cmdIndex < 0) S.cmdIndex = 0;
    items.forEach((el, i) => {
      const on = i === S.cmdIndex;
      el.classList.toggle("sel", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
}

function renderCommandsSection(q){
  const arr = commands.filter(x =>
    !q || (x[0] + x[1] + x[3]).toLowerCase().includes(q));

  if (!arr.length) return "";

  let html = `<div class="results-group">Команды</div>`;
  html += arr.map((x, i) => {
    const sel = i === S.cmdIndex ? "sel" : "";
    return `<div class="result ${sel}" data-c="${escape(x[2])}">
      <b>${escape(x[0])}</b>
      <small>${escape(x[3])}</small>
    </div>`;
  }).join("");
  return html;
}

function renderBlocksSection(q){
  const arr = S.types.filter(x =>
    !q || (x[0] + x[1] + x[2]).toLowerCase().includes(q));

  let html = `<div class="results-group">Блоки</div>`;
  html += arr.map((x, i) => {
    const sel = i === S.cmdIndex ? "sel" : "";
    return `<div class="result ${sel}" data-c="block:${escape(x[0])}">
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
    const sel = i === S.cmdIndex ? "sel" : "";
    const safeName = escape(name);
    return `<div class="result ${sel}" data-c="font:${escape(role)}:${safeName}">
      <b style="font-family:'${safeName}',system-ui,sans-serif">${safeName}</b>
      <small>${escape(role)}</small>
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
    const sel = i === S.cmdIndex ? "sel" : "";
    return `<div class="result ${sel}" data-c="theme:${escape(key)}">
      <b>${escape(name)}</b><small>${escape(key)}</small>
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
    const sel = i === S.cmdIndex ? "sel" : "";
    const title = escape(d.title || "Без названия");
    const meta = new Date(d.updatedAt).toLocaleDateString("ru-RU", { day:"2-digit", month:"short" });
    return `<div class="result ${sel}" data-doc="${escape(d.id)}">
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

/* ============================================================
   [Пакет 3] запрос пароля перед сбросом данных
   ============================================================ */

async function _confirmWithPassword(message){
  const lock = window.App.lock;
  if (!lock || !lock.hasPassword()){
    return confirm(message);
  }

  const pw = prompt(message + "\n\nВведите пароль для подтверждения:");
  if (!pw) return false;

  const ok = await lock.checkPassword(pw);
  if (!ok){
    toast("Неверный пароль");
    return false;
  }
  return true;
}

/* ---------- Исполнение команд ---------- */

async function run(c){
  /* [Пакет 3] под замком разрешена только команда lock:now */
  if (_isLocked() && c !== "lock:now") return;

  closeMenus();

  if (c === "doc:new")       { window.App.sidebar?.createNewDocument(); return; }
  if (c === "doc:newTemplate"){ window.App.sidebar?.openTemplatePicker?.(); return; }
  if (c === "doc:open")      { openPalette("docs"); return; }
  if (c === "lock:now"){ window.App.lock?.lock?.(); return; }

  /* [Пакет 9] шаблонные команды → реальные функции */
  if (c === "doc:saveAsTemplate"){
    const doc = getActiveDoc();
    if (doc) window.App.sidebar?.saveCurrentAsTemplate?.(doc.id);
    return;
  }
  if (c === "doc:importTemplate"){
    window.App.sidebar?.importTemplateDialog?.();
    return;
  }
  if (c === "doc:exportTemplates"){
    window.App.sidebar?.exportAllTemplates?.();
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
      window.App.state.duplicateDocument(doc.id).then(copy => {
        if (copy) window.App.state.setActiveDoc(copy.id);
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

    if (type === "new"){
      const activeEl = document.activeElement;
      const blockEl = activeEl?.closest?.(".block");
      if (blockEl){
        const bid = blockEl.dataset.id;
        const blocks = St().blocks;
        const idx = blocks.findIndex(b => b.id === bid);
        if (idx >= 0){ S.add("text", idx + 1); return; }
      }
      S.add("text");
      return;
    }

    if (type === "delete"){
      /* [Пакет 10] делегируем в hotkeys через реальное действие */
      const activeEl = document.activeElement;
      const blockEl = activeEl?.closest?.(".block");
      const bid = blockEl?.dataset?.id;
      const blocks = St().blocks;
      if (bid){
        const idx = blocks.findIndex(b => b.id === bid);
        if (idx >= 0){
          if (blocks.length <= 1){
            blocks[0].content = "";
            blocks[0].type = "text";
            blocks[0].lines = [ S.newLineFn("") ];
          } else {
            blocks.splice(idx, 1);
          }
          render();
        }
      }
      return;
    }

    if (["text","h1","h2","h3","ul","ol","todo","quote","code",
         "table","columns","divider","image"].includes(type)){
      if (type === "image") window.App.io.openImagePicker();
      else S.add(type);
    }
    return;
  }

  if (c.startsWith("fmt:")){
    const cmd = c.slice(4);
    if (cmd === "clear"){
      document.execCommand("removeFormat", false, null);
      document.execCommand("unlink", false, null);
    } else if (cmd === "bullets"){
      window.App.menusFloatbar.toggleListForSelection("ul");
    } else if (cmd === "numbered"){
      window.App.menusFloatbar.toggleListForSelection("ol");
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
    if (!(await _confirmWithPassword("Подтвердите сброс"))) return;
    window.App.db.clearAll().then(() => {
      try { localStorage.clear(); } catch(e){}
      location.reload();
    });
    return;
  }

  if (c === "nav:search")        { window.App.menusSearch.openGlobalSearch(); return; }
  if (c === "lines:panel")       { window.App.menusLinesPanel.openLinesPanel(); return; }
  if (c === "nav:nextDoc")       { window.App.tabs?.nextTab(); return; }
  if (c === "nav:prevDoc")       { window.App.tabs?.prevTab(); return; }
  if (c === "nav:toggleSidebar") { window.App.sidebar?.toggleSidebar(); return; }

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

    if (!St().ui.fonts) St().ui.fonts = {};
    St().ui.fonts[role] = name;
    setUI("fonts", St().ui.fonts);
    save();
    toast(`Шрифт: ${name}`);
    return;
  }

  if (c.startsWith("theme:")){
    /* [Пакет 11] тема не пишется в историю */
    setUI("theme", c.slice(6));
    render();
    return;
  }
}

return {
  commands,
  openPalette, closeMenus, cmdRender, run,
  detectMode, stripPrefix,
  openDocById
};
})();