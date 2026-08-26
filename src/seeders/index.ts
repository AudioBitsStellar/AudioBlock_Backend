import { seedGenres } from './genre.seeder';
import { seedTestDatabase } from './test.seeder';

export async function runSeeders() {
  await seedGenres();
}

export { seedGenres, seedTestDatabase };
