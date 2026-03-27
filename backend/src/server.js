require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "smart-college-secret";
const db = new Database("smart_college.db");

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "Smart College Monitoring API",
    health: "/api/health"
  });
});

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'principal'))
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_number TEXT UNIQUE,
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  section TEXT NOT NULL,
  classroom TEXT NOT NULL,
  marks REAL NOT NULL,
  attendance REAL NOT NULL,
  absent_days INTEGER NOT NULL DEFAULT 0,
  last_sem_marks REAL DEFAULT 0,
  current_sem_marks REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  assigned_classes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  subject TEXT NOT NULL,
  class_name TEXT NOT NULL,
  classroom TEXT NOT NULL,
  FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS student_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);
`);

function ensureStudentColumns() {
  const cols = db.prepare("PRAGMA table_info(students)").all().map((c) => c.name);
  if (!cols.includes("roll_number")) db.exec("ALTER TABLE students ADD COLUMN roll_number TEXT");
  if (!cols.includes("last_sem_marks")) db.exec("ALTER TABLE students ADD COLUMN last_sem_marks REAL DEFAULT 0");
  if (!cols.includes("current_sem_marks")) db.exec("ALTER TABLE students ADD COLUMN current_sem_marks REAL DEFAULT 0");
}

ensureStudentColumns();

const usersCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
if (usersCount === 0) {
  const insertUser = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)");
  insertUser.run("admin", bcrypt.hashSync("admin123", 10), "admin");
  insertUser.run("principal", bcrypt.hashSync("principal123", 10), "principal");
}

const studentsCount = db.prepare("SELECT COUNT(*) as count FROM students").get().count;
if (studentsCount === 0) {
  const insertStudent = db.prepare(`
    INSERT INTO students (roll_number, name, branch, section, classroom, marks, attendance, absent_days, last_sem_marks, current_sem_marks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  [
    ["CSE001", "Aarav", "CSE", "A", "Room 101", 88, 94, 2, 84, 88],
    ["ECE021", "Bhavya", "ECE", "B", "Room 203", 76, 82, 6, 74, 76],
    ["CSE002", "Charan", "CSE", "A", "Room 101", 92, 97, 1, 89, 92],
    ["MEC011", "Divya", "MECH", "C", "Workshop 2", 68, 72, 10, 71, 68],
    ["CIV007", "Eesha", "CIVIL", "A", "Room 305", 81, 86, 5, 79, 81]
  ].forEach((s) => insertStudent.run(...s));
}

const missingRolls = db.prepare("SELECT id FROM students WHERE roll_number IS NULL OR roll_number = ''").all();
for (const [idx, row] of missingRolls.entries()) {
  db.prepare("UPDATE students SET roll_number = ? WHERE id = ?").run(`STD${String(idx + 1).padStart(3, "0")}`, row.id);
}
db.prepare("UPDATE students SET current_sem_marks = marks WHERE current_sem_marks IS NULL OR current_sem_marks = 0").run();
db.prepare(`
  UPDATE students
  SET last_sem_marks = CASE WHEN marks - 4 < 0 THEN 0 ELSE marks - 4 END
  WHERE last_sem_marks IS NULL OR last_sem_marks = 0
`).run();

const staffCount = db.prepare("SELECT COUNT(*) as count FROM staff").get().count;
if (staffCount === 0) {
  const insertStaff = db.prepare("INSERT INTO staff (name, subject, assigned_classes) VALUES (?, ?, ?)");
  insertStaff.run("Ravi", "DBMS", "CSE-A,CSE-B");
  insertStaff.run("Sita", "Signals", "ECE-A,ECE-B");
  insertStaff.run("Kiran", "Mechanics", "MECH-C");
}

