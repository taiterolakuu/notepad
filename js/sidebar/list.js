/* ============================================================
   sidebar/list.js — список карточек и папок, drag&drop в корень

   [Пакет 9]  documents с несуществующим folderId показываются в корне.
   [Пакет 14] dragover/drop — навешиваются один раз.

   Зависит от: sidebar/_shared, sidebar/folders, sidebar/cards
   ============================================================ */

window.App = window.App || {};

window.App.sidebarList = (() => {
"use strict";

const S = window.App.sidebarShared;
const { $, el, St } = S;

/* ---------- Рендер списка ---------- */

function renderList(){
  const list = $("#sb-list");
  if (!list) return;
  list.innerHTML = "";

  const isAllSection = St().ui.section === "all";
  const isTrash      = St().ui.section === "trash";

  /* drop-зона: пустое место = вынести наверх */
  if (!list.dataset.boundDrop){
    list.dataset.boundDrop = "1";

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
      await window.App.sidebarCards.moveDocumentToFolder(docId, S.currentFolderId || null);
    });
  }

  /* Папки */
  if (isAllSection && !S.searchQuery){
    const folders = Object.values(St().folders)
      .filter(f => (f.parentId || null) === (S.currentFolderId || null))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (folders.length){
      const wrap = el("div", "sb-folders");
      folders.forEach(f => wrap.append(window.App.sidebarFolders.makeFolderRow(f)));
      list.append(wrap);
    }
  }

  /* Документы */
  let folderFilter;
  if (isAllSection && !S.searchQuery){
    folderFilter = S.currentFolderId || null;
  } else {
    folderFilter = undefined;
  }

  /* [Пакет 9] Если папка не существует — показываем в корне */
  if (folderFilter && !St().folders[folderFilter]){
    folderFilter = null;
    S.currentFolderId = null;
  }

  let docs = window.App.state.listDocuments({
    section: St().ui.section,
    folderId: folderFilter,
    query: S.searchQuery
  });

  /* [Пакет 9] Документы с folderId несуществующей папки не теряем:
     если фильтр задан и папки нет — попадают в корень */
  if (folderFilter === null && isAllSection && !S.searchQuery){
    docs = docs.filter(d => {
      const fid = d.folderId || null;
      return fid === null || !St().folders[fid];
    });
  }

  if (S.currentTag){
    docs = docs.filter(d => (d.tags || []).includes(S.currentTag));
  }

  if (!docs.length && !list.children.length){
    const empty = el("div", "sb-empty");
    empty.textContent = S.searchQuery
      ? "Ничего не найдено"
      : (isTrash ? "Корзина пуста" : "Нет документов");
    list.append(empty);
    return;
  }

  const mode = St().ui.cardMode;
  docs.forEach(doc => list.append(window.App.sidebarCards.makeCard(doc, mode)));
}

return { renderList };
})();