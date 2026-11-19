export const State = {
  get profile() { return globalThis.__SB.profile; },
  get user() { return { uid: globalThis.__SB.profile?.uid || "staff1" }; },
  get routeParam() { return globalThis.__SB.routeParam; }
};
export const isStaff = () => globalThis.__SB.staff !== false;
export const isAdmin = () => globalThis.__SB.profile?.role === "admin";
