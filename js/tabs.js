/* ============================================================
   tabs.js — панель вкладок над редактором
   Зависит от: utils, state
   ============================================================ */

window.App = window.App || {};

window.App.tabs = (() => {
"use strict";

const U = window.App.utils;
const { $, el } = U;

const St = () => window.App.state.S;

/* ---------- Рендер ---------- */

function render(){
  const bar = $("#tabs");
  if (!bar) return;
  bar.innerHTML = "";

  const ids = St().ui.openTabs.filter(id => St().documents[id] && !St().documents[id].trashed);

  /* если активного нет в табах — добавим */
  if (St().activeDocId && !ids.includes(St().activeDocId)){
    ids.push(St().activeDocId);
  }

  if (!ids.length){
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";

  ids.forEach(id => {
    const doc = St().documents[id];
    if (!doc) return;

    const tab = el("div", "tab" + (id === St().activeDocId ? " active" : ""));
    tab.dataset.docId = id;

    const title = el("span", "tab-title");
    title.textContent = doc.title || "Без названия";
    tab.append(title);

    const close = el("button", "tab-close");
    close.textContent = "×";
    close.title = "Закрыть вкладку (Ctrl+W)";
    close.onclick = e => {
      e.stopPropagation();
      closeTab(id);
    };
    tab.append(close);

    tab.onclick = () => window.App.state.setActiveDoc(id);

    bar.append(tab);
  });

  /* прокрутка активного таба в видимую зону */
  const active = bar.querySelector(".tab.active");
  if (active){
    active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function closeTab(id){
  const idx = St().ui.openTabs.indexOf(id);
  if (idx >= 0){
    St().ui.openTabs.splice(idx, 1);
    window.App.state.setUI("openTabs", St().ui.openTabs);
  }

  /* если закрыли активный — переключаемся на соседний */
  if (id === St().activeDocId){
    const next = St().ui.openTabs[Math.max(0, idx - 1)] || St().ui.openTabs[0];
    if (next){
      window.App.state.setActiveDoc(next);
    } else {
      /* все табы закрыты — показываем активный документ */
      const fallback = Object.values(St().documents).find(d => !d.trashed);
      if (fallback) window.App.state.setActiveDoc(fallback.id);
    }
  }
  render();
}

/* ---------- Следующий/предыдущий ---------- */

function nextTab(){
  const ids = St().ui.openTabs.filter(id => St().documents[id] && !St().documents[id].trashed);
  if (ids.length < 2) return;
  const i = ids.indexOf(St().activeDocId);
  const j = (i + 1) % ids.length;
  window.App.state.setActiveDoc(ids[j]);
}

function prevTab(){
  const ids = St().ui.openTabs.filter(id => St().documents[id] && !St().documents[id].trashed);
  if (ids.length < 2) return;
  const i = ids.indexOf(St().activeDocId);
  const j = (i - 1 + ids.length) % ids.length;
  window.App.state.setActiveDoc(ids[j]);
}

return { render, closeTab, nextTab, prevTab };

})();