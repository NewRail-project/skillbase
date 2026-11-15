export async function listOrgUsers(orgId) {
  const sb = globalThis.__SB;
  sb.calls.push(["listOrgUsers", orgId]);
  return sb.leak ? [...sb.users] : sb.users.filter(u => u.orgId === orgId);
}
