import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { doctorService } from "../services/doctorService.js";
import { doctorModel } from "../models/doctorModel.js";

export const doctorController = {
  async getDirectory(req: Request, res: Response) {
    try {
      const data = await doctorService.getDoctorDirectory(req.query);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  async getProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      let doctorProfile = await doctorModel.findByUserId(req.user.id);
      if (!doctorProfile) {
        await doctorModel.upsert(`doc_${req.user.id}`, {
          user: req.user.id,
          name: req.user.name,
          specialization: "General Practice",
          biography: "Certified medical imaging practitioner.",
          hospital: "Studycast Medical Center",
          experience: 5,
          consultationFee: 150,
          isVerified: true,
          availability: [
            { day: "Monday", slots: ["09:00", "10:30", "14:00", "15:30"] },
            { day: "Wednesday", slots: ["09:00", "10:30", "14:00", "15:30"] },
            { day: "Friday", slots: ["09:00", "10:30", "14:00", "15:30"] }
          ]
        });
        doctorProfile = await doctorModel.findByUserId(req.user.id);
      }
      res.json({ doctorProfile });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  async updateProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const doctorProfile = await doctorModel.findByUserId(req.user.id);
      if (!doctorProfile) return res.status(404).json({ error: "Doctor profile not found" });

      await doctorModel.update(doctorProfile._id.toString(), req.body);
      const updated = await doctorModel.findByUserId(req.user.id);
      res.json({ message: "Doctor profile updated successfully", doctorProfile: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  async submitCredentials(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const result = await doctorService.submitCredentialVerification(req.user.id, req.body);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  async getUnverified(req: AuthenticatedRequest, res: Response) {
    try {
      const doctors = await doctorModel.findMany({ isVerified: false });
      res.json({ doctors });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
};
