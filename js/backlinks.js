/* ============================================================
   backlinks.js — панель под документом:
                  «Ссылаются отсюда» + «Возможно, вы имели в виду»

   [Пакет 6]  linkifyMention — \p{L}\p{N}+u, замена через функцию,
              только DOM-узлы (не HTML-строка), .catch на save.
   [Пакет 13] findUnlinkedMentions — через state (кэш);
              панель не дублирует рендер.

   Зависит от: utils, state, render
   ============================================================ */

window.App = window.App || {};

window.App.backlinks = (() => {
"use strict";

const U = window.App.utils;
const { $, el, escape, toast, LINE_TYPES } = U;

const St = () => window.App.state.S;
const getActiveDoc = () => window.App.state.getActiveDoc();

/* ---------- Развёрнуто/свёрнуто ---------- */

function isExpanded(){
  return !!St().ui.backlinksExpanded;
}

function toggleExpanded(){
  window.App.state.setUI("backlinksExpanded", !isExpanded());
  render();
}

/* ---------- Хелпер: разобрать анкор-строку в 3 части ---------- */
function parseAnchorTriple(anchorStr){
  const parts = String(anchorStr || "").split("#").map(p => p.trim());
  return {
    blockAnchor:    parts[0] || "",
    lineAnchor:     parts[1] || "",
    fragmentAnchor: parts[2] || ""
  };
}

/* ---------- Рендер ---------- */

function render(){
  const host = $("#backlinks");
  if (!host) return;

  const doc = getActiveDoc();
  if (!doc){
    host.innerHTML = "";
    host.style.display = "none";
    return;
  }

  const backlinks = window.App.state.getBacklinks(doc.id);
  const mentions  = window.App.state.findUnlinkedMentions(doc.id);

  if (!backlinks.length && !mentions.length){
    host.innerHTML = "";
    host.style.display = "none";
    return;
  }

  host.style.display = "block";
  host.innerHTML = "";

  const bar = el("button", "bl-bar");
  bar.type = "button";
  bar.setAttribute("aria-expanded", isExpanded() ? "true" : "false");

  const arrow = el("span", "bl-arrow");
  arrow.textContent = isExpanded() ? "▾" : "▸";
  bar.append(arrow);

  if (backlinks.length){
    const chip = el("span", "bl-chip");
    chip.textContent = `📎 ${backlinks.length} ${plural(backlinks.length, "ссылка", "ссылки", "ссылок")}`;
    bar.append(chip);
  }

  if (mentions.length){
    const chip = el("span", "bl-chip");
    chip.textContent = `💡 ${mentions.length} ${plural(mentions.length, "упоминание", "упоминания", "упоминаний")}`;
    bar.append(chip);
  }

  bar.onclick = toggleExpanded;
  host.append(bar);

  if (!isExpanded()) return;

  const body = el("div", "bl-body");

  if (backlinks.length){
    body.append(renderGroup({
      title: "Ссылаются отсюда",
      icon: "📎",
      items: backlinks.map(b => ({
        doc: b.doc,
        snippet: b.snippet,
        anchor: b.anchor || "",
        action: "open"
      }))
    }));
  }

  if (mentions.length){
    body.append(renderGroup({
      title: "Возможно, вы имели в виду",
      icon: "💡",
      items: mentions.map(m => ({
        doc: m.doc,
        snippet: `${m.count} ${plural(m.count, "упоминание", "упоминания", "упоминаний")}`,
        action: "link",
        targetName: doc.title
      }))
    }));
  }

  host.append(body);
}

function renderGroup({ title, icon, items }){
  const wrap = el("div", "bl-group");

  const head = el("div", "bl-group-title");
  head.textContent = `${icon} ${title}`;
  wrap.append(head);

  const list = el("div", "bl-list");

  items.forEach(it => {
    const row = el("div", "bl-item");

    const name = el("button", "bl-item-name");
    name.type = "button";

    if (it.doc.icon){
      const ic = el("span", "bl-item-icon");
      ic.textContent = it.doc.icon;
      name.append(ic);
    }

    const t = el("span", "bl-item-text");
    t.textContent = it.doc.title || "Без названия";
    name.append(t);

    if (it.anchor){
      const a = el("span", "bl-item-anchor");
      a.textContent = "#" + it.anchor;
      name.append(a);
    }

    name.onclick = () => {
      const docId = it.doc.id;
      const anchorStr = it.anchor || "";

      Promise.resolve(window.App.state.setActiveDoc(docId)).then(() => {
        if (anchorStr){
          const { blockAnchor, lineAnchor, fragmentAnchor } = parseAnchorTriple(anchorStr);
          if (window.App.state.scrollToAnchorPath){
            window.App.state.scrollToAnchorPath(docId, blockAnchor, lineAnchor, fragmentAnchor);
          } else if (window.App.state.scrollToAnchor){
            window.App.state.scrollToAnchor(docId, anchorStr);
          }
        }
      });
    };
    row.append(name);

    if (it.snippet){
      const sn = el("span", "bl-item-snip");
      sn.textContent = it.snippet;
      row.append(sn);
    }

    if (it.action === "link"){
      const btn = el("button", "bl-item-action");
      btn.type = "button";
      btn.title = "Превратить первое упоминание в ссылку";
      btn.textContent = "[ ]";
      btn.onclick = (e) => {
        e.stopPropagation();
        linkifyMention(it.doc.id, it.targetName);
      };
      row.append(btn);
    }

    list.append(row);
  });

  wrap.append(list);
  return wrap;
}

/* ============================================================
   [Пакет 6] linkifyMention — через DOM, не HTML-строку
   ============================================================ */

/* Проходит по текстовым узлам внутри html-строки и заменяет
   первое совпадение name на [[name]]. Возвращает { html, changed }. */
function _linkifyInHtml(html, needle){
  if (!html || !needle) return { html, changed: false };

  /* Проверяем, нет ли уже ссылки с этим именем */
  const existing = U.extractWikilinks(html);
  if (existing.some(l => (l.name || "").trim().toLowerCase() === needle.toLowerCase())){
    return { html, changed: false };
  }

  /* Границы слова для кириллицы */
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u");
  } catch(e){
    re = new RegExp(`\\b${escaped}\\b`);
  }

  /* Парсим в <template> — XSS безопасно */
  const frag = U.parseHTMLFragment(html);
  let changed = false;

  const walk = node => {
    if (changed) return;
    const children = [...node.childNodes];
    for (const child of children){
      if (changed) return;
      if (child.nodeType === Node.TEXT_NODE){
        const text = child.textContent;
        const m = re.exec(text);
        if (m){
          const idx = m.index;
          const before = text.slice(0, idx);
          const after  = text.slice(idx + m[0].length);
          const linkNode = document.createTextNode(`[[${needle}]]`);
          const frag2 = document.createDocumentFragment();
          if (before) frag2.appendChild(document.createTextNode(before));
          frag2.appendChild(linkNode);
          if (after) frag2.appendChild(document.createTextNode(after));
          child.replaceWith(frag2);
          changed = true;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE){
        const tag = child.tagName.toLowerCase();
        /* Внутрь ссылок и кода не лезем */
        if (tag === "a" || tag === "code" || tag === "pre") continue;
        walk(child);
      }
    }
  };
  walk(frag);

  if (!changed) return { html, changed: false };

  const div = document.createElement("div");
  div.append(frag);
  return { html: div.innerHTML, changed: true };
}

function linkifyMention(sourceId, targetName){
  const src = St().documents[sourceId];
  if (!src) return;
  if (!targetName) return;

  const needle = targetName.trim();
  if (!needle) return;

  let changed = false;
  let touchedBlock = null;

  for (const b of src.blocks || []){
    if (b.type === "code") continue;

    /* Строки */
    if (Array.isArray(b.lines) && b.lines.length){
      for (const ln of b.lines){
        const res = _linkifyInHtml(ln.text || "", needle);
        if (res.changed){
          ln.text = res.html;
          b.content = b.lines.map(l => l.text).join("<br>");
          touchedBlock = b;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }

    /* Обычный content */
    if (!changed && typeof b.content === "string"){
      const res = _linkifyInHtml(b.content, needle);
      if (res.changed){
        b.content = res.html;
        touchedBlock = b;
        changed = true;
        break;
      }
    }

    /* Таблица */
    if (!changed && b.type === "table" && Array.isArray(b.rows)){
      outer:
      for (const row of b.rows){
        for (let i = 0; i < row.length; i++){
          const res = _linkifyInHtml(row[i] || "", needle);
          if (res.changed){
            row[i] = res.html;
            touchedBlock = b;
            changed = true;
            break outer;
          }
        }
      }
    }

    /* Колонки */
    if (!changed && b.type === "columns" && Array.isArray(b.content)){
      for (let i = 0; i < b.content.length; i++){
        const res = _linkifyInHtml(b.content[i] || "", needle);
        if (res.changed){
          b.content[i] = res.html;
          touchedBlock = b;
          changed = true;
          break;
        }
      }
    }

    if (changed) break;
  }

  if (!changed || !touchedBlock){
    toast("Не удалось найти упоминание");
    return;
  }

  src.updatedAt = Date.now();
  window.App.db.saveDocument(src)
    .then(() => {
      window.App.state.rebuildBacklinks(src.id);
      if (src.id === St().activeDocId){
        window.App.render.render();
      }
      render();
      toast("Ссылка создана");
    })
    .catch(err => {
      console.error("linkify save error:", err);
      toast("Не удалось сохранить");
    });
}

/* ---------- Плюрализация ---------- */

function plural(n, one, few, many){
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/* ---------- Bind ---------- */

function bind(){
  /* Ничего не надо — обработчики ставим на каждый render */
}

return { render, bind };
})();