import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import LiveMap from "./LiveMap.jsx";
import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";
const COLORS = ["#2563eb", "#16a34a", "#dc2626"];

const api = axios.create({ baseURL: API_BASE });

function statusMeta(status) {
  if (status === "wandering") return { label: "Wandering", color: "#dc2626" };
  if (status === "moving") return { label: "Moving", color: "#eab308" };
  return { label: "Inside Campus", color: "#16a34a" };
}

function App() {
  const [auth, setAuth] = useState(() => JSON.parse(localStorage.getItem("auth") || "null"));
  const [loginError, setLoginError] = useState("");
  const [loginRole, setLoginRole] = useState("admin");
  const [loginForm, setLoginForm] = useState({ username: "", password: "", roll_number: "" });
  const [tab, setTab] = useState("students");
  const [students, setStudents] = useState([]);
  const [staff, setStaff] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [live, setLive] = useState([]);
  const [liveStudents, setLiveStudents] = useState([]);
  const [studentMe, setStudentMe] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [manualLocation, setManualLocation] = useState({ latitude: "", longitude: "" });
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [selectedHistory, setSelectedHistory] = useState([]);
  const [principalLocation, setPrincipalLocation] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [catchMeta, setCatchMeta] = useState(null);
  const [catchError, setCatchError] = useState("");
  const watchIdRef = useRef(null);
  const [principalManual, setPrincipalManual] = useState({ latitude: "", longitude: "" });
  const socketRef = useRef(null);
  const [principalRoll, setPrincipalRoll] = useState("");
  const [principalStudentView, setPrincipalStudentView] = useState(null);
  const [analytics, setAnalytics] = useState({ lowAttendance: [], topPerformers: [], branchAvg: [], predictions: [] });
  const [path, setPath] = useState({ distance: 0, path: [] });
  const [filters, setFilters] = useState({ q: "", branch: "", section: "", roll_number: "" });
  const [studentForm, setStudentForm] = useState({ roll_number: "", name: "", branch: "", section: "", classroom: "", marks: 0, attendance: 0, absent_days: 0, last_sem_marks: 0, current_sem_marks: 0 });
  const [staffForm, setStaffForm] = useState({ name: "", subject: "", assigned_classes: "" });
  const [ttForm, setTtForm] = useState({ staff_id: "", day: "Monday", start_time: "09:00", end_time: "10:00", subject: "", class_name: "", classroom: "" });
  const [selectedTo, setSelectedTo] = useState("Room 101");

  useEffect(() => {
    if (!auth?.token) return;
    api.defaults.headers.common.Authorization = `Bearer ${auth.token}`;
    if (auth.role === "student") {
      loadStudentMe();
    } else {
      loadAll();
    }
    const id = setInterval(() => {
      if (auth.role === "student") loadStudentMe();
      else {
        loadLive();
        loadLiveStudents();
      }
    }, 60000);
    return () => clearInterval(id);
  }, [auth?.token, auth?.role]);

  useEffect(() => {
    if (!auth?.token) return;
    if (auth.role === "student") return;
    function onSelect(e) {
      const id = e?.detail?.studentId;
      if (!id) return;
      setSelectedStudentId(id);
      loadSelectedHistory(id);
      setCatchError("");
      setCatchMeta(null);
      setPrincipalLocation(null);
      setRouteCoordinates([]);
    }
    window.addEventListener("smartcollege:onSelectStudent", onSelect);
    window.addEventListener("smartcollege:selectStudent", onSelect);
    return () => {
      window.removeEventListener("smartcollege:onSelectStudent", onSelect);
      window.removeEventListener("smartcollege:selectStudent", onSelect);
    };
  }, [auth?.token, auth?.role]);

  useEffect(() => {
    if (!auth?.token) return;
    if (auth.role === "student") return;
    if (tab !== "live") return;
    // Real-time map polling: latest positions every ~3s, history every ~5-6s.
    let historyCooldownUntil = 0;
    const interval = setInterval(async () => {
      try {
        await loadLiveStudents();
        if (selectedStudentId && Date.now() >= historyCooldownUntil) {
          historyCooldownUntil = Date.now() + 5500;
          await loadSelectedHistory(selectedStudentId);
        }
      } catch (_e) {
        // Ignore transient network errors in polling.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [auth?.token, auth?.role, tab, selectedStudentId]);

  useEffect(() => {
    if (!auth?.token) return;
    if (auth.role === "student") return;
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;

    socket.on("location:update", async (payload) => {
      setLiveStudents((prev) => {
        const idx = prev.findIndex((s) => s.student_id === payload.student_id);
        if (idx === -1) return prev;
        const updated = [...prev];
        const prevItem = updated[idx];
        updated[idx] = {
          ...prevItem,
          latitude: payload.latitude,
          longitude: payload.longitude,
          updated_at: payload.timestamp,
          geo_status: payload.geo_status,
          is_wandering: payload.geo_status === "wandering"
        };
        return updated;
      });

      if (selectedStudentId === payload.student_id) {
        await loadSelectedHistory(payload.student_id);
      }
    });

    socket.on("connect_error", (e) => {
      console.error("Socket connection error:", e.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [auth?.token, auth?.role, selectedStudentId]);

  const filteredStudents = useMemo(() => students, [students]);

  async function loadAll() {
    await Promise.all([loadStudents(), loadStaff(), loadTimetable(), loadLive(), loadLiveStudents(), loadAnalytics()]);
  }
  async function loadStudents() {
    const r = await api.get("/students", { params: filters });
    setStudents(r.data);
  }
  async function loadStaff() {
    const r = await api.get("/staff");
    setStaff(r.data);
  }
  async function loadTimetable() {
    const r = await api.get("/timetable");
    setTimetable(r.data);
  }
  async function loadLive() {
    const r = await api.get("/live/staff-status");
    setLive(r.data);
  }
  async function loadLiveStudents() {
    const r = await api.get("/live/student-locations");
    setLiveStudents(r.data);
  }
  async function loadSelectedHistory(studentId) {
    if (!studentId) {
      setSelectedHistory([]);
      return;
    }
    const r = await api.get("/live/student-location-history", {
      params: { student_id: studentId, limit: 120 }
    });
    setSelectedHistory(r.data);
  }
  async function loadAnalytics() {
    const r = await api.get("/analytics");
    setAnalytics(r.data);
  }
  async function doLogin(e) {
    e.preventDefault();
    try {
      let r;
      if (loginRole === "student") {
        r = await api.post("/auth/student-login", {
          roll_number: String(loginForm.roll_number || "").trim().toUpperCase()
        });
      } else {
        const body = {
          username: String(loginForm.username || "").trim().toLowerCase(),
          password: String(loginForm.password || "")
        };
        r = await api.post("/auth/login", body);
      }
      setLoginError("");
      setAuth(r.data);
      localStorage.setItem("auth", JSON.stringify(r.data));
    } catch (err) {
      setLoginError(err.response?.data?.error || "Login failed. Check username/password.");
    }
  }
  function logout() {
    localStorage.removeItem("auth");
    setPrincipalStudentView(null);
    setStudentMe(null);
    setPrincipalLocation(null);
    setRouteCoordinates([]);
    setCatchMeta(null);
    setCatchError("");
    setAuth(null);
  }
  async function loadStudentMe() {
    const r = await api.get("/student/me");
    setStudentMe(r.data);
  }
  async function sendStudentLocation() {
    if (!navigator.geolocation) {
      setLoginError("Geolocation is not supported in this browser.");
      return;
    }
    setLocationDenied(false);

    const startWatch = async (enableHighAccuracy) => {
      if (watchIdRef.current) {
        try {
          navigator.geolocation.clearWatch(watchIdRef.current);
        } catch (_e) {}
        watchIdRef.current = null;
      }

      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          try {
            await api.post("/location/update", {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude
            });
          } catch (_e) {
            // avoid noisy UI errors for periodic updates
          }
        },
        (err) => {
          // 1 = Permission denied, 2 = Position unavailable, 3 = Timeout
          if (err?.code === 1) {
            setLocationDenied(true);
            setLoginError("Location permission denied. Enable it in browser Site Settings or use manual location update below.");
            return;
          }
          if (err?.code === 2 && enableHighAccuracy) {
            // Retry once with less strict accuracy (often fixes "network service" failures).
            startWatch(false);
            return;
          }
          setLocationDenied(true);
          setLoginError(
            err?.message
              ? `Failed to query location: ${err.message}. Use manual latitude/longitude below.`
              : "Failed to get location. Use manual latitude/longitude below."
          );
        },
        { enableHighAccuracy, maximumAge: 10000, timeout: 20000 }
      );
    };

    startWatch(true);
  }
  async function sendManualLocation() {
    const latitude = Number(manualLocation.latitude);
    const longitude = Number(manualLocation.longitude);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setLoginError("Enter valid latitude and longitude values.");
      return;
    }
    await api.post("/location/update", { latitude, longitude });
    setLoginError("");
  }
  async function saveStudent(e) {
    e.preventDefault();
    await api.post("/students", studentForm);
    setStudentForm({ roll_number: "", name: "", branch: "", section: "", classroom: "", marks: 0, attendance: 0, absent_days: 0, last_sem_marks: 0, current_sem_marks: 0 });
    loadStudents();
  }
  async function updateStudent(s) {
    const marks = Number(prompt("Update marks", s.marks) || s.marks);
    const attendance = Number(prompt("Update attendance", s.attendance) || s.attendance);
    await api.put(`/students/${s.id}`, { ...s, marks, attendance });
    loadStudents();
  }
  async function removeStudent(id) {
    await api.delete(`/students/${id}`);
    loadStudents();
  }
  async function saveStaff(e) {
    e.preventDefault();
    await api.post("/staff", staffForm);
    setStaffForm({ name: "", subject: "", assigned_classes: "" });
    loadStaff();
  }
  async function removeStaff(id) {
    await api.delete(`/staff/${id}`);
    loadStaff();
  }
  async function saveTimetable(e) {
    e.preventDefault();
    await api.post("/timetable", ttForm);
    setTtForm({ staff_id: "", day: "Monday", start_time: "09:00", end_time: "10:00", subject: "", class_name: "", classroom: "" });
    loadTimetable();
  }
  async function getPath() {
    const r = await api.get("/navigation/path", { params: { from: "Gate", to: selectedTo } });
    setPath(r.data);
  }
  async function loadPrincipalStudent() {
    if (!principalRoll.trim()) return;
    const r = await api.get(`/principal/student/${encodeURIComponent(principalRoll.trim())}`);
    setPrincipalStudentView(r.data);
  }
  async function trackPrincipalStudentOnMap(studentId) {
    setSelectedStudentId(studentId);
    setTab("live");
    await loadLiveStudents();
    await loadSelectedHistory(studentId);
    setCatchError("");
    setCatchMeta(null);
    setRouteCoordinates([]);
  }

  async function catchStudent() {
    setCatchError("");
    setCatchMeta(null);
    setRouteCoordinates([]);
    setPrincipalManual({ latitude: "", longitude: "" });

    const student = liveStudents.find((x) => x.student_id === selectedStudentId);
    if (!student) {
      setCatchError("Select a student first.");
      return;
    }
    if (typeof student.latitude !== "number" || typeof student.longitude !== "number") {
      setCatchError("Selected student has no live coordinates yet.");
      return;
    }

    if (!navigator.geolocation) {
      setCatchError("Geolocation is not supported in this browser.");
      return;
    }

    const getOnce = (enableHighAccuracy) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const fromLat = pos.coords.latitude;
            const fromLng = pos.coords.longitude;
            setPrincipalLocation({ latitude: fromLat, longitude: fromLng });

            const r = await api.get("/navigation/path/fromCoords", {
              params: { fromLat, fromLng, toLat: student.latitude, toLng: student.longitude }
            });

            setCatchMeta(r.data);
            setRouteCoordinates(r.data.coordinates || []);
          } catch (e) {
            setCatchError(e.response?.data?.error || "Failed to compute shortest path.");
          }
        },
        (err) => {
          // 1 permission denied, 2 position unavailable, 3 timeout
          if ((err?.code === 2 || err?.code === 3) && enableHighAccuracy) {
            // Retry with less strict accuracy (often fixes network service failures).
            getOnce(false);
            return;
          }
          setCatchError(
            err?.message ||
              "Failed to get principal location. Please enter manual latitude/longitude."
          );
          setPrincipalLocation(null);
          setRouteCoordinates([]);
        },
        { enableHighAccuracy, timeout: 20000, maximumAge: 10000 }
      );
    };

    getOnce(true);
  }

  async function catchStudentWithManual() {
    setCatchError("");
    setCatchMeta(null);
    setRouteCoordinates([]);

    const fromLat = Number(principalManual.latitude);
    const fromLng = Number(principalManual.longitude);
    const student = liveStudents.find((x) => x.student_id === selectedStudentId);
    if (!student) {
      setCatchError("Select a student first.");
      return;
    }
    if (!student.latitude || !student.longitude) {
      setCatchError("Selected student has no live coordinates yet.");
      return;
    }
    if (Number.isNaN(fromLat) || Number.isNaN(fromLng)) {
      setCatchError("Enter valid principal latitude and longitude.");
      return;
    }

    setPrincipalLocation({ latitude: fromLat, longitude: fromLng });
    try {
      const r = await api.get("/navigation/path/fromCoords", {
        params: { fromLat, fromLng, toLat: student.latitude, toLng: student.longitude }
      });
      setCatchMeta(r.data);
      setRouteCoordinates(r.data.coordinates || []);
    } catch (e) {
      setCatchError(e.response?.data?.error || "Failed to compute shortest path.");
    }
  }

  if (!auth) {
    return (
      <div className="loginPage">
        <form className="card login loginCard" onSubmit={doLogin}>
          <h2>Smart College Monitoring & Navigation System</h2>
          <select value={loginRole} onChange={(e) => setLoginRole(e.target.value)}>
            <option value="admin">Admin Login</option>
            <option value="principal">Principal Login</option>
            <option value="student">Student Login</option>
          </select>
          {loginRole === "student" ? (
            <input
              name="roll_number"
              placeholder="Roll Number (example CSE001)"
              value={loginForm.roll_number}
              onChange={(e) => setLoginForm({ ...loginForm, roll_number: e.target.value })}
              required
            />
          ) : (
            <>
              <input
                name="username"
                placeholder="Username"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                required
              />
              <input
                name="password"
                placeholder="Password"
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </>
          )}
          <div className="row">
            <button
              type="button"
              onClick={() => setLoginForm({ username: "admin", password: "admin123" })}
            >
              Use Admin Demo
            </button>
            <button
              type="button"
              onClick={() => setLoginForm({ username: "principal", password: "principal123" })}
            >
              Use Principal Demo
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginRole("student");
                setLoginForm({ ...loginForm, roll_number: "STD001" });
              }}
            >
              Use Student Demo
            </button>
          </div>
          <button type="submit">Login</button>
          <p>Demo: admin/admin123, principal/principal123, student roll: STD001</p>
          {loginError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loginError}</p>}
        </form>
      </div>
    );
  }

  if (auth.role === "student") {
    return (
      <div className="center">
        <section className="card login">
          <h2>Student Dashboard</h2>
          <p>Welcome, {auth.name} ({auth.roll_number})</p>
          <button onClick={sendStudentLocation}>Enable Live Location Tracking</button>
          {locationDenied && (
            <>
              <p style={{ color: "#b45309" }}>
                Permission denied. In browser, open site settings for localhost and allow Location.
              </p>
              <div className="row">
                <input
                  placeholder="Latitude"
                  value={manualLocation.latitude}
                  onChange={(e) => setManualLocation({ ...manualLocation, latitude: e.target.value })}
                />
                <input
                  placeholder="Longitude"
                  value={manualLocation.longitude}
                  onChange={(e) => setManualLocation({ ...manualLocation, longitude: e.target.value })}
                />
                <button onClick={sendManualLocation}>Send Manual Location</button>
              </div>
            </>
          )}
          {studentMe && (
            <>
              <p>Marks: {studentMe.marks}</p>
              <p>Attendance: {studentMe.attendance}%</p>
              <p>Absent Days: {studentMe.absent_days}</p>
              <p>Classroom: {studentMe.classroom}</p>
            </>
          )}
          <button onClick={logout}>Logout</button>
          {loginError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loginError}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h3>Smart College</h3>
        <p>{auth.username} ({auth.role})</p>
        {["students", "staff", "timetable", "live", "analytics", "navigation"].map((t) => (
          <button key={t} onClick={() => setTab(t)}>{t}</button>
        ))}
        <button onClick={logout}>Logout</button>
      </aside>
      <main className="content">
        {tab === "students" && (
          <section className="card">
            <h2>Student Management</h2>
            <div className="row">
              <input placeholder="Roll Number" value={filters.roll_number} onChange={(e) => setFilters({ ...filters, roll_number: e.target.value })} />
              <input placeholder="Search name" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
              <input placeholder="Branch" value={filters.branch} onChange={(e) => setFilters({ ...filters, branch: e.target.value })} />
              <input placeholder="Section" value={filters.section} onChange={(e) => setFilters({ ...filters, section: e.target.value })} />
              <button onClick={loadStudents}>Filter</button>
            </div>
            {auth.role === "principal" && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h3>Find Student by Roll Number</h3>
                <div className="row">
                  <input placeholder="Enter roll number" value={principalRoll} onChange={(e) => setPrincipalRoll(e.target.value)} />
                  <button onClick={loadPrincipalStudent}>Search</button>
                </div>
                {principalStudentView && (
                  <>
                    <p>{principalStudentView.student.name} ({principalStudentView.student.roll_number}) - {principalStudentView.student.branch}-{principalStudentView.student.section}</p>
                    <p>Attendance: {principalStudentView.student.attendance}% | Marks: {principalStudentView.student.marks}</p>
                    <p>
                      Live Location: {principalStudentView.latestLocation
                        ? `${principalStudentView.latestLocation.latitude}, ${principalStudentView.latestLocation.longitude}`
                        : "No recent location"}
                    </p>
                    <div className="row">
                      <button
                        onClick={() => trackPrincipalStudentOnMap(principalStudentView.student.id)}
                        type="button"
                      >
                        Track on Google Maps
                      </button>
                    </div>
                    <div className="chart">
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={principalStudentView.semComparison}>
                          <XAxis dataKey="semester" />
                          <YAxis />
                          <Tooltip />
                          <Line type="monotone" dataKey="marks" stroke="#2563eb" strokeWidth={3} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </div>
            )}
            {auth.role === "admin" && (
              <form onSubmit={saveStudent} className="grid">
                {Object.keys(studentForm).map((k) => (
                  <input key={k} placeholder={k} value={studentForm[k]} onChange={(e) => setStudentForm({ ...studentForm, [k]: e.target.value })} required />
                ))}
                <button type="submit">Add Student</button>
              </form>
            )}
            <table>
              <thead><tr><th>Roll No</th><th>Name</th><th>Branch</th><th>Section</th><th>Classroom</th><th>Marks</th><th>Attendance %</th><th>Absent Days</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredStudents.map((s) => (
                  <tr key={s.id}>
                    <td>{s.roll_number}</td><td>{s.name}</td><td>{s.branch}</td><td>{s.section}</td><td>{s.classroom}</td><td>{s.marks}</td><td>{s.attendance}</td><td>{s.absent_days}</td>
                    <td>{auth.role === "admin" ? <><button onClick={() => updateStudent(s)}>Edit</button><button onClick={() => removeStudent(s.id)}>Delete</button></> : "View"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {tab === "staff" && (
          <section className="card">
            <h2>Staff Management</h2>
            {auth.role === "admin" && (
              <form onSubmit={saveStaff} className="grid">
                <input placeholder="Staff Name" value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} required />
                <input placeholder="Subject" value={staffForm.subject} onChange={(e) => setStaffForm({ ...staffForm, subject: e.target.value })} required />
                <input placeholder="Assigned Classes" value={staffForm.assigned_classes} onChange={(e) => setStaffForm({ ...staffForm, assigned_classes: e.target.value })} required />
                <button type="submit">Add Staff</button>
              </form>
            )}
            {staff.map((s) => <div key={s.id} className="row"><span>{s.name} - {s.subject} ({s.assigned_classes})</span>{auth.role === "admin" && <button onClick={() => removeStaff(s.id)}>Delete</button>}</div>)}
          </section>
        )}
        {tab === "timetable" && (
          <section className="card">
            <h2>Timetable</h2>
            {auth.role === "admin" && (
              <form onSubmit={saveTimetable} className="grid">
                <select value={ttForm.staff_id} onChange={(e) => setTtForm({ ...ttForm, staff_id: e.target.value })} required>
                  <option value="">Select staff</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input placeholder="Day" value={ttForm.day} onChange={(e) => setTtForm({ ...ttForm, day: e.target.value })} required />
                <input type="time" value={ttForm.start_time} onChange={(e) => setTtForm({ ...ttForm, start_time: e.target.value })} required />
                <input type="time" value={ttForm.end_time} onChange={(e) => setTtForm({ ...ttForm, end_time: e.target.value })} required />
                <input placeholder="Subject" value={ttForm.subject} onChange={(e) => setTtForm({ ...ttForm, subject: e.target.value })} required />
                <input placeholder="Class" value={ttForm.class_name} onChange={(e) => setTtForm({ ...ttForm, class_name: e.target.value })} required />
                <input placeholder="Classroom" value={ttForm.classroom} onChange={(e) => setTtForm({ ...ttForm, classroom: e.target.value })} required />
                <button type="submit">Add Timetable Slot</button>
              </form>
            )}
            {timetable.map((t) => <div key={t.id}>{t.day} {t.start_time}-{t.end_time}: {t.staff_name} teaches {t.subject} to {t.class_name} in {t.classroom}</div>)}
          </section>
        )}
        {tab === "live" && (
          <section className="card">
            <h2>Live Staff Status</h2>
            {live.map((l) => <p key={l.staff_id}>{l.status}</p>)}

            <div className="liveGrid">
              <div className="card">
                <h3>Google Maps Live Tracking</h3>
                <LiveMap
                  apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                  students={liveStudents}
                  selectedStudentId={selectedStudentId}
                  history={selectedHistory}
                  principalLocation={principalLocation}
                  routeCoordinates={routeCoordinates}
                  heightPx={520}
                />
                <div className="row" style={{ marginTop: 10 }}>
                  <button type="button" onClick={catchStudent} disabled={!selectedStudentId}>
                    Catch (Shortest Path)
                  </button>
                </div>
                {catchError && <p style={{ color: "#dc2626", marginTop: 8, fontWeight: 700 }}>{catchError}</p>}
                {catchError && (
                  <div className="row" style={{ marginTop: 10 }}>
                    <input
                      placeholder="Principal Latitude (manual)"
                      value={principalManual.latitude}
                      onChange={(e) => setPrincipalManual({ ...principalManual, latitude: e.target.value })}
                    />
                    <input
                      placeholder="Principal Longitude (manual)"
                      value={principalManual.longitude}
                      onChange={(e) => setPrincipalManual({ ...principalManual, longitude: e.target.value })}
                    />
                    <button type="button" onClick={catchStudentWithManual}>
                      Compute with Manual
                    </button>
                  </div>
                )}
                {catchMeta && (
                  <p style={{ marginTop: 8 }}>
                    Route: <b>{catchMeta.fromNearest?.node}</b> to <b>{catchMeta.toNearest?.node}</b> | Distance:{" "}
                    <b>{catchMeta.distance}</b>
                    m
                  </p>
                )}
                {selectedStudentId && (
                  <p style={{ marginTop: 10 }}>
                    Tracking: <b>{liveStudents.find((x) => x.student_id === selectedStudentId)?.name || ""}</b>{" "}
                    <span
                      style={{
                        color: statusMeta(liveStudents.find((x) => x.student_id === selectedStudentId)?.geo_status).color,
                        fontWeight: 700
                      }}
                    >
                      {statusMeta(liveStudents.find((x) => x.student_id === selectedStudentId)?.geo_status).label}
                    </span>
                    {liveStudents.find((x) => x.student_id === selectedStudentId)?.updated_at ? (
                      <span style={{ display: "block", fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        Last GPS:{" "}
                        {String(liveStudents.find((x) => x.student_id === selectedStudentId)?.updated_at || "")
                          .replace("T", " ")
                          .replace("Z", "")}
                      </span>
                    ) : null}
                  </p>
                )}
              </div>

              <div className="card">
                <h3>Live Students (click to track)</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Roll</th>
                      <th>Name</th>
                      <th>Branch</th>
                      <th>Section</th>
                      <th>Latest</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveStudents.map((s) => (
                      <tr key={s.student_id}>
                        <td>{s.roll_number}</td>
                        <td>{s.name}</td>
                        <td>{s.branch}</td>
                        <td>{s.section}</td>
                        <td>
                          {s.latitude && s.longitude ? (
                            <span>
                              <span style={{ color: statusMeta(s.geo_status).color, fontWeight: 700 }}>
                                {statusMeta(s.geo_status).label}
                              </span>
                              {s.updated_at ? (
                                <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>
                                  {String(s.updated_at).replace("T", " ").replace("Z", "")}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            "No location"
                          )}
                        </td>
                        <td>
                          <button
                            onClick={async () => {
                              setSelectedStudentId(s.student_id);
                              await loadSelectedHistory(s.student_id);
                              setCatchError("");
                              setCatchMeta(null);
                              setPrincipalLocation(null);
                              setRouteCoordinates([]);
                            }}
                          >
                            Track
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
        {tab === "analytics" && (
          <section className="card">
            <h2>Analytics</h2>
            <div className="charts">
              <div className="chart">
                <h4>Branch Average Marks</h4>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={analytics.branchAvg}>
                    <XAxis dataKey="branch" /><YAxis /><Tooltip /><Bar dataKey="avg_marks" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="chart">
                <h4>Risk Distribution</h4>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={["Good", "Average", "At Risk"].map((k) => ({ name: k, value: analytics.predictions.filter((x) => x.risk === k).length }))} dataKey="value" nameKey="name">
                      {COLORS.map((c) => <Cell key={c} fill={c} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <h4>Low attendance students (&lt;75%)</h4>
            {analytics.lowAttendance.map((s) => <p key={s.id}>{s.name} ({s.attendance}%)</p>)}
          </section>
        )}
        {tab === "navigation" && (
          <section className="card">
            <h2>Campus Navigation (Dijkstra)</h2>
            <div className="row">
              <select value={selectedTo} onChange={(e) => setSelectedTo(e.target.value)}>
                {["Room 101", "Lab 2", "Room 203", "Room 208", "Room 305", "Workshop 2"].map((r) => <option key={r}>{r}</option>)}
              </select>
              <button onClick={getPath}>Find Shortest Path from Gate</button>
            </div>
            {path.path.length > 0 && <p>Path: {path.path.join(" -> ")} | Distance: {path.distance}</p>}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
