/* ============================================================
   render/paste.js — paste handler и cleanup пустых <li>

   [Пакет 5]  sanitize/cleanPastedHTML через <template>
              (в utils.js).
   [Пакет 12] plain text → escape + <br>; HTML → sanitize +
              cleanPastedHTML.

   Зависит от: render/_shared, utils
   ============================================================ */

window.App = window.App || {};

window.App.renderPaste = (() => {
"use strict";

const S = window.App.renderShared;
const { U, escape, sanitize } = S;

/* ---------- Paste ---------- */

function makePasteHandler(target){
  return function(e){
    const html = e.clipboardData?.getData("text/html");
    const text = e.clipboardData?.getData("text/plain");

    if (!html && !text) return;
    e.preventDefault();

    let clean;
    if (html){
      /* HTML из буфера: sanitize → cleanPastedHTML */
      clean = U.cleanPastedHTML(sanitize(html));
      /* Если после санитайза ничего не осталось — используем plain text */
      if (!clean.trim() && text){
        clean = escape(text).replace(/\n/g, "<br>");
      }
    } else {
      /* Только plain text — escape + <br> */
      clean = escape(text).replace(/\n/g, "<br>");
    }

    document.execCommand("insertHTML", false, clean);

    /* Каретка после вставки */
    try {
      const sel = getSelection();
      if (sel.rangeCount){
        const r = sel.getRangeAt(0);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } catch(_){}
  };
}

/* ---------- Cleanup ---------- */

function cleanupEmptyLis(body){
  [...body.querySelectorAll("ul, ol")].forEach(list => {
    const items = [...list.children].filter(c => c.tagName === "LI");
    items.forEach(li => {
      const isEmpty =
        li.innerText.trim() === "" &&
        !li.querySelector("img, .todo-inline, .indent-tab");
      if (isEmpty && items.length > 1) li.remove();
    });
    if (!list.querySelector("li")) list.remove();
  });
}

return { makePasteHandler, cleanupEmptyLis };
})();