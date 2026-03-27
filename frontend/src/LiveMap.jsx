import { useEffect, useMemo, useRef, useState } from "react";
import LiveMapOSM from "./LiveMapOSM.jsx";

let googleMapsScriptPromise = null;

function loadGoogleMaps(apiKey) {
  if (!apiKey) return Promise.reject(new Error("Missing Google Maps API key"));
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
  if (googleMapsScriptPromise) return googleMapsScriptPromise;

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-maps="true"]');
    if (existing) {
      // Script tag exists but maps not ready yet; wait.
      const t = setInterval(() => {
        if (window.google?.maps) {
          clearInterval(t);
          resolve(window.google.maps);
        }
      }, 50);
      setTimeout(() => {
        clearInterval(t);
        reject(new Error("Google Maps script load timeout (check API key + billing + allowed domains)"));
      }, 15000);
      return;
    }

    const script = document.createElement("script");
    script.dataset.googleMaps = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps not available after script load"));
    };
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

function toLatLng(p) {
  return { lat: Number(p.latitude), lng: Number(p.longitude) };
}

function isValidLatLng(p) {
  return p && typeof p.latitude === "number" && typeof p.longitude === "number" && !Number.isNaN(p.latitude) && !Number.isNaN(p.longitude);
}

function statusColor(status) {
  if (status === "wandering") return "#dc2626"; // red
  if (status === "moving") return "#eab308"; // yellow
  return "#16a34a"; // green (inside)
}

