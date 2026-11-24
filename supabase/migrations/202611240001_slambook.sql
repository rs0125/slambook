-- V1: one owner, private entries, and service-only guest writes.
create table public.settings (
  id smallint primary key default 1 check (id = 1),
  owner_id uuid,
  submissions_open boolean not null default true,
  welcome_text text not null default 'Some of my favourite stories have you in them. Let’s keep a little piece of those days — the first hellos, the ridiculous laughs, and everything in between.' check (char_length(welcome_text) between 1 and 2000)
);
insert into public.settings (id) values (1);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  nickname text not null default '' check (char_length(nickname) <= 100),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  questionnaire_version integer not null default 1 check (questionnaire_version = 1),
  contact_handle text not null default '' check (char_length(contact_handle) <= 250),
  submission_request_id uuid not null unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index entries_created_at_idx on public.entries (created_at desc, id desc) where deleted_at is null;

create table public.submission_attempts (
  id uuid primary key,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  completed_entry_id uuid
);
create table public.upload_files (
  id uuid primary key,
  attempt_id uuid not null references public.submission_attempts(id) on delete cascade,
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  active boolean not null default true,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index upload_files_attempt_idx on public.upload_files (attempt_id);
create table public.entry_media (
  id uuid primary key references public.upload_files(id),
  entry_id uuid not null references public.entries(id) on delete cascade,
  storage_path text not null unique,
  caption text not null default '' check (char_length(caption) <= 250),
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  sort_order smallint not null check (sort_order between 0 and 2),
  created_at timestamptz not null default now(),
  unique (entry_id, sort_order)
);
create index entry_media_entry_idx on public.entry_media(entry_id);
create table public.rate_limits (
  key text primary key,
  window_started_at timestamptz not null default now(),
  hits integer not null default 1
);

alter table public.settings enable row level security;
alter table public.entries enable row level security;
alter table public.entry_media enable row level security;
alter table public.submission_attempts enable row level security;
alter table public.upload_files enable row level security;
alter table public.rate_limits enable row level security;

create function public.is_book_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.settings where id = 1 and owner_id = (select auth.uid()));
$$;
revoke all on function public.is_book_owner() from public;
grant execute on function public.is_book_owner() to authenticated;

create policy owner_read_settings on public.settings for select to authenticated using (public.is_book_owner());
create policy owner_read_entries on public.entries for select to authenticated using (public.is_book_owner() and deleted_at is null);
create policy owner_read_media on public.entry_media for select to authenticated using (
  public.is_book_owner() and exists(select 1 from public.entries e where e.id = entry_id and e.deleted_at is null)
);
-- No INSERT/UPDATE/DELETE policies: mutations go through the validated server.
revoke all on public.settings, public.entries, public.entry_media, public.submission_attempts, public.upload_files, public.rate_limits from anon, authenticated;
grant select on public.settings, public.entries, public.entry_media to anon, authenticated;
grant all on public.settings, public.entries, public.entry_media, public.submission_attempts, public.upload_files, public.rate_limits to service_role;

