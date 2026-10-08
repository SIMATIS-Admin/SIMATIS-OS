CREATE TABLE "preferences" (
	"utilisateur" text PRIMARY KEY NOT NULL,
	"favoris" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
