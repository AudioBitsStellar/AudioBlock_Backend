import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEntities1715000000000 implements MigrationInterface {
    name = 'AddEntities1715000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(\`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" character varying NOT NULL, "userId" uuid NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "revoked" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "familyId" character varying, CONSTRAINT "UQ_7190d6eefb40fa978ce22efd8ea" UNIQUE ("token"), CONSTRAINT "PK_5d69134bc2e316a3a40994a329d" PRIMARY KEY ("id"))\`);
        await queryRunner.query(\`CREATE INDEX "IDX_8e913e288156c133999341156a" ON "refresh_tokens" ("userId") \`);
        await queryRunner.query(\`CREATE TABLE "activity_feed" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "actionType" character varying NOT NULL, "targetId" character varying NOT NULL, "targetType" character varying NOT NULL, "metadata" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8e3f64c67bd13437e5c54c30c00" PRIMARY KEY ("id"))\`);
        await queryRunner.query(\`CREATE INDEX "IDX_c191a61327170dbcd5449e37bc" ON "activity_feed" ("userId", "createdAt") \`);
        await queryRunner.query(\`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_8e913e288156c133999341156ad" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION\`);
        await queryRunner.query(\`ALTER TABLE "activity_feed" ADD CONSTRAINT "FK_9066661a357591e1d085950153c" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION\`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(\`ALTER TABLE "activity_feed" DROP CONSTRAINT "FK_9066661a357591e1d085950153c"\`);
        await queryRunner.query(\`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_8e913e288156c133999341156ad"\`);
        await queryRunner.query(\`DROP INDEX "public"."IDX_c191a61327170dbcd5449e37bc"\`);
        await queryRunner.query(\`DROP TABLE "activity_feed"\`);
        await queryRunner.query(\`DROP INDEX "public"."IDX_8e913e288156c133999341156a"\`);
        await queryRunner.query(\`DROP TABLE "refresh_tokens"\`);
    }
}
