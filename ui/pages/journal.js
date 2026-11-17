// ui/pages/journal.js — Электронный журнал студентских успеваемости.
//
// Предоставляет представление журнала с вкладками:
//   — по дисциплинам (преподавателю)
//   — по группам
//   — по студентам
//   — по темам
//   — по периоду (дате)
//
// Источники оценок: обычные тесты, Live-тесты, контрольные работы,
// практические задания, дополнительные работы, ручные grades учителя.
// Авто-ингрейдж после проверки попытки (status "graded").
// Посещаемость: present/absent/late/excused.
// Экспорт CSV: UTF-8 BOM, кириллица, фильтры.
//
// Безопасность: проверка role, orgId, discipline access через Firestore rules.
// Студенты видят только свою строку; учителя/админы — соответствующие данные.
//
// Ссылка: #journal (добавлена в shared/app.js).

import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { computeJournalData, generateJournalUiRows, verifyOperation } from "../../core/journal.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { isGradedStatus } from "../../core/journal-logic.js";
import { saveGradeOverride, saveAttendance } from "../../core/journal.js";
import { getSubjects, getTopics } from "../../core/subjects.js";
import { toCsv, safeFileName, downloadCsv } from "../../shared/csv.js";
import { t as tr, lt } from "../../core/i18n.js";
import { modal } from "../../ui/components/modal.js";
import { toast } from "../../ui/components/toast.js";
import { icons } from "../../shared/icons.js";

const COLUMNS = ["№", "ФИО", "Статус", "Оценка", "Правильные", "Неправильные", "Пропуски"];

function statusLabel(status) {
  if (!status) return "—";
  switch (status) {
    case "present": return "Присутствовал";
    case "absent":  return "Отсутствовал";
    case "late":    return "Опоздал";
    case "excused": return "Извинились";
    default:        return String(status);
  }
}

function statusColor(status) {
  switch (status) {
    case "present": return "good";
    case "absent":  return "danger";
    case "late":    return "warning";
    case "excused": return "info";
    default:        return "neutral";
  }
}

// Источник оценки по данным попытки: обычный тест, Live-комната или
// неизвестный (старые записи без пометки).
function gradeSourceFromAttempt(a) {
  if (!a) return null;
  if (a.source) return a.source;
  if (a.mode === "live" || a.roomId || a.liveRoomId) return "live";
  return null;
}

