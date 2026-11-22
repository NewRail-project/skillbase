// tests/slides-viewer.test.js — слайд в читалке: сохраняет пропорции, не
// растягивает «книгу» на весь экран (пустое место под слайдом) и не обрезает.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../ui/css/brand.css", import.meta.url), "utf8");
const material = readFileSync(new URL("../ui/pages/material.js", import.meta.url), "utf8");

test("слайд: центрируется, а не растягивает страницу на всю высоту сцены", () => {
  assert.match(css, /\.book\.is-slide-book\s*\{[^}]*align-self:\s*center/);
  assert.match(css, /\.reader-stage:has\(\.is-slide-book\)\s*\{[^}]*align-items:\s*center/);
});

test("слайд: размер считается по пропорциям картинки и высоте экрана, картинка не обрезается", () => {
  assert.match(css, /\.book-page\.is-slide\s*\{[^}]*--slide-ar:/);
  assert.match(css, /\.book-page\.is-slide \.book-figure\s*\{[\s\S]*?\(100dvh - var\(--slide-chrome\)\) \* var\(--slide-ar\)/);
  const img = css.match(/\.book-page\.is-slide \.book-figure img\s*\{([^}]*)\}/)[1];
  assert.match(img, /aspect-ratio:\s*var\(--slide-ar\)/);
  assert.match(img, /object-fit:\s*contain/, "contain, а не cover — ничего не обрезается");
  assert.doesNotMatch(img, /object-fit:\s*cover/);
});

test("читалка: пропорции берутся у загруженной картинки, запас под текст учитывается", () => {
  assert.match(material, /naturalWidth\s*\/\s*img\.naturalHeight/);
  assert.match(material, /--slide-chrome/);
  assert.match(material, /if \(slide\) fitSlide\(body, blocks\)/);
});

test("читалка: переключение слайдов — стрелки, клавиши и свайп", () => {
  assert.match(material, /ArrowRight/);
  assert.match(material, /ArrowLeft/);
  assert.match(material, /touchstart/);
  assert.match(material, /touchend/);
});