-- An atomic, persistent fixed-window limiter. IP addresses are HMAC-hashed upstream.
create function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then raise exception 'INVALID_LIMIT'; end if;
  insert into public.rate_limits as limits (key, window_started_at, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1 else least(limits.hits + 1, p_limit + 1) end,
    window_started_at = case when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now() else limits.window_started_at end
  returning hits into current_hits;
  return current_hits <= p_limit;
end;
$$;

-- One transaction owns the attempt, reconciles its current manifest, and allocates paths.
-- Retired slots remain tracked for cleanup; untrusted clients never supply paths.
create function public.prepare_uploads(p_request_id uuid, p_token_hash text, p_files jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare attempt public.submission_attempts; item jsonb; saved public.upload_files; file_id uuid; ext text; open boolean;
begin
  select submissions_open into open from public.settings where id = 1 for share;
  -- The advisory lock also protects the initial insert against concurrent retries.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into attempt from public.submission_attempts where id = p_request_id for update;
  if found then
    if attempt.token_hash <> p_token_hash then raise exception 'INVALID_ATTEMPT'; end if;
    if attempt.completed_entry_id is not null then return jsonb_build_object('submitted', true, 'files', '[]'::jsonb); end if;
    if attempt.expires_at < now() then raise exception 'ATTEMPT_EXPIRED'; end if;
  end if;
  if open is distinct from true then raise exception 'SUBMISSIONS_CLOSED'; end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) > 3 then raise exception 'INVALID_MEDIA'; end if;
  if (select count(distinct f->>'id') from jsonb_array_elements(p_files) f) <> jsonb_array_length(p_files) then raise exception 'INVALID_MEDIA'; end if;
  insert into public.submission_attempts (id, token_hash) values (p_request_id, p_token_hash) on conflict (id) do nothing;
  update public.upload_files set active = false where attempt_id = p_request_id;
  for item in select * from jsonb_array_elements(p_files) loop
    file_id := (item->>'id')::uuid;
    if (item->>'mime') not in ('image/jpeg', 'image/png', 'image/webp') or (item->>'size')::integer not between 1 and 2097152 then raise exception 'INVALID_MEDIA'; end if;
    select * into saved from public.upload_files where id = file_id;
    if found then
      if saved.attempt_id <> p_request_id or saved.size_bytes <> (item->>'size')::integer or saved.mime_type <> item->>'mime' then raise exception 'INVALID_MEDIA'; end if;
      update public.upload_files set active = true where id = file_id;
    else
      if (select count(*) from public.upload_files where attempt_id = p_request_id) >= 12 then raise exception 'INVALID_MEDIA'; end if;
      ext := case item->>'mime' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
      insert into public.upload_files (id, attempt_id, storage_path, size_bytes, mime_type)
      values (file_id, p_request_id, 'attempts/' || p_request_id::text || '/' || file_id::text || '.' || ext, (item->>'size')::integer, item->>'mime');
    end if;
  end loop;
  return jsonb_build_object('submitted', false, 'files', coalesce((select jsonb_agg(to_jsonb(f)) from public.upload_files f where attempt_id = p_request_id and active), '[]'::jsonb));
end;
$$;

-- Idempotent finalisation: an entry and all media rows commit together, or none do.
create function public.finalize_entry(p_request_id uuid, p_token_hash text, p_entry jsonb, p_media jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare attempt public.submission_attempts; entry_id uuid; item jsonb; field text; position integer := 0; open boolean;
begin
  select submissions_open into open from public.settings where id = 1 for share;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into attempt from public.submission_attempts where id = p_request_id for update;
  if not found or attempt.token_hash <> p_token_hash then raise exception 'INVALID_ATTEMPT'; end if;
  if attempt.completed_entry_id is not null then return attempt.completed_entry_id; end if;
  if attempt.expires_at < now() then raise exception 'ATTEMPT_EXPIRED'; end if;
  if open is distinct from true then raise exception 'SUBMISSIONS_CLOSED'; end if;
  if jsonb_typeof(p_entry) is distinct from 'object' or jsonb_typeof(p_entry->'answers') is distinct from 'object'
    or coalesce(char_length(btrim(p_entry->>'name')), 0) not between 1 and 100
    or char_length(p_entry->>'nickname') > 100 or char_length(p_entry->>'contact_handle') > 250 then raise exception 'INVALID_ENTRY'; end if;
  foreach field in array array['how_we_met','first_impression','favourite_memory','inside_joke','song','three_words','future_message'] loop
    if jsonb_typeof(p_entry->'answers'->field) is distinct from 'string' or char_length(p_entry->'answers'->>field) > 2000 then raise exception 'INVALID_ENTRY'; end if;
  end loop;
  if char_length(btrim(p_entry->'answers'->>'how_we_met')) = 0 or char_length(btrim(p_entry->'answers'->>'favourite_memory')) = 0 then raise exception 'INVALID_ENTRY'; end if;
  if jsonb_typeof(p_media) is distinct from 'array' or jsonb_array_length(p_media) > 3 then raise exception 'INVALID_MEDIA'; end if;
  if (select count(distinct m->>'id') from jsonb_array_elements(p_media) m) <> jsonb_array_length(p_media) then raise exception 'INVALID_MEDIA'; end if;
  if (select count(*) from public.upload_files where attempt_id = p_request_id and active) <> jsonb_array_length(p_media) then raise exception 'INVALID_MEDIA'; end if;
  for item in select * from jsonb_array_elements(p_media) loop
    if char_length(item->>'caption') > 250 or not exists (
      select 1 from public.upload_files where id = (item->>'id')::uuid and attempt_id = p_request_id and active and verified
    ) then raise exception 'INVALID_MEDIA'; end if;
  end loop;
  insert into public.entries (name, nickname, contact_handle, answers, submission_request_id)
  values (btrim(p_entry->>'name'), coalesce(p_entry->>'nickname', ''), coalesce(p_entry->>'contact_handle', ''), p_entry->'answers', p_request_id)
  returning id into entry_id;
  for item in select * from jsonb_array_elements(p_media) loop
    insert into public.entry_media (id, entry_id, storage_path, caption, size_bytes, mime_type, sort_order)
    select id, entry_id, storage_path, coalesce(item->>'caption', ''), size_bytes, mime_type, position from public.upload_files where id = (item->>'id')::uuid;
    position := position + 1;
  end loop;
  update public.submission_attempts set completed_entry_id = entry_id where id = p_request_id;
  return entry_id;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.prepare_uploads(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_entry(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.prepare_uploads(uuid, text, jsonb) to service_role;
grant execute on function public.finalize_entry(uuid, text, jsonb, jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slambook-photos', 'slambook-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Intentionally NO storage.objects policies. Only server-issued, path-scoped upload
-- tokens can upload, and all reads pass through the authenticated owner endpoint.
