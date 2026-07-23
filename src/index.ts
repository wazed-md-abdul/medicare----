import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Load configurations
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/medicare-connect";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Security & Parsing Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
// Allow localhost for development AND any Vercel deployment for production
const allowedOrigins = [
  FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:3001",
  'https://medicare-frontend-beta.vercel.app',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., curl, Postman, server-side)
    if (!origin) return callback(null, true);
    // Allow any *.vercel.app subdomain for Vercel preview/prod deployments
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

// Setup MongoDB MongoClient caching for serverless environments
let cachedClient: MongoClient | null = null;
let cachedDb: any = null;
let db: any;

const connectToDatabase = async () => {
  if (cachedDb) {
    db = cachedDb;
    return cachedDb;
  }
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const database = client.db("test");
  cachedClient = client;
  cachedDb = database;
  db = database;
  return database;
};

// Middleware to ensure database connection is established for every request
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await connectToDatabase();
    next();
  } catch (err: any) {
    console.error("Database connection error:", err.message);
    res.status(500).json({ error: "Failed to connect to database: " + err.message });
  }
});

// Helper to convert IDs to ObjectId or String safely
const parseId = (id: string) => {
  try {
    return new ObjectId(id);
  } catch {
    return id;
  }
};

// Setup JWKS Set verification from the Next.js auth server
const JWKS_URL = `${FRONTEND_URL}/api/auth/jwks`;

const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

const getJWKSet = async () => {
  return { JWKS, jwtVerify };
};

// Define Authenticated Request interface
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: "patient" | "doctor" | "admin";
    name: string;
  };
}

// Authentication JWT JWKS Middleware
export const authenticateJWT = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Extract token from body, query parameters, or authorization header
  let token = req.body?.token || req.query?.token;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(" ");
    if (parts.length === 2 && parts[0] === "Bearer") {
      token = parts[1];
    } else {
      token = req.headers.authorization;
    }
  }

  // Fallback custom developer headers for testing
  const userIdHeader = req.headers["x-user-id"] as string;
  const userRoleHeader = req.headers["x-user-role"] as string;

  if (!token && userIdHeader && userRoleHeader) {
    try {
      const dbUser = await db.collection("users").findOne({ _id: userIdHeader });
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
      email: `${userRoleHeader}@medicare.local`,
      role: userRoleHeader as any,
      name: `Dev ${userRoleHeader}`,
    };
    return next();
  }

  if (!token) {
    // If no token, check if we have any fallback default user in database (for local dev dev-mode bypass)
    try {
      const defaultUser = await db.collection("users").findOne();
      if (defaultUser) {
        req.user = {
          id: defaultUser._id.toString(),
          email: defaultUser.email,
          role: defaultUser.role,
          name: defaultUser.name,
        };
        return next();
      }
    } catch {}

    req.user = {
      id: "mock-dev-admin-id",
      email: "admin@medicare.local",
      role: "admin",
      name: "System Administrator",
    };
    return next();
  }

  try {
    const { JWKS, jwtVerify } = await getJWKSet();
    const { payload } = await jwtVerify(token, JWKS);
    
    req.user = {
      id: (payload.sub || (payload as any).id || "").toString(),
      email: (payload.email as string) || "",
      role: ((payload as any).role as any) || "patient",
      name: ((payload as any).name as string) || "",
    };
    next();
  } catch (error: any) {
    console.error("JWT JWKS Verification failed:", error.message);
    res.status(403).json({ error: "Invalid or expired token. Authenticate via Better Auth." });
  }
};

// Role restrictions middleware
export const restrictTo = (...roles: ("patient" | "doctor" | "admin")[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.user && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Unauthorized access for role: " + req.user.role });
    }
    next();
  };
};

// ==========================================
// API ROUTES
// ==========================================

// Health Check Route
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    database: db ? "connected" : "disconnected",
  });
});

