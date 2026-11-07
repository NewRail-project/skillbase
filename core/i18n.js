// core/i18n.js — централизованные словари терминологии для Education и Workforce.
import { getMode, MODES } from "./mode.js";

const DICTIONARY = {
  [MODES.EDUCATION]: {
    student: "студент",
    students: "студенты",
    studentGen: "студента",
    studentsGen: "студентов",
    teacher: "преподаватель",
    teachers: "преподаватели",
    teacherGen: "преподавателя",
    teachersGen: "преподавателей",
    group: "группа",
    groups: "группы",
    test: "тест",
    tests: "тесты",
    testGen: "теста",
    testsGen: "тестов",
    assignment: "задание",
    assignments: "задания",
    material: "учебный материал",
    materials: "учебные материалы",
    catalog: "Каталог тестов",
    myAssignments: "Мои задания",
    deadline: "дедлайн",
    deadlines: "дедлайны"
  },
  [MODES.WORKFORCE]: {
    student: "сотрудник",
    students: "сотрудники",
    studentGen: "сотрудника",
    studentsGen: "сотрудников",
    teacher: "инструктор",
    teachers: "инструкторы",
    teacherGen: "инструктора",
    teachersGen: "инструкторов",
    group: "подразделение",
    groups: "подразделения",
    test: "проверка знаний",
    tests: "проверки знаний",
    testGen: "проверки знаний",
    testsGen: "проверок знаний",
    assignment: "программа обучения",
    assignments: "программы обучения",
    material: "регламент / материал",
    materials: "регламенты и материалы",
    catalog: "База проверок",
    myAssignments: "Назначенные программы",
    deadline: "срок выполнения",
    deadlines: "сроки выполнения"
  }
};

/**
 * Возвращает переведённый термин по ключу с учётом текущего режима.
 * @param {string} key Ключ термина
 * @param {string} [overrideMode] Явное указание режима (необязательно)
 * @returns {string}
 */
export function t(key, overrideMode) {
  const mode = overrideMode || getMode();
  const dict = DICTIONARY[mode] || DICTIONARY[MODES.EDUCATION];
  return dict[key] || DICTIONARY[MODES.EDUCATION][key] || key;
}
