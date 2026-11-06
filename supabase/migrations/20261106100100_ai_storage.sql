-- Storage rules for evidence (applied on the platform only; the local test database has no storage schema).
-- @platform-only
-- The proofs bucket is private and accepts only JPEG images up to 6 MB.
update storage.buckets set file_size_limit = 6291456, allowed_mime_types = array['image/jpeg'] where id = 'proofs';
