CREATE INDEX IF NOT EXISTS manager_payment_requests_director_payment_set_by_idx
  ON public.manager_payment_requests (director_payment_set_by)
  WHERE director_payment_set_by IS NOT NULL;