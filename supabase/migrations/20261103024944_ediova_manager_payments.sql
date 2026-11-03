-- Ediova monthly payment requests: immutable invoice snapshots with role-gated decisions.
CREATE TABLE IF NOT EXISTS public.payment_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  hourly_rate_usd numeric(10,2) NOT NULL DEFAULT 1.00 CHECK (hourly_rate_usd >= 0 AND hourly_rate_usd <= 1000),
  late_deduction_usd numeric(10,2) NOT NULL DEFAULT 1.00 CHECK (late_deduction_usd >= 0 AND late_deduction_usd <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
INSERT INTO public.payment_settings (id, hourly_rate_usd, late_deduction_usd)
VALUES (true, 1.00, 1.00)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.manager_bank_details (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bank_name text NOT NULL CHECK (char_length(btrim(bank_name)) BETWEEN 2 AND 120),
  account_holder_name text NOT NULL CHECK (char_length(btrim(account_holder_name)) BETWEEN 2 AND 160),
  account_number text NOT NULL CHECK (char_length(btrim(account_number)) BETWEEN 4 AND 80),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS app_private.payment_invoice_number_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.manager_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  manager_name_snapshot text NOT NULL,
  month_start date NOT NULL CHECK (extract(day FROM month_start) = 1),
  invoice_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','revision_requested','disputed','approved','paid')),
  completed_tasks integer NOT NULL DEFAULT 0 CHECK (completed_tasks >= 0),
  completed_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (completed_hours >= 0),
  delayed_tasks integer NOT NULL DEFAULT 0 CHECK (delayed_tasks >= 0),
  performance_score integer NOT NULL DEFAULT 100 CHECK (performance_score BETWEEN 0 AND 100),
  hourly_rate_usd numeric(10,2) NOT NULL CHECK (hourly_rate_usd >= 0),
  late_deduction_usd numeric(10,2) NOT NULL CHECK (late_deduction_usd >= 0),
  gross_amount_usd numeric(12,2) NOT NULL CHECK (gross_amount_usd >= 0),
  deductions_usd numeric(12,2) NOT NULL CHECK (deductions_usd >= 0),
  net_amount_usd numeric(12,2) NOT NULL CHECK (net_amount_usd >= 0),
  bank_name text NOT NULL,
  bank_account_holder text NOT NULL,
  bank_account_number text NOT NULL,
  work_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  delay_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision_note text,
  dispute_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at timestamptz,
  paid_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manager_id, month_start)
);

CREATE TABLE IF NOT EXISTS public.manager_payment_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.manager_payment_requests(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  actor_role public.user_role NOT NULL,
  action text NOT NULL CHECK (action IN ('requested','resubmitted','disputed','approved','revision_requested','paid')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manager_payment_requests_manager_month_idx
  ON public.manager_payment_requests (manager_id, month_start DESC);
CREATE INDEX IF NOT EXISTS manager_payment_requests_status_idx
  ON public.manager_payment_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS manager_payment_events_request_idx
  ON public.manager_payment_request_events (request_id, created_at);

ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_payment_request_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_settings_read ON public.payment_settings;
CREATE POLICY payment_settings_read
  ON public.payment_settings FOR SELECT TO authenticated
  USING (app_private.current_app_role() IS NOT NULL);
DROP POLICY IF EXISTS payment_settings_update_director ON public.payment_settings;
CREATE POLICY payment_settings_update_director
  ON public.payment_settings FOR UPDATE TO authenticated
  USING (app_private.is_managing_director())
  WITH CHECK (app_private.is_managing_director());

DROP POLICY IF EXISTS manager_bank_details_read ON public.manager_bank_details;
CREATE POLICY manager_bank_details_read
  ON public.manager_bank_details FOR SELECT TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR app_private.is_managing_director());
DROP POLICY IF EXISTS manager_bank_details_insert_own ON public.manager_bank_details;
CREATE POLICY manager_bank_details_insert_own
  ON public.manager_bank_details FOR INSERT TO authenticated
  WITH CHECK (profile_id = (SELECT auth.uid()) AND app_private.current_app_role() = 'manager'::public.user_role);
DROP POLICY IF EXISTS manager_bank_details_update_own ON public.manager_bank_details;
CREATE POLICY manager_bank_details_update_own
  ON public.manager_bank_details FOR UPDATE TO authenticated
  USING (profile_id = (SELECT auth.uid()) AND app_private.current_app_role() = 'manager'::public.user_role)
  WITH CHECK (profile_id = (SELECT auth.uid()) AND app_private.current_app_role() = 'manager'::public.user_role);

DROP POLICY IF EXISTS manager_payment_requests_read ON public.manager_payment_requests;
CREATE POLICY manager_payment_requests_read
  ON public.manager_payment_requests FOR SELECT TO authenticated
  USING (manager_id = (SELECT auth.uid()) OR app_private.is_managing_director());

DROP POLICY IF EXISTS manager_payment_events_read ON public.manager_payment_request_events;
CREATE POLICY manager_payment_events_read
  ON public.manager_payment_request_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.manager_payment_requests r
      WHERE r.id = request_id
        AND (r.manager_id = (SELECT auth.uid()) OR app_private.is_managing_director())
    )
  );

