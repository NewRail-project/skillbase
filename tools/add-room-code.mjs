import fs from 'fs';

const filePath = '/data/data/com.termux/files/home/skillbase/core/editor.js';
const editorContent = fs.readFileSync(filePath, 'utf8');
const lines = editorContent.split('\n');

// Проверяем, есть ли уже generateRoomCode
if (!editorContent.includes('generateRoomCode')) {
  // Добавляем функции в начало файла
  const roomCodeFunctions = `function generateRoomCode() {
  const existingCodes = getExistingRoomCodes();
  let code;
  do {
    code = generateRandomCode();
  } while (existingCodes.includes(code));
  return code;
}

async function getExistingRoomCodes() {
  const snapshot = await getDocs(query(collection(db, "tests"), where("roomCode", "!=", null)));
  return snapshot.docs.map(doc => doc.data().roomCode);
}

function generateRandomCode() {
  return Math.random().toString(36).substring(2, 10);
}
`;
  lines.unshift(roomCodeFunctions);
}

// Найти строку с version в publishTest и вставить roomCode
const versionLineIndex = lines.findIndex((line, idx) => 
  idx > 30 && line.trim().startsWith('const version = (Number.isInteger(currentTest.version)')
);

if (versionLineIndex !== -1) {
  // Проверяем, не добавлен ли уже roomCode
  if (!lines[versionLineIndex + 1].includes('roomCode')) {
    lines.splice(versionLineIndex + 1, 0, '  const roomCode = generateRoomCode();');
  }
}

// Сохраняем файл
fs.writeFileSync(filePath, lines.join('\n'));
console.log('Скрипт успешно обновил core/editor.js');
