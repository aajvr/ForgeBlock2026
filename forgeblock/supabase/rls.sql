-- Run once in the Supabase SQL editor AFTER the backend has created the tables
-- (start the backend with DATABASE_URL pointing at Supabase).
--
-- The FastAPI backend connects as the postgres role and enforces all access
-- rules itself. Supabase also exposes public tables through its REST API using
-- the anon key, so Row Level Security is enabled with no policies: this blocks
-- anon/authenticated API access entirely, while the backend keeps working.

-- Every table is listed, so none is readable through the REST API. Section
-- 3.8 ("each account can access only the records it is authorized to view")
-- is enforced by the backend (app/access.py) for every request.

alter table public.users              enable row level security;
alter table public.client_groups      enable row level security;
alter table public.clients            enable row level security;
alter table public.client_access      enable row level security;
alter table public.signature_profiles enable row level security;
alter table public.cases              enable row level security;
alter table public.case_events        enable row level security;
alter table public.verification_logs  enable row level security;
alter table public.findings           enable row level security;
alter table public.blockchain_ledger  enable row level security;
alter table public.reports            enable row level security;
alter table public.activity_logs      enable row level security;
alter table public.notifications      enable row level security;
alter table public.settings           enable row level security;
