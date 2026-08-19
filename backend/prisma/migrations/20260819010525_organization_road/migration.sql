-- AlterTable
ALTER TABLE "organization"."organization" ADD COLUMN     "road" VARCHAR(255);

-- AlterTable
ALTER TABLE "organization"."organization_registration_request" ADD COLUMN     "organization_road" VARCHAR(255);
