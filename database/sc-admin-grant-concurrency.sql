-- Staging hardening: serialize each member's complimentary grant transaction.
-- No existing rows modified; original access and audit records retained.
BEGIN;
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
 -- Prevent two simultaneous admin requests from granting overlapping access.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,0));
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

COMMIT;
