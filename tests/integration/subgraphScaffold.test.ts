import { validateScaffold } from '../../subgraph/scripts/init-scaffold';
import fs from 'fs';
import path from 'path';

describe('Issue #644: Subgraph Project Scaffold Verification', () => {
  const subgraphDir = path.resolve(__dirname, '../../subgraph');

  it('should have valid Graph CLI configuration and manifest structure', () => {
    expect(() => validateScaffold()).not.toThrow();
  });

  it('should contain all required Diamond contract ABIs in subgraph/abis', () => {
    const requiredAbis = [
      'ArtistFacet.json',
      'SongFacet.json',
      'AlbumFacet.json',
      'ERC721Facet.json',
      'RoyaltyFacet.json',
      'MarketplaceFacet.json',
    ];

    requiredAbis.forEach((abi) => {
      const filePath = path.join(subgraphDir, 'abis', abi);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(Array.isArray(content)).toBe(true);
    });
  });

  it('should contain schema.graphql and subgraph.yaml', () => {
    const schemaPath = path.join(subgraphDir, 'schema.graphql');
    const manifestPath = path.join(subgraphDir, 'subgraph.yaml');

    expect(fs.existsSync(schemaPath)).toBe(true);
    expect(fs.existsSync(manifestPath)).toBe(true);

    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    expect(schemaContent).toContain('type Artist @entity');
    expect(schemaContent).toContain('type Track @entity');
  });
});
