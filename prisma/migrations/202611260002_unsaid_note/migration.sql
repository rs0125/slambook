-- Optional addition to the v1 questionnaire; existing entries need no backfill.
-- Validate it at the storage boundary as well as in the request schema.
alter table public.entries add constraint entries_unsaid_note_check check (
  not (answers ? 'unsaid_note') or (
    jsonb_typeof(answers->'unsaid_note') = 'string'
    and char_length(answers->>'unsaid_note') <= 2000
  )
);
