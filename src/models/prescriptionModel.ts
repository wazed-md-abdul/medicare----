import { ObjectId } from "mongodb";
import { getDb } from "../db.js";

export interface PrescriptionDoc {
  _id?: string | ObjectId;
  appointment: string;
  doctor: string;
  patient: string;
  medicines: { name: string; dosage: string; frequency?: string; duration?: string }[];
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const prescriptionModel = {
  async findByAppointment(appointmentId: string): Promise<PrescriptionDoc | null> {
    const db = getDb();
    return await db.collection<PrescriptionDoc>("prescriptions").findOne({ appointment: appointmentId });
  },

  async create(data: PrescriptionDoc): Promise<PrescriptionDoc> {
    const db = getDb();
    const doc = {
      ...data,
      _id: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection<PrescriptionDoc>("prescriptions").insertOne(doc as any);
    return doc;
  }
};
