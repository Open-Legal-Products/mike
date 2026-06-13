/**
 * Local auth stub — Supabase is not used in the local / OSS setup.
 *
 * Authentication is disabled: the whole app runs as a single hardcoded local
 * user, with no login screen and no external auth service. To avoid touching
 * the many components that import `supabase`, we expose an object with the
 * same shape that always resolves to that local user and a dummy session.
 *
 * The backend ignores the bearer token entirely (see backend auth middleware),
 * so the token value here is cosmetic.
 */

const LOCAL_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "local@localhost",
  new_email: null as string | null,
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date(0).toISOString(),
};

const LOCAL_SESSION = {
  access_token: "local-dev-token",
  refresh_token: "local-dev-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: LOCAL_USER,
};

const ok = <T>(data: T) => Promise.resolve({ data, error: null });

const mfa = {
  getAuthenticatorAssuranceLevel: async () =>
    ok({ currentLevel: "aal1", nextLevel: "aal1" }),
  listFactors: async () => ok({ totp: [], phone: [], all: [] }),
  challenge: async () => ok({ id: "local", type: "totp" }),
  verify: async () => ok({ ...LOCAL_SESSION }),
  challengeAndVerify: async () => ok({ ...LOCAL_SESSION }),
  enroll: async () =>
    ok({
      id: "local",
      type: "totp",
      totp: { qr_code: "", secret: "", uri: "" },
    }),
  unenroll: async () => ok({}),
};

const auth = {
  getSession: async () => ok({ session: LOCAL_SESSION }),
  getUser: async () => ok({ user: LOCAL_USER }),
  onAuthStateChange: (
    callback: (event: string, session: typeof LOCAL_SESSION | null) => void,
  ) => {
    // Fire once so listeners immediately see the local session.
    Promise.resolve().then(() => callback("SIGNED_IN", LOCAL_SESSION));
    return {
      data: {
        subscription: {
          id: "local",
          callback,
          unsubscribe() {},
        },
      },
    };
  },
  signInWithPassword: async () =>
    ok({ session: LOCAL_SESSION, user: LOCAL_USER }),
  signUp: async () => ok({ session: LOCAL_SESSION, user: LOCAL_USER }),
  signOut: async () => ({ error: null }),
  updateUser: async (attributes: { email?: string }) =>
    ok({
      user: { ...LOCAL_USER, email: attributes?.email ?? LOCAL_USER.email },
    }),
  mfa,
};

// Typed as `any` so the many call sites that destructure provider-specific
// response shapes keep compiling against this stub.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = { auth };
