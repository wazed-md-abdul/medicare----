import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

export interface DoctorDoc {
  _id: string | ObjectId;
  user: string;
  name?: string;
  specialization: string;
  biography?: string;
  hospital?: string;
  experience?: number;
  consultationFee?: number;
  rating?: number;
  reviewsCount?: number;
  isVerified?: boolean;
  verificationStatus?: "unverified" | "pending_verification" | "verified" | "rejected";
  diplomaName?: string;
  licenseNumber?: string;
  certificateUrl?: string;
  avatar?: string;
  reports?: string[];
  availability?: { day: string; slots: string[] }[];
  createdAt?: Date;
  updatedAt?: Date;
}

export const doctorModel = {
  async findById(id: string): Promise<DoctorDoc | null> {
    const db = getDb();
    try {
      return await db.collection<DoctorDoc>("doctors").findOne({ _id: new ObjectId(id) as any });
    } catch {
      return await db.collection<DoctorDoc>("doctors").findOne({ _id: id as any });
    }
  },

  async findByUserId(userId: string): Promise<DoctorDoc | null> {
    const db = getDb();
    return await db.collection<DoctorDoc>("doctors").findOne({ user: userId });
  },

  async findMany(query: any = {}, sortOptions: any = {}, skip = 0, limit = 50): Promise<DoctorDoc[]> {
    const db = getDb();
    return await db.collection<DoctorDoc>("doctors")
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .toArray();
  },

  async count(query: any = {}): Promise<number> {
    const db = getDb();
    return await db.collection<DoctorDoc>("doctors").countDocuments(query);
  },

  async update(id: string, updates: Partial<DoctorDoc>): Promise<void> {
    const db = getDb();
    let queryId: any = id;
    try { queryId = new ObjectId(id); } catch {}
    await db.collection<DoctorDoc>("doctors").updateOne(
      { _id: queryId },
      { $set: { ...updates, updatedAt: new Date() } }
    );
  },

  async upsert(id: string, data: Partial<DoctorDoc>): Promise<void> {
    const db = getDb();
    await db.collection<DoctorDoc>("doctors").updateOne(
      { _id: id as any },
      { $set: { ...data, updatedAt: new Date() } },
      { upsert: true }
    );
  }
};
