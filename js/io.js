/* ============================================================
   io.js — экспорт HTML/MD/JSON/PDF, импорт, ZIP, изображения

   [Пакет 5]  санитайз содержимого при экспорте; PDF через
              sandbox-iframe с noopener.
   [Пакет 8]  htmlToText для code через textContent; .txt/HTML
              не режут до 2000; <style>/<title> пропускаются;
              MD-импорт группирует li, ol нумерует; MD-экспорт
              <br>→"  \n", экранирует |; ZIP UTF-8 bit 11.
   [Пакет 12] handleFileUpload корректно вставляет при active=null.

   Зависит от: utils, state
   ============================================================ */

window.App = window.App || {};

window.App.io = (() => {
"use strict";

const U = window.App.utils;
const {
  $, MAX_IMG_BYTES, block: newBlock, uid, now,
  htmlToText, htmlToMD, toast, escape, sanitize, normalizeDocument
} = U;

const St = () => window.App.state.S;
const setActive = v => window.App.state.setActive(v);
const setSelectedBlock = v => window.App.state.setSelectedBlock(v);
const snapshot = () => window.App.state.snapshot();
const commit = b => window.App.state.commit(b);
const render = () => window.App.render.render();

/* ---------- Скачивание ---------- */

function download(name, data, mime){
  const a = document.createElement("a");
  const blob = new Blob([data], { type: mime || "application/octet-stream" });
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function slugify(s){
  return String(s || "document")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "document";
}

function getDoc(id){
  if (id && St().documents[id]) return St().documents[id];
  return window.App.state.getActiveDoc();
}

/* ============================================================
   HTML-экспорт (с санитайзом)
   ============================================================ */

function docToHTML(doc){
  const styles = `
    body{font:15px/1.6 system-ui,sans-serif;color:#343330;background:#f3efe7;margin:0}
    .wrap{max-width:900px;margin:40px auto;padding:48px 56px;background:#fffdf8;border-radius:12px}
    h1{font-size:34px;margin:0 0 24px}
    .block{margin:3px 0}
    .code{background:#f3efe7;border:1px solid #ddd;border-radius:8px;padding:12px;white-space:pre;overflow:auto;font-family:monospace}
    .quote{font-style:italic;border-left:3px solid #829b91;padding-left:14px;color:#666}
    table{width:100%;border-collapse:collapse}
    td,th{border:1px solid #ddd;padding:7px 9px;text-align:left}
    th{background:#dce8e2}
    ul,ol{padding-left:24px}
    img{max-width:100%;height:auto;border-radius:9px}
    .divider{border-top:1px solid #ddd;margin:12px 0}
    @media print{ body{background:#fff} .wrap{margin:0;padding:0;box-shadow:none} }
  `;

  let body = `<h1>${escape(doc.title || "Без названия")}</h1>`;

  for (const b of doc.blocks){
    body += "<div class=\"block\">" + blockToHTML(b) + "</div>";
  }

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>${escape(doc.title || "Без названия")}</title>
<style>${styles}</style>
</head><body>
<div class="wrap">${body}</div>
</body></html>`;
}

/* [Пакет 5] санитайз каждой ячейки/колонки перед вставкой в экспорт */
function _sanitizeInline(html){
  try { return sanitize(html || ""); }
  catch(e){ return ""; }
}

function blockToHTML(b){
  if (b.type === "divider") return `<hr class="divider">`;
  if (b.type === "image"){
    return b.content ? `<img src="${escape(b.content)}" alt="">` : "";
  }
  if (b.type === "table"){
    let h = "<table>";
    b.rows.forEach((row, ri) => {
      h += "<tr>";
      row.forEach(cell => {
        const safe = _sanitizeInline(cell);
        h += `<${ri===0?"th":"td"}>${safe}</${ri===0?"th":"td"}>`;
      });
      h += "</tr>";
    });
    h += "</table>";
    return h;
  }
  if (b.type === "columns"){
    const widths = Array.isArray(b.widths) && b.widths.length === b.cols
      ? b.widths.map(w => `${w}fr`).join(" ")
      : `repeat(${b.cols},1fr)`;
    const gap = Number.isFinite(b.gap) ? b.gap : 14;
    return `<div style="display:grid;grid-template-columns:${widths};gap:${gap}px">
      ${(b.content || []).map(c => `<div>${_sanitizeInline(c)}</div>`).join("")}
    </div>`;
  }
  if (b.type === "ul" || b.type === "ol"){
    return `<${b.type}>${_sanitizeInline(b.content || "")}</${b.type}>`;
  }
  if (b.type === "todo"){
    return `<div>${b.checked ? "☑" : "☐"} ${U.getBlockHTML(b)}</div>`;
  }
  if (b.type === "code"){
    return `<pre class="code">${escape(U.getBlockText(b))}</pre>`;
  }
  if (b.type === "quote"){
    return `<blockquote class="quote">${U.getBlockHTML(b)}</blockquote>`;
  }
  if (b.type === "h1" || b.type === "h2" || b.type === "h3"){
    return `<${b.type}>${U.getBlockHTML(b)}</${b.type}>`;
  }
  return `<div>${U.getBlockHTML(b)}</div>`;
}

/* ============================================================
   Markdown
   ============================================================ */

function docToMD(doc){
  let out = `# ${doc.title || "Без названия"}\n\n`;
  for (const b of doc.blocks){
    out += blockToMD(b) + "\n\n";
  }
  return out;
}

/* [Пакет 8] <br> → "  \n" (hard break), экранирование | в таблицах */
function _mdInline(html){
  const s = htmlToMD(html || "");
  return s.replace(/\n/g, "  \n").replace(/\|/g, "\\|");
}

function blockToMD(b){
  if (b.type === "divider") return "---";
  if (b.type === "image")   return `![image](${b.content})`;
  if (b.type === "h1")      return "# " + htmlToMD(b.content);
  if (b.type === "h2")      return "## " + htmlToMD(b.content);
  if (b.type === "h3")      return "### " + htmlToMD(b.content);
  if (b.type === "quote"){
    /* Многострочные цитаты — каждая строка с > */
    return htmlToMD(U.getBlockHTML(b))
      .split("\n")
      .map(l => "> " + l)
      .join("\n");
  }
  if (b.type === "code"){
    return "```\n" + U.getBlockText(b) + "\n```";
  }
  if (b.type === "todo"){
    return `- [${b.checked ? "x" : " "}] ${_mdInline(U.getBlockHTML(b))}`;
  }
  if (b.type === "ul" || b.type === "ol"){
    const tmp = document.createElement("div");
    tmp.innerHTML = _sanitizeInline(b.content || "");
    const lis = [...tmp.querySelectorAll("li")];
    return lis.map((li, i) =>
      b.type === "ul"
        ? `- ${_mdInline(li.innerHTML)}`
        : `${i+1}. ${_mdInline(li.innerHTML)}`
    ).join("\n");
  }
  if (b.type === "table"){
    const width = b.rows[0]?.length || 1;
    const header = "| " + b.rows[0].map(c => _mdInline(c)).join(" | ") + " |";
    const sep    = "| " + Array(width).fill("---").join(" | ") + " |";
    const rows   = b.rows.slice(1).map(r => "| " + r.map(c => _mdInline(c)).join(" | ") + " |");
    return [header, sep, ...rows].join("\n");
  }
  if (b.type === "columns"){
    return (b.content || []).map(c => htmlToMD(c)).join("\n\n---\n\n");
  }
  return htmlToMD(U.getBlockHTML(b));
}

/* ============================================================
   JSON
   ============================================================ */

function docToJSON(doc){
  return JSON.stringify(doc, null, 2);
}

/* ============================================================
   Экспорт
   ============================================================ */

function downloadHTML(id){
  const doc = getDoc(id);
  if (!doc) return;
  download(slugify(doc.title) + ".html", docToHTML(doc), "text/html");
}

function downloadMD(id){
  const doc = getDoc(id);
  if (!doc) return;
  download(slugify(doc.title) + ".md", docToMD(doc), "text/markdown");
}

function downloadJSON(id){
  const doc = getDoc(id);
  if (!doc) return;
  download(slugify(doc.title) + ".json", docToJSON(doc), "application/json");
}

/* [Пакет 5] PDF через sandbox-iframe (не наследует origin приложения) */
function downloadPDF(id){
  const doc = getDoc(id);
  if (!doc) return;

  const html = docToHTML(doc);

  /* Создаём iframe в том же документе, но с sandbox — без allow-same-origin.
     Так iframe не получает доступ к IndexedDB и window.opener. */
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-modals");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  document.body.append(frame);

  frame.srcdoc = html;

  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch(e){
        console.warn("PDF print error:", e);
        toast("Не удалось открыть печать");
      }
      setTimeout(() => frame.remove(), 2000);
    }, 200);
  };
}

