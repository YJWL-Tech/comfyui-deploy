CREATE TABLE IF NOT EXISTS "comfyui_deploy"."machine_group_members" (
	"machine_id" uuid NOT NULL,
	"group_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comfyui_deploy"."machine_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comfyui_deploy"."deployments" ALTER COLUMN "machine_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comfyui_deploy"."deployments" ADD COLUMN "machine_group_id" uuid;--> statement-breakpoint
ALTER TABLE "comfyui_deploy"."machines" ADD COLUMN "operational_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "comfyui_deploy"."machines" ADD COLUMN "allow_comfyui_queue_size" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "comfyui_deploy"."machines" ADD COLUMN "current_queue_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comfyui_deploy"."deployments" ADD CONSTRAINT "deployments_machine_group_id_machine_groups_id_fk" FOREIGN KEY ("machine_group_id") REFERENCES "comfyui_deploy"."machine_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comfyui_deploy"."machine_group_members" ADD CONSTRAINT "machine_group_members_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "comfyui_deploy"."machines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comfyui_deploy"."machine_group_members" ADD CONSTRAINT "machine_group_members_group_id_machine_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "comfyui_deploy"."machine_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comfyui_deploy"."machine_groups" ADD CONSTRAINT "machine_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "comfyui_deploy"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
