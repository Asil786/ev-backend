// import express from "express";
// import { db } from "../../db.js";
// import { getPagination } from "../../utils/pagination.js";

// const router = express.Router();

// /**
//  * =====================================================
//  * GET /api/stations
//  * =====================================================
//  */
// router.get("/", async (req, res) => {
//   try {
//     const { page, limit, offset } = getPagination(req.query);
//     const { status, startDate, endDate } = req.query;

//     const where = [];
//     const params = [];

//     if (status && status !== "All") {
//       where.push("cs.approved_status = ?");
//       params.push(status.toUpperCase());
//     }

//     if (startDate) {
//       where.push("cs.created_at >= ?");
//       params.push(startDate);
//     }

//     if (endDate) {
//       where.push("cs.created_at <= ?");
//       params.push(endDate);
//     }

//     const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

//     /* ---------- TOTAL COUNT ---------- */
//     const [[{ total }]] = await db.query(
//       `SELECT COUNT(*) AS total FROM charging_station cs ${whereSQL}`,
//       params
//     );

//     /* ---------- STEP 1: FETCH STATION IDS ---------- */
//     const [stationIdRows] = await db.query(
//       `
//       SELECT cs.id
//       FROM charging_station cs
//       ${whereSQL}
//       ORDER BY cs.created_at DESC
//       LIMIT ? OFFSET ?
//       `,
//       [...params, limit, offset]
//     );

//     const stationIds = stationIdRows.map((r) => r.id);

//     if (!stationIds.length) {
//       return res.json({
//         data: [],
//         pagination: { total, page, limit },
//       });
//     }

//     /* ---------- STEP 2: FETCH FULL DATA ---------- */
//     const [rows] = await db.query(
//       `
//       SELECT
//         cs.id,
//         cs.name AS stationName,
//         cs.latitude,
//         cs.longitude,
//         cs.mobile AS contactNumber,
//         cs.created_at AS submissionDate,
//         cs.updated_at AS approvalDate,
//         cs.approved_status AS status,
//         cs.open_time,
//         cs.close_time,
//         cs.type AS usageType,
//         cs.user_type AS addedByType,
//         cs.landmark AS landMark,

//         n.id AS networkId,
//         n.name AS networkName,
//         n.status AS networkStatus,

//         CONCAT(cu.first_name, ' ', cu.last_name) AS userName,

//         c.id AS connectorId,
//         ct.id AS chargerTypeId,
//         ct.name AS chargerName,
//         ct.type AS chargerType,
//         ct.max_power AS powerRating,
//         c.no_of_connectors,
//         c.price_per_khw,

//         lp.eVolts,
//         a.path AS photoPath

//       FROM charging_station cs
//       LEFT JOIN network n ON n.id = cs.network_id
//       LEFT JOIN customer cu ON cu.id = cs.created_by
//       LEFT JOIN charging_point cp ON cp.station_id = cs.id
//       LEFT JOIN connector c ON c.charge_point_id = cp.id
//       LEFT JOIN charger_types ct ON ct.id = c.charger_type_id
//       LEFT JOIN (
//         SELECT station_id, SUM(points) AS eVolts
//         FROM loyalty_points
//         WHERE approved_status = 'APPROVED'
//         GROUP BY station_id
//       ) lp ON lp.station_id = cs.id
//       LEFT JOIN attachment a ON a.station_id = cs.id

//       WHERE cs.id IN (?)
//       ORDER BY cs.created_at DESC
//       `,
//       [stationIds]
//     );

//     /* ---------- MERGE + DEDUP ---------- */
//     const stationMap = new Map();

//     for (const r of rows) {
//       if (!stationMap.has(r.id)) {
//         stationMap.set(r.id, {
//           id: r.id,
//           stationName: r.stationName,
//           stationNumber: `CS-${r.id}`,
//           latitude: r.latitude,
//           longitude: r.longitude,

//           networkId: r.networkId || null,
//           networkName: r.networkName || "-",
//           networkStatus: r.networkStatus ?? 0,

//           userName: r.userName,
//           addedByType: r.addedByType,
//           contactNumber: r.contactNumber,
//           usageType: r.usageType === "PUBLIC" ? "Public" : "Private",
//           landMark: r.landMark || "-",
//           operationalHours:
//             r.open_time && r.close_time
//               ? `${r.open_time} - ${r.close_time}`
//               : "-",
//           status:
//             r.status === "APPROVED"
//               ? "Approved"
//               : r.status === "REJECTED"
//               ? "Rejected"
//               : "Pending",
//           submissionDate: r.submissionDate,
//           approvalDate: r.status === "APPROVED" ? r.approvalDate : null,
//           photos: [],
//           connectors: [],
//           eVolts: r.eVolts || 0,
//         });
//       }

//       const station = stationMap.get(r.id);

