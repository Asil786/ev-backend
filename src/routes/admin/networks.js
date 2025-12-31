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


/**
 * =====================================================
 * DELETE /api/networks/:id
 * Only allow delete if status = 0
 * =====================================================
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        message: "Network id is required"
      });
    }

    // Check network existence and status
    const [[network]] = await db.query(
      `
      SELECT id, status
      FROM network
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!network) {
      return res.status(404).json({
        message: "Network not found"
      });
    }

    // if (network.status !== 0) {
    //   return res.status(400).json({
    //     message: "Only inactive networks (status = 0) can be deleted"
    //   });
    // }

    // Delete network
    await db.query(
      `
      DELETE FROM network
      WHERE id = ?
        AND status = 0
      `,
      [id]
    );

    return res.json({
      message: "Network deleted successfully"
    });

  } catch (err) {
    console.error("DELETE /networks ERROR:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
});


export default router;