export default function LiveMap({
  apiKey,
  students,
  selectedStudentId,
  history,
  principalLocation,
  routeCoordinates,
  heightPx = 520
}) {
  // If Google key is not configured, show a no-API-key fallback map.
  if (!apiKey) {
    return (
      <div>
        <div style={{ padding: 8, fontWeight: 700, color: "#b45309" }}>
          Google Maps API key is missing. Showing OpenStreetMap live tracking instead.
        </div>
        <LiveMapOSM
          students={students}
          selectedStudentId={selectedStudentId}
          history={history}
          principalLocation={principalLocation}
          routeCoordinates={routeCoordinates}
          heightPx={heightPx}
        />
      </div>
    );
  }

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // student_id -> { marker, lastPos }
  const polylineRef = useRef(null);
  const principalMarkerRef = useRef(null);
  const routePolylineRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const [mapStatus, setMapStatus] = useState("loading");

  const selected = useMemo(() => students.find((s) => s.student_id === selectedStudentId) || null, [students, selectedStudentId]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!containerRef.current) return;
      try {
        if (!apiKey) {
          setMapStatus("error");
          return;
        }
        setMapStatus("loading");
        const maps = await loadGoogleMaps(apiKey);
        if (cancelled) return;
        mapRef.current = new maps.Map(containerRef.current, {
          center: selected ? toLatLng(selected) : { lat: 17.4395, lng: 78.3785 },
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false
        });

        // Polyline for selected path.
        polylineRef.current = new maps.Polyline({
          map: mapRef.current,
          strokeColor: "#2563eb",
          strokeOpacity: 0.9,
          strokeWeight: 4,
          geodesic: true,
          path: []
        });

        // Polyline for "Catch" shortest path.
        routePolylineRef.current = new maps.Polyline({
          map: mapRef.current,
          strokeColor: "#f59e0b",
          strokeOpacity: 0.9,
          strokeWeight: 4,
          geodesic: true,
          path: []
        });
        directionsRendererRef.current = new maps.DirectionsRenderer({
          map: mapRef.current,
          suppressMarkers: true,
          polylineOptions: { strokeColor: "#f59e0b", strokeOpacity: 0.85, strokeWeight: 5 }
        });

        setMapStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setMapStatus("error");
        console.error(e);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [apiKey]); // init only once per API key

  // Update markers from latest positions.
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;
    const maps = window.google.maps;

    const validStudents = (students || []).filter((s) => isValidLatLng({ latitude: s.latitude, longitude: s.longitude }));
    const ids = new Set(validStudents.map((s) => s.student_id));

    // Remove markers for students that no longer have coords.
    for (const [studentId, { marker }] of markersRef.current.entries()) {
      if (!ids.has(studentId)) {
        marker.setMap(null);
        markersRef.current.delete(studentId);
      }
    }

    for (const s of validStudents) {
      const targetPos = toLatLng(s);
      const existing = markersRef.current.get(s.student_id);
      const color = statusColor(s.geo_status);

      const icon = {
        path: maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: color,
        fillOpacity: 0.95,
        strokeColor: "#0f172a",
        strokeWeight: 1
      };

      if (!existing) {
        const marker = new maps.Marker({ position: targetPos, map: mapRef.current, title: s.name, icon });
        markersRef.current.set(s.student_id, { marker, lastPos: targetPos });

        // Click to focus a student.
        marker.addListener("click", () => {
          // Parent owns state; dispatch a custom event as a lightweight integration.
          window.dispatchEvent(new CustomEvent("smartcollege:selectStudent", { detail: { studentId: s.student_id } }));
        });
      } else {
        // Animate smoothly between last and target.
        const from = existing.lastPos;
        const to = targetPos;
        existing.marker.setIcon(icon);

        const start = performance.now();
        const duration = 1000;
        const animate = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const lat = from.lat + (to.lat - from.lat) * t;
          const lng = from.lng + (to.lng - from.lng) * t;
          existing.marker.setPosition({ lat, lng });
          if (t < 1) requestAnimationFrame(animate);
          else existing.lastPos = to;
        };
        requestAnimationFrame(animate);
      }
    }
  }, [students]);

  // Pan/center map to selected student exact coordinate (even if history is empty).
  useEffect(() => {
    if (!mapRef.current || !selected) return;
    if (!isValidLatLng(selected)) return;
    mapRef.current.panTo(toLatLng(selected));
  }, [selectedStudentId, students]);

  // Update selected path polyline and focus map.
  useEffect(() => {
    if (!mapRef.current || !polylineRef.current || !window.google?.maps) return;
    if (!history || history.length < 2) {
      polylineRef.current.setPath([]);
      return;
    }
    const maps = window.google.maps;
    const path = history
      .filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number")
      .map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude) }));
    polylineRef.current.setPath(path);

    // Focus on the latest point for the selected student.
    const last = path[path.length - 1];
    if (last) {
      mapRef.current.panTo(last);
    }
  }, [history, selectedStudentId]);

  // Update principal marker.
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;
    if (!principalLocation || !isValidLatLng({ latitude: principalLocation.latitude, longitude: principalLocation.longitude })) {
      if (principalMarkerRef.current) {
        principalMarkerRef.current.setMap(null);
        principalMarkerRef.current = null;
      }
      return;
    }
    const maps = window.google.maps;
    const pos = toLatLng(principalLocation);
    if (!principalMarkerRef.current) {
      principalMarkerRef.current = new maps.Marker({
        position: pos,
        map: mapRef.current,
        title: "Principal (Your location)"
      });
    } else {
      principalMarkerRef.current.setPosition(pos);
    }
  }, [principalLocation]);

  // Update route polyline.
  useEffect(() => {
    if (!mapRef.current || !routePolylineRef.current || !window.google?.maps) return;
    const coords = Array.isArray(routeCoordinates) ? routeCoordinates : [];
    if (coords.length < 2) {
      routePolylineRef.current.setPath([]);
      return;
    }
    const path = coords
      .filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number")
      .map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude) }));
    routePolylineRef.current.setPath(path);
    const last = path[path.length - 1];
    if (last) mapRef.current.panTo(last);
  }, [routeCoordinates]);

  // Directions API route between principal and selected student.
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps || !directionsRendererRef.current) return;
    if (!principalLocation || !selected || !isValidLatLng(selected)) {
      directionsRendererRef.current.set("directions", null);
      return;
    }

    const maps = window.google.maps;
    const service = new maps.DirectionsService();
    service.route(
      {
        origin: { lat: Number(principalLocation.latitude), lng: Number(principalLocation.longitude) },
        destination: { lat: Number(selected.latitude), lng: Number(selected.longitude) },
        travelMode: maps.TravelMode.WALKING
      },
      (result, status) => {
        if (status === "OK" && result) {
          directionsRendererRef.current.setDirections(result);
        } else {
          // Keep campus-graph polyline as fallback if Directions API is unavailable.
          directionsRendererRef.current.set("directions", null);
        }
      }
    );
  }, [principalLocation, selectedStudentId, students]);

  // Listen to marker click selection.
  useEffect(() => {
    function onSelect(e) {
      const id = e?.detail?.studentId;
      // Emit an event for the parent to handle (if it registered).
      window.dispatchEvent(new CustomEvent("smartcollege:onSelectStudent", { detail: { studentId: id } }));
    }
    window.addEventListener("smartcollege:selectStudent", onSelect);
    return () => window.removeEventListener("smartcollege:selectStudent", onSelect);
  }, []);

  if (mapStatus === "error") {
    return (
      <div className="mapBox" style={{ height: heightPx }}>
        <div className="mapError">
          Google Maps failed to load.
          Add `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env` and restart the frontend dev server.
          Also check API key billing + allowed referrers/domains.
        </div>
      </div>
    );
  }

  if (mapStatus !== "ready") {
    return (
      <div className="mapBox" style={{ height: heightPx }}>
        <div className="mapLoading">Loading Google Map...</div>
      </div>
    );
  }

  return <div ref={containerRef} className="mapBox" style={{ height: heightPx }} />;
}

