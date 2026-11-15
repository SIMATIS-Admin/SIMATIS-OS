CREATE TABLE "ia_archive_jours" (
	"jour" date PRIMARY KEY NOT NULL,
	"archive_le" timestamp with time zone DEFAULT now() NOT NULL
);
