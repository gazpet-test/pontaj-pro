-- LOCAL ONLY. Emulate pg_cron API/catalog, never a conditional in production SQL.
DO $$ BEGIN IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (
 jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, jobname text UNIQUE NOT NULL,
 schedule text NOT NULL, command text NOT NULL, username text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; BEGIN
 INSERT INTO cron.job(jobname,schedule,command,username) VALUES($1,$2,$3,current_user) RETURNING jobid INTO v_id;
 RETURN v_id;
END $$;
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN DELETE FROM cron.job WHERE jobname=$1 AND username=current_user; RETURN FOUND; END $$;
REVOKE ALL ON SCHEMA cron FROM PUBLIC;
REVOKE ALL ON FUNCTION cron.schedule(text,text,text),cron.unschedule(text) FROM PUBLIC;
