export async function getSubjects() {
  const sb = globalThis.__SB;
  sb.calls.push(["getSubjects"]);
  return [...sb.subjects];
}
export async function getTopics(subjectId) {
  const sb = globalThis.__SB;
  sb.calls.push(["getTopics", subjectId]);
  return sb.topics.filter(t => t.subjectId === subjectId);
}
export async function deleteTopic(id, plan = {}) {
  const sb = globalThis.__SB;
  sb.calls.push(["deleteTopic", id, JSON.parse(JSON.stringify(plan))]);
}
export async function deleteSubject(id, plan = {}) {
  const sb = globalThis.__SB;
  sb.calls.push(["deleteSubject", id, JSON.parse(JSON.stringify(plan))]);
}