const ttCount = db.prepare("SELECT COUNT(*) as count FROM timetable").get().count;
if (ttCount === 0) {
  const byName = db.prepare("SELECT id FROM staff WHERE name = ?");
  const ravi = byName.get("Ravi").id;
  const sita = byName.get("Sita").id;
  const kiran = byName.get("Kiran").id;
  const insertTT = db.prepare(`
    INSERT INTO timetable (staff_id, day, start_time, end_time, subject, class_name, classroom)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  [
    [ravi, "Monday", "09:00", "10:00", "DBMS", "CSE-A", "Room 101"],
    [ravi, "Monday", "10:00", "11:00", "DBMS Lab", "CSE-B", "Lab 2"],
    [sita, "Monday", "09:00", "10:00", "Signals", "ECE-A", "Room 203"],
    [sita, "Monday", "11:00", "12:00", "Networks", "ECE-B", "Room 208"],
    [kiran, "Monday", "10:00", "11:00", "Mechanics", "MECH-C", "Workshop 2"]
  ].forEach((row) => insertTT.run(...row));
}

const CAMPUS_GRAPH = {
  Gate: { "Block A": 2, "Block B": 3 },
  "Block A": { Gate: 2, "Room 101": 2, "Lab 2": 4 },
  "Block B": { Gate: 3, "Room 203": 2, "Room 208": 3, "Room 305": 4 },
  "Room 101": { "Block A": 2 },
  "Lab 2": { "Block A": 4, "Workshop 2": 2 },
  "Room 203": { "Block B": 2 },
  "Room 208": { "Block B": 3 },
  "Room 305": { "Block B": 4 },
  "Workshop 2": { "Lab 2": 2 }
};

// Approximate campus coordinates for demos.
// Used for "wandering" detection + centering map.
const LOCATION_COORDS = {
  Gate: { latitude: 17.4392, longitude: 78.3765 },
  "Block A": { latitude: 17.4399, longitude: 78.3776 },
  "Block B": { latitude: 17.4387, longitude: 78.3792 },
  "Room 101": { latitude: 17.4402, longitude: 78.3779 },
  "Lab 2": { latitude: 17.4396, longitude: 78.3786 },
  "Room 203": { latitude: 17.4389, longitude: 78.3791 },
  "Room 208": { latitude: 17.4384, longitude: 78.3797 },
  "Room 305": { latitude: 17.4378, longitude: 78.3802 },
  "Workshop 2": { latitude: 17.4389, longitude: 78.3781 }
};

// Geofence box for "inside campus" check.
const CAMPUS_BOUNDARY = {
  minLat: 17.4372,
  maxLat: 17.4412,
  minLng: 78.3760,
  maxLng: 78.3810
};

function distanceMeters(a, b) {
  // Haversine formula
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sin1 = Math.sin(dLat / 2);
  const sin2 = Math.sin(dLng / 2);
  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isInsideCampus(latitude, longitude) {
  return (
    latitude >= CAMPUS_BOUNDARY.minLat &&
    latitude <= CAMPUS_BOUNDARY.maxLat &&
    longitude >= CAMPUS_BOUNDARY.minLng &&
    longitude <= CAMPUS_BOUNDARY.maxLng
  );
}

function getGeoStatus(latestLocation, previousLocation) {
  if (!latestLocation) return "unknown";
  const inside = isInsideCampus(latestLocation.latitude, latestLocation.longitude);
  if (!inside) return "wandering";
  if (previousLocation) {
    const movedMeters = distanceMeters(
      { latitude: latestLocation.latitude, longitude: latestLocation.longitude },
      { latitude: previousLocation.latitude, longitude: previousLocation.longitude }
    );
    if (movedMeters > 8) return "moving";
  }
  return "inside";
}

function nearestCampusNode(latitude, longitude) {
  const point = { latitude: Number(latitude), longitude: Number(longitude) };
  if (Number.isNaN(point.latitude) || Number.isNaN(point.longitude)) return null;

  let bestNode = null;
  let bestDist = Infinity;
  for (const [node, coord] of Object.entries(LOCATION_COORDS)) {
    const d = distanceMeters(point, coord);
    if (d < bestDist) {
      bestDist = d;
      bestNode = node;
    }
  }
  return { node: bestNode, distance_m: bestDist };
}

function dijkstra(graph, start, end) {
  const nodes = Object.keys(graph);
  const distances = Object.fromEntries(nodes.map((n) => [n, Infinity]));
  const prev = Object.fromEntries(nodes.map((n) => [n, null]));
  const visited = new Set();
  distances[start] = 0;

  while (visited.size < nodes.length) {
    let curr = null;
    for (const node of nodes) {
      if (!visited.has(node) && (curr === null || distances[node] < distances[curr])) curr = node;
    }
    if (curr === null || distances[curr] === Infinity) break;
    visited.add(curr);
    for (const [neighbor, weight] of Object.entries(graph[curr])) {
      const alt = distances[curr] + weight;
      if (alt < distances[neighbor]) {
        distances[neighbor] = alt;
        prev[neighbor] = curr;
      }
    }
  }

  const path = [];
  let current = end;
  while (current) {
    path.unshift(current);
    current = prev[current];
  }
  if (path[0] !== start) return { distance: Infinity, path: [] };
  return { distance: distances[end], path };
}

function getCurrentClassForStaff(staffId) {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "long" });
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const nowTime = `${hh}:${mm}`;
  return db.prepare(`
    SELECT * FROM timetable
    WHERE staff_id = ? AND day = ? AND start_time <= ? AND end_time > ?
    ORDER BY start_time LIMIT 1
  `).get(staffId, day, nowTime, nowTime);
}

function getCurrentTimetableSlots() {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "long" });
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const nowTime = `${hh}:${mm}`;
  return db.prepare(`
    SELECT * FROM timetable
    WHERE day = ? AND start_time <= ? AND end_time > ?
  `).all(day, nowTime, nowTime);
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  return next();
}

function requirePrincipal(req, res, next) {
  if (req.user.role !== "principal") return res.status(403).json({ error: "Principal only" });
  return next();
}

function requireAdminOrPrincipal(req, res, next) {
  if (req.user.role !== "admin" && req.user.role !== "principal") {
    return res.status(403).json({ error: "Admin/Principal only" });
  }
  return next();
}

function saveStudentLocation(studentId, latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new Error("latitude and longitude are required");
  }

  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO student_locations (student_id, latitude, longitude, created_at)
    VALUES (?, ?, ?, ?)
  `).run(studentId, lat, lng, createdAt);

  const student = db.prepare(`
    SELECT id, roll_number, name, branch, section
    FROM students
    WHERE id = ?
  `).get(studentId);
  const latestTwo = db.prepare(`
    SELECT latitude, longitude, created_at
    FROM student_locations
    WHERE student_id = ?
    ORDER BY id DESC
    LIMIT 2
  `).all(studentId);
  const latest = latestTwo[0] || null;
  const previous = latestTwo[1] || null;
  const geo_status = getGeoStatus(latest, previous);

  const payload = {
    student_id: student.id,
    roll_number: student.roll_number,
    name: student.name,
    branch: student.branch,
    section: student.section,
    latitude: latest?.latitude ?? lat,
    longitude: latest?.longitude ?? lng,
    timestamp: latest?.created_at ?? createdAt,
    geo_status
  };

  io.emit("location:update", payload);
  return payload;
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "8h" });
  return res.json({ token, role: user.role, username: user.username });
});

