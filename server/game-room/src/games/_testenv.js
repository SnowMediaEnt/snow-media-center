// Test-only env stub. Imported FIRST by videoPoker.test.js so that config.js
// (pulled in transitively by videoPoker.js) finds its required env vars at
// module-evaluation time. ESM evaluates imported modules in source order, so
// importing this before './videoPoker.js' guarantees the vars exist before
// config.js runs its requireEnv() checks. None of these reach a real service —
// the evaluator tests never touch Supabase.
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret';
