import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

/**
 * =====================================================
 * GET /api/trips
 * =====================================================
 */
router.get("/", async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { status, story } = req.query;

    const where = [];
    const params = [];

    if (status && status !== "All") {
      where.push("t.trip_status = ?");
      params.push(status);
    }

    if (story === "With Story") {
      where.push("t.feedback IS NOT NULL");
    } else if (story === "Without Story") {
      where.push("t.feedback IS NULL");
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    /* ---------- TOTAL COUNT ---------- */
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM trip t ${whereSQL}`,
      params
    );

    /* ---------- MAIN QUERY ---------- */
    const [rows] = await db.query(
      `
      SELECT
        t.id,
        t.customer_id,
        t.created_at,
        t.updated_at,
        t.trip_status,
        t.status AS trip_status_flag,
        t.distance,
        t.feedback,
        t.source,
        t.destination,
        t.no_of_charging_stations,
        t.connector_id,
        t.battery_capacity,

        vm.name AS vehicle_model_name,
        vv.name AS vehicle_variant_name,

        lp.evolts,

        c.first_name,
        c.last_name,
        c.email,
        c.mobile

      FROM trip t
      JOIN customer c ON c.id = t.customer_id

      LEFT JOIN my_vehicles mv ON mv.id = t.vehicle_id
      LEFT JOIN vehicle_model_master vm ON vm.id = mv.vehicle_model_id
      LEFT JOIN vehicle_variant_master vv ON vv.id = mv.vehicle_variant_id

      /* ---- EVOLTS FROM LOYALTY POINTS (APPROVED ONLY) ---- */
      LEFT JOIN (
        SELECT
          customer_id,
          SUM(points) AS evolts
        FROM loyalty_points
        WHERE approved_status = 'APPROVED'
        GROUP BY customer_id
      ) lp ON lp.customer_id = t.customer_id

      ${whereSQL}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    /* ---------- STOPS ---------- */
    const tripIds = rows.map(r => r.id);
    const stopsMap = {};

    if (tripIds.length > 0) {
      const [stops] = await db.query(
        `
        SELECT
          trip_id,
          stop,
          latitude,
          longitude
        FROM trip_stops
        WHERE trip_id IN (?)
        ORDER BY id ASC
        `,
        [tripIds]
      );

      for (const s of stops) {
        if (!stopsMap[s.trip_id]) stopsMap[s.trip_id] = [];
        stopsMap[s.trip_id].push({
          address: s.stop,
          lat: s.latitude,
          lng: s.longitude
        });
      }
    }

    /* ---------- FINAL RESPONSE ---------- */
    const data = rows.map(r => {
      /* ---- Navigation & Check-in (Dashboard View) ---- */
      let navigation = "No";
      let checkIn = "No";

      if (
        r.trip_status === "COMPLETED" ||
        r.trip_status === "ON_GOING" ||
        r.trip_status === "ON_GOING_TEST"
      ) {
        navigation = "Yes";
        checkIn = "Yes";
      }

      /* ---- Trip Completion Status (FROM t.status) ---- */
      let tripCompletionStatus = null;
      if (r.trip_status_flag === 1) {
        tripCompletionStatus = "Successful";
      } else if (r.trip_status_flag === 0) {
        tripCompletionStatus = "Failed";
      }

      const tripStops = stopsMap[r.id] || [];
      const connectorCount = r.connector_id
        ? r.connector_id.split(",").filter(Boolean).length
        : 0;

      return {
        id: r.id,
        dateTime: r.created_at,

        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        mobileNumber: r.mobile,

        source: r.source,
        stop1: tripStops[0] || null,
        stop2: tripStops[1] || null,
        stop3: tripStops[2] || null,
        destination: r.destination,

        totalKm: r.distance,

        stationConnectorCount: `${r.no_of_charging_stations || 0} stations, ${connectorCount} connectors`,
        chargingStopsCount: r.no_of_charging_stations || 0,

        evModel: r.vehicle_model_name || "-",
        evVariant: r.vehicle_variant_name || "-",
        evBatteryCapacity: r.battery_capacity || "-",

        evolts: r.evolts || 0,

        feedback: r.feedback || null,

        navigation,
        checkIn,

        tripStatus: r.trip_status,
        tripCompletionStatus,

        hasTripStory: r.feedback ? "Yes" : "No",
        storyStatus: null,

        approvalDate: r.updated_at,
        approvedBy: null
      };
    });

    res.json({
      data,
      pagination: { total, page, limit }
    });

  } catch (err) {
    console.error("GET /trips ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * =====================================================
 * PUT /api/trips/:id/story
 * =====================================================
 */
router.put("/:id/story", async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!["Approved", "Rejected"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    if (action === "Rejected") {
      await db.query(
        `
        UPDATE trip
        SET feedback = NULL,
            updated_at = NOW()
        WHERE id = ?
        `,
        [id]
      );
    }

    if (action === "Approved") {
      await db.query(
        `
        UPDATE trip
        SET updated_at = NOW()
        WHERE id = ? AND feedback IS NOT NULL
        `,
        [id]
      );
    }

    res.json({ message: `Trip story ${action.toLowerCase()} successfully` });

  } catch (err) {
    console.error("PUT /trips/:id/story ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
