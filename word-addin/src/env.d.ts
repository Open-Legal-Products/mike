/// <reference types="office-js" />

/**
 * Ambient declaration for webpack EnvironmentPlugin substitutions.
 * These values are replaced at build time; runtime access is a no-op guard.
 */
declare const process: {
  readonly env: {
    readonly REACT_APP_API_BASE_URL: string | undefined;
    readonly REACT_APP_SUPABASE_URL: string | undefined;
    readonly REACT_APP_SUPABASE_ANON_KEY: string | undefined;
    readonly REACT_APP_DEFAULT_MODEL: string | undefined;
    readonly REACT_APP_WEB_APP_URL: string | undefined;
    readonly NODE_ENV: string;
  };
};