/* ============================================================
   ZIP (метод store, [Пакет 8] UTF-8 flag)
   ============================================================ */

function crc32(bytes){
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++){
      c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++){
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function strToBytes(s){
  return new TextEncoder().encode(s);
}

function zipFiles(files){
  const chunks = [];
  const centralDir = [];
  let offset = 0;

  for (const f of files){
    const nameBytes = strToBytes(f.name);
    const dataBytes = strToBytes(f.data);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    /* [Пакет 8] bit 11 = 0x0800 — UTF-8 имена файлов */
    const FLAG_UTF8 = 0x0800;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local);
    chunks.push(dataBytes);

    const cdir = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdir.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cdir.set(nameBytes, 46);
    centralDir.push(cdir);

    offset += local.length + dataBytes.length;
  }

  const centralBytes = centralDir.reduce((acc, arr) => acc + arr.length, 0);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralBytes, true);
  ev.setUint32(16, offset, true);

  const parts = [...chunks, ...centralDir, end];
  return new Blob(parts, { type: "application/zip" });
}

function downloadAllAsZip(format){
  const docs = Object.values(St().documents).filter(d => !d.trashed);
  if (!docs.length){ toast("Нет документов"); return; }

  const files = docs.map(doc => {
    const name = slugify(doc.title) + "_" + doc.id.slice(0,6);
    if (format === "md")   return { name: name + ".md",   data: docToMD(doc) };
    if (format === "json") return { name: name + ".json", data: docToJSON(doc) };
    return { name: name + ".html", data: docToHTML(doc) };
  });

  const zip = zipFiles(files);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(zip);
  a.download = "paper-notebook.zip";
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ============================================================
   Импорт
   ============================================================ */

function openImportPicker(){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".html,.htm,.md,.markdown,.json,.txt";
  input.onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    await importFromText(f.name, text);
  };
  input.click();
}

