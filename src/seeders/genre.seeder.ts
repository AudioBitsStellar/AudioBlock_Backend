import AppDataSource from "../config/db";
import { Genre } from "../entities/Genre";

export async function seedGenres() {
  const genreRepo = AppDataSource.getRepository(Genre);
  const count = await genreRepo.count();
  if (count > 0) {
    console.log("⚠️  Genres already seeded, skipping...");
    return;
  }

  const genres = [
    "Pop",
    "Hip-Hop",
    "R&B",
    "Afrobeat",
    "Reggae",
    "Dancehall",
    "Rock",
    "Electronic",
    "House",
    "Techno",
    "Gospel",
    "Country",
    "Jazz",
    "Blues",
    "Folk",
    "Indie",
    "Soul",
    "Trap",
    "Amapiano",
    "Latin",
  ];

  // Avoid inserting duplicates
  for (const name of genres) {
    const exists = await genreRepo.findOne({ where: { name } });
    if (!exists) {
      const genre = genreRepo.create({ name });
      await genreRepo.save(genre);
      console.log(`✅ Added genre: ${name}`);
    } else {
      console.log(`⚠️  Genre already exists: ${name}`);
    }
  }

  
  console.log("🎵 Genre seeding complete!");
}
