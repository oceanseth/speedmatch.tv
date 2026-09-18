-- Link Better Auth accounts ("user".id, text) to our uuid users rows.
-- Decision from the #18 review thread: tournaments.user_id stays uuid; the
-- app users table carries the mapping. One app user per account.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id text UNIQUE;

COMMIT;
