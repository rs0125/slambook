-- Store bounded, decoded photos in Postgres. No Storage service-role key is needed.
-- JS dates have millisecond precision; keep export cursor comparisons exact.
alter table public.entries alter column created_at type timestamptz(3);
create table public.upload_blobs (
  id uuid primary key references public.upload_files(id) on delete cascade,
  bytes bytea not null check (octet_length(bytes) between 1 and 2097152)
);
alter table public.upload_blobs enable row level security;
revoke all on public.upload_blobs from public, anon, authenticated;

-- The server has decoded the bytes before calling this function. Recheck the proof,
-- manifest and expiry under the same lock used by prepare/finalize. A retry cannot
-- overwrite a photo or mutate a completed submission.
create function public.store_photo(p_request_id uuid, p_token_hash text, p_file_id uuid, p_bytes bytea)
returns void language plpgsql security definer set search_path = '' as $$
declare attempt public.submission_attempts; photo public.upload_files; open boolean;
begin
  select submissions_open into open from public.settings where id = 1 for share;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into attempt from public.submission_attempts where id = p_request_id for update;
  if not found or attempt.token_hash <> p_token_hash then raise exception 'INVALID_ATTEMPT'; end if;
  if attempt.completed_entry_id is not null then raise exception 'ATTEMPT_COMPLETED'; end if;
  if attempt.expires_at < now() then raise exception 'ATTEMPT_EXPIRED'; end if;
  if open is distinct from true then raise exception 'SUBMISSIONS_CLOSED'; end if;
  select * into photo from public.upload_files where id = p_file_id and attempt_id = p_request_id and active;
  if not found or p_bytes is null or octet_length(p_bytes) <> photo.size_bytes then raise exception 'INVALID_MEDIA'; end if;
  insert into public.upload_blobs (id, bytes) values (p_file_id, p_bytes) on conflict (id) do nothing;
  update public.upload_files set verified = true where id = p_file_id;
end;
$$;
revoke all on function public.store_photo(uuid, text, uuid, bytea) from public, anon, authenticated;

-- A verified flag alone cannot attach missing bytes, even through a maintenance tool.
create function public.check_photo_blob() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.upload_blobs where id = new.id and octet_length(bytes) = new.size_bytes)
    then raise exception 'INVALID_MEDIA'; end if;
  return new;
end;
$$;
revoke all on function public.check_photo_blob() from public, anon, authenticated;
create trigger entry_media_requires_blob before insert on public.entry_media
for each row execute function public.check_photo_blob();

-- Entry deletion, photo bytes and metadata commit together. The attempt receipt
-- deliberately survives so a late retry never recreates a deleted entry.
create function public.delete_entry_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.upload_files where id = old.id;
  return old;
end;
$$;
revoke all on function public.delete_entry_photo() from public, anon, authenticated;
create trigger entry_media_delete_photo after delete on public.entry_media
for each row execute function public.delete_entry_photo();

-- A dedicated backend role, with no access to Supabase Auth or unrelated schemas.
-- Login/password are provisioned separately and never placed in a migration.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'slambook_app') then
    create role slambook_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant usage on schema public to slambook_app;
grant select, update, delete on public.settings, public.entries, public.submission_attempts,
  public.upload_files, public.entry_media, public.rate_limits, public.upload_blobs to slambook_app;
create policy backend_settings on public.settings to slambook_app using (true) with check (true);
create policy backend_entries on public.entries to slambook_app using (true) with check (true);
create policy backend_attempts on public.submission_attempts to slambook_app using (true) with check (true);
create policy backend_uploads on public.upload_files to slambook_app using (true) with check (true);
create policy backend_media on public.entry_media to slambook_app using (true) with check (true);
create policy backend_limits on public.rate_limits to slambook_app using (true) with check (true);
create policy backend_blobs on public.upload_blobs to slambook_app using (true) with check (true);
grant execute on function public.consume_rate_limit(text, integer, integer),
  public.prepare_uploads(uuid, text, jsonb), public.finalize_entry(uuid, text, jsonb, jsonb),
  public.store_photo(uuid, text, uuid, bytea), public.abandoned_uploads(timestamptz, integer),
  public.prune_empty_attempts(timestamptz) to slambook_app;