//       if (r.photoPath && !station.photos.includes(r.photoPath)) {
//         station.photos.push(r.photoPath);
//       }

//       if (
//         r.connectorId &&
//         !station.connectors.find((c) => c.id === r.connectorId)
//       ) {
//         station.connectors.push({
//           id: r.connectorId,
//           chargerTypeId: r.chargerTypeId,
//           type: r.chargerType,
//           name: r.chargerName,
//           count: r.no_of_connectors || 0,
//           powerRating: r.powerRating ? `${r.powerRating} kW` : "-",
//           tariff: r.price_per_khw ? `₹${r.price_per_khw}/kWh` : "-",
//         });
//       }
//     }

//     res.json({
//       data: Array.from(stationMap.values()),
//       pagination: { total, page, limit },
//     });
//   } catch (err) {
//     console.error("GET /stations ERROR:", err);
//     res.status(500).json({ message: err.message });
//   }
// });

// // /**
// //  * =====================================================
// //  * PUT /api/stations/:id
// //  * =====================================================
// //  */
// router.put("/:id", async (req, res) => {
//   const connection = await db.getConnection();

//   try {
//     const { id } = req.params;
//     const {
//       action,
//       reason,
//       addedByType,
//       usageType,
//       stationType,
//       stationName,
//       latitude,
//       longitude,
//       contactNumber,
//       open_time,
//       close_time,
//       connectors = [],
//     } = req.body;

//     if (!action) {
//       return res.status(400).json({ message: "action is required" });
//     }

//     await connection.beginTransaction();

//     /**
//      * APPROVE
//      */
//     if (action === "APPROVE") {
//       await connection.query(
//         `
//         UPDATE charging_station
//         SET verified = 1,
//             approved_status = 'APPROVED',
//             reason = NULL,
//             updated_at = NOW()
//         WHERE id = ?
//         `,
//         [id]
//       );

//       await connection.query(
//         `
//         UPDATE loyalty_points
//         SET approved_status = 'APPROVED'
//         WHERE station_id = ?
//           AND approved_status = 'PENDING'
//         `,
//         [id]
//       );

//       await connection.commit();
//       return res.json({ message: "Station approved" });
//     }

//     /**
//      * REJECT
//      */
//     if (action === "REJECT") {
//       const rejectReason =
//         typeof reason === "string" && reason.trim() ? reason.trim() : null;

//       await connection.query(
//         `
//         UPDATE charging_station
//         SET verified = 0,
//             approved_status = 'REJECTED',
//             reason = ?,
//             updated_at = NOW()
//         WHERE id = ?
//         `,
//         [rejectReason, id]
//       );

//       await connection.query(
//         `
//         UPDATE loyalty_points
//         SET approved_status = 'REJECTED'
//         WHERE station_id = ?
//           AND approved_status = 'PENDING'
//         `,
//         [id]
//       );

//       await connection.commit();
//       return res.json({ message: "Station rejected" });
//     }

//     /**
//      * SAVE
//      */
//     if (action === "SAVE") {
//       await connection.query(
//         `
//           UPDATE charging_station
//           SET name = ?,
//               landmark = ?,
//               latitude = ?,
//               type = ?,
//               user_type = ?,
//               longitude = ?,
//               mobile = ?,
//               open_time = ?,
//               close_time = ?,
//               updated_at = NOW()
//           WHERE id = ?
//           `,
//         [
//           stationName,
//           stationType,
//           latitude,
//           usageType,
//           addedByType,
//           longitude,
//           contactNumber,
//           open_time,
//           close_time,
//           id,
//         ]
//       );

//       router.put("/:id", async (req, res) => {
//         const connection = await db.getConnection();

//         try {
//           const { id } = req.params;
//           const {
//             action,
//             stationName,
//             stationType,
//             latitude,
//             longitude,
//             contactNumber,
//             open_time,
//             close_time,
//             networkId,
//             networkName,
//             networkStatus,
//           } = req.body;

//           await connection.beginTransaction();

//           if (action !== "SAVE") {
//             return res
//               .status(400)
//               .json({ message: "Only SAVE supported here" });
//           }

//           /* ---------------- STATION UPDATE ---------------- */
//           await connection.query(
//             `
//                 UPDATE charging_station
//                 SET name = ?,
//                     latitude = ?,
//                     landmark = ?,
//                     longitude = ?,
//                     mobile = ?,
//                     open_time = ?,
//                     close_time = ?,
//                     updated_at = NOW()
//                 WHERE id = ?
//                 `,
//             [
//               stationName,
//               latitude,
//               stationType,
//               longitude,
//               contactNumber,
//               open_time,
//               close_time,
//               id,
//             ]
//           );
//           /* ---------------- NETWORK LOGIC (FIXED) ---------------- */

//           let finalNetworkId = null;
//           const normalizedNetworkStatus = Number(networkStatus);

