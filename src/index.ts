import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { connectToDatabase } from "./db.js";
import { authenticateJWT, restrictTo } from "./middleware/authMiddleware.js";
import { doctorController } from "./controllers/doctorController.js";
import { appointmentController } from "./controllers/appointmentController.js";
import { adminController } from "./controllers/adminController.js";
import { itemController } from "./controllers/itemController.js";
import { doctorService } from "./services/doctorService.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Security & Parsing Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const allowedOrigins = [
  FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:3001",
  "https://medicare-frontend-beta.vercel.app",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.endsWith(".vercel.app") || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database initialization middleware
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await connectToDatabase();
    next();
  } catch (err: any) {
    console.error("Database connection error:", err.message);
    res.status(500).json({ error: "Failed to connect to database: " + err.message });
  }
});

// ==========================================
// API ROUTES (3-LAYER CONTROLLER HANDLERS)
// ==========================================

// Health Check
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

// Database Seeding Route
app.all("/api/seed", async (req: Request, res: Response) => {
  try {
    await doctorService.getDoctorDirectory({});
    res.json({ message: "Database initialized with accredited doctor records." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Doctor Routes
app.get("/api/doctors", doctorController.getDirectory);
app.get("/api/doctors/profile", authenticateJWT, restrictTo("doctor"), doctorController.getProfile);
app.put("/api/doctors/profile", authenticateJWT, restrictTo("doctor"), doctorController.updateProfile);
app.post("/api/doctors/verify-request", authenticateJWT, restrictTo("doctor"), doctorController.submitCredentials);
app.get("/api/doctors/unverified", authenticateJWT, restrictTo("admin"), doctorController.getUnverified);

// Appointment Routes
app.post("/api/appointments", authenticateJWT, appointmentController.create);
app.put("/api/appointments/:id/status", authenticateJWT, appointmentController.updateStatus);
app.delete("/api/appointments/:id", authenticateJWT, appointmentController.delete);
app.get("/api/dashboard/stats", authenticateJWT, appointmentController.getDashboardStats);

// Prescription & Review Routes
app.post("/api/prescriptions", authenticateJWT, restrictTo("doctor"), appointmentController.createPrescription);
app.get("/api/prescriptions/:appointmentId", authenticateJWT, appointmentController.getPrescription);
app.post("/api/reviews", authenticateJWT, appointmentController.createReview);

// Admin Routes
app.get("/api/admin/stats", authenticateJWT, restrictTo("admin"), adminController.getDashboardStats);
app.put("/api/doctors/:id/verify", authenticateJWT, restrictTo("admin"), adminController.verifyDoctor);
app.post("/api/admin/impersonate", authenticateJWT, restrictTo("admin"), adminController.impersonate);

// Item Catalog Routes
app.get("/api/items", authenticateJWT, itemController.getItems);
app.post("/api/items", authenticateJWT, itemController.createItem);
app.put("/api/items/:id", authenticateJWT, itemController.updateItem);
app.delete("/api/items/:id", authenticateJWT, itemController.deleteItem);

// 404 Fallback
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
});

// Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Express App Error:", err);
  res.status(err.status || 500).json({ error: err.message || "An unexpected system error occurred" });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`MediCare Connect 3-Layer backend server running on port ${PORT}`);
  });
}

export default app;
