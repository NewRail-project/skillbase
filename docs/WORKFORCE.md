# Режимы Education и Workforce

Одна платформа, два оформления и две терминологии. Режим — только внешний вид и тексты:
роли, авторизация, Firestore и права доступа от него не зависят (`firestore.rules` не менялись).

- `core/mode.js` — режим (`localStorage["sb-mode"]`, по умолчанию Education); ставит `data-mode` и `data-ui` на `<html>`.
  Workforce → скин `workforce`; Education → ранее выбранный скин (education / operations / depot).
- `core/i18n.js` — словарь: ключ → (Education, Workforce). `t(key)` — разово, `lt(key)` — «живой» текст для `h()`.
- `shared/live.js` — живые тексты и атрибуты; пересчитываются по событию `sb:modechange` без перерисовки страницы.
- `ui/components/mode-toggle.js` — переключатель в шапке.
- `ui/css/themes/workforce.css` — строгий тёмно-синий/графитовый скин с янтарным акцентом.

Новый текст, зависящий от режима: добавить пару в `ENTRIES` (`core/i18n.js`) и использовать `lt("ключ")`.
Тест `tests/mode.test.js` следит, чтобы наборы ключей совпадали.
Выбор режима хранится на устройстве; на скин Education в Workforce влияет только возврат в Education.
