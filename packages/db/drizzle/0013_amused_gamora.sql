ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ALTER COLUMN "CHR_DO_NO" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ALTER COLUMN "INT_YEAR" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ALTER COLUMN "INT_SERIAL" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ALTER COLUMN "DTM_ISSUED_AT" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ADD COLUMN "FLG_INTERCOMPANY" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ADD COLUMN "DTM_PREPARED_AT" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ADD COLUMN "DTM_DRIVER_SCANNED_AT" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ADD COLUMN "INT_DRIVER_SCANNED_BY_ID" bigint;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ADD COLUMN "DTM_SHIPPED_AT" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "logistics"."TT_DELIVERY_ORDER" ADD CONSTRAINT "TT_DELIVERY_ORDER_INT_DRIVER_SCANNED_BY_ID_TM_USER_INT_ID_fk" FOREIGN KEY ("INT_DRIVER_SCANNED_BY_ID") REFERENCES "org"."TM_USER"("INT_ID") ON DELETE no action ON UPDATE no action;