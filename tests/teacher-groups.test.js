// tests/teacher-groups.test.js
// Тесты для teacher-groups.

import { teacherCanSee } from '../firestore.rules';

// Тест: проверка ограничения teacher-groups.
function testTeacherCanSee() {
  const testData = {
    groupId: "group1",
    testAuthorId: "teacher1"
  };
  
  // Администратор видит всё.
  const adminCanSee = teacherCanSee(testData, { isAdmin: true });
  if (!adminCanSee) {
    throw new Error("Администратор не видит попытки.");
  }
  
  // Преподаватель видит попытки только для своих групп.
  const teacherCanSeeGroup = teacherCanSee(testData, {
    isStaff: true,
    me: {
      teacherGroups: ["group1", "group2"],
      keys: () => ({ hasAny: (keys) => keys.includes('teacherGroups') })
    }
  });
  if (!teacherCanSeeGroup) {
    throw new Error("Преподаватель не видит попытку для своей группы.");
  }
  
  // Преподаватель видит попытки только для своих групп.
  const teacherCanSeeOtherGroup = teacherCanSee(testData, {
    isStaff: true,
    me: {
      teacherGroups: ["group1", "group2"],
      keys: () => ({ hasAny: (keys) => keys.includes('teacherGroups') })
    }
  });
  if (teacherCanSeeOtherGroup) {
    throw new Error("Преподаватель видит попытку для другой группы.");
  }
  
  // Преподаватель видит попытки для своих авторских тестов.
  const teacherCanSeeOwnTest = teacherCanSee({
    groupId: "group1",
    testAuthorId: "teacher1"
  }, {
    isStaff: true,
    me: {
      teacherGroups: ["group1"],
      keys: () => ({ hasAny: (keys) => keys.includes('teacherGroups') })
    }
  });
  if (!teacherCanSeeOwnTest) {
    throw new Error("Преподаватель не видит попытку для своего теста.");
  }
}

// Запуск тестов.
if (typeof describe === "function") {
  describe("Тесты teacher-groups", () => {
    test("teacherCanSee", testTeacherCanSee);
  });
}