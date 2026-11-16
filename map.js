// Import Mapbox and D3 as ESM modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoibW1hbnRlaSIsImEiOiJjbXdqdHl3dzgwMGIzMzBxMGNibnh1bmRkIn0.QvC7QsuH89TjyU5yR7nRFA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Shared style for bike lanes
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 5,
  'line-opacity': 0.6,
};

// Maps departure share (0–1) to one of three values: 0, 0.5, or 1
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Departure ratio for a station (0.5 = balanced if no traffic, to avoid dividing by 0)
function departureRatio(d) {
  return d.totalTraffic ? stationFlow(d.departures / d.totalTraffic) : 0.5;
}

// ---------- Global helpers ----------

// Step 5.4: trips grouped by minute of the day (1440 minutes in a day)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Convert a station's lon/lat into pixel coordinates on the map
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Slider minutes -> "9:30 AM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Date -> minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Get trips within 60 minutes of the selected time (or all trips if -1)
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    // Window wraps around midnight
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Count arrivals/departures per station for a given time filter
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Tooltip text for a station
function tooltipText(d) {
  return `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
}

// ---------- Everything that needs the map loaded ----------

map.on('load', async () => {
  // --- Bike lanes ---
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // --- Load station data ---
  const svg = d3.select('#map').select('svg');

  let jsonData;
  try {
    jsonData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  // --- Load trips: parse dates and sort into minute buckets as they load ---
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
      arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);

      return trip;
    }
  );
  console.log('Loaded trips:', trips.length);

  // --- Traffic for all times of day ---
  const stations = computeStationTraffic(jsonData.data.stations);

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // --- Draw circles (keyed by station ID so D3 can reuse them) ---
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', departureRatio)
    .each(function (d) {
      d3.select(this).append('title').text(tooltipText(d));
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // --- Step 5.2: Slider ---
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Step 5.3: Recompute traffic and resize circles for the selected time
  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // Bigger circles when filtering, since there's less traffic per hour
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', departureRatio)
      .select('title')
      .text(tooltipText); // keep tooltip numbers in sync with the slider
  }

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});