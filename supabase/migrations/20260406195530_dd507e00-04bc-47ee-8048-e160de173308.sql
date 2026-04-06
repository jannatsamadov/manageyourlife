
CREATE TABLE public.task_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  recipient_email text NOT NULL,
  recipient_id uuid,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.task_shares ENABLE ROW LEVEL SECURITY;

-- Sender can see and manage their sent shares
CREATE POLICY "Senders can manage own shares"
  ON public.task_shares FOR ALL
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);

-- Recipients can see shares sent to them (matched by email from auth.users)
CREATE POLICY "Recipients can view incoming shares"
  ON public.task_shares FOR SELECT
  USING (
    auth.uid() = recipient_id
    OR (
      recipient_id IS NULL
      AND recipient_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Recipients can update status (accept/reject)
CREATE POLICY "Recipients can update share status"
  ON public.task_shares FOR UPDATE
  USING (
    auth.uid() = recipient_id
    OR (
      recipient_id IS NULL
      AND recipient_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );
