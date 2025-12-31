import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import customerRoutes from "./src/routes/admin/customers.js";
import stationRoutes from "./src/routes/admin/stations.js";
import tripRoutes from "./src/routes/admin/trips.js";
import authRoutes from "./src/routes/admin/auth.js";
import networkRoutes from "./src/routes/admin/networks.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/customers", customerRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/auth/vendor", authRoutes);
app.use("/api/networks", networkRoutes);

app.listen(process.env.PORT || process.env.URL_BACKEND,() => {
  console.log("Backend running");
});