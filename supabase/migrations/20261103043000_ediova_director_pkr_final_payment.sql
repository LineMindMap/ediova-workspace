-- Director-controlled PKR payout decisions, preserved separately from the USD policy calculation.
ALTER TABLE public.manager_payment_requests
  ADD COLUMN IF NOT EXISTS director_payment_amount_pkr numeric(12,2),
  ADD COLUMN IF NOT EXISTS director_payment_reason text,
  ADD COLUMN IF NOT EXISTS director_payment_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS director_payment_set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.manager_payment_requests
  DROP CONSTRAINT IF EXISTS manager_payment_requests_director_payout_check,
  ADD CONSTRAINT manager_payment_requests_director_payout_check CHECK (
    (director_payment_amount_pkr IS NULL AND director_payment_reason IS NULL)
    OR (
      director_payment_amount_pkr > 0
      AND director_payment_reason IS NOT NULL
      AND char_length(btrim(director_payment_reason)) BETWEEN 5 AND 1200
    )
  );

ALTER TABLE public.manager_payment_request_events
  DROP CONSTRAINT IF EXISTS manager_payment_request_events_action_check,
  ADD CONSTRAINT manager_payment_request_events_action_check CHECK (
    action IN ('requested','resubmitted','disputed','approved','payout_set','revision_requested','paid')
  );

