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

    /* ---------- TOTAL COUNT ---------- */
    const [[{ total }]] = await db.query(
      `
      SELECT COUNT(DISTINCT cs.id) AS total
      FROM charging_station cs
      ${whereSQL}
      `,
      params
    );

    /* ---------- MAIN QUERY ---------- */
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

        cs.network_id,
        n.name AS networkName,

        CONCAT(cu.first_name, ' ', cu.last_name) AS userName,
        CASE
          WHEN cu.name_type = 'IS_VANGUARD' THEN 'CPO'
          ELSE 'EV Owner'
        END AS addedByType,

        ct.id AS charger_type_id,
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

      ${whereSQL}
      ORDER BY cs.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    /* ---------- MERGE BY station.id ---------- */
    const stationMap = new Map();

    for (const r of rows) {
      if (!stationMap.has(r.id)) {
        stationMap.set(r.id, {
          id: r.id,
          stationName: r.stationName,
          stationNumber: `CS-${r.id}`,
          latitude: r.latitude,
          longitude: r.longitude,
          networkId: r.network_id,
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
          connectorsMap: new Map(),
          eVolts: r.eVolts || 0
        });
      }

      const station = stationMap.get(r.id);

      if (r.photoPath && !station.photos.includes(r.photoPath)) {
        station.photos.push(r.photoPath);
      }

      if (r.chargerName) {
        const key = `${r.charger_type_id}|${r.chargerName}|${r.powerRating}|${r.price_per_khw}`;

        if (!station.connectorsMap.has(key)) {
          station.connectorsMap.set(key, {
            chargerTypeId: r.charger_type_id,
            type: r.chargerType,
            name: r.chargerName,
            count: r.no_of_connectors || 0,
            powerRating: r.powerRating ? `${r.powerRating} kW` : "-",
            tariff: r.price_per_khw
              ? `₹${r.price_per_khw}/kWh`
              : "-"
          });
        } else {
          station.connectorsMap.get(key).count += r.no_of_connectors || 0;
        }
      }
    }

    /* ---------- FINAL RESPONSE ---------- */
    const data = Array.from(stationMap.values()).map(s => ({
      id: s.id,
      stationName: s.stationName,
      stationNumber: s.stationNumber,
      latitude: s.latitude,
      longitude: s.longitude,
      networkId: s.networkId,
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
      connectors: Array.from(s.connectorsMap.values()),
      eVolts: s.eVolts
    }));

    res.json({ data, pagination: { total, page, limit } });
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
router.put("stations/:id", async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    const {
      stationName,
      network_id,
      usageType,
      open_time,
      close_time,
      latitude,
      longitude,
      contactNumber,
      connectors
    } = req.body;

    await connection.beginTransaction();

    await connection.query(
      `
      UPDATE charging_station
      SET name=?, network_id=?, type=?, open_time=?, close_time=?,
          latitude=?, longitude=?, mobile=?, updated_at=NOW()
      WHERE id=?
      `,
      [
        stationName,
        network_id,
        usageType,
        open_time,
        close_time,
        latitude,
        longitude,
        contactNumber,
        id
      ]
    );

    const [[cp]] = await connection.query(
      `SELECT id FROM charging_point WHERE station_id=? LIMIT 1`,
      [id]
    );

    let chargePointId = cp?.id;
    if (!chargePointId) {
      const [r] = await connection.query(
        `INSERT INTO charging_point (station_id, status) VALUES (?,1)`,
        [id]
      );
      chargePointId = r.insertId;
    }

    await connection.query(
      `DELETE FROM connector WHERE charge_point_id=?`,
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
          parseFloat(c.powerRating) || null,
          parseFloat(c.tariff.replace(/[^\d.]/g, "")) || null
        ]
      );
    }

    await connection.commit();
    res.json({ message: "Station updated successfully" });
  } catch (err) {
    await connection.rollback();
    console.error("PUT /stations/:id ERROR:", err);
    res.status(500).json({ message: err.message });
  } finally {
    connection.release();
  }
});

export default router;
