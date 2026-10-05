-- CreateIndex
CREATE INDEX "audit_event_occurred_at_id_idx" ON "audit"."audit_event"("occurred_at", "id");
