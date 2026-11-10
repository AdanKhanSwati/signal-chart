-- SignalChart Cloudflare/Supabase migration, phase 1.
-- New, isolated table; does not alter existing trial, paid-access or auth records.
-- The user_id is taken from a verified Supabase Auth session on the server.
CREATE TABLE IF NOT EXISTS public.sc_member_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 100),
  legacy_status text NOT NULL DEFAULT 'unreconciled'
    CHECK (legacy_status IN ('unreconciled', 'no_blob_history', 'reviewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Even when the PostgREST Data API exposes public, client roles cannot access
-- this table. Only trusted server code with the secret/service-role key may read
-- or create profiles. A profile alone NEVER grants access or trial eligibility.
ALTER TABLE public.sc_member_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sc_member_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sc_member_profiles TO service_role;
COMMENT ON TABLE public.sc_member_profiles IS
  'Server-only identity profiles. Legacy migration status is informational, never entitlement.';