async function importFromText(name, text){
  const ext = (name.split(".").pop() || "").toLowerCase();
  let doc = null;

  if (ext === "json"){
    try {
      const raw = JSON.parse(text);
      /* [Пакет 8] JSON должен быть объектом с blocks */
      if (!raw || typeof raw !== "object" || Array.isArray(raw)){
        toast("Файл не распознан");
        return;
      }
      doc = normalizeDocument(raw);
      if (doc){
        doc.id = uid();
        doc.createdAt = now();
        doc.updatedAt = now();
      }
    } catch(e){ toast("Ошибка JSON"); return; }
  }
  else if (ext === "md" || ext === "markdown"){
    doc = normalizeDocument({
      title: name.replace(/\.[^.]+$/, ""),
      blocks: mdToBlocks(text)
    });
  }
  else {
    doc = normalizeDocument({
      title: name.replace(/\.[^.]+$/, ""),
      blocks: htmlToBlocks(text)
    });
  }

  if (!doc){ toast("Не удалось импортировать"); return; }

  St().documents[doc.id] = doc;
  await window.App.db.saveDocument(doc);
  try { window.App.state.rebuildBacklinks(doc.id); } catch(e){}
  await window.App.state.setActiveDoc(doc.id);
  window.App.sidebar?.render();
  window.App.tabs?.render();
  toast("Импорт завершён");
}

