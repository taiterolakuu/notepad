/* ============================================================
   sidebar/cards.js — карточка документа, inline-rename,
                      контекстное меню карточки, операции

   [Пакет 6]  firstLineOf через U.getBlockText (учитывает lines).
   [Пакет 12] Escape в inline-rename не коммитит.
   [Пакет 14] tabindex + role="button" + aria-label.

   Зависит от: sidebar/_shared, sidebar/modals, sidebar/folders
   ============================================================ */

window.App = window.App || {};

window.App.sidebarCards = (() => {
"use strict";

const S = window.App.sidebarShared;
const { $, el, escape, toast, St, now } = S;
const U = window.App.utils;

/* ---------- Карточка ---------- */

function makeCard(doc, mode){
  const c = el("article", "sb-card mode-" + mode);
  c.dataset.docId = doc.id;
  c.draggable = true;
  /* [Пакет 14] доступность */
  c.tabIndex = 0;
  c.setAttribute("role", "button");
  c.setAttribute("aria-label", doc.title || "Без названия");

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

  /* [Пакет 11] уважаем showPreview/hidePreview */
  const showPreview = St().ui.hidePreview !== true && St().ui.showPreview !== false;
  if (mode !== "mini" && showPreview){
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

  /* [Пакет 11] showDate */
  if (St().ui.showDate !== false){
    const meta = el("div", "sb-card-meta");
    meta.textContent = mode === "detailed"
      ? window.App.sidebarFolders.relTime(doc.updatedAt) + " · " + doc.wordCount + " сл."
      : window.App.sidebarFolders.relTime(doc.updatedAt);
    c.append(meta);
  }

  c.onclick = e => {
    if (c.querySelector(".sb-rename-input")) return;
    openDocument(doc.id);
  };

  /* [Пакет 14] клавиатура */
  c.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " "){
      e.preventDefault();
      openDocument(doc.id);
    } else if (e.key === "Delete"){
      e.preventDefault();
      trash(doc.id);
    } else if (e.key === "F2"){
      e.preventDefault();
      startInlineRename(c, doc, title);
    }
  });

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

/* ---------- Inline-rename ---------- */

function startInlineRename(card, doc, titleEl){
  if (card.querySelector(".sb-rename-input")) return;

  const input = el("input", "sb-rename-input");
  input.type = "text";
  input.value = doc.title || "";
  input.placeholder = "Название";
  input.spellcheck = false;

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  /* [Пакет 12] Escape НЕ коммитит */
  let canceled = false;

  const commit = async () => {
    if (canceled) return;
    const v = input.value.trim();
    const prev = doc.title || "";
    input.replaceWith(titleEl);
    if (!v || v === prev) return;
    await window.App.state.renameDocument(doc.id, v);
    titleEl.textContent = v;
    window.App.tabs?.render();
  };

  const cancel = () => {
    canceled = true;
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

/* ---------- Первая строка превью ---------- */

function firstLineOf(doc){
  const blocks = doc.blocks || [];
  for (const b of blocks){
    /* [Пакет 6] учитываем lines */
    const t = (U.getBlockText(b) || "").trim();
    if (t) return t.slice(0, 80);
  }
  return "";
}

/* ---------- Открыть документ ---------- */

async function openDocument(id){
  await window.App.state.setActiveDoc(id);
}

/* ---------- Контекстное меню карточки ---------- */

function openCardMenu(docId, anchor){
  closeCardMenu();
  const menu = el("div", "sb-ctxmenu");
  menu.id = "sb-ctxmenu";
  S.contextMenuDoc = docId;

  const doc = St().documents[docId];
  const inTrash = !!doc?.trashed;
  const isArchived = !!doc?.archived;

  const items = inTrash ? [
    ["Восстановить", () => restore(docId)],
    ["Удалить навсегда", () => purge(docId), "danger"]
  ] : [
    ["Открыть",         () => openDocument(docId)],
    ["Свойства…",       () => window.App.sidebarModals.openProperties(docId)],
    ["Переименовать",   () => promptRename(docId)],
    ["Дублировать",     () => duplicate(docId)],
    [doc?.pinned ? "Открепить" : "Закрепить", () => togglePinned(docId)],
    [doc?.favorite ? "Убрать из избранного" : "В избранное", () => toggleFavorite(docId)],
    [isArchived ? "Из архива" : "В архив", () => toggleArchived(docId)],
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
  S.contextMenuDoc = null;
}

/* ---------- Операции ---------- */

async function promptRename(docId){
  const doc = St().documents[docId];
  if (!doc) return;
  window.App.sidebarModals.openModal({
    title: "Переименовать документ",
    placeholder: "Название",
    value: doc.title || "",
    okLabel: "Переименовать",
    onOk: async (name) => {
      await window.App.state.renameDocument(docId, name);
      window.App.sidebarMain.render();
    }
  });
}

async function duplicate(docId){
  const copy = await window.App.state.duplicateDocument(docId);
  if (copy){
    toast("Дубликат создан");
    window.App.sidebarMain.render();
  }
}

async function toggleFavorite(docId){
  const doc = St().documents[docId];
  if (!doc) return;
  await window.App.state.setDocumentField(docId, "favorite", !doc.favorite);
  window.App.sidebarMain.render();
}

async function togglePinned(docId){
  const doc = St().documents[docId];
  if (!doc) return;
  await window.App.state.setDocumentField(docId, "pinned", !doc.pinned);
  window.App.sidebarMain.render();
}

async function toggleArchived(docId){
  const doc = St().documents[docId];
  if (!doc) return;
  await window.App.state.setDocumentField(docId, "archived", !doc.archived);
  window.App.sidebarMain.render();
}

async function trash(docId){
  await window.App.state.trashDocument(docId);
  window.App.sidebarMain.render();
}

async function restore(docId){
  await window.App.state.restoreDocument(docId);
  window.App.sidebarMain.render();
}

async function purge(docId){
  if (!confirm("Удалить документ безвозвратно?")) return;
  await window.App.state.purgeDocument(docId);
  window.App.sidebarMain.render();
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
    window.App.sidebarMain.render();
  } catch (e){
    console.error("move error:", e);
    toast("Не удалось переместить");
  }
}

return {
  makeCard, startInlineRename, firstLineOf, openDocument,
  openCardMenu, closeCardMenu, onDocClickCloseMenu,
  promptRename, duplicate,
  toggleFavorite, togglePinned, toggleArchived,
  trash, restore, purge,
  moveDocumentToFolder
};
})();