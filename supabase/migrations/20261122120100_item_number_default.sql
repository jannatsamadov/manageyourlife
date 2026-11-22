-- #200: writers never send an item's number (the items_number trigger always sets it); a default makes that visible
-- to them (the generated types mark it optional). 0 is never stored: the trigger replaces it.
ALTER TABLE public.items ALTER COLUMN number SET DEFAULT 0;
