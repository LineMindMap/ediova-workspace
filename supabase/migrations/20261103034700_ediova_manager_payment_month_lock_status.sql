CREATE OR REPLACE FUNCTION app_private.manager_payment_month_claimed(p_month date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can check their monthly payment request status.';
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM app_private.manager_payment_month_claims
    WHERE manager_id = auth.uid()
      AND month_start = p_month
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.manager_payment_month_claimed(p_month date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.manager_payment_month_claimed(p_month);
$function$;

REVOKE ALL ON FUNCTION app_private.manager_payment_month_claimed(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.manager_payment_month_claimed(date) TO authenticated;
REVOKE ALL ON FUNCTION public.manager_payment_month_claimed(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_payment_month_claimed(date) TO authenticated;
