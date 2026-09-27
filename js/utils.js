/* ============================================================
   utils.js — константы, хелперы, sanitizer, нормализация
   ============================================================ */

window.App = window.App || {};

window.App.utils = (() => {
"use strict";

const KEY = "paper-notebook-v1";
const HISTORY_LIMIT = 80;
const INPUT_DEBOUNCE = 400;
const SAVE_DEBOUNCE  = 150;
const MAX_IMG_BYTES  = 3 * 1024 * 1024;

const types = [
  ["text",    "Текст",         "Обычный абзац"],
  ["h1",      "Заголовок 1",   "Большой заголовок"],
  ["h2",      "Заголовок 2",   "Заголовок"],
  ["h3",      "Заголовок 3",   "Маленький заголовок"],
  ["ul",      "Маркеры",       "Маркированный список"],
  ["ol",      "Нумерованный",  "Нумерованный список"],
  ["todo",    "Чек-лист",      "Задача"],
  ["quote",   "Цитата",        "Выделенный текст"],
  ["code",    "Код",           "Моноширинный блок"],
  ["table",   "Таблица",       "Интерактивная таблица"],
  ["columns", "Колонки",       "2–4 колонки"],
  ["divider", "Разделитель",   "Горизонтальная линия"],
  ["image",   "Изображение",   "Перетащить файл"]
];

const VALID_TYPES  = new Set(types.map(t => t[0]));
const VALID_BG     = new Set(["","soft","warm","rose","sky","lilac","mint","sand"]);
const VALID_FONT   = new Set(["","sans","serif","mono"]);
const VALID_INDENT = new Set([0,1,2,3]);
const VALID_ALIGN  = new Set(["left","center","right"]);
const VALID_MARKER = new Set(["disc","circle","square","diamond","dot","arrow"]);

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function uid(){
  return (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "b-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escape(s){
  return String(s).replace(/[&<>"]/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"
  }[c]));
}

function el(tag, cls = ""){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function isArrayOfArrays(x){
  return Array.isArray(x) && x.every(r => Array.isArray(r));
}

function block(type = "text", content = ""){
  const b = {
    id: uid(),
    type: VALID_TYPES.has(type) ? type : "text",
    content: typeof content === "string" ? content : "",
    checked: false,
    rows: null,
    cols: null,
    bg: "",
    font: "",
    indent: 0,
    align: "left",
    offsetX: 0,
    marker: "disc"
  };
  if (b.type === "table")   b.rows = [["",""],["",""]];
  if (b.type === "columns"){ b.cols = 2; b.content = ["", ""]; }
  return b;
}

function toast(s){
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = s;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1400);
}

const ALLOWED_TAGS = new Set([
  "b","strong","i","em","u","s","strike","del","ins","mark",
  "code","br","span","a","p",
  "h1","h2","h3","h4","h5","h6",
  "ul","ol","li","blockquote","pre","hr",
  "table","thead","tbody","tr","td","th",
  "font"
]);

const ALLOWED_ATTRS = {
  a: ["href"],
  span: ["class","data-checked"],
  p: [],
  td: ["colspan","rowspan"],
  th: ["colspan","rowspan"],
  font: ["face"]
};

function sanitize(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  tmp.querySelectorAll(
    "script,style,meta,link,iframe,object,embed,noscript,o\\:p"
  ).forEach(n => n.remove());

  const walk = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE){
        const tag = child.tagName.toLowerCase();

        if (!ALLOWED_TAGS.has(tag)){
          const frag = document.createDocumentFragment();
          while (child.firstChild) frag.append(child.firstChild);
          child.replaceWith(frag);
          walk(node);
          return;
        }

        const allowed = ALLOWED_ATTRS[tag] || [];
        [...child.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          if (!allowed.includes(name)) child.removeAttribute(attr.name);
        });

        if (tag === "a"){
          const href = child.getAttribute("href") || "";
          if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute("href");
          else {
            child.setAttribute("target","_blank");
            child.setAttribute("rel","noopener noreferrer");
          }
        }

        walk(child);
      } else if (child.nodeType === Node.COMMENT_NODE){
        child.remove();
      }
    });
  };
  walk(tmp);

  return tmp.innerHTML;
}

