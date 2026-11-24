-- =====================================================================
-- Evidence similarity (AI verification integrity, fix 3)
--   * evidence_signatures: a 48-px grayscale signature per evidence item, used to recognise resized,
--     re-encoded and slightly cropped copies. Server-only: no grants to app users. Removed together
--     with the photo (retention, "delete my evidence", commitment deletion, account deletion).
--   * find_duplicate_evidence_v2: like find_duplicate_evidence, but also searches the SAME target
--     (reuse after a failed verdict) and can exclude the proof being re-judged. Reports same_target.
--   * recent_evidence_signatures: the user's most recent signatures for the similarity check.
-- Additive: find_duplicate_evidence (v1) is unchanged, so functions deployed before this
-- migration keep working. Apply this migration BEFORE deploying the new Edge Functions.
-- =====================================================================

create table public.evidence_signatures (
  proof_item_id uuid primary key references public.proof_items (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  signature     text not null check (char_length(signature) between 16 and 4096),
  created_at    timestamptz not null default now()
);
create index evidence_signatures_user_idx on public.evidence_signatures (user_id, created_at desc);
alter table public.evidence_signatures enable row level security;
-- No policies and no grants: only the service role (Edge Functions) reads or writes signatures.
revoke all on public.evidence_signatures from public, anon, authenticated;
grant select, insert, delete on public.evidence_signatures to service_role;

-- A signature is a miniature of the photo: it goes when the photo goes.
create or replace function public.evidence_signatures_on_evidence_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.evidence_deleted_at is not null and old.evidence_deleted_at is null then
    delete from public.evidence_signatures es using public.proof_items pi
     where es.proof_item_id = pi.id and pi.proof_id = new.id;
  end if;
  return new;
end $$;
create trigger proofs_evidence_deleted_signatures after update of evidence_deleted_at on public.proofs
  for each row execute function public.evidence_signatures_on_evidence_deleted();

-- Exact (SHA-256) and dHash matches against ALL of the user's earlier evidence, including earlier
-- submissions for the same target. Never returns another user's evidence.
create or replace function public.find_duplicate_evidence_v2(
  p_user uuid, p_target uuid, p_sha256 text[], p_dhash text[], p_max_distance integer default 6,
  p_exclude_proof uuid default null
) returns table (input_index integer, exact boolean, distance integer, kind text, proof_id uuid,
                 same_target boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with inp as (
    select i::integer as idx, s as sha, d as dh
      from unnest(p_sha256, p_dhash) with ordinality as u(s, d, i)
  )
  select inp.idx - 1, (pi.sha256 = inp.sha) as exact,
         case when pi.sha256 = inp.sha then 0 else public.hash_distance(pi.dhash, inp.dh) end,
         pi.kind, pi.proof_id, (p.target_id = p_target), pi.created_at
    from inp
    join public.proof_items pi on pi.user_id = p_user
    join public.proofs p on p.id = pi.proof_id
   where (p_exclude_proof is null or pi.proof_id <> p_exclude_proof)
     and (pi.sha256 = inp.sha
          or (inp.dh is not null and pi.dhash is not null and public.hash_distance(pi.dhash, inp.dh) <= p_max_distance))
   order by 1, 2 desc, 3
$$;

-- The user's most recent evidence that still has its photo and a signature.
create or replace function public.recent_evidence_signatures(
  p_user uuid, p_target uuid, p_exclude_proof uuid default null, p_limit integer default 400
) returns table (proof_item_id uuid, proof_id uuid, kind text, storage_path text, signature text,
                 same_target boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select pi.id, pi.proof_id, pi.kind, pi.storage_path, es.signature, (p.target_id = p_target), pi.created_at
    from public.evidence_signatures es
    join public.proof_items pi on pi.id = es.proof_item_id and pi.user_id = p_user
    join public.proofs p on p.id = pi.proof_id
   where es.user_id = p_user
     and p.evidence_deleted_at is null
     and (p_exclude_proof is null or pi.proof_id <> p_exclude_proof)
   order by es.created_at desc
   limit least(greatest(p_limit, 1), 1000)
$$;

revoke all on function public.find_duplicate_evidence_v2(uuid, uuid, text[], text[], integer, uuid),
  public.recent_evidence_signatures(uuid, uuid, uuid, integer),
  public.evidence_signatures_on_evidence_deleted()
  from public, anon, authenticated;
grant execute on function public.find_duplicate_evidence_v2(uuid, uuid, text[], text[], integer, uuid),
  public.recent_evidence_signatures(uuid, uuid, uuid, integer)
  to service_role;
