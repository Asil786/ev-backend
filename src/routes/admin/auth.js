import express from "express";
import { db } from "../../db.js";

const router = express.Router();

/* =====================================================
   In-memory OTP store
===================================================== */
const otpStore = new Map(); // mobile -> { otp, expiresAt }

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/* =====================================================
   Helpers
===================================================== */
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const sendOtpSms = (mobile, otp) => {
  // Replace with real SMS provider
  console.log(`Sending OTP ${otp} to ${mobile}`);
};

/* =====================================================
   POST /api/auth/vendor/login
   - check vendor by mobile only
   - send OTP
===================================================== */
router.post("/login", async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({ message: "Mobile number is required" });
    }

    const [[vendor]] = await db.query(
      `
      SELECT
        id,
        name,
        email,
        mobile,
        pan,
        gst_no
      FROM vendor
      WHERE mobile = ?
      LIMIT 1
      `,
      [mobile]
    );

    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const otp = generateOTP();

    otpStore.set(mobile, {
      otp,
      expiresAt: Date.now() + OTP_EXPIRY_MS
    });

    sendOtpSms(mobile, otp);

    return res.json({
      message: "OTP sent successfully",
      vendor: {
        name: vendor.name || "-",
        email: vendor.email || "-",
        mobile: vendor.mobile,
        pan: vendor.pan || "-",
        gstNo: vendor.gst_no || "-"
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/* =====================================================
   POST /api/auth/vendor/verify-otp
===================================================== */
router.post("/verify-otp", async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        message: "Mobile number and OTP are required"
      });
    }

    const record = otpStore.get(mobile);

    if (!record) {
      return res.status(401).json({ message: "OTP not found or expired" });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(mobile);
      return res.status(401).json({ message: "OTP expired" });
    }

    if (record.otp !== otp) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    otpStore.delete(mobile);

    return res.json({ message: "Login successful" });

  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/* =====================================================
   POST /api/auth/vendor/resend-otp
===================================================== */
router.post("/resend-otp", async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({ message: "Mobile number is required" });
    }

    const [[vendor]] = await db.query(
      `
      SELECT mobile
      FROM vendor
      WHERE mobile = ?
      LIMIT 1
      `,
      [mobile]
    );

    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const otp = generateOTP();

    otpStore.set(mobile, {
      otp,
      expiresAt: Date.now() + OTP_EXPIRY_MS
    });

    sendOtpSms(mobile, otp);

    return res.json({ message: "OTP resent successfully" });

  } catch (err) {
    console.error("RESEND OTP ERROR:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