//           /**
//            * CASE 1: Network already active
//            */
//           if (normalizedNetworkStatus === 1 && networkId) {
//             // verify network exists
//             const [[existing]] = await connection.query(
//               `SELECT id FROM network WHERE id = ? LIMIT 1`,
//               [networkId]
//             );

//             if (existing) {
//               finalNetworkId = existing.id;
//             }
//           }

//           /**
//            * CASE 2: Network inactive → deduplicate + activate
//            */
//           if (normalizedNetworkStatus === 0 && networkName) {
//             // find ALL networks with same name
//             const [networks] = await connection.query(
//               `
//               SELECT id, created_at
//               FROM network
//               WHERE name = ?
//               ORDER BY created_at ASC
//               `,
//               [networkName]
//             );

//             if (networks.length === 0) {
//               throw new Error("Network not found for given name");
//             }

//             // keep OLDEST
//             finalNetworkId = networks[0].id;

//             // move stations from duplicates
//             for (let i = 1; i < networks.length; i++) {
//               await connection.query(
//                 `
//                 UPDATE charging_station
//                 SET network_id = ?
//                 WHERE network_id = ?
//                 `,
//                 [finalNetworkId, networks[i].id]
//               );

//               await connection.query(`DELETE FROM network WHERE id = ?`, [
//                 networks[i].id,
//               ]);
//             }

//             // 🔥 THIS WILL NOW ALWAYS RUN
//             await connection.query(
//               `
//               UPDATE network
//               SET
//                 name = ?,
//                 status = 1,
//                 updated_at = NOW()
//               WHERE id = ?
//               `,
//               [networkName, finalNetworkId]
//             );
//           }

//           /**
//            * Link station to final network
//            */
//           if (finalNetworkId) {
//             await connection.query(
//               `
//               UPDATE charging_station
//               SET network_id = ?
//               WHERE id = ?
//               `,
//               [finalNetworkId, id]
//             );
//           }

//           await connection.commit();
//           res.json({ message: "Station & network updated successfully" });
//         } catch (err) {
//           await connection.rollback();
//           console.error("PUT /stations ERROR:", err);
//           res.status(500).json({ message: err.message });
//         } finally {
//           connection.release();
//         }
//       });

//       const [[cp]] = await connection.query(
//         `SELECT id FROM charging_point WHERE station_id = ? LIMIT 1`,
//         [id]
//       );

//       let chargePointId = cp?.id;
//       if (!chargePointId) {
//         const [insert] = await connection.query(
//           `INSERT INTO charging_point (station_id, status) VALUES (?, 1)`,
//           [id]
//         );
//         chargePointId = insert.insertId;
//       }

//       await connection.query(
//         `DELETE FROM connector WHERE charge_point_id = ?`,
//         [chargePointId]
//       );

//       for (const c of connectors) {
//         await connection.query(
//           `
//           INSERT INTO connector (
//             charge_point_id, charger_type_id, no_of_connectors,
//             power, price_per_khw, status, created_at
//           )
//           VALUES (?, ?, ?, ?, ?, 1, NOW())
//           `,
//           [
//             chargePointId,
//             c.chargerTypeId,
//             c.count,
//             c.powerRating ? parseFloat(c.powerRating) : null,
//             c.tariff ? parseFloat(c.tariff) : null,
//           ]
//         );
//       }

//       await connection.commit();
//       return res.json({ message: "Station updated successfully" });
//     }
//   } catch (err) {
//     await connection.rollback();
//     console.error("PUT /stations ERROR:", err);
//     res.status(500).json({ message: err.message });
//   } finally {
//     connection.release();
//   }
// });

// export default router;

import express from "express";
import { db } from "../../db.js";
import { getPagination } from "../../utils/pagination.js";

const router = express.Router();

