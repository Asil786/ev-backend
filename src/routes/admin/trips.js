
import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

/**
 * =====================================================
 * 1. CONSTANTS & CONFIGURATION
 * =====================================================
 */

const TRIP_STATUSES = {
  SAVED: "SAVED",
  ON_GOING: "ON_GOING",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
  ENQUIRED: "ENQUIRED",
  SUCCESSFULL: "SUCCESSFULL",
  ON_GOING_TEST: "ON_GOING_TEST",
  UNSUCCESSFULL: "UNSUCCESSFULL"
};

const SUCCESSFUL_STATUSES = [
  TRIP_STATUSES.COMPLETED,
  TRIP_STATUSES.ON_GOING,
  TRIP_STATUSES.ON_GOING_TEST,
  TRIP_STATUSES.SUCCESSFULL
];

const TRIP_COMPLETION_SUCCESS_STATUSES = [
  TRIP_STATUSES.COMPLETED,
  TRIP_STATUSES.SUCCESSFULL
];

const TRIP_COMPLETION_PENDING_STATUSES = [
  TRIP_STATUSES.SAVED,
  TRIP_STATUSES.ON_GOING,
  TRIP_STATUSES.ENQUIRED,
  TRIP_STATUSES.ON_GOING_TEST
];

const TRIP_COMPLETION_FAILED_STATUSES = [
  TRIP_STATUSES.CANCELLED,
  TRIP_STATUSES.UNSUCCESSFULL
];

/**
 * =====================================================
 * 2. HELPER FUNCTIONS (Pure Logic)
 * =====================================================
 */

function parseStoryMetadata(actionName, hasFeedback) {
  let storyStatus = null;
  let blogLink = null;
  let approvedBy = actionName || "-";
  const nameStr = actionName || "";

  if (nameStr.includes("[APPROVED_BY:")) {
    storyStatus = "Approved";
    const match = nameStr.match(/\[APPROVED_BY:(.*?)\]/);
    if (match) approvedBy = match[0];
  } else if (nameStr.includes("Approved By:")) {
    storyStatus = "Approved";
    approvedBy = nameStr;
  } else if (nameStr.includes("[REJECTED_BY:")) {
    storyStatus = "Rejected";
    const match = nameStr.match(/\[REJECTED_BY:(.*?)\]/);
    if (match) approvedBy = match[0];
  } else if (nameStr.includes("Rejected By:")) {
    storyStatus = "Rejected";
    approvedBy = nameStr;
  } else if (hasFeedback) {
    storyStatus = "Pending";
  }

  const blogMatch = nameStr.match(/\[BLOG_LINK:(.*?)\]/);
  if (blogMatch) {
    blogLink = blogMatch[1];
  }

  return { storyStatus, blogLink, approvedBy };
}

function createLocation(latitude, longitude, address) {
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude, address };
}

function buildWhereClause(query) {
  const { status, story } = query;
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

  return {
    whereSQL: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params
  };
}

/**
 * =====================================================
 * 3. DATA FETCHERS (Async DB Operations)
 * =====================================================
 */

async function fetchStopsForTrips(tripIds) {
  if (!tripIds.length) return {};
  const stopsMap = {};

  const [stops] = await db.query(
    `SELECT trip_id, stop, latitude, longitude FROM trip_stops WHERE trip_id IN (?) ORDER BY id ASC`,
    [tripIds]
  );

  stops.forEach(s => {
    if (!stopsMap[s.trip_id]) stopsMap[s.trip_id] = [];
    stopsMap[s.trip_id].push({
      address: s.stop,
      lat: s.latitude,
      lng: s.longitude
    });
  });

  return stopsMap;
}

async function fetchStationsForConnectors(connectorIds) {
  if (connectorIds.size === 0) return {};
  const map = {};

  const [connectors] = await db.query(
    `SELECT id, station_id FROM connector WHERE id IN (?)`,
    [[...connectorIds]]
  );

  connectors.forEach(c => {
    map[c.id] = c.station_id;
  });

  return map;
}

/**
 * =====================================================
 * 4. DATA TRANSFORMERS
 * =====================================================
 */

