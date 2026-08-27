import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { User } from '../entities/User';

export interface OpenGraphData {
  title: string;
  description: string;
  image?: string;
  url: string;
  type: string;
}

export interface JsonLdData {
  '@context': string;
  '@type': string;
  name: string;
  description?: string;
  image?: string;
  url: string;
  sameAs?: string[];
}

export interface ArtistMetadataResponse {
  openGraph: OpenGraphData;
  jsonLd: JsonLdData;
  profile: {
    id: string;
    username?: string;
    name?: string;
    bio?: string;
    profileImage?: string;
    pageCover?: string;
    website?: string;
    twitterUsername?: string;
  };
}

export class ArtistMetadataService {
  private userRepo: Repository<User>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
  }

  // eslint-disable-next-line complexity -- existing method tracked in docs/refactoring_priority.md
  async getArtistMetadata(artistId: string): Promise<ArtistMetadataResponse> {
    const user = await this.userRepo.findOne({ where: { id: artistId } });
    if (!user) throw new Error('Artist not found');

    // Even if role is listener, we allow metadata — but prefer artist. If you want to restrict:
    // if (user.role !== "artist" && user.role !== "admin") throw new Error("Artist not found");

    const displayName = user.name || user.username || 'Artist';
    const bio = user.bio || `${displayName} on AudioBlock`;
    const image = user.profileImage || undefined;
    const baseUrl =
      process.env.APP_URL ||
      process.env.FRONTEND_URLS?.split(',')[0] ||
      'https://audioblock.example.com';
    const profileUrl = `${baseUrl.replace(/\/$/, '')}/artist/${user.id}`;

    const sameAs: string[] = [];
    if (user.website) sameAs.push(user.website);
    if (user.twitterUsername) sameAs.push(`https://twitter.com/${user.twitterUsername}`);
    if (user.twitterId)
      sameAs.push(`https://twitter.com/${user.twitterUsername || user.twitterId}`);

    const openGraph: OpenGraphData = {
      title: displayName,
      description: bio,
      image,
      url: profileUrl,
      type: 'profile',
    };

    const jsonLd: JsonLdData = {
      '@context': 'https://schema.org',
      '@type': 'MusicGroup',
      name: displayName,
      description: bio,
      image,
      url: profileUrl,
      sameAs: sameAs.length > 0 ? sameAs : undefined,
    };

    // Only expose public fields — explicitly whitelist to avoid leaking private data
    const profile = {
      id: user.id,
      username: user.username || undefined,
      name: user.name || undefined,
      bio: user.bio || undefined,
      profileImage: user.profileImage || undefined,
      pageCover: user.pageCover || undefined,
      website: user.website || undefined,
      twitterUsername: user.twitterUsername || undefined,
    };

    return { openGraph, jsonLd, profile };
  }

  async getArtistMetadataHtml(artistId: string): Promise<string> {
    const meta = await this.getArtistMetadata(artistId);
    const { openGraph, jsonLd } = meta;
    const tags = [
      `<meta property="og:title" content="${escapeHtml(openGraph.title)}" />`,
      `<meta property="og:description" content="${escapeHtml(openGraph.description)}" />`,
      openGraph.image
        ? `<meta property="og:image" content="${escapeHtml(openGraph.image)}" />`
        : '',
      `<meta property="og:url" content="${escapeHtml(openGraph.url)}" />`,
      `<meta property="og:type" content="${escapeHtml(openGraph.type)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${escapeHtml(openGraph.title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(openGraph.description)}" />`,
      openGraph.image
        ? `<meta name="twitter:image" content="${escapeHtml(openGraph.image)}" />`
        : '',
      `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
    ]
      .filter(Boolean)
      .join('\n    ');
    return tags;
  }
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default ArtistMetadataService;
