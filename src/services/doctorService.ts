import { doctorModel, DoctorDoc } from "../models/doctorModel.js";
import { userModel } from "../models/userModel.js";

export const doctorService = {
  async getDoctorDirectory(params: any) {
    const { search, specialization, experience, maxFee, availability, sortBy, page = "1", limit = "10" } = params;

    const query: any = { isVerified: true };

    if (search) {
      const matchingUsers = await userModel.findMany({
        name: { $regex: search, $options: "i" },
        role: "doctor"
      });
      const userIds = matchingUsers.map((u: any) => u._id.toString());
      query.$or = [
        { user: { $in: userIds } },
        { hospital: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
    }

    if (specialization) query.specialization = { $regex: specialization, $options: "i" };
    if (experience) query.experience = { $gte: parseInt(experience, 10) };
    if (maxFee) query.consultationFee = { $lte: parseFloat(maxFee) };
    if (availability) query["availability.day"] = availability;

    let sortOptions: any = { createdAt: -1 };
    if (sortBy === "rating") sortOptions = { rating: -1, reviewsCount: -1 };
    else if (sortBy === "fee") sortOptions = { consultationFee: 1 };
    else if (sortBy === "experience") sortOptions = { experience: -1 };

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const doctors = await doctorModel.findMany(query, sortOptions, skip, limitNum);
    const total = await doctorModel.count(query);

    const userIds = doctors.map((d: any) => d.user);
    const users = await userModel.findMany({ _id: { $in: userIds as any } });
    const userMap = new Map<string, any>(users.map((u: any) => [u._id.toString(), u]));

    const populated = doctors.map((d: any) => {
      const u = userMap.get(d.user?.toString()) || { name: d.name || "Accredited Doctor", email: "", image: d.avatar };
      return {
        ...d,
        name: d.name || u.name,
        specialty: d.specialization || d.specialty || "Radiologist",
        avatar: d.avatar || u.image || "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=800&q=80",
        bio: d.biography || "Diagnostic radiologist at Studycast Medical Center.",
        reports: d.reports || ["CT Scan - Diagnostic Study", "MRI - High Resolution", "Ultrasound Report"],
        user: u
      };
    });

    return { doctors: populated, total, page: pageNum, pages: Math.ceil(total / limitNum) };
  },

  async submitCredentialVerification(userId: string, data: { diplomaName: string; licenseNumber: string; certificateUrl: string; hospital?: string; experience?: number; specialization?: string }) {
    let profile = await doctorModel.findByUserId(userId);
    if (!profile) {
      await doctorModel.upsert(`doc_${userId}`, {
        user: userId,
        specialization: data.specialization || "Radiologist",
        hospital: data.hospital || "Studycast Medical Center",
        experience: Number(data.experience) || 5,
        diplomaName: data.diplomaName,
        licenseNumber: data.licenseNumber,
        certificateUrl: data.certificateUrl,
        verificationStatus: "pending_verification",
        isVerified: false,
      });
      profile = await doctorModel.findByUserId(userId);
    } else {
      await doctorModel.update(profile._id.toString(), {
        diplomaName: data.diplomaName,
        licenseNumber: data.licenseNumber,
        certificateUrl: data.certificateUrl,
        hospital: data.hospital || profile.hospital,
        experience: Number(data.experience) || profile.experience,
        specialization: data.specialization || profile.specialization,
        verificationStatus: "pending_verification",
        isVerified: false,
      });
    }

    return { message: "Doctor credentials submitted to Admin for supervision.", profile };
  }
};
