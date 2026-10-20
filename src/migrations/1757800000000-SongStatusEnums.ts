import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts songs.status and songs.mintStatus from plain varchar columns to
 * proper PostgreSQL enum types, and adds the missing 'minting' value to
 * mintStatus so the full lifecycle (not_minted → pending → minting → minted /
 * failed) is enforced at the database level. (#790)
 */
export class SongStatusEnums1757800000000 implements MigrationInterface {
  name = 'SongStatusEnums1757800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the enum types if they don't already exist.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE song_status_enum AS ENUM ('processing', 'ready', 'failed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE song_mint_status_enum AS ENUM (
          'not_minted', 'pending', 'minting', 'minted', 'failed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Migrate the columns. USING casts the existing string values to the enum.
    await queryRunner.query(`
      ALTER TABLE songs
        ALTER COLUMN status TYPE song_status_enum
          USING status::song_status_enum,
        ALTER COLUMN "mintStatus" TYPE song_mint_status_enum
          USING "mintStatus"::song_mint_status_enum;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE songs
        ALTER COLUMN status TYPE varchar USING status::varchar,
        ALTER COLUMN "mintStatus" TYPE varchar USING "mintStatus"::varchar;
    `);

    await queryRunner.query(`DROP TYPE IF EXISTS song_status_enum;`);
    await queryRunner.query(`DROP TYPE IF EXISTS song_mint_status_enum;`);
  }
}
