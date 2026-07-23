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
      zoomControl: false,
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
  function hasValidPosition(e) {
    if (!e || e.lat === null || e.lat === undefined || e.lng === null || e.lng === undefined ||
        String(e.lat).trim() === "" || String(e.lng).trim() === "") return false;
    var lat = Number(e.lat), lng = Number(e.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function computeDisplay(list) {
    var groups = {};
    list.forEach(function (e) {
      if (!hasValidPosition(e)) return;
      var key = Number(e.lat).toFixed(4) + "," + Number(e.lng).toFixed(4);
      (groups[key] = groups[key] || []).push(e);
    });
    var out = {};
    Object.keys(groups).forEach(function (key) {
      var g = groups[key].slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      if (g.length === 1) { out[g[0].id] = [Number(g[0].lat), Number(g[0].lng)]; return; }
      // Nur so weit auffächern, dass dicht übereinanderliegende Punkte bei
      // Stadt-Zoom anklickbar werden. Die frühere 4-km-Streuung verfälschte Orte.
      var R = 0.008; // rund 900 m
      g.forEach(function (e, i) {
        var ang = (2 * Math.PI * i) / g.length;
        var latOff = R * Math.sin(ang);
        var lngOff = (R * Math.cos(ang)) / Math.max(0.2, Math.cos(Number(e.lat) * Math.PI / 180));
        out[e.id] = [Number(e.lat) + latOff, Number(e.lng) + lngOff];
      });
    });
    return out;
  }

  var CATEGORY_ICONS = {
    festival: '<path d="M14 3v10.2a3.5 3.5 0 1 1-2-3.15V5.1l7-1.55V11a3.5 3.5 0 1 1-2-3.15V3.45L14 4.1V3z"/>',
    markt: '<path d="M4 4h16l2 5v2a3 3 0 0 1-2 2.83V21h-2v-7.17A3 3 0 0 1 16 12a3 3 0 0 1-4 0 3 3 0 0 1-4 0 3 3 0 0 1-2 1.83V21H4v-7.17A3 3 0 0 1 2 11V9l2-5zm1.2 2L4 9h16l-1.2-3H5.2z"/>',
    messe: '<path d="M4 3h16v18h-2v-2H6v2H4V3zm3 3v4h4V6H7zm6 0v4h4V6h-4zm-6 7v4h4v-4H7zm6 0v4h4v-4h-4z"/>',
    sonstiges: '<path d="m12 2 2.1 6.1L20 10l-5.9 1.9L12 18l-2.1-6.1L4 10l5.9-1.9L12 2zm0 5.6L11.2 10l.8 2.4.8-2.4-.8-2.4z"/>'
  };

  function markerIcon(entry, isSelected) {
    var cat = SO.normCat ? SO.normCat(entry) : entry.category;
    if (!CATEGORY_ICONS[cat]) cat = "sonstiges";
    var urgencyAllowed = SO.showUrgency ? SO.showUrgency(entry) : true;
    var ds = urgencyAllowed ? SO.deadlineState(entry) : "none";
    var classes = ["map-marker", "marker-" + cat];
    if (entry.is_suggestion) classes.push("is-suggestion");
    else if (ds === "passed") classes.push("is-passed");
    else if (ds === "thismonth") classes.push("is-thismonth");
    if (isSelected) classes.push("is-selected");
    return L.divIcon({
      className: "windrose-map-marker",
      html: '<span class="' + classes.join(" ") + '"><svg viewBox="0 0 24 24" aria-hidden="true">' +
        CATEGORY_ICONS[cat] + "</svg></span>",
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  function render(list) {
    markerLayer.clearLayers();
    markerById = {};
    displayById = computeDisplay(list);
    list.forEach(function (e) {
      var ll = displayById[e.id];
      if (!ll) return;
      var m = L.marker(ll, {
        icon: markerIcon(e, e.id === selectedId),
        keyboard: true,
        title: e.name || "Standort"
      });
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
      if (e) {
        markerById[mid].setIcon(markerIcon(e, mid === id));
        markerById[mid].setZIndexOffset(mid === id ? 1000 : 0);
      }
    });
  }

  function flyTo(id) {
    var ll = displayById[id];
    if (!ll) return;
    // Europa-Übersicht → Stadt/Quartier: deutlich näher als zuvor (Zoom 8),
    // ohne einen bereits noch engeren Zoom wieder zurückzusetzen.
    var z = Math.max(map.getZoom(), 11);
    // Auf Desktop liegt das 440-px-Detailpanel rechts über der Karte. Nach dem
    // Zoom den Punkt in die Mitte des SICHTBAREN Kartenteils rücken, damit er
    // nicht hinter dem Panel verschwindet.
    var detailOffset = window.innerWidth >= 880 ? Math.min(440, window.innerWidth * 0.92) / 2 : 0;
    if (reduceMotion) {
      map.setView(ll, z);
      if (detailOffset) map.panBy([detailOffset, 0], { animate: false });
    } else {
      if (detailOffset) {
        map.once("moveend", function () {
          if (selectedId === id) map.panBy([detailOffset, 0], { animate: true, duration: 0.2 });
        });
      }
      map.flyTo(ll, z, { duration: 0.6 });
    }
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
