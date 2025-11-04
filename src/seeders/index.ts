import { seedGenres } from "./genre.seeder";

export async function runSeeders() {
  await seedGenres();
}
