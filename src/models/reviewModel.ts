import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

export interface ReviewDoc {
  _id?: string | ObjectId;
  doctor: string;
  patient: string;
  rating: number;
  comment: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const reviewModel = {
  async findOne(doctor: string, patient: string): Promise<ReviewDoc | null> {
    const db = getDb();
    return await db.collection<ReviewDoc>("reviews").findOne({ doctor, patient });
  },

  async create(data: ReviewDoc): Promise<ReviewDoc> {
    const db = getDb();
    const doc = {
      ...data,
      _id: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection<ReviewDoc>("reviews").insertOne(doc as any);
    return doc;
  }
};
