-- Keep one SELECT policy for tasks. Managers can see their own scheduled work
-- (including future releases) and a dropped repeating root only as a read-only
-- calendar template. Dropped one-off tasks remain invisible to their Manager.
DROP POLICY IF EXISTS tasks_assignee_calendar ON public.tasks;
DROP POLICY IF EXISTS tasks_select_access ON public.tasks;

CREATE POLICY tasks_select_access
  ON public.tasks FOR SELECT TO authenticated
  USING (
    app_private.is_managing_director()
    OR (
      app_private.current_app_role() = 'manager'::public.user_role
      AND assignee_id = (SELECT auth.uid())
      AND (
        dropped_at IS NULL
        OR (recurrence_parent_id IS NULL AND repeat_unit <> 'none')
      )
    )
  );

NOTIFY pgrst, 'reload schema';
