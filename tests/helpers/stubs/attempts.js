// Имитация Firestore: where("orgId" == orgId). При __SB.leak=true отдаёт
// вообще все попытки — проверка, что страница сама не смешивает организации.
export async function listOrgAttempts(orgId) {
  const sb = globalThis.__SB;
  sb.calls.push(["listOrgAttempts", orgId]);
  return sb.leak ? [...sb.attempts] : sb.attempts.filter(a => a.orgId === orgId);
}
