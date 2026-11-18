// ui/components/delete-flows.js — удаление учебных объектов кнопкой.
// Один поток на все страницы: проверка прав → план зависимостей →
// предупреждения → подтверждение → удаление → сообщение. Возвращает
// true, если удалено.
//
// Тест удаляется физически (документ, ключи ответов, версии, материал);
// попытки, оценки и журнал сохраняются. Материал удаляется целиком
// вместе со страницами и PDF. Темы и дисциплины удаляются каскадно
// с отсоединением ссылок тестов и материалов (план — subjects-logic).
import { State } from "../../core/auth.js";
import { listMyTests, deleteTest } from "../../core/editor.js";
import { canDeleteTest, deletionPlan, explainDeleteError } from "../../core/test-delete-logic.js";
import { listAssignments } from "../../core/assign.js";
import { deleteLibraryMaterial } from "../../core/material-library.js";
import { canDeleteMaterial, materialDeleteBlockers } from "../../core/material-library-logic.js";
import { getTopics, deleteTopic, deleteSubject } from "../../core/subjects.js";
import {
  topicDeletionPlan, subjectDeletionPlan,
  deletionPlanSummary, subjectWriteAccessError
} from "../../core/subjects-logic.js";
import { listMaterials } from "../../core/material-library.js";
import { getDocs, query, collection, db, where } from "../../shared/firebase.js";
import { confirmAction } from "./confirm.js";
import { toast } from "./toast.js";
import { h } from "../../shared/dom.js";
import { t as tr } from "../../core/i18n.js";

const session = () => ({ uid: State.user?.uid, role: State.profile?.role, orgId: State.profile?.orgId });

export async function deleteTestFlow(test) {
  const can = canDeleteTest(test, session());
  if (!can.allowed) { toast(can.reason, "error"); return false; }

  // План: активные задания организации и свои Live-комнаты этого теста.
  let assignments = [];
  try { assignments = await listAssignments(State.profile.orgId); } catch (_) { /* без плана заданий */ }
  let rooms = [];
  try {
    const snap = await getDocs(query(collection(db, "rooms"),
      where("testId", "==", test.id), where("hostId", "==", State.user.uid)));
    rooms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) { /* чужие комнаты правила не отдают */ }
  const plan = deletionPlan({ test, session: { uid: State.user.uid, role: State.profile.role }, assignments, rooms });

  const details = [];
  if (plan.deleteAssignmentIds.length) {
    details.push(h("p", { class: "warning-msg" }, `Будет удалено активных заданий: ${plan.deleteAssignmentIds.length}`));
  }
  if (plan.closeRoomCodes.length) {
    details.push(h("p", { class: "warning-msg" }, `Будет закрыто активных Live-комнат: ${plan.closeRoomCodes.length}`));
  }
  if (plan.foreignAssignmentIds.length || plan.foreignRooms.length) {
    details.push(h("p", { class: "muted" }, tr("tests.deleteForeign")));
  }
  const ok = await confirmAction({
    title: tr("tests.deleteConfirm", { title: test.title }),
    text: tr("tests.deleteHint"), details, confirmLabel: "Удалить", tone: "danger"
  });
  if (!ok) return false;
  try {
    await deleteTest(test.id, plan);
    toast(tr("tests.deleted"), "success");
    return true;
  } catch (err) {
    toast(explainDeleteError(err), "error");
    return false;
  }
}

export async function deleteMaterialFlow(material) {
  const can = canDeleteMaterial(material, session());
  if (!can.allowed) { toast(can.reason, "error"); return false; }

  // Привязанные тесты: без материала их обязательное чтение не завершить.
  let tests = [];
  try {
    tests = await listMyTests(State.user.uid, State.profile.orgId, State.profile.role);
  } catch (_) {
    toast("Не удалось проверить, привязан ли материал к тестам. Попробуйте ещё раз.", "error");
    return false;
  }
  const blockers = materialDeleteBlockers(material.id, tests);
  if (blockers.length) {
    const names = blockers.slice(0, 5).map(t => `«${t.title || "Без названия"}»`).join(", ");
    toast(`Нельзя удалить: материал привязан к тестам (${names}${blockers.length > 5 ? " и др." : ""}). Сначала отвяжите его в редакторе теста.`, "error");
    return false;
  }

  const ok = await confirmAction({
    title: `Удалить материал «${material.title || "Без названия"}»?`,
    text: "Материал, все его страницы и вложенный PDF будут удалены без возможности восстановления. Чтобы только скрыть его от студентов, используйте «В архив».",
    confirmLabel: "Удалить", tone: "danger"
  });
  if (!ok) return false;
  try {
    await deleteLibraryMaterial(material.id);
    toast("Материал удалён", "success");
    return true;
  } catch (err) {
    toast(err?.message || "Не удалось удалить материал.", "error");
    return false;
  }
}

