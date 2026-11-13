-- SignalChart private admin billing / complimentary membership staging foundations.
-- Additive only: existing paid access, trial, legacy records and owner untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS public.sc_payment_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 invoice_ref text NOT NULL CHECK (length(invoice_ref) BETWEEN 8 AND 120),
 network text NOT NULL DEFAULT 'bitcoin_mainnet' CHECK (network='bitcoin_mainnet'),
 txid text NOT NULL UNIQUE CHECK (txid ~ '^[a-f0-9]{64}$'),
 amount_sats bigint NOT NULL CHECK (amount_sats BETWEEN 1 AND 2100000000000000),
 receiving_wallet text NOT NULL CHECK (length(receiving_wallet) BETWEEN 26 AND 120),
 receipt_object text CHECK (receipt_object IS NULL OR length(receipt_object) BETWEEN 8 AND 200),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id,invoice_ref)
);
CREATE INDEX IF NOT EXISTS sc_payment_submissions_user_idx ON public.sc_payment_submissions(user_id,submitted_at DESC);
CREATE TABLE IF NOT EXISTS public.sc_payment_review_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL REFERENCES public.sc_payment_submissions(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('hold','reject')),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_payment_review_events_idx ON public.sc_payment_review_events(payment_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.sc_complimentary_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 starts_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>starts_at)
);
CREATE INDEX IF NOT EXISTS sc_complimentary_grants_user_idx ON public.sc_complimentary_grants(user_id,expires_at DESC);
CREATE TABLE IF NOT EXISTS public.sc_complimentary_revocations (
 grant_id uuid PRIMARY KEY REFERENCES public.sc_complimentary_grants(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sc_admin_action_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 target_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('payment_hold','payment_reject','grant_access','revoke_access')),
 reference_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_admin_action_events_actor_idx ON public.sc_admin_action_events(actor_id,created_at DESC);
-- All tables private: no anonymous or authenticated PostgREST access, and no
-- UPDATE or DELETE privileges on append-only evidence and audit tables.
ALTER TABLE public.sc_payment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sc_payment_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sc_complimentary_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sc_complimentary_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sc_admin_action_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sc_payment_submissions,public.sc_payment_review_events,
 public.sc_complimentary_grants,public.sc_complimentary_revocations,
 public.sc_admin_action_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.sc_payment_submissions,public.sc_payment_review_events,
 public.sc_complimentary_grants,public.sc_complimentary_revocations,
 public.sc_admin_action_events TO service_role;
-- Each SECURITY DEFINER function also independently checks the server-side owner.
CREATE OR REPLACE FUNCTION public.sc_check_private_admin(p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF p_actor IS NULL OR NOT EXISTS
  (SELECT 1 FROM public.sc_admin_owner o WHERE o.singleton=true AND o.user_id=p_actor)
 THEN RAISE EXCEPTION 'Administrator permission required' USING ERRCODE='42501'; END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_payment_queue(p_actor uuid, p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
  RAISE EXCEPTION 'Invalid page size' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result
 FROM (SELECT p.id AS "id",p.user_id AS "userId",coalesce(m.email,'') AS "email",
   p.invoice_ref AS "invoiceRef",p.txid AS "txid",p.network AS "network",
   p.amount_sats AS "amountSats",p.receiving_wallet AS "receivingWallet",
   p.submitted_at AS "submittedAt",e.action AS "lastReviewAction",
   e.reason AS "lastReviewReason",e.created_at AS "lastReviewedAt"
  FROM public.sc_payment_submissions p
  LEFT JOIN public.sc_member_profiles m ON m.user_id=p.user_id
  LEFT JOIN LATERAL (SELECT r.action,r.reason,r.created_at
   FROM public.sc_payment_review_events r WHERE r.payment_id=p.id
   ORDER BY r.created_at DESC,r.id DESC LIMIT 1) e ON true
  ORDER BY p.submitted_at DESC,p.id DESC LIMIT p_limit) x;
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_payment_review(
 p_actor uuid,p_payment uuid,p_action text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE row_id uuid; owner_user uuid;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_action NOT IN ('hold','reject') OR p_action IS NULL
 THEN RAISE EXCEPTION 'Payment approval is not available without independently verified chain evidence'
  USING ERRCODE='22023'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
 THEN RAISE EXCEPTION 'Review reason must be 5–500 characters' USING ERRCODE='22023'; END IF;
 SELECT user_id INTO owner_user FROM public.sc_payment_submissions WHERE id=p_payment FOR UPDATE;
 IF owner_user IS NULL THEN RAISE EXCEPTION 'Payment not found' USING ERRCODE='P0002'; END IF;
 IF EXISTS (SELECT 1 FROM public.sc_payment_review_events
  WHERE payment_id=p_payment AND action='reject')
 THEN RAISE EXCEPTION 'Payment already rejected' USING ERRCODE='23505'; END IF;
 INSERT INTO public.sc_payment_review_events(payment_id,actor_id,action,reason)
 VALUES(p_payment,p_actor,p_action,btrim(p_reason)) RETURNING id INTO row_id;
 INSERT INTO public.sc_admin_action_events(actor_id,target_user_id,action,reference_id,reason)
 VALUES(p_actor,owner_user,CASE WHEN p_action='hold' THEN 'payment_hold' ELSE 'payment_reject' END,
 p_payment,btrim(p_reason));
 RETURN jsonb_build_object('recorded',true,'eventId',row_id,'action',p_action);
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_member_search(p_actor uuid,p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_query IS NULL OR length(btrim(p_query)) NOT BETWEEN 2 AND 100
 THEN RAISE EXCEPTION 'Search must be between 2 and 100 characters' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result
 FROM (SELECT m.user_id AS "userId",m.email AS "email",
  m.display_name AS "name",m.legacy_status AS "legacyStatus",m.created_at AS "joinedAt"
  FROM public.sc_member_profiles m
  WHERE m.email ILIKE '%'||replace(replace(btrim(p_query),'%','\%'),'_','\_')||'%' ESCAPE '\'
  OR m.user_id::text = btrim(p_query)
  ORDER BY m.created_at DESC LIMIT 25) q;
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_member_grants(p_actor uuid,p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_user IS NULL THEN RAISE EXCEPTION 'Member identifier required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result
 FROM (SELECT g.id AS "grantId",g.user_id AS "userId",g.expires_at AS "expiresAt",
   g.starts_at AS "startsAt",g.reason AS "reason",g.created_at AS "issuedAt",
   rv.created_at AS "revokedAt",rv.reason AS "revokeReason",
   (rv.grant_id IS NULL AND g.starts_at<=now() AND g.expires_at>now()) AS "active"
  FROM public.sc_complimentary_grants g
  LEFT JOIN public.sc_complimentary_revocations rv ON rv.grant_id=g.id
  WHERE g.user_id=p_user ORDER BY g.created_at DESC LIMIT 30) q;
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_access_grant(
 p_actor uuid,p_user uuid,p_expires timestamptz,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE grant_id uuid;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_user IS NULL OR p_user=p_actor OR NOT EXISTS
  (SELECT 1 FROM public.sc_member_profiles WHERE user_id=p_user)
 THEN RAISE EXCEPTION 'Registered member required' USING ERRCODE='22023'; END IF;
 IF p_expires IS NULL OR p_expires<=now()+interval '15 minutes'
   OR p_expires>now()+interval '90 days'
 THEN RAISE EXCEPTION 'Grant expiry must be between 15 minutes and 90 days from now'
  USING ERRCODE='22023'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
 THEN RAISE EXCEPTION 'A 5–500 character grant reason is required' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM public.sc_complimentary_grants g
  WHERE g.user_id=p_user AND g.starts_at<=now() AND g.expires_at>now()
    AND NOT EXISTS (SELECT 1 FROM public.sc_complimentary_revocations rv WHERE rv.grant_id=g.id))
 THEN RAISE EXCEPTION 'An active complimentary grant already exists' USING ERRCODE='23505'; END IF;
 INSERT INTO public.sc_complimentary_grants(user_id,issued_by,expires_at,reason)
 VALUES(p_user,p_actor,p_expires,btrim(p_reason)) RETURNING id INTO grant_id;
 INSERT INTO public.sc_admin_action_events(actor_id,target_user_id,action,reference_id,reason)
 VALUES(p_actor,p_user,'grant_access',grant_id,btrim(p_reason));
 RETURN jsonb_build_object('recorded',true,'grantId',grant_id,'userId',p_user,'expiresAt',p_expires);
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_access_revoke(
 p_actor uuid,p_grant uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE member uuid;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
 THEN RAISE EXCEPTION 'A 5–500 character revoke reason is required' USING ERRCODE='22023'; END IF;
 SELECT user_id INTO member FROM public.sc_complimentary_grants WHERE id=p_grant;
 IF member IS NULL THEN RAISE EXCEPTION 'Grant not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.sc_complimentary_revocations(grant_id,actor_id,reason)
 VALUES(p_grant,p_actor,btrim(p_reason));
 INSERT INTO public.sc_admin_action_events(actor_id,target_user_id,action,reference_id,reason)
 VALUES(p_actor,member,'revoke_access',p_grant,btrim(p_reason));
 RETURN jsonb_build_object('recorded',true,'grantId',p_grant,'revoked',true);
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_active_manual_grant(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object('grantId',g.id,'expiresAt',g.expires_at) INTO result
 FROM public.sc_complimentary_grants g
 WHERE g.user_id=p_user AND g.starts_at<=now() AND g.expires_at>now()
 AND NOT EXISTS (SELECT 1 FROM public.sc_complimentary_revocations rv WHERE rv.grant_id=g.id)
 ORDER BY g.expires_at DESC LIMIT 1;
 RETURN coalesce(result,'{}'::jsonb);
END $fn$;

-- Restrict direct calls to the service key. Worker independently verifies a
-- fresh Supabase JWT and queries the single-owner table before every admin RPC.
REVOKE ALL ON FUNCTION public.sc_check_private_admin(uuid),
 public.sc_admin_payment_queue(uuid,integer),public.sc_admin_payment_review(uuid,uuid,text,text),
 public.sc_admin_member_search(uuid,text),public.sc_admin_member_grants(uuid,uuid),
 public.sc_admin_access_grant(uuid,uuid,timestamptz,text),
 public.sc_admin_access_revoke(uuid,uuid,text),public.sc_active_manual_grant(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sc_check_private_admin(uuid),
 public.sc_admin_payment_queue(uuid,integer),public.sc_admin_payment_review(uuid,uuid,text,text),
 public.sc_admin_member_search(uuid,text),public.sc_admin_member_grants(uuid,uuid),
 public.sc_admin_access_grant(uuid,uuid,timestamptz,text),
 public.sc_admin_access_revoke(uuid,uuid,text),public.sc_active_manual_grant(uuid)
 TO service_role;
COMMIT;
