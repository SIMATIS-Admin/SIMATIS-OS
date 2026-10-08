-- Audit journal is append-only, for every role including the owner.
CREATE FUNCTION journal_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal est en ajout seul : % interdit', TG_OP;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_no_update_delete BEFORE UPDATE OR DELETE ON journal
  FOR EACH ROW EXECUTE FUNCTION journal_append_only();
--> statement-breakpoint
CREATE TRIGGER journal_no_truncate BEFORE TRUNCATE ON journal
  FOR EACH STATEMENT EXECUTE FUNCTION journal_append_only();
