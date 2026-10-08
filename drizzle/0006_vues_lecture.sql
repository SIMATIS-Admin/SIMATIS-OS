-- Read-only views for the MCP tool requete_lecture. They run with the owner's rights (which bypass
-- Row-Level Security), so each one filters on the instance of the context itself; security_barrier
-- applies that filter before any condition written by the agent, so nothing leaks through errors.
CREATE FUNCTION app_current_instance() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.instance_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE VIEW v_entreprises WITH (security_barrier = true) AS
  SELECT id, nom, secteur, ville, taille, domaine, source, created_at, updated_at
  FROM entreprises WHERE instance_id = app_current_instance();
--> statement-breakpoint
CREATE VIEW v_contacts WITH (security_barrier = true) AS
  SELECT id, entreprise_id, nom, fonction, email, telephone, role, source, created_at, updated_at
  FROM contacts WHERE instance_id = app_current_instance();
--> statement-breakpoint
CREATE VIEW v_propositions WITH (security_barrier = true) AS
  SELECT id, type, contenu, auteur, statut, niveau, decide_par, decide_at, created_at
  FROM propositions WHERE instance_id = app_current_instance();
--> statement-breakpoint
CREATE VIEW v_journal WITH (security_barrier = true) AS
  SELECT id, at, acteur, action, niveau, details
  FROM journal WHERE instance_id = app_current_instance();