CREATE OR REPLACE FUNCTION app_private.approve_manager_payment_request(
  p_request_id uuid,
  p_amount_pkr numeric,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE;
  v_amount numeric(12,2);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
  v_action text;
BEGIN
  IF auth.uid() IS NULL
    OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can set the final payment amount.';
  END IF;

  IF p_amount_pkr IS NULL OR p_amount_pkr <= 0 OR p_amount_pkr > 9999999999.99
    OR p_amount_pkr <> round(p_amount_pkr, 2) THEN
    RAISE EXCEPTION 'Enter a valid final PKR amount with up to two decimal places.';
  END IF;
  IF char_length(v_reason) < 5 OR char_length(v_reason) > 1200 THEN
    RAISE EXCEPTION 'Add a reason of at least five characters for the final PKR amount.';
  END IF;

  SELECT * INTO v_request
  FROM public.manager_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found.';
  END IF;
  IF v_request.status NOT IN ('requested', 'disputed', 'approved') THEN
    RAISE EXCEPTION 'Only a pending or approved request can receive a Director-set payout amount.';
  END IF;

  SELECT p.full_name INTO v_name
  FROM public.profiles p
  WHERE p.id = auth.uid();

  v_amount := round(p_amount_pkr, 2);
  v_action := CASE WHEN v_request.status = 'approved' THEN 'payout_set' ELSE 'approved' END;

  UPDATE public.manager_payment_requests
  SET status = CASE WHEN status IN ('requested', 'disputed') THEN 'approved' ELSE status END,
      director_payment_amount_pkr = v_amount,
      director_payment_reason = v_reason,
      director_payment_set_at = now(),
      director_payment_set_by = auth.uid(),
      revision_note = NULL,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.manager_payment_request_events
    (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (
    p_request_id,
    auth.uid(),
    coalesce(v_name, 'Managing Director'),
    'managing_director'::public.user_role,
    v_action,
    'Director-approved final payment: PKR ' ||
      to_char(v_amount, 'FM9999999990.00') ||
      '. Reason: ' || v_reason ||
      '. System-suggested calculation remains USD ' ||
      to_char(v_request.net_amount_usd, 'FM9999999990.00') || '.'
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.approve_manager_payment_request(
  p_request_id uuid,
  p_amount_pkr numeric,
  p_reason text
)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
  SELECT app_private.approve_manager_payment_request(p_request_id, p_amount_pkr, p_reason);
$function$;

REVOKE ALL ON FUNCTION app_private.approve_manager_payment_request(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.approve_manager_payment_request(uuid, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_manager_payment_request(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_manager_payment_request(uuid, numeric, text) TO authenticated;

-- Prevent the legacy review RPC from bypassing the required PKR amount and reason.
CREATE OR REPLACE FUNCTION app_private.review_manager_payment_request(
  p_request_id uuid,
  p_action text,
  p_note text DEFAULT NULL
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
BEGIN
  IF auth.uid() IS NULL
    OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
    RAISE EXCEPTION 'Only the Managing Director can review payment requests.';
  END IF;

  SELECT * INTO v_request
  FROM public.manager_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found.';
  END IF;

  IF p_action = 'approve' THEN
    RAISE EXCEPTION 'Use the final PKR approval action and provide the amount and reason.';
  ELSIF p_action = 'request_revision' AND v_request.status IN ('requested','disputed','approved') THEN
    IF char_length(v_note) < 5 OR char_length(v_note) > 1200 THEN
      RAISE EXCEPTION 'Add a short note explaining the requested revision.';
    END IF;

    UPDATE public.manager_payment_requests
    SET status = 'revision_requested',
        revision_note = v_note,
        director_payment_amount_pkr = NULL,
        director_payment_reason = NULL,
        director_payment_set_at = NULL,
        director_payment_set_by = NULL,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        updated_at = now()
    WHERE id = p_request_id;
  ELSIF p_action = 'mark_paid' THEN
    RAISE EXCEPTION 'Use the payment recording action and provide the actual amount and currency.';
  ELSE
    RAISE EXCEPTION 'That payment status change is not allowed.';
  END IF;

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  v_role := app_private.current_app_role();

  INSERT INTO public.manager_payment_request_events
    (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), coalesce(v_name, 'Managing Director'), v_role, 'revision_requested', v_note);
END
$function$;

-- A manager dispute against an approved invoice clears the earlier decision pending a new review.
CREATE OR REPLACE FUNCTION app_private.dispute_manager_payment_request(
  p_request_id uuid,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_request public.manager_payment_requests%ROWTYPE;
  v_note text;
  v_name text;
BEGIN
  IF auth.uid() IS NULL
    OR app_private.current_app_role() IS DISTINCT FROM 'manager'::public.user_role THEN
    RAISE EXCEPTION 'Only the Manager can dispute their payment request.';
  END IF;
  v_note := btrim(coalesce(p_note, ''));
  IF char_length(v_note) < 5 OR char_length(v_note) > 1200 THEN
    RAISE EXCEPTION 'Please explain the dispute in at least five characters.';
  END IF;

  SELECT * INTO v_request
  FROM public.manager_payment_requests
  WHERE id = p_request_id AND manager_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('requested','approved') THEN
    RAISE EXCEPTION 'This payment request cannot be disputed in its current status.';
  END IF;

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  UPDATE public.manager_payment_requests
  SET status = 'disputed',
      dispute_note = v_note,
      director_payment_amount_pkr = NULL,
      director_payment_reason = NULL,
      director_payment_set_at = NULL,
      director_payment_set_by = NULL,
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.manager_payment_request_events
    (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), coalesce(v_name, 'Manager'), 'manager'::public.user_role, 'disputed', v_note);
END
$function$;

-- An invoice cannot be marked paid until its Director-approved PKR amount and reason are stored.
CREATE OR REPLACE FUNCTION app_private.mark_manager_payment_request_paid(
  p_request_id uuid,
  p_paid_amount numeric,
  p_paid_currency text
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
  IF auth.uid() IS NULL
    OR app_private.current_app_role() IS DISTINCT FROM 'managing_director'::public.user_role THEN
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
  IF v_request.director_payment_amount_pkr IS NULL
    OR v_request.director_payment_reason IS NULL THEN
    RAISE EXCEPTION 'Set the final PKR payment amount and reason before marking this invoice as paid.';
  END IF;

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  UPDATE public.manager_payment_requests
  SET status = 'paid',
      paid_amount = round(p_paid_amount, 2),
      paid_currency = v_currency,
      paid_at = now(),
      paid_by = auth.uid(),
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_request_id;

  v_note := 'Actual transfer recorded: ' ||
    to_char(round(p_paid_amount, 2), 'FM9999999990.00') || ' ' || v_currency ||
    '. Director-approved final payment: PKR ' ||
    to_char(v_request.director_payment_amount_pkr, 'FM9999999990.00') ||
    '. Director reason: ' || v_request.director_payment_reason ||
    '. System-suggested calculation remains USD ' ||
    to_char(v_request.net_amount_usd, 'FM9999999990.00') || '.';

  INSERT INTO public.manager_payment_request_events
    (request_id, actor_id, actor_name, actor_role, action, note)
  VALUES (p_request_id, auth.uid(), coalesce(v_name, 'Managing Director'), 'managing_director'::public.user_role, 'paid', v_note);
END
$function$;
