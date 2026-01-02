import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build WHERE clause and parameters for filtering stations
 */
function buildWhereClause(filters) {
  const { status, startDate, endDate, search } = filters;
  const where = [];
  const params = [];

  // Status filter
  if (status && status !== "All") {
    where.push("cs.approved_status = ?");
    params.push(status.toUpperCase());
  }

  // Date range filters
  if (startDate) {
    where.push("cs.created_at >= ?");
    params.push(startDate);
  }

  if (endDate) {
    where.push("cs.created_at <= ?");
    params.push(endDate + ' 23:59:59');
  }

  // Search filter
  if (search) {
    where.push(`(
      cs.name LIKE ? OR
      cs.landmark LIKE ? OR
      cs.mobile LIKE ? OR
      CONCAT('CS-', cs.id) LIKE ?
    )`);
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { whereSQL, params };
}

/**
 * Get total count of stations matching filters
 */
async function getTotalStations(whereSQL, params) {
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM charging_station cs ${whereSQL}`,
    params
  );
  return total;
}

/**
 * Get station IDs with pagination
 */
async function getStationIds(whereSQL, params, limit, offset) {
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
  return stationIdRows.map((r) => r.id);
}

/**
 * Fetch full station details with all related data
 */
async function fetchStationDetails(stationIds) {
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
      cs.landmark AS stationType,
      cs.reason AS statusReason,
      cs.created_by AS userId,

      n.id AS networkId,
      n.name AS networkName,
      n.status AS networkStatus,

      CONCAT(cu.first_name, ' ', cu.last_name) AS userName,

      c.id AS connectorId,
      ct.id AS chargerTypeId,
      ct.name AS chargerName,
      ct.type AS chargerType,
      c.power AS powerRating,
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
  return rows;
}

/**
 * Map database row to station object
 */
function mapStationRow(row) {
  return {
    id: row.id,
    stationName: row.stationName,
    stationNumber: `CS-${row.id}`,
    latitude: row.latitude,
    longitude: row.longitude,
    networkId: row.networkId,
    networkName: row.networkName,
    networkStatus: row.networkStatus,
    userId: row.userId,
    userName: row.userName,
    addedByType: row.addedByType,
    contactNumber: row.contactNumber,
    usageType: row.usageType === "PUBLIC" ? "Public" : "Private",
    stationType: row.stationType || "-",
    operationalHours:
      row.open_time && row.close_time
        ? `${row.open_time} - ${row.close_time}`
        : "-",
    status:
      row.status === "APPROVED"
        ? "Approved"
        : row.status === "REJECTED"
          ? "Rejected"
          : "Pending",
    statusReason: row.statusReason || null,
    submissionDate: row.submissionDate,
    approvalDate: row.status === "APPROVED" ? row.approvalDate : null,
    photos: [],
    connectors: [],
    eVolts: row.eVolts || 0,
  };
}

/**
 * Group rows by station and aggregate photos/connectors
 */
function aggregateStationData(rows) {
  const stationMap = new Map();

  for (const row of rows) {
    // Initialize station if not exists
    if (!stationMap.has(row.id)) {
      stationMap.set(row.id, mapStationRow(row));
    }

    const station = stationMap.get(row.id);

    // Add photo if exists and not duplicate
    if (row.photoPath && !station.photos.includes(row.photoPath)) {
      station.photos.push(row.photoPath);
    }

    // Add connector if exists and not duplicate
    if (row.connectorId && !station.connectors.find((c) => c.id === row.connectorId)) {
      station.connectors.push({
        id: row.connectorId,
        chargerTypeId: row.chargerTypeId,
        type: row.chargerType,
        name: row.chargerName,
        count: row.no_of_connectors || 0,
        powerRating: row.powerRating ? `${row.powerRating} kW` : "-",
        tariff: row.price_per_khw ? `₹${row.price_per_khw}/kWh` : "-",
      });
    }
  }

  return Array.from(stationMap.values());
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/stations/charger-types
 * Get list of available charger types
 */
router.get("/charger-types", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, type, max_power AS defaultPower FROM charger_types ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /charger-types ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * @swagger
 * /api/stations:
 *   get:
 *     summary: Get paginated list of station submissions
 *     description: |
 *       Retrieves a paginated list of charging station submissions with comprehensive filtering options.
 *       Supports filtering by status, date range, and search terms.
 *       Returns detailed information including station details, network info, connectors, photos, and eVolts.
 *     tags:
 *       - Stations
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of records per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [All, Pending, Approved, Rejected]
 *           default: All
 *         description: Filter by approval status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter stations submitted on or after this date (YYYY-MM-DD)
 *         example: "2024-01-01"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter stations submitted on or before this date (YYYY-MM-DD)
 *         example: "2024-12-31"
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by station name, landmark, contact number, or station ID
 *         example: "Mumbai Central"
 *     responses:
 *       200:
 *         description: Successful response with station data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 123
 *                       stationName:
 *                         type: string
 *                         example: "Mumbai Central Charging Hub"
 *                       stationNumber:
 *                         type: string
 *                         example: "CS-123"
 *                       latitude:
 *                         type: number
 *                         format: double
 *                         example: 19.0760
 *                       longitude:
 *                         type: number
 *                         format: double
 *                         example: 72.8777
 *                       networkId:
 *                         type: integer
 *                         nullable: true
 *                         example: 5
 *                       networkName:
 *                         type: string
 *                         example: "Tata Power"
 *                       networkStatus:
 *                         type: integer
 *                         example: 1
 *                       userId:
 *                         type: integer
 *                         example: 456
 *                       userName:
 *                         type: string
 *                         example: "John Doe"
 *                       addedByType:
 *                         type: string
 *                         example: "CPO"
 *                       contactNumber:
 *                         type: string
 *                         example: "9876543210"
 *                       usageType:
 *                         type: string
 *                         enum: [Public, Private]
 *                         example: "Public"
 *                       stationType:
 *                         type: string
 *                         example: "Shopping Mall"
 *                       operationalHours:
 *                         type: string
 *                         example: "09:00:00 - 21:00:00"
 *                       status:
 *                         type: string
 *                         enum: [Pending, Approved, Rejected]
 *                         example: "Approved"
 *                       statusReason:
 *                         type: string
 *                         nullable: true
 *                         example: null
 *                       submissionDate:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-15T10:30:00.000Z"
 *                       approvalDate:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                         example: "2024-01-20T14:00:00.000Z"
 *                       photos:
 *                         type: array
 *                         items:
 *                           type: string
 *                         example: ["/uploads/station_123_1.jpg", "/uploads/station_123_2.jpg"]
 *                       connectors:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: integer
 *                               example: 789
 *                             chargerTypeId:
 *                               type: integer
 *                               example: 2
 *                             type:
 *                               type: string
 *                               example: "CCS2"
 *                             name:
 *                               type: string
 *                               example: "CCS Type 2"
 *                             count:
 *                               type: integer
 *                               example: 2
 *                             powerRating:
 *                               type: string
 *                               example: "60 kW"
 *                             tariff:
 *                               type: string
 *                               example: "₹12/kWh"
 *                       eVolts:
 *                         type: integer
 *                         example: 500
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 150
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     limit:
 *                       type: integer
 *                       example: 10
 *             examples:
 *               success:
 *                 summary: Successful response with stations
 *                 value:
 *                   data:
 *                     - id: 123
 *                       stationName: "Mumbai Central Charging Hub"
 *                       stationNumber: "CS-123"
 *                       latitude: 19.0760
 *                       longitude: 72.8777
 *                       networkId: 5
 *                       networkName: "Tata Power"
 *                       networkStatus: 1
 *                       userId: 456
 *                       userName: "John Doe"
 *                       addedByType: "CPO"
 *                       contactNumber: "9876543210"
 *                       usageType: "Public"
 *                       stationType: "Shopping Mall"
 *                       operationalHours: "09:00:00 - 21:00:00"
 *                       status: "Approved"
 *                       statusReason: null
 *                       submissionDate: "2024-01-15T10:30:00.000Z"
 *                       approvalDate: "2024-01-20T14:00:00.000Z"
 *                       photos: ["/uploads/station_123_1.jpg"]
 *                       connectors:
 *                         - id: 789
 *                           chargerTypeId: 2
 *                           type: "CCS2"
 *                           name: "CCS Type 2"
 *                           count: 2
 *                           powerRating: "60 kW"
 *                           tariff: "₹12/kWh"
 *                       eVolts: 500
 *                   pagination:
 *                     total: 150
 *                     page: 1
 *                     limit: 10
 *               empty:
 *                 summary: No stations found
 *                 value:
 *                   data: []
 *                   pagination:
 *                     total: 0
 *                     page: 1
 *                     limit: 10
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Database connection failed"
 */
router.get("/", async (req, res) => {
  try {
    // 1. Parse pagination and filters
    const { page, limit, offset } = getPagination(req.query);
    const { status, startDate, endDate, search } = req.query;

    // 2. Build WHERE clause
    const { whereSQL, params } = buildWhereClause({ status, startDate, endDate, search });

    // 3. Get total count
    const total = await getTotalStations(whereSQL, params);

    // 4. Get station IDs with pagination
    const stationIds = await getStationIds(whereSQL, params, limit, offset);

    // 5. Return empty if no stations found
    if (!stationIds.length) {
      return res.json({ data: [], pagination: { total, page, limit } });
    }

    // 6. Fetch full station details
    const rows = await fetchStationDetails(stationIds);

    // 7. Aggregate and format data
    const data = aggregateStationData(rows);

    // 8. Send response
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
 * @swagger
 * /api/stations/download:
 *   get:
 *     summary: Download station submissions as CSV with connector-level rows
 *     description: |
 *       Downloads all station submissions matching the current filters as a CSV file.
 *       Each connector gets its own row, so stations with multiple connectors will appear multiple times.
 *       Respects all active filters (status, date range, search).
 *     tags:
 *       - Stations
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [All, Pending, Approved, Rejected]
 *         description: Filter by approval status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter stations submitted on or after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter stations submitted on or before this date
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       500:
 *         description: Internal server error
 */
router.get("/download", async (req, res) => {
  try {
    const { status, startDate, endDate, search } = req.query;

    // Build WHERE clause using same filters as main endpoint
    const { whereSQL, params } = buildWhereClause({ status, startDate, endDate, search });

    // Fetch ALL matching stations (no pagination for download)
    const [stationIdRows] = await db.query(
      `
      SELECT cs.id
      FROM charging_station cs
      ${whereSQL}
      ORDER BY cs.created_at DESC
      `,
      params
    );

    const stationIds = stationIdRows.map((r) => r.id);

    // If no stations found, return empty CSV
    if (!stationIds.length) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="station_submissions.csv"');
      return res.send('No data found');
    }

    // Fetch full station details
    const rows = await fetchStationDetails(stationIds);

    // Build CSV with connector-level rows
    const csvHeaders = [
      'Station ID',
      'Submission Date',
      'Submission Time',
      'Added By Type',
      'Customer Name',
      'Customer Phone',
      'Latitude',
      'Longitude',
      'Network Name',
      'Station Name',
      'Station Number',
      'Connector Type',
      'Connector Name',
      'Connector Count',
      'Power Rating',
      'Tariff',
      'Usage Type',
      'Station Type',
      'Operational Hours',
      'Photo Count',
      'Status',
      'Status Reason',
      'EVolts',
      'Approval Date',
      'Approval Time'
    ];

    const csvRows = [];

    // Group by station first
    const stationMap = new Map();
    for (const row of rows) {
      if (!stationMap.has(row.id)) {
        stationMap.set(row.id, {
          ...mapStationRow(row),
          rawConnectors: [],
          photoCount: 0
        });
      }

      const station = stationMap.get(row.id);

      // Track photos
      if (row.photoPath && !station.photos.includes(row.photoPath)) {
        station.photos.push(row.photoPath);
        station.photoCount++;
      }

      // Track connectors with full details
      if (row.connectorId && !station.rawConnectors.find(c => c.id === row.connectorId)) {
        station.rawConnectors.push({
          id: row.connectorId,
          type: row.chargerType || '-',
          name: row.chargerName || '-',
          count: row.no_of_connectors || 0,
          powerRating: row.powerRating ? `${row.powerRating} kW` : '-',
          tariff: row.price_per_khw ? `₹${row.price_per_khw}/kWh` : '-'
        });
      }
    }

    // Generate CSV rows - one per connector
    for (const station of stationMap.values()) {
      const submissionDate = new Date(station.submissionDate);
      const approvalDate = station.approvalDate ? new Date(station.approvalDate) : null;

      const baseRow = [
        station.id,
        submissionDate.toLocaleDateString('en-GB'),
        submissionDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        station.addedByType || '-',
        station.userName || '-',
        station.contactNumber || '-',
        station.latitude,
        station.longitude,
        station.networkName || '-',
        station.stationName,
        station.stationNumber,
        // Connector fields will be added per row
      ];

      const endRow = [
        station.usageType,
        station.stationType,
        station.operationalHours,
        station.photoCount,
        station.status,
        station.statusReason || '-',
        station.eVolts,
        approvalDate ? approvalDate.toLocaleDateString('en-GB') : '-',
        approvalDate ? approvalDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'
      ];

      // If station has connectors, create one row per connector
      if (station.rawConnectors.length > 0) {
        for (const connector of station.rawConnectors) {
          csvRows.push([
            ...baseRow,
            connector.type,
            connector.name,
            connector.count,
            connector.powerRating,
            connector.tariff,
            ...endRow
          ]);
        }
      } else {
        // No connectors - single row with empty connector fields
        csvRows.push([
          ...baseRow,
          '-', // connector type
          '-', // connector name
          '0', // connector count
          '-', // power rating
          '-', // tariff
          ...endRow
        ]);
      }
    }

    // Build CSV content
    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(cell => {
        // Escape cells containing commas, quotes, or newlines
        const cellStr = String(cell);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(','))
    ].join('\n');

    // Send CSV file
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="station_submissions.csv"');
    res.send('\uFEFF' + csvContent); // Add BOM for Excel compatibility

  } catch (err) {
    console.error("GET /stations/download ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// ============================================================================
// PUT ENDPOINT HELPER FUNCTIONS
// ============================================================================

/**
 * Update station basic information
 */
async function updateStationBasicInfo(connection, id, data) {
  await connection.query(
    `
    UPDATE charging_station
    SET name = ?, landmark = ?, latitude = ?, longitude = ?, 
        mobile = ?, type = ?, user_type = ?, 
        open_time = ?, close_time = ?, updated_at = NOW()
    WHERE id = ?
    `,
    [
      data.stationName,
      data.stationType,
      data.latitude,
      data.longitude,
      data.contactNumber,
      data.usageType,
      data.addedByType,
      data.open_time,
      data.close_time,
      id,
    ]
  );
}

/**
 * Handle network deduplication and linking
 */
async function handleNetworkUpdate(connection, stationId, networkId, networkName) {
  if (!networkName) return;

  // CASE 1: Updating an existing network ID (Merge or Rename)
  if (networkId) {
    const [[baseNetwork]] = await connection.query(
      `SELECT id FROM network WHERE id = ? LIMIT 1`,
      [networkId]
    );

    if (baseNetwork) {
      // Check if another network with the same name already exists
      const [[existingTarget]] = await connection.query(
        `SELECT id, status FROM network WHERE name = ? AND id != ? LIMIT 1`,
        [networkName, baseNetwork.id]
      );

      if (existingTarget) {
        // MERGE: Move stations from base -> existing, then delete base
        await connection.query(
          `UPDATE charging_station SET network_id = ? WHERE network_id = ?`,
          [existingTarget.id, baseNetwork.id]
        );
        await connection.query(`DELETE FROM network WHERE id = ?`, [baseNetwork.id]);

        // Ensure current station is linked
        await connection.query(
          `UPDATE charging_station SET network_id = ? WHERE id = ?`,
          [existingTarget.id, stationId]
        );
      } else {
        // RENAME: Just update the name
        await connection.query(
          `UPDATE network SET name = ?, status = 1, updated_at = NOW() WHERE id = ?`,
          [networkName, baseNetwork.id]
        );

        // ALWAYS ENSURE LINKAGE: Even if just renaming or switching to this ID, ensure station points to it
        await connection.query(
          `UPDATE charging_station SET network_id = ? WHERE id = ?`,
          [baseNetwork.id, stationId]
        );
      }
      return; // Done
    }
  }

  // CASE 2: No network ID provided (New Custom Network via "Others")
  // Check if network name already exists
  const [[existingNetwork]] = await connection.query(
    `SELECT id FROM network WHERE name = ? LIMIT 1`,
    [networkName]
  );

  let finalNetworkId;

  if (existingNetwork) {
    finalNetworkId = existingNetwork.id;
  } else {
    // Create new inactive network
    const [result] = await connection.query(
      `INSERT INTO network (name, status, created_at, updated_at) VALUES (?, 0, NOW(), NOW())`,
      [networkName]
    );
    finalNetworkId = result.insertId;
  }

  // Link station to this network
  await connection.query(
    `UPDATE charging_station SET network_id = ? WHERE id = ?`,
    [finalNetworkId, stationId]
  );
}

/**
 * Update station connectors
 */
async function updateConnectors(connection, stationId, connectors) {
  // Get or create charging point
  const [[cp]] = await connection.query(
    `SELECT id FROM charging_point WHERE station_id = ? LIMIT 1`,
    [stationId]
  );

  let chargePointId = cp?.id;
  if (!chargePointId) {
    const [insert] = await connection.query(
      `INSERT INTO charging_point (station_id, status) VALUES (?, 1)`,
      [stationId]
    );
    chargePointId = insert.insertId;
  }

  // Delete existing connectors
  await connection.query(
    `DELETE FROM connector WHERE charge_point_id = ?`,
    [chargePointId]
  );

  // Insert new connectors
  for (const c of connectors) {
    await connection.query(
      `
      INSERT INTO connector (
        charge_point_id, charger_type_id, no_of_connectors,
        power, price_per_khw, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, 1, NOW())
      `,
      [
        chargePointId,
        c.chargerTypeId,
        c.count,
        c.powerRating ? parseFloat(c.powerRating) : null,
        c.tariff ? parseFloat(c.tariff) : null,
      ]
    );
  }
}

/**
 * Approve a station
 */
async function approveStation(connection, stationId) {
  await connection.query(
    `
    UPDATE charging_station
    SET approved_status = 'APPROVED', updated_at = NOW(), reason = NULL
    WHERE id = ?
    `,
    [stationId]
  );
}

/**
 * Reject a station
 */
async function rejectStation(connection, stationId, reason) {
  await connection.query(
    `
    UPDATE charging_station
    SET approved_status = 'REJECTED', updated_at = NOW(), reason = ?
    WHERE id = ?
    `,
    [reason || "No reason provided", stationId]
  );
}

/**
 * @swagger
 * /api/stations/{id}:
 *   put:
 *     summary: Update station details or status
 *     description: |
 *       Performs actions on a station submission:
 *       - **SAVE**: Updates station details, including network and connectors.
 *       - **APPROVE**: Sets status to APPROVED.
 *       - **REJECT**: Sets status to REJECTED (requires reason).
 *     tags:
 *       - Stations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Station ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [SAVE, APPROVE, REJECT]
 *                 description: Action to perform
 *               stationName:
 *                 type: string
 *                 description: Required for SAVE
 *               stationType:
 *                 type: string
 *               addedByType:
 *                 type: string
 *                 enum: [EV Owner, Station Owner, CPO]
 *               usageType:
 *                 type: string
 *                 enum: [Public, Private]
 *               latitude:
 *                 type: number
 *                 description: Required for SAVE
 *               longitude:
 *                 type: number
 *                 description: Required for SAVE
 *               contactNumber:
 *                 type: string
 *               open_time:
 *                 type: string
 *                 format: time
 *                 example: "09:00:00"
 *               close_time:
 *                 type: string
 *                 format: time
 *                 example: "21:00:00"
 *               networkId:
 *                 type: integer
 *                 nullable: true
 *                 description: ID of existing network
 *               networkName:
 *                 type: string
 *                 description: Name of network (existing or new)
 *               reason:
 *                 type: string
 *                 description: Rejection reason (Required for REJECT)
 *               connectors:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     chargerTypeId:
 *                       type: integer
 *                     count:
 *                       type: integer
 *                     powerRating:
 *                       type: string
 *                       example: "60"
 *                     tariff:
 *                       type: string
 *                       example: "15.50"
 *     responses:
 *       200:
 *         description: Action successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Station updated successfully"
 *       400:
 *         description: Invalid action or missing required fields
 *       500:
 *         description: Internal server error
 */
router.put("/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;
    const { action } = req.body;

    // Validate action
    if (!action) {
      return res.status(400).json({ message: "action is required" });
    }

    if (!["SAVE", "APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({
        message: "Invalid action. Must be SAVE, APPROVE, or REJECT"
      });
    }

    await connection.beginTransaction();

    // Handle different actions
    if (action === "SAVE") {
      const {
        stationName,
        stationType,
        addedByType,
        usageType,
        latitude,
        longitude,
        contactNumber,
        open_time,
        close_time,
        connectors = [],
        networkId,
        networkName,
      } = req.body;

      // Validate required fields for SAVE
      if (!stationName || !latitude || !longitude) {
        return res.status(400).json({
          message: "stationName, latitude, and longitude are required for SAVE action"
        });
      }

      // Update station basic info
      await updateStationBasicInfo(connection, id, {
        stationName,
        stationType,
        addedByType,
        usageType,
        latitude,
        longitude,
        contactNumber,
        open_time,
        close_time,
      });

      // Handle network update
      await handleNetworkUpdate(connection, id, networkId, networkName);

      // Update connectors
      await updateConnectors(connection, id, connectors);

    } else if (action === "APPROVE") {
      await approveStation(connection, id);

    } else if (action === "REJECT") {
      const { reason } = req.body;
      await rejectStation(connection, id, reason);
    }

    await connection.commit();

    const actionMessages = {
      SAVE: "Station updated successfully",
      APPROVE: "Station approved successfully",
      REJECT: "Station rejected successfully"
    };

    res.json({ message: actionMessages[action] });

  } catch (err) {
    await connection.rollback();
    console.error(`PUT /stations/:id ERROR (${req.body.action}):`, err);
    res.status(500).json({ message: err.message });
  } finally {
    connection.release();
  }
});

export default router;
