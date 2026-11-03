-- @platform-only (pg_net): skipped by the local test runner
-- pg_net belongs in the extensions schema (its functions live in schema "net" either way).
drop extension if exists pg_net;
create extension pg_net with schema extensions;
-- cfg only reads public configuration: no need for definer rights.
alter function public.cfg(text) security invoker;
