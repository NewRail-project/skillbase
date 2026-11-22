// tests/avatar-upload.test.js — собственные аватары: проверка файла и значения,
// показ фото в чипе, выбор в профиле. Правило Firestore проверяется в
// tools/rules-test.mjs; здесь — те же границы на стороне клиента.
import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";
import {
  isImageAvatar, isValidProfileAvatar, isValidAvatarValue, validateAvatarFile,
  IMAGE_AVATAR_MAX_CHARS, AVATAR_UPLOAD_MAX_BYTES, AVATAR_ENCODE_ATTEMPTS, DEFAULT_AVATAR_VALUE
} from "../shared/avatars.js";

installFakeDom();
const { avatarChip, avatarPicker } = await import("../ui/components/avatar.js");

const HEAD = "data:image/jpeg;base64,";
const jpeg = (n) => HEAD + "A".repeat(n);

test("фото: допустим только JPEG data-URL в пределах лимита правила", () => {
  assert.equal(isImageAvatar(jpeg(100)), true);
  assert.equal(isImageAvatar(jpeg(IMAGE_AVATAR_MAX_CHARS - HEAD.length)), true, "ровно на границе");
  assert.equal(isImageAvatar(jpeg(IMAGE_AVATAR_MAX_CHARS - HEAD.length + 1)), false, "на символ больше");
  assert.equal(isImageAvatar("data:image/png;base64,AAAA"), false);
  assert.equal(isImageAvatar("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), false);
  assert.equal(isImageAvatar("data:image/jpeg;base64,AA<script>"), false);
  assert.equal(isImageAvatar("https://example.com/a.jpg"), false);
  assert.equal(isImageAvatar("javascript:alert(1)"), false);
  assert.equal(isImageAvatar(null), false);
});

test("гости и игроки комнат остаются на пресетах; профиль принимает пресет, фото и пустое", () => {
  assert.equal(isValidAvatarValue(jpeg(100)), false, "гость фото загрузить не может");
  assert.equal(isValidProfileAvatar(jpeg(100)), true);
  assert.equal(isValidProfileAvatar("preset:fox"), true);
  assert.equal(isValidProfileAvatar(null), true);
  assert.equal(isValidProfileAvatar("data:image/png;base64,AAAA"), false);
});

test("файл: формат и размер проверяются до чтения", () => {
  assert.equal(validateAvatarFile({ type: "image/jpeg", size: 1000 }), null);
  assert.equal(validateAvatarFile({ type: "image/png", size: 1000 }), null);
  assert.equal(validateAvatarFile({ type: "image/webp", size: 1000 }), null);
  assert.match(validateAvatarFile({ type: "image/svg+xml", size: 1000 }), /JPEG, PNG или WebP/);
  assert.match(validateAvatarFile({ type: "application/pdf", size: 1000 }), /JPEG, PNG или WebP/);
  assert.match(validateAvatarFile({ type: "image/gif", size: 1000 }), /JPEG, PNG или WebP/);
  assert.match(validateAvatarFile({ type: "image/jpeg", size: AVATAR_UPLOAD_MAX_BYTES + 1 }), /слишком большой/);
  assert.match(validateAvatarFile({ type: "image/jpeg", size: 0 }), /пустой/);
  assert.match(validateAvatarFile(null), /не выбран/);
});

test("сжатие: попытки идут от лучшего качества к лёгкому и всегда квадратные", () => {
  const sizes = AVATAR_ENCODE_ATTEMPTS.map((a) => a.size);
  assert.deepEqual([...sizes].sort((a, b) => b - a), sizes);
  assert.ok(sizes[0] <= 128 && sizes.at(-1) >= 64);
  assert.ok(AVATAR_ENCODE_ATTEMPTS.every((a) => a.quality > 0 && a.quality <= 1));
});

test("чип: фото показывается картинкой, неверные значения — буквой, пресеты — как раньше", () => {
  const photo = avatarChip(jpeg(200), "Анна");
  assert.ok(photo.className.includes("avatar-chip-img"));
  const img = findOne(photo, (e) => e.tag === "img");
  assert.equal(img.getAttribute("src"), jpeg(200));
  assert.equal(img.getAttribute("alt"), "", "декоративная картинка: имя выводится рядом");
  const bad = avatarChip("data:image/png;base64,AAAA", "Борис");
  assert.equal(findAll(bad, (e) => e.tag === "img").length, 0, "посторонние данные не рисуются");
  assert.equal(text(bad), "Б");
  const preset = avatarChip("preset:fox", "Вера");
  assert.ok(preset.className.includes("avatar-chip"));
  assert.equal(findAll(preset, (e) => e.tag === "img").length, 0);
});

test("выбор аватара: без allowUpload (гости) кнопки загрузки нет", () => {
  const p = avatarPicker({ value: DEFAULT_AVATAR_VALUE });
  assert.equal(findAll(p.el, (e) => e.className.includes("avatar-upload")).length, 0);
  p.setValue(jpeg(100));
  assert.equal(p.getValue(), DEFAULT_AVATAR_VALUE, "фото гостю не подставить");
});

test("выбор аватара: загрузка фото, смена на пресет, ошибки показываются", async () => {
  const changes = [];
  const files = { ok: { type: "image/png", size: 5000, name: "a.png" }, bad: { type: "image/gif", size: 5000 }, broken: { type: "image/jpeg", size: 5000 } };
  const p = avatarPicker({
    value: DEFAULT_AVATAR_VALUE, allowUpload: true, onChange: (v) => changes.push(v),
    processFile: async (file) => { if (file === files.broken) throw new Error("Файл повреждён"); return jpeg(300); }
  });
  const input = findOne(p.el, (e) => e.tag === "input" && e.getAttribute("type") === "file");
  const errorBox = findOne(p.el, (e) => e.className.includes("avatar-error"));
  const pick = async (file) => { input.files = [file]; input.dispatch("change"); await new Promise((r) => setImmediate(r)); };

  await pick(files.bad);
  assert.match(errorBox.textContent, /JPEG, PNG или WebP/);
  assert.equal(p.getValue(), DEFAULT_AVATAR_VALUE, "неверный формат значение не меняет");

  await pick(files.broken);
  assert.match(errorBox.textContent, /повреждён/);

  await pick(files.ok);
  assert.equal(errorBox.textContent, "");
  assert.equal(p.getValue(), jpeg(300));
  assert.equal(changes.at(-1), jpeg(300));
  const remove = findAll(p.el, (e) => e.tag === "button" && text(e) === "Убрать фото")[0];
  assert.equal(remove.hidden, false, "кнопка «Убрать фото» появилась");

  remove.click();
  assert.equal(p.getValue(), DEFAULT_AVATAR_VALUE);
  assert.equal(remove.hidden, true);
});

test("выбор аватара: сохранённое фото открывается в диалоге профиля", () => {
  const p = avatarPicker({ value: jpeg(150), allowUpload: true, processFile: async () => jpeg(1) });
  assert.equal(p.getValue(), jpeg(150));
  const img = findOne(p.el, (e) => e.tag === "img");
  assert.equal(img.getAttribute("src"), jpeg(150), "превью показывает фото");
});
