import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import customerRoutes from "./src/routes/admin/customers.js";
import stationRoutes from "./src/routes/admin/stations.js";
import chargingStationRoutes from "./src/routes/admin/charging-stations.js";
import tripRoutes from "./src/routes/admin/trips.js";
import authRoutes from "./src/routes/admin/auth.js";
import networkRoutes from "./src/routes/admin/networks.js";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./src/swagger.js";

dotenv.config();
const app = express();

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json());

// Error handling for JSON parsing
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('Bad JSON:', err);
    return res.status(400).json({ message: 'Invalid JSON' });
  }
  next();
});


// Serve static files
app.use('/uploads', express.static('uploads'));
app.use('/IMAGE', express.static('IMAGE'));

app.use('/IMAGE', express.static('IMAGE'));

import attachmentRoutes from "./src/routes/admin/attachments.js";
app.use("/api/attachment", attachmentRoutes);

app.use("/api/customers", customerRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/charging-stations", chargingStationRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/auth/vendor", authRoutes);
app.use("/api/networks", networkRoutes);

// Swagger Documentation
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "EVJoints Admin API Docs",
  customfavIcon: "https://your-website.com/favicon.ico",
  customCssUrl: "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.min.css",
  customJs: [
    "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-bundle.js",
    "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-standalone-preset.js"
  ],
  swaggerOptions: {
    defaultModelsExpandDepth: -1
  }
}));

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const PORT = process.env.PORT || 4000;

// Only listen if not running in a serverless environment
if (!process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_VERSION) {
  app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
    console.log(`📚 Swagger documentation at http://localhost:${PORT}/docs`);
  });
}

export default app;
