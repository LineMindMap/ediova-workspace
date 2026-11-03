ALTER TABLE public.manager_payment_requests
  ADD COLUMN IF NOT EXISTS vat_amount_usd numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS paid_currency text;

ALTER TABLE public.manager_payment_requests
  DROP CONSTRAINT IF EXISTS manager_payment_requests_vat_zero_check,
  ADD CONSTRAINT manager_payment_requests_vat_zero_check CHECK (vat_amount_usd = 0),
  DROP CONSTRAINT IF EXISTS manager_payment_requests_paid_amount_currency_check,
  ADD CONSTRAINT manager_payment_requests_paid_amount_currency_check CHECK (
    (paid_amount IS NULL AND paid_currency IS NULL)
    OR (paid_amount > 0 AND paid_currency IN ('USD', 'PKR'))
  );

CREATE UNIQUE INDEX IF NOT EXISTS manager_payment_requests_manager_month_uidx
  ON public.manager_payment_requests (manager_id, month_start);

CREATE TABLE IF NOT EXISTS app_private.manager_payment_month_claims (
  manager_id uuid NOT NULL,
  month_start date NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (manager_id, month_start)
);

INSERT INTO app_private.manager_payment_month_claims (manager_id, month_start, claimed_at)
SELECT manager_id, month_start, min(requested_at)
FROM public.manager_payment_requests
GROUP BY manager_id, month_start
ON CONFLICT (manager_id, month_start) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.create_manager_payment_request(
  p_month date, p_bank_name text, p_account_holder text, p_account_number text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_calc record;
  v_request_id uuid;
  v_invoice_number text;
  v_name text;
  v_bank text;
  v_holder text;
  v_account text;
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

  SELECT * INTO v_calc
  FROM app_private.manager_payment_preview(auth.uid(), p_month);

  -- Preserve the month claim even if a test invoice is deleted later.
  INSERT INTO app_private.manager_payment_month_claims (manager_id, month_start)
  VALUES (auth.uid(), p_month)
  ON CONFLICT (manager_id, month_start) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A payment request has already been submitted for this month. Open the existing payment record instead.';
  END IF;

  INSERT INTO public.manager_bank_details (profile_id, bank_name, account_holder_name, account_number, updated_at)
  VALUES (auth.uid(), v_bank, v_holder, v_account, now())
  ON CONFLICT (profile_id) DO UPDATE
    SET bank_name = EXCLUDED.bank_name,
        account_holder_name = EXCLUDED.account_holder_name,
        account_number = EXCLUDED.account_number,
        updated_at = now();

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  v_invoice_number := 'EDI-PAY-' || to_char(p_month, 'YYYYMM') || '-' ||
    lpad(nextval('app_private.payment_invoice_number_seq')::text, 5, '0');

  INSERT INTO public.manager_payment_requests (
    manager_id, manager_name_snapshot, month_start, invoice_number, status,
    completed_tasks, completed_hours, delayed_tasks, performance_score,
    hourly_rate_usd, late_deduction_usd, gross_amount_usd, deductions_usd, net_amount_usd,
    vat_amount_usd, bank_name, bank_account_holder, bank_account_number, work_breakdown, delay_breakdown
  )
  VALUES (
    auth.uid(), v_name, p_month, v_invoice_number, 'requested',
    v_calc.completed_tasks, v_calc.completed_hours, v_calc.delayed_tasks, v_calc.performance_score,
    v_calc.hourly_rate_usd, v_calc.late_deduction_usd, v_calc.gross_amount_usd, v_calc.deductions_usd, v_calc.net_amount_usd,
    0, v_bank, v_holder, v_account, v_calc.work_breakdown, v_calc.delay_breakdown
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (v_request_id, auth.uid(), v_name, 'manager'::public.user_role, 'requested',
    'Payment requested for ' || to_char(p_month, 'FMMonth YYYY') || '.');

  RETURN v_request_id;
END
$function$;

CREATE OR REPLACE FUNCTION app_private.review_manager_payment_request(
  p_request_id uuid, p_action text, p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_name text;
  v_role public.user_role;
  v_event text;
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can review payment requests.';
  END IF;

  SELECT * INTO v_request
  FROM public.manager_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found.'; END IF;

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  v_role := app_private.current_app_role();

  IF p_action = 'approve' AND v_request.status IN ('requested','disputed') THEN
    UPDATE public.manager_payment_requests
    SET status = 'approved', revision_note = NULL, reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
    WHERE id = p_request_id;
    v_event := 'approved';
    IF v_note = '' THEN v_note := 'Payment request approved.'; END IF;
  ELSIF p_action = 'request_revision' AND v_request.status IN ('requested','disputed','approved') THEN
    IF char_length(v_note) < 5 OR char_length(v_note) > 1200 THEN
      RAISE EXCEPTION 'Add a short note explaining the requested revision.';
    END IF;
    UPDATE public.manager_payment_requests
    SET status = 'revision_requested', revision_note = v_note, reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
    WHERE id = p_request_id;
    v_event := 'revision_requested';
  ELSIF p_action = 'mark_paid' THEN
    RAISE EXCEPTION 'Use the payment recording action and provide the actual amount and currency.';
  ELSE
    RAISE EXCEPTION 'That payment status change is not allowed.';
  END IF;

  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), v_name, v_role, v_event, nullif(v_note, ''));
END
$function$;

CREATE OR REPLACE FUNCTION app_private.mark_manager_payment_request_paid(
  p_request_id uuid, p_paid_amount numeric, p_paid_currency text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE;
  v_currency text := upper(btrim(coalesce(p_paid_currency, '')));
  v_name text;
  v_note text;
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can record a payment.';
  END IF;
  IF p_paid_amount IS NULL OR p_paid_amount <= 0 OR p_paid_amount > 9999999999.99
    OR p_paid_amount <> round(p_paid_amount, 2) THEN
    RAISE EXCEPTION 'Enter a valid actual payment amount with up to two decimal places.';
  END IF;
  IF v_currency NOT IN ('USD', 'PKR') THEN
    RAISE EXCEPTION 'Choose USD or PKR as the payment currency.';
  END IF;

  SELECT * INTO v_request
  FROM public.manager_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved invoice can be marked as paid.';
  END IF;

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  UPDATE public.manager_payment_requests
  SET status = 'paid', paid_amount = round(p_paid_amount, 2), paid_currency = v_currency,
      paid_at = now(), paid_by = auth.uid(), reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  WHERE id = p_request_id;

  v_note := 'Actual transfer recorded: ' || to_char(round(p_paid_amount, 2), 'FM9999999990.00') || ' ' || v_currency ||
    '. System-suggested invoice total: USD ' || to_char(v_request.net_amount_usd, 'FM9999999990.00') || '.';
  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), v_name, 'managing_director'::public.user_role, 'paid', v_note);
END
$function$;

CREATE OR REPLACE FUNCTION public.mark_manager_payment_request_paid(
  p_request_id uuid, p_paid_amount numeric, p_paid_currency text
)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.mark_manager_payment_request_paid(p_request_id, p_paid_amount, p_paid_currency);
$function$;

CREATE OR REPLACE FUNCTION app_private.delete_manager_payment_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can delete a payment invoice.';
  END IF;

  PERFORM 1 FROM public.manager_payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment invoice not found.'; END IF;

  DELETE FROM public.manager_payment_request_events WHERE request_id = p_request_id;
  DELETE FROM public.manager_payment_requests WHERE id = p_request_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.delete_manager_payment_request(p_request_id uuid)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.delete_manager_payment_request(p_request_id);
$function$;

REVOKE ALL ON FUNCTION app_private.mark_manager_payment_request_paid(uuid,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.delete_manager_payment_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.mark_manager_payment_request_paid(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.delete_manager_payment_request(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_manager_payment_request_paid(uuid,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_manager_payment_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_manager_payment_request_paid(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_manager_payment_request(uuid) TO authenticated;
