import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

/* =====================================================
   GET /api/stations
===================================================== */
router.get("/", async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { status, startDate, endDate } = req.query;

    const where = [];
    const params = [];

    if (status && status !== "All") {
      where.push("cs.approved_status = ?");
      params.push(status.toUpperCase());
    }
    if (startDate) {
      where.push("cs.created_at >= ?");
      params.push(startDate);
    }
    if (endDate) {
      where.push("cs.created_at <= ?");
      params.push(endDate);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM charging_station cs ${whereSQL}`,
      params
    );

    const [stationIdRows] = await db.query(
      `
      SELECT cs.id
      FROM charging_station cs
      ${whereSQL}
      ORDER BY cs.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const stationIds = stationIdRows.map(r => r.id);
    if (!stationIds.length) {
      return res.json({ data: [], pagination: { total, page, limit } });
    }

    const [rows] = await db.query(
      `
      SELECT
        cs.id,
        cs.name AS stationName,
        cs.latitude,
        cs.longitude,
        cs.mobile AS contactNumber,
        cs.created_at AS submissionDate,
        cs.updated_at AS approvalDate,
        cs.approved_status AS status,
        cs.open_time,
        cs.close_time,
        cs.type AS usageType,
        cs.user_type AS addedByType,
        cs.landmark AS landMark,

        cs.network_id AS networkId,
        n.name AS networkName,
        n.status AS networkStatus,

        CONCAT(cu.first_name, ' ', cu.last_name) AS userName
      FROM charging_station cs
      LEFT JOIN network n ON n.id = cs.network_id
      LEFT JOIN customer cu ON cu.id = cs.created_by
      WHERE cs.id IN (?)
      ORDER BY cs.created_at DESC
      `,
      [stationIds]
    );

    res.json({
      data: rows.map(r => ({
        id: r.id,
        stationName: r.stationName,
        stationNumber: `CS-${r.id}`,
        latitude: r.latitude,
        longitude: r.longitude,
        contactNumber: r.contactNumber,
        landMark: r.landMark || "-",
        usageType: r.usageType === "PUBLIC" ? "Public" : "Private",
        addedByType: r.addedByType,
        userName: r.userName,
        networkId: r.networkId,
        networkName: r.networkName || "-",
        networkStatus: r.networkStatus ?? 0,
        status: r.status,
        submissionDate: r.submissionDate,
        approvalDate: r.approvalDate
      })),
      pagination: { total, page, limit }
    });

  } catch (err) {
    console.error("GET /stations ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   PUT /api/stations/:id
===================================================== */
router.put("/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;
    const {
      action,
      stationName,
      latitude,
      longitude,
      contactNumber,
      open_time,
      close_time,
      networkId,
      networkName,
      networkStatus
    } = req.body;

    if (action !== "SAVE") {
      return res.status(400).json({ message: "Only SAVE is supported" });
    }

    await connection.beginTransaction();

    /* ---------- UPDATE STATION ---------- */
    await connection.query(
      `
      UPDATE charging_station
      SET name = ?,
          latitude = ?,
          longitude = ?,
          mobile = ?,
          open_time = ?,
          close_time = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        stationName,
        latitude,
        longitude,
        contactNumber,
        open_time,
        close_time,
        id
      ]
    );

    /* ---------- NETWORK LOGIC ---------- */
    let finalNetworkId = null;
    const netStatus = Number(networkStatus);

    // CASE 1: network already active
    if (netStatus === 1 && networkId) {
      const [[exists]] = await connection.query(
        `SELECT id FROM network WHERE id = ? LIMIT 1`,
        [networkId]
      );
      if (exists) finalNetworkId = exists.id;
    }

    // CASE 2: inactive → deduplicate + activate
    if (netStatus === 0 && networkName) {
      const [networks] = await connection.query(
        `
        SELECT id, created_at
        FROM network
        WHERE name = ?
        ORDER BY created_at ASC
        `,
        [networkName]
      );

      if (!networks.length) {
        throw new Error("Network not found");
      }

      finalNetworkId = networks[0].id;

      for (let i = 1; i < networks.length; i++) {
        await connection.query(
          `
          UPDATE charging_station
          SET network_id = ?
          WHERE network_id = ?
          `,
          [finalNetworkId, networks[i].id]
        );

        await connection.query(
          `DELETE FROM network WHERE id = ?`,
          [networks[i].id]
        );
      }

      await connection.query(
        `
        UPDATE network
        SET name = ?, status = 1, updated_at = NOW()
        WHERE id = ?
        `,
        [networkName, finalNetworkId]
      );
    }

    /* ---------- LINK STATION ---------- */
    if (finalNetworkId) {
      await connection.query(
        `
        UPDATE charging_station
        SET network_id = ?
        WHERE id = ?
        `,
        [finalNetworkId, id]
      );
    }

    await connection.commit();
    res.json({ message: "Station and network updated successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("PUT /stations ERROR:", err);
    res.status(500).json({ message: err.message });
  } finally {
    connection.release();
  }
});

export default router;
