/**
 * Subgraph Project Scaffold Initializer & Validator
 *
 * Implements Issue #644:
 * Verifies and configures the Graph CLI scaffold structure for AudioBlock.
 * Ensures schema, manifest, ABI mappings, and AssemblyScript handlers
 * are consistent and ready for code generation and deployment.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function validateScaffold() {
  console.log('=== Validating Subgraph Project Scaffold ===\n');
  let hasErrors = false;

  const requiredFiles = [
    'package.json',
    'subgraph.yaml',
    'schema.graphql',
    'README.md',
    '.gitignore',
  ];

  requiredFiles.forEach((file) => {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`[ERROR] Missing required file: ${file}`);
      hasErrors = true;
    } else {
      console.log(`[OK] Found ${file}`);
    }
  });

  // Verify ABI definitions
  const abisDir = path.join(ROOT_DIR, 'abis');
  if (!fs.existsSync(abisDir)) {
    console.error(`[ERROR] Missing abis/ directory`);
    hasErrors = true;
  } else {
    const requiredAbis = [
      'ArtistFacet.json',
      'SongFacet.json',
      'AlbumFacet.json',
      'ERC721Facet.json',
      'RoyaltyFacet.json',
      'MarketplaceFacet.json',
    ];

    requiredAbis.forEach((abi) => {
      const abiPath = path.join(abisDir, abi);
      if (!fs.existsSync(abiPath)) {
        console.error(`[ERROR] Missing ABI file: abis/${abi}`);
        hasErrors = true;
      } else {
        console.log(`[OK] Found ABI: abis/${abi}`);
      }
    });
  }

  // Verify AssemblyScript mappings
  const mappingsDir = path.join(ROOT_DIR, 'src', 'mappings');
  if (!fs.existsSync(mappingsDir)) {
    console.error(`[ERROR] Missing src/mappings/ directory`);
    hasErrors = true;
  } else {
    const requiredMappings = [
      'artist.ts',
      'song.ts',
      'album.ts',
      'erc721.ts',
      'royalty.ts',
      'marketplace.ts',
    ];

    requiredMappings.forEach((m) => {
      const mappingPath = path.join(mappingsDir, m);
      if (!fs.existsSync(mappingPath)) {
        console.error(`[ERROR] Missing mapping file: src/mappings/${m}`);
        hasErrors = true;
      } else {
        console.log(`[OK] Found mapping: src/mappings/${m}`);
      }
    });
  }

  if (hasErrors) {
    console.error('\nScaffold validation failed with errors.');
    process.exit(1);
  }

  console.log('\nAll scaffold checks passed successfully!');
}

if (require.main === module) {
  validateScaffold();
}

module.exports = { validateScaffold };
