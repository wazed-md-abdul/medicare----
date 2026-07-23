import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

export interface AppointmentDoc {
  _id?: string | ObjectId;
  patient: string;
  doctor: string;
  date: string;
  time: string;
  symptoms?: string;
  status: "pending" | "accepted" | "rejected" | "completed" | "cancelled";
  prescription?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

export const appointmentModel = {
  async findById(id: string): Promise<AppointmentDoc | null> {
    const db = getDb();
    let queryId: any = id;
    try { queryId = new ObjectId(id); } catch {}
    return await db.collection<AppointmentDoc>("appointments").findOne({ _id: queryId });
  },

  async findMany(query: any = {}, sortOptions: any = { createdAt: -1 }): Promise<AppointmentDoc[]> {
    const db = getDb();
    return await db.collection<AppointmentDoc>("appointments").find(query).sort(sortOptions).toArray();
  },

  async create(data: AppointmentDoc): Promise<AppointmentDoc> {
    const db = getDb();
    const doc = {
      ...data,
      _id: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection<AppointmentDoc>("appointments").insertOne(doc as any);
    return doc;
  },

  async updateStatus(id: string, status: AppointmentDoc["status"]): Promise<void> {
    const db = getDb();
    let queryId: any = id;
    try { queryId = new ObjectId(id); } catch {}
    await db.collection<AppointmentDoc>("appointments").updateOne(
      { _id: queryId },
      { $set: { status, updatedAt: new Date() } }
    );
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb();
    let queryId: any = id;
    try { queryId = new ObjectId(id); } catch {}
    const res = await db.collection<AppointmentDoc>("appointments").deleteOne({ _id: queryId });
    return res.deletedCount > 0;
  },

  async count(query: any = {}): Promise<number> {
    const db = getDb();
    return await db.collection<AppointmentDoc>("appointments").countDocuments(query);
  }
};
