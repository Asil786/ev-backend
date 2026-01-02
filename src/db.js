import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config(); // CRITICAL

// Support both DATABASE_URL and individual env variables
// DATABASE_URL takes precedence if provided
const pool = process.env.DATABASE_URL
  ? mysql.createPool(process.env.DATABASE_URL)
  : mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB,
    port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

export const db = pool;
export default pool;
