/* ============================================================================
   Windrose — Kartenmodul (Leaflet 1.9, Carto-Light-Tiles)
   Marker nach Kategorie eingefärbt, Deadline-Dringlichkeit als Ring.
   Einträge an identischen Koordinaten werden deterministisch versetzt.
   ========================================================================== */
window.SO = window.SO || {};
(function (SO) {
  "use strict";

  var map, markerLayer, pickLayer, pickMarker;
  var markerById = {};
  var displayById = {};      // id -> [lat, lng] (inkl. Versatz)
  var selectedId = null;
  var onSelect = null;
  var onPick = null;
  var pickMode = false;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var PICK_ICON = L.divIcon({
    className: "pick-pin",
    html: '<svg viewBox="0 0 24 34" width="30" height="42" aria-hidden="true">' +
          '<path d="M12 1C6.5 1 2 5.4 2 10.9 2 18 12 33 12 33s10-15 10-22.1C22 5.4 17.5 1 12 1z" ' +
          'fill="#241f2b" stroke="#fffdf9" stroke-width="1.5"/>' +
          '<circle cx="12" cy="11" r="3.6" fill="#fffdf9"/></svg>',
    iconSize: [30, 42],
    iconAnchor: [15, 40]
  });

  function init(opts) {
    onSelect = opts.onSelect || function () {};
    map = L.map("map", {
      scrollWheelZoom: true,
      zoomControl: true,
      attributionControl: true
    }).setView([46.6, 6.5], 4.4);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap, &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 19
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);
    pickLayer = L.layerGroup().addTo(map);
    map.on("click", onMapClick);
  }

  // Deterministischer Versatz für Einträge an identischer Koordinate
  function computeDisplay(list) {
    var groups = {};
    list.forEach(function (e) {
      var key = Number(e.lat).toFixed(4) + "," + Number(e.lng).toFixed(4);
      (groups[key] = groups[key] || []).push(e);
    });
    var out = {};
    Object.keys(groups).forEach(function (key) {
      var g = groups[key].slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      if (g.length === 1) { out[g[0].id] = [Number(g[0].lat), Number(g[0].lng)]; return; }
      var R = 0.04; // ~4 km
      g.forEach(function (e, i) {
        var ang = (2 * Math.PI * i) / g.length;
        var latOff = R * Math.sin(ang);
        var lngOff = (R * Math.cos(ang)) / Math.max(0.2, Math.cos(Number(e.lat) * Math.PI / 180));
        out[e.id] = [Number(e.lat) + latOff, Number(e.lng) + lngOff];
      });
    });
    return out;
  }

  function styleFor(entry, isSelected) {
    // normCat schützt vor manipulierten category-Werten (fällt auf 'sonstiges').
    var cat = SO.CAT_COLOR[SO.normCat ? SO.normCat(entry) : entry.category] || SO.CAT_COLOR.sonstiges;
    // Dringlichkeits-Ring nur für aktiv verfolgte Einträge (offen/beworben/wartet).
    var urgencyAllowed = SO.showUrgency ? SO.showUrgency(entry) : true;
    var ds = urgencyAllowed ? SO.deadlineState(entry) : "none";
    var ring = ds === "passed" ? "#e6392b" : ds === "thismonth" ? "#ff8a1f" : cat;
    var urgent = ds === "passed" || ds === "thismonth";
    return {
      radius: isSelected ? 10 : 8,
      fillColor: cat,
      fillOpacity: 0.82,
      color: ring,
      weight: urgent ? 3.5 : (isSelected ? 3 : 1.5),
      opacity: 1
    };
  }

  function render(list) {
    markerLayer.clearLayers();
    markerById = {};
    displayById = computeDisplay(list);
    list.forEach(function (e) {
      var ll = displayById[e.id];
      var m = L.circleMarker(ll, styleFor(e, e.id === selectedId));
      m.on("click", function () { if (!pickMode && onSelect) onSelect(e.id); });
      m.addTo(markerLayer);
      markerById[e.id] = m;
    });
  }

  function select(id) {
    selectedId = id;
    // Stile aktualisieren
    Object.keys(markerById).forEach(function (mid) {
      var e = SO.store.getById(mid);
      if (e) markerById[mid].setStyle(styleFor(e, mid === id));
    });
    var m = markerById[id];
    if (m) m.bringToFront();
  }

  function flyTo(id) {
    var ll = displayById[id];
    if (!ll) return;
    var z = Math.max(map.getZoom(), 8);
    if (reduceMotion) map.setView(ll, z);
    else map.flyTo(ll, z, { duration: 0.6 });
  }

  function invalidate() { if (map) setTimeout(function () { map.invalidateSize(); }, 60); }

  // ---------- Pick-Modus ----------
  function enablePick(cb, initial) {
    pickMode = true;
    onPick = cb;
    if (map) map.getContainer().style.cursor = "crosshair";
    if (initial && isFinite(initial[0]) && isFinite(initial[1])) {
      setPickMarker(initial[0], initial[1], false);
      map.setView(initial, Math.max(map.getZoom(), 8));
    }
  }
  function disablePick() {
    pickMode = false;
    onPick = null;
    if (map) map.getContainer().style.cursor = "";
  }
  function clearPick() { pickLayer.clearLayers(); pickMarker = null; }
  function setPickMarker(lat, lng, notify) {
    if (pickMarker) {
      pickMarker.setLatLng([lat, lng]);
    } else {
      pickMarker = L.marker([lat, lng], { draggable: true, icon: PICK_ICON, keyboard: false }).addTo(pickLayer);
      pickMarker.on("dragend", function () {
        var p = pickMarker.getLatLng();
        if (onPick) onPick(p.lat, p.lng);
      });
    }
    if (notify && onPick) onPick(lat, lng);
  }
  function onMapClick(e) {
    if (!pickMode) return;
    setPickMarker(e.latlng.lat, e.latlng.lng, true);
  }

  SO.map = {
    init: init,
    render: render,
    select: select,
    flyTo: flyTo,
    invalidate: invalidate,
    enablePick: enablePick,
    disablePick: disablePick,
    clearPick: clearPick,
    setPickMarker: function (lat, lng) { setPickMarker(lat, lng, false); },
    getMap: function () { return map; }
  };
})(window.SO);
