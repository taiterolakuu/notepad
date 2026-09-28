/* ============================================================
   tabs.js — панель вкладок над редактором

   [Пакет 14] openTabs фильтруется от мёртвых id; closeTab
              по отфильтрованному списку; prev/next — i === -1 → 0.
   [Пакет 15] role="tab", aria-selected; средняя кнопка закрывает.

   Зависит от: utils, state
   ============================================================ */

window.App = window.App || {};

window.App.tabs = (() => {
"use strict";

const U = window.App.utils;
const { $, el } = U;

const St = () => window.App.state.S;

/* ---------- Отфильтрованный список ---------- */

function _liveTabs(){
  return (St().ui.openTabs || []).filter(id => {
    const d = St().documents[id];
    return d && !d.trashed;
  });
}

/* ---------- Рендер ---------- */

function render(){
  const bar = $("#tabs");
  if (!bar) return;

  const ids = _liveTabs();

  /* Если активного нет в табах — добавим в конец */
  if (St().activeDocId && St().documents[St().activeDocId] && !ids.includes(St().activeDocId)){
    ids.push(St().activeDocId);
    /* Синхронизируем S.ui.openTabs, чтобы мёртвые id не копились */
    St().ui.openTabs = ids;
    window.App.state.setUI("openTabs", ids);
  } else if (ids.length !== (St().ui.openTabs || []).length){
    /* Мёртвые id отфильтровались — синхронизируем */
    St().ui.openTabs = ids;
    window.App.state.setUI("openTabs", ids);
  }

  bar.innerHTML = "";

  if (!ids.length){
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";

  ids.forEach(id => {
    const doc = St().documents[id];
    if (!doc) return;

    const isActive = id === St().activeDocId;

    const tab = el("div", "tab" + (isActive ? " active" : ""));
    tab.dataset.docId = id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.tabIndex = 0;

    const title = el("span", "tab-title");
    title.textContent = doc.title || "Без названия";
    tab.append(title);

    const close = el("button", "tab-close");
    close.type = "button";
    close.textContent = "×";
    close.title = "Закрыть вкладку (Alt+W)";
    close.setAttribute("aria-label", "Закрыть вкладку");
    close.onclick = e => {
      e.stopPropagation();
      closeTab(id);
    };
    tab.append(close);

    tab.onclick = () => window.App.state.setActiveDoc(id);

    /* [Пакет 15] средняя кнопка закрывает */
    tab.addEventListener("auxclick", e => {
      if (e.button === 1){
        e.preventDefault();
        closeTab(id);
      }
    });

    /* Enter / Space — активировать */
    tab.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " "){
        e.preventDefault();
        window.App.state.setActiveDoc(id);
      }
    });

    bar.append(tab);
  });

  /* Прокрутка активного таба в видимую зону контейнера вкладок */
  const active = bar.querySelector(".tab.active");
  if (active){
    try {
      active.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    } catch(_){
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
}

/* ---------- Закрытие ---------- */

function closeTab(id){
  /* Работаем с отфильтрованным списком, чтобы не считать мёртвые id */
  const ids = _liveTabs();
  const idx = ids.indexOf(id);

  if (idx >= 0){
    ids.splice(idx, 1);
  }

  /* Сосед — по отфильтрованному списку, или активный документ */
  let next = null;
  if (id === St().activeDocId){
    next = ids[Math.max(0, idx - 1)] || ids[0] || null;
  }

  /* Обновляем openTabs в state до переключения */
  St().ui.openTabs = ids;
  window.App.state.setUI("openTabs", ids);

  if (id === St().activeDocId){
    if (next){
      window.App.state.setActiveDoc(next);
    } else {
      /* Все вкладки закрыты — оставляем активный документ как единственный */
      const fallback = Object.values(St().documents).find(d => !d.trashed);
      if (fallback){
        window.App.state.setActiveDoc(fallback.id);
      }
    }
  }

  render();
}

/* ---------- Следующий/предыдущий ---------- */

function nextTab(){
  const ids = _liveTabs();
  if (ids.length < 2) return;

  let i = ids.indexOf(St().activeDocId);
  if (i < 0) i = 0; /* [Пакет 14] активного нет в списке — стартуем с 0 */

  const j = (i + 1) % ids.length;
  window.App.state.setActiveDoc(ids[j]);
}

function prevTab(){
  const ids = _liveTabs();
  if (ids.length < 2) return;

  let i = ids.indexOf(St().activeDocId);
  if (i < 0) i = 0; /* [Пакет 14] то же */

  const j = (i - 1 + ids.length) % ids.length;
  window.App.state.setActiveDoc(ids[j]);
}

return { render, closeTab, nextTab, prevTab };

})();