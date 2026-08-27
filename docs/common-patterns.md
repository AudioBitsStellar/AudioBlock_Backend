# Common Architectural & Development Patterns

This guide provides practical, step-by-step instructions for adding new endpoints, entities, services, and background workers in `AudioBlock_Backend`, along with common debugging tips and development pitfalls.

---

## 1. How to Add a New API Endpoint

To add a new feature endpoint (e.g. `POST /api/songs/:id/like`), follow these 5 steps:

### Step 1: Create or Update Request DTO (`src/dtos/LikeSongDto.ts`)
```typescript
import { IsUUID, IsNotEmpty } from 'class-validator';

export class LikeSongDto {
  @IsUUID()
  @IsNotEmpty()
  songId!: string;
}
```

### Step 2: Add Service Method (`src/services/SongService.ts`)
```typescript
async likeSong(userId: string, songId: string): Promise<void> {
  const song = await this.songRepository.findOneBy({ id: songId });
  if (!song) {
    throw AppError.notFound('Song not found');
  }
  // Execute business logic (e.g., record like entry)
}
```

### Step 3: Add Controller Handler (`src/controllers/SongController.ts`)
```typescript
likeSong = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { songId } = req.body;
    await this.songService.likeSong(userId, songId);
    res.status(200).json({ success: true, message: 'Song liked successfully' });
  } catch (error) {
    handleError(req, res, error);
  }
};
```

### Step 4: Wire Route in Express Router (`src/routes/songRoutes.ts`)
```typescript
import { validateDTO } from '../middlewares/validate';
import { LikeSongDto } from '../dtos/LikeSongDto';

router.post(
  '/:id/like',
  authMiddleware,
  validateDTO(LikeSongDto),
  songController.likeSong,
);
```

### Step 5: Register Route in `src/app.ts` (if creating a new router file)
```typescript
app.use('/api/songs', songRouter);
```

---

## 2. How to Add a New Database Entity & Migration

### Step 1: Create Entity Class (`src/entities/Playlist.ts`)
```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './User';

@Entity('playlists')
export class Playlist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
```

### Step 2: Register Entity in `src/config/db.ts`
Add `Playlist` to the `entities` array of `AppDataSource`.

### Step 3: Create & Run Migration
```bash
# Generate migration automatically based on entity diff
npm run migration:generate -- src/migrations/AddPlaylistTable

# Run pending migrations
npm run migration:run
```

---

## 3. How to Implement a New Service & Register in Container

### Step 1: Create Service (`src/services/PlaylistService.ts`)
```typescript
import { AppDataSource } from '../config/db';
import { Playlist } from '../entities/Playlist';

export class PlaylistService {
  private playlistRepo = AppDataSource.getRepository(Playlist);

  async createPlaylist(userId: string, name: string): Promise<Playlist> {
    const playlist = this.playlistRepo.create({ userId, name });
    return await this.playlistRepo.save(playlist);
  }
}
```

### Step 2: Register Service in Dependency Injection Container (`src/container.ts`)
```typescript
import { PlaylistService } from './services/PlaylistService';

// Register instance in container
container.register('PlaylistService', new PlaylistService());
```

---

## 4. How to Create a Background Worker / Job

### Step 1: Define Job Type & Handler (`src/jobs/handlers/emailHandler.ts`)
```typescript
export async function processEmailJob(data: { email: string; subject: string; body: string }): Promise<void> {
  // Send email logic via Nodemailer/SendGrid
}
```

### Step 2: Dispatch Job to Queue (`src/services/UserService.ts`)
```typescript
import { queueManager } from '../workers/QueueManager';

await queueManager.addJob('send_email', {
  email: user.email,
  subject: 'Welcome to AudioBlock',
  body: 'Thank you for joining!',
});
```

---

## 5. Development Tips, Testing & Troubleshooting

### Debugging with VS Code
Use the pre-configured `.vscode/launch.json` configuration to attach the Node debugger:
1. Open the Debug tab in VS Code.
2. Select **"Debug Backend (ts-node-dev)"**.
3. Set breakpoints inside controllers or services.

### Running Unit & Integration Tests
```bash
# Run full test suite with Jest
npm test

# Run tests in watch mode
npm run test:watch

# Run a specific test file
npx jest src/middlewares/__tests__/validate.test.ts
```

### Common Development Pitfalls
1. **Circular Dependencies**: Do not directly instantiate `ServiceA` inside `ServiceB` constructor. Use `container.ts` or `ServiceRegistry.ts`.
2. **Missing `await` on Database Operations**: Forgetting `await` on TypeORM calls will swallow errors or leak unhandled promises.
3. **Exposing Sensitive Fields in Responses**: Always omit `passwordHash`, `twoFactorSecret`, or tokens before returning `User` entities.