REVOKE ALL ON public.payment_settings FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.payment_settings TO authenticated;
REVOKE INSERT, DELETE ON public.payment_settings FROM authenticated;
REVOKE ALL ON public.manager_bank_details FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.manager_bank_details TO authenticated;
REVOKE DELETE ON public.manager_bank_details FROM authenticated;
REVOKE ALL ON public.manager_payment_requests FROM anon, authenticated;
GRANT SELECT ON public.manager_payment_requests TO authenticated;
REVOKE ALL ON public.manager_payment_request_events FROM anon, authenticated;
GRANT SELECT ON public.manager_payment_request_events TO authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated;

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
  SELECT p.full_name INTO v_name FROM public.profiles p
  WHERE p.id = p_manager_id AND p.role = 'manager'::public.user_role;
  IF v_name IS NULL THEN RAISE EXCEPTION 'The manager profile could not be found.'; END IF;
  SELECT s.hourly_rate_usd, s.late_deduction_usd INTO v_hourly_rate, v_late_deduction
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
    coalesce(jsonb_agg(jsonb_build_object('task_id', t.id, 'title', t.title, 'deadline_at', t.deadline_at, 'completed_at', t.completed_at, 'delay_hours', round((extract(epoch FROM (coalesce(t.completed_at, now()) - t.deadline_at)) / 3600.0)::numeric, 1) ) ORDER BY t.deadline_at, t.title), '[]'::jsonb)
  INTO v_delayed_tasks, v_delays
  FROM public.tasks t
  WHERE t.assignee_id = p_manager_id
    AND t.status NOT IN ('cancelled'::public.task_status, 'archived'::public.task_status)
    AND t.deadline_at >= v_start AND t.deadline_at < v_end
    AND ((t.status = 'completed'::public.task_status AND t.completed_at > t.deadline_at + interval '24 hours')
      OR (t.status IN ('pending'::public.task_status, 'in_progress'::public.task_status) AND now() > t.deadline_at + interval '24 hours'));
  v_score := greatest(0, 100 - (v_delayed_tasks * 10));
  v_gross := round(v_completed_hours * v_hourly_rate, 2);
  v_deductions := round(v_delayed_tasks * v_late_deduction, 2);
  v_net := greatest(0, v_gross - v_deductions);
  RETURN QUERY SELECT p_manager_id, v_name, p_month,
    (p_month + interval '1 month' - interval '1 day')::date,
    v_completed_tasks, v_completed_hours, v_delayed_tasks, v_score, v_hourly_rate, v_late_deduction,
    v_gross, v_deductions, v_net, v_work, v_delays;
END
$function$;