// Общая проверка прав на темы и дисциплины: зеркало правил (isStaff +
// orgId). Возвращает понятную ошибку тостом и false.
function subjectAccessDenied() {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) { toast(denied, "error"); return true; }
  return false;
}

// Зависимости темы/дисциплины: тесты и материалы организации. Без списка
// зависимостей удаление не начинается — молча удалять ссылки нельзя.
async function deletionDependencies() {
  let tests = [];
  let materials = [];
  try {
    [tests, materials] = await Promise.all([
      listMyTests(State.user.uid, State.profile.orgId, State.profile.role),
      listMaterials()
    ]);
  } catch (err) {
    toast("Не удалось проверить связанные тесты и материалы. Удаление не выполнено — попробуйте ещё раз.", "error");
    return null;
  }
  return { tests, materials };
}

// Список заметок плана — узлами для окна подтверждения.
function planDetails(notes) {
  return notes.map(text => h("p", { class: "warning-msg" }, text));
}

// Защита от повторного нажатия: удаление идёт, вторая попытка игнорируется.
let subjectDeleteBusy = false;

function beginSubjectDelete() {
  if (subjectDeleteBusy) return false;
  subjectDeleteBusy = true;
  return true;
}

/**
 * Удаление темы: план (отсоединение тестов и материалов) → подтверждение
 * с перечнем последствий → физическое удаление. Возвращает true, если тема удалена.
 */
export async function deleteTopicFlow(topic) {
  if (!topic?.id || subjectAccessDenied()) return false;

  const deps = await deletionDependencies();
  if (!deps) return false;
  const plan = topicDeletionPlan({ topic, session: session(), ...deps });

  const ok = await confirmAction({
    title: `Удалить тему «${topic.title || "Без названия"}»?`,
    text: "Тема будет удалена без возможности восстановления: расписание, публикация и настройки темы пропадут. Тесты и материалы темы останутся, ссылка на тему будет снята.",
    details: planDetails(deletionPlanSummary(plan)),
    confirmLabel: "Удалить", tone: "danger"
  });
  if (!ok) return false;
  if (!beginSubjectDelete()) return false;
  try {
    await deleteTopic(topic.id, plan);
    toast("Тема удалена", "success");
    return true;
  } catch (err) {
    toast(err?.message || "Не удалось удалить тему.", "error");
    return false;
  } finally {
    subjectDeleteBusy = false;
  }
}

/**
 * Удаление дисциплины: каскадно удаляет её темы (с их планами отсоединения)
 * и саму дисциплину после подтверждения. Возвращает true, если удалена.
 */
export async function deleteSubjectFlow(subject) {
  if (!subject?.id || subjectAccessDenied()) return false;

  let topics = [];
  try {
    topics = await getTopics(subject.id);
  } catch (_) {
    topics = [];
  }
  const deps = await deletionDependencies();
  if (!deps) return false;
  const plan = subjectDeletionPlan({ subject, session: session(), topics, ...deps });

  const ok = await confirmAction({
    title: `Удалить дисциплину «${subject.title || "Без названия"}»?`,
    text: "Дисциплина и все её темы будут удалены без возможности восстановления. Тесты и материалы тем останутся, ссылка на тему будет снята.",
    details: planDetails(deletionPlanSummary(plan)),
    confirmLabel: "Удалить", tone: "danger"
  });
  if (!ok) return false;
  if (!beginSubjectDelete()) return false;
  try {
    await deleteSubject(subject.id, plan);
    toast("Дисциплина удалена", "success");
    return true;
  } catch (err) {
    toast(err?.message || "Не удалось удалить дисциплину.", "error");
    return false;
  } finally {
    subjectDeleteBusy = false;
  }
}
