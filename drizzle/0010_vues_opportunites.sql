-- Read-only views for requete_lecture (same rules as 0006: explicit instance filter, security_barrier).
CREATE VIEW v_opportunites WITH (security_barrier = true) AS
  SELECT id, entreprise_id, contact_id, titre, etape, montant, echeance, clos, motif, origine,
    potentiel, faisabilite, prochaine_etape, source, created_at, updated_at
  FROM opportunites WHERE instance_id = app_current_instance();
--> statement-breakpoint
CREATE VIEW v_taches WITH (security_barrier = true) AS
  SELECT id, opportunite_id, contact_id, titre, canal, echeance, fait_at, prepare, source, created_at
  FROM taches WHERE instance_id = app_current_instance();
