/* ============================================================
   backlinks.js — панель под документом:
                  «Ссылаются отсюда» + «Возможно, вы имели в виду»
   Зависит от: utils, state, render
   ============================================================ */

window.App = window.App || {};

window.App.backlinks = (() => {
"use strict";

const U = window.App.utils;
const { $, $$, el, escape, toast, LINE_TYPES } = U;

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

  /* Компактная плашка */
  const bar = el("button", "bl-bar");
  bar.type = "button";

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
        /* ПАТЧ 2.3.1: анкор как "block#line#fragment" */
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

    /* ПАТЧ 2.3.1: анкор с тройной адресацией — показываем как есть */
    if (it.anchor){
      const a = el("span", "bl-item-anchor");
      a.textContent = "#" + it.anchor;
      name.append(a);
    }

    name.onclick = () => {
      const docId = it.doc.id;
      const anchorStr = it.anchor || "";

      /* ПАТЧ 2.3.1: разбираем анкор и передаём в scrollToAnchorPath */
      Promise.resolve(window.App.state.setActiveDoc(docId)).then(() => {
        if (anchorStr){
          const { blockAnchor, lineAnchor, fragmentAnchor } = parseAnchorTriple(anchorStr);
          if (window.App.state.scrollToAnchorPath){
            window.App.state.scrollToAnchorPath(docId, blockAnchor, lineAnchor, fragmentAnchor);
          } else if (window.App.state.scrollToAnchor){
            /* fallback */
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
   ПАТЧ 2.3.1: linkifyMention — с поддержкой строк
   ============================================================ */

function linkifyMention(sourceId, targetName){
  const src = St().documents[sourceId];
  if (!src) return;
  if (!targetName) return;

  const needle = targetName.trim();
  if (!needle) return;

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`);

  let changed = false;

  const alreadyLinkedIn = (html) => {
    const links = U.extractWikilinks(html);
    return links.some(l =>
      (l.name || "").trim().toLowerCase() === needle.toLowerCase()
    );
  };

  for (const b of src.blocks || []){
    if (b.type === "code") continue;

    /* --- ПАТЧ 2.3.1: строки --- */
    if (Array.isArray(b.lines) && b.lines.length){
      for (const ln of b.lines){
        if (typeof ln.text === "string" && re.test(ln.text)){
          if (alreadyLinkedIn(ln.text)) continue;
          ln.text = ln.text.replace(re, `[[${needle}]]`);
          /* Обновляем и content для обратной совместимости */
          b.content = b.lines.map(l => l.text).join("<br>");
          changed = true;
          break;
        }
      }
      if (changed) break;
    }

    /* --- content --- */
    if (typeof b.content === "string" && re.test(b.content)){
      if (alreadyLinkedIn(b.content)) continue;
      b.content = b.content.replace(re, `[[${needle}]]`);
      changed = true;
      break;
    }

    /* --- table --- */
    if (b.type === "table" && Array.isArray(b.rows)){
      for (const row of b.rows){
        for (let i = 0; i < row.length; i++){
          if (typeof row[i] === "string" && re.test(row[i])){
            if (alreadyLinkedIn(row[i])) continue;
            row[i] = row[i].replace(re, `[[${needle}]]`);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
    if (changed) break;

    /* --- columns --- */
    if (b.type === "columns" && Array.isArray(b.content)){
      for (let i = 0; i < b.content.length; i++){
        if (typeof b.content[i] === "string" && re.test(b.content[i])){
          if (alreadyLinkedIn(b.content[i])) continue;
          b.content[i] = b.content[i].replace(re, `[[${needle}]]`);
          changed = true;
          break;
        }
      }
    }
    if (changed) break;
  }

  if (!changed){
    toast("Не удалось найти упоминание");
    return;
  }

  src.updatedAt = Date.now();
  window.App.db.saveDocument(src).then(() => {
    window.App.state.rebuildBacklinks(src.id);
    if (src.id === St().activeDocId){
      window.App.render.render();
    }
    render();
    toast("Ссылка создана");
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