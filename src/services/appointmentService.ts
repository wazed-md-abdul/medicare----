import { appointmentModel, AppointmentDoc } from "../models/appointmentModel.js";
import { doctorModel } from "../models/doctorModel.js";
import { userModel } from "../models/userModel.js";
import { prescriptionModel } from "../models/prescriptionModel.js";

export const appointmentService = {
  async createBooking(patientId: string, doctorId: string, date: string, time: string, symptoms?: string) {
    if (!doctorId || !date || !time) {
      throw new Error("Missing required appointment fields: doctorId, date, time.");
    }

    const doctor = await doctorModel.findById(doctorId);
    if (!doctor) {
      throw new Error("Doctor profile not found.");
    }

    const appointment = await appointmentModel.create({
      patient: patientId,
      doctor: doctorId,
      date,
      time,
      symptoms: symptoms || "",
      status: "pending"
    });

    return appointment;
  },

  async updateAppointmentStatus(appointmentId: string, status: AppointmentDoc["status"], userId: string, role: string) {
    const appointment = await appointmentModel.findById(appointmentId);
    if (!appointment) {
      throw new Error("Appointment record not found.");
    }

    await appointmentModel.updateStatus(appointmentId, status);
    return { success: true, status };
  },

  async getPatientDashboardData(patientId: string) {
    const appointments = await appointmentModel.findMany({ patient: patientId });

    const doctorIds = [...new Set(appointments.map((a: any) => a.doctor))];
    const doctors = await Promise.all(doctorIds.map(id => doctorModel.findById(id)));
    const doctorMap = new Map();

    for (const doc of doctors) {
      if (doc) {
        const u = await userModel.findById(doc.user);
        doctorMap.set(doc._id.toString(), {
          ...doc,
          name: doc.name || u?.name || "Dr. Specialist",
          user: u || { name: doc.name || "Dr. Specialist", email: "" }
        });
      }
    }

    const populated = await Promise.all(appointments.map(async (appt: any) => {
      const doc = doctorMap.get(appt.doctor?.toString()) || { name: "Dr. Specialist", specialization: "Radiologist" };
      const prescription = await prescriptionModel.findByAppointment(appt._id.toString());
      return {
        ...appt,
        doctor: doc,
        prescription: !!prescription
      };
    }));

    const todayStr = new Date().toISOString().split("T")[0];

    const pendingRequests = populated.filter((a: any) => a.status === "pending");
    const upcomingAppointments = populated.filter((a: any) => a.status === "accepted");
    const rejectedAppointments = populated.filter((a: any) => a.status === "rejected");
    const appointmentHistory = populated.filter((a: any) => a.status === "completed" || a.status === "cancelled" || (a.status === "accepted" && a.date < todayStr));

    const consultedDoctors = new Set(populated.map((a: any) => a.doctor?._id || a.doctor)).size;

    return {
      stats: {
        upcomingCount: upcomingAppointments.length,
        historyCount: appointmentHistory.length,
        pendingCount: pendingRequests.length,
        consultedDoctorsCount: consultedDoctors,
      },
      pendingRequests,
      upcomingAppointments,
      rejectedAppointments,
      appointmentHistory,
    };
  },

  async getDoctorDashboardData(doctorId: string) {
    const doctorProfile = await doctorModel.findByUserId(doctorId);
    const docId = doctorProfile ? doctorProfile._id.toString() : doctorId;

    const appointments = await appointmentModel.findMany({ doctor: docId });

    const patientIds = [...new Set(appointments.map((a: any) => a.patient))];
    const patients = await Promise.all(patientIds.map(id => userModel.findById(id)));
    const patientMap = new Map(patients.filter(Boolean).map((p: any) => [p._id.toString(), p]));

    const populated = appointments.map((appt: any) => ({
      ...appt,
      patient: patientMap.get(appt.patient?.toString()) || { name: "Vetted Patient", email: "" }
    }));

    const todayStr = new Date().toISOString().split("T")[0];

    const pendingRequests = populated.filter((a: any) => a.status === "pending");
    const todayQueue = populated.filter((a: any) => a.status === "accepted" && a.date === todayStr);
    const upcomingQueue = populated.filter((a: any) => a.status === "accepted" && a.date >= todayStr);

    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const weeklyScheduleCounts: Record<string, number> = {};
    daysOfWeek.forEach(d => { weeklyScheduleCounts[d] = 0; });

    populated.filter((a: any) => a.status === "accepted").forEach((a: any) => {
      try {
        const apptDate = new Date(a.date);
        const dayName = apptDate.toLocaleDateString("en-US", { weekday: "long" });
        if (weeklyScheduleCounts[dayName] !== undefined) {
          weeklyScheduleCounts[dayName] += 1;
        }
      } catch {}
    });

    const uniquePatientsCount = new Set(populated.map((a: any) => a.patient?._id || a.patient)).size;
    const totalRevenue = (doctorProfile?.consultationFee || 150) * populated.filter((a: any) => a.status === "completed" || a.status === "accepted").length;

    return {
      stats: {
        todayCount: todayQueue.length,
        pendingCount: pendingRequests.length,
        uniquePatientsCount,
        totalRevenue,
      },
      pendingRequests,
      todayQueue,
      upcomingQueue,
      weeklyScheduleCounts,
      doctorProfile,
    };
  }
};
