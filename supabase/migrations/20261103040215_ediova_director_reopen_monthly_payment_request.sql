ALTER TABLE app_private.manager_payment_month_claims
  ADD COLUMN IF NOT EXISTS reopen_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reopened_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;

ALTER TABLE app_private.manager_payment_month_claims
  DROP CONSTRAINT IF EXISTS manager_payment_month_claims_reopen_count_check,
  ADD CONSTRAINT manager_payment_month_claims_reopen_count_check CHECK (reopen_count >= 0);

CREATE OR REPLACE FUNCTION app_private.manager_payment_month_claimed(p_month date)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can check their monthly payment request status.';
  END IF;
  RETURN EXISTS (SELECT 1 FROM app_private.manager_payment_month_claims
    WHERE manager_id = auth.uid() AND month_start = p_month AND reopen_allowed = false);
END
$function$;

CREATE OR REPLACE FUNCTION app_private.manager_payment_month_reopen_available(p_month date)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can check their monthly payment request status.';
  END IF;
  RETURN EXISTS (SELECT 1 FROM app_private.manager_payment_month_claims
    WHERE manager_id = auth.uid() AND month_start = p_month AND reopen_allowed = true);
END
$function$;

CREATE OR REPLACE FUNCTION public.manager_payment_month_reopen_available(p_month date)
RETURNS boolean LANGUAGE sql STABLE
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.manager_payment_month_reopen_available(p_month);
$function$;

