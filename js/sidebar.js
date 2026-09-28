/* ============================================================
   sidebar.js — левая панель документов + модалка создания папки
   Зависит от: utils, state, db
   ============================================================ */

window.App = window.App || {};

window.App.sidebar = (() => {
"use strict";

const U = window.App.utils;
const { $, $$, el, escape, uid, now, toast } = U;

const St = () => window.App.state.S;
const getActiveDoc = () => window.App.state.getActiveDoc();

let currentFolderId = null;
let searchQuery     = "";
let contextMenuDoc  = null;
let currentTag      = null;

/* ============================================================
   Модалки
   ============================================================ */

function openModal({ title, placeholder, value = "", okLabel = "Создать", onOk }){
  closeModal();

  const backdrop = el("div", "modal-backdrop");
  backdrop.id = "paper-modal-backdrop";

  const box = el("div", "modal");
  box.id = "paper-modal";

  const h = el("div", "modal-title");
  h.textContent = title;
  box.append(h);

  const input = el("input", "modal-input");
  input.type = "text";
  input.placeholder = placeholder || "";
  input.value = value;
  input.autocomplete = "off";
  input.spellcheck = false;
  box.append(input);

  const actions = el("div", "modal-actions");

  const cancel = el("button", "modal-btn");
  cancel.textContent = "Отмена";
  cancel.onclick = closeModal;
  actions.append(cancel);

  const ok = el("button", "modal-btn primary");
  ok.textContent = okLabel;
  ok.onclick = () => {
    const v = input.value.trim();
    if (!v){
      input.classList.add("shake");
      setTimeout(() => input.classList.remove("shake"), 300);
      input.focus();
      return;
    }
    closeModal();
    onOk(v);
  };
  actions.append(ok);
  box.append(actions);

  backdrop.append(box);
  document.body.append(backdrop);

  backdrop.addEventListener("mousedown", e => {
    if (e.target === backdrop) closeModal();
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter"){ e.preventDefault(); ok.click(); }
    if (e.key === "Escape"){ e.preventDefault(); closeModal(); }
  });

  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function closeModal(){
  const m = document.getElementById("paper-modal-backdrop");
  if (m) m.remove();
}

/* ---------- Модалка «Свойства документа» ---------- */

const EMOJI_PRESETS = ["📝","📔","📚","💡","⭐","✅","🎯","🍳","✈️","💼","🎨","🔬","🏠","❤️","⚡"];
const COLOR_PRESETS = ["#829b91","#a78663","#c46a63","#c98a3c","#8a7bc4","#6a8dc4","#5fa57a","#7a7a7a"];

function openProperties(docId){
  const doc = St().documents[docId];
  if (!doc) return;

  closeModal();

  const backdrop = el("div", "modal-backdrop");
  backdrop.id = "paper-modal-backdrop";

  const box = el("div", "modal props-modal");

  const h = el("div", "modal-title");
  h.textContent = "Свойства документа";
  box.append(h);

  /* Иконка */
  const iconLabel = el("div", "props-label");
  iconLabel.textContent = "Иконка";
  box.append(iconLabel);

  const iconGrid = el("div", "props-icon-grid");
  EMOJI_PRESETS.forEach(e => {
    const b = el("button", "props-icon-btn" + (doc.icon === e ? " on" : ""));
    b.textContent = e;
    b.onclick = async () => {
      await window.App.state.setDocumentField(docId, "icon", doc.icon === e ? "" : e);
      openProperties(docId);
      render();
    };
    iconGrid.append(b);
  });
  box.append(iconGrid);

  /* Цвет */
  const colorLabel = el("div", "props-label");
  colorLabel.textContent = "Цвет";
  box.append(colorLabel);

  const colorRow = el("div", "props-color-row");
  COLOR_PRESETS.forEach(c => {
    const b = el("button", "props-color-btn" + (doc.color === c ? " on" : ""));
    b.style.background = c;
    b.onclick = async () => {
      await window.App.state.setDocumentField(docId, "color", doc.color === c ? "" : c);
      openProperties(docId);
      render();
    };
    colorRow.append(b);
  });
  box.append(colorRow);

  /* Название */
  const nameLabel = el("div", "props-label");
  nameLabel.textContent = "Название";
  box.append(nameLabel);

  const nameInput = el("input", "modal-input");
  nameInput.type = "text";
  nameInput.value = doc.title || "";
  nameInput.placeholder = "Название документа";
  box.append(nameInput);

  /* Описание */
  const descLabel = el("div", "props-label");
  descLabel.textContent = "Описание";
  box.append(descLabel);

  const descInput = el("textarea", "modal-input props-textarea");
  descInput.value = doc.description || "";
  descInput.placeholder = "Короткое описание (для карточки)";
  descInput.rows = 3;
  box.append(descInput);

  /* Теги */
  const tagLabel = el("div", "props-label");
  tagLabel.textContent = "Теги (через запятую)";
  box.append(tagLabel);

  const tagInput = el("input", "modal-input");
  tagInput.type = "text";
  tagInput.value = (doc.tags || []).join(", ");
  tagInput.placeholder = "todo, идеи, важно";
  box.append(tagInput);

  /* ПАТЧ 2.3.0: секция «Нумерация строк» удалена */

  /* Actions */
  const actions = el("div", "modal-actions");
  const cancel = el("button", "modal-btn");
  cancel.textContent = "Отмена";
  cancel.onclick = closeModal;
  actions.append(cancel);

  const ok = el("button", "modal-btn primary");
  ok.textContent = "Сохранить";
  ok.onclick = async () => {
    const newTitle = nameInput.value.trim();
    if (newTitle && newTitle !== doc.title){
      await window.App.state.renameDocument(docId, newTitle);
    }
    const description = descInput.value.trim().slice(0, 200);
    const tags = tagInput.value
      .split(",")
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20);

    doc.description = description;
    doc.tags = tags;
    doc.updatedAt = now();
    await window.App.db.saveDocument(doc);

    closeModal();
    render();
    window.App.tabs?.render();
    toast("Свойства сохранены");
  };
  actions.append(ok);
  box.append(actions);

  backdrop.append(box);
  document.body.append(backdrop);

  backdrop.addEventListener("mousedown", e => {
    if (e.target === backdrop) closeModal();
  });
}

/* ---------- Хлебные крошки ---------- */

function folderChain(id){
  const chain = [];
  let f = St().folders[id];
  while (f){
    chain.unshift(f);
    f = f.parentId ? St().folders[f.parentId] : null;
  }
  return chain;
}

/* ---------- Дата ---------- */

function relTime(ts){
  const diff = now() - ts;
  const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
  if (diff < min)       return "только что";
  if (diff < hour)      return Math.floor(diff / min) + " мин";
  if (diff < day)       return Math.floor(diff / hour) + " ч";
  if (diff < 7 * day)   return Math.floor(diff / day) + " д";
  const d = new Date(ts);
  return d.toLocaleDateString("ru-RU", { day:"2-digit", month:"short" });
}

/* ============================================================
   Рендер
   ============================================================ */

function render(){
  const aside = $("#sidebar");
  if (!aside) return;

  aside.innerHTML = "";
  aside.classList.toggle("collapsed", !St().ui.sidebarOpen);

  /* Шапка */
  const header = el("div", "sb-header");

  const plus = el("button", "sb-iconbtn");
  plus.title = "Новый документ (Ctrl+N)";
  plus.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M5 12h14"/><path d="M12 5v14"/>
    </svg>`;
  plus.onclick = () => createNewDocument();
  header.append(plus);

  const search = el("input", "sb-search");
  search.type = "search";
  search.placeholder = "Поиск по названию…";
  search.value = searchQuery;
  search.oninput = () => {
    searchQuery = search.value;
    renderList();
  };
  header.append(search);

  /* Переключатель режима карточек */
  const modeBtn = el("button", "sb-iconbtn");
  modeBtn.title = "Режим карточек";
  modeBtn.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>`;
  modeBtn.onclick = e => {
    const modes = ["mini","normal","detailed"];
    const cur = St().ui.cardMode;
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    window.App.state.setUI("cardMode", next);
    toast("Карточки: " + { mini:"мини", normal:"обычно", detailed:"подробно" }[next]);
    render();
  };
  header.append(modeBtn);

  /* Переключатель сортировки */
  const sortBtn = el("button", "sb-iconbtn");
  sortBtn.title = "Сортировка";
  sortBtn.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="m3 16 4 4 4-4"/>
      <path d="M7 20V4"/>
      <path d="m21 8-4-4-4 4"/>
      <path d="M17 4v16"/>
    </svg>`;
  sortBtn.onclick = e => {
    const modes = ["updated","created","title","size"];
    const cur = St().ui.sortMode;
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    window.App.state.setUI("sortMode", next);
    toast("Сортировка: " + {
      updated:"по дате", created:"по созданию", title:"по названию", size:"по размеру"
    }[next]);
    render();
  };
  header.append(sortBtn);

  const collapse = el("button", "sb-iconbtn");
  collapse.title = "Свернуть панель (Ctrl+\\)";
  collapse.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="m15 18-6-6 6-6"/>
    </svg>`;
  collapse.onclick = () => toggleSidebar(false);
  header.append(collapse);

  aside.append(header);

  /* Хлебные крошки */
  const crumbs = el("div", "sb-crumbs");
  crumbs.append(makeCrumb("Все документы", null));
  folderChain(currentFolderId).forEach(f => {
    const sep = el("span", "sb-crumb-sep");
    sep.textContent = "/";
    crumbs.append(sep);
    crumbs.append(makeCrumb(f.name, f.id));
  });
  aside.append(crumbs);

  /* Фильтр по тегу (если есть теги в системе) */
  const allTags = new Set();
  Object.values(St().documents).forEach(d => (d.tags || []).forEach(t => allTags.add(t)));
  if (allTags.size){
    const tagBar = el("div", "sb-tagbar");
    if (currentTag){
      const clear = el("button", "sb-tagchip clear");
      clear.textContent = "× " + currentTag;
      clear.onclick = () => { currentTag = null; render(); };
      tagBar.append(clear);
    } else {
      const all = el("button", "sb-tagchip" + (!currentTag ? " on" : ""));
      all.textContent = "Все";
      all.onclick = () => { currentTag = null; render(); };
      tagBar.append(all);
      [...allTags].sort().slice(0, 8).forEach(t => {
        const b = el("button", "sb-tagchip");
        b.textContent = "#" + t;
        b.onclick = () => { currentTag = t; render(); };
        tagBar.append(b);
      });
    }
    aside.append(tagBar);
  }

  /* Разделы */
  const nav = el("nav", "sb-sections");
  const sections = [
    ["favorite", "★ Избранное"],
    ["all",      "Все"],
    ["today",    "Сегодня"],
    ["week",     "На этой неделе"],
    ["earlier",  "Ранее"],
    ["archive",  "Архив"],
    ["trash",    "Корзина"]
  ];
  sections.forEach(([key, label]) => {
    const b = el("button", "sb-section" + (St().ui.section === key ? " active" : ""));
    b.textContent = label;
    b.onclick = () => {
      St().ui.section = key;
      window.App.state.setUI("section", key);
      render();
    };
    nav.append(b);
  });
  aside.append(nav);

  /* Список */
  const list = el("div", "sb-list");
  list.id = "sb-list";
  aside.append(list);

  /* Ноги */
  const foot = el("div", "sb-foot");
  if (St().ui.section === "trash"){
    const empty = el("button", "sb-foot-btn danger");
    empty.textContent = "Очистить корзину";
    empty.onclick = async () => {
      if (!confirm("Удалить все документы из корзины безвозвратно?")) return;
      const n = await window.App.state.emptyTrash();
      toast(`Удалено: ${n}`);
      render();
    };
    foot.append(empty);
  } else {
    const addFolder = el("button", "sb-foot-btn");
    addFolder.textContent = "+ Папка";
    addFolder.onclick = () => createFolder();
    foot.append(addFolder);
  }
  aside.append(foot);

  renderList();
}

function makeCrumb(label, folderId){
  const c = el("button", "sb-crumb" + (folderId === currentFolderId ? " current" : ""));
  c.textContent = label;
  c.onclick = () => {
    currentFolderId = folderId;
    render();
  };
  return c;
}

/* ============================================================
   Список
   ============================================================ */

function renderList(){
  const list = $("#sb-list");
  if (!list) return;
  list.innerHTML = "";

  const isAllSection = St().ui.section === "all";
  const isTrash      = St().ui.section === "trash";

  /* drop-зона: пустое место списка = вынести наверх */
  list.addEventListener("dragover", e => {
    if (e.target.closest(".sb-folder")) return;
    const types = e.dataTransfer?.types || [];
    if (!types.includes("application/x-paper-doc") && !types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    list.classList.add("drop-here");
  });

  list.addEventListener("dragleave", e => {
    if (!list.contains(e.relatedTarget)) list.classList.remove("drop-here");
  });

  list.addEventListener("drop", async e => {
    if (e.target.closest(".sb-folder")) return;
    const docId = e.dataTransfer.getData("application/x-paper-doc");
    list.classList.remove("drop-here");
    if (!docId) return;
    e.preventDefault();
    await moveDocumentToFolder(docId, currentFolderId || null);
  });

  /* Папки — только в разделе «Все» и без поиска */
  if (isAllSection && !searchQuery){
    const folders = Object.values(St().folders)
      .filter(f => (f.parentId || null) === (currentFolderId || null))
      .sort((a,b) => a.name.localeCompare(b.name));

    if (folders.length){
      const wrap = el("div", "sb-folders");
      folders.forEach(f => wrap.append(makeFolderRow(f)));
      list.append(wrap);
    }
  }

  /* Документы */
  let folderFilter;
  if (isAllSection && !searchQuery){
    folderFilter = currentFolderId || null;
  } else {
    folderFilter = undefined;
  }

  let docs = window.App.state.listDocuments({
    section: St().ui.section,
    folderId: folderFilter,
    query: searchQuery
  });

  /* Фильтр по тегу */
  if (currentTag){
    docs = docs.filter(d => (d.tags || []).includes(currentTag));
  }

  if (!docs.length && !list.children.length){
    const empty = el("div", "sb-empty");
    empty.textContent = searchQuery
      ? "Ничего не найдено"
      : (isTrash ? "Корзина пуста" : "Нет документов");
    list.append(empty);
    return;
  }

  const mode = St().ui.cardMode;
  docs.forEach(doc => list.append(makeCard(doc, mode)));
}

function makeFolderRow(f){
  const row = el("div", "sb-folder");
  row.dataset.folderId = f.id;

  const icon = el("span", "sb-folder-icon");
  icon.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7.9a1 1 0 0 1-.7-.3l-1.6-1.6a1 1 0 0 0-.7-.3H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1z"/>
    </svg>`;
  row.append(icon);

  const name = el("span", "sb-folder-name");
  name.textContent = f.name;
  row.append(name);

  const count = el("span", "sb-folder-count");
  const n = Object.values(St().documents).filter(d => !d.trashed && d.folderId === f.id).length;
  count.textContent = n || "";
  row.append(count);

  const menu = el("button", "sb-card-menu");
  menu.innerHTML = "…";
  menu.onclick = e => {
    e.stopPropagation();
    openFolderMenu(f.id, menu);
  };
  row.append(menu);

  row.onclick = () => {
    currentFolderId = f.id;
    render();
  };

  row.addEventListener("dragover", e => {
    const types = e.dataTransfer?.types || [];
    if (!types.includes("application/x-paper-doc") && !types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    row.classList.add("drop-target");
  });

  row.addEventListener("dragleave", e => {
    if (!row.contains(e.relatedTarget)) row.classList.remove("drop-target");
  });

  row.addEventListener("drop", async e => {
    row.classList.remove("drop-target");
    const docId = e.dataTransfer.getData("application/x-paper-doc");
    if (!docId) return;
    e.preventDefault();
    e.stopPropagation();
    await moveDocumentToFolder(docId, f.id);
  });

  return row;
}

function openFolderMenu(folderId, anchor){
  closeCardMenu();
  const menu = el("div", "sb-ctxmenu");
  menu.id = "sb-ctxmenu";

  const items = [
    ["Переименовать", () => renameFolder(folderId)],
    ["Новая подпапка", () => createFolder(folderId)],
    ["Удалить", () => deleteFolder(folderId), "danger"]
  ];
  items.forEach(([label, fn, cls]) => {
    const b = el("button", "sb-ctxitem" + (cls ? " " + cls : ""));
    b.textContent = label;
    b.onclick = e => {
      e.stopPropagation();
      closeCardMenu();
      fn();
    };
    menu.append(b);
  });

  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.right - 180, window.innerWidth - 200) + "px";
  menu.style.top  = Math.min(r.bottom + 4, window.innerHeight - 200) + "px";
  document.body.append(menu);
  setTimeout(() => {
    document.addEventListener("mousedown", onDocClickCloseMenu, { once: true });
  }, 0);
}

/* ============================================================
   Карточки
   ============================================================ */

function makeCard(doc, mode){
  const c = el("article", "sb-card mode-" + mode);
  c.dataset.docId = doc.id;
  c.draggable = true;

  if (doc.id === St().activeDocId) c.classList.add("active");
  if (doc.favorite) c.classList.add("favorite");
  if (doc.pinned)   c.classList.add("pinned");
  if (doc.archived) c.classList.add("archived");

  const head = el("div", "sb-card-head");

  if (doc.icon){
    const icon = el("span", "sb-card-icon");
    icon.textContent = doc.icon;
    head.append(icon);
  } else {
    const dot = el("span", "sb-card-dot");
    if (doc.color) dot.style.background = doc.color;
    head.append(dot);
  }

  const title = el("span", "sb-card-title");
  title.textContent = doc.title || "Без названия";
  title.title = "Двойной клик — переименовать";
  title.ondblclick = e => {
    e.stopPropagation();
    startInlineRename(c, doc, title);
  };
  head.append(title);

  if (doc.pinned){
    const pin = el("span", "sb-card-pin");
    pin.textContent = "📌";
    head.append(pin);
  }
  if (doc.favorite){
    const star = el("span", "sb-card-star");
    star.textContent = "★";
    head.append(star);
  }

  const menuBtn = el("button", "sb-card-menu");
  menuBtn.innerHTML = "…";
  menuBtn.onclick = e => {
    e.stopPropagation();
    openCardMenu(doc.id, menuBtn);
  };
  head.append(menuBtn);

  c.append(head);

  if (mode !== "mini"){
    const preview = firstLineOf(doc);
    if (preview){
      const p = el("div", "sb-card-preview");
      p.textContent = preview;
      c.append(p);
    }
  }

  if (mode === "detailed" && (doc.tags || []).length){
    const tagWrap = el("div", "sb-card-tags");
    doc.tags.slice(0, 4).forEach(t => {
      const chip = el("span", "sb-card-tag");
      chip.textContent = "#" + t;
      tagWrap.append(chip);
    });
    c.append(tagWrap);
  }

  const meta = el("div", "sb-card-meta");
  meta.textContent = mode === "detailed"
    ? relTime(doc.updatedAt) + " · " + doc.wordCount + " сл."
    : relTime(doc.updatedAt);
  c.append(meta);

  c.onclick = e => {
    if (c.querySelector(".sb-rename-input")) return;
    openDocument(doc.id);
  };

  c.oncontextmenu = e => {
    e.preventDefault();
    openCardMenu(doc.id, c);
  };

  c.addEventListener("dragstart", e => {
    if (c.querySelector(".sb-rename-input")){
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("application/x-paper-doc", doc.id);
    e.dataTransfer.setData("text/plain", doc.id);
    e.dataTransfer.effectAllowed = "move";
    c.classList.add("dragging");
  });
  c.addEventListener("dragend", () => c.classList.remove("dragging"));

  return c;
}

function startInlineRename(card, doc, titleEl){
  if (card.querySelector(".sb-rename-input")) return;

  const input = el("input", "sb-rename-input");
  input.type = "text";
  input.value = doc.title || "";
  input.placeholder = "Название";

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const v = input.value.trim();
    const prev = doc.title || "";
    input.replaceWith(titleEl);
    if (!v || v === prev) return;
    await window.App.state.renameDocument(doc.id, v);
    titleEl.textContent = v;
    window.App.tabs?.render();
  };

  const cancel = () => {
    input.replaceWith(titleEl);
  };

  input.addEventListener("keydown", e => {
    if (e.key === "Enter"){ e.preventDefault(); commit(); }
    if (e.key === "Escape"){ e.preventDefault(); cancel(); }
    e.stopPropagation();
  });
  input.addEventListener("blur", commit);
  input.addEventListener("click", e => e.stopPropagation());
  input.addEventListener("dblclick", e => e.stopPropagation());
  input.addEventListener("mousedown", e => e.stopPropagation());
}

function firstLineOf(doc){
  const blocks = doc.blocks || [];
  for (const b of blocks){
    const t = (U.htmlToText(b.content || "")).trim();
    if (t) return t.slice(0, 80);
  }
  return "";
}

async function openDocument(id){
  await window.App.state.setActiveDoc(id);
}

/* ============================================================
   Контекстное меню карточки
   ============================================================ */

function openCardMenu(docId, anchor){
  closeCardMenu();
  const menu = el("div", "sb-ctxmenu");
  menu.id = "sb-ctxmenu";
  contextMenuDoc = docId;

  const doc = St().documents[docId];
  const inTrash = !!doc?.trashed;
  const isArchived = !!doc?.archived;

  const items = inTrash ? [
    ["Восстановить", () => restore(docId)],
    ["Удалить навсегда", () => purge(docId), "danger"]
  ] : [
    ["Открыть",         () => openDocument(docId)],
    ["Свойства…",       () => openProperties(docId)],
    ["Переименовать",   () => promptRename(docId)],
    ["Дублировать",     () => duplicate(docId)],
    [doc?.pinned ? "Открепить" : "Закрепить",
                        () => togglePinned(docId)],
    [doc?.favorite ? "Убрать из избранного" : "В избранное",
                        () => toggleFavorite(docId)],
    [isArchived ? "Из архива" : "В архив",
                        () => toggleArchived(docId)],
    ["Экспорт HTML",    () => window.App.io?.downloadHTML(docId)],
    ["Экспорт PDF",     () => window.App.io?.downloadPDF(docId)],
    ["В корзину",       () => trash(docId), "danger"]
  ];

  items.forEach(([label, fn, cls]) => {
    const b = el("button", "sb-ctxitem" + (cls ? " " + cls : ""));
    b.textContent = label;
    b.onclick = e => {
      e.stopPropagation();
      closeCardMenu();
      fn();
    };
    menu.append(b);
  });

  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.right - 180, window.innerWidth - 200) + "px";
  menu.style.top  = Math.min(r.bottom + 4, window.innerHeight - 340) + "px";
  document.body.append(menu);
  setTimeout(() => {
    document.addEventListener("mousedown", onDocClickCloseMenu, { once: true });
  }, 0);
}

function onDocClickCloseMenu(e){
  if (!e.target.closest("#sb-ctxmenu")) closeCardMenu();
}

function closeCardMenu(){
  const m = $("#sb-ctxmenu");
  if (m) m.remove();
  contextMenuDoc = null;
}

/* ============================================================
   Операции
   ============================================================ */

async function createNewDocument(){
  const doc = await window.App.state.createDocument({
    folderId: currentFolderId
  });
  await window.App.state.setActiveDoc(doc.id);
}

async function promptRename(docId){
  const doc = St().documents[docId];
  if (!doc) return;
  openModal({
    title: "Переименовать документ",
    placeholder: "Название",
    value: doc.title || "",
    okLabel: "Переименовать",
    onOk: async (name) => {
      await window.App.state.renameDocument(docId, name);
      render();
    }
  });
}

async function duplicate(docId){
  const copy = await window.App.state.duplicateDocument(docId);
  if (copy){
    toast("Дубликат создан");
    render();
  }
}

async function toggleFavorite(docId){
  const doc = St().documents[docId];
  if (!doc) return;
  await window.App.state.setDocumentField(docId, "favorite", !doc.favorite);
  render();
}

async function togglePinned(docId){
  const doc = St().documents[docId];
  if (!doc) return;
  await window.App.state.setDocumentField(docId, "pinned", !doc.pinned);
  render();
}

async function toggleArchived(docId){
  const doc = St().documents[docId];
  if (!doc) return;
  await window.App.state.setDocumentField(docId, "archived", !doc.archived);
  render();
}

async function trash(docId){
  await window.App.state.trashDocument(docId);
  render();
}

async function restore(docId){
  await window.App.state.restoreDocument(docId);
  render();
}

async function purge(docId){
  if (!confirm("Удалить документ безвозвратно?")) return;
  await window.App.state.purgeDocument(docId);
  render();
}

/* ---------- Перемещение в папку ---------- */

async function moveDocumentToFolder(docId, folderId){
  const doc = St().documents[docId];
  if (!doc) return;

  const target = folderId || null;
  if ((doc.folderId || null) === target) return;

  doc.folderId = target;
  doc.updatedAt = now();

  try {
    await window.App.db.saveDocument(doc);
    toast(target ? "Перемещено в папку" : "Перемещено наверх");
    render();
  } catch (e){
    console.error("move error:", e);
    toast("Не удалось переместить");
  }
}

/* ---------- Папки ---------- */

function createFolder(parentId){
  const parent = parentId === undefined ? currentFolderId : parentId;

  openModal({
    title: parent ? "Новая подпапка" : "Новая папка",
    placeholder: "Название папки",
    value: "",
    okLabel: "Создать",
    onOk: async (name) => {
      const id = uid();
      const folder = {
        id,
        name,
        parentId: parent || null,
        color: "",
        icon: "",
        createdAt: now()
      };
      St().folders[id] = folder;
      try {
        await window.App.db.put("folders", folder);
        toast("Папка создана");
        render();
      } catch (e){
        console.error("folder save error:", e);
        toast("Не удалось сохранить папку");
      }
    }
  });
}

async function renameFolder(folderId){
  const f = St().folders[folderId];
  if (!f) return;
  openModal({
    title: "Переименовать папку",
    placeholder: "Название",
    value: f.name,
    okLabel: "Переименовать",
    onOk: async (name) => {
      f.name = name;
      try {
        await window.App.db.put("folders", f);
        render();
      } catch(e){ toast("Ошибка сохранения"); }
    }
  });
}

async function deleteFolder(folderId){
  const f = St().folders[folderId];
  if (!f) return;

  const affected = Object.values(St().documents).filter(d => d.folderId === folderId);
  for (const d of affected){
    d.folderId = f.parentId || null;
    try { await window.App.db.saveDocument(d); } catch(e){}
  }

  const subs = Object.values(St().folders).filter(x => x.parentId === folderId);
  for (const s of subs){
    s.parentId = f.parentId || null;
    try { await window.App.db.put("folders", s); } catch(e){}
  }

  delete St().folders[folderId];
  try {
    await window.App.db.del("folders", folderId);
    toast("Папка удалена");
    if (currentFolderId === folderId) currentFolderId = f.parentId || null;
    render();
  } catch(e){ toast("Ошибка удаления"); }
}

/* ============================================================
   Шаблоны
   ============================================================ */

const TEMPLATES = [
  {
    id: "note",
    name: "Заметка",
    icon: "📝",
    blocks: [
      { type: "h1", content: "Заметка" },
      { type: "text", content: "" },
      { type: "text", content: "Ключевая мысль:" },
      { type: "quote", content: "" },
      { type: "text", content: "Детали:" },
      { type: "ul", content: "<li><br></li><li><br></li>" }
    ]
  },
  {
    id: "meeting",
    name: "Встреча",
    icon: "👥",
    blocks: [
      { type: "h1", content: "Встреча" },
      { type: "text", content: "Дата: " + new Date().toLocaleDateString("ru-RU") },
      { type: "text", content: "Участники:" },
      { type: "ul", content: "<li><br></li>" },
      { type: "h2", content: "Повестка" },
      { type: "ul", content: "<li><br></li><li><br></li>" },
      { type: "h2", content: "Решения" },
      { type: "ul", content: "<li><br></li>" },
      { type: "h2", content: "Задачи" },
      { type: "todo", content: "" }
    ]
  },
  {
    id: "task",
    name: "Задача",
    icon: "✅",
    blocks: [
      { type: "h1", content: "Задача" },
      { type: "text", content: "Что нужно сделать:" },
      { type: "todo", content: "" },
      { type: "text", content: "Дедлайн:" },
      { type: "text", content: "" },
      { type: "text", content: "Заметки:" }
    ]
  },
  {
    id: "recipe",
    name: "Рецепт",
    icon: "🍳",
    blocks: [
      { type: "h1", content: "Рецепт" },
      { type: "text", content: "Порций: · Время: " },
      { type: "h2", content: "Ингредиенты" },
      { type: "ul", content: "<li><br></li><li><br></li><li><br></li>" },
      { type: "h2", content: "Приготовление" },
      { type: "ol", content: "<li><br></li><li><br></li>" }
    ]
  },
  {
    id: "diary",
    name: "Дневник",
    icon: "📔",
    blocks: [
      { type: "h1", content: new Date().toLocaleDateString("ru-RU", { day:"numeric", month:"long", year:"numeric" }) },
      { type: "text", content: "Настроение:" },
      { type: "text", content: "" },
      { type: "text", content: "Что произошло сегодня:" },
      { type: "text", content: "" },
      { type: "text", content: "Благодарности:" },
      { type: "ul", content: "<li><br></li><li><br></li>" }
    ]
  },
  {
    id: "outline",
    name: "Конспект",
    icon: "📚",
    blocks: [
      { type: "h1", content: "Конспект" },
      { type: "text", content: "Источник:" },
      { type: "text", content: "" },
      { type: "h2", content: "Главное" },
      { type: "ul", content: "<li><br></li><li><br></li><li><br></li>" },
      { type: "h2", content: "Детали" },
      { type: "text", content: "" },
      { type: "h2", content: "Вопросы" },
      { type: "ul", content: "<li><br></li>" }
    ]
  }
];

function createFromTemplate(){
  closeModal();

  const backdrop = el("div", "modal-backdrop");
  backdrop.id = "paper-modal-backdrop";

  const box = el("div", "modal");
  const h = el("div", "modal-title");
  h.textContent = "Новый документ из шаблона";
  box.append(h);

  const list = el("div", "template-list");
  TEMPLATES.forEach(t => {
    const row = el("button", "template-row");
    row.innerHTML = `<span class="template-icon">${t.icon}</span>
                     <span class="template-name">${t.name}</span>`;
    row.onclick = async () => {
      closeModal();
      const blocks = t.blocks.map(b => {
        const nb = U.block(b.type, b.content || "");
        if (b.type === "ul" || b.type === "ol"){
          nb.content = b.content || "<li><br></li>";
          if (b.type === "ul") nb.marker = "disc";
        }
        return nb;
      });
      const doc = await window.App.state.createDocument({
        title: t.name,
        blocks,
        folderId: currentFolderId
      });
      await window.App.state.setActiveDoc(doc.id);
      window.App.tabs?.render();
      render();
    };
    list.append(row);
  });
  box.append(list);

  const actions = el("div", "modal-actions");
  const cancel = el("button", "modal-btn");
  cancel.textContent = "Отмена";
  cancel.onclick = closeModal;
  actions.append(cancel);
  box.append(actions);

  backdrop.append(box);
  document.body.append(backdrop);
  backdrop.addEventListener("mousedown", e => {
    if (e.target === backdrop) closeModal();
  });
}

/* ---------- Свёртывание ---------- */

function toggleSidebar(open){
  const v = (open === undefined) ? !St().ui.sidebarOpen : open;
  St().ui.sidebarOpen = v;
  window.App.state.setUI("sidebarOpen", v);
  const aside = $("#sidebar");
  if (aside) aside.classList.toggle("collapsed", !v);
}

/* ---------- Публичный API ---------- */

return {
  render,
  toggleSidebar,
  openDocument,
  createNewDocument,
  createFolder,
  createFromTemplate,
  moveDocumentToFolder,
  openModal,
  closeModal,
  openProperties,
  get currentFolderId(){ return currentFolderId; }
};

})();