import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { TweetDraft } from '../entities/TweetDraft';
import { Song } from '../entities/Song';
import { User } from '../entities/User';
import { AppError } from '../errors/AppError';
import { isAiFeatureEnabled } from '../config/aiFeatureFlags';
import { getAiProvider } from './ai';

function buildReleaseUrl(songId: string): string {
  const baseUrl =
    process.env.APP_URL ||
    process.env.FRONTEND_URLS?.split(',')[0] ||
    'https://audioblock.example.com';
  return `${baseUrl.replace(/\/$/, '')}/song/${songId}`;
}

/**
 * Drafts a tweet for a new release using the AI provider abstraction, for
 * the artist to review and approve before posting it themselves.
 *
 * Deliberately does NOT post to Twitter: twitterRoutes.ts never persists
 * Twitter access/refresh tokens (see the OAuth callback there), so there is
 * no credential to post with. Approving a draft only marks it reviewed —
 * the artist copies the approved text and posts it manually.
 */
export class TweetDraftService {
  private draftRepo: Repository<TweetDraft>;
  private songRepo: Repository<Song>;
  private userRepo: Repository<User>;

  constructor() {
    this.draftRepo = AppDataSource.getRepository(TweetDraft);
    this.songRepo = AppDataSource.getRepository(Song);
    this.userRepo = AppDataSource.getRepository(User);
  }

  async createDraft(userId: string, songId?: string): Promise<TweetDraft> {
    if (!isAiFeatureEnabled('tweetDrafts')) {
      throw AppError.businessLogic(
        'The tweet-draft AI feature is not enabled',
        undefined,
        'AI_FEATURE_DISABLED',
      );
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    let title = 'a new release';
    let releaseUrl: string | undefined;

    if (songId) {
      const song = await this.songRepo.findOneBy({ id: songId });
      if (!song) {
        throw AppError.notFound('Song not found', undefined, 'SONG_NOT_FOUND');
      }
      if (song.artistId !== userId) {
        throw AppError.authorization(
          'You can only draft a tweet for your own song',
          undefined,
          'NOT_SONG_OWNER',
        );
      }
      title = song.title;
      releaseUrl = buildReleaseUrl(song.id);
    }

    const artistName = user.name || user.twitterDisplayName || user.username || 'The artist';
    const provider = getAiProvider();
    const { text } = await provider.draftTweet({ songId, title, artistName, releaseUrl });

    const draft = this.draftRepo.create({
      userId,
      songId,
      text,
      status: 'pending_review',
      provider: provider.name,
    });

    return this.draftRepo.save(draft);
  }

  async listDrafts(userId: string): Promise<TweetDraft[]> {
    return this.draftRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /** Marks a draft approved by the artist. Does not post it — see class docs. */
  async approveDraft(userId: string, draftId: string): Promise<TweetDraft> {
    const draft = await this.getOwnedDraft(userId, draftId);

    draft.status = 'approved';
    draft.approvedAt = new Date();
    return this.draftRepo.save(draft);
  }

  async discardDraft(userId: string, draftId: string): Promise<void> {
    const draft = await this.getOwnedDraft(userId, draftId);
    await this.draftRepo.remove(draft);
  }

  private async getOwnedDraft(userId: string, draftId: string): Promise<TweetDraft> {
    const draft = await this.draftRepo.findOneBy({ id: draftId });
    if (!draft || draft.userId !== userId) {
      throw AppError.notFound('Tweet draft not found');
    }
    return draft;
  }
}
