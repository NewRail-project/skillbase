#!/data/data/com.termux/files/usr/bin/bash
# Копирование обновления в ~/skillbase, проверки и деплой.
# Использование: bash deploy-termux.sh [путь_к_zip]
set -e
ZIP="${1:-$HOME/storage/downloads/skillbase_updated.zip}"
DEST="$HOME/skillbase"
TMP="$HOME/sb_new"

[ -f "$ZIP" ] || { echo "Нет файла $ZIP (скачайте архив и/или выполните termux-setup-storage)"; exit 1; }
[ -d "$DEST" ] || { echo "Нет папки $DEST"; exit 1; }

echo "→ Резервная копия: $HOME/skillbase_backup"
rm -rf "$HOME/skillbase_backup"
cp -a "$DEST" "$HOME/skillbase_backup"

echo "→ Распаковка"
rm -rf "$TMP"; mkdir -p "$TMP"
unzip -q -o "$ZIP" -d "$TMP"
SRC="$(find "$TMP" -maxdepth 2 -name index.html -printf '%h\n' | head -1)"
cp -a "$SRC"/. "$DEST"/
rm -rf "$TMP"

cd "$DEST"
echo "→ Проверки"
npm test
node scripts/check-imports.mjs
node scripts/check-contrast.mjs | tail -2

echo "→ GitHub Pages"
git add -A
git commit -m "Live: баллы, рейтинг-карточки, серия, таймеры, подиум, ЖД-аватары, реакции, дуэль, экспресс" || true
git push

echo "→ Firebase: правила и индексы (реакции ЖД)"
firebase deploy --only firestore:rules,firestore:indexes

echo "Готово."
