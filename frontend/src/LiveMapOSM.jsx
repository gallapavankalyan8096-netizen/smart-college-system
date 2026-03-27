import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function toLatLng(p) {
  return { lat: Number(p.latitude), lng: Number(p.longitude) };
}

function isValidLatLng(p) {
  return (
    p &&
    typeof p.latitude === "number" &&
    typeof p.longitude === "number" &&
    !Number.isNaN(p.latitude) &&
    !Number.isNaN(p.longitude)
  );
}

function statusColor(status) {
  if (status === "wandering") return "#dc2626"; // red
  if (status === "moving") return "#eab308"; // yellow
  return "#16a34a"; // green (inside)
}

export default function LiveMapOSM({
  students,
  selectedStudentId,
  history,
  principalLocation,
  routeCoordinates,
  heightPx = 520
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // student_id -> { marker, lastPos }
  const polylineRef = useRef(null);
  const principalMarkerRef = useRef(null);
  const routePolylineRef = useRef(null);
  const [status, setStatus] = useState("loading");

  const selected = useMemo(
    () => students.find((s) => s.student_id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

  useEffect(() => {
    let cancelled = false;
    try {
      if (!containerRef.current) return;
      const initialCenter = selected ? toLatLng(selected) : { lat: 17.4395, lng: 78.3785 };
      mapRef.current = L.map(containerRef.current, { zoomControl: false }).setView([initialCenter.lat, initialCenter.lng], 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(mapRef.current);

      polylineRef.current = L.polyline([], { color: "#2563eb", weight: 4, opacity: 0.9 }).addTo(mapRef.current);

      // Polyline for "Catch" shortest path.
      routePolylineRef.current = L.polyline([], { color: "#f59e0b", weight: 4, opacity: 0.9 }).addTo(mapRef.current);
      setStatus("ready");
    } catch (e) {
      if (cancelled) return;
      console.error(e);
      setStatus("error");
    }

    return () => {
      cancelled = true;
      try {
        mapRef.current?.remove();
      } catch (_e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init once

  // Update markers from latest positions.
  useEffect(() => {
    if (!mapRef.current) return;

    const validStudents = (students || []).filter((s) => isValidLatLng({ latitude: s.latitude, longitude: s.longitude }));
    const ids = new Set(validStudents.map((s) => s.student_id));

    // Remove missing.
    for (const [studentId, { marker }] of markersRef.current.entries()) {
      if (!ids.has(studentId)) {
        marker.remove();
        markersRef.current.delete(studentId);
      }
    }

    for (const s of validStudents) {
      const targetPos = toLatLng(s);
      const existing = markersRef.current.get(s.student_id);
      const color = statusColor(s.geo_status);

      if (!existing) {
        const marker = L.circleMarker([targetPos.lat, targetPos.lng], {
          radius: 7,
          color: "#0f172a",
          weight: 1,
          fillColor: color,
          fillOpacity: 0.95
        }).addTo(mapRef.current);

        marker.bindPopup(`${s.name} (${s.roll_number || s.student_id})`);

        marker.on("click", () => {
          window.dispatchEvent(
            new CustomEvent("smartcollege:selectStudent", { detail: { studentId: s.student_id } })
          );
        });

        markersRef.current.set(s.student_id, { marker, lastPos: targetPos });
      } else {
        const from = existing.lastPos;
        const to = targetPos;
        existing.marker.setStyle({ fillColor: color });

        const start = performance.now();
        const duration = 1000;
        const animate = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const lat = from.lat + (to.lat - from.lat) * t;
          const lng = from.lng + (to.lng - from.lng) * t;
          existing.marker.setLatLng([lat, lng]);
          if (t < 1) requestAnimationFrame(animate);
          else existing.lastPos = to;
        };
        requestAnimationFrame(animate);
      }
    }
  }, [students]);

  // Pan/center to selected student exact coordinate.
  useEffect(() => {
    if (!mapRef.current || !selected) return;
    if (!isValidLatLng(selected)) return;
    mapRef.current.panTo([Number(selected.latitude), Number(selected.longitude)]);
  }, [selectedStudentId, students]);

  // Update selected polyline.
  useEffect(() => {
    if (!mapRef.current || !polylineRef.current) return;
    if (!history || history.length < 1) {
      polylineRef.current.setLatLngs([]);
      return;
    }
    const path = history
      .filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number")
      .map((p) => [Number(p.latitude), Number(p.longitude)]);
    polylineRef.current.setLatLngs(path);

  }, [history, selectedStudentId]);

  // Update principal marker.
  useEffect(() => {
    if (!mapRef.current) return;
    if (!principalLocation || !isValidLatLng({ latitude: principalLocation.latitude, longitude: principalLocation.longitude })) {
      if (principalMarkerRef.current) {
        principalMarkerRef.current.remove();
        principalMarkerRef.current = null;
      }
      return;
    }
    const latlng = [Number(principalLocation.latitude), Number(principalLocation.longitude)];
    if (!principalMarkerRef.current) {
      principalMarkerRef.current = L.circleMarker(latlng, {
        radius: 7,
        color: "#111827",
        weight: 1,
        fillColor: "#38bdf8",
        fillOpacity: 0.95
      }).addTo(mapRef.current);
      principalMarkerRef.current.bindPopup("Principal (Your location)");
    } else {
      principalMarkerRef.current.setLatLng(latlng);
    }
  }, [principalLocation]);

  // Update route polyline for "Catch".
  useEffect(() => {
    if (!mapRef.current || !routePolylineRef.current) return;
    if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      routePolylineRef.current.setLatLngs([]);
      return;
    }
    const path = routeCoordinates
      .filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number")
      .map((p) => [Number(p.latitude), Number(p.longitude)]);
    routePolylineRef.current.setLatLngs(path);

    const last = path[path.length - 1];
    if (last) mapRef.current.panTo(last);
  }, [routeCoordinates]);

  if (status === "error") {
    return (
      <div className="mapBox" style={{ height: heightPx }}>
        <div className="mapError">Map failed to load (Leaflet fallback).</div>
      </div>
    );
  }

  return <div ref={containerRef} className="mapBox" style={{ height: heightPx, background: "#fff" }} />;
}

