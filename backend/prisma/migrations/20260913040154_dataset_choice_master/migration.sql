-- CreateTable
CREATE TABLE "administration"."dataset_choice" (
    "id" UUID NOT NULL,
    "field_key" VARCHAR(64) NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "label_th" VARCHAR(255) NOT NULL,
    "label_en" VARCHAR(255),
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "dataset_choice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dataset_choice_field_key_is_active_display_order_idx" ON "administration"."dataset_choice"("field_key", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_choice_field_key_code_key" ON "administration"."dataset_choice"("field_key", "code");
