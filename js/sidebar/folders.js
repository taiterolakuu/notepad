/* ============================================================
   sidebar/folders.js — строка папки, контекстное меню, цепочка, время

   [Пакет 9]  folderChain с защитой от циклов (max 64).
   [Пакет 11] relTime уважает showDate в карточках.

   Зависит от: sidebar/_shared, sidebar/modals
   ============================================================ */

window.App = window.App || {};

window.App.sidebarFolders = (() => {
"use strict";

const S = window.App.sidebarShared;
const { $, el, escape, toast, St, now } = S;

/* ---------- Цепочка папок (с защитой от циклов) ---------- */

function folderChain(id){
  const chain = [];
  let f = St().folders[id];
  let guard = 0;
  const seen = new Set();
  while (f && guard < 64){
    if (seen.has(f.id)) break;  /* [Пакет 9] цикл */
    seen.add(f.id);
    chain.unshift(f);
    f = f.parentId ? St().folders[f.parentId] : null;
    guard++;
  }
  return chain;
}

/* ---------- Относительное время ---------- */

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

/* ---------- Строка папки ---------- */

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
    S.currentFolderId = f.id;
    window.App.sidebarMain.render();
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
    await window.App.sidebarCards.moveDocumentToFolder(docId, f.id);
  });

  return row;
}

/* ---------- Контекстное меню папки ---------- */

function openFolderMenu(folderId, anchor){
  const CM = window.App.sidebarCards;
  CM.closeCardMenu();

  const menu = el("div", "sb-ctxmenu");
  menu.id = "sb-ctxmenu";

  const Modals = window.App.sidebarModals;
  const items = [
    ["Переименовать", () => Modals.renameFolder(folderId)],
    ["Новая подпапка", () => Modals.createFolder(folderId)],
    ["Удалить", () => Modals.deleteFolder(folderId), "danger"]
  ];
  items.forEach(([label, fn, cls]) => {
    const b = el("button", "sb-ctxitem" + (cls ? " " + cls : ""));
    b.textContent = label;
    b.onclick = e => {
      e.stopPropagation();
      CM.closeCardMenu();
      fn();
    };
    menu.append(b);
  });

  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.right - 180, window.innerWidth - 200) + "px";
  menu.style.top  = Math.min(r.bottom + 4, window.innerHeight - 200) + "px";
  document.body.append(menu);
  setTimeout(() => {
    document.addEventListener("mousedown", CM.onDocClickCloseMenu, { once: true });
  }, 0);
}

return { folderChain, relTime, makeFolderRow, openFolderMenu };
})();