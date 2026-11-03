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
  IF p_month <> (date_trunc('month', now() AT TIME ZONE 'Asia/Karachi') - interval '1 month')::date
    AND NOT EXISTS (
      SELECT 1 FROM public.manager_payment_requests r
      WHERE r.manager_id = p_manager_id
        AND r.month_start = p_month
        AND r.status = 'revision_requested'
    )
  THEN
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