import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

export interface UserDoc {
  _id: string | ObjectId;
  name: string;
  email: string;
  role: "patient" | "doctor" | "admin";
  image?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const userModel = {
  async findById(id: string): Promise<UserDoc | null> {
    const db = getDb();
    try {
      return await db.collection<UserDoc>("users").findOne({ _id: new ObjectId(id) as any });
    } catch {
      return await db.collection<UserDoc>("users").findOne({ _id: id as any });
    }
  },

  async findByEmail(email: string): Promise<UserDoc | null> {
    const db = getDb();
    return await db.collection<UserDoc>("users").findOne({ email });
  },

  async findMany(query: any = {}): Promise<UserDoc[]> {
    const db = getDb();
    return await db.collection<UserDoc>("users").find(query).toArray();
  },

  async upsert(id: string, data: Partial<UserDoc>): Promise<void> {
    const db = getDb();
    await db.collection<UserDoc>("users").updateOne(
      { _id: id as any },
      { $set: { ...data, updatedAt: new Date() } },
      { upsert: true }
    );
  }
};
