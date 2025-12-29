import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

/**
 * =====================================================
 * GET /api/stations/:id
 * =====================================================
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

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
  cu.id AS userId,
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
WHERE cs.id = ?
LIMIT 1
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Charging station not found" });
    }

    /**
     * =====================================================
     * TRANSFORM (single station)
     * =====================================================
     */
    const station = {
      id: rows[0].id,
      stationName: rows[0].stationName,
      stationNumber: `CS-${rows[0].id}`,
      latitude: rows[0].latitude,
      longitude: rows[0].longitude,
      networkName: rows[0].networkName,
      userName: rows[0].userName,
      userId: rows[0].userId,
      addedByType: rows[0].addedByType,
      contactNumber: rows[0].contactNumber,
      usageType: rows[0].usageType === "PUBLIC" ? "Public" : "Private",
      operationalHours:
        rows[0].open_time && rows[0].close_time
          ? `${rows[0].open_time} - ${rows[0].close_time}`
          : "-",
      status:
        rows[0].status === "APPROVED"
          ? "Approved"
          : rows[0].status === "REJECTED"
          ? "Rejected"
          : "Pending",
      submissionDate: rows[0].submissionDate,
      approvalDate:
        rows[0].status === "APPROVED" ? rows[0].approvalDate : null,
      photos: [],
      connectorsMap: new Map()
    };

    for (const r of rows) {
      if (r.photoPath && !station.photos.includes(r.photoPath)) {
        station.photos.push(r.photoPath);
      }

      if (r.connectorName) {
        const key = `${r.connectorType}|${r.connectorName}|${r.powerRating}`;

        if (!station.connectorsMap.has(key)) {
          station.connectorsMap.set(key, {
            type: r.connectorType,
            name: r.connectorName,
            count: 1,
            powerRating: r.powerRating ? `${r.powerRating} kW` : "-",
            tariff: "-"
          });
        } else {
          station.connectorsMap.get(key).count += 1;
        }
      }
    }

    const connectors = Array.from(station.connectorsMap.values());
    const totalConnectorCount = connectors.reduce(
      (sum, c) => sum + c.count,
      0
    );

    delete station.connectorsMap;

    res.json({
      ...station,
      connectors: connectors.length ? connectors : [],
      eVolts: totalConnectorCount * 2
    });

  } catch (err) {
    console.error("GET /stations/:id ERROR:", err);
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

