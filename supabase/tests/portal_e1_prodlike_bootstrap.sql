-- LOCAL ONLY: cluster efemer PG17, initializat cu -U supabase_admin.
CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE BYPASSRLS INHERIT NOCREATEDB;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT;
GRANT anon,authenticated,service_role TO authenticator;
-- Fixture setup poate construi schema auth; livrarea ramane postgres NOSUPERUSER.
-- SET numai pentru teste, fara mostenire care sa mascheze granturi lipsa.
GRANT supabase_auth_admin TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET TRUE;
GRANT anon,authenticated,service_role,authenticator TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET TRUE;
CREATE DATABASE portal_e1_test OWNER postgres;
