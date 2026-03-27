# Smart College Monitoring & Navigation System

Full-stack application with Admin/Principal RBAC, student/staff management, timetable, live class tracking, analytics, and campus shortest-path navigation.

## Tech Stack

- Frontend: React + Vite + Recharts
- Backend: Node.js + Express + JWT
- Database: SQLite (portable local DB with sample data)
- Optional ML: Python + scikit-learn script

## Default Logins

- Admin: `admin` / `admin123`
- Principal: `principal` / `principal123`

## Features Implemented

- Secure login and JWT-based authentication
- Role-based access:
  - `admin`: full CRUD
  - `principal`: view-only access
- Student module:
  - Add, list, update, delete
  - Search/filter by name/branch/section
- Staff module:
  - Add, list, update/delete endpoints (UI includes add/delete)
- Timetable module:
  - Create and list timetable slots
- Real-time staff tracking:
  - Detects current class based on system time/day
  - Auto refreshes every minute on dashboard
- Analytics:
  - Attendance insights
  - Top performers
  - Risk grouping (Good/Average/At Risk)
  - Charts
- Navigation:
  - Campus graph + Dijkstra shortest path
  - Select destination and get shortest route
- Optional ML script for performance risk prediction in `backend/ml/student_risk_model.py`

## Project Structure

- `frontend/` - React dashboard app
- `backend/` - API server and SQLite DB

## Run Locally

### 1) Backend

```bash
cd backend
copy .env.example .env
npm install
npm run dev
```

Backend runs on `http://localhost:5000`.

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

### Google Maps (Live Tracking)

1. Copy `frontend/.env.example` to `frontend/.env`
2. Add your API key in `VITE_GOOGLE_MAPS_API_KEY`
3. (Optional) set `VITE_SOCKET_URL` if backend runs on another host
4. Restart the frontend dev server

Required Google Cloud APIs:
- Maps JavaScript API
- Geolocation API
- Directions API

If key is missing/invalid, app auto-falls back to OpenStreetMap (Leaflet).

## Netlify + Render Deployment Fix

Use these environment variables in Netlify:

- `VITE_API_BASE=https://YOUR_RENDER_APP.onrender.com/api`
- `VITE_SOCKET_URL=https://YOUR_RENDER_APP.onrender.com`
- `VITE_GOOGLE_MAPS_API_KEY=YOUR_KEY` (optional)

Example for this project:
- `VITE_API_BASE=https://college-backend-su5z.onrender.com/api`
- `VITE_SOCKET_URL=https://college-backend-su5z.onrender.com`

Important:
- Backend (Render) now responds at `/` (so no more `Cannot GET /`).
- Frontend includes SPA redirects at `frontend/public/_redirects`.
- Rebuild/redeploy both Netlify and Render after setting env values.

## Main API Routes

- `POST /api/auth/login`
- `GET/POST /api/students`
- `PUT/DELETE /api/students/:id`
- `GET/POST /api/staff`
- `PUT/DELETE /api/staff/:id`
- `GET/POST /api/timetable`
- `GET /api/live/staff-status`
- `POST /api/location/update`
- `GET /api/live/student-locations`
- `GET /api/live/student-location-history`
- `GET /api/analytics`
- `GET /api/navigation/path?from=Gate&to=Room%20101`

## Notes

- SQLite is used for easy setup and includes auto-seeded sample data.
- You can migrate to MySQL later by replacing DB queries in `backend/src/server.js`.
- You can add QR attendance, notifications, PDF/CSV exports, and dark mode as next sprint enhancements.
