-- Wait 26 hours: a 24-hour attempt plus the last signed upload token's 2-hour TTL.
-- Referenced photos and completed-attempt receipts are never pruned.
create function public.abandoned_uploads(p_before timestamptz, p_limit integer)
returns table (id uuid, storage_path text) language sql security definer set search_path = '' as $$
  select f.id, f.storage_path from public.upload_files f
  join public.submission_attempts a on a.id = f.attempt_id
  where a.created_at < least(p_before, now() - interval '26 hours')
    and not exists (select 1 from public.entry_media m where m.id = f.id)
  order by f.created_at limit least(p_limit, 100);
$$;
create function public.prune_empty_attempts(p_before timestamptz)
returns void language sql security definer set search_path = '' as $$
  delete from public.submission_attempts a where a.created_at < least(p_before, now() - interval '26 hours')
    and a.completed_entry_id is null and not exists(select 1 from public.upload_files f where f.attempt_id = a.id);
$$;
revoke all on function public.abandoned_uploads(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.prune_empty_attempts(timestamptz) from public, anon, authenticated;
grant execute on function public.abandoned_uploads(timestamptz, integer) to service_role;
grant execute on function public.prune_empty_attempts(timestamptz) to service_role;
