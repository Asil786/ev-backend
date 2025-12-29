import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import customerRoutes from "./src/routes/admin/customers.js";
import stationRoutes from "./src/routes/admin/stations.js";
import tripRoutes from "./src/routes/admin/trips.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/customers", customerRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/trips", tripRoutes);

app.listen(process.env.PORT || 5000, () => {
  console.log("Backend running");
});