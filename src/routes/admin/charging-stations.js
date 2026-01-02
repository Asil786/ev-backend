import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";
import multer from "multer";
import xlsx from "xlsx";

const router = express.Router();

// Configure multer for file uploads - use memory storage for serverless compatibility
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build WHERE clause and parameters for filtering charging stations
 */
function buildWhereClause(filters) {
    const {
        status,
        usageType,
        networkId,
        addedBy,
        chargerType,
        stationType,
        startDate,
        endDate,
        search
    } = filters;
    const where = [];
    const params = [];

    // Only show approved stations
    where.push("cs.approved_status = 'APPROVED'");

    // Status filter (operational status)
    if (status && status !== "All") {
        if (status === "Active") {
            where.push("cs.status = 1");
        } else if (status === "Inactive") {
            where.push("cs.status = 0");
        }
    }

    // Usage type filter
    if (usageType && usageType !== "All") {
        where.push("cs.type = ?");
        params.push(usageType.toUpperCase());
    }

    // Network filter
    if (networkId && networkId !== "All") {
        where.push("cs.network_id = ?");
        params.push(networkId);
    }

    // Added By filter (EVJoints / Users)
    if (addedBy && addedBy !== "All") {
        if (addedBy === "EVJoints") {
            where.push("cs.user_type = 'CPO'");
        } else if (addedBy === "Users") {
            where.push("cs.user_type IN ('EV Owner', 'Station Owner')");
        }
    }

    // Charger Type filter (AC / DC / All)
    if (chargerType && chargerType !== "All") {
        where.push(`EXISTS (
            SELECT 1 FROM charging_point cp
            JOIN connector c ON c.charge_point_id = cp.id
            JOIN charger_types ct ON ct.id = c.charger_type_id
            WHERE cp.station_id = cs.id AND ct.type = ?
        )`);
        params.push(chargerType.toUpperCase());
    }

    // Station Type filter
    if (stationType && stationType !== "All") {
        where.push("cs.landmark = ?");
        params.push(stationType);
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

    // Universal search filter (searches across all fields)
    if (search) {
        where.push(`(
      cs.name LIKE ? OR
      cs.landmark LIKE ? OR
      cs.mobile LIKE ? OR
      n.name LIKE ? OR
      CONCAT(cu.first_name, ' ', cu.last_name) LIKE ? OR
      cs.type LIKE ? OR
      CONCAT('CS-', cs.id) LIKE ? OR
      CONCAT(cs.latitude) LIKE ? OR
      CONCAT(cs.longitude) LIKE ?
    )`);
        const searchPattern = `%${search}%`;
        params.push(
            searchPattern, searchPattern, searchPattern, searchPattern,
            searchPattern, searchPattern, searchPattern, searchPattern, searchPattern
        );
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { whereSQL, params };
}

/**
 * Get total count of charging stations matching filters
 */
async function getTotalStations(whereSQL, params) {
    const [[{ total }]] = await db.query(
        `SELECT COUNT(*) AS total 
     FROM charging_station cs 
     LEFT JOIN network n ON n.id = cs.network_id
     ${whereSQL}`,
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
    LEFT JOIN network n ON n.id = cs.network_id
    ${whereSQL}
    ORDER BY cs.created_at DESC
    LIMIT ? OFFSET ?
    `,
        [...params, limit, offset]
    );
    return stationIdRows.map((r) => r.id);
}

/**
 * Fetch full charging station details with all related data
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
      cs.created_at AS submissionTime,
      cs.open_time,
      cs.close_time,
      cs.type AS usageType,
      cs.landmark AS stationType,
      cs.status AS operationalStatus,
      cs.created_by AS userId,

      n.id AS networkId,
      n.name AS networkName,

      CONCAT(cu.first_name, ' ', cu.last_name) AS addedBy,

      c.id AS connectorId,
      ct.id AS chargerTypeId,
      ct.name AS connectorName,
      ct.type AS connectorType,
      c.power AS powerRating,
      c.no_of_connectors AS connectorCount,
      c.price_per_khw AS tariff,
      c.status AS connectorStatus,

      a.path AS photoPath

    FROM charging_station cs
    LEFT JOIN network n ON n.id = cs.network_id
    LEFT JOIN customer cu ON cu.id = cs.created_by
    LEFT JOIN charging_point cp ON cp.station_id = cs.id
    LEFT JOIN connector c ON c.charge_point_id = cp.id
    LEFT JOIN charger_types ct ON ct.id = c.charger_type_id
    LEFT JOIN attachment a ON a.station_id = cs.id
    WHERE cs.id IN (?)
    ORDER BY cs.created_at DESC
    `,
        [stationIds]
    );
    return rows;
}

/**
 * Map database row to charging station object
 */
function mapStationRow(row) {
    return {
        id: row.id,
        stationName: row.stationName,
        networkName: row.networkName || "-",
        stationContact: row.contactNumber || "-",
        latitude: row.latitude,
        longitude: row.longitude,
        stationType: row.stationType || "-",
        usageType: row.usageType === "PUBLIC" ? "Public" : "Private",
        operationalHours:
            row.open_time && row.close_time
                ? `${row.open_time} - ${row.close_time}`
                : "-",
        submissionTime: row.submissionTime,
        addedBy: row.addedBy || "-",
        operationalStatus: row.operationalStatus === 1 ? "Active" : "Inactive",
        media: [],
        connectors: [],
    };
}

/**
 * Group rows by station and aggregate media/connectors
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
        if (row.photoPath && !station.media.includes(row.photoPath)) {
            station.media.push(row.photoPath);
        }

        // Add connector if exists and not duplicate
        if (row.connectorId && !station.connectors.find((c) => c.id === row.connectorId)) {
            station.connectors.push({
                id: row.connectorId,
                connectorType: row.connectorType || "-",
                connector: row.connectorName || "-",
                powerRating: row.powerRating ? `${row.powerRating} kW` : "-",
                tariff: row.tariff ? `₹${row.tariff}/kWh` : "-",
                operationalStatus: row.connectorStatus === 1 ? "Active" : "Inactive",
                count: row.connectorCount || 0,
            });
        }
    }

    return Array.from(stationMap.values());
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * @swagger
 * /api/charging-stations:
 *   get:
 *     summary: Get paginated list of charging stations
 *     description: |
 *       Retrieves a paginated list of approved charging stations with comprehensive filtering options.
 *       Supports filtering by operational status, usage type, network, and search terms.
 *       Returns detailed information including station details, network info, connectors, and media.
 *     tags:
 *       - Charging Stations
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
 *           enum: [All, Active, Inactive]
 *           default: All
 *         description: Filter by operational status
 *       - in: query
 *         name: usageType
 *         schema:
 *           type: string
 *           enum: [All, Public, Private]
 *           default: All
 *         description: Filter by usage type
 *       - in: query
 *         name: networkId
 *         schema:
 *           type: string
 *         description: Filter by network ID (use "All" for no filter)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by station name, landmark, contact number, network name, or station ID
 *         example: "Mumbai Central"
 *     responses:
 *       200:
 *         description: Successful response with charging station data
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
 *                       networkName:
 *                         type: string
 *                         example: "Tata Power"
 *                       stationContact:
 *                         type: string
 *                         example: "9876543210"
 *                       latitude:
 *                         type: number
 *                         format: double
 *                         example: 19.0760
 *                       longitude:
 *                         type: number
 *                         format: double
 *                         example: 72.8777
 *                       stationType:
 *                         type: string
 *                         example: "Shopping Mall"
 *                       usageType:
 *                         type: string
 *                         enum: [Public, Private]
 *                         example: "Public"
 *                       operationalHours:
 *                         type: string
 *                         example: "09:00:00 - 21:00:00"
 *                       submissionTime:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-15T10:30:00.000Z"
 *                       addedBy:
 *                         type: string
 *                         example: "John Doe"
 *                       operationalStatus:
 *                         type: string
 *                         enum: [Active, Inactive]
 *                         example: "Active"
 *                       media:
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
 *                             connectorType:
 *                               type: string
 *                               example: "CCS2"
 *                             connector:
 *                               type: string
 *                               example: "CCS Type 2"
 *                             powerRating:
 *                               type: string
 *                               example: "60 kW"
 *                             tariff:
 *                               type: string
 *                               example: "₹12/kWh"
 *                             operationalStatus:
 *                               type: string
 *                               enum: [Active, Inactive]
 *                               example: "Active"
 *                             count:
 *                               type: integer
 *                               example: 2
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
        const {
            status,
            usageType,
            networkId,
            addedBy,
            chargerType,
            stationType,
            startDate,
            endDate,
            search
        } = req.query;

        // 2. Build WHERE clause
        const { whereSQL, params } = buildWhereClause({
            status,
            usageType,
            networkId,
            addedBy,
            chargerType,
            stationType,
            startDate,
            endDate,
            search
        });

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
        console.error("GET /charging-stations ERROR:", err);
        res.status(500).json({ message: err.message });
    }
});

/**
 * @swagger
 * /api/charging-stations/download:
 *   get:
 *     summary: Download charging stations as CSV with connector-level rows
 *     description: Downloads all approved charging stations matching the current filters as a CSV file. Each connector gets its own row. Respects all active filters.
 *     tags:
 *       - Charging Stations
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [All, Active, Inactive]
 *         description: Filter by operational status
 *       - in: query
 *         name: usageType
 *         schema:
 *           type: string
 *           enum: [All, Public, Private]
 *         description: Filter by usage type
 *       - in: query
 *         name: networkId
 *         schema:
 *           type: string
 *         description: Filter by network ID
 *       - in: query
 *         name: addedBy
 *         schema:
 *           type: string
 *           enum: [All, EVJoints, Users]
 *         description: Filter by who added the station
 *       - in: query
 *         name: chargerType
 *         schema:
 *           type: string
 *           enum: [All, AC, DC]
 *         description: Filter by charger type
 *       - in: query
 *         name: stationType
 *         schema:
 *           type: string
 *         description: Filter by station type
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter stations created on or after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter stations created on or before this date
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
        const {
            status,
            usageType,
            networkId,
            addedBy,
            chargerType,
            stationType,
            startDate,
            endDate,
            search
        } = req.query;

        // Build WHERE clause
        const { whereSQL, params } = buildWhereClause({
            status,
            usageType,
            networkId,
            addedBy,
            chargerType,
            stationType,
            startDate,
            endDate,
            search
        });

        // Get ALL station IDs (no pagination)
        const [stationIdRows] = await db.query(
            `
            SELECT cs.id
            FROM charging_station cs
            LEFT JOIN network n ON n.id = cs.network_id
            ${whereSQL}
            ORDER BY cs.created_at DESC
            `,
            params
        );

        const stationIds = stationIdRows.map((r) => r.id);

        if (!stationIds.length) {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="charging_stations.csv"');
            return res.send('No data found');
        }

        // Fetch full station details
        const rows = await fetchStationDetails(stationIds);

        // CSV Headers
        const csvHeaders = [
            'Station ID',
            'Submission Date',
            'Submission Time',
            'Added By',
            'Station Name',
            'Network Name',
            'Station Contact',
            'Latitude',
            'Longitude',
            'Station Type',
            'Usage Type',
            'Operational Hours',
            'Operational Status',
            'Connector Type',
            'Connector Name',
            'Connector Count',
            'Power Rating',
            'Tariff',
            'Connector Status',
            'Photo Count'
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
            if (row.photoPath && !station.media.includes(row.photoPath)) {
                station.media.push(row.photoPath);
                station.photoCount++;
            }

            // Track connectors with full details
            if (row.connectorId && !station.rawConnectors.find(c => c.id === row.connectorId)) {
                station.rawConnectors.push({
                    id: row.connectorId,
                    type: row.connectorType || '-',
                    name: row.connectorName || '-',
                    count: row.connectorCount || 0,
                    powerRating: row.powerRating ? `${row.powerRating} kW` : '-',
                    tariff: row.tariff ? `₹${row.tariff}/kWh` : '-',
                    status: row.connectorStatus === 1 ? 'Active' : 'Inactive'
                });
            }
        }

        // Generate CSV rows - one per connector
        for (const station of stationMap.values()) {
            const submissionDate = new Date(station.submissionTime);

            const baseRow = [
                station.id,
                submissionDate.toLocaleDateString('en-GB'),
                submissionDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                station.addedBy,
                station.stationName,
                station.networkName,
                station.stationContact,
                station.latitude,
                station.longitude,
                station.stationType,
                station.usageType,
                station.operationalHours,
                station.operationalStatus
            ];

            const endRow = [
                station.photoCount
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
                        connector.status,
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
                    '-', // connector status
                    ...endRow
                ]);
            }
        }

        // Build CSV content
        const csvContent = [
            csvHeaders.join(','),
            ...csvRows.map(row => row.map(cell => {
                const cellStr = String(cell);
                if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                    return `"${cellStr.replace(/"/g, '""')}"`;
                }
                return cellStr;
            }).join(','))
        ].join('\n');

        // Send CSV file
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="charging_stations.csv"');
        res.send('\uFEFF' + csvContent);

    } catch (err) {
        console.error("GET /charging-stations/download ERROR:", err);
        res.status(500).json({ message: err.message });
    }
});

// ============================================================================
// POST ENDPOINT - Add New Station
// ============================================================================

/**
 * Validate station data
 */
function validateStationData(data) {
    const errors = [];

    // Required fields
    if (!data.stationName || data.stationName.trim() === "") {
        errors.push("Station name is required");
    }
    if (!data.latitude || isNaN(data.latitude)) {
        errors.push("Valid latitude is required");
    }
    if (!data.longitude || isNaN(data.longitude)) {
        errors.push("Valid longitude is required");
    }
    if (!data.usageType || !["PUBLIC", "PRIVATE"].includes(data.usageType.toUpperCase())) {
        errors.push("Usage type must be PUBLIC or PRIVATE");
    }
    if (!data.contactNumber || data.contactNumber.trim() === "") {
        errors.push("Contact number is required");
    }

    // Validate operational hours if provided
    if (data.open_time && data.close_time) {
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
        if (!timeRegex.test(data.open_time)) {
            errors.push("Invalid open_time format. Use HH:MM:SS");
        }
        if (!timeRegex.test(data.close_time)) {
            errors.push("Invalid close_time format. Use HH:MM:SS");
        }
    }

    return errors;
}

/**
 * Validate connector data
 */
function validateConnectorData(connector, index) {
    const errors = [];

    if (!connector.chargerTypeId) {
        errors.push(`Connector ${index + 1}: chargerTypeId is required`);
    }
    if (!connector.count || connector.count < 1) {
        errors.push(`Connector ${index + 1}: count must be at least 1`);
    }
    if (connector.powerRating && isNaN(parseFloat(connector.powerRating))) {
        errors.push(`Connector ${index + 1}: Invalid power rating`);
    }
    if (connector.tariff && isNaN(parseFloat(connector.tariff))) {
        errors.push(`Connector ${index + 1}: Invalid tariff`);
    }

    return errors;
}

/**
 * @swagger
 * /api/charging-stations:
 *   post:
 *     summary: Add a new charging station
 *     description: Creates a new charging station with connectors and photos
 *     tags:
 *       - Charging Stations
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stationName
 *               - latitude
 *               - longitude
 *               - usageType
 *               - contactNumber
 *             properties:
 *               stationName:
 *                 type: string
 *                 example: "Mumbai Central Charging Hub"
 *               stationType:
 *                 type: string
 *                 example: "Shopping Mall"
 *               usageType:
 *                 type: string
 *                 enum: [PUBLIC, PRIVATE]
 *                 example: "PUBLIC"
 *               latitude:
 *                 type: number
 *                 format: double
 *                 example: 19.0760
 *               longitude:
 *                 type: number
 *                 format: double
 *                 example: 72.8777
 *               contactNumber:
 *                 type: string
 *                 example: "9876543210"
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
 *                 example: 5
 *               connectors:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - chargerTypeId
 *                     - count
 *                   properties:
 *                     chargerTypeId:
 *                       type: integer
 *                       example: 2
 *                     count:
 *                       type: integer
 *                       minimum: 1
 *                       example: 2
 *                     powerRating:
 *                       type: string
 *                       example: "60"
 *                     tariff:
 *                       type: string
 *                       example: "15.50"
 *                     operationalStatus:
 *                       type: string
 *                       enum: [Active, Inactive]
 *                       default: "Active"
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["/uploads/station_1.jpg", "/uploads/station_2.jpg"]
 *     responses:
 *       201:
 *         description: Station created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 stationId:
 *                   type: integer
 *             example:
 *               message: "Charging station created successfully"
 *               stationId: 123
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error
 */
router.post("/", async (req, res) => {
    const connection = await db.getConnection();

    try {
        const {
            stationName,
            stationType,
            usageType,
            latitude,
            longitude,
            contactNumber,
            open_time,
            close_time,
            networkId,
            connectors = [],
            photos = []
        } = req.body;

        // Validate station data
        const stationErrors = validateStationData(req.body);
        if (stationErrors.length > 0) {
            return res.status(400).json({
                message: "Validation failed",
                errors: stationErrors
            });
        }

        // Validate connectors
        const connectorErrors = [];
        connectors.forEach((connector, index) => {
            const errors = validateConnectorData(connector, index);
            connectorErrors.push(...errors);
        });

        if (connectorErrors.length > 0) {
            return res.status(400).json({
                message: "Connector validation failed",
                errors: connectorErrors
            });
        }

        await connection.beginTransaction();

        // Insert charging station
        const [stationResult] = await connection.query(
            `
            INSERT INTO charging_station (
                name, landmark, latitude, longitude, mobile, type,
                open_time, close_time, network_id, address, approved_status, status,
                user_type, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 'CPO', NOW(), NOW())
            `,
            [
                stationName,
                stationType || null,
                latitude,
                longitude,
                contactNumber,
                usageType.toUpperCase(),
                open_time || null,
                close_time || null,
                networkId || null,
                req.body.address || '' // Add address field with empty string as default
            ]
        );

        const stationId = stationResult.insertId;

        // Insert connectors if provided
        if (connectors.length > 0) {
            await updateConnectors(connection, stationId, connectors);
        }

        // Insert photos if provided
        if (photos.length > 0) {
            for (const photoPath of photos) {
                await connection.query(
                    `INSERT INTO attachment (station_id, path, created_at) VALUES (?, ?, NOW())`,
                    [stationId, photoPath]
                );
            }
        }

        await connection.commit();

        res.status(201).json({
            message: "Charging station created successfully",
            stationId
        });

    } catch (err) {
        await connection.rollback();
        console.error("POST /charging-stations ERROR:", err);
        res.status(500).json({ message: err.message });
    } finally {
        connection.release();
    }
});

// ============================================================================
// PUT ENDPOINT HELPER FUNCTIONS
// ============================================================================

/**
 * Update charging station basic information
 */
async function updateStationBasicInfo(connection, id, data) {
    await connection.query(
        `
    UPDATE charging_station
    SET name = ?, landmark = ?, latitude = ?, longitude = ?, 
        mobile = ?, type = ?, open_time = ?, close_time = ?, 
        updated_at = NOW()
    WHERE id = ?
    `,
        [
            data.stationName,
            data.stationType,
            data.latitude,
            data.longitude,
            data.contactNumber,
            data.usageType,
            data.open_time,
            data.close_time,
            id,
        ]
    );
}

/**
 * Handle network update for charging station
 */
async function handleNetworkUpdate(connection, stationId, networkId) {
    if (!networkId) return;

    await connection.query(
        `UPDATE charging_station SET network_id = ?, updated_at = NOW() WHERE id = ?`,
        [networkId, stationId]
    );
}

/**
 * Update connectors for a charging station
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

    // Insert new connectors (only if they have valid data)
    for (const c of connectors) {
        // Skip if no chargerTypeId (required field)
        if (!c.chargerTypeId) {
            console.warn(`Skipping connector without chargerTypeId for station ${stationId}`);
            continue;
        }

        // Validate that charger type exists
        const [[chargerType]] = await connection.query(
            `SELECT id FROM charger_types WHERE id = ? LIMIT 1`,
            [c.chargerTypeId]
        );

        if (!chargerType) {
            console.warn(`Invalid chargerTypeId ${c.chargerTypeId} for station ${stationId}, skipping connector`);
            continue;
        }

        await connection.query(
            `
      INSERT INTO connector (
        charge_point_id, charger_type_id, no_of_connectors,
        power, price_per_khw, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      `,
            [
                chargePointId,
                c.chargerTypeId,
                c.count || 0,
                c.powerRating ? parseFloat(c.powerRating) : null,
                c.tariff ? parseFloat(c.tariff) : null,
                c.operationalStatus === "Active" ? 1 : 0,
            ]
        );
    }
}

/**
 * Enable a charging station (set status to active)
 */
async function enableStation(connection, stationId) {
    await connection.query(
        `UPDATE charging_station SET status = 1, updated_at = NOW() WHERE id = ?`,
        [stationId]
    );
}

/**
 * Disable a charging station (set status to inactive)
 */
async function disableStation(connection, stationId) {
    await connection.query(
        `UPDATE charging_station SET status = 0, updated_at = NOW() WHERE id = ?`,
        [stationId]
    );
}

/**
 * Delete a charging station (soft delete by setting approved_status to DELETED)
 */
async function deleteStation(connection, stationId) {
    // Soft delete - set approved_status to a deleted state
    await connection.query(
        `UPDATE charging_station SET approved_status = 'DELETED', status = 0, updated_at = NOW() WHERE id = ?`,
        [stationId]
    );
}

// ============================================================================
// PUT ROUTE
// ============================================================================

/**
 * @swagger
 * /api/charging-stations/{id}:
 *   put:
 *     summary: Update charging station or perform actions
 *     description: |
 *       Performs actions on a charging station:
 *       - **EDIT**: Updates station details, network, and connectors.
 *       - **ENABLE**: Sets station operational status to Active.
 *       - **DISABLE**: Sets station operational status to Inactive.
 *       - **DELETE**: Soft deletes the station (sets approved_status to DELETED).
 *     tags:
 *       - Charging Stations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Charging Station ID
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
 *                 enum: [EDIT, ENABLE, DISABLE, DELETE]
 *                 description: Action to perform on the charging station
 *               stationName:
 *                 type: string
 *                 description: Required for EDIT action
 *                 example: "Mumbai Central Charging Hub"
 *               stationType:
 *                 type: string
 *                 description: Station landmark/type
 *                 example: "Shopping Mall"
 *               usageType:
 *                 type: string
 *                 enum: [PUBLIC, PRIVATE]
 *                 description: Required for EDIT action
 *                 example: "PUBLIC"
 *               latitude:
 *                 type: number
 *                 format: double
 *                 description: Required for EDIT action
 *                 example: 19.0760
 *               longitude:
 *                 type: number
 *                 format: double
 *                 description: Required for EDIT action
 *                 example: 72.8777
 *               contactNumber:
 *                 type: string
 *                 example: "9876543210"
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
 *                 description: ID of the network
 *                 example: 5
 *               connectors:
 *                 type: array
 *                 description: Array of connector configurations (for EDIT action)
 *                 items:
 *                   type: object
 *                   properties:
 *                     chargerTypeId:
 *                       type: integer
 *                       example: 2
 *                     count:
 *                       type: integer
 *                       example: 2
 *                     powerRating:
 *                       type: string
 *                       example: "60"
 *                     tariff:
 *                       type: string
 *                       example: "15.50"
 *                     operationalStatus:
 *                       type: string
 *                       enum: [Active, Inactive]
 *                       example: "Active"
 *           examples:
 *             edit:
 *               summary: Edit station details
 *               value:
 *                 action: "EDIT"
 *                 stationName: "Mumbai Central Charging Hub"
 *                 stationType: "Shopping Mall"
 *                 usageType: "PUBLIC"
 *                 latitude: 19.0760
 *                 longitude: 72.8777
 *                 contactNumber: "9876543210"
 *                 open_time: "09:00:00"
 *                 close_time: "21:00:00"
 *                 networkId: 5
 *                 connectors:
 *                   - chargerTypeId: 2
 *                     count: 2
 *                     powerRating: "60"
 *                     tariff: "15.50"
 *                     operationalStatus: "Active"
 *             enable:
 *               summary: Enable station
 *               value:
 *                 action: "ENABLE"
 *             disable:
 *               summary: Disable station
 *               value:
 *                 action: "DISABLE"
 *             delete:
 *               summary: Delete station
 *               value:
 *                 action: "DELETE"
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
 *             examples:
 *               edit:
 *                 summary: Edit success
 *                 value:
 *                   message: "Charging station updated successfully"
 *               enable:
 *                 summary: Enable success
 *                 value:
 *                   message: "Charging station enabled successfully"
 *               disable:
 *                 summary: Disable success
 *                 value:
 *                   message: "Charging station disabled successfully"
 *               delete:
 *                 summary: Delete success
 *                 value:
 *                   message: "Charging station deleted successfully"
 *       400:
 *         description: Invalid action or missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *             examples:
 *               missingAction:
 *                 summary: Missing action
 *                 value:
 *                   message: "action is required"
 *               invalidAction:
 *                 summary: Invalid action
 *                 value:
 *                   message: "Invalid action. Must be EDIT, ENABLE, DISABLE, or DELETE"
 *               missingFields:
 *                 summary: Missing required fields for EDIT
 *                 value:
 *                   message: "stationName, latitude, longitude, and usageType are required for EDIT action"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *               example:
 *                 message: "Database connection failed"
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

        if (!["EDIT", "ENABLE", "DISABLE", "DELETE"].includes(action)) {
            return res.status(400).json({
                message: "Invalid action. Must be EDIT, ENABLE, DISABLE, or DELETE"
            });
        }

        await connection.beginTransaction();

        // Handle different actions
        if (action === "EDIT") {
            const {
                stationName,
                stationType,
                usageType,
                latitude,
                longitude,
                contactNumber,
                open_time,
                close_time,
                connectors = [],
                networkId,
            } = req.body;

            // Validate required fields for EDIT
            if (!stationName || !latitude || !longitude || !usageType) {
                return res.status(400).json({
                    message: "stationName, latitude, longitude, and usageType are required for EDIT action"
                });
            }

            // Update station basic info
            await updateStationBasicInfo(connection, id, {
                stationName,
                stationType,
                usageType,
                latitude,
                longitude,
                contactNumber,
                open_time,
                close_time,
            });

            // Handle network update
            await handleNetworkUpdate(connection, id, networkId);

            // Update connectors
            await updateConnectors(connection, id, connectors);

        } else if (action === "ENABLE") {
            await enableStation(connection, id);

        } else if (action === "DISABLE") {
            await disableStation(connection, id);

        } else if (action === "DELETE") {
            await deleteStation(connection, id);
        }

        await connection.commit();

        const actionMessages = {
            EDIT: "Charging station updated successfully",
            ENABLE: "Charging station enabled successfully",
            DISABLE: "Charging station disabled successfully",
            DELETE: "Charging station deleted successfully"
        };

        res.json({ message: actionMessages[action] });

    } catch (err) {
        await connection.rollback();
        console.error(`PUT /charging-stations/:id ERROR (${req.body.action}):`, err);
        res.status(500).json({ message: err.message });
    } finally {
        connection.release();
    }
});

// ============================================================================
// MASS UPLOAD ENDPOINT
// ============================================================================

/**
 * @swagger
 * /api/charging-stations/mass-upload:
 *   post:
 *     summary: Mass upload charging stations via CSV/Excel
 *     description: Upload multiple charging stations using a CSV or Excel file
 *     tags:
 *       - Charging Stations
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV or Excel file containing station data
 *     responses:
 *       200:
 *         description: Upload completed with summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     successful:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *                 successfulRows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 failedRows:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       row:
 *                         type: integer
 *                       data:
 *                         type: object
 *                       errors:
 *                         type: array
 *                         items:
 *                           type: string
 *       400:
 *         description: No file uploaded or invalid file
 *       500:
 *         description: Internal server error
 */
router.post("/mass-upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        // Read the uploaded file
        // Read the uploaded file from buffer
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            return res.status(400).json({ message: "File is empty" });
        }

        const successfulRows = [];
        const failedRows = [];

        // Process each row
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const rowNumber = i + 2; // Excel rows start at 1, header is row 1

            try {
                // Map Excel columns to our data structure
                const stationData = {
                    stationName: row['Station Name'] || row['stationName'],
                    stationType: row['Station Type'] || row['stationType'],
                    usageType: row['Usage Type'] || row['usageType'],
                    latitude: parseFloat(row['Latitude'] || row['latitude']),
                    longitude: parseFloat(row['Longitude'] || row['longitude']),
                    contactNumber: String(row['Contact Number'] || row['contactNumber'] || ''),
                    open_time: row['Open Time'] || row['open_time'],
                    close_time: row['Close Time'] || row['close_time'],
                    networkId: row['Network ID'] || row['networkId'] || null,
                };

                // Parse connectors (expecting JSON string or comma-separated)
                let connectors = [];
                if (row['Connectors'] || row['connectors']) {
                    try {
                        const connectorData = row['Connectors'] || row['connectors'];
                        connectors = typeof connectorData === 'string'
                            ? JSON.parse(connectorData)
                            : connectorData;
                    } catch (e) {
                        // If JSON parse fails, skip connectors
                        console.warn(`Row ${rowNumber}: Invalid connector data`);
                    }
                }

                // Validate station data
                const stationErrors = validateStationData(stationData);

                // Validate connectors
                const connectorErrors = [];
                if (Array.isArray(connectors)) {
                    connectors.forEach((connector, index) => {
                        const errors = validateConnectorData(connector, index);
                        connectorErrors.push(...errors);
                    });
                }

                const allErrors = [...stationErrors, ...connectorErrors];

                if (allErrors.length > 0) {
                    failedRows.push({
                        row: rowNumber,
                        data: row,
                        errors: allErrors
                    });
                    continue;
                }

                // Insert station
                const connection = await db.getConnection();
                try {
                    await connection.beginTransaction();

                    const [stationResult] = await connection.query(
                        `
                        INSERT INTO charging_station (
                            name, landmark, latitude, longitude, mobile, type,
                            open_time, close_time, network_id, address, approved_status, status,
                            user_type, created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 'CPO', NOW(), NOW())
                        `,
                        [
                            stationData.stationName,
                            stationData.stationType || null,
                            stationData.latitude,
                            stationData.longitude,
                            stationData.contactNumber,
                            stationData.usageType.toUpperCase(),
                            stationData.open_time || null,
                            stationData.close_time || null,
                            stationData.networkId,
                            row['Address'] || row['address'] || '' // Add address field
                        ]
                    );

                    const stationId = stationResult.insertId;

                    // Insert connectors if provided
                    if (Array.isArray(connectors) && connectors.length > 0) {
                        await updateConnectors(connection, stationId, connectors);
                    }

                    await connection.commit();

                    successfulRows.push({
                        row: rowNumber,
                        stationId,
                        stationName: stationData.stationName
                    });

                } catch (dbError) {
                    await connection.rollback();
                    failedRows.push({
                        row: rowNumber,
                        data: row,
                        errors: [dbError.message]
                    });
                } finally {
                    connection.release();
                }

            } catch (error) {
                failedRows.push({
                    row: rowNumber,
                    data: row,
                    errors: [error.message]
                });
            }
        }

        // Send summary response
        res.json({
            message: "Mass upload completed",
            summary: {
                total: data.length,
                successful: successfulRows.length,
                failed: failedRows.length
            },
            successfulRows,
            failedRows
        });

    } catch (err) {
        console.error("POST /charging-stations/mass-upload ERROR:", err);
        res.status(500).json({ message: err.message });
    }
});

export default router;
