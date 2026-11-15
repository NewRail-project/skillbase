export const State = {
  get profile() { return globalThis.__SB.profile; },
  get user() { return { uid: globalThis.__SB.profile?.uid || "staff1" }; }
};
export const isStaff = () => globalThis.__SB.staff !== false;
