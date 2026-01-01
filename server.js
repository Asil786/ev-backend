import express from "express";
import { fileURLToPath } from 'url';
import cors from "cors";
import dotenv from "dotenv";
import customerRoutes from "./src/routes/admin/customers.js";
import stationRoutes from "./src/routes/admin/stations.js";
import tripRoutes from "./src/routes/admin/trips.js";
import authRoutes from "./src/routes/admin/auth.js";
import networkRoutes from "./src/routes/admin/networks.js";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./src/swagger.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/customers", customerRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/auth/vendor", authRoutes);
app.use("/api/networks", networkRoutes);

// Swagger Documentation
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "EVJoints Admin API Docs"
}));

const PORT = process.env.PORT || 4000;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
    console.log(`📚 Swagger documentation at http://localhost:${PORT}/docs`);
  });
}

export default app;