// Get logged in doctor profile (raw mongo, lazy init if not found)
app.get("/api/doctors/profile", authenticateJWT, restrictTo("doctor"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let doctorProfile = await db.collection("doctors").findOne({ user: req.user.id });
    if (!doctorProfile) {
      doctorProfile = {
        _id: new ObjectId(),
        user: req.user.id,
        specialization: "General Practice",
        biography: "Add your biography here.",
        hospital: "MediCare Connect Hospital",
        experience: 1,
        consultationFee: 50,
        availability: [
          { day: "Monday", slots: ["09:00", "10:00", "11:00", "14:00", "15:00"] },
          { day: "Wednesday", slots: ["09:00", "10:00", "11:00", "14:00", "15:00"] },
          { day: "Friday", slots: ["09:00", "10:00", "11:00", "14:00", "15:00"] },
        ],
        rating: 5,
        reviewsCount: 0,
        isVerified: false,
        gallery: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.collection("doctors").insertOne(doctorProfile);
    }

    res.json({ doctorProfile });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Seed database with 6 initial accredited doctors
const seedInitialDoctors = async () => {
  if (!db) return;
  const initialDoctors = [
    {
      _id: "doc_1",
      userName: "Dr. Anya Sharma",
      userEmail: "anya.sharma@studycast.com",
      specialization: "Radiologist",
      biography: "Dr. Anya Sharma is a highly experienced radiologist specializing in advanced neuroimaging. She leads our medical imaging analysis team with a focus on precision and efficiency.",
      hospital: "City Hospital Imaging Center",
      experience: 14,
      consultationFee: 150,
      rating: 4.9,
      reviewsCount: 128,
      isVerified: true,
      avatar: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=800&q=80",
      reports: [
        "CT Scan - Chest",
        "MRI - Brain",
        "MRI - Amanoxesanist",
        "MRI - Medical Nhrax",
        "CT Scan - Proolination"
      ],
      availability: [{ day: "Monday", slots: ["09:00", "10:30", "14:00", "15:30"] }]
    },
    {
      _id: "doc_2",
      userName: "Dr. Aria Sharma",
      userEmail: "aria.sharma@studycast.com",
      specialization: "Cardiology Radiologist",
      biography: "Dr. Aria Sharma brings over 15 years of diagnostic imaging experience. Specialist in cardiovascular CT and MRI protocols.",
      hospital: "Medical Center Diagnostics",
      experience: 15,
      consultationFee: 175,
      rating: 4.8,
      reviewsCount: 94,
      isVerified: true,
      avatar: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=800&q=80",
      reports: ["Coronary CT Angiography", "Cardiac MRI", "Echocardiogram Assessment"],
      availability: [{ day: "Tuesday", slots: ["08:30", "11:00", "13:30"] }]
    },
    {
      _id: "doc_3",
      userName: "Dr. Amm Sharma",
      userEmail: "amm.sharma@studycast.com",
      specialization: "Vascular Radiologist",
      biography: "Dr. Amm Sharma leads point-of-care ultrasound workflows and vascular diagnostic studies.",
      hospital: "Regional Care Center",
      experience: 12,
      consultationFee: 140,
      rating: 4.9,
      reviewsCount: 110,
      isVerified: true,
      avatar: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=800&q=80",
      reports: ["Vascular Ultrasound", "Abdominal CT Scan", "Soft Tissue Scan"],
      availability: [{ day: "Wednesday", slots: ["10:00", "14:00", "16:00"] }]
    },
    {
      _id: "doc_4",
      userName: "Dr. Manta Sharma",
      userEmail: "manta.sharma@studycast.com",
      specialization: "Pediatric Radiologist",
      biography: "Dr. Manta Sharma specializes in pediatric radiology and women's health imaging.",
      hospital: "University Health Women's Hub",
      experience: 10,
      consultationFee: 130,
      rating: 4.9,
      reviewsCount: 86,
      isVerified: true,
      avatar: "https://images.unsplash.com/photo-1594824813566-888557790613?auto=format&fit=crop&w=800&q=80",
      reports: ["Pediatric MRI", "Pelvic Ultrasound", "Bone Density Scan"],
      availability: [{ day: "Thursday", slots: ["09:00", "11:30", "15:00"] }]
    },
    {
      _id: "doc_5",
      userName: "Dr. Rorah Sharma",
      userEmail: "rorah.sharma@studycast.com",
      specialization: "Musculoskeletal Radiologist",
      biography: "Dr. Rorah Sharma focuses on musculoskeletal imaging and sports injury diagnostics.",
      hospital: "Metro Imaging Institute",
      experience: 11,
      consultationFee: 160,
      rating: 4.7,
      reviewsCount: 75,
      isVerified: true,
      avatar: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=800&q=80",
      reports: ["Knee MRI", "Spine CT", "Shoulder Arthrogram"],
      availability: [{ day: "Friday", slots: ["08:00", "10:00", "13:00", "15:00"] }]
    },
    {
      _id: "doc_6",
      userName: "Dr. Jom Hanan",
      userEmail: "jom.hanan@studycast.com",
      specialization: "Emergency & Oncology Radiologist",
      biography: "Dr. Jom Hanan is a senior radiologist with 20+ years expertise in emergency imaging and oncology.",
      hospital: "City Hospital Central",
      experience: 22,
      consultationFee: 200,
      rating: 5.0,
      reviewsCount: 195,
      isVerified: true,
      avatar: "https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&w=800&q=80",
      reports: ["Full Body PET-CT", "Thoracic Scan", "Brain Angiogram"],
      availability: [{ day: "Saturday", slots: ["09:00", "12:00"] }]
    }
  ];

  for (const doc of initialDoctors) {
    const userId = `user_${doc._id}`;
    await db.collection("users").updateOne(
      { _id: userId },
      {
        $set: {
          _id: userId,
          name: doc.userName,
          email: doc.userEmail,
          role: "doctor",
          image: doc.avatar,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    await db.collection("doctors").updateOne(
      { _id: doc._id },
      {
        $set: {
          _id: doc._id,
          user: userId,
          name: doc.userName,
          specialization: doc.specialization,
          biography: doc.biography,
          hospital: doc.hospital,
          experience: doc.experience,
          consultationFee: doc.consultationFee,
          rating: doc.rating,
          reviewsCount: doc.reviewsCount,
          isVerified: true,
          avatar: doc.avatar,
          reports: doc.reports,
          availability: doc.availability,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  }
};

app.all("/api/seed", async (req: Request, res: Response) => {
  try {
    await seedInitialDoctors();
    const doctors = await db.collection("doctors").find({}).toArray();
    res.json({ message: "Database seeded successfully with doctor records", count: doctors.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get doctors list with search, filter, sorting, and pagination (raw mongo)
app.get("/api/doctors", async (req: Request, res: Response) => {
  try {
    // Auto-seed if database is empty
    const count = await db.collection("doctors").countDocuments();
    if (count === 0) {
      await seedInitialDoctors();
    }

    const {
      search,
      specialization,
      experience,
      maxFee,
      availability,
      sortBy,
      page = "1",
      limit = "10",
    } = req.query;

    const query: any = { isVerified: true };

    if (search) {
      const matchingUsers = await db.collection("users").find({
        name: { $regex: search, $options: "i" },
        role: "doctor"
      }).toArray();
      const userIds = matchingUsers.map((u: any) => u._id.toString());
      
      query.$or = [
        { user: { $in: userIds } },
        { hospital: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
    }

    if (specialization) {
      query.specialization = { $regex: specialization, $options: "i" };
    }

    if (experience) {
      query.experience = { $gte: parseInt(experience as string, 10) };
    }

    if (maxFee) {
      query.consultationFee = { $lte: parseFloat(maxFee as string) };
    }

    if (availability) {
      query["availability.day"] = availability;
    }

    let sortOptions: any = {};
    if (sortBy === "rating") {
      sortOptions = { rating: -1, reviewsCount: -1 };
    } else if (sortBy === "fee") {
      sortOptions = { consultationFee: 1 };
    } else if (sortBy === "experience") {
      sortOptions = { experience: -1 };
    } else {
      sortOptions = { createdAt: -1 };
    }

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const doctors = await db.collection("doctors")
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .toArray();

    // Populate user info for list
    const userIds = doctors.map((d: any) => d.user);
    const users = await db.collection("users").find({ _id: { $in: userIds } }).toArray();
    const userMap = new Map<string, { name: string; email: string; image?: string }>(
      users.map((u: any) => [u._id.toString(), { name: u.name, email: u.email, image: u.image }])
    );
    
    doctors.forEach((d: any) => {
      const u = userMap.get(d.user?.toString()) || { name: d.name || "Accredited Doctor", email: "", image: d.avatar };
      d.user = u;
      d.name = d.name || u.name;
      d.specialty = d.specialization || d.specialty || "Radiologist";
      d.avatar = d.avatar || u.image || "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=800&q=80";
      d.bio = d.biography || d.bio || "Diagnostic radiologist at Studycast Medical Center.";
      d.reports = d.reports || ["CT Scan - Diagnostic Study", "MRI - High Resolution", "Ultrasound Report"];
    });

    const total = await db.collection("doctors").countDocuments(query);

    res.json({
      doctors,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin get list of unverified doctors (raw mongo)
app.get("/api/doctors/unverified", authenticateJWT, restrictTo("admin"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const doctors = await db.collection("doctors").find({}).toArray();

    // Populate user info
    const userIds = doctors.map((d: any) => d.user);
    const users = await db.collection("users").find({ _id: { $in: userIds } }).toArray();
    const userMap = new Map(users.map((u: any) => [u._id.toString(), { name: u.name, email: u.email }]));
    
    doctors.forEach((d: any) => {
      d.user = userMap.get(d.user) || { name: "Doctor Profile", email: "" };
    });

    res.json({ doctors });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single doctor details (raw mongo)
app.get("/api/doctors/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const queryId = parseId(id);

    const doctor = await db.collection("doctors").findOne({ _id: queryId });
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    // Populate user details
    const userObj = await db.collection("users").findOne({ _id: doctor.user });
    doctor.user = userObj ? { name: userObj.name, email: userObj.email } : { name: "Medical Practitioner", email: "" };

    // Get doctor reviews
    const reviews = await db.collection("reviews")
      .find({ doctor: id })
      .sort({ createdAt: -1 })
      .toArray();

    // Populate patients for reviews
    const patientIds = reviews.map((r: any) => r.patient);
    const patients = await db.collection("users").find({ _id: { $in: patientIds } }).toArray();
    const patientMap = new Map(patients.map((p: any) => [p._id.toString(), { name: p.name }]));

    reviews.forEach((r: any) => {
      r.patient = patientMap.get(r.patient) || { name: "Vetted Patient" };
    });

    res.json({ doctor, reviews });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update doctor consulting profile (raw mongo, with upsert support)
app.put("/api/doctors/profile", authenticateJWT, restrictTo("doctor"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { specialization, biography, hospital, experience, consultationFee, availability, gallery } = req.body;

    await db.collection("doctors").updateOne(
      { user: req.user.id },
      {
        $set: {
          specialization: specialization || "General Practice",
          biography: biography || "Add your biography here.",
          hospital: hospital || "MediCare Connect Hospital",
          experience: Number(experience) || 1,
          consultationFee: Number(consultationFee) || 50,
          availability: availability || [
            { day: "Monday", slots: ["09:00", "10:00", "11:00", "14:00", "15:00"] },
            { day: "Wednesday", slots: ["09:00", "10:00", "11:00", "14:00", "15:00"] },
            { day: "Friday", slots: ["09:00", "10:00", "11:00", "14:00", "15:00"] },
          ],
          gallery: gallery || [],
          updatedAt: new Date(),
        },
        $setOnInsert: {
          _id: new ObjectId(),
          user: req.user.id,
          rating: 5,
          reviewsCount: 0,
          isVerified: false,
          createdAt: new Date(),
        }
      },
      { upsert: true }
    );

    const doctor = await db.collection("doctors").findOne({ user: req.user.id });
    if (doctor) {
      const userObj = await db.collection("users").findOne({ _id: doctor.user });
      doctor.user = userObj ? { name: userObj.name, email: userObj.email } : null;
    }

    res.json({ message: "Doctor profile updated successfully", doctor });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin verify/activate doctor profile (raw mongo)
app.put("/api/doctors/:id/verify", authenticateJWT, restrictTo("admin"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { isVerified } = req.body;
    const queryId = parseId(req.params.id);

    await db.collection("doctors").updateOne(
      { _id: queryId },
      { $set: { isVerified: !!isVerified, updatedAt: new Date() } }
    );

    const doctor = await db.collection("doctors").findOne({ _id: queryId });
    if (doctor) {
      const userObj = await db.collection("users").findOne({ _id: doctor.user });
      doctor.user = userObj ? { name: userObj.name, email: userObj.email } : null;
    }

    res.json({
      message: `Doctor has been ${isVerified ? "activated" : "deactivated"} successfully`,
      doctor,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Book an appointment (raw mongo)
app.post("/api/appointments", authenticateJWT, restrictTo("patient"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { doctorId, date, time, symptoms } = req.body;

    if (!doctorId || !date || !time) {
      return res.status(400).json({ error: "Doctor ID, date, and time are required." });
    }

    const queryDocId = parseId(doctorId);
    const doctor = await db.collection("doctors").findOne({ _id: queryDocId });
    if (!doctor || !doctor.isVerified) {
      return res.status(404).json({ error: "Doctor not found or not verified." });
    }

    const dayName = new Date(date).toLocaleDateString("en-US", { weekday: "long" });
    const dayAvailability = doctor.availability.find(
      (a: any) => a.day.toLowerCase() === dayName.toLowerCase()
    );

    if (!dayAvailability || !dayAvailability.slots.includes(time)) {
      return res.status(400).json({ error: "Selected slot is not available for this doctor's schedule." });
    }

    // Check duplicate bookings
    const existingAppointment = await db.collection("appointments").findOne({
      doctor: doctorId,
      date,
      time,
      status: { $in: ["pending", "accepted", "completed"] },
    });

    if (existingAppointment) {
      return res.status(409).json({ error: "This slot is already booked." });
    }

    const appointment = {
      _id: new ObjectId(),
      patient: req.user.id,
      doctor: doctorId,
      date,
      time,
      symptoms: symptoms || "",
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection("appointments").insertOne(appointment);

    res.status(201).json({
      message: "Appointment booked successfully",
      appointment,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get appointments list (raw mongo)
app.get("/api/appointments", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let filter: any = {};
    if (req.user.role === "patient") {
      filter.patient = req.user.id;
    } else if (req.user.role === "doctor") {
      const doctorProfile = await db.collection("doctors").findOne({ user: req.user.id });
      if (!doctorProfile) {
        return res.status(404).json({ error: "Doctor profile not found" });
      }
      filter.doctor = doctorProfile._id.toString();
    } else if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    const appointments = await db.collection("appointments")
      .find(filter)
      .sort({ date: 1, time: 1 })
      .toArray();

    // Populate patient info
    const patientIds = appointments.map((a: any) => a.patient);
    const patients = await db.collection("users").find({ _id: { $in: patientIds } }).toArray();
    const patientMap = new Map(patients.map((p: any) => [p._id.toString(), { name: p.name, email: p.email }]));

    // Populate doctor + doctor user info
    const doctorIds = appointments.map((a: any) => parseId(a.doctor));
    const doctors = await db.collection("doctors").find({ _id: { $in: doctorIds } }).toArray();
    
    const docUserIds = doctors.map((d: any) => d.user);
    const docUsers = await db.collection("users").find({ _id: { $in: docUserIds } }).toArray();
    const docUserMap = new Map(docUsers.map((du: any) => [du._id.toString(), { name: du.name, email: du.email }]));

    const doctorMap = new Map(doctors.map((d: any) => {
      const userDetails = docUserMap.get(d.user) || { name: "Doctor Profile", email: "" };
      return [d._id.toString(), { ...d, user: userDetails }];
    }));

    // Populate prescription info
    const appIds = appointments.map((a: any) => a._id.toString());
    const prescriptions = await db.collection("prescriptions").find({ appointment: { $in: appIds } }).toArray();
    const prescriptionMap = new Map(prescriptions.map((pr: any) => [pr.appointment.toString(), pr]));

    appointments.forEach((a: any) => {
      a.patient = patientMap.get(a.patient) || { name: "Vetted Patient", email: "" };
      a.doctor = doctorMap.get(a.doctor) || { hospital: "General Practice", user: { name: "Doctor", email: "" } };
      a.prescription = prescriptionMap.get(a._id.toString()) || null;
    });

    res.json({ appointments });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update appointment status (raw mongo)
app.put("/api/appointments/:id/status", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { status } = req.body;
    if (!["accepted", "rejected", "completed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value." });
    }

    const queryId = parseId(req.params.id);
    const appointment = await db.collection("appointments").findOne({ _id: queryId });
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found." });
    }

    if (req.user.role === "doctor") {
      const doctorProfile = await db.collection("doctors").findOne({ user: req.user.id });
      if (!doctorProfile || appointment.doctor.toString() !== doctorProfile._id.toString()) {
        return res.status(403).json({ error: "Access denied. You are not authorized." });
      }
    } else if (req.user.role === "patient") {
      if (appointment.patient.toString() !== req.user.id) {
        return res.status(403).json({ error: "Access denied." });
      }
      if (status !== "rejected") {
        return res.status(403).json({ error: "Patients can only cancel (reject) bookings." });
      }
    } else if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied." });
    }

    await db.collection("appointments").updateOne(
      { _id: queryId },
      { $set: { status, updatedAt: new Date() } }
    );

    const updatedApp = await db.collection("appointments").findOne({ _id: queryId });

    res.json({
      message: `Appointment status updated to ${status} successfully.`,
      appointment: updatedApp,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel/Delete appointment (raw mongo)
app.delete("/api/appointments/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const queryId = parseId(req.params.id);
    const appointment = await db.collection("appointments").findOne({ _id: queryId });
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found." });
    }

    if (req.user.role === "patient" && appointment.patient.toString() !== req.user.id) {
      return res.status(403).json({ error: "Access denied." });
    }

    if (req.user.role === "doctor") {
      const doctorProfile = await db.collection("doctors").findOne({ user: req.user.id });
      if (!doctorProfile || appointment.doctor.toString() !== doctorProfile._id.toString()) {
        return res.status(403).json({ error: "Access denied." });
      }
    }

    await db.collection("appointments").deleteOne({ _id: queryId });

    res.json({ message: "Appointment deleted successfully." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create prescription (raw mongo)
app.post("/api/prescriptions", authenticateJWT, restrictTo("doctor"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { appointmentId, medicines, instructions } = req.body;

    if (!appointmentId || !medicines) {
      return res.status(400).json({ error: "Appointment ID and medicines list are required." });
    }

    const queryAppId = parseId(appointmentId);
    const appointment = await db.collection("appointments").findOne({ _id: queryAppId });
    if (!appointment) {
      return res.status(404).json({ error: "Appointment session not found." });
    }

    const doctorProfile = await db.collection("doctors").findOne({ user: req.user.id });
    if (!doctorProfile || appointment.doctor.toString() !== doctorProfile._id.toString()) {
      return res.status(403).json({ error: "Access denied. Not your appointment." });
    }

    const prescription = {
      _id: new ObjectId(),
      appointment: appointmentId,
      doctor: doctorProfile._id.toString(),
      patient: appointment.patient,
      medicines,
      instructions: instructions || "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection("prescriptions").insertOne(prescription);

    // Update appointment status to completed
    await db.collection("appointments").updateOne(
      { _id: queryAppId },
      { $set: { status: "completed", updatedAt: new Date() } }
    );

    res.status(201).json({
      message: "Prescription published successfully.",
      prescription,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get prescription details (raw mongo)
app.get("/api/prescriptions/:appointmentId", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { appointmentId } = req.params;
    const prescription = await db.collection("prescriptions").findOne({ appointment: appointmentId });
    if (!prescription) {
      return res.status(404).json({ error: "Prescription details not found." });
    }
    res.json({ prescription });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard telemetry stats (raw mongo)
app.get("/api/dashboard/stats", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { role, id } = req.user;

    if (role === "patient") {
      const upcomingAppointments = await db.collection("appointments")
        .find({
          patient: id,
          status: { $in: ["pending", "accepted"] }
        })
        .sort({ date: 1, time: 1 })
        .toArray();

      // Populate doctor users for upcoming
      const docIds = upcomingAppointments.map((a: any) => parseId(a.doctor));
      const doctors = await db.collection("doctors").find({ _id: { $in: docIds } }).toArray();
      
      const docUserIds = doctors.map((d: any) => d.user);
      const docUsers = await db.collection("users").find({ _id: { $in: docUserIds } }).toArray();
      const docUserMap = new Map(docUsers.map((du: any) => [du._id.toString(), { name: du.name, email: du.email }]));

      const doctorMap = new Map(doctors.map((d: any) => {
        const userDetails = docUserMap.get(d.user) || { name: "Doctor Profile", email: "" };
        return [d._id.toString(), { ...d, user: userDetails }];
      }));

      upcomingAppointments.forEach((a: any) => {
        a.doctor = doctorMap.get(a.doctor) || { hospital: "General Practice", user: { name: "Doctor", email: "" } };
      });

      const appointmentHistory = await db.collection("appointments")
        .find({
          patient: id,
          status: { $in: ["completed", "rejected"] }
        })
        .sort({ date: -1, time: -1 })
        .toArray();

      // Populate doctor users for history
      const histDocIds = appointmentHistory.map((a: any) => parseId(a.doctor));
      const histDoctors = await db.collection("doctors").find({ _id: { $in: histDocIds } }).toArray();
      
      const histDocUserIds = histDoctors.map((d: any) => d.user);
      const histDocUsers = await db.collection("users").find({ _id: { $in: histDocUserIds } }).toArray();
      const histDocUserMap = new Map(histDocUsers.map((du: any) => [du._id.toString(), { name: du.name, email: du.email }]));

      const histDoctorMap = new Map(histDoctors.map((d: any) => {
        const userDetails = histDocUserMap.get(d.user) || { name: "Doctor Profile", email: "" };
        return [d._id.toString(), { ...d, user: userDetails }];
      }));

      appointmentHistory.forEach((a: any) => {
        a.doctor = histDoctorMap.get(a.doctor) || { hospital: "General Practice", user: { name: "Doctor", email: "" } };
      });

      const distinctDoctors = await db.collection("appointments").distinct("doctor", { patient: id });

      res.json({
        role: "patient",
        stats: {
          upcomingCount: upcomingAppointments.length,
          historyCount: appointmentHistory.length,
          consultedDoctorsCount: distinctDoctors.length,
        },
        upcomingAppointments,
        appointmentHistory: appointmentHistory.slice(0, 5),
      });

    } else if (role === "doctor") {
      const doctorProfile = await db.collection("doctors").findOne({ user: id });
      if (!doctorProfile) {
        return res.status(404).json({ error: "Doctor profile not found." });
      }

      const todayStr = new Date().toISOString().split("T")[0];

      const todayAppointments = await db.collection("appointments")
        .find({
          doctor: doctorProfile._id.toString(),
          date: todayStr,
          status: { $in: ["accepted", "pending"] },
        }).toArray();

      const todayPatientIds = todayAppointments.map((a: any) => a.patient);
      const todayPatients = await db.collection("users").find({ _id: { $in: todayPatientIds } }).toArray();
      const todayPatientMap = new Map(todayPatients.map((u: any) => [u._id.toString(), { name: u.name, email: u.email }]));
      todayAppointments.forEach((a: any) => {
        a.patient = todayPatientMap.get(a.patient) || { name: "Patient", email: "" };
      });

      const pendingRequests = await db.collection("appointments")
        .find({
          doctor: doctorProfile._id.toString(),
          status: "pending",
        }).toArray();

      const pendingPatientIds = pendingRequests.map((a: any) => a.patient);
      const pendingPatients = await db.collection("users").find({ _id: { $in: pendingPatientIds } }).toArray();
      const pendingPatientMap = new Map(pendingPatients.map((u: any) => [u._id.toString(), { name: u.name, email: u.email }]));
      pendingRequests.forEach((a: any) => {
        a.patient = pendingPatientMap.get(a.patient) || { name: "Patient", email: "" };
      });

      const allDoctorAppointments = await db.collection("appointments").find({
        doctor: doctorProfile._id.toString(),
      }).toArray();

      const completedCount = allDoctorAppointments.filter((a: any) => a.status === "completed").length;
      const uniquePatients = await db.collection("appointments").distinct("patient", { doctor: doctorProfile._id.toString() });
      const totalRevenue = completedCount * doctorProfile.consultationFee;

      const upcomingQueue = await db.collection("appointments")
        .find({
          doctor: doctorProfile._id.toString(),
          status: "accepted",
        })
        .sort({ date: 1, time: 1 })
        .toArray();

      const queuePatientIds = upcomingQueue.map((a: any) => a.patient);
      const queuePatients = await db.collection("users").find({ _id: { $in: queuePatientIds } }).toArray();
      const queuePatientMap = new Map(queuePatients.map((u: any) => [u._id.toString(), { name: u.name, email: u.email }]));
      upcomingQueue.forEach((a: any) => {
        a.patient = queuePatientMap.get(a.patient) || { name: "Patient", email: "" };
      });

      res.json({
        role: "doctor",
        stats: {
          todayCount: todayAppointments.length,
          pendingCount: pendingRequests.length,
          uniquePatientsCount: uniquePatients.length,
          totalRevenue,
          rating: doctorProfile.rating,
        },
        todayQueue: todayAppointments,
        pendingRequests,
        upcomingQueue: upcomingQueue.slice(0, 5),
      });

    } else if (role === "admin") {
      const totalPatients = await db.collection("users").countDocuments({ role: "patient" });
      const totalDoctorsCount = await db.collection("users").countDocuments({ role: "doctor" });
      const totalAdmins = await db.collection("users").countDocuments({ role: "admin" });

      const verifiedDoctors = await db.collection("doctors").countDocuments({ isVerified: true });
      const unverifiedDoctors = await db.collection("doctors").countDocuments({ isVerified: false });

      const totalAppointments = await db.collection("appointments").countDocuments();
      const completedCount = await db.collection("appointments").countDocuments({ status: "completed" });
      const pendingCount = await db.collection("appointments").countDocuments({ status: "pending" });
      const acceptedCount = await db.collection("appointments").countDocuments({ status: "accepted" });

      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const currentMonthIndex = new Date().getMonth();
      
      const chartData = [];
      for (let i = 5; i >= 0; i--) {
        const targetMonthIndex = (currentMonthIndex - i + 12) % 12;
        const monthName = months[targetMonthIndex];
        
        chartData.push({
          month: monthName,
          registrations: Math.max(1, Math.round(totalPatients * (0.12 * (6 - i)) + 1)),
          appointments: Math.max(2, Math.round(totalAppointments * (0.15 * (6 - i)) + 2)),
          revenue: Math.max(100, Math.round(completedCount * 50 * (0.14 * (6 - i)) + 150)),
        });
      }

      const recentDoctors = await db.collection("doctors")
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      const recDocUserIds = recentDoctors.map((d: any) => d.user);
      const recDocUsers = await db.collection("users").find({ _id: { $in: recDocUserIds } }).toArray();
      const recDocUserMap = new Map(recDocUsers.map((du: any) => [du._id.toString(), { name: du.name, email: du.email }]));
      recentDoctors.forEach((d: any) => {
        d.user = recDocUserMap.get(d.user) || { name: "Doctor Profile", email: "" };
      });

      const recentAppointments = await db.collection("appointments")
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      const recAppPatientIds = recentAppointments.map((a: any) => a.patient);
      const recAppPatients = await db.collection("users").find({ _id: { $in: recAppPatientIds } }).toArray();
      const recAppPatientMap = new Map(recAppPatients.map((p: any) => [p._id.toString(), { name: p.name }]));

      const recAppDocIds = recentAppointments.map((a: any) => parseId(a.doctor));
      const recAppDocs = await db.collection("doctors").find({ _id: { $in: recAppDocIds } }).toArray();
      
      const recAppDocUserIds = recAppDocs.map((d: any) => d.user);
      const recAppDocUsers = await db.collection("users").find({ _id: { $in: recAppDocUserIds } }).toArray();
      const recAppDocUserMap = new Map(recAppDocUsers.map((du: any) => [du._id.toString(), { name: du.name }]));

      const recAppDoctorMap = new Map(recAppDocs.map((d: any) => {
        const userDetails = recAppDocUserMap.get(d.user) || { name: "Doctor Profile" };
        return [d._id.toString(), { user: userDetails }];
      }));

      recentAppointments.forEach((a: any) => {
        a.patient = recAppPatientMap.get(a.patient) || { name: "Vetted Patient" };
        a.doctor = recAppDoctorMap.get(a.doctor) || { user: { name: "Doctor" } };
      });

      res.json({
        role: "admin",
        stats: {
          totalPatients,
          totalDoctors: totalDoctorsCount,
          totalAdmins,
          verifiedDoctors,
          unverifiedDoctors,
          totalAppointments,
          completedAppointments: completedCount,
          pendingAppointments: pendingCount,
          acceptedAppointments: acceptedCount,
        },
        chartData,
        recentDoctors,
        recentAppointments,
      });
    } else {
      res.status(403).json({ error: "Access denied. Invalid user role." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ITEMS CATALOG ROUTES (RAW MONGO)
// ==========================================

// Get all items added by current user
app.get("/api/items", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const items = await db.collection("items").find({ user: req.user.id }).sort({ createdAt: -1 }).toArray();
    res.json({ items });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new item
app.post("/api/items", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { title, shortDescription, fullDescription, price, imageUrl } = req.body;
    if (!title || !shortDescription || !fullDescription || price === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const item = {
      _id: new ObjectId(),
      title,
      shortDescription,
      fullDescription,
      price: Number(price),
      imageUrl: imageUrl || "https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?auto=format&fit=crop&q=80&w=300",
      user: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection("items").insertOne(item);

    res.status(201).json({ message: "Item added successfully", item });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete item
app.delete("/api/items/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const queryId = parseId(req.params.id);
    const result = await db.collection("items").findOneAndDelete({ _id: queryId, user: req.user.id });

    if (!result) {
      return res.status(404).json({ error: "Item not found or unauthorized to delete" });
    }

    res.json({ message: "Item deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Fallback 404 Route
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Express App Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "An unexpected system error occurred",
  });
});

// Start Express Server / Export for Serverless (Vercel)
// In ESM mode, Vercel picks up the default export automatically
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`MediCare Connect backend server is running on port ${PORT}`);
  });
}

export default app;
