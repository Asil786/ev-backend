import express from "express";
import { db } from "../../db.js";

const router = express.Router();

/**
 * =====================================================
 * GET /api/networks
 * =====================================================
 */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT
        id,
        name,
        status,
        live_status,
        approved_status
      FROM network
      ORDER BY id DESC
      `
    );

    const response = {
      active: [],
      inactive: []
    };

    for (const n of rows) {
      const networkData = {
        id: n.id,
        name: n.name,
        status: n.status,
        liveStatus: n.live_status,
        approvedStatus: n.approved_status
      };

      if (n.status === 1) {
        response.active.push(networkData);
      } else {
        response.inactive.push(networkData);
      }
    }

    res.json(response);

  } catch (err) {
    console.error("GET /networks ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
