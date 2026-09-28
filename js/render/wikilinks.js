/* ============================================================
   render/wikilinks.js — wikilink resolver, toDisplay/toSource, click

   [Пакет 5]  toSourceHTML на <template> (безопаснее div.innerHTML).
   [Пакет 12] клик по wikilink — preventDefault только без
              модификаторов; иначе даём браузеру/каретке.

   Зависит от: render/_shared, utils
   ============================================================ */

window.App = window.App || {};

window.App.renderWikilinks = (() => {
"use strict";

const S = window.App.renderShared;
const { $, U } = S;

/* ---------- Resolver для [[...]] ---------- */

function wikilinkResolver(name){
  const r = window.App.state.resolveDocByName(name);
  if (r) return { id: r.doc.id };
  return { missing: true };
}

/* ---------- HTML ↔ source ---------- */

function toDisplayHTML(html){
  return U.renderWikilinks(html || "", wikilinkResolver);
}

function toSourceHTML(html){
  if (!html) return "";

  /* [Пакет 5] через <template>, не div.innerHTML */
  const frag = U.parseHTMLFragment(html);

  frag.querySelectorAll("a.wikilink").forEach(a => {
    const name     = a.getAttribute("data-wikilink") || a.textContent || "";
    const bAnchor  = a.getAttribute("data-wikilink-block-anchor") || "";
    const lAnchor  = a.getAttribute("data-wikilink-line-anchor") || "";
    const fAnchor  = a.getAttribute("data-wikilink-fragment-anchor") || "";
    const anchors  = [bAnchor, lAnchor, fAnchor].filter(Boolean).join("#");
    const full     = anchors ? `${name}#${anchors}` : name;
    a.replaceWith(document.createTextNode(`[[${full}]]`));
  });

  const div = document.createElement("div");
  div.append(frag);
  return div.innerHTML;
}

/* ---------- Глобальный обработчик клика ---------- */

function bindWikilinkClicks(){
  document.addEventListener("click", e => {
    const link = e.target.closest(".wikilink");
    if (!link) return;

    /* [Пакет 12] С модификатором — не перехватываем,
       чтобы пользователь мог выделить/поставить каретку */
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    e.preventDefault();
    e.stopPropagation();

    const name       = link.getAttribute("data-wikilink") || link.textContent;
    const id         = link.getAttribute("data-wikilink-id");
    const bAnchor    = link.getAttribute("data-wikilink-block-anchor") || "";
    const lAnchor    = link.getAttribute("data-wikilink-line-anchor") || "";
    const fAnchor    = link.getAttribute("data-wikilink-fragment-anchor") || "";
    const St         = window.App.state.S;

    const openDoc = (docId) => {
      Promise.resolve(window.App.state.setActiveDoc(docId)).then(() => {
        if (bAnchor || lAnchor){
          window.App.state.scrollToAnchorPath(docId, bAnchor, lAnchor, fAnchor);
        }
      });
    };

    if (id && St.documents[id] && !St.documents[id].trashed){
      openDoc(id);
      return;
    }

    const r = window.App.state.resolveDocByName(name);
    if (r){
      openDoc(r.doc.id);
      if (r.count > 1){
        U.toast(`Есть ещё ${r.count - 1} документов с таким именем`);
      }
      return;
    }

    if (confirm(`Документ «${name}» не найден. Создать?`)){
      window.App.state.createDocument({ title: name }).then(doc => {
        openDoc(doc.id);
        window.App.sidebar?.render();
        window.App.tabs?.render();
      });
    }
  });
}

return { wikilinkResolver, toDisplayHTML, toSourceHTML, bindWikilinkClicks };
})();