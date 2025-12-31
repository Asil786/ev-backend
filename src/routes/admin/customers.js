import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: Get paginated list of customers
 *     description: Retrieves a paginated list of customers with their vehicle information, device details, and subscription status
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

router.get("/", async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);

    /* ---------- TOTAL COUNT ---------- */
    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) AS total FROM customer"
    );

    /* ---------- MAIN QUERY ---------- */
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

        /* ---------- NAVIGATION ---------- */
        EXISTS (
          SELECT 1
          FROM trip t
          WHERE t.customer_id = c.id
            AND t.trip_status IN ('COMPLETED', 'ON_GOING', 'ON_GOING_TEST')
        ) AS has_navigation,

        /* ---------- TRIP ---------- */
        EXISTS (
          SELECT 1
          FROM trip t
          WHERE t.customer_id = c.id
            AND t.trip_status != 'ENQUIRED'
        ) AS has_trip,

        /* ---------- CHECK-IN ---------- */
        EXISTS (
          SELECT 1
          FROM trip t
          WHERE t.customer_id = c.id
            AND t.trip_status IN ('COMPLETED', 'ON_GOING', 'ON_GOING_TEST')
        ) AS has_checkin

      FROM customer c

      LEFT JOIN my_vehicles mv ON mv.id = (
        SELECT mv2.id
        FROM my_vehicles mv2
        WHERE mv2.customer_id = c.id
        ORDER BY mv2.created_at DESC
        LIMIT 1
      )

      LEFT JOIN vehicle_type_master vt
        ON vt.id = mv.vehicle_type_id

      LEFT JOIN manufacturer_master mf
        ON mf.id = mv.manufacturer_id

      LEFT JOIN vehicle_model_master vmm
        ON vmm.id = mv.vehicle_model_id

      LEFT JOIN vehicle_variant_master vvm
        ON vvm.id = mv.vehicle_variant_id

      LEFT JOIN devices d ON d.id = (
        SELECT d2.id
        FROM devices d2
        WHERE d2.customer_id = c.id
        LIMIT 1
      )

      /* ---------- ORDERING ---------- */
      ORDER BY c.id DESC

      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );

    /* ---------- RESPONSE ---------- */
    const data = rows.map(r => ({
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      phone: r.mobile,
      customerRegDate: r.customer_reg_date,
      vehicleRegDate: r.vehicle_reg_date,
      registrationNumber: r.vehicle_registration_no,

      subscription:
        r.has_trip && r.has_checkin
          ? "Premium"
          : r.has_trip
            ? "Gold"
            : "Basic",

      vehicleType: r.vehicle_type,
      manufacturer: r.manufacturer,
      vehicleModel: r.vehicle_model,
      vehicleVariant: r.vehicle_variant,

      deviceBrand: r.device_brand,
      deviceModel: r.device_model,
      devicePlatform: r.device_platform,
      appVersion: r.app_version,

      navigation: r.has_navigation ? "Yes" : "No",
      trip: r.has_trip ? "Yes" : "No",
      checkIn: r.has_checkin ? "Yes" : "No"
    }));

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