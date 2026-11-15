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
