import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

/**
 * =====================================================
 * GET /api/stations
 * =====================================================
 */
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

    /**
     * TOTAL COUNT
     */
    const [[{ total }]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM charging_station cs
      ${whereSQL}
      `,
      params
    );

    /**
     * STEP 1: FETCH STATION IDS (PAGINATION SAFE)
     */
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

    if (stationIds.length === 0) {
      return res.json({
        data: [],
        pagination: { total, page, limit }
      });
    }

    /**
     * STEP 2: FETCH FULL DATA
     */
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

        n.name AS networkName,

        CONCAT(cu.first_name, ' ', cu.last_name) AS userName,
        CASE
          WHEN cu.name_type = 'IS_VANGUARD' THEN 'CPO'
          ELSE 'EV Owner'
        END AS addedByType,

        c.id AS connectorId,
        ct.id AS chargerTypeId,
        ct.name AS chargerName,
        ct.type AS chargerType,
        ct.max_power AS powerRating,
        c.no_of_connectors,
        c.price_per_khw,

        lp.eVolts,
        a.path AS photoPath

      FROM charging_station cs
      LEFT JOIN network n ON n.id = cs.network_id
      LEFT JOIN customer cu ON cu.id = cs.created_by
      LEFT JOIN charging_point cp ON cp.station_id = cs.id
      LEFT JOIN connector c ON c.charge_point_id = cp.id
      LEFT JOIN charger_types ct ON ct.id = c.charger_type_id
      LEFT JOIN (
        SELECT station_id, SUM(points) AS eVolts
        FROM loyalty_points
        WHERE approved_status = 'APPROVED'
        GROUP BY station_id
      ) lp ON lp.station_id = cs.id
      LEFT JOIN attachment a ON a.station_id = cs.id

      WHERE cs.id IN (?)
      ORDER BY cs.created_at DESC
      `,
      [stationIds]
    );

    /**
     * MERGE + DEDUP
     */
    const stationMap = new Map();

    for (const r of rows) {
      if (!stationMap.has(r.id)) {
        stationMap.set(r.id, {
          id: r.id,
          stationName: r.stationName,
          stationNumber: `CS-${r.id}`,
          latitude: r.latitude,
          longitude: r.longitude,
          networkName: r.networkName,
          userName: r.userName,
          addedByType: r.addedByType,
          contactNumber: r.contactNumber,
          usageType: r.usageType === "PUBLIC" ? "Public" : "Private",
          operationalHours:
            r.open_time && r.close_time
              ? `${r.open_time} - ${r.close_time}`
              : "-",
          status:
            r.status === "APPROVED"
              ? "Approved"
              : r.status === "REJECTED"
              ? "Rejected"
              : "Pending",
          submissionDate: r.submissionDate,
          approvalDate: r.status === "APPROVED" ? r.approvalDate : null,
          photos: [],
          connectors: [],
          eVolts: r.eVolts || 0
        });
      }

      const station = stationMap.get(r.id);

      if (r.photoPath && !station.photos.includes(r.photoPath)) {
        station.photos.push(r.photoPath);
      }

      if (r.connectorId) {
        const exists = station.connectors.find(
          c => c.id === r.connectorId
        );

        if (!exists) {
          station.connectors.push({
            id: r.connectorId,
            chargerTypeId: r.chargerTypeId,
            type: r.chargerType,
            name: r.chargerName,
            count: r.no_of_connectors || 0,
            powerRating: r.powerRating ? `${r.powerRating} kW` : "-",
            tariff: r.price_per_khw
              ? `₹${r.price_per_khw}/kWh`
              : "-"
          });
        }
      }
    }

    res.json({
      data: Array.from(stationMap.values()),
      pagination: { total, page, limit }
    });

  } catch (err) {
    console.error("GET /stations ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * =====================================================
 * PUT /api/stations/:id
 * =====================================================
 */
router.put("/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;
    const {
      action,
      reason,
      stationName,
      latitude,
      longitude,
      contactNumber,
      open_time,
      close_time,
      connectors = []
    } = req.body;

    if (!action) {
      return res.status(400).json({ message: "action is required" });
    }

    await connection.beginTransaction();

    /**
     * APPROVE
     */
    if (action === "APPROVE") {
      await connection.query(
        `
        UPDATE charging_station
        SET verified = 1,
            approved_status = 'APPROVED',
            reason = NULL,
            updated_at = NOW()
        WHERE id = ?
        `,
        [id]
      );

      await connection.query(
        `
        UPDATE loyalty_points
        SET approved_status = 'APPROVED'
        WHERE station_id = ?
          AND approved_status = 'PENDING'
        `,
        [id]
      );

      await connection.commit();
      return res.json({ message: "Station approved" });
    }

    /**
     * REJECT
     */
    if (action === "REJECT") {
      const rejectReason =
        typeof reason === "string" && reason.trim()
          ? reason.trim()
          : null;

      await connection.query(
        `
        UPDATE charging_station
        SET verified = 0,
            approved_status = 'REJECTED',
            reason = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [rejectReason, id]
      );

      await connection.query(
        `
        UPDATE loyalty_points
        SET approved_status = 'REJECTED'
        WHERE station_id = ?
          AND approved_status = 'PENDING'
        `,
        [id]
      );

      await connection.commit();
      return res.json({ message: "Station rejected" });
    }

    /**
     * SAVE
     */
    if (action === "SAVE") {
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

      const [[cp]] = await connection.query(
        `SELECT id FROM charging_point WHERE station_id = ? LIMIT 1`,
        [id]
      );

      let chargePointId = cp?.id;
      if (!chargePointId) {
        const [insert] = await connection.query(
          `INSERT INTO charging_point (station_id, status) VALUES (?, 1)`,
          [id]
        );
        chargePointId = insert.insertId;
      }

      await connection.query(
        `DELETE FROM connector WHERE charge_point_id = ?`,
        [chargePointId]
      );

      for (const c of connectors) {
        await connection.query(
          `
          INSERT INTO connector (
            charge_point_id,
            charger_type_id,
            no_of_connectors,
            power,
            price_per_khw,
            status,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, 1, NOW())
          `,
          [
            chargePointId,
            c.chargerTypeId,
            c.count,
            c.powerRating ? parseFloat(c.powerRating) : null,
            c.tariff ? parseFloat(c.tariff) : null
          ]
        );
      }

      await connection.commit();
      return res.json({ message: "Station updated successfully" });
    }

    return res.status(400).json({ message: "Invalid action" });

  } catch (err) {
    await connection.rollback();
    console.error("PUT /stations ERROR:", err);
    res.status(500).json({ message: err.message });
  } finally {
    connection.release();
  }
});

export default router;
