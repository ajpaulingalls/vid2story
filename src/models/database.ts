import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

// Initialize SQLite database
export const sqlite = new Database('sqlite.db');

// Create Drizzle instance
export const db = drizzle(sqlite);
