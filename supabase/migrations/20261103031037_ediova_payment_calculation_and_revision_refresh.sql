-- Match payment invoice performance to the existing workspace performance score.
CREATE OR REPLACE FUNCTION app_private.manager_payment_preview(p_manager_id uuid, p_month date)
RETURNS TABLE (
  manager_id uuid, manager_name text, month_start date, month_end date,
  completed_tasks integer, completed_hours numeric, delayed_tasks integer, performance_score integer,
  hourly_rate_usd numeric, late_deduction_usd numeric, gross_amount_usd numeric,
  deductions_usd numeric, net_amount_usd numeric, work_breakdown jsonb, delay_breakdown jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_role public.user_role;
  v_name text;
  v_start timestamptz;
  v_end timestamptz;
  v_completed_tasks integer := 0;
  v_completed_hours numeric(10,2) := 0;
  v_delayed_tasks integer := 0;
  v_score integer := 100;
  v_hourly_rate numeric(10,2) := 1;
  v_late_deduction numeric(10,2) := 1;
  v_gross numeric(12,2) := 0;
  v_deductions numeric(12,2) := 0;
  v_net numeric(12,2) := 0;
  v_work jsonb := '[]'::jsonb;
  v_delays jsonb := '[]'::jsonb;
BEGIN
  v_role := app_private.current_app_role();
  IF auth.uid() IS NULL OR v_role IS DISTINCT FROM 'manager'::public.user_role OR p_manager_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the signed-in manager can preview their own payment.';
  END IF;
  IF p_month IS NULL OR p_month <> date_trunc('month', p_month::timestamp)::date THEN
    RAISE EXCEPTION 'Choose a valid calendar month.';
  END IF;
  IF p_month <> (date_trunc('month', now() AT TIME ZONE 'Asia/Karachi') - interval '1 month')::date THEN
    RAISE EXCEPTION 'Payment requests are opened for the previous completed calendar month.';
  END IF;
  SELECT p.full_name INTO v_name
  FROM public.profiles p
  WHERE p.id = p_manager_id AND p.role = 'manager'::public.user_role;
  IF v_name IS NULL THEN RAISE EXCEPTION 'The manager profile could not be found.'; END IF;

  SELECT s.hourly_rate_usd, s.late_deduction_usd
  INTO v_hourly_rate, v_late_deduction
  FROM public.payment_settings s WHERE s.id = true;

  v_start := p_month::timestamp AT TIME ZONE 'Asia/Karachi';
  v_end := (p_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Karachi';

  SELECT count(t.id)::integer,
    coalesce(sum(coalesce(h.target_hours, 0)), 0)::numeric(10,2),
    coalesce(jsonb_agg(jsonb_build_object('task_id', t.id, 'title', t.title, 'completed_at', t.completed_at, 'hours', coalesce(h.target_hours, 0)) ORDER BY t.completed_at, t.title), '[]'::jsonb)
  INTO v_completed_tasks, v_completed_hours, v_work
  FROM public.tasks t LEFT JOIN public.task_hour_targets h ON h.task_id = t.id
  WHERE t.assignee_id = p_manager_id AND t.status = 'completed'::public.task_status
    AND t.completed_at >= v_start AND t.completed_at < v_end;

  SELECT count(t.id)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'task_id', t.id, 'title', t.title, 'deadline_at', t.deadline_at, 'completed_at', t.completed_at,
      'delay_hours', round((extract(epoch FROM (coalesce(t.completed_at, now()) - t.deadline_at)) / 3600.0)::numeric, 1)
    ) ORDER BY t.deadline_at, t.title), '[]'::jsonb)
  INTO v_delayed_tasks, v_delays
  FROM public.tasks t
  WHERE t.assignee_id = p_manager_id
    AND t.status NOT IN ('cancelled'::public.task_status, 'archived'::public.task_status)
    AND t.deadline_at >= v_start AND t.deadline_at < v_end
    AND ((t.status = 'completed'::public.task_status AND t.completed_at > t.deadline_at + interval '24 hours')
      OR (t.status IN ('pending'::public.task_status, 'in_progress'::public.task_status) AND now() > t.deadline_at + interval '24 hours'));

  SELECT score.performance_score INTO v_score
  FROM app_private.get_manager_performance() AS score
  WHERE score.manager_id = p_manager_id;
  v_score := coalesce(v_score, 100);

  v_gross := round(v_completed_hours * v_hourly_rate, 2);
  v_deductions := round(v_delayed_tasks * v_late_deduction, 2);
  v_net := greatest(0, v_gross - v_deductions);

  RETURN QUERY SELECT p_manager_id, v_name, p_month,
    (p_month + interval '1 month' - interval '1 day')::date,
    v_completed_tasks, v_completed_hours, v_delayed_tasks, v_score, v_hourly_rate,
    v_late_deduction, v_gross, v_deductions, v_net, v_work, v_delays;
