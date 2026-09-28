/* ============================================================
   lock.js — пароль-замок на приложение (без шифрования данных)
   Зависит от: utils, state, db
   ============================================================ */

window.App = window.App || {};

window.App.lock = (() => {
"use strict";

const U = window.App.utils;
const { $, toast } = U;

const St = () => window.App.state.S;

/* Внутреннее состояние */
let _locked     = true;      /* до первой разблокировки считаем закрытым */
let _hasPwd     = false;     /* установлен ли пароль */
let _hash       = null;      /* base64 от sha256(salt+password) */
let _salt       = null;      /* base64 от случайных 16 байт */
let _autoLockMs = 60 * 1000; /* 1 минута по умолчанию */

let _lastActivity = Date.now();
let _checkTimer   = null;
let _throttleLast = 0;

const SS_KEY = "paper-last-activity";

/* ---------- Хеш ---------- */

function b64encode(bytes){
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function b64decode(str){
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function sha256(str){
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return b64encode(buf);
}

function randomSalt(){
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return b64encode(arr);
}

async function hashPassword(password, saltB64){
  return await sha256(saltB64 + ":" + password);
}

/* ---------- Публичное API ---------- */

function hasPassword(){
  return _hasPwd;
}

function isLocked(){
  return _locked;
}

async function setPassword(password){
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  _salt = salt;
  _hash = hash;
  _hasPwd = true;
  _locked = false;

  await saveLockMeta();
  _lastActivity = Date.now();
  hideScreen();
}

async function changePassword(oldPw, newPw){
  const ok = await checkPassword(oldPw);
  if (!ok) return false;
  const salt = randomSalt();
  const hash = await hashPassword(newPw, salt);
  _salt = salt;
  _hash = hash;
  await saveLockMeta();
  return true;
}

async function checkPassword(password){
  if (!_hasPwd) return true;
  const hash = await hashPassword(password, _salt);
  return hash === _hash;
}

async function clearPassword(password){
  const ok = await checkPassword(password);
  if (!ok) return false;
  _hasPwd = false;
  _hash = null;
  _salt = null;
  _locked = false;
  await saveLockMeta();
  hideScreen();
  return true;
}

/* ---------- Блокировка / разблокировка ---------- */

function lock(){
  if (!_hasPwd) return;          /* нечего блокировать */
  if (_locked) return;
  _locked = true;
  showScreen();
  stopTimer();
}

async function unlock(password){
  if (!_hasPwd){ _locked = false; hideScreen(); return true; }
  const ok = await checkPassword(password);
  if (!ok) return false;
  _locked = false;
  hideScreen();
  recordActivity();
  startTimer();
  return true;
}

/* ---------- Экран блокировки ---------- */

function showScreen(){
  const s = $("#lock-screen");
  if (!s) return;
  s.style.display = "flex";
  const inp = $("#lock-password");
  if (inp){ inp.value = ""; inp.focus(); }
}

function hideScreen(){
  const s = $("#lock-screen");
  if (s) s.style.display = "none";
}

/* ---------- Автоблокировка ---------- */

function recordActivity(){
  if (!_hasPwd) return;
  const now = Date.now();
  /* троттлинг записи в sessionStorage — не чаще раза в 2 секунды */
  if (now - _throttleLast > 2000){
    _throttleLast = now;
    try { sessionStorage.setItem(SS_KEY, String(now)); } catch(e){}
  }
  _lastActivity = now;
}

function startTimer(){
  stopTimer();
  if (!_hasPwd) return;
  if (_autoLockMs <= 0) return;

  _checkTimer = setInterval(() => {
    if (_locked) return;
    const now = Date.now();
    if (now - _lastActivity >= _autoLockMs){
      lock();
    }
  }, 5000);
}

function stopTimer(){
  if (_checkTimer){
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}

/* ---------- Хранилище ---------- */

async function loadLockMeta(){
  try {
    const m = await window.App.db.getMeta("lock");
    if (m && typeof m === "object"){
      _hasPwd = !!m.enabled;
      _hash = typeof m.hash === "string" ? m.hash : null;
      _salt = typeof m.salt === "string" ? m.salt : null;
      if (Number.isFinite(m.autoLockMinutes)){
        _autoLockMs = m.autoLockMinutes * 60 * 1000;
      }
    }
  } catch(e){
    console.warn("lock meta load error:", e);
  }
}

async function saveLockMeta(){
  const autoLockMinutes = _autoLockMs > 0 ? Math.round(_autoLockMs / 60000) : 0;
  await window.App.db.setMeta("lock", {
    enabled: _hasPwd,
    hash: _hash,
    salt: _salt,
    autoLockMinutes
  });
}

function setAutoLockMinutes(minutes){
  _autoLockMs = Math.max(0, Number(minutes) || 0) * 60 * 1000;
  saveLockMeta();
  if (_autoLockMs > 0 && _hasPwd && !_locked) startTimer();
  else stopTimer();
}

function getAutoLockMinutes(){
  return _autoLockMs > 0 ? Math.round(_autoLockMs / 60000) : 0;
}

/* ---------- Bind ---------- */

function bind(){
  /* Восстанавливаем lastActivity из sessionStorage */
  try {
    const t = Number(sessionStorage.getItem(SS_KEY));
    if (Number.isFinite(t) && t > 0 && t <= Date.now()) _lastActivity = t;
  } catch(e){}

  /* Загружаем meta и решаем, показывать ли экран */
  loadLockMeta().then(() => {
    if (_hasPwd && !_locked){
      /* был разблокирован раньше, но это новый запуск — блокируем */
    }
    if (_hasPwd){
      _locked = true;
      showScreen();
      startTimer();
    } else {
      _locked = false;
      hideScreen();
    }
  });

  /* Слушаем активность */
  const opts = { capture: true, passive: true };
  ["mousedown","click","keydown","wheel","touchstart","touchmove"].forEach(ev => {
    document.addEventListener(ev, (e) => {
      if (ev === "keydown" && e.repeat) return;   /* авто-повтор не считаем */
      recordActivity();
    }, opts);
  });

  /* mousemove — с троттлингом */
  document.addEventListener("mousemove", () => {
    recordActivity();
  }, { capture: true, passive: true });

  /* Прокрутка основной области */
  const main = document.querySelector("main");
  if (main) main.addEventListener("scroll", recordActivity, { passive: true });

  /* При возврате на вкладку — сразу проверяем */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible"){
      if (_hasPwd && !_locked){
        if (Date.now() - _lastActivity >= _autoLockMs){
          lock();
        }
      }
    }
  });

  /* Форма разблокировки */
  const form = $("#lock-form");
  const input = $("#lock-password");
  const err = $("#lock-error");

  if (form){
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = input.value;
      if (!pw) return;
      const ok = await unlock(pw);
      if (!ok){
        if (err) err.textContent = "Неверный пароль";
        input.value = "";
        input.focus();
        /* лёгкая тряска */
        input.classList.add("shake");
        setTimeout(() => input.classList.remove("shake"), 300);
        return;
      }
      if (err) err.textContent = "";
      toast("Разблокировано");
    });
  }
}

/* ---------- Публичный API ---------- */

return {
  bind,
  hasPassword,
  isLocked,
  setPassword,
  changePassword,
  checkPassword,
  clearPassword,
  lock,
  unlock,
  setAutoLockMinutes,
  getAutoLockMinutes,
  recordActivity
};
})();