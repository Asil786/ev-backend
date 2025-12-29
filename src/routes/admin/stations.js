import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

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

    // TOTAL COUNT
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM charging_station cs ${whereSQL}`,
      params
    );

    // MAIN QUERY (schema-strict)
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

  ct.type AS connectorType,
  ct.name AS connectorName,
  ct.max_power AS powerRating,

  a.path AS photoPath

FROM charging_station cs
LEFT JOIN network n ON n.id = cs.network_id
LEFT JOIN customer cu ON cu.id = cs.created_by
LEFT JOIN charging_point cp ON cp.station_id = cs.id
LEFT JOIN stations_connectors sc ON sc.charge_point_id = cp.id
LEFT JOIN connector c ON c.id = sc.connector_id
LEFT JOIN charger_types ct ON ct.id = c.charger_type_id
LEFT JOIN attachment a ON a.station_id = cs.id
${whereSQL}
ORDER BY cs.created_at DESC
LIMIT ? OFFSET ?

      `,
      [...params, limit, offset]
    );

    /**
     * =====================================================
     * TRANSFORM + GROUP CONNECTORS
     * =====================================================
     */
    const stationMap = new Map();

    for (const r of rows) {
      if (!stationMap.has(r.id)) {
        stationMap.set(r.id, {
          id: r.id,
          stationName: r.stationName,
          stationNumber: `CS-${r.id}`, // derived, schema-safe
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
          connectorsMap: new Map(), // temp for grouping
        });
      }

      const station = stationMap.get(r.id);

      // PHOTOS
      if (r.photoPath && !station.photos.includes(r.photoPath)) {
        station.photos.push(r.photoPath);
      }

      // CONNECTORS (group by type + name + power)
      if (r.connectorName) {
        const key = `${r.connectorType}|${r.connectorName}|${r.powerRating}`;

        if (!station.connectorsMap.has(key)) {
          station.connectorsMap.set(key, {
            type: r.connectorType,
            name: r.connectorName,
            count: 1,
            powerRating: r.powerRating ? `${r.powerRating} kW` : "-",
            tariff: "-", // NOT in schema
          });
        } else {
          station.connectorsMap.get(key).count += 1;
        }
      }
    }

    /**
     * =====================================================
     * FINAL SHAPING (23-column safe)
     * =====================================================
     */
const data = Array.from(stationMap.values()).map(s => {
  const connectors = Array.from(s.connectorsMap.values());

  const finalConnectors =
    connectors.length > 0
      ? connectors
      : [{
          type: "-",
          name: "-",
          count: 0,
          powerRating: "-",
          tariff: "-"
        }];

  const totalConnectorCount = finalConnectors.reduce(
    (sum, c) => sum + c.count,
    0
  );

  return {
    id: s.id,
    stationName: s.stationName,
    stationNumber: s.stationNumber,
    latitude: s.latitude,
    longitude: s.longitude,
    networkName: s.networkName,
    userName: s.userName,
    addedByType: s.addedByType,
    contactNumber: s.contactNumber,
    usageType: s.usageType,
    operationalHours: s.operationalHours,
    status: s.status,
    submissionDate: s.submissionDate,
    approvalDate: s.approvalDate,
    photos: s.photos,
    connectors: finalConnectors,
    eVolts: totalConnectorCount * 2
  };
});


    res.json({
      data,
      pagination: { total, page, limit },
    });
  } catch (err) {
    console.error("GET /stations ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * =====================================================
 * PUT /api/stations/:id/status
 * =====================================================
 */
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    await db.query(
      `
      UPDATE charging_station
      SET approved_status = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [status.toUpperCase(), id]
    );

    res.json({ message: `Station ${status} successfully` });
  } catch (err) {
    console.error("PUT /stations/:id/status ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
/**
 * =====================================================
 * PUT /api/stations/:id/status
 * =====================================================
 */
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    await db.query(
      `
      UPDATE charging_station
      SET approved_status = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [status.toUpperCase(), id]
    );

    res.json({ message: `Station ${status} successfully` });
  } catch (err) {
    console.error("PUT /stations/:id/status ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
