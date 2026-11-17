// Имитация Firestore: where("orgId" == orgId). При __SB.leak=true отдаёт
// вообще все попытки — проверка, что страница сама не смешивает организации.
export async function listOrgAttempts(orgId) {
  const sb = globalThis.__SB;
  sb.calls.push(["listOrgAttempts", orgId]);
  return sb.leak ? [...sb.attempts] : sb.attempts.filter(a => a.orgId === orgId);
}

// Подписка: как onSnapshot — данные приходят асинхронно, возвращается отписка.
export function subscribeOrgAttempts(orgId, { onAttempts } = {}) {
  const sb = globalThis.__SB;
  sb.calls.push(["subscribeOrgAttempts", orgId]);
  let active = true;
  queueMicrotask(() => {
    if (active) onAttempts?.(sb.leak ? [...sb.attempts] : sb.attempts.filter(a => a.orgId === orgId));
  });
  return () => { active = false; sb.unsubscribed = (sb.unsubscribed || 0) + 1; };
}
