import entries from "@/data/seed.json";
import type { SeedPage } from "./model";
export const seedPages = entries as SeedPage[];
export const seedMap = new Map(
  seedPages.map((page) => [page.content.path, page]),
);