CREATE OR REPLACE FUNCTION app_private.create_manager_payment_request(p_month date, p_bank_name text, p_account_holder text, p_account_number text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_calc record; v_request_id uuid; v_invoice_number text; v_name text;
  v_bank text; v_holder text; v_account text;
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
  INSERT INTO public.manager_bank_details (profile_id, bank_name, account_holder_name, account_number, updated_at)
  VALUES (auth.uid(), v_bank, v_holder, v_account, now())
  ON CONFLICT (profile_id) DO UPDATE SET bank_name = EXCLUDED.bank_name,
    account_holder_name = EXCLUDED.account_holder_name, account_number = EXCLUDED.account_number, updated_at = now();
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  v_invoice_number := 'EDI-PAY-' || to_char(p_month, 'YYYYMM') || '-' ||
    lpad(nextval('app_private.payment_invoice_number_seq')::text, 5, '0');
  INSERT INTO public.manager_payment_requests (
    manager_id, manager_name_snapshot, month_start, invoice_number, status,
    completed_tasks, completed_hours, delayed_tasks, performance_score, hourly_rate_usd, late_deduction_usd,
    gross_amount_usd, deductions_usd, net_amount_usd, bank_name, bank_account_holder, bank_account_number,
    work_breakdown, delay_breakdown
  ) VALUES (
    auth.uid(), v_name, p_month, v_invoice_number, 'requested',
    v_calc.completed_tasks, v_calc.completed_hours, v_calc.delayed_tasks, v_calc.performance_score,
    v_calc.hourly_rate_usd, v_calc.late_deduction_usd, v_calc.gross_amount_usd, v_calc.deductions_usd,
    v_calc.net_amount_usd, v_bank, v_holder, v_account, v_calc.work_breakdown, v_calc.delay_breakdown
  ) RETURNING id INTO v_request_id;
  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (v_request_id, auth.uid(), v_name, 'manager'::public.user_role, 'requested',
    'Payment requested for ' || to_char(p_month, 'FMMonth YYYY') || '.');
  RETURN v_request_id;
END
$function$;

CREATE OR REPLACE FUNCTION app_private.resubmit_manager_payment_request(p_request_id uuid, p_bank_name text, p_account_holder text, p_account_number text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE; v_bank text; v_holder text; v_account text; v_name text;
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
  INSERT INTO public.manager_bank_details (profile_id, bank_name, account_holder_name, account_number, updated_at)
  VALUES (auth.uid(), v_bank, v_holder, v_account, now())
  ON CONFLICT (profile_id) DO UPDATE SET bank_name = EXCLUDED.bank_name,
    account_holder_name = EXCLUDED.account_holder_name, account_number = EXCLUDED.account_number, updated_at = now();
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  UPDATE public.manager_payment_requests SET bank_name = v_bank, bank_account_holder = v_holder,
    bank_account_number = v_account, status = 'requested', revision_note = NULL, dispute_note = NULL,
    requested_at = now(), updated_at = now() WHERE id = p_request_id AND manager_id = auth.uid();
  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), v_name, 'manager'::public.user_role, 'resubmitted',
    'Updated details and resubmitted the payment request.');
END
$function$;

CREATE OR REPLACE FUNCTION app_private.dispute_manager_payment_request(p_request_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE; v_note text; v_name text;
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can dispute their payment request.';
  END IF;
  v_note := btrim(coalesce(p_note, ''));
  IF char_length(v_note) < 5 OR char_length(v_note) > 1200 THEN
    RAISE EXCEPTION 'Please explain the dispute in at least five characters.';
  END IF;
  SELECT * INTO v_request FROM public.manager_payment_requests
  WHERE id = p_request_id AND manager_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('requested','approved') THEN
    RAISE EXCEPTION 'This payment request cannot be disputed in its current status.';
  END IF;
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  UPDATE public.manager_payment_requests SET status = 'disputed', dispute_note = v_note, updated_at = now()
  WHERE id = p_request_id;
  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), v_name, 'manager'::public.user_role, 'disputed', v_note);