CREATE OR REPLACE FUNCTION app_private.get_manager_payment_month_reopen_options()
RETURNS TABLE (
  manager_id uuid, manager_name text, month_start date, claimed_at timestamptz,
  reopen_allowed boolean, reopen_count integer, last_reopened_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can view locked payment months.';
  END IF;
  RETURN QUERY
  SELECT c.manager_id, p.full_name::text, c.month_start, c.claimed_at,
         c.reopen_allowed, c.reopen_count, c.last_reopened_at
  FROM app_private.manager_payment_month_claims c
  JOIN public.profiles p ON p.id = c.manager_id
  WHERE NOT EXISTS (SELECT 1 FROM public.manager_payment_requests r
    WHERE r.manager_id = c.manager_id AND r.month_start = c.month_start)
  ORDER BY c.month_start DESC, p.full_name ASC;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_manager_payment_month_reopen_options()
RETURNS TABLE (
  manager_id uuid, manager_name text, month_start date, claimed_at timestamptz,
  reopen_allowed boolean, reopen_count integer, last_reopened_at timestamptz
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT * FROM app_private.get_manager_payment_month_reopen_options();
$function$;

CREATE OR REPLACE FUNCTION app_private.reopen_manager_payment_month(p_manager_id uuid, p_month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE v_name text;
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can reopen a monthly payment request.';
  END IF;
  IF p_manager_id IS NULL OR p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Choose a valid Manager and the first day of the month.';
  END IF;
  PERFORM 1 FROM app_private.manager_payment_month_claims c
    WHERE c.manager_id = p_manager_id AND c.month_start = p_month FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No previously submitted payment request exists for that Manager and month.'; END IF;
  IF EXISTS (SELECT 1 FROM public.manager_payment_requests r
    WHERE r.manager_id = p_manager_id AND r.month_start = p_month) THEN
    RAISE EXCEPTION 'An invoice already exists for that month. Delete the old invoice before allowing a replacement request.';
  END IF;
  IF EXISTS (SELECT 1 FROM app_private.manager_payment_month_claims c
    WHERE c.manager_id = p_manager_id AND c.month_start = p_month AND c.reopen_allowed = true) THEN
    RAISE EXCEPTION 'A replacement request is already open for that month.';
  END IF;
  SELECT p.full_name INTO v_name FROM public.profiles p
    WHERE p.id = p_manager_id AND p.role = 'manager'::public.user_role;
  IF v_name IS NULL THEN RAISE EXCEPTION 'The selected profile is not an active Manager.'; END IF;
  UPDATE app_private.manager_payment_month_claims
  SET reopen_allowed = true, last_reopened_at = now(),
      last_reopened_by = auth.uid(), reopen_count = reopen_count + 1
  WHERE manager_id = p_manager_id AND month_start = p_month;
END
$function$;

CREATE OR REPLACE FUNCTION public.reopen_manager_payment_month(p_manager_id uuid, p_month date)
RETURNS void LANGUAGE sql
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.reopen_manager_payment_month(p_manager_id, p_month);
$function$;

CREATE OR REPLACE FUNCTION app_private.create_manager_payment_request(
  p_month date, p_bank_name text, p_account_holder text, p_account_number text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_calc record; v_request_id uuid; v_invoice_number text; v_name text;
  v_bank text; v_holder text; v_account text; v_month_claim boolean;
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can submit a payment request.';
  END IF;
  v_bank := btrim(coalesce(p_bank_name, ''));
  v_holder := btrim(coalesce(p_account_holder, ''));
  v_account := btrim(coalesce(p_account_number, ''));
  IF char_length(v_bank) < 2 OR char_length(v_bank) > 120
    OR char_length(v_holder) < 2 OR char_length(v_holder) > 160
    OR char_length(v_account) < 4 OR char_length(v_account) > 80 THEN
    RAISE EXCEPTION 'Enter a valid bank name, account holder name, and account number.';
  END IF;
  SELECT * INTO v_calc FROM app_private.manager_payment_preview(auth.uid(), p_month);
  INSERT INTO app_private.manager_payment_month_claims (manager_id, month_start)
  VALUES (auth.uid(), p_month)
  ON CONFLICT (manager_id, month_start) DO UPDATE
    SET reopen_allowed = false
    WHERE app_private.manager_payment_month_claims.reopen_allowed = true
  RETURNING true INTO v_month_claim;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A payment request has already been submitted for this month. The Managing Director must reopen the month before another request can be submitted.';
  END IF;
  INSERT INTO public.manager_bank_details (profile_id, bank_name, account_holder_name, account_number, updated_at)
  VALUES (auth.uid(), v_bank, v_holder, v_account, now())
  ON CONFLICT (profile_id) DO UPDATE SET bank_name = EXCLUDED.bank_name,
    account_holder_name = EXCLUDED.account_holder_name, account_number = EXCLUDED.account_number, updated_at = now();
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  v_invoice_number := 'EDI-PAY-' || to_char(p_month, 'YYYYMM') || '-' ||
    lpad(nextval('app_private.payment_invoice_number_seq')::text, 5, '0');
  INSERT INTO public.manager_payment_requests (
    manager_id, manager_name_snapshot, month_start, invoice_number, status,
    completed_tasks, completed_hours, delayed_tasks, performance_score,
    hourly_rate_usd, late_deduction_usd, gross_amount_usd, deductions_usd, net_amount_usd,
    vat_amount_usd, bank_name, bank_account_holder, bank_account_number, work_breakdown, delay_breakdown
  ) VALUES (
    auth.uid(), v_name, p_month, v_invoice_number, 'requested',
    v_calc.completed_tasks, v_calc.completed_hours, v_calc.delayed_tasks, v_calc.performance_score,
    v_calc.hourly_rate_usd, v_calc.late_deduction_usd, v_calc.gross_amount_usd, v_calc.deductions_usd, v_calc.net_amount_usd,
    0, v_bank, v_holder, v_account, v_calc.work_breakdown, v_calc.delay_breakdown
  ) RETURNING id INTO v_request_id;
  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (v_request_id, auth.uid(), v_name, 'manager'::public.user_role, 'requested',
    'Payment requested for ' || to_char(p_month, 'FMMonth YYYY') || '.');
  RETURN v_request_id;
END
$function$;

REVOKE ALL ON FUNCTION app_private.manager_payment_month_reopen_available(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.get_manager_payment_month_reopen_options() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.reopen_manager_payment_month(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.manager_payment_month_reopen_available(date) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_manager_payment_month_reopen_options() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.reopen_manager_payment_month(uuid,date) TO authenticated;

REVOKE ALL ON FUNCTION public.manager_payment_month_reopen_available(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_manager_payment_month_reopen_options() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_manager_payment_month(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_payment_month_reopen_available(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_manager_payment_month_reopen_options() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_manager_payment_month(uuid,date) TO authenticated;

