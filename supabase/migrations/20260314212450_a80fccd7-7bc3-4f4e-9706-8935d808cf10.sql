
-- Add weight and attribute_tag columns to tasks
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS attribute_tag text NOT NULL DEFAULT 'general';

-- Create user_attributes table for storing character stats
CREATE TABLE public.user_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  attribute text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  max_value numeric NOT NULL DEFAULT 100,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, attribute)
);

ALTER TABLE public.user_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own attributes"
  ON public.user_attributes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
