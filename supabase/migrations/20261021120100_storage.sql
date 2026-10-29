-- Private bucket for proof photos. Only the verify-proof function (service role) writes.
-- Users may read their own photos: objects live under "<user_id>/<target_id>/<proof_id>.jpg".
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

create policy "proofs: owner can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);
