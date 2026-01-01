import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

// ============================================================================
// CONSTANTS
// ============================================================================

const ALLOWED_SORT_COLUMNS = {
  id: "c.id",
  firstName: "c.first_name",
  lastName: "c.last_name",
  email: "c.email",
  phone: "c.mobile",
  customerRegDate: "c.created_at",
  vehicleRegDate: "mv.created_at",
  registrationNumber: "mv.vehicle_registration_no",
  vehicleType: "vt.name",
  manufacturer: "mf.name",
  vehicleModel: "vmm.name",
  subscription: "subscription_order"
};

const TRIP_STATUS_ACTIVE = ['COMPLETED', 'ON_GOING', 'ON_GOING_TEST'];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates and returns safe sort parameters
 */
function getSortParams(query) {
  const sortBy = query.sortBy || "id";
  const order = (query.order || "desc").toLowerCase();

  const sortColumn = ALLOWED_SORT_COLUMNS[sortBy] || "c.id";
  const orderDirection = order === "asc" ? "ASC" : "DESC";

  return { sortColumn, orderDirection };
}



/**
 * Fetches total customer count with optional date filtering
 */
async function getTotalCustomers(startDate = null, endDate = null) {
  let whereClause = '';
  const queryParams = [];

  if (startDate && endDate) {
    whereClause = `
      WHERE id IN (
        SELECT MAX(id)
        FROM customer
        WHERE created_at BETWEEN ? AND ?
        GROUP BY mobile
      )
    `;
    queryParams.push(startDate, endDate);
  } else if (startDate) {
    whereClause = `
      WHERE id IN (
        SELECT MAX(id)
        FROM customer
        WHERE created_at >= ?
        GROUP BY mobile
      )
    `;
    queryParams.push(startDate);
  } else if (endDate) {
    whereClause = `
      WHERE id IN (
        SELECT MAX(id)
        FROM customer
        WHERE created_at <= ?
        GROUP BY mobile
      )
    `;
    queryParams.push(endDate);
  } else {
    whereClause = `
      WHERE id IN (
        SELECT MAX(id)
        FROM customer
        GROUP BY mobile
      )
    `;
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM customer ${whereClause}`,
    queryParams
  );
  return total;
}

/**
 * Fetches customers with their latest vehicle and activity flags
 */
async function fetchCustomers(limit, offset, sortColumn, orderDirection, startDate = null, endDate = null) {
  // Build WHERE clause for date filtering
  let dateWhereClause = '';
  const queryParams = [TRIP_STATUS_ACTIVE, TRIP_STATUS_ACTIVE];

  if (startDate && endDate) {
    dateWhereClause = 'WHERE c.created_at BETWEEN ? AND ?';
    queryParams.push(startDate, endDate);
  } else if (startDate) {
    dateWhereClause = 'WHERE c.created_at >= ?';
    queryParams.push(startDate);
  } else if (endDate) {
    dateWhereClause = 'WHERE c.created_at <= ?';
    queryParams.push(endDate);
  }

  queryParams.push(limit, offset);

  const [rows] = await db.query(
    `
    SELECT
      c.id,
      c.first_name,
      c.last_name,
      c.email,
      c.mobile,
      c.created_at AS customer_reg_date,

      mv.created_at AS vehicle_reg_date,
      mv.vehicle_registration_no,

      vt.name AS vehicle_type,
      mf.name AS manufacturer,
      vmm.name AS vehicle_model,
      vvm.name AS vehicle_variant,

      d.brand AS device_brand,
      d.model AS device_model,
      d.type AS device_platform,
      d.version_number AS app_version,

      -- Subscription from database
      sm.name AS subscription_name,
      sm.id AS subscription_id,

      -- Activity flags
      EXISTS (
        SELECT 1 FROM trip t
        WHERE t.customer_id = c.id
          AND t.trip_status IN (?)
      ) AS has_navigation,

      EXISTS (
        SELECT 1 FROM trip t
        WHERE t.customer_id = c.id
          AND t.trip_status != 'ENQUIRED'
      ) AS has_trip,

      EXISTS (
        SELECT 1 FROM trip t
        WHERE t.customer_id = c.id
          AND t.trip_status IN (?)
      ) AS has_checkin,
      
      -- Subscription order for sorting (based on subscription_id)
      COALESCE(sm.id, 0) AS subscription_order

    FROM customer c

    -- Filter to get only the latest customer for each mobile number
    INNER JOIN (
      SELECT MAX(id) as latest_id
      FROM customer
      GROUP BY mobile
    ) unique_c ON c.id = unique_c.latest_id

    LEFT JOIN my_vehicles mv ON mv.id = (
      SELECT mv2.id
      FROM my_vehicles mv2
      WHERE mv2.customer_id = c.id
      ORDER BY mv2.created_at DESC
      LIMIT 1
    )

    LEFT JOIN vehicle_type_master vt ON vt.id = mv.vehicle_type_id
    LEFT JOIN manufacturer_master mf ON mf.id = mv.manufacturer_id
    LEFT JOIN vehicle_model_master vmm ON vmm.id = mv.vehicle_model_id
    LEFT JOIN vehicle_variant_master vvm ON vvm.id = mv.vehicle_variant_id

    LEFT JOIN devices d ON d.id = (
      SELECT d2.id
      FROM devices d2
      WHERE d2.customer_id = c.id
      LIMIT 1
    )

    -- Join latest subscription only
    LEFT JOIN subscription s ON s.id = (
      SELECT s2.id 
      FROM subscription s2 
      WHERE s2.customer_id = c.id 
      ORDER BY s2.id DESC 
      LIMIT 1
    )
    LEFT JOIN subscription_master sm ON sm.id = s.subscription_id

    ${dateWhereClause}

    ORDER BY ${sortColumn} ${orderDirection}
    LIMIT ? OFFSET ?
    `,
    queryParams
  );

  return rows;
}

/**
 * Fetches all vehicles for given customer IDs
 */
async function fetchVehiclesForCustomers(customerIds) {
  if (customerIds.length === 0) return [];

  const [vehiclesRows] = await db.query(
    `
    SELECT
      mv.customer_id,
      mv.created_at AS vehicle_reg_date,
      mv.vehicle_registration_no AS registration_number,
      vt.name AS vehicle_type,
      mf.name AS manufacturer,
      vmm.name AS vehicle_model,
      vvm.name AS vehicle_variant
    FROM my_vehicles mv
    LEFT JOIN vehicle_type_master vt ON vt.id = mv.vehicle_type_id
    LEFT JOIN manufacturer_master mf ON mf.id = mv.manufacturer_id
    LEFT JOIN vehicle_model_master vmm ON vmm.id = mv.vehicle_model_id
    LEFT JOIN vehicle_variant_master vvm ON vvm.id = mv.vehicle_variant_id
    WHERE mv.customer_id IN (?)
    ORDER BY mv.customer_id, mv.created_at DESC
    `,
    [customerIds]
  );

  return vehiclesRows;
}

/**
 * Groups vehicles by customer ID
 */
function groupVehiclesByCustomer(vehiclesRows) {
  const vehiclesByCustomer = {};

  vehiclesRows.forEach(v => {
    if (!vehiclesByCustomer[v.customer_id]) {
      vehiclesByCustomer[v.customer_id] = [];
    }

    vehiclesByCustomer[v.customer_id].push({
      vehicleRegDate: v.vehicle_reg_date,
      registrationNumber: v.registration_number,
      vehicleType: v.vehicle_type,
      manufacturer: v.manufacturer,
      vehicleModel: v.vehicle_model,
      vehicleVariant: v.vehicle_variant
    });
  });

  return vehiclesByCustomer;
}

/**
 * Maps database row to customer response object
 */
function mapCustomerResponse(row, vehiclesByCustomer) {
  const customerVehicles = vehiclesByCustomer[row.id] || [];
  const latestVehicle = customerVehicles[0] || {};

  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.mobile,
    customerRegDate: row.customer_reg_date,

    // Latest vehicle info (backward compatibility)
    vehicleRegDate: latestVehicle.vehicleRegDate || row.vehicle_reg_date,
    registrationNumber: latestVehicle.registrationNumber || row.vehicle_registration_no,
    vehicleType: latestVehicle.vehicleType || row.vehicle_type,
    manufacturer: latestVehicle.manufacturer || row.manufacturer,
    vehicleModel: latestVehicle.vehicleModel || row.vehicle_model,
    vehicleVariant: latestVehicle.vehicleVariant || row.vehicle_variant,

    // Use subscription from database, fallback to "Free"
    subscription: row.subscription_name || "Free",

    deviceBrand: row.device_brand,
    deviceModel: row.device_model,
    devicePlatform: row.device_platform,
    appVersion: row.app_version,

    navigation: row.has_navigation ? "Yes" : "No",
    trip: row.has_trip ? "Yes" : "No",
    checkIn: row.has_checkin ? "Yes" : "No",

    // All vehicles array
    vehicles: customerVehicles
  };
}

// ============================================================================
// SWAGGER DOCUMENTATION
// ============================================================================

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: Get paginated list of customers
 *     description: Retrieves a paginated list of customers with their vehicle information, device details, and subscription status. Supports server-side sorting and date range filtering.
 *     tags:
 *       - Customers
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
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [id, firstName, lastName, email, phone, customerRegDate, vehicleRegDate, registrationNumber, vehicleType, manufacturer, vehicleModel, subscription]
 *           default: customerRegDate
 *         description: Field to sort by
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order (ascending or descending)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter customers registered on or after this date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter customers registered on or before this date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Successful response with customer data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CustomersResponse'
 *             example:
 *               data:
 *                 - firstName: John
 *                   lastName: Doe
 *                   email: john.doe@example.com
 *                   phone: "9876543210"
 *                   customerRegDate: "2024-01-15T10:30:00.000Z"
 *                   vehicleRegDate: "2024-01-20T14:00:00.000Z"
 *                   registrationNumber: MH12AB1234
 *                   subscription: Premium
 *                   vehicleType: Car
 *                   manufacturer: Tata
 *                   vehicleModel: Nexon EV
 *                   vehicleVariant: Max
 *                   deviceBrand: Samsung
 *                   deviceModel: Galaxy S21
 *                   devicePlatform: Android
 *                   appVersion: "2.1.0"
 *                   navigation: "Yes"
 *                   trip: "Yes"
 *                   checkIn: "Yes"
 *                   vehicles: []
 *               pagination:
 *                 total: 150
 *                 page: 1
 *                 limit: 10
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

// ============================================================================
// ROUTE HANDLER
// ============================================================================

router.get("/", async (req, res) => {
  try {
    // 1. Parse and validate parameters
    const { page, limit, offset } = getPagination(req.query);
    const { sortColumn, orderDirection } = getSortParams(req.query);

    // Extract date filters from query
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    // 2. Fetch total count with date filters
    const total = await getTotalCustomers(startDate, endDate);

    // 3. Fetch customers with latest vehicle and date filters
    const customers = await fetchCustomers(limit, offset, sortColumn, orderDirection, startDate, endDate);

    // 4. Fetch all vehicles for these customers
    const customerIds = customers.map(c => c.id);
    const vehiclesRows = await fetchVehiclesForCustomers(customerIds);

    // 5. Group vehicles by customer
    const vehiclesByCustomer = groupVehiclesByCustomer(vehiclesRows);

    // 6. Map to response format
    const data = customers.map(customer =>
      mapCustomerResponse(customer, vehiclesByCustomer)
    );

    // 7. Send response
    res.json({
      data,
      pagination: { total, page, limit }
    });

  } catch (err) {
    console.error("CUSTOMERS API ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;