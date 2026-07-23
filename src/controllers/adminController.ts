import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { adminService } from "../services/adminService.js";

export const adminController = {
  async getDashboardStats(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await adminService.getAdminStats();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  async verifyDoctor(req: AuthenticatedRequest, res: Response) {
    try {
      const { isVerified } = req.body;
      const result = await adminService.verifyDoctorCredential(req.params.id, isVerified);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  async impersonate(req: AuthenticatedRequest, res: Response) {
    try {
      const { targetUserId } = req.body;
      if (!targetUserId) return res.status(400).json({ error: "targetUserId is required for impersonation." });
      const session = await adminService.generateImpersonationSession(targetUserId);
      res.json(session);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
};
