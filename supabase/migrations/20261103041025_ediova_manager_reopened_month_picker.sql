
CREATE OR REPLACE FUNCTION app_private.get_my_reopened_payment_months()
RETURNS TABLE (month_start date, reopen_count integer, last_reopened_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can view their reopened payment months.';
  END IF;
  RETURN QUERY
  SELECT c.month_start, c.reopen_count, c.last_reopened_at
  FROM app_private.manager_payment_month_claims c
  WHERE c.manager_id = auth.uid()
    AND c.reopen_allowed = true
    AND NOT EXISTS (
      SELECT 1 FROM public.manager_payment_requests r
      WHERE r.manager_id = c.manager_id AND r.month_start = c.month_start
    )
  ORDER BY c.month_start DESC;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_my_reopened_payment_months()
RETURNS TABLE (month_start date, reopen_count integer, last_reopened_at timestamptz)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT * FROM app_private.get_my_reopened_payment_months();
$function$;

REVOKE ALL ON FUNCTION app_private.get_my_reopened_payment_months() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_my_reopened_payment_months() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_reopened_payment_months() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_reopened_payment_months() TO authenticated;

DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$
  IF p_month <> (date_trunc('month', now() AT TIME ZONE 'Asia/Karachi') - interval '1 month')::date
    AND NOT EXISTS (
      SELECT 1
      FROM public.manager_payment_requests r
      WHERE r.manager_id = p_manager_id
        AND r.month_start = p_month
        AND r.status = 'revision_requested'
    )
  THEN
$old$;
  v_new text := $new$
  IF p_month <> (date_trunc('month', now() AT TIME ZONE 'Asia/Karachi') - interval '1 month')::date
    AND NOT EXISTS (
      SELECT 1
      FROM public.manager_payment_requests r
      WHERE r.manager_id = p_manager_id
        AND r.month_start = p_month
        AND r.status = 'revision_requested'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM app_private.manager_payment_month_claims c
      WHERE c.manager_id = p_manager_id
        AND c.month_start = p_month
        AND c.reopen_allowed = true
    )
  THEN
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app_private'
    AND p.proname = 'manager_payment_preview'
    AND pg_get_function_identity_arguments(p.oid) = 'p_manager_id uuid, p_month date';

  IF v_definition IS NULL OR position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not find the expected monthly validation block in manager_payment_preview.';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END
$migration$;

