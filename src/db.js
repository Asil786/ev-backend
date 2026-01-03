import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config(); // CRITICAL

// Support both DATABASE_URL and individual env variables
// DATABASE_URL takes precedence if provided
const dbConfig = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB,
  port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // Returns strings "YYYY-MM-DD HH:mm:ss" instead of Date objects
  timezone: '+05:30' // Force IST for session consistency if dateStrings is not enough for operations
};

const pool = process.env.DATABASE_URL
  ? mysql.createPool({ uri: process.env.DATABASE_URL, dateStrings: true, timezone: '+05:30' })
  : mysql.createPool(dbConfig);

export const db = pool;
export default pool;
