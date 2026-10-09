CREATE TABLE "postes" (
	"nom" text PRIMARY KEY NOT NULL,
	"vu_le" timestamp with time zone NOT NULL,
	"claude" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL
);
