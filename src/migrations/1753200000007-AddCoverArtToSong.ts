import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds cover art IPFS fields to the songs table (Issue #80).
 *
 * coverArtIpfsHash holds the Pinata CID of the full-size cover, and
 * coverArtThumbnails (JSON) maps size keys ('150', '300', '600') to the
 * gateway URLs of the generated thumbnail variants. Both are nullable so
 * existing songs without cover art keep working.
 */
export class AddCoverArtToSong1753200000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'songs',
      new TableColumn({
        name: 'coverArtIpfsHash',
        type: 'varchar',
        length: '200',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'songs',
      new TableColumn({
        name: 'coverArtThumbnails',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('songs', 'coverArtThumbnails');
    await queryRunner.dropColumn('songs', 'coverArtIpfsHash');
  }
}
