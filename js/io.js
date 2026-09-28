/* ============================================================
   io.js — экспорт HTML/MD/JSON/PDF, импорт, ZIP, изображения
   Зависит от: utils, state
   ============================================================ */

window.App = window.App || {};

window.App.io = (() => {
"use strict";

const U = window.App.utils;
const {
  $, $$, MAX_IMG_BYTES, block: newBlock, uid, now,
  htmlToText, htmlToMD, toast, escape, normalizeDocument
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
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
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
   HTML
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
        h += `<${ri===0?"th":"td"}>${cell || ""}</${ri===0?"th":"td"}>`;
      });
      h += "</tr>";
    });
    h += "</table>";
    return h;
  }
  if (b.type === "columns"){
    return `<div style="display:grid;grid-template-columns:repeat(${b.cols},1fr);gap:14px">
      ${(b.content || []).map(c => `<div>${c || ""}</div>`).join("")}
    </div>`;
  }
  if (b.type === "ul" || b.type === "ol"){
    return `<${b.type}>${b.content || ""}</${b.type}>`;
  }
  if (b.type === "todo"){
    return `<div>${b.checked ? "☑" : "☐"} ${b.content || ""}</div>`;
  }
  if (b.type === "code"){
    return `<pre class="code">${escape(htmlToText(b.content || ""))}</pre>`;
  }
  if (b.type === "quote"){
    return `<blockquote class="quote">${b.content || ""}</blockquote>`;
  }
  if (b.type === "h1" || b.type === "h2" || b.type === "h3"){
    return `<${b.type}>${b.content || ""}</${b.type}>`;
  }
  return `<div>${b.content || ""}</div>`;
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

function blockToMD(b){
  if (b.type === "divider") return "---";
  if (b.type === "image")   return `![image](${b.content})`;
  if (b.type === "h1")      return "# " + htmlToMD(b.content);
  if (b.type === "h2")      return "## " + htmlToMD(b.content);
  if (b.type === "h3")      return "### " + htmlToMD(b.content);
  if (b.type === "quote")   return "> " + htmlToMD(b.content);
  if (b.type === "code")    return "```\n" + htmlToText(b.content) + "\n```";
  if (b.type === "todo")    return `- [${b.checked ? "x" : " "}] ${htmlToMD(b.content)}`;
  if (b.type === "ul" || b.type === "ol"){
    const tmp = document.createElement("div");
    tmp.innerHTML = b.content;
    const lis = [...tmp.querySelectorAll("li")];
    return lis.map((li, i) =>
      b.type === "ul" ? `- ${htmlToMD(li.innerHTML)}` : `${i+1}. ${htmlToMD(li.innerHTML)}`
    ).join("\n");
  }
  if (b.type === "table"){
    const width = b.rows[0]?.length || 1;
    const header = "| " + b.rows[0].map(htmlToMD).join(" | ") + " |";
    const sep    = "| " + Array(width).fill("---").join(" | ") + " |";
    const rows   = b.rows.slice(1).map(r => "| " + r.map(htmlToMD).join(" | ") + " |");
    return [header, sep, ...rows].join("\n");
  }
  if (b.type === "columns"){
    return (b.content || []).map(c => htmlToMD(c)).join("\n\n---\n\n");
  }
  return htmlToMD(b.content || "");
}

/* ============================================================
   JSON
   ============================================================ */

function docToJSON(doc){
  return JSON.stringify(doc, null, 2);
}

