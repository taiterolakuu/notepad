/* ============================================================
   menus/search.js — глобальный поиск по содержимому

   [Пакет 9]  regex-escape query; подсветка через функцию;
              debounce; таблицы и колонки в поиске.
   [Пакет 13] один htmlToText на блок (getBlockText);
              ранний break по 40 результатам.

   Зависит от: menus/_shared
   ============================================================ */

window.App = window.App || {};

window.App.menusSearch = (() => {
"use strict";

const S = window.App.menusShared;
const { $, $$, htmlToText, escape, St, LINE_TYPES } = S;
const U = window.App.utils;

/* ---------- Debounce ---------- */

let _searchTimer = null;

/* ---------- Открытие ---------- */

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
  S.paletteMode = "search";
  S.cmdIndex = 0;
  S.lastCmdLen = -1;
  globalSearchRender("");
  inp?.focus();
}

/* ---------- Рендер результатов ---------- */

function _escRe(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* [Пакет 13] Собирает плоский текст блока: строки, таблица, колонки */
function _blockText(b){
  if (!b) return "";
  if (b.type === "table" && Array.isArray(b.rows)){
    const parts = [];
    for (const row of b.rows){
      for (const cell of row){
        const t = htmlToText(cell || "");
        if (t) parts.push(t);
      }
    }
    return parts.join(" ");
  }
  if (b.type === "columns" && Array.isArray(b.content)){
    return b.content
      .map(c => htmlToText(c || ""))
      .filter(Boolean)
      .join(" ");
  }
  /* LINE_TYPES + обычные */
  return U.getBlockText(b) || "";
}

function globalSearchRender(q){
  /* [Пакет 9] debounce — не гоняем поиск на каждый ввод */
  clearTimeout(_searchTimer);

  const renderNow = () => _renderSearchResults(q);
  if (!q){
    renderNow();
  } else {
    _searchTimer = setTimeout(renderNow, 150);
  }
}

function _renderSearchResults(q){
  const query = String(q || "").toLowerCase().trim();
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
      /* [Пакет 13] один проход на блок через getBlockText */
      const text = _blockText(b);
      if (!text) continue;

      const lower = text.toLowerCase();
      const idx = lower.indexOf(query);
      if (idx >= 0){
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

  /* [Пакет 9] экранируем query в regex + подсветка через функцию */
  const re = new RegExp(_escRe(query), "gi");

  let html = `<div class="results-group">Найдено: ${hits.length}</div>`;
  html += hits.map((h, i) => {
    const sel = i === S.cmdIndex ? "sel" : "";
    const title = escape(h.doc.title || "Без названия");
    const sn = escape(h.snippet || "")
      .replace(re, (m) => `<mark>${m}</mark>`);
    return `<div class="result ${sel}" data-doc="${escape(h.doc.id)}">
      <b>${title}</b>
      <small>${sn}</small>
    </div>`;
  }).join("");

  res.innerHTML = html;

  $$("#cmdresults .result").forEach(el => {
    el.onclick = () => {
      const id = el.dataset.doc;
      if (id) window.App.menusPalette.openDocById(id);
    };
  });
}

return { openGlobalSearch, globalSearchRender };
})();