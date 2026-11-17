// ui/components/delete-flows.js — удаление теста и материала кнопкой.
// Один поток на все страницы: проверка прав → предупреждения →
// подтверждение → удаление → сообщение. Возвращает true, если удалено.
//
// Тест удаляется «мягко» (статус deleted, как в каталоге тестов): попытки и
// статистика остаются. Материал удаляется целиком вместе со страницами и PDF.
import { State } from "../../core/auth.js";
import { listMyTests, deleteTest } from "../../core/editor.js";
import { canDeleteTest, deletionPlan, explainDeleteError } from "../../core/test-delete-logic.js";
import { listAssignments } from "../../core/assign.js";
import { deleteLibraryMaterial } from "../../core/material-library.js";
import { canDeleteMaterial, materialDeleteBlockers } from "../../core/material-library-logic.js";
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
  if (plan.closeAssignmentIds.length) {
    details.push(h("p", { class: "warning-msg" }, `Будет закрыто активных заданий: ${plan.closeAssignmentIds.length}`));
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
