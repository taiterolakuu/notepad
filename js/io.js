/* ============================================================
   io.js — экспорт HTML/Markdown, загрузка изображений
   Зависит от: utils, state, render
   ============================================================ */

window.App = window.App || {};

window.App.io = (() => {
"use strict";

const U = window.App.utils;
const {
  $, $$, MAX_IMG_BYTES, block: newBlock,
  htmlToText, htmlToMD, toast
} = U;

const St = () => window.App.state.S;
const setActive = v => window.App.state.setActive(v);
const setSelectedBlock = v => window.App.state.setSelectedBlock(v);
const snapshot = () => window.App.state.snapshot();
const commit = b => window.App.state.commit(b);
const render = () => window.App.render.render();

/* ---------- Download ---------- */

function download(name, data){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], {
    type: name.endsWith(".html") ? "text/html" : "text/markdown"
  }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function downloadHTML(){
  download("notebook.html", makeHTML());
}

function downloadMD(){
  download("notebook.md", toMD());
}

/* ---------- HTML snapshot ---------- */

function makeHTML(){
  const clone = document.documentElement.cloneNode(true);
  clone.querySelector("#editor").innerHTML = $("#editor").innerHTML;
  clone.querySelector("#title").textContent = St().title;
  return "<!doctype html>\n" + clone.outerHTML;
}

/* ---------- Markdown ---------- */

function toMD(){
  let out = `# ${St().title || "Без названия"}\n\n`;

  for (const b of St().blocks){
    if (b.type === "divider") out += "---\n\n";
    else if (["h1","h2","h3"].includes(b.type))
      out += `${"#".repeat(+b.type[1])} ${htmlToMD(b.content)}\n\n`;
    else if (b.type === "ul" || b.type === "ol"){
      const txt = htmlToText(b.content);
      const lines = txt.split("\n").filter(Boolean);
      out += lines.map((x, i) =>
        b.type === "ul" ? `- ${x}` : `${i + 1}. ${x}`
      ).join("\n") + "\n\n";
    }
    else if (b.type === "todo")
      out += `- [${b.checked ? "x" : " "}] ${htmlToMD(b.content)}\n\n`;
    else if (b.type === "quote")
      out += "> " + htmlToMD(b.content) + "\n\n";
    else if (b.type === "code")
      out += "```\n" + htmlToText(b.content) + "\n```\n\n";
    else if (b.type === "table"){
      if (!b.rows.length) continue;
      const width = b.rows[0].length;
      const header  = "| " + b.rows[0].map(htmlToMD).join(" | ") + " |";
      const sep     = "| " + Array(width).fill("---").join(" | ") + " |";
      const bodyRows = b.rows.slice(1).map(r =>
        "| " + r.map(htmlToMD).join(" | ") + " |"
      );
      out += [header, sep, ...bodyRows].join("\n") + "\n\n";
    }
    else if (b.type === "image")
      out += `![image](${b.content})\n\n`;
    else
      out += htmlToMD(b.content) + "\n\n";
  }

  out += "\n<!-- Изображения встроены как data:URL и могут увеличивать размер файла -->\n";
  return out;
}

/* ---------- Image upload ---------- */

function openImagePicker(){
  $("#file").click();
}

function handleFileUpload(file){
  if (!file) return;
  if (file.size > MAX_IMG_BYTES){
    if (!confirm("Изображение больше 3 МБ. Хранилище может быстро переполниться. Продолжить?")){
      return;
    }
  }
  const r = new FileReader();
  r.onload = () => {
    const old = snapshot();
    const i = St().blocks.findIndex(x => x.id === window.App.state.active);
    const b = newBlock("image", r.result);
    St().blocks.splice(Math.max(0, i + 1), 0, b);
    setActive(b.id);
    commit(old);
    render();
    setSelectedBlock(b.id);
    window.App.state.save();
  };
  r.readAsDataURL(file);
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

    editor.addEventListener("drop", e => {
      const f = e.dataTransfer.files[0];
      if (!f?.type.startsWith("image/")) return;
      if (f.size > MAX_IMG_BYTES &&
          !confirm("Изображение больше 3 МБ. Хранилище может быстро переполниться. Продолжить?")){
        return;
      }
      e.preventDefault();
      const r = new FileReader();
      r.onload = () => {
        const old = snapshot();
        St().blocks.push(newBlock("image", r.result));
        commit(old);
        render();
      };
      r.readAsDataURL(f);
    });
  }
}

/* ---------- Public API ---------- */

return {
  download, downloadHTML, downloadMD,
  makeHTML, toMD,
  openImagePicker, handleFileUpload, bindIO
};

})();