-- v8.18 notifications: richer notification rows for Admin, Examiner and Client.
-- The table already exists (id, user_id, text, link, read, created_at). This
-- only ADDS columns; nothing is dropped or renamed. `text` stays the title and
-- `read` mirrors read_at so older code keeps working.
--
-- The backend also adds these columns by itself at startup (app/main.py,
-- _ADDED_COLUMNS), so running this file by hand in the Supabase SQL editor is
-- optional. It is safe to run more than once.

alter table public.notifications add column if not exists type        varchar(30);
alter table public.notifications add column if not exists body        text;
alter table public.notifications add column if not exists entity_type varchar(30);
alter table public.notifications add column if not exists entity_id   integer;
alter table public.notifications add column if not exists read_at     timestamp;

create index if not exists ix_notifications_user_id_id on public.notifications (user_id, id desc);

-- Row Level Security stays on with no policies (see ../rls.sql): only the
-- backend reads this table, and it returns each user their own rows only.
alter table public.notifications enable row level security;
