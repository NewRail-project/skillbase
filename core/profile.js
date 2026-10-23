import { db } from "../shared/firebase.js";
import { doc, getDoc, updateDoc, writeBatch, serverTimestamp, query, where, getDocs, collection, documentId } from "../shared/firebase.js";

export function displayName(profile, { viewerIsStaff, uid }) {
  if (profile.fullName) return profile.fullName;
  if (viewerIsStaff && profile.email) return profile.email.split('@')[0];
  return "Участник ·" + (uid || "").slice(-4);
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

export async function saveProfile(uid, patch, publicPatch, profileData) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "users", uid), patch);
    batch.set(doc(db, "publicProfiles", uid), { ...publicPatch, updatedAt: serverTimestamp() }, { merge: true });
    await batch.commit();

    // Обновляем State.profile
    const docRef = doc(db, "users", uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const updatedProfile = { ...docSnap.data(), ...patch };
      State.profile = updatedProfile;
    }
  } catch (error) {
    console.error("Ошибка сохранения профиля:", error);
    throw new Error("Не удалось сохранить профиль");
  }
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
  profiles.forEach(p => nameMap.set(p.uid, displayName(p, { viewerIsStaff })));
  
  return uids.map(uid => nameMap.get(uid) || "Участник").join(", ");
}

export function computeProfileStats(attempts) {
  if (!attempts || attempts.length === 0) return null;
  const finished = attempts.filter(a => a.status === 'graded');
  if (finished.length === 0) return { total: attempts.length, graded: 0, avg: 0, passed: 0 };
  
  const avg = finished.reduce((acc, a) => acc + (a.percent || 0), 0) / finished.length;
  const passed = finished.filter(a => a.passed).length;
  return { total: attempts.length, graded: finished.length, avg: Math.round(avg), passed };
}