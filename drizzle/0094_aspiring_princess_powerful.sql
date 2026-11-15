CREATE TABLE "ia_archive" (
	"jour" date NOT NULL,
	"heure" timestamp with time zone NOT NULL,
	"origine" text NOT NULL,
	"fournisseur" text NOT NULL,
	"outil" text DEFAULT '' NOT NULL,
	"sujet" text NOT NULL,
	"entree" bigint NOT NULL,
	"sortie" bigint NOT NULL,
	"cache_ecriture" bigint NOT NULL,
	"cache_lecture" bigint NOT NULL,
	"cout" double precision NOT NULL,
	"l5" real,
	"lh" real,
	"estime" boolean NOT NULL,
	CONSTRAINT "ia_archive_heure_origine_fournisseur_sujet_outil_pk" PRIMARY KEY("heure","origine","fournisseur","sujet","outil")
);
--> statement-breakpoint
CREATE TABLE "ia_cumuls" (
	"session_id" text NOT NULL,
	"heure" timestamp with time zone NOT NULL,
	"modele" text NOT NULL,
	"entree" bigint NOT NULL,
	"sortie" bigint NOT NULL,
	"cache_ecriture" bigint NOT NULL,
	"cache_lecture" bigint NOT NULL,
	"cout" double precision NOT NULL,
	CONSTRAINT "ia_cumuls_session_id_heure_modele_pk" PRIMARY KEY("session_id","heure","modele")
);
--> statement-breakpoint
CREATE TABLE "ia_jauges" (
	"fournisseur" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"utilise_5h" real NOT NULL,
	"utilise_hebdo" real NOT NULL,
	"reset_5h" timestamp with time zone,
	"reset_hebdo" timestamp with time zone,
	CONSTRAINT "ia_jauges_fournisseur_at_source_pk" PRIMARY KEY("fournisseur","at","source")
);
--> statement-breakpoint
CREATE TABLE "ia_lancements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moteur" text NOT NULL,
	"session_id" text,
	"cwd" text,
	"debut" timestamp with time zone NOT NULL,
	"sujet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ia_releve" (
	"id" text PRIMARY KEY NOT NULL,
	"dernier_passage" timestamp with time zone NOT NULL,
	"anomalies" integer DEFAULT 0 NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "ia_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"fournisseur" text NOT NULL,
	"outil" text NOT NULL,
	"origine" text NOT NULL,
	"sujet" text NOT NULL,
	"branche" text,
	"titre" text,
	"cwd" text,
	"debut" timestamp with time zone NOT NULL,
	"vu_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ia_cumuls" ADD CONSTRAINT "ia_cumuls_session_id_ia_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ia_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ia_archive_jour_idx" ON "ia_archive" USING btree ("jour");--> statement-breakpoint
CREATE INDEX "ia_cumuls_heure_idx" ON "ia_cumuls" USING btree ("heure");