END
$function$;

-- Recalculate the work snapshot after a requested correction, keeping this invoice's original rates.
CREATE OR REPLACE FUNCTION app_private.resubmit_manager_payment_request(
  p_request_id uuid, p_bank_name text, p_account_holder text, p_account_number text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE;
  v_calc record;
  v_bank text;
  v_holder text;
  v_account text;
  v_name text;
  v_gross numeric(12,2);
  v_deductions numeric(12,2);
  v_net numeric(12,2);
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can resubmit a payment request.';
  END IF;
  SELECT * INTO v_request FROM public.manager_payment_requests
  WHERE id = p_request_id AND manager_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'revision_requested' THEN
    RAISE EXCEPTION 'This payment request is not awaiting a revision.';
  END IF;

  v_bank := btrim(coalesce(p_bank_name, ''));
  v_holder := btrim(coalesce(p_account_holder, ''));
  v_account := btrim(coalesce(p_account_number, ''));
  IF char_length(v_bank) < 2 OR char_length(v_bank) > 120
    OR char_length(v_holder) < 2 OR char_length(v_holder) > 160
    OR char_length(v_account) < 4 OR char_length(v_account) > 80 THEN
    RAISE EXCEPTION 'Enter a valid bank name, account holder name, and account number.';
  END IF;

  SELECT * INTO v_calc FROM app_private.manager_payment_preview(auth.uid(), v_request.month_start);
  v_gross := round(v_calc.completed_hours * v_request.hourly_rate_usd, 2);
  v_deductions := round(v_calc.delayed_tasks * v_request.late_deduction_usd, 2);
  v_net := greatest(0, v_gross - v_deductions);

  INSERT INTO public.manager_bank_details (profile_id, bank_name, account_holder_name, account_number, updated_at)
  VALUES (auth.uid(), v_bank, v_holder, v_account, now())
  ON CONFLICT (profile_id) DO UPDATE SET bank_name = EXCLUDED.bank_name,
    account_holder_name = EXCLUDED.account_holder_name, account_number = EXCLUDED.account_number, updated_at = now();

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  UPDATE public.manager_payment_requests
  SET bank_name = v_bank, bank_account_holder = v_holder, bank_account_number = v_account,
    completed_tasks = v_calc.completed_tasks, completed_hours = v_calc.completed_hours,
    delayed_tasks = v_calc.delayed_tasks, performance_score = v_calc.performance_score,
    gross_amount_usd = v_gross, deductions_usd = v_deductions, net_amount_usd = v_net,
    work_breakdown = v_calc.work_breakdown, delay_breakdown = v_calc.delay_breakdown,
    status = 'requested', revision_note = NULL, dispute_note = NULL, requested_at = now(),
    reviewed_at = NULL, reviewed_by = NULL, updated_at = now()
  WHERE id = p_request_id AND manager_id = auth.uid();

  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), v_name, 'manager'::public.user_role, 'resubmitted',
    'Updated bank details and refreshed the monthly work snapshot before resubmission.');
END
$function$;

CREATE INDEX IF NOT EXISTS manager_payment_events_actor_idx
  ON public.manager_payment_request_events (actor_id);
CREATE INDEX IF NOT EXISTS manager_payment_requests_paid_by_idx
  ON public.manager_payment_requests (paid_by);
CREATE INDEX IF NOT EXISTS manager_payment_requests_reviewed_by_idx
  ON public.manager_payment_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS payment_settings_updated_by_idx
  ON public.payment_settings (updated_by);
