-- Add position column for task ordering within a day
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
