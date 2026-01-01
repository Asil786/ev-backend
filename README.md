# ⚡ EVJoints Admin Backend

![Node.js](https://img.shields.io/badge/Node.js-18.x-339933?style=for-the-badge&logo=nodedotjs)
![Express.js](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express)
![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql)
![Netlify](https://img.shields.io/badge/Netlify-Deployed-00C7B7?style=for-the-badge&logo=netlify)

> The robust server-side architecture powering the EVJoints Admin Dashboard. Handles data management for EV stations, customers, trips, and network operations with a secure and scalable API.

---

## 📚 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Environment Variables](#-environment-variables)
- [API Documentation](#-api-documentation)
- [Deployment](#-deployment)
- [Folder Structure](#-folder-structure)

---

## 🚀 Features

- **🔐 Authentication**: Secure vendor and admin authentication flow.
- **bust User Management**: CRUD operations for Customers and Admin users.
- **🔌 Station Management**: Comprehensive handling of EV charging stations, including status and connectivity.
- **🛣️ Trip Tracking**: Monitor and manage EV trips and routes.
- **🌐 Network Operations**: Manage charging network providers and configurations.
- **📄 Swagger Docs**: Integrated interactive API documentation.
- **☁️ Serverless Ready**: Optimized for deployment on Netlify Functions.

---

## 🛠 Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Runtime** | Node.js | JavaScript runtime built on Chrome's V8 engine |
| **Framework** | Express.js | Fast, unopinionated, minimalist web framework |
| **Database** | MySQL | Relational database management system |
| **ORM/Query** | MySQL2 | Fast MySQL driver for Node.js |
| **Documentation** | Swagger UI | Auto-generated API documentation |
| **Deployment** | Serverless-http | Wrapper for serverless execution |

---

## 📋 Prerequisites

Before you begin, ensure you have met the following requirements:

- **Node.js** (v18 or higher)
- **npm** (v9 or higher)
- **MySQL Database** instance running locally or in the cloud.

---

## 💻 Installation

1.  **Clone the repository** (if part of a larger repo, navigate to the backend folder):
    ```bash
    cd backend
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment**:
    Create a `.env` file in the root directory (see [Environment Variables](#-environment-variables)).

4.  **Run Locally**:
    ```bash
    npm start
    # OR for development with hot-reload
    npm run dev
    ```

The server will start on `http://localhost:4000`.

---

## 🔑 Environment Variables

Create a `.env` file in the root of your project and add the following:

```env
# Server Configuration
PORT=4000

# Database Connection
DB_HOST=your_database_host
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=your_database_name

# Security
JWT_SECRET=your_super_secret_key_change_this
```

---

## 📖 API Documentation

The backend includes fully integrated Swagger documentation.

- **Local URL**: [http://localhost:4000/docs](http://localhost:4000/docs)
- **Production URL**: `https://<your-netlify-app>/docs`

Use this interface to test endpoints directly from your browser.

---

## ☁️ Deployment

This project is configured for deployment on **Netlify**.

### Deployment Steps:

1.  Push your code to a Git repository (GitHub/GitLab/Bitbucket).
2.  Connect the repository to Netlify.
3.  Set the **Base directory** to `backend` (if in a monorepo).
4.  Adding Environment Variables in Netlify dashboard matches your `.env` file.
5.  Deploy!

The `netlify.toml` file handles the build configuration automatically, redirecting standard API requests to the serverless function.

---

## 📂 Folder Structure

```
backend/
├── netlify/             # Netlify function wrappers
├── src/
│   ├── config/          # Database and app configuration
│   ├── controllers/     # Request handlers (Business Logic)
│   ├── middleware/      # Auth and error handling middleware
│   ├── routes/          # API Route definitions
│   │   └── admin/       # Admin-specific routes
│   └── services/        # Database queries and helpers
├── .env                 # Environment variables (GitIgnored)
├── server.js            # Entry point for the application
└── package.json         # Dependencies and scripts
```

---

## 🤝 Contributing

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

---

Made with ❤️ for **EVJoints**
