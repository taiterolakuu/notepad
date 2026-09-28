/* ============================================================
   sidebar/main.js — главный render() sidebar, шапка, хлебные крошки,
                     теги, секции, ноги, toggleSidebar, createNewDocument

   [Пакет 11] sidebarWidth применяется; startupMode читается.
   [Пакет 15] aria-current на разделах; aria-label на кнопках.

   Зависит от: sidebar/_shared, sidebar/modals, sidebar/folders,
               sidebar/cards, sidebar/list
   ============================================================ */

window.App = window.App || {};

window.App.sidebarMain = (() => {
"use strict";

const S = window.App.sidebarShared;
const { $, $$, el, toast, St, now } = S;

/* ============================================================
   Главный render
   ============================================================ */

function render(){
  const aside = $("#sidebar");
  if (!aside) return;

  aside.innerHTML = "";
  aside.classList.toggle("collapsed", !St().ui.sidebarOpen);

  /* [Пакет 11] Применяем сохранённую ширину */
  const w = Number(St().ui.sidebarWidth);
  if (Number.isFinite(w) && w >= 160 && w <= 480){
    aside.style.width = w + "px";
  } else {
    aside.style.width = "";
  }

  /* Шапка */
  const header = el("div", "sb-header");

  const plus = el("button", "sb-iconbtn");
  plus.title = "Новый документ (Alt+N)";
  plus.setAttribute("aria-label", "Новый документ");
  plus.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M5 12h14"/><path d="M12 5v14"/>
    </svg>`;
  plus.onclick = () => createNewDocument();
  header.append(plus);

  const search = el("input", "sb-search");
  search.type = "search";
  search.placeholder = "Поиск по названию…";
  search.setAttribute("aria-label", "Поиск по названию");
  search.value = S.searchQuery;
  search.oninput = () => {
    S.searchQuery = search.value;
    window.App.sidebarList.renderList();
  };
  header.append(search);

  /* Переключатель режима карточек */
  const modeBtn = el("button", "sb-iconbtn");
  modeBtn.title = "Режим карточек";
  modeBtn.setAttribute("aria-label", "Режим карточек");
  modeBtn.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>`;
  modeBtn.onclick = () => {
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
  sortBtn.setAttribute("aria-label", "Сортировка");
  sortBtn.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="m3 16 4 4 4-4"/>
      <path d="M7 20V4"/>
      <path d="m21 8-4-4-4 4"/>
      <path d="M17 4v16"/>
    </svg>`;
  sortBtn.onclick = () => {
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
  collapse.setAttribute("aria-label", "Свернуть панель");
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
  window.App.sidebarFolders.folderChain(S.currentFolderId).forEach(f => {
    const sep = el("span", "sb-crumb-sep");
    sep.textContent = "/";
    crumbs.append(sep);
    crumbs.append(makeCrumb(f.name, f.id));
  });
  aside.append(crumbs);

  /* Теги */
  const allTags = new Set();
  Object.values(St().documents).forEach(d => (d.tags || []).forEach(t => allTags.add(t)));
  if (allTags.size){
    const tagBar = el("div", "sb-tagbar");
    if (S.currentTag){
      const clear = el("button", "sb-tagchip clear");
      clear.textContent = "× " + S.currentTag;
      clear.onclick = () => { S.currentTag = null; render(); };
      tagBar.append(clear);
    } else {
      const all = el("button", "sb-tagchip on");
      all.textContent = "Все";
      all.onclick = () => { S.currentTag = null; render(); };
      tagBar.append(all);
      [...allTags].sort().slice(0, 8).forEach(t => {
        const b = el("button", "sb-tagchip");
        b.textContent = "#" + t;
        b.onclick = () => { S.currentTag = t; render(); };
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
    const isActive = St().ui.section === key;
    const b = el("button", "sb-section" + (isActive ? " active" : ""));
    /* [Пакет 15] */
    b.setAttribute("aria-current", isActive ? "page" : "false");
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
    addFolder.onclick = () => window.App.sidebarModals.createFolder();
    foot.append(addFolder);
  }
  aside.append(foot);

  window.App.sidebarList.renderList();
}

/* ---------- Хлебная крошка ---------- */

function makeCrumb(label, folderId){
  const c = el("button", "sb-crumb" + (folderId === S.currentFolderId ? " current" : ""));
  c.textContent = label;
  c.onclick = () => {
    S.currentFolderId = folderId;
    render();
  };
  return c;
}

/* ---------- Свёртывание ---------- */

function toggleSidebar(open){
  const v = (open === undefined) ? !St().ui.sidebarOpen : open;
  St().ui.sidebarOpen = v;
  window.App.state.setUI("sidebarOpen", v);
  const aside = $("#sidebar");
  if (aside) aside.classList.toggle("collapsed", !v);
}

/* ---------- Создание нового документа ---------- */

async function createNewDocument(){
  /* [Пакет 11] Учитываем newDocFolder */
  const mode = St().ui.newDocFolder || "current";
  let folderId = null;
  if (mode === "current") folderId = S.currentFolderId || null;
  else if (mode === "root") folderId = null;
  /* "inbox" — заглушка: пока то же, что root */

  const doc = await window.App.state.createDocument({ folderId });
  await window.App.state.setActiveDoc(doc.id);
}

return {
  render,
  toggleSidebar,
  createNewDocument,
  makeCrumb
};
})();