/* ============================================================
   Публичные функции экспорта
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

/* PDF через печать в новом окне */
function downloadPDF(id){
  const doc = getDoc(id);
  if (!doc) return;

  const html = docToHTML(doc);
  const win = window.open("", "_blank");
  if (!win){
    toast("Разрешите всплывающие окна для экспорта PDF");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();

  /* ждём загрузки и вызываем печать */
  const tryPrint = () => {
    try {
      win.focus();
      win.print();
    } catch(e){}
  };
  if (win.document.readyState === "complete"){
    setTimeout(tryPrint, 150);
  } else {
    win.onload = () => setTimeout(tryPrint, 150);
  }
}

/* ============================================================
   ZIP (метод store)
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

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
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
    cv.setUint16(8, 0, true);
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
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  await window.App.state.setActiveDoc(doc.id);
  window.App.sidebar?.render();
  window.App.tabs?.render();
  toast("Импорт завершён");
}

function mdToBlocks(md){
  const lines = String(md || "").split("\n");
  const blocks = [];
  let inCode = false, codeBuf = [];

  for (const line of lines){
    if (line.startsWith("```")){
      if (inCode){
        blocks.push(newBlock("code", codeBuf.join("\n")));
        codeBuf = [];
        inCode = false;
      } else inCode = true;
      continue;
    }
    if (inCode){ codeBuf.push(line); continue; }

    if (!line.trim()) continue;
    if (/^# (.+)/.test(line))  { blocks.push(newBlock("h1", line.replace(/^# /,""))); continue; }
    if (/^## (.+)/.test(line)) { blocks.push(newBlock("h2", line.replace(/^## /,""))); continue; }
    if (/^### (.+)/.test(line)){ blocks.push(newBlock("h3", line.replace(/^### /,""))); continue; }
    if (/^>\s?(.+)/.test(line)){ blocks.push(newBlock("quote", line.replace(/^>\s?/,""))); continue; }
    if (/^---\s*$/.test(line)) { blocks.push(newBlock("divider")); continue; }
    if (/^[-*]\s+\[( |x)\]\s+(.+)/.test(line)){
      const m = line.match(/^[-*]\s+\[( |x)\]\s+(.+)/);
      const b = newBlock("todo", m[2]);
      b.checked = (m[1] === "x");
      blocks.push(b);
      continue;
    }
    if (/^[-*]\s+(.+)/.test(line)){
      const item = line.replace(/^[-*]\s+/,"");
      blocks.push(newBlock("ul", `<li>${escape(item)}</li>`));
      continue;
    }
    if (/^\d+\.\s+(.+)/.test(line)){
      const item = line.replace(/^\d+\.\s+/,"");
      blocks.push(newBlock("ol", `<li>${escape(item)}</li>`));
      continue;
    }
    blocks.push(newBlock("text", escape(line)));
  }

  return blocks.length ? blocks : [newBlock("text","")];
}

function htmlToBlocks(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  const root = tmp.querySelector("body") || tmp;
  const blocks = [];
  [...root.children].forEach(el => {
    const tag = el.tagName.toLowerCase();
    const text = el.innerHTML;

    if (tag === "h1"){ blocks.push(newBlock("h1", text)); return; }
    if (tag === "h2"){ blocks.push(newBlock("h2", text)); return; }
    if (tag === "h3"){ blocks.push(newBlock("h3", text)); return; }
    if (tag === "blockquote"){ blocks.push(newBlock("quote", text)); return; }
    if (tag === "pre"){ blocks.push(newBlock("code", el.textContent)); return; }
    if (tag === "hr"){ blocks.push(newBlock("divider")); return; }
    if (tag === "ul"){
      const b = newBlock("ul", "");
      b.content = [...el.querySelectorAll(":scope > li")].map(li => `<li>${li.innerHTML}</li>`).join("");
      blocks.push(b); return;
    }
    if (tag === "ol"){
      const b = newBlock("ol", "");
      b.content = [...el.querySelectorAll(":scope > li")].map(li => `<li>${li.innerHTML}</li>`).join("");
      blocks.push(b); return;
    }
    if (tag === "table"){
      const b = newBlock("table", "");
      b.rows = [...el.querySelectorAll("tr")].map(tr =>
        [...tr.children].map(td => td.innerHTML));
      blocks.push(b); return;
    }
    if (tag === "img"){ blocks.push(newBlock("image", el.getAttribute("src") || "")); return; }
    if (tag === "p"){ blocks.push(newBlock("text", text)); return; }
    blocks.push(newBlock("text", text));
  });

  return blocks.length ? blocks : [newBlock("text", escape(html.slice(0, 2000)))];
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
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const nw = Math.round(w * scale);
        const nh = Math.round(h * scale);

        /* если картинка и так небольшая — оставляем как есть */
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

async function handleFileUpload(file){
  if (!file) return;
  if (!file.type.startsWith("image/")) return;

  let dataUrl;
  try {
    dataUrl = await compressImage(file);
  } catch(e){
    console.warn("compressImage failed, fallback to raw", e);
    /* фолбэк: если сжатие упало — читаем как есть */
    dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }
  if (!dataUrl) return;

  const old = snapshot();
  const blocks = St().blocks;
  const i = blocks.findIndex(x => x.id === window.App.state.active);
  const b = newBlock("image", dataUrl);
  blocks.splice(Math.max(0, i + 1), 0, b);
  setActive(b.id);
  commit(old);
  render();
  setSelectedBlock(b.id);
  window.App.state.save();
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
      if ([...e.dataTransfer.items].some(x => x.kind === "file"))
        e.preventDefault();
    });

    editor.addEventListener("drop", async e => {
      const f = e.dataTransfer.files[0];
      if (!f?.type.startsWith("image/")) return;
      e.preventDefault();

      let dataUrl;
      try {
        dataUrl = await compressImage(f);
      } catch(err){
        console.warn("compressImage failed, fallback to raw", err);
        dataUrl = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.readAsDataURL(f);
        });
      }
      if (!dataUrl) return;

      const old = snapshot();
      const b = newBlock("image", dataUrl);
      St().blocks.push(b);
      commit(old);
      render();
      setSelectedBlock(b.id);
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