app.post("/api/auth/student-login", (req, res) => {
  const roll_number = String(req.body.roll_number || "").trim().toUpperCase();
  const student = db.prepare("SELECT * FROM students WHERE upper(roll_number) = ?").get(roll_number);
  if (!student) return res.status(401).json({ error: "Invalid roll number" });
  const token = jwt.sign({ id: student.id, role: "student", roll_number: student.roll_number }, JWT_SECRET, { expiresIn: "8h" });
  return res.json({ token, role: "student", roll_number: student.roll_number, name: student.name });
});

app.get("/api/students", auth, (req, res) => {
  const { q = "", branch = "", section = "", roll_number = "" } = req.query;
  const rows = db.prepare(`
    SELECT * FROM students
    WHERE name LIKE ? AND branch LIKE ? AND section LIKE ? AND roll_number LIKE ?
    ORDER BY id DESC
  `).all(`%${q}%`, `%${branch}%`, `%${section}%`, `%${roll_number}%`);
  res.json(rows);
});

app.post("/api/students", auth, requireAdmin, (req, res) => {
  const { roll_number, name, branch, section, classroom, marks, attendance, absent_days, last_sem_marks, current_sem_marks } = req.body;
  const info = db.prepare(`
    INSERT INTO students (roll_number, name, branch, section, classroom, marks, attendance, absent_days, last_sem_marks, current_sem_marks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(roll_number || "").toUpperCase(),
    name,
    branch,
    section,
    classroom,
    Number(marks),
    Number(attendance),
    Number(absent_days || 0),
    Number(last_sem_marks || 0),
    Number(current_sem_marks || 0)
  );
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put("/api/students/:id", auth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { roll_number, name, branch, section, classroom, marks, attendance, absent_days, last_sem_marks, current_sem_marks } = req.body;
  db.prepare(`
    UPDATE students SET roll_number=?, name=?, branch=?, section=?, classroom=?, marks=?, attendance=?, absent_days=?, last_sem_marks=?, current_sem_marks=?
    WHERE id=?
  `).run(
    String(roll_number || "").toUpperCase(),
    name,
    branch,
    section,
    classroom,
    Number(marks),
    Number(attendance),
    Number(absent_days || 0),
    Number(last_sem_marks || 0),
    Number(current_sem_marks || 0),
    id
  );
  res.json({ success: true });
});

app.delete("/api/students/:id", auth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM students WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

app.get("/api/staff", auth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM staff ORDER BY id DESC").all());
});

app.post("/api/staff", auth, requireAdmin, (req, res) => {
  const { name, subject, assigned_classes } = req.body;
  const info = db.prepare("INSERT INTO staff (name, subject, assigned_classes) VALUES (?, ?, ?)")
    .run(name, subject, assigned_classes);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put("/api/staff/:id", auth, requireAdmin, (req, res) => {
  const { name, subject, assigned_classes } = req.body;
  db.prepare("UPDATE staff SET name=?, subject=?, assigned_classes=? WHERE id=?")
    .run(name, subject, assigned_classes, req.params.id);
  res.json({ success: true });
});

app.delete("/api/staff/:id", auth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM staff WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

app.get("/api/timetable", auth, (_req, res) => {
  const rows = db.prepare(`
    SELECT t.*, s.name as staff_name FROM timetable t
    JOIN staff s ON t.staff_id = s.id
    ORDER BY t.day, t.start_time
  `).all();
  res.json(rows);
});

app.post("/api/timetable", auth, requireAdmin, (req, res) => {
  const { staff_id, day, start_time, end_time, subject, class_name, classroom } = req.body;
  const info = db.prepare(`
    INSERT INTO timetable (staff_id, day, start_time, end_time, subject, class_name, classroom)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(staff_id, day, start_time, end_time, subject, class_name, classroom);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.get("/api/live/staff-status", auth, (_req, res) => {
  const staffRows = db.prepare("SELECT * FROM staff").all();
  const statuses = staffRows.map((s) => {
    const current = getCurrentClassForStaff(s.id);
    return {
      staff_id: s.id,
      staff_name: s.name,
      status: current
        ? `${s.name} is teaching ${current.subject} to ${current.class_name} in ${current.classroom}`
        : `${s.name} is currently free`,
      subject: current?.subject || "-",
      class_name: current?.class_name || "-",
      classroom: current?.classroom || "-"
    };
  });
  res.json(statuses);
});

app.get("/api/live/student-locations", auth, (req, res) => {
  let students = [];
  if (req.user.role === "student") {
    students = db.prepare("SELECT * FROM students WHERE id = ?").all(req.user.id);
  } else {
    students = db.prepare("SELECT * FROM students ORDER BY name").all();
  }
  const currentSlots = getCurrentTimetableSlots();
  const slotMap = new Map(
    currentSlots.map((slot) => [String(slot.class_name).trim().toUpperCase(), slot])
  );

  const result = students.map((s) => {
    const classKey = `${s.branch}-${s.section}`.trim().toUpperCase();
    const liveSlot = slotMap.get(classKey);
    const latestTwo = db.prepare(`
      SELECT latitude, longitude, created_at
      FROM student_locations
      WHERE student_id = ?
      ORDER BY id DESC LIMIT 2
    `).all(s.id);
    const latestLocation = latestTwo[0] || null;
    const previousLocation = latestTwo[1] || null;
    const geoStatus = getGeoStatus(latestLocation, previousLocation);

    const assignedCoords = LOCATION_COORDS[s.classroom];
    const wanderingDistance =
      latestLocation && assignedCoords ? distanceMeters({ latitude: latestLocation.latitude, longitude: latestLocation.longitude }, assignedCoords) : null;
    const isWandering = geoStatus === "wandering";

    return {
      student_id: s.id,
      roll_number: s.roll_number,
      name: s.name,
      branch: s.branch,
      section: s.section,
      classroom: liveSlot ? liveSlot.classroom : s.classroom,
      subject: liveSlot ? liveSlot.subject : "No active class",
      source: liveSlot ? "timetable-live" : "default-profile",
      latitude: latestLocation?.latitude || null,
      longitude: latestLocation?.longitude || null,
      updated_at: latestLocation?.created_at || null,
      assigned_classroom: s.classroom,
      is_wandering: isWandering,
      geo_status: geoStatus,
      distance_to_assigned_m: wanderingDistance !== null ? Number(wanderingDistance.toFixed(1)) : null
    };
  });

  res.json(result);
});

app.get("/api/live/student-location-history", auth, (req, res) => {
  const limit = Math.max(10, Math.min(300, Number(req.query.limit || 100)));

  let studentId = null;
  if (req.user.role === "student") {
    studentId = req.user.id;
  } else {
    if (req.query.student_id) {
      studentId = Number(req.query.student_id);
    } else if (req.query.roll_number) {
      const roll = String(req.query.roll_number || "").trim().toUpperCase();
      const s = db.prepare("SELECT id FROM students WHERE upper(roll_number) = ?").get(roll);
      studentId = s ? s.id : null;
    }
  }

  if (!studentId) return res.status(400).json({ error: "student_id or roll_number is required" });

  const rows = db.prepare(`
    SELECT latitude, longitude, created_at
    FROM student_locations
    WHERE student_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(studentId, limit).reverse();

  return res.json(rows);
});

app.post("/api/location/update", auth, (req, res) => {
  try {
    const { student_id, roll_number, latitude, longitude } = req.body;
    let studentId = null;

    if (req.user.role === "student") {
      studentId = req.user.id;
    } else if (student_id) {
      studentId = Number(student_id);
    } else if (roll_number) {
      const s = db.prepare("SELECT id FROM students WHERE upper(roll_number) = ?")
        .get(String(roll_number).trim().toUpperCase());
      studentId = s?.id || null;
    }

    if (!studentId) return res.status(400).json({ error: "student_id or roll_number is required" });
    const payload = saveStudentLocation(studentId, latitude, longitude);
    return res.json({ success: true, ...payload });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Invalid location payload" });
  }
});

app.post("/api/live/student-location", auth, (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ error: "Student only" });
  try {
    const { latitude, longitude } = req.body;
    const payload = saveStudentLocation(req.user.id, latitude, longitude);
    return res.json({ success: true, ...payload });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Invalid location payload" });
  }
});

app.get("/api/student/me", auth, (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ error: "Student only" });
  const student = db.prepare("SELECT * FROM students WHERE id = ?").get(req.user.id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  return res.json(student);
});

app.get("/api/principal/student/:rollNumber", auth, requirePrincipal, (req, res) => {
  const roll = String(req.params.rollNumber || "").trim().toUpperCase();
  const student = db.prepare("SELECT * FROM students WHERE upper(roll_number) = ?").get(roll);
  if (!student) return res.status(404).json({ error: "Student not found" });

  const latestLocation = db.prepare(`
    SELECT latitude, longitude, created_at
    FROM student_locations
    WHERE student_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(student.id);

  const semComparison = [
    { semester: "Last Sem", marks: student.last_sem_marks || 0 },
    { semester: "Current Sem", marks: student.current_sem_marks || student.marks || 0 }
  ];

  return res.json({
    student,
    latestLocation: latestLocation || null,
    semComparison
  });
});

app.get("/api/analytics", auth, (_req, res) => {
  const students = db.prepare("SELECT * FROM students").all();
  const lowAttendance = students.filter((s) => s.attendance < 75);
  const topPerformers = [...students].sort((a, b) => b.marks - a.marks).slice(0, 5);
  const branchAvg = db.prepare(`
    SELECT branch, ROUND(AVG(marks), 2) as avg_marks, ROUND(AVG(attendance), 2) as avg_attendance
    FROM students GROUP BY branch
  `).all();
  const predictions = students.map((s) => {
    let risk = "Good";
    if (s.marks < 70 || s.attendance < 75) risk = "At Risk";
    else if (s.marks < 80 || s.attendance < 85) risk = "Average";
    return { id: s.id, name: s.name, risk };
  });
  res.json({ lowAttendance, topPerformers, branchAvg, predictions });
});

app.get("/api/navigation/path", auth, (req, res) => {
  const from = req.query.from || "Gate";
  const to = req.query.to;
  if (!to) return res.status(400).json({ error: "to is required" });
  if (!CAMPUS_GRAPH[from] || !CAMPUS_GRAPH[to]) return res.status(400).json({ error: "Unknown location" });
  return res.json(dijkstra(CAMPUS_GRAPH, from, to));
});

app.get("/api/navigation/path/fromCoords", auth, requireAdminOrPrincipal, (req, res) => {
  const fromLat = Number(req.query.fromLat);
  const fromLng = Number(req.query.fromLng);
  const toLat = Number(req.query.toLat);
  const toLng = Number(req.query.toLng);

  if ([fromLat, fromLng, toLat, toLng].some((n) => Number.isNaN(n))) {
    return res.status(400).json({ error: "fromLat/fromLng/toLat/toLng are required numbers" });
  }

  const fromNearest = nearestCampusNode(fromLat, fromLng);
  const toNearest = nearestCampusNode(toLat, toLng);
  if (!fromNearest?.node || !toNearest?.node) return res.status(400).json({ error: "Could not map coordinates to campus nodes" });

  const result = dijkstra(CAMPUS_GRAPH, fromNearest.node, toNearest.node);

  const coords = result.path.map((n) => LOCATION_COORDS[n]).filter(Boolean);
  return res.json({
    fromNearest,
    toNearest,
    distance: result.distance,
    path: result.path,
    coordinates: coords
  });
});

io.on("connection", (socket) => {
  socket.emit("socket:connected", { ok: true, at: new Date().toISOString() });
});

httpServer.listen(PORT, () => {
  console.log(`Smart College API running on http://localhost:${PORT}`);
});
