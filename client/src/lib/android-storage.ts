import { registerPlugin } from "@capacitor/core";
import type { Category, StorageEntry } from "./storage-plan";

interface AndroidStoragePlugin {
  pickTree(): Promise<{ name: string }>;
  scan(): Promise<{ name: string; entries: StorageEntry[]; truncated: boolean }>;
  execute(options: { id: string; expectedName: string; expectedSize: number; operation: "move" | "delete"; category?: Category }): Promise<{ success: boolean }>;
}

export const androidStorage = registerPlugin<AndroidStoragePlugin>("VillaStorage");
