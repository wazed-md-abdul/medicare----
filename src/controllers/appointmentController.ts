import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { appointmentService } from "../services/appointmentService.js";
import { appointmentModel } from "../models/appointmentModel.js";
import { prescriptionModel } from "../models/prescriptionModel.js";
import { reviewModel } from "../models/reviewModel.js";

export const appointmentController = {
  async create(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const { doctorId, date, time, symptoms } = req.body;
      const appointment = await appointmentService.createBooking(req.user.id, doctorId, date, time, symptoms);
      res.status(201).json({ message: "Appointment request sent successfully", appointment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  async updateStatus(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const { status } = req.body;
      const result = await appointmentService.updateAppointmentStatus(req.params.id, status, req.user.id, req.user.role);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  async delete(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const success = await appointmentModel.delete(req.params.id);
      if (!success) return res.status(404).json({ error: "Appointment record not found" });
      res.json({ message: "Appointment cancelled successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  async getDashboardStats(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      if (req.user.role === "doctor") {
        const data = await appointmentService.getDoctorDashboardData(req.user.id);
        return res.json(data);
      } else if (req.user.role === "patient") {
        const data = await appointmentService.getPatientDashboardData(req.user.id);
        return res.json(data);
      } else {
        res.json({ stats: { totalPatients: 1200, totalDoctors: 107, verifiedDoctors: 131, totalAppointments: 454 } });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  async createPrescription(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const { appointmentId, medicines, notes } = req.body;
      const appointment = await appointmentModel.findById(appointmentId);
      if (!appointment) return res.status(404).json({ error: "Appointment not found" });

      const prescription = await prescriptionModel.create({
        appointment: appointmentId,
        doctor: req.user.id,
        patient: appointment.patient,
        medicines,
        notes
      });

      await appointmentModel.updateStatus(appointmentId, "completed");

      res.status(201).json({ message: "Prescription issued & session marked completed", prescription });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  async getPrescription(req: AuthenticatedRequest, res: Response) {
    try {
      const prescription = await prescriptionModel.findByAppointment(req.params.appointmentId);
      if (!prescription) return res.status(404).json({ error: "Prescription record not found" });
      res.json({ prescription });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  async createReview(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const { doctorId, rating, comment } = req.body;
      const existing = await reviewModel.findOne(doctorId, req.user.id);
      if (existing) return res.status(400).json({ error: "You have already reviewed this doctor." });

      const review = await reviewModel.create({
        doctor: doctorId,
        patient: req.user.id,
        rating: Number(rating),
        comment
      });

      res.status(201).json({ message: "Review submitted successfully", review });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
};
