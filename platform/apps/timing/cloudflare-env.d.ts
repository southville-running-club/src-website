/**
 * The Worker's environment, as this application expects it.
 *
 * Written by hand rather than generated. It is two variables and it is not going to grow:
 * **if a third one appears here — and especially if it is a service role key — the
 * row-level security policy is wrong, and that is the thing to fix.**
 *
 * Both are safe to expose. Row-level security is what enforces access, not the key.
 */
declare global {
  interface CloudflareEnv {
    PUBLIC_SUPABASE_URL: string;
    PUBLIC_SUPABASE_ANON_KEY: string;
  }
}

export {};
