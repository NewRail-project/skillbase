import { db } from "../shared/firebase.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, query, where, getDocs, collection } from "../shared/firebase.js";
import { State } from "./auth.js";

export function displayName(profile, { viewerIsStaff, uid } = {}) {
  if (profile && profile.fullName) return profile.fullName;
  if (viewerIsStaff && profile && profile.email) return profile.email.split('@')[0];
  const suffix = (uid || profile?.uid || "").slice(-4);
  return suffix ? "Участник ·" + suffix : "Участник";
}

export function initialsAvatar(name, uid) {
  const initials = (name || "U").slice(0, 1).toUpperCase();
  const hash = (uid || "").split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = hash % 360;
  return { initials, hue };
}

export function validateFullName(str) {
  const trimmed = (str || "").trim();
  if (trimmed.length < 2) return { ok: false, error: "ФИО слишком короткое" };
  if (trimmed.length > 120) return { ok: false, error: "ФИО слишком длинное" };
  return { ok: true, value: trimmed };
}

export async function processAvatarFile(file) {
  if (!file.type.startsWith("image/")) throw new Error("Неверный формат файла");
  if (file.size > 3 * 1024 * 1024) throw new Error("Файл слишком большой (макс 3 МБ)");
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        const size = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 128, 128);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => reject(new Error("Ошибка обработки изображения"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Ошибка чтения файла"));
    reader.readAsDataURL(file);
  });
}

// Сохраняет личные поля профиля. Набор полей совпадает с правилом update
// в firestore.rules; роль и организацию здесь изменить нельзя.
export async function saveProfile(uid, patch, publicPatch) {
  const allowed = ["fullName", "position", "department", "ui", "themeMode"];
  const clean = {};
  for (const key of allowed) {
    if (patch && patch[key] !== undefined) clean[key] = patch[key];
  }
  if (clean.fullName !== undefined) {
    const check = validateFullName(clean.fullName);
    if (!check.ok) throw new Error(check.error);
    clean.fullName = check.value;
  }
  if (!Object.keys(clean).length && !publicPatch) return State.profile;

  try {
    if (Object.keys(clean).length) {
      await updateDoc(doc(db, "users", uid), clean);
    }
    if (publicPatch) {
      // Документа может ещё не быть — setDoc с merge создаст его.
      await setDoc(doc(db, "publicProfiles", uid), {
        ...publicPatch,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
  } catch (error) {
    console.error("Ошибка сохранения профиля:", error);
    throw new Error("Не удалось сохранить профиль. Проверьте подключение и права доступа.");
  }

  const docSnap = await getDoc(doc(db, "users", uid));
  if (docSnap.exists()) {
    // uid берём из документа-ссылки: в data() его нет.
    State.profile = { ...docSnap.data(), uid };
  } else {
    State.profile = { ...State.profile, ...clean, uid };
  }
  return State.profile;
}

export async function loadPublicProfiles(uids) {
  if (!uids.length) return [];
  const chunks = [];
  for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));
  
  const results = [];
  for (const chunk of chunks) {
    const q = query(collection(db, "publicProfiles"), where(documentId(), "in", chunk));
    const snap = await getDocs(q);
    snap.docs.forEach(d => results.push({ id: d.id, ...d.data() }));
  }
  return results;
}

export async function resolveNames(uids, { viewerIsStaff }) {
  const profiles = await loadPublicProfiles(uids);
  const nameMap = new Map();
  // Документ publicProfiles хранит uid в id, а не в поле data().uid.
  profiles.forEach(p => nameMap.set(p.id, displayName(p, { viewerIsStaff })));

  return uids.map(uid => nameMap.get(uid) || "Участник").join(", ");
}

export function computeProfileStats(attempts, passPercent = 60) {
  if (!attempts || attempts.length === 0) return null;
  // Попытка хранит score/total; percent может отсутствовать у старых записей.
  const graded = attempts.filter(a => a.status === "graded" && a.total);
  if (!graded.length) return { total: attempts.length, graded: 0, avg: 0, passed: 0 };

  const percents = graded.map(a => Number.isFinite(a.percent)
    ? a.percent
    : Math.round(((a.score || 0) / a.total) * 100));
  const avg = Math.round(percents.reduce((sum, p) => sum + p, 0) / percents.length);
  const passed = percents.filter(p => p >= passPercent).length;
  return { total: attempts.length, graded: graded.length, avg, passed };
}