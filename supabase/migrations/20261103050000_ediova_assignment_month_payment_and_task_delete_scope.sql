-- Attribute completed work to the month the task was assigned/released (schedule_at),
-- preserve linked recurrence occurrences when a single task is removed, and require
-- explicit opt-out for every unfinished task before a monthly payment request is accepted.

ALTER TABLE public.manager_payment_requests
  ADD COLUMN IF NOT EXISTS unfinished_tasks_count integer NOT NULL DEFAULT 0
    CHECK (unfinished_tasks_count >= 0),
  ADD COLUMN IF NOT EXISTS unfinished_deduction_usd numeric(10,2) NOT NULL DEFAULT 0
    CHECK (unfinished_deduction_usd >= 0),
  ADD COLUMN IF NOT EXISTS unfinished_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(unfinished_breakdown) = 'array');

-- Monthly credited hours follow the assigned month, not the month when the task
-- happens to be marked complete.
CREATE OR REPLACE FUNCTION app_private.get_manager_monthly_performance(p_month date)
RETURNS TABLE(
  manager_id uuid,
  manager_name text,
  location text,
  month_start date,
  completed_tasks integer,
  completed_hours numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  caller_role public.user_role;
  month_begin timestamptz;
  month_end timestamptz;
  selected_month date;
BEGIN
  caller_role := app_private.current_app_role();
  IF auth.uid() IS NULL OR caller_role IS NULL OR p_month IS NULL THEN
    RETURN;
  END IF;

  selected_month := date_trunc('month', p_month::timestamp)::date;
  month_begin := selected_month::timestamp AT TIME ZONE 'Asia/Karachi';
  month_end := (selected_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Karachi';

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.location,
    selected_month,
    count(t.id)::integer,
    coalesce(sum(h.target_hours), 0)::numeric(9,2)
  FROM public.profiles p
  LEFT JOIN public.tasks t
    ON t.assignee_id = p.id
    AND t.status = 'completed'::public.task_status
    AND t.schedule_at >= month_begin
    AND t.schedule_at < month_end
  LEFT JOIN public.task_hour_targets h ON h.task_id = t.id
  WHERE p.role = 'manager'::public.user_role
    AND (caller_role = 'managing_director'::public.user_role OR p.id = auth.uid())
  GROUP BY p.id, p.full_name, p.location;
END
$function$;

-- Deleting one occurrence must not cascade to its siblings. Deleting the full
-- series deliberately removes its source and all currently generated occurrences.
CREATE OR REPLACE FUNCTION app_private.delete_task_with_scope(
  p_task_id uuid,
  p_delete_linked boolean
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_root_id uuid;
  v_deleted_ids uuid[];
BEGIN
  IF auth.uid() IS NULL
    OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can delete tasks.';
  END IF;
  IF p_task_id IS NULL OR p_delete_linked IS NULL THEN
    RAISE EXCEPTION 'Choose a task and a deletion scope.';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected task no longer exists.';
  END IF;

  v_root_id := coalesce(v_task.recurrence_parent_id, v_task.id);
  PERFORM 1
  FROM public.tasks t
  WHERE t.id = v_root_id OR t.recurrence_parent_id = v_root_id
  FOR UPDATE;

  SELECT coalesce(array_agg(t.id ORDER BY t.schedule_at, t.id), ARRAY[]::uuid[])
  INTO v_deleted_ids
  FROM public.tasks t
  WHERE t.id = v_root_id OR t.recurrence_parent_id = v_root_id;

  IF p_delete_linked THEN
    DELETE FROM public.tasks WHERE id = v_root_id;
    RETURN v_deleted_ids;
  END IF;

  IF v_task.id = v_root_id THEN
    UPDATE public.tasks
    SET recurrence_parent_id = NULL
    WHERE recurrence_parent_id = v_root_id;
  END IF;

  DELETE FROM public.tasks WHERE id = v_task.id;
  RETURN ARRAY[v_task.id];
END
$function$;

REVOKE ALL ON FUNCTION app_private.delete_task_with_scope(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.delete_task_with_scope(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_ediova_task(
  p_task_id uuid,
  p_delete_linked boolean
)
RETURNS uuid[]
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.delete_task_with_scope(p_task_id, p_delete_linked);
$function$;

REVOKE ALL ON FUNCTION public.delete_ediova_task(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_ediova_task(uuid, boolean) TO authenticated;

-- A dedicated v2 preview exposes the unfinished-task list required by the
-- payment dialog. Every task is attributed by schedule_at in Karachi time.
CREATE OR REPLACE FUNCTION app_private.manager_payment_preview_v2(
  p_manager_id uuid,
  p_month date
)
RETURNS TABLE (
  manager_id uuid,
  manager_name text,
  month_start date,
  month_end date,
  completed_tasks integer,
  completed_hours numeric,
  delayed_tasks integer,
  performance_score integer,
  hourly_rate_usd numeric,
  late_deduction_usd numeric,
  gross_amount_usd numeric,
  deductions_usd numeric,
  net_amount_usd numeric,
  work_breakdown jsonb,
  delay_breakdown jsonb,
  unfinished_tasks integer,
  unfinished_deduction_usd numeric,
  unfinished_breakdown jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  v_unfinished_tasks integer := 0;
  v_score integer := 100;
  v_hourly_rate numeric(10,2) := 1;
  v_late_deduction numeric(10,2) := 1;
  v_gross numeric(12,2) := 0;
  v_deductions numeric(12,2) := 0;
  v_unfinished_deduction numeric(12,2) := 0;
  v_net numeric(12,2) := 0;
  v_work jsonb := '[]'::jsonb;
  v_delays jsonb := '[]'::jsonb;
  v_unfinished jsonb := '[]'::jsonb;
BEGIN
  v_role := app_private.current_app_role();
  IF auth.uid() IS NULL OR v_role IS DISTINCT FROM 'manager'::public.user_role
    OR p_manager_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the signed-in Manager can preview their own payment.';
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
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'The Manager profile could not be found.';
  END IF;

  SELECT s.hourly_rate_usd, s.late_deduction_usd
  INTO v_hourly_rate, v_late_deduction
  FROM public.payment_settings s
  WHERE s.id = true;

  v_start := p_month::timestamp AT TIME ZONE 'Asia/Karachi';
  v_end := (p_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Karachi';

  SELECT
    count(t.id)::integer,
    coalesce(sum(coalesce(h.target_hours, 0)), 0)::numeric(10,2),
    coalesce(jsonb_agg(jsonb_build_object(
      'task_id', t.id,
      'title', t.title,
      'completed_at', t.completed_at,
      'schedule_at', t.schedule_at,
      'hours', coalesce(h.target_hours, 0)
    ) ORDER BY t.completed_at, t.title), '[]'::jsonb)
  INTO v_completed_tasks, v_completed_hours, v_work
  FROM public.tasks t
  LEFT JOIN public.task_hour_targets h ON h.task_id = t.id
  WHERE t.assignee_id = p_manager_id
    AND t.status = 'completed'::public.task_status
    AND t.schedule_at >= v_start
    AND t.schedule_at < v_end;

  SELECT
    count(t.id)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'task_id', t.id,
      'title', t.title,
      'deadline_at', t.deadline_at,
      'completed_at', t.completed_at,
      'delay_hours', round((extract(epoch FROM (coalesce(t.completed_at, now()) - t.deadline_at)) / 3600.0)::numeric, 1)
    ) ORDER BY t.deadline_at, t.title), '[]'::jsonb)
  INTO v_delayed_tasks, v_delays
  FROM public.tasks t
  WHERE t.assignee_id = p_manager_id
    AND t.status NOT IN ('cancelled'::public.task_status, 'archived'::public.task_status)
    AND t.schedule_at >= v_start
    AND t.schedule_at < v_end
    AND (
      (t.status = 'completed'::public.task_status AND t.completed_at > t.deadline_at + interval '24 hours')
      OR (t.status IN ('pending'::public.task_status, 'in_progress'::public.task_status)
        AND now() > t.deadline_at + interval '24 hours')
    );

  SELECT
    count(t.id)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'task_id', t.id,
      'title', t.title,
      'status', t.status,
      'schedule_at', t.schedule_at,
      'deadline_at', t.deadline_at
    ) ORDER BY t.deadline_at, t.title), '[]'::jsonb)
  INTO v_unfinished_tasks, v_unfinished
  FROM public.tasks t
  WHERE t.assignee_id = p_manager_id
    AND t.status IN ('pending'::public.task_status, 'in_progress'::public.task_status)
    AND t.schedule_at >= v_start
    AND t.schedule_at < v_end;

  SELECT score.performance_score INTO v_score
  FROM app_private.get_manager_performance() AS score
  WHERE score.manager_id = p_manager_id;
  v_score := coalesce(v_score, 100);

  v_gross := round(v_completed_hours * v_hourly_rate, 2);
  v_deductions := round(v_delayed_tasks * v_late_deduction, 2);
  v_unfinished_deduction := round(v_unfinished_tasks * 1.00, 2);
  v_net := greatest(0, v_gross - v_deductions);

  RETURN QUERY SELECT
    p_manager_id,
    v_name,
    p_month,
    (p_month + interval '1 month' - interval '1 day')::date,
    v_completed_tasks,
    v_completed_hours,
    v_delayed_tasks,
    v_score,
    v_hourly_rate,
    v_late_deduction,
    v_gross,
    v_deductions,
    v_net,
    v_work,
    v_delays,
    v_unfinished_tasks,
    v_unfinished_deduction,
    v_unfinished;
END
$function$;

REVOKE ALL ON FUNCTION app_private.manager_payment_preview_v2(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.manager_payment_preview_v2(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_manager_payment_preview_v2(p_month date)
RETURNS TABLE (
  manager_id uuid,
  manager_name text,
  month_start date,
  month_end date,
  completed_tasks integer,
  completed_hours numeric,
  delayed_tasks integer,
  performance_score integer,
  hourly_rate_usd numeric,
  late_deduction_usd numeric,
  gross_amount_usd numeric,
  deductions_usd numeric,
  net_amount_usd numeric,
  work_breakdown jsonb,
  delay_breakdown jsonb,
  unfinished_tasks integer,
  unfinished_deduction_usd numeric,
  unfinished_breakdown jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT * FROM app_private.manager_payment_preview_v2(auth.uid(), p_month);
$function$;

REVOKE ALL ON FUNCTION public.get_manager_payment_preview_v2(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_payment_preview_v2(date) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.create_manager_payment_request_v2(
  p_month date,
  p_bank_name text,
  p_account_holder text,
  p_account_number text,
  p_opted_out_task_ids uuid[]
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
  v_opted_out_ids uuid[] := coalesce(p_opted_out_task_ids, ARRAY[]::uuid[]);
  v_matching_ids integer := 0;
  v_unfinished_deduction numeric(12,2);
  v_late_deduction_total numeric(12,2);
  v_total_deductions numeric(12,2);
  v_net numeric(12,2);
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
  FROM app_private.manager_payment_preview_v2(auth.uid(), p_month);

  IF cardinality(v_opted_out_ids) <> coalesce(v_calc.unfinished_tasks, 0) THEN
    RAISE EXCEPTION 'Complete every task assigned in this month, or explicitly opt out of every unfinished task in the payment dialog.';
  END IF;

  SELECT count(t.id)::integer INTO v_matching_ids
  FROM public.tasks t
  WHERE t.id = ANY(v_opted_out_ids)
    AND t.assignee_id = auth.uid()
    AND t.status IN ('pending'::public.task_status, 'in_progress'::public.task_status)
    AND t.schedule_at >= (p_month::timestamp AT TIME ZONE 'Asia/Karachi')
    AND t.schedule_at < ((p_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Karachi');

  IF v_matching_ids <> coalesce(v_calc.unfinished_tasks, 0) THEN
    RAISE EXCEPTION 'The unfinished task list changed. Refresh the payment preview and confirm each remaining task again.';
  END IF;

  -- Lock the monthly claim before writing the immutable request snapshot.
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

  v_unfinished_deduction := round(coalesce(v_calc.unfinished_tasks, 0) * 1.00, 2);
  v_late_deduction_total := round(v_calc.delayed_tasks * v_calc.late_deduction_usd, 2);
  v_total_deductions := round(v_late_deduction_total + v_unfinished_deduction, 2);
  v_net := greatest(0, round(v_calc.gross_amount_usd - v_total_deductions, 2));

  INSERT INTO public.manager_payment_requests (
    manager_id, manager_name_snapshot, month_start, invoice_number, status,
    completed_tasks, completed_hours, delayed_tasks, performance_score,
    hourly_rate_usd, late_deduction_usd, gross_amount_usd, deductions_usd, net_amount_usd,
    vat_amount_usd, bank_name, bank_account_holder, bank_account_number,
    work_breakdown, delay_breakdown,
    unfinished_tasks_count, unfinished_deduction_usd, unfinished_breakdown
  )
  VALUES (
    auth.uid(), v_name, p_month, v_invoice_number, 'requested',
    v_calc.completed_tasks, v_calc.completed_hours, v_calc.delayed_tasks, v_calc.performance_score,
    v_calc.hourly_rate_usd, v_calc.late_deduction_usd, v_calc.gross_amount_usd, v_total_deductions, v_net,
    0, v_bank, v_holder, v_account,
    v_calc.work_breakdown, v_calc.delay_breakdown,
    v_calc.unfinished_tasks, v_unfinished_deduction, v_calc.unfinished_breakdown
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.manager_payment_request_events
    (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (
    v_request_id,
    auth.uid(),
    v_name,
    'manager'::public.user_role,
    'requested',
    'Payment requested for ' || to_char(p_month, 'FMMonth YYYY') ||
      '. Unfinished tasks opted out: ' || v_calc.unfinished_tasks ||
      '. Fixed opt-out deduction: USD ' || to_char(v_unfinished_deduction, 'FM9999999990.00') || '.'
  );

  RETURN v_request_id;
END
$function$;

REVOKE ALL ON FUNCTION app_private.create_manager_payment_request_v2(date, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.create_manager_payment_request_v2(date, text, text, text, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_manager_payment_request_v2(
  p_month date,
  p_bank_name text,
  p_account_holder text,
  p_account_number text,
  p_opted_out_task_ids uuid[]
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.create_manager_payment_request_v2(
    p_month, p_bank_name, p_account_holder, p_account_number, p_opted_out_task_ids
  );
$function$;

REVOKE ALL ON FUNCTION public.create_manager_payment_request_v2(date, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manager_payment_request_v2(date, text, text, text, uuid[]) TO authenticated;

-- Keep the old RPC name safe for already-open sessions using an older client.
-- It can still submit completed months, but cannot bypass unfinished-task opt-out.
CREATE OR REPLACE FUNCTION app_private.create_manager_payment_request(
  p_month date,
  p_bank_name text,
  p_account_holder text,
  p_account_number text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
  SELECT app_private.create_manager_payment_request_v2(
    p_month, p_bank_name, p_account_holder, p_account_number, ARRAY[]::uuid[]
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.resubmit_manager_payment_request_v2(
  p_request_id uuid,
  p_bank_name text,
  p_account_holder text,
  p_account_number text,
  p_opted_out_task_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE;
  v_calc record;
  v_bank text;
  v_holder text;
  v_account text;
  v_name text;
  v_opted_out_ids uuid[] := coalesce(p_opted_out_task_ids, ARRAY[]::uuid[]);
  v_matching_ids integer := 0;
  v_gross numeric(12,2);
  v_late_deduction numeric(12,2);
  v_unfinished_deduction numeric(12,2);
  v_total_deductions numeric(12,2);
  v_net numeric(12,2);
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can resubmit a payment request.';
  END IF;

  SELECT * INTO v_request
  FROM public.manager_payment_requests
  WHERE id = p_request_id AND manager_id = auth.uid()
  FOR UPDATE;
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

  SELECT * INTO v_calc
  FROM app_private.manager_payment_preview_v2(auth.uid(), v_request.month_start);

  IF cardinality(v_opted_out_ids) <> coalesce(v_calc.unfinished_tasks, 0) THEN
    RAISE EXCEPTION 'Complete every task assigned in this month, or explicitly opt out of every unfinished task in the payment dialog.';
  END IF;

  SELECT count(t.id)::integer INTO v_matching_ids
  FROM public.tasks t
  WHERE t.id = ANY(v_opted_out_ids)
    AND t.assignee_id = auth.uid()
    AND t.status IN ('pending'::public.task_status, 'in_progress'::public.task_status)
    AND t.schedule_at >= (v_request.month_start::timestamp AT TIME ZONE 'Asia/Karachi')
    AND t.schedule_at < ((v_request.month_start + interval '1 month')::timestamp AT TIME ZONE 'Asia/Karachi');

  IF v_matching_ids <> coalesce(v_calc.unfinished_tasks, 0) THEN
    RAISE EXCEPTION 'The unfinished task list changed. Refresh the payment preview and confirm each remaining task again.';
  END IF;

  INSERT INTO public.manager_bank_details (profile_id, bank_name, account_holder_name, account_number, updated_at)
  VALUES (auth.uid(), v_bank, v_holder, v_account, now())
  ON CONFLICT (profile_id) DO UPDATE
    SET bank_name = EXCLUDED.bank_name,
        account_holder_name = EXCLUDED.account_holder_name,
        account_number = EXCLUDED.account_number,
        updated_at = now();

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();

  v_gross := round(v_calc.completed_hours * v_request.hourly_rate_usd, 2);
  v_late_deduction := round(v_calc.delayed_tasks * v_request.late_deduction_usd, 2);
  v_unfinished_deduction := round(coalesce(v_calc.unfinished_tasks, 0) * 1.00, 2);
  v_total_deductions := round(v_late_deduction + v_unfinished_deduction, 2);
  v_net := greatest(0, v_gross - v_total_deductions);

  UPDATE public.manager_payment_requests
  SET bank_name = v_bank,
      bank_account_holder = v_holder,
      bank_account_number = v_account,
      completed_tasks = v_calc.completed_tasks,
      completed_hours = v_calc.completed_hours,
      delayed_tasks = v_calc.delayed_tasks,
      performance_score = v_calc.performance_score,
      gross_amount_usd = v_gross,
      deductions_usd = v_total_deductions,
      net_amount_usd = v_net,
      work_breakdown = v_calc.work_breakdown,
      delay_breakdown = v_calc.delay_breakdown,
      unfinished_tasks_count = v_calc.unfinished_tasks,
      unfinished_deduction_usd = v_unfinished_deduction,
      unfinished_breakdown = v_calc.unfinished_breakdown,
      status = 'requested',
      revision_note = NULL,
      dispute_note = NULL,
      requested_at = now(),
      reviewed_at = NULL,
      reviewed_by = NULL,
      updated_at = now()
  WHERE id = p_request_id AND manager_id = auth.uid();

  INSERT INTO public.manager_payment_request_events
    (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (
    p_request_id,
    auth.uid(),
    v_name,
    'manager'::public.user_role,
    'resubmitted',
    'Updated bank details and refreshed the task-assignment-month snapshot. Unfinished tasks opted out: ' ||
      v_calc.unfinished_tasks || '. Fixed opt-out deduction: USD ' ||
      to_char(v_unfinished_deduction, 'FM9999999990.00') || '.'
  );
END
$function$;

REVOKE ALL ON FUNCTION app_private.resubmit_manager_payment_request_v2(uuid, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.resubmit_manager_payment_request_v2(uuid, text, text, text, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.resubmit_manager_payment_request_v2(
  p_request_id uuid,
  p_bank_name text,
  p_account_holder text,
  p_account_number text,
  p_opted_out_task_ids uuid[]
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.resubmit_manager_payment_request_v2(
    p_request_id, p_bank_name, p_account_holder, p_account_number, p_opted_out_task_ids
  );
$function$;

REVOKE ALL ON FUNCTION public.resubmit_manager_payment_request_v2(uuid, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_manager_payment_request_v2(uuid, text, text, text, uuid[]) TO authenticated;

-- Maintain legacy sessions while forcing them through the same unfinished-task guard.
CREATE OR REPLACE FUNCTION app_private.resubmit_manager_payment_request(
  p_request_id uuid,
  p_bank_name text,
  p_account_holder text,
  p_account_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_request
  FROM public.manager_payment_requests
  WHERE id = p_request_id AND manager_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found.';
  END IF;

  SELECT coalesce(array_agg((item->>'task_id')::uuid), ARRAY[]::uuid[])
  INTO v_ids
  FROM jsonb_array_elements(coalesce(v_request.unfinished_breakdown, '[]'::jsonb)) AS item;

  PERFORM app_private.resubmit_manager_payment_request_v2(
    p_request_id, p_bank_name, p_account_holder, p_account_number, v_ids
  );
END
$function$;

REVOKE ALL ON FUNCTION app_private.resubmit_manager_payment_request(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.resubmit_manager_payment_request(uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
