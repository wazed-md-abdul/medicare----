import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/medicare-connect";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export const connectToDatabase = async (): Promise<Db> => {
  if (cachedDb) {
    return cachedDb;
  }
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const database = client.db("test");
  cachedClient = client;
  cachedDb = database;
  return database;
};

export const getDb = (): Db => {
  if (!cachedDb) {
    throw new Error("Database not connected. Call connectToDatabase first.");
  }
  return cachedDb;
};
