const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MIN_REQUEST_INTERVAL_MS = 1000;
const searchCache = new Map();
const places = { start: null, destination: null };
const latestSearch = { start: 0, destination: 0 };
let lastRequestAt = 0;
let requestQueue = Promise.resolve();
let mapInstance = null;
let mapMarkers = null;

const fields = {
  start: {
    input: document.querySelector("#start-input"),
    button: document.querySelector('[data-search="start"]'),
    status: document.querySelector("#start-status"),
    results: document.querySelector("#start-results"),
  },
  destination: {
    input: document.querySelector("#destination-input"),
    button: document.querySelector('[data-search="destination"]'),
    status: document.querySelector("#destination-status"),
    results: document.querySelector("#destination-results"),
  },
};

function setStatus(field, message, state = "") {
  field.status.textContent = message;
  if (state) {
    field.status.dataset.state = state;
  } else {
    delete field.status.dataset.state;
  }
}

function queueSearch(query) {
  const search = requestQueue.then(async () => {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, wait));
    }

    lastRequestAt = Date.now();
    const url = new URL(NOMINATIM_URL);
    url.search = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "5",
      addressdetails: "1",
      "accept-language": "ko",
    }).toString();

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`장소 검색에 실패했어요. 잠시 후 다시 시도해 주세요. (${response.status})`);
    }

    return response.json();
  });

  requestQueue = search.catch(() => {});
  return search;
}

function renderResults(field, side, results) {
  field.results.replaceChildren();
  field.results.hidden = results.length === 0;

  results.forEach((place) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "result-option";
    button.type = "button";
    button.textContent = place.display_name;
    button.addEventListener("click", () => selectPlace(side, place));
    item.append(button);
    field.results.append(item);
  });
}

async function searchPlace(side) {
  const field = fields[side];
  const query = field.input.value.trim();
  const searchId = ++latestSearch[side];

  field.results.hidden = true;
  if (!query) {
    setStatus(field, "먼저 장소 이름을 입력해 주세요.", "error");
    field.input.focus();
    return;
  }

  places[side] = null;
  updateDistance();
  field.button.disabled = true;
  field.button.textContent = "검색 중";
  setStatus(field, "장소를 찾고 있어요...");

  try {
    const cacheKey = query.toLocaleLowerCase("ko");
    let results = searchCache.get(cacheKey);
    if (!results) {
      results = await queueSearch(query);
      searchCache.set(cacheKey, results);
    }

    if (searchId !== latestSearch[side]) return;

    if (!Array.isArray(results) || results.length === 0) {
      setStatus(field, "검색 결과가 없어요. 다른 이름으로 검색해 보세요.", "error");
      return;
    }

    renderResults(field, side, results);
    setStatus(field, `${results.length}개의 장소를 찾았어요. 정확한 장소를 선택해 주세요.`, "success");
  } catch (error) {
    if (searchId !== latestSearch[side]) return;
    setStatus(
      field,
      error instanceof Error ? error.message : "장소 검색 중 오류가 발생했어요.",
      "error",
    );
  } finally {
    if (searchId === latestSearch[side]) {
      field.button.disabled = false;
      field.button.textContent = "검색";
    }
  }
}

function selectPlace(side, place) {
  const field = fields[side];
  places[side] = {
    name: place.display_name,
    latitude: Number(place.lat),
    longitude: Number(place.lon),
  };
  field.input.value = place.display_name;
  field.results.hidden = true;
  setStatus(field, "장소를 선택했어요.", "success");
  updateDistance();
}

function getDistanceKm(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDifference = radians(second.latitude - first.latitude);
  const longitudeDifference = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;

  return 6371.0088 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function formatDistance(distanceKm) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000).toLocaleString("ko-KR")} m`;
  }
  return `${distanceKm.toLocaleString("ko-KR", {
    maximumFractionDigits: 1,
  })} km`;
}

function updateDistance() {
  const card = document.querySelector("#distance-card");
  const start = places.start;
  const destination = places.destination;
  if (!start || !destination) {
    card.hidden = true;
    return;
  }

  const distance = getDistanceKm(start, destination);
  document.querySelector("#distance-value").textContent = formatDistance(distance);

  const route = [start, destination]
    .map((place) => `${place.latitude},${place.longitude}`)
    .join(";");
  const mapUrl = new URL("https://www.openstreetmap.org/directions");
  mapUrl.searchParams.set("engine", "fossgis_osrm_car");
  mapUrl.searchParams.set("route", route);
  const directionsLink = document.querySelector("#directions-link");
  directionsLink.href = mapUrl.toString();
  directionsLink.setAttribute(
    "aria-label",
    `${start.name}에서 ${destination.name}까지 OpenStreetMap 지도에서 보기`,
  );
  card.hidden = false;

  if (!document.querySelector("#distance-map").hidden) {
    renderMap(start, destination);
  }
}

function renderMap(start, destination) {
  const status = document.querySelector("#map-status");
  if (!window.L) {
    status.textContent = "지도를 불러오지 못했어요. 아래 링크에서 OpenStreetMap을 열어 주세요.";
    status.dataset.state = "error";
    return;
  }

  status.textContent = "";
  delete status.dataset.state;

  if (!mapInstance) {
    mapInstance = window.L.map("map-canvas", {
      scrollWheelZoom: false,
    });
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(mapInstance);
  }

  if (mapMarkers) {
    mapMarkers.remove();
  }

  const startPoint = [start.latitude, start.longitude];
  const destinationPoint = [destination.latitude, destination.longitude];
  const startMarker = window.L.circleMarker(startPoint, {
    radius: 8,
    color: "#ffffff",
    weight: 3,
    fillColor: "#318d69",
    fillOpacity: 1,
  }).bindTooltip(`출발지: ${start.name}`);
  const destinationMarker = window.L.circleMarker(destinationPoint, {
    radius: 8,
    color: "#ffffff",
    weight: 3,
    fillColor: "#e08b52",
    fillOpacity: 1,
  }).bindTooltip(`도착지: ${destination.name}`);
  const line = window.L.polyline([startPoint, destinationPoint], {
    color: "#318d69",
    weight: 3,
    dashArray: "7 7",
  });

  mapMarkers = window.L.featureGroup([startMarker, destinationMarker, line]).addTo(mapInstance);
  if (start.latitude === destination.latitude && start.longitude === destination.longitude) {
    mapInstance.setView(startPoint, 14);
  } else {
    mapInstance.fitBounds(mapMarkers.getBounds(), { padding: [28, 28], maxZoom: 12 });
  }
  mapInstance.invalidateSize();
}

Object.entries(fields).forEach(([side, field]) => {
  field.button.addEventListener("click", () => searchPlace(side));
  field.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPlace(side);
    }
  });
  field.input.addEventListener("input", () => {
    latestSearch[side] += 1;
    places[side] = null;
    field.results.hidden = true;
    field.button.disabled = false;
    field.button.textContent = "검색";
    setStatus(field, "");
    updateDistance();
  });
});

document.querySelector("#map-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const mapPanel = document.querySelector("#distance-map");
  const isExpanded = button.getAttribute("aria-expanded") === "true";
  mapPanel.hidden = isExpanded;
  button.setAttribute("aria-expanded", String(!isExpanded));
  button.firstChild.textContent = isExpanded ? "지도에서 보기 " : "지도 숨기기 ";

  if (!isExpanded && places.start && places.destination) {
    renderMap(places.start, places.destination);
  }
});
