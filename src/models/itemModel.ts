import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

export interface ItemDoc {
  _id?: string | ObjectId;
  title: string;
  name?: string;
  shortDescription?: string;
  description?: string;
  fullDescription?: string;
  price: number;
  imageUrl?: string;
  category?: string;
  user: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const itemModel = {
  async findMany(query: any = {}): Promise<ItemDoc[]> {
    const db = getDb();
    return await db.collection<ItemDoc>("items").find(query).sort({ createdAt: -1 }).toArray();
  },

  async create(data: ItemDoc): Promise<ItemDoc> {
    const db = getDb();
    const doc = {
      ...data,
      _id: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection<ItemDoc>("items").insertOne(doc as any);
    return doc;
  },

  async update(id: string, userId: string, updates: Partial<ItemDoc>): Promise<void> {
    const db = getDb();
    let queryId: any = id;
    try { queryId = new ObjectId(id); } catch {}
    await db.collection<ItemDoc>("items").updateOne(
      { _id: queryId, user: userId },
      { $set: { ...updates, updatedAt: new Date() } }
    );
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();
    let queryId: any = id;
    try { queryId = new ObjectId(id); } catch {}
    const res = await db.collection<ItemDoc>("items").deleteOne({ _id: queryId, user: userId });
    return res.deletedCount > 0;
  }
};
