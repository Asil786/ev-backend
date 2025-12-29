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

    /**
     * =====================================================
     * FETCH ALL DATA (RELATIONAL)
     * =====================================================
     */
    const [rows] = await db.query(`
SELECT
  -- station
  cs.id,
  cs.name AS stationName,
  cs.latitude,
  cs.longitude,
  cs.mobile AS contactNumber,
  cs.created_at AS submissionDate,
  cs.updated_at AS approvalDate,
  cs.approved_status AS status,
  cs.type AS usageType,
  cs.station_type AS stationType,
  cs.open_time,
  cs.close_time,

  -- user
  cu.id AS userDbId,
  cu.email AS userId,
  CONCAT(cu.first_name, ' ', cu.last_name) AS userName,
  cu.name_type,

  -- network
  n.name AS networkName,

  -- connector
  c.id AS connectorId,
  ct.name AS connectorName,
  ct.type AS connectorType,
  ct.max_power AS powerRating,

  -- tariff (if exists, else null)
  c.tariff,

  -- photos
  a.path AS photoPath

FROM charging_station cs
LEFT JOIN customer cu ON cu.id = cs.created_by
LEFT JOIN network n ON n.id = cs.network_id
LEFT JOIN charging_point cp ON cp.station_id = cs.id
LEFT JOIN stations_connectors sc ON sc.charge_point_id = cp.id
LEFT JOIN connector c ON c.id = sc.connector_id
LEFT JOIN charger_types ct ON ct.id = c.charger_type_id
LEFT JOIN attachment a ON a.station_id = cs.id

ORDER BY cs.created_at DESC
LIMIT ? OFFSET ?
`, [limit, offset]);

    /**
     * =====================================================
     * BUILD FULL INTERNAL OBJECT
     * =====================================================
     */
    const stationMap = new Map();

    for (const r of rows) {
      if (!stationMap.has(r.id)) {
        stationMap.set(r.id, {
          // FULL DATA (internal)
          id: r.id,
          stationName: r.stationName,
          stationNumber: `CS-${r.id}`,
          userId: r.userId,
          userName: r.userName,
          addedByType:
            r.name_type === "IS_VANGUARD" ? "CPO" : "EV Owner",
          networkName: r.networkName,
          usageType: r.usageType === "PUBLIC" ? "Public" : "Private",
          stationType: r.stationType,
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
          approvalDate:
            r.status === "APPROVED" ? r.approvalDate : null,
          contactNumber: r.contactNumber,
          latitude: r.latitude,
          longitude: r.longitude,
          photos: [],
          connectorsMap: new Map()
        });
      }

      const station = stationMap.get(r.id);

      // photos
      if (r.photoPath && !station.photos.includes(r.photoPath)) {
        station.photos.push(r.photoPath);
      }

      // connectors
      if (r.connectorId) {
        if (!station.connectorsMap.has(r.connectorId)) {
          station.connectorsMap.set(r.connectorId, {
            name: r.connectorName,
            type: r.connectorType,
            count: 1,
            powerRating: r.powerRating
              ? `${r.powerRating} kW`
              : "-",
            tariff: r.tariff || "-"
          });
        } else {
          station.connectorsMap.get(r.connectorId).count++;
        }
      }
    }

    /**
     * =====================================================
     * RETURN ONLY FRONTEND-SAFE DATA
     * =====================================================
     */
    const data = Array.from(stationMap.values()).map(s => {
      const connectors = Array.from(s.connectorsMap.values());

      const totalConnectorCount = connectors.reduce(
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
        connectors,          // empty array if none
        eVolts: totalConnectorCount * 2
      };
    });

    res.json({ data });

  } catch (err) {
    console.error("GET /stations ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