/* [Пакет 8] MD-импорт: \r\n → \n, li группируются, ol нумеруется */
function mdToBlocks(md){
  const text = String(md || "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const blocks = [];
  let inCode = false, codeBuf = [];
  let listBuf = null;  /* { kind: "ul"|"ol", items: [] } */

  const flushList = () => {
    if (!listBuf) return;
    const b = newBlock(listBuf.kind, "");
    b.content = listBuf.items.map(it => `<li>${escape(it)}</li>`).join("");
    blocks.push(b);
    listBuf = null;
  };

  for (const line of lines){
    /* Код */
    if (line.startsWith("```")){
      flushList();
      if (inCode){
        blocks.push(newBlock("code", codeBuf.join("\n")));
        codeBuf = [];
        inCode = false;
      } else inCode = true;
      continue;
    }
    if (inCode){ codeBuf.push(line); continue; }

    if (!line.trim()){ flushList(); continue; }

    if (/^# (.+)/.test(line))  { flushList(); blocks.push(newBlock("h1", line.replace(/^# /,""))); continue; }
    if (/^## (.+)/.test(line)) { flushList(); blocks.push(newBlock("h2", line.replace(/^## /,""))); continue; }
    if (/^### (.+)/.test(line)){ flushList(); blocks.push(newBlock("h3", line.replace(/^### /,""))); continue; }
    if (/^>\s?(.+)/.test(line)){ flushList(); blocks.push(newBlock("quote", line.replace(/^>\s?/,""))); continue; }
    if (/^---\s*$/.test(line)) { flushList(); blocks.push(newBlock("divider")); continue; }

    /* TODO */
    if (/^[-*]\s+\[( |x)\]\s+(.+)/.test(line)){
      flushList();
      const m = line.match(/^[-*]\s+\[( |x)\]\s+(.+)/);
      const b = newBlock("todo", escape(m[2]));
      b.checked = (m[1] === "x");
      blocks.push(b);
      continue;
    }

    /* [Пакет 8] все подряд идущие li — в один блок */
    if (/^[-*]\s+(.+)/.test(line)){
      if (!listBuf || listBuf.kind !== "ul"){
        flushList();
        listBuf = { kind: "ul", items: [] };
      }
      listBuf.items.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    if (/^\d+\.\s+(.+)/.test(line)){
      if (!listBuf || listBuf.kind !== "ol"){
        flushList();
        listBuf = { kind: "ol", items: [] };
      }
      listBuf.items.push(line.replace(/^\d+\.\s+/, ""));
      continue;
    }

    /* Обычный абзац */
    flushList();
    blocks.push(newBlock("text", escape(line)));
  }

  flushList();
  if (inCode && codeBuf.length){
    blocks.push(newBlock("code", codeBuf.join("\n")));
  }

  return blocks.length ? blocks : [newBlock("text", "")];
}

/* [Пакет 8] HTML-импорт: пропускаем style/title, не режем, парсим <p> */
function htmlToBlocks(html){
  /* Через DOMParser — изолированный документ, безопаснее div.innerHTML */
  let doc;
  try {
    doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  } catch(e){
    doc = null;
  }

  if (!doc){
    /* Fallback — простой текст */
    const t = String(html || "").trim();
    return [newBlock("text", escape(t))];
  }

  /* Удаляем служебные элементы */
  doc.querySelectorAll("style, script, title, meta, link, noscript").forEach(n => n.remove());

  const body = doc.body || doc;
  const blocks = [];

  const pushText = (html) => {
    const safe = sanitize(html || "");
    if (!safe.trim()) return;
    blocks.push(newBlock("text", safe));
  };

  const pushList = (el, kind) => {
    const b = newBlock(kind, "");
    b.content = [...el.querySelectorAll(":scope > li")]
      .map(li => `<li>${sanitize(li.innerHTML)}</li>`)
      .join("");
    if (b.content) blocks.push(b);
  };

  const handle = el => {
    const tag = el.tagName.toLowerCase();
    if (tag === "h1"){ const safe = sanitize(el.innerHTML); if (safe.trim()) blocks.push(newBlock("h1", safe)); return; }
    if (tag === "h2"){ const safe = sanitize(el.innerHTML); if (safe.trim()) blocks.push(newBlock("h2", safe)); return; }
    if (tag === "h3"){ const safe = sanitize(el.innerHTML); if (safe.trim()) blocks.push(newBlock("h3", safe)); return; }
    if (tag === "blockquote"){ const safe = sanitize(el.innerHTML); if (safe.trim()) blocks.push(newBlock("quote", safe)); return; }
    if (tag === "pre"){ blocks.push(newBlock("code", el.textContent)); return; }
    if (tag === "hr"){ blocks.push(newBlock("divider")); return; }
    if (tag === "ul"){ pushList(el, "ul"); return; }
    if (tag === "ol"){ pushList(el, "ol"); return; }
    if (tag === "table"){
      const b = newBlock("table", "");
      b.rows = [...el.querySelectorAll("tr")].map(tr =>
        [...tr.children].map(td => sanitize(td.innerHTML)));
      if (b.rows.length) blocks.push(b);
      return;
    }
    if (tag === "img"){
      blocks.push(newBlock("image", el.getAttribute("src") || ""));
      return;
    }
    if (tag === "p"){
      pushText(el.innerHTML);
      return;
    }
    if (tag === "div"){
      /* Если div содержит только блочные дети — обходим рекурсивно,
         иначе трактуем как абзац */
      const hasBlockChildren = el.querySelector(":scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > ul, :scope > ol, :scope > blockquote, :scope > pre, :scope > table, :scope > div");
      if (hasBlockChildren){
        [...el.children].forEach(handle);
      } else {
        pushText(el.innerHTML);
      }
      return;
    }
    /* Прочие теги — как текст */
    pushText(el.outerHTML);
  };

  [...body.children].forEach(handle);

  /* Если body пуст или нет блочных — берём весь текст */
  if (!blocks.length){
    const txt = (body.textContent || "").trim();
    if (txt){
      blocks.push(newBlock("text", escape(txt)));
    }
  }

  return blocks.length ? blocks : [newBlock("text", "")];
}

/* ============================================================
   Сжатие изображения
   ============================================================ */

function compressImage(file, maxSide = 1600, quality = 0.85){
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")){
      reject(new Error("not an image"));
      return;
    }
    /* [Пакет 8] проверяем размер файла */
    if (file.size > MAX_IMG_BYTES){
      reject(new Error("Файл слишком большой (> " +
        Math.round(MAX_IMG_BYTES / (1024*1024)) + " МБ)"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const nw = Math.round(w * scale);
        const nh = Math.round(h * scale);

        if (scale === 1 && file.size < 300 * 1024){
          resolve(reader.result);
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = nw;
        canvas.height = nh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, nw, nh);

        let out = canvas.toDataURL("image/webp", quality);
        if (out.indexOf("data:image/webp") !== 0){
          out = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error("image decode error"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   Изображения (drag&drop, picker)
   ============================================================ */

function openImagePicker(){
  $("#file")?.click();
}

/* [Пакет 12] корректная вставка при active = null */
function _insertImageBlock(dataUrl){
  const old = snapshot();
  const blocks = St().blocks;
  const activeId = window.App.state.active;
  const i = activeId ? blocks.findIndex(x => x.id === activeId) : -1;
  const b = newBlock("image", dataUrl);
  const insertAt = i >= 0 ? i + 1 : blocks.length;
  blocks.splice(insertAt, 0, b);
  setActive(b.id);
  commit(old);
  render();
  setSelectedBlock(b.id);
  window.App.state.save();
  return b;
}

async function handleFileUpload(file){
  if (!file) return;
  if (!file.type.startsWith("image/")) return;

  let dataUrl;
  try {
    dataUrl = await compressImage(file);
  } catch(e){
    console.warn("compressImage failed:", e.message);
    toast(e.message || "Не удалось обработать изображение");
    return;
  }
  if (!dataUrl) return;

  _insertImageBlock(dataUrl);
  toast("Изображение вставлено");
}

function bindIO(){
  const fileInput = $("#file");
  if (fileInput){
    fileInput.onchange = e => {
      handleFileUpload(e.target.files[0]);
      e.target.value = "";
    };
  }

  const editor = $("#editor");
  if (editor){
    editor.addEventListener("dragover", e => {
      if ([...e.dataTransfer.items].some(x => x.kind === "file")){
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });

    /* [Пакет 8] не-изображения игнорируем с preventDefault,
       иначе браузер уводит со страницы */
    editor.addEventListener("drop", async e => {
      const files = [...e.dataTransfer.files];
      if (!files.length) return;

      const images = files.filter(f => f.type.startsWith("image/"));
      if (!images.length){
        e.preventDefault();
        return;
      }
      e.preventDefault();

      for (const f of images){
        let dataUrl;
        try {
          dataUrl = await compressImage(f);
        } catch(err){
          console.warn("compressImage failed:", err.message);
          toast(err.message || "Не удалось обработать изображение");
          continue;
        }
        if (!dataUrl) continue;
        _insertImageBlock(dataUrl);
      }
      toast("Изображение вставлено");
    });
  }
}

return {
  download, downloadHTML, downloadMD, downloadJSON, downloadPDF,
  downloadAllAsZip,
  docToHTML, docToMD, docToJSON,
  openImportPicker, importFromText,
  compressImage,
  openImagePicker, handleFileUpload, bindIO
};

})();