function normalizeBlock(raw){
  if (!raw || typeof raw !== "object") return null;

  const b = {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    type: VALID_TYPES.has(raw.type) ? raw.type : "text",
    content: raw.content,
    checked: !!raw.checked,
    rows: null,
    cols: null,
    bg: VALID_BG.has(raw.bg) ? raw.bg : "",
    font: VALID_FONT.has(raw.font) ? raw.font : "",
    indent: VALID_INDENT.has(raw.indent) ? raw.indent : 0,
    align: VALID_ALIGN.has(raw.align) ? raw.align : "left",
    offsetX: Number.isFinite(raw.offsetX) ? raw.offsetX : 0,
    marker: VALID_MARKER.has(raw.marker) ? raw.marker : "disc"
  };

  if (b.type === "table"){
    b.rows = isArrayOfArrays(raw.rows) && raw.rows.length
      ? b.rows = raw.rows.map(r => r.map(v => typeof v === "string" ? v : String(v ?? "")))
      : [["",""],["",""]];
    b.content = "";
  }
  else if (b.type === "columns"){
    const n = [2,3,4].includes(raw.cols) ? raw.cols : 2;
    const arr = Array.isArray(raw.content) ? raw.content.slice(0, n) : [];
    while (arr.length < n) arr.push("");
    b.cols = n;
    b.content = arr.map(v => typeof v === "string" ? v : "");
  }
  else {
    b.content = typeof raw.content === "string" ? raw.content : "";
  }

  return b;
}

function normalizeState(raw){
  const out = {
    title: typeof raw?.title === "string" ? raw.title : "",
    theme: ["paper","sepia","mint","dark"].includes(raw?.theme) ? raw.theme : "paper",
    fonts: {},
    blocks: [],
    selectedId: null
  };

  if (raw?.fonts && typeof raw.fonts === "object"){
    for (const role of ["body","head","serif","mono"]){
      if (typeof raw.fonts[role] === "string"){
        out.fonts[role] = raw.fonts[role];
      }
    }
  }

  if (Array.isArray(raw?.blocks)){
    out.blocks = raw.blocks.map(normalizeBlock).filter(Boolean);
  }
  if (!out.blocks.length){
    out.blocks = [block("text", "")];
  }

  return out;
}

function htmlToText(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.innerText;
}

function htmlToMD(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  const walk = node => {
    let out = "";
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE){
        out += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE){
        const tag = child.tagName.toLowerCase();
        const inner = walk(child);
        switch (tag){
          case "strong": case "b": out += `**${inner}**`; break;
          case "em":     case "i": out += `*${inner}*`; break;
          case "s":      case "strike": case "del": out += `~~${inner}~~`; break;
          case "code":   out += `\`${inner}\``; break;
          case "br":     out += "\n"; break;
          case "a": {
            const href = child.getAttribute("href") || "";
            out += href ? `[${inner}](${href})` : inner;
            break;
          }
          case "font": {
            const face = child.getAttribute("face") || "";
            out += face ? `<span style="font-family:'${face}'">${inner}</span>` : inner;
            break;
          }
          default: out += inner;
        }
      }
    });
    return out;
  };
  return walk(tmp);
}

return {
  KEY, HISTORY_LIMIT, INPUT_DEBOUNCE, SAVE_DEBOUNCE, MAX_IMG_BYTES,
  types, VALID_TYPES, VALID_BG, VALID_FONT, VALID_INDENT, VALID_ALIGN, VALID_MARKER,
  $, $$, uid, escape, el, isArrayOfArrays, block, toast,
  sanitize, normalizeBlock, normalizeState,
  htmlToText, htmlToMD
};

})();