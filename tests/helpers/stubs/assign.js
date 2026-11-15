export async function listAssignments(orgId) {
  const sb = globalThis.__SB;
  sb.calls.push(["listAssignments", orgId]);
  return sb.leak ? [...sb.assignments] : sb.assignments.filter(a => a.orgId === orgId);
}
