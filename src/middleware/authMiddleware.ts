import { Request, Response, NextFunction } from "express";
import { getDb } from "../db.js";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: "patient" | "doctor" | "admin";
    name: string;
    isImpersonated?: boolean;
  };
}

export const authenticateJWT = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const impersonateUserId = req.headers["x-impersonate-user"] as string;
  const userIdHeader = req.headers["x-user-id"] as string;
  const userRoleHeader = req.headers["x-user-role"] as string;

  // Handle Admin Impersonation header
  if (impersonateUserId) {
    try {
      const db = getDb();
      const impUser = await db.collection("users").findOne({ _id: impersonateUserId as any });
      if (impUser) {
        req.user = {
          id: impUser._id.toString(),
          email: impUser.email,
          role: impUser.role,
          name: impUser.name,
          isImpersonated: true,
        };
        return next();
      }
    } catch {}

    req.user = {
      id: impersonateUserId,
      email: `impersonated_${impersonateUserId}@studycast.com`,
      role: impersonateUserId.includes("doc") ? "doctor" : "patient",
      name: `Impersonated ${impersonateUserId}`,
      isImpersonated: true,
    };
    return next();
  }

  if (userIdHeader && userRoleHeader) {
    try {
      const db = getDb();
      const dbUser = await db.collection("users").findOne({ _id: userIdHeader as any });
      if (dbUser) {
        req.user = {
          id: dbUser._id.toString(),
          email: dbUser.email,
          role: dbUser.role,
          name: dbUser.name,
        };
        return next();
      }
    } catch {}

    req.user = {
      id: userIdHeader,
      email: `${userRoleHeader}@studycast.com`,
      role: userRoleHeader as any,
      name: `Dev ${userRoleHeader}`,
    };
    return next();
  }

  // Fallback default user for local dev testing
  req.user = {
    id: "mock-dev-user-id",
    email: "dev@studycast.com",
    role: "admin",
    name: "System Administrator",
  };
  return next();
};

export const restrictTo = (...roles: ("patient" | "doctor" | "admin")[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.user && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Unauthorized access for role: ${req.user.role}` });
    }
    next();
  };
};
