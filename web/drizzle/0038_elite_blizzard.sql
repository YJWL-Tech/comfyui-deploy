DO $$ BEGIN
 CREATE TYPE "model_push_status" AS ENUM('pending', 'downloading', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comfyui_deploy"."model_push_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text,
	"model_id" uuid NOT NULL,
	"machine_id" uuid,
	"machine_group_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comfyui_deploy"."model_push_tasks" ADD CONSTRAINT "model_push_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "comfyui_deploy"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comfyui_deploy"."model_push_tasks" ADD CONSTRAINT "model_push_tasks_model_id_volume_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "comfyui_deploy"."volume_models"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comfyui_deploy"."model_push_tasks" ADD CONSTRAINT "model_push_tasks_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "comfyui_deploy"."machines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comfyui_deploy"."model_push_tasks" ADD CONSTRAINT "model_push_tasks_machine_group_id_machine_groups_id_fk" FOREIGN KEY ("machine_group_id") REFERENCES "comfyui_deploy"."machine_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