END
$function$;

CREATE OR REPLACE FUNCTION app_private.review_manager_payment_request(p_request_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_name text; v_role public.user_role; v_event text;
BEGIN
  IF auth.uid() IS NULL OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can review and mark payment requests.';
  END IF;
  SELECT * INTO v_request FROM public.manager_payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found.'; END IF;
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  v_role := app_private.current_app_role();
  IF p_action = 'approve' AND v_request.status IN ('requested','disputed') THEN
    UPDATE public.manager_payment_requests SET status = 'approved', revision_note = NULL,
      reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now() WHERE id = p_request_id;
    v_event := 'approved';
    IF v_note = '' THEN v_note := 'Payment request approved.'; END IF;
  ELSIF p_action = 'request_revision' AND v_request.status IN ('requested','disputed','approved') THEN
    IF char_length(v_note) < 5 OR char_length(v_note) > 1200 THEN
      RAISE EXCEPTION 'Add a short note explaining the requested revision.';
    END IF;
    UPDATE public.manager_payment_requests SET status = 'revision_requested', revision_note = v_note,
      reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now() WHERE id = p_request_id;
    v_event := 'revision_requested';
  ELSIF p_action = 'mark_paid' AND v_request.status = 'approved' THEN
    UPDATE public.manager_payment_requests SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
      reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now() WHERE id = p_request_id;
    v_event := 'paid';
    IF v_note = '' THEN v_note := 'Payment marked as paid by the Managing Director.'; END IF;
  ELSE
    RAISE EXCEPTION 'That payment status change is not allowed.';
  END IF;
  INSERT INTO public.manager_payment_request_events (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), v_name, v_role, v_event, nullif(v_note, ''));
END
$function$;

REVOKE ALL ON FUNCTION app_private.manager_payment_preview(uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.create_manager_payment_request(date,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.resubmit_manager_payment_request(uuid,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.dispute_manager_payment_request(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.review_manager_payment_request(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.manager_payment_preview(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.create_manager_payment_request(date,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.resubmit_manager_payment_request(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.dispute_manager_payment_request(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.review_manager_payment_request(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_manager_payment_preview(p_month date)
RETURNS TABLE (
  manager_id uuid, manager_name text, month_start date, month_end date,
  completed_tasks integer, completed_hours numeric, delayed_tasks integer, performance_score integer,
  hourly_rate_usd numeric, late_deduction_usd numeric, gross_amount_usd numeric,
  deductions_usd numeric, net_amount_usd numeric, work_breakdown jsonb, delay_breakdown jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$ SELECT * FROM app_private.manager_payment_preview(auth.uid(), p_month); $function$;

CREATE OR REPLACE FUNCTION public.create_manager_payment_request(p_month date, p_bank_name text, p_account_holder text, p_account_number text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$ SELECT app_private.create_manager_payment_request(p_month, p_bank_name, p_account_holder, p_account_number); $function$;

CREATE OR REPLACE FUNCTION public.resubmit_manager_payment_request(p_request_id uuid, p_bank_name text, p_account_holder text, p_account_number text)
RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$ SELECT app_private.resubmit_manager_payment_request(p_request_id, p_bank_name, p_account_holder, p_account_number); $function$;

CREATE OR REPLACE FUNCTION public.dispute_manager_payment_request(p_request_id uuid, p_note text)
RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$ SELECT app_private.dispute_manager_payment_request(p_request_id, p_note); $function$;

CREATE OR REPLACE FUNCTION public.review_manager_payment_request(p_request_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$ SELECT app_private.review_manager_payment_request(p_request_id, p_action, p_note); $function$;

REVOKE ALL ON FUNCTION public.get_manager_payment_preview(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_manager_payment_request(date,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resubmit_manager_payment_request(uuid,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispute_manager_payment_request(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_manager_payment_request(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_payment_preview(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manager_payment_request(date,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_manager_payment_request(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_manager_payment_request(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_manager_payment_request(uuid,text,text) TO authenticated;