function transformTripRow(r, stopsMap, connectorStationMap) {
  const isSuccessfulStatus = SUCCESSFUL_STATUSES.includes(r.trip_status);
  const navigation = isSuccessfulStatus ? "Yes" : "No";
  const checkIn = isSuccessfulStatus ? "Yes" : "No";

  let tripCompletionStatus = "Failed";
  if (TRIP_COMPLETION_SUCCESS_STATUSES.includes(r.trip_status)) {
    tripCompletionStatus = "Successful";
  } else if (TRIP_COMPLETION_PENDING_STATUSES.includes(r.trip_status)) {
    tripCompletionStatus = "Pending";
  } else if (TRIP_COMPLETION_FAILED_STATUSES.includes(r.trip_status)) {
    tripCompletionStatus = "Failed";
  }

  const { storyStatus, blogLink, approvedBy } = parseStoryMetadata(r.actionByName, !!r.feedback);

  const currentConnectorIds = r.connector_id ? r.connector_id.split(",").filter(Boolean).map(s => s.trim()) : [];
  const connectorCount = currentConnectorIds.length;

  const uniqueStations = new Set();
  currentConnectorIds.forEach(cid => {
    const sid = connectorStationMap[cid] || connectorStationMap[parseInt(cid)];
    if (sid) uniqueStations.add(sid);
  });

  let stationCount = uniqueStations.size;
  if (stationCount === 0 && connectorCount > 0) {
    stationCount = 1;
  }

  const tripStops = stopsMap[r.id] || [];

  return {
    id: r.id,
    dateTime: r.created_at,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    mobileNumber: r.mobile,
    source: r.source,
    sourceLocation: createLocation(r.source_latitude, r.source_longitude, r.source),
    destination: r.destination,
    destinationLocation: createLocation(r.destination_latitude, r.destination_longitude, r.destination),
    stops: tripStops,
    totalKm: r.distance,
    stationConnectorCount: `${stationCount} stations, ${connectorCount} connectors`,
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
    approvedBy,
    storyStatus,
    blogLink,
    approvalDate: r.updated_at,
    approvedById: null
  };
}

/**
 * =====================================================
 * 5. ROUTES
 * =====================================================
 */

router.get("/", async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { whereSQL, params } = buildWhereClause(req.query);

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM trip t ${whereSQL}`, params
    );

    const [rows] = await db.query(`
      SELECT
        t.id, t.customer_id, t.created_at, t.updated_at, t.trip_status,
        t.status AS trip_status_flag, t.name AS actionByName, t.distance, t.feedback,
        t.source, t.source_latitude, t.source_longitude,
        t.destination, t.destination_latitude, t.destination_longitude,
        t.no_of_charging_stations, t.connector_id, t.battery_capacity,
        vm.name AS vehicle_model_name, vv.name AS vehicle_variant_name,
        lp.evolts,
        c.first_name, c.last_name, c.email, c.mobile
      FROM trip t
      JOIN customer c ON c.id = t.customer_id
      LEFT JOIN my_vehicles mv ON mv.id = t.vehicle_id
      LEFT JOIN vehicle_model_master vm ON vm.id = mv.vehicle_model_id
      LEFT JOIN vehicle_variant_master vv ON vv.id = mv.vehicle_variant_id
      LEFT JOIN (
        SELECT customer_id, SUM(points) AS evolts
        FROM loyalty_points
        WHERE approved_status = 'APPROVED'
        GROUP BY customer_id
      ) lp ON lp.customer_id = t.customer_id
      ${whereSQL}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const tripIds = [];
    const allConnectorIds = new Set();
    rows.forEach(r => {
      tripIds.push(r.id);
      if (r.connector_id) {
        r.connector_id.split(",").forEach(id => {
          if (id.trim()) allConnectorIds.add(id.trim());
        });
      }
    });

    const [stopsMap, connectorStationMap] = await Promise.all([
      fetchStopsForTrips(tripIds),
      fetchStationsForConnectors(allConnectorIds)
    ]);

    const data = rows.map(r => transformTripRow(r, stopsMap, connectorStationMap));

    res.json({
      data,
      pagination: { total, page, limit }
    });

  } catch (err) {
    console.error("GET /trips ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

router.put("/story/:id/", async (req, res) => {
  try {
    const { id } = req.params;
    const { action, name, blogLink } = req.body;

    if (!["Approved", "Rejected"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }
    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const blogTag = blogLink ? ` [BLOG_LINK:${blogLink}]` : "";
    let nameField = "";
    let sql = "";

    if (action === "Approved") {
      nameField = `[APPROVED_BY:${name}]${blogTag}`;
      sql = `UPDATE trip SET name = ?, updated_at = NOW() WHERE id = ? AND feedback IS NOT NULL`;
    } else {
      nameField = `[REJECTED_BY:${name}]`;
      sql = `UPDATE trip SET feedback = NULL, name = ?, updated_at = NOW() WHERE id = ?`;
    }

    await db.query(sql, [nameField, id]);
    res.json({ message: `Trip story ${action.toLowerCase()} successfully` });

  } catch (err) {
    console.error("PUT /trips/story/:id ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