/* =====================================================
   GET /api/stations
===================================================== */
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

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM charging_station cs ${whereSQL}`,
      params
    );

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

    const stationIds = stationIdRows.map((r) => r.id);

    if (!stationIds.length) {
      return res.json({ data: [], pagination: { total, page, limit } });
    }

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
        cs.landmark AS landMark,

        n.name AS networkName,

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
    // The fix I just applied is c.power AS powerRating,
    const stationMap = new Map();

    for (const r of rows) {
      if (!stationMap.has(r.id)) {
        stationMap.set(r.id, {
          id: r.id,
          stationName: r.stationName,
          stationNumber: `CS-${r.id}`,
          latitude: r.latitude,
          longitude: r.longitude,
          networkName: r.networkName,
          userName: r.userName,
          addedByType: r.addedByType,
          contactNumber: r.contactNumber,
          usageType: r.usageType === "PUBLIC" ? "Public" : "Private",
          landMark: r.landMark || "-",
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
          connectors: [],
          eVolts: r.eVolts || 0,
        });
      }

      const station = stationMap.get(r.id);

      if (r.photoPath && !station.photos.includes(r.photoPath)) {
        station.photos.push(r.photoPath);
      }

      if (
        r.connectorId &&
        !station.connectors.find((c) => c.id === r.connectorId)
      ) {
        station.connectors.push({
          id: r.connectorId,
          chargerTypeId: r.chargerTypeId,
          type: r.chargerType,
          name: r.chargerName,
          count: r.no_of_connectors || 0,
          powerRating: r.powerRating ? `${r.powerRating} kW` : "-",
          tariff: r.price_per_khw ? `₹${r.price_per_khw}/kWh` : "-",
        });
      }
    }

    res.json({
      data: Array.from(stationMap.values()),
      pagination: { total, page, limit },
    });
  } catch (err) {
    console.error("GET /stations ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   PUT /api/stations/:id
===================================================== */
router.put("/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;
    const {
      action,
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
      networkStatus,
    } = req.body;

    if (!action) {
      return res.status(400).json({ message: "action is required" });
    }

    await connection.beginTransaction();
if (action === "APPROVE") {
  await connection.query(
    `
    UPDATE charging_station
    SET verified = 1,
        approved_status = 'APPROVED',
        reason = NULL,
        updated_at = NOW()
    WHERE id = ?
    `,
    [id]
  );

  await connection.query(
    `
    UPDATE loyalty_points
    SET approved_status = 'APPROVED'
    WHERE station_id = ?
      AND approved_status = 'PENDING'
    `,
    [id]
  );

  await connection.commit();
  return res.json({ message: "Station approved" });
}

if (action === "REJECT") {
  const rejectReason =
    typeof reason === "string" && reason.trim() ? reason.trim() : null;

  await connection.query(
    `
    UPDATE charging_station
    SET verified = 0,
        approved_status = 'REJECTED',
        reason = ?,
        updated_at = NOW()
    WHERE id = ?
    `,
    [rejectReason, id]
  );

  await connection.query(
    `
    UPDATE loyalty_points
    SET approved_status = 'REJECTED'
    WHERE station_id = ?
      AND approved_status = 'PENDING'
    `,
    [id]
  );

  await connection.commit();
  return res.json({ message: "Station rejected" });
}

     

    if (action === "SAVE") {
      await connection.query(
        `
        UPDATE charging_station
        SET name = ?, landmark = ?, latitude = ?, type = ?, user_type = ?,
            longitude = ?, mobile = ?, open_time = ?, close_time = ?, updated_at = NOW()
        WHERE id = ?
        `,
        [
          stationName,
          stationType,
          latitude,
          usageType,
          addedByType,
          longitude,
          contactNumber,
          open_time,
          close_time,
          id,
        ]
      );

      let finalNetworkId = networkId;

      if (networkName) {
        const [[baseNetwork]] = await connection.query(
          `SELECT id FROM network WHERE id = ? LIMIT 1`,
          [networkId]
        );

        if (baseNetwork) {
          const [duplicates] = await connection.query(
            `
            SELECT id FROM network
            WHERE name = ? AND id != ?
            ORDER BY created_at DESC
            `,
            [networkName, baseNetwork.id]
          );

          for (const dup of duplicates) {
            await connection.query(
              `UPDATE charging_station SET network_id = ? WHERE network_id = ?`,
              [baseNetwork.id, dup.id]
            );

            await connection.query(`DELETE FROM network WHERE id = ?`, [
              dup.id,
            ]);
          }

          await connection.query(
            `
            UPDATE network
            SET name = ?, status = 1, updated_at = NOW()
            WHERE id = ?
            `,
            [networkName, baseNetwork.id]
          );

          finalNetworkId = baseNetwork.id;
        }
      }

      if (finalNetworkId) {
        await connection.query(
          `UPDATE charging_station SET network_id = ? WHERE id = ?`,
          [finalNetworkId, id]
        );
      }

      const [[cp]] = await connection.query(
        `SELECT id FROM charging_point WHERE station_id = ? LIMIT 1`,
        [id]
      );

      let chargePointId = cp?.id;
      if (!chargePointId) {
        const [insert] = await connection.query(
          `INSERT INTO charging_point (station_id, status) VALUES (?, 1)`,
          [id]
        );
        chargePointId = insert.insertId;
      }

      await connection.query(
        `DELETE FROM connector WHERE charge_point_id = ?`,
        [chargePointId]
      );

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

      await connection.commit();
      return res.json({ message: "Station updated successfully" });
    }

    res.status(400).json({ message: "Invalid action" });
  } catch (err) {
    await connection.rollback();
    console.error("PUT /stations ERROR:", err);
    res.status(500).json({ message: err.message });
  } finally {
    connection.release();
  }
});

export default router;
