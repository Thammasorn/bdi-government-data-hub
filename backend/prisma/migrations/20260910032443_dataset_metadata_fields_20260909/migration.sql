-- AlterTable
ALTER TABLE "dataset"."dataset_metadata" ADD COLUMN     "allow_transformed_raw_data_sharing_specified_platforms" VARCHAR(1000),
ADD COLUMN     "data_fields" VARCHAR(1000),
ADD COLUMN     "geo_coverage_other" VARCHAR(300);

-- AlterTable
ALTER TABLE "dataset"."dataset_registration_metadata" ADD COLUMN     "allow_transformed_raw_data_sharing_specified_platforms" VARCHAR(1000),
ADD COLUMN     "data_fields" VARCHAR(1000),
ADD COLUMN     "geo_coverage_other" VARCHAR(300);