export default async function JournalPage() {
  const page = h("div", { class: "page" });
  const staff = isStaff();
  const user = State.user;
  const profile = State.profile;

  if (!user) {
    return h("div", { class: "page" },
      h("div", { class: "panel" },
        h("h2", {}, tr("journal.title")),
        h("p", { class: "muted" }, "Войдите в аккаунт, чтобы видеть журнал.")));
  }

  // ---- State for current view ----
  const state = {
    view: "disciplines",      // disciplines | groups | students | topics | period
    disciplineId: null,
    groupFilter: null,
    studentFilter: null,
    topicFilter: null,
    periodFrom: null,
    periodTo: null,
    searchQuery: "",
    // Данные текущего вида
    rows: [],
    headers: COLUMNS,
    subjectFilter: null,
    // Для форм
    overrideStudentId: null,
    overrideFrom: null,
    overrideTo: null,
    overrideReason: null,
    attendanceStudentId: null,
    attendanceDisciplineId: null,
    attendanceStatus: "present",
    attendanceReason: ""
  };

  // ---- Загрузка данных ----
  async function loadAttempts() {
    if (!profile || !profile.orgId) {
      toast("Организация не указана в профиле", "error");
      return [];
    }
    return await listOrgAttempts(profile.orgId);
  }

  // Справочники дисциплин — в области видимости страницы: они нужны и
  // при расчёте данных, и при отрисовке.
  const subjectsMap = new Map();

  async function loadData() {
    const attempts = await loadAttempts();
    if (!attempts || !attempts.length) {
      state.rows = [];
      return;
    }

    // Загружаем справочники предметов и тем
    let topicsMap = new Map();

    try {
      const subjects = await getSubjects();
      subjects.forEach(s => subjectsMap.set(s.id, { title: s.title || `Предмет ${s.id}` }));

      const topics = await getTopics();
      topics.forEach(t => {
        topicsMap.set(t.id, {
          title: t.title || `Тема ${t.id}`,
          subjectId: t.subjectId || null
        });
      });
    } catch (err) {
      console.error("Ошибка загрузки справочников:", err);
    }

    // Вычисляем данные журнала
    const journalData = await computeJournalData({
      attempts,
      subjectsMap,
      topicsMap
    });

    // Применяем фильтры и формируем строки в зависимости от вида
    await applyViewFilter(journalData, state);

    // Если это режим "студент" — фильтруем только свои записи
    if (state.view === "students" && profile?.role === "student" && profile.uid) {
      const ownUid = profile.uid;
      state.rows = state.rows.filter(r => r.uid === ownUid);
    }
  }

  async function applyViewFilter(journalData, state) {
    const { perTopic, perStudent, disciplines, needsAgreement } = journalData;
    let rows = [];

    switch (state.view) {
      case "disciplines": {
        // По дисциплинам: перебираем subjects
        for (const subj of disciplines) {
          for (const [tid, topicData] of subj.topics) {
            if (topicData.needsAgreement && !state.subjectFilter) {
              // Можно добавить индикацию, но для строк показываем данные
            }
            // Собираем студентов, сдавших темы по этому предмету
            for (const [uid, topicMap] of perStudent) {
              const topicInfo = topicMap.get(tid);
              if (!topicInfo) continue;

              // Определяем оценку: применяем override, если есть
              let grade = topicData.totalGrade;
              const overrideKey = `${uid}-${tid}`;
              // overrideMap будет заполнен позже при чтении из Firestore

              rows.push({
                uid,
                name: getStudentName(uid), // нужно получать из профиля
                subjectId: subj.subjectId || "",
                discipline: subj.title || "Предмет",
                topicId: tid,
                topicTitle: topicInfo.topicTitle || "Тема",
                grade: typeof grade === "number" ? grade : null,
                source: topicData.testGrade !== null ? "test" : "manual",
                // Дополнительные поля для отображения
                earned: topicInfo.earned || 0,
                max: topicInfo.max || 1,
                answered: topicInfo.answered || 0,
                total: topicInfo.total || 1,
                // attendance и override будут подставляться отдельно
              });
            }
          }
        }
        break;
      }

      case "groups": {
        // По группам — собираем по groupId из попыток
        const groupGrades = new Map(); // groupId -> [{ uid, name, grade }]
        for (const [uid, topicMap] of perStudent) {
          const attemptsForStudent = (await loadAttempts()).filter(a => a.userId === uid);
          for (const a of attemptsForStudent) {
            const groupId = a.groupId || "";
            if (!groupGrades.has(groupId)) groupGrades.set(groupId, []);
            const grade = a.score || a.grade || 0;
            groupGrades.get(groupId).push({ uid, name: getStudentName(uid), grade });
          }
        }

        // Формируем строки для каждого студента в группах
        for (const [groupId, students] of groupGrades) {
          for (const s of students) {
            rows.push({
              uid: s.uid,
              name: s.name,
              groupId,
              discipline: "—",
              topicTitle: "—",
              grade: s.grade,
              source: "auto",
              earned: 0, max: 0, answered: 0, total: 0
            });
          }
        }
        break;
      }

      case "students": {
        // По студентам — перебираем perStudent
        for (const [uid, topicMap] of perStudent) {
          // Считаем общую оценку по всем темам студента
          let totalGrades = 0;
          let topicCount = 0;
          for (const [tid, topicData] of topicMap) {
            if (typeof topicData.totalGrade === "number") {
              totalGrades += topicData.totalGrade;
              topicCount++;
            }
          }
          const avgGrade = topicCount > 0 ? Math.round(totalGrades / topicCount) : null;

          rows.push({
            uid,
            name: getStudentName(uid),
            discipline: "—",
            topicTitle: "—",
            grade: avgGrade,
            source: "mixed",
            earned: 0, max: 0, answered: 0, total: 0
          });
        }
        break;
      }

      case "topics": {
        // По темам — собираем данные по всем дисциплинам
        const topicRows = [];
        const topicGradeCounts = new Map(); // topicId -> { totalGradeSum, count, needsAgreement }

        for (const [tid, topicData] of perTopic) {
          const info = topicsMap.get(tid) || { title: `Тема ${tid}`, subjectId: "" };
          const subj = disciplines.find(d => d.subjectId === info.subjectId) || {};

          let needsAgree = topicData.needsAgreement;
          let gradeSum = 0;
          let count = 0;

          // Собираем оценки по теме со всех студентов
          for (const [uid, topicMap] of perStudent) {
            const t = topicMap.get(tid);
            if (!t) continue;
            if (typeof t.totalGrade === "number") {
              gradeSum += t.totalGrade;
              count++;
            }
          }

          if (count > 0) {
            topicGradeCounts.set(tid, {
              gradeAvg: Math.round(gradeSum / count),
              needsAgreement: needsAgree,
              count
            });
          }

          // Добавляем строку для учителя (суммарная оценка по теме)
          topicRows.push({
            uid: null,
            name: info.title,
            discipline: subj.title || "—",
            topicId: tid,
            topicTitle: info.title,
            grade: topicGradeCounts.get(tid) ? topicGradeCounts.get(tid).gradeAvg : null,
            source: "mixed",
            earned: 0, max: 0, answered: 0, total: 0,
            needsAgreement: needsAgree
          });
        }
        rows = topicRows;
        break;
      }

      case "period": {
        // По периоду (дате) — фильтруем по submittedAt / gradedAt
        const from = state.periodFrom ? new Date(state.periodFrom) : null;
        const to = state.periodTo ? new Date(state.periodTo) : null;

        for (const [uid, topicMap] of perStudent) {
          const studentAttempts = (await loadAttempts()).filter(a => a.userId === uid);
          for (const a of studentAttempts) {
            if (!isGradedStatus(a.status)) continue;
            const attemptDate = a.gradedAt || a.submittedAt || a.startedAt;
            if (!attemptDate) continue;

            const d = new Date(attemptDate.seconds * 1000 + attemptDate.nanoseconds / 1e6 || 0);
            if (from && d < from) continue;
            if (to && d > to) continue;

            rows.push({
              uid,
              name: getStudentName(uid),
              discipline: a.subjectId ? `Предмет ${a.subjectId}` : "—",
              topicTitle: a.topicId ? `Тема ${a.topicId}` : "Без темы",
              grade: a.score || a.grade || 0,
              source: gradeSourceFromAttempt(a) || "test",
              earned: a.score || 0,
              max: a.total || 0,
              answered: a.answered || 0,
              total: a.total || 0
            });
          }
        }
        break;
      }
    }

    // Сортировка: по фамилии (ру русском алфавите), затем по имени
    rows.sort((a, b) => {
      const na = (a.name || "").toString().toLowerCase();
      const nb = (b.name || "").toString().toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    });

    state.rows = rows;
    state.headers = viewHeaders(state.view);
  }

  function getStudentName(uid) {
    // Ищем имя в попытках или пробуем из profile
    // В данной реализации упрощённо возвращаем uid или ищем в attempts
    // Настоящая реализация будет читать из users/{uid} или профиля
    return "Студент"; // placeholder
  }

  function viewHeaders(view) {
    switch (view) {
      case "disciplines": return ["Дисциплина", "Тема", "Студент", "Оценка", "Источник"];
      case "groups":      return ["Группа", "Студент", "Оценка"];
      case "students":    return ["Студент", "Средняя оценка"];
      case "topics":      return ["Тема", "Дисциплина", "Кол-во студентов", "Средняя оценка", "Нужен consensus"];
      case "period":      return ["Дата", "Студент", "Дисциплина", "Тема", "Оценка"];
      default:            return COLUMNS;
    }
  }

  function formatGrade(grade) {
    if (grade === null || grade === undefined) return "—";
    return typeof grade === "number" ? grade.toString() : String(grade);
  }

  function formatSource(source) {
    const map = { test: "Обычный тест", live_test: "Live-тест", control_work: "Контрольная работа",
      practical: "Практическое", extra: "Доп. работа", manual: "Ручной ввод" };
    return map[source] || source || "—";
  }

  // ---- Рендер вкладок ----
  function renderTabButtons() {
    const views = [
      { key: "disciplines", title: "По дисциплинам" },
      { key: "groups", title: "По группам" },
      { key: "students", title: "По студентам" },
      { key: "topics", title: "По темам" },
      { key: "period", title: "По периоду" }
    ];

    const active = state.view;
    return h("div", { class: "toolbar" },
      views.map(v => h("button", {
        key: v.key,
        type: "button",
        class: `tab-btn ${state.view === v.key ? "active" : ""}`,
        onclick: () => {
          state.view = v.key;
          state.disciplineId = null;
          state.groupFilter = null;
          state.studentFilter = null;
          state.topicFilter = null;
          state.periodFrom = null;
          state.periodTo = null;
          state.searchQuery = "";
          loadData();
        }
      }, v.title))
    );
  }

  // ---- Форма ручной правки оценки ----
  async function openGradeOverrideDialog(studentId, currentGrade) {
    state.overrideStudentId = studentId;
    state.overrideFrom = currentGrade || "";
    state.overrideTo = "";
    state.overrideReason = "";

    const confirmed = await modal({
      title: "Ручная правка оценки",
      body: h("form", { class: "journal-form" },
        h("div", { class: "form-field" },
          h("label", {}, "Студент:"),
          h("span", { class: "value" }, state.overrideStudentId ? "—" : "—")), // показывать имя позже
        h("div", { class: "form-field" },
          h("label", {}, "Текущая оценка:"),
          h("input", {
            type: "number",
            min: 0, max: 100,
            value: state.overrideFrom,
            "aria-label": "Текущая оценка"
          })),
        h("div", { class: "form-field" },
          h("label", {}, "Новая оценка:"),
          h("input", {
            type: "number",
            min: 0, max: 100,
            value: state.overrideTo,
            "aria-label": "Новая оценка"
          })),
        h("div", { class: "form-field" },
          h("label", {}, "Причина изменения:"),
          h("textarea", {
            rows: 3,
            value: state.overrideReason,
            "aria-label": "Причина изменения"
          }))),
      okLabel: "Сохранить",
      cancelLabel: "Отмена"
    });

    if (!confirmed) return;

    // Применение правки
    try {
      const result = await verifyOperation("addOverride");
      if (!result.ok) {
        toast(result.error || "Доступ запрещен", "error");
        return;
      }

      await saveGradeOverride({
        uid: state.overrideStudentId,
        authorUid: State.user?.uid || null,
        from: Number(state.overrideFrom) || 0,
        to: Number(state.overrideTo) || 0,
        reason: state.overrideReason || "Без причины"
      });

      toast("Оценка изменена", "success");
      loadData();
    } catch (err) {
      console.error("Ошибка правки оценки:", err);
      toast(err?.message || "Не удалось изменить оценку", "error");
    }
  }

  // ---- Форма посещаемости ----
  async function openAttendanceDialog(studentId, disciplineId) {
    state.attendanceStudentId = studentId;
    state.attendanceDisciplineId = disciplineId;
    state.attendanceStatus = "present";
    state.attendanceReason = "";

    const statusOptions = [
      { value: "present", label: "Присутствовал" },
      { value: "absent",  label: "Отсутствовал" },
      { value: "late",    label: "Опоздал" },
      { value: "excused", label: "Извинились" }
    ];

    const confirmed = await modal({
      title: "Отметка посещаемости",
      body: h("form", { class: "journal-form" },
        h("div", { class: "form-field" },
          h("label", {}, "Студент:"),
          h("span", { class: "value" })),
        h("div", { class: "form-field" },
          h("label", {}, "Дисциплина:"),
          h("span", { class: "value" }, state.attendanceDisciplineId ? "—" : "—")),
        h("div", { class: "form-field" },
          h("label", {}, "Статус:"),
          h("select", {
            "aria-label": "Статус посещаемости",
            onchange: (e) => { state.attendanceStatus = e.target.value; }
          }, ...statusOptions.map(s =>
            h("option", { value: s.value }, s.label)
          ))),
        h("div", { class: "form-field" },
          h("label", {}, "Причина (если уважительная):"),
          h("textarea", {
            rows: 3,
            "aria-label": "Причина"
          }))),
      okLabel: "Сохранить",
      cancelLabel: "Отмена"
    });

    if (!confirmed) return;

    try {
      const result = await verifyOperation("addAttendance");
      if (!result.ok) {
        toast(result.error || "Доступ запрещен", "error");
        return;
      }

      await saveAttendance({
        studentId: state.attendanceStudentId,
        disciplineId: state.attendanceDisciplineId,
        status: state.attendanceStatus,
        reason: state.attendanceReason || null
      });

      toast("Посещаемость отмечена", "success");
      loadData();
    } catch (err) {
      console.error("Ошибка сохранения посещаемости:", err);
      toast(err?.message || "Не удалось отметить посещаемость", "error");
    }
  }

  // ---- CSV Export ----
  async function exportCsv() {
    if (state.rows.length === 0) {
      toast("Нет данных для экспорта", "info");
      return;
    }

    // Проверка прав: только сотрудники могут экспортировать
    if (!staff) {
      toast("Только преподаватели и администраторы могут экспортировать данные", "error");
      return;
    }

    // Формируем CSV данные в зависимости от вида
    let headers = [];
    let rows = [];

    switch (state.view) {
      case "disciplines":
        headers = ["Дисциплина", "Тема", "Студент", "Оценка", "Источник"];
        rows = state.rows.map(r => [
          r.discipline || "",
          r.topicTitle || "",
          r.name || "",
          formatGrade(r.grade),
          formatSource(r.source)
        ]);
        break;

      case "groups":
        headers = ["Группа", "Студент", "Оценка"];
        rows = state.rows.map(r => [r.groupId || "", r.name || "", formatGrade(r.grade)]);
        break;

      case "students":
        headers = ["Студент", "Средняя оценка"];
        rows = state.rows.map(r => [r.name || "", formatGrade(r.grade)]);
        break;

      case "topics":
        headers = ["Тема", "Дисциплина", "Кол-во студентов", "Средняя оценка", "Нужен consensus"];
        rows = state.rows.map(r => [
          r.topicTitle || "",
          r.discipline || "",
          r.count || 0,
          formatGrade(r.grade),
          r.needsAgreement ? "Да" : "Нет"
        ]);
        break;

      case "period":
        headers = ["Дата", "Студент", "Дисциплина", "Тема", "Оценка"];
        rows = state.rows.map(r => [
          r.date ? new Date(r.date).toLocaleDateString("ru-RU") : "",
          r.name || "",
          r.discipline || "",
          r.topicTitle || "",
          formatGrade(r.grade)
        ]);
        break;

      default:
        headers = ["№", "ФИО", "Статус", "Оценка", "Правильные", "Неправильные", "Пропуски"];
        rows = state.rows.map(r => [
          r.n || "",
          r.name || "",
          r.statusLabel || "",
          formatGrade(r.grade),
          r.correct || 0,
          r.wrong || 0,
          r.skipped || 0
        ]);
    }

    const filename = `журнал-${state.view}-${new Date().toLocaleDateString("ru-RU")}.csv`;
    const csv = toCsv(rows, headers, { separator: ";" }); // ; для Excel руси
    downloadCsv(filename, csv);
  }

  // ---- Initial mount ----
  // Сначала загружаем попытки и формируем данные
  await loadData();

  // --- Header ---
  const header = h("section", { class: "page-head" },
    h("div", { class: "eyebrow" }, tr("journal.title")),
    h("h1", {}, tr("journal.title")),
    staff ? h("div", { class: "page-head-actions" }, h("button", {
      type: "button",
      class: "btn secondary",
      onclick: exportCsv
    }, "Экспорт CSV")) : null);

  // --- Main content ---
  const main = h("div", { class: "panel" },

    // Tab buttons
    renderTabButtons(),

    // View content
    h("div", { class: "journal-view" }, state.rows.length > 0 ? renderViewContent() : renderEmptyState())
  );

  page.append(header, main);

  function renderEmptyState() {
    const viewLabels = {
      disciplines: "Данных по дисциплинам нет",
      groups: "Данных по группам нет",
      students: "Данных по студентам нет",
      topics: "Данных по темам нет",
      period: "Данных по периодам нет"
    };

    return h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.book }),
      h("h2", {}, tr("journal.noData")),
      h("p", { class: "muted" }, viewLabels[state.view] || "Нет данных"),
      h("a", { class: "btn secondary", href: "#", onclick: () => {} }, "—"));
  }

  function renderViewContent() {
    switch (state.view) {
      case "disciplines": return renderDisciplinesView();
      case "groups": return renderGroupsView();
      case "students": return renderStudentsView();
      case "topics": return renderTopicsView();
      case "period": return renderPeriodView();
      default: return renderDisciplinesView();
    }
  }

  function renderDisciplinesView() {
    // Группируем строки по дисциплине
    const byDiscipline = new Map(); // subjectId -> [{ discipline, topicTitle, name, grade }]

    for (const r of state.rows) {
      const sid = r.subjectId || "unknown";
      if (!byDiscipline.has(sid)) byDiscipline.set(sid, []);
      byDiscipline.get(sid).push({
        discipline: r.discipline || "—",
        topicTitle: r.topicTitle || "—",
        name: r.name || "—",
        grade: r.grade
      });
    }

    const items = [...byDiscipline.entries()].sort((a, b) =>
      a[1][0].discipline.localeCompare(b[1][0].discipline, "ru")
    );

    return h("div", { class: "list" }, items.map(([sid, students]) => h("div", { class: "list-row" },
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, sid === "unknown" ? "Без предмета" : (subjectsMap.get(sid)?.title || `Предмет ${sid}`)),
        h("div", { class: "list-row-sub" }, `${students.length} студентов`))),
      ...students.map((s, i) => h("div", { key: i, class: "list-row" },
        h("div", { class: "list-row-sub" }, `${s.name}: ${formatGrade(s.grade)}`)))));
  }

  function renderGroupsView() {
    const byGroup = new Map(); // groupId -> [{ name, grade }]
    for (const r of state.rows) {
      const gid = r.groupId || "no-group";
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push({ name: r.name || "—", grade: r.grade });
    }

    const items = [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));
    return h("div", { class: "list" }, items.map(([groupId, students]) => h("div", { class: "list-row" },
      h("div", { class: "list-row-main" }, `Группа ${groupId || "—"}`)),
      ...students.map(s => h("div", { class: "list-row" },
        h("div", { class: "list-row-sub" }, `${s.name}: ${formatGrade(s.grade)}`)))));
  }

  function renderStudentsView() {
    return h("div", { class: "list" }, state.rows.map((r, i) => h("div", { key: i, class: "list-row" },
      h("div", { class: "list-row-main" }, `${r.name || `Студент ${r.uid}`}`),
      h("div", { class: "list-row-end" }, formatGrade(r.grade) ? `Оценка: ${formatGrade(r.grade)}` : "—"))));
  }

  function renderTopicsView() {
    const byTopic = new Map(); // topicId -> [{ topicTitle, discipline, students: [{name, grade}] }]
    for (const r of state.rows) {
      const tid = r.topicId || "unknown";
      if (!byTopic.has(tid)) byTopic.set(tid, []);
      byTopic.get(tid).push({
        topicTitle: r.topicTitle || "—",
        discipline: r.discipline || "—",
        name: r.name || "—",
        grade: r.grade
      });
    }

    const items = [...byTopic.entries()].sort((a, b) =>
      a[1][0].topicTitle.localeCompare(b[1][0].topicTitle, "ru")
    );

    return h("div", { class: "list" }, items.map(([tid, data]) => h("div", { class: "list-row" },
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, data[0].topicTitle || `Тема ${tid}`)),
      h("div", { class: "list-row-sub" }, `${data.length} студентов`)),
      ...data.students.map(s => h("div", { class: "list-row" },
        h("div", { class: "list-row-sub" }, `${s.name}: ${formatGrade(s.grade)}`)))));
  }

  function renderPeriodView() {
    // Сортировка уже произведена при загрузке
    return h("div", { class: "list" }, state.rows.map((r, i) => h("div", { key: i, class: "list-row" },
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, r.date ? new Date(r.date).toLocaleDateString("ru-RU") : `—`),
        h("div", { class: "list-row-sub" }, `${r.name || "—"}: ${formatGrade(r.grade)}`)))));
  }
}