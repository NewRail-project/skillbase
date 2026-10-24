export async function initAuth() {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    onAuthStateChanged(auth, async (user) => {
      State.user = user;

      if (!user) {
        loadToken++;
        State.profile = null;
        State.profileStatus = "signed-out";
        State.profileError = null;
        applyTheme(DEFAULT_UI);
        State.initialProfileLoad = false;
        if (!resolved) notify();
        finish(null);
        return;
      }

      State.initialProfileLoad = true;
      try {
        await loadProfile(user);
        if (!resolved) finish(user);
      } catch (e) {
        if (!resolved) finish(null);
      }
      State.initialProfileLoad = false;
      if (!resolved) notify();
    });
  });
}
