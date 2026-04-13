// HTML Elements
const searchCountryBtn = document.getElementById('searchCountryBtn');
const countryInput = document.getElementById('countryInput');
const dashboard = document.getElementById('dashboard');
const loader = document.getElementById('loader');
const errorMsg = document.getElementById('errorMsg');
const provinceSelect = document.getElementById('provinceSelect');
const universityList = document.getElementById('universityList');
const weatherInfo = document.getElementById('weatherInfo');
const routingStatus = document.getElementById('routingStatus');

let allUniversities = []; // Stores all schools for the country
let systemMap = null;
let routingControl = null; // Stores the GPS driving route
let currentCountryName = "";

// Event Listeners
searchCountryBtn.addEventListener('click', () => initializeCountryScan(countryInput.value));
countryInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') initializeCountryScan(countryInput.value); });
provinceSelect.addEventListener('change', handleProvinceSelection);

// STEP 1: Scan the Country
async function initializeCountryScan(country) {
    if (!country.trim()) return;
    currentCountryName = country;
    
    dashboard.classList.add('hidden');
    loader.classList.remove('hidden');
    errorMsg.classList.add('hidden');

    try {
        // A. Get Wiki History (Usually mentions President/Leader)
        fetchWikiHistory(country);
        
        // B. Get Timezone from REST Countries
        const restRes = await fetch(`https://restcountries.com/v3.1/name/${country}`);
        const restData = await restRes.json();
        if (restData[0].timezones) calculateLiveTime(restData[0].timezones[0]);

        // C. Fetch All Universities in that country
        const uniRes = await fetch(`http://universities.hipolabs.com/search?country=${country}`);
        allUniversities = await uniRes.json();
        
        if (allUniversities.length === 0) throw new Error("No data found");

        // D. Extract unique Provinces that actually have universities
        populateProvinceDropdown(allUniversities);

        // Reset Map & Show Dashboard
        initMap(restData[0].latlng[0], restData[0].latlng[1], 5);
        dashboard.classList.remove('hidden');

    } catch (error) {
        errorMsg.classList.remove('hidden');
    } finally {
        loader.classList.add('hidden');
    }
}

// STEP 2: Find all unique provinces
function populateProvinceDropdown(universities) {
    provinceSelect.innerHTML = '<option value="">-- Select a Province --</option>';
    
    // Use a 'Set' to automatically remove duplicate province names
    const uniqueProvinces = new Set();
    
    universities.forEach(uni => {
        if (uni["state-province"]) {
            uniqueProvinces.add(uni["state-province"]);
        }
    });

    // Sort alphabetically and add to dropdown
    Array.from(uniqueProvinces).sort().forEach(prov => {
        const option = document.createElement('option');
        option.value = prov;
        option.innerText = prov;
        provinceSelect.appendChild(option);
    });

    // Add a fallback for universities that didn't provide a province
    provinceSelect.innerHTML += '<option value="Unknown">-- Province Unknown / General --</option>';
}

// STEP 3: User Selects a Province
async function handleProvinceSelection() {
    const selectedProvince = provinceSelect.value;
    if (!selectedProvince) return;

    universityList.innerHTML = 'Loading universities...';
    weatherInfo.innerHTML = 'Scanning atmosphere...';

    // 1. Filter schools for this exact province
    let filteredUnis = [];
    if (selectedProvince === "Unknown") {
        filteredUnis = allUniversities.filter(uni => !uni["state-province"]);
    } else {
        filteredUnis = allUniversities.filter(uni => uni["state-province"] === selectedProvince);
    }

    // 2. Display the schools in the list
    universityList.innerHTML = '';
    filteredUnis.forEach(uni => {
        const div = document.createElement('div');
        div.className = 'uni-item';
        // When they click "Navigate", pass the specific school name to the GPS function
        div.innerHTML = `
            <h4>${uni.name}</h4>
            <a href="${uni.web_pages[0]}" target="_blank">Website</a>
            <button class="nav-btn" onclick="startNavigation('${uni.name.replace(/'/g, "\\'")}')">📍 Navigate Here</button>
        `;
        universityList.appendChild(div);
    });

    // 3. Geocode the Province to get Lat/Lng for Weather and Map centering
    if (selectedProvince !== "Unknown") {
        try {
            // Free Geocoding API (Turns words into GPS coordinates)
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${selectedProvince},${currentCountryName}&format=json`);
            const geoData = await geoRes.json();
            
            if (geoData.length > 0) {
                const lat = geoData[0].lat;
                const lng = geoData[0].lon;
                
                // Move map to the province
                systemMap.setView([lat, lng], 7);
                
                // Get Weather for that province
                fetchWeather(lat, lng);
            }
        } catch (e) {
            weatherInfo.innerHTML = "Weather sensors offline.";
        }
    } else {
        weatherInfo.innerHTML = "Cannot fetch weather for unknown location.";
    }
}

// STEP 4: The GPS Navigation System
async function startNavigation(targetUniversityName) {
    routingStatus.innerText = "1. Getting your GPS location...";
    
    // Ask browser for user's real location
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(async function(position) {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            
            routingStatus.innerText = "2. Locating target university...";

            try {
                // Find the GPS coordinates of the University
                const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${targetUniversityName},${currentCountryName}&format=json`);
                const geoData = await geoRes.json();

                if (geoData.length === 0) {
                    routingStatus.innerText = "Target not found on GPS radar.";
                    return;
                }

                const targetLat = geoData[0].lat;
                const targetLng = geoData[0].lon;

                routingStatus.innerText = "3. Calculating optimal route...";
                drawRoute(userLat, userLng, targetLat, targetLng);
                routingStatus.innerText = `Routing active to: ${targetUniversityName}`;

            } catch (e) {
                routingStatus.innerText = "GPS Error.";
            }

        }, function(error) {
            routingStatus.innerText = "Access to your location was denied.";
        });
    } else {
        routingStatus.innerText = "Your browser does not support GPS.";
    }
}

// Draw the Route on the Map
function drawRoute(startLat, startLng, endLat, endLng) {
    if (routingControl !== null) {
        systemMap.removeControl(routingControl); // Remove old route
    }

    // Use Leaflet Routing Machine to draw the path
    routingControl = L.Routing.control({
        waypoints: [
            L.latLng(startLat, startLng),
            L.latLng(endLat, endLng)
        ],
        routeWhileDragging: false,
        addWaypoints: false,
        show: true // Shows the turn-by-turn text box on the map
    }).addTo(systemMap);
}

// --- Background Utilities ---

function initMap(lat, lng, zoom) {
    if (systemMap !== null) systemMap.remove();
    systemMap = L.map('map').setView([lat, lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(systemMap);
    setTimeout(() => { systemMap.invalidateSize(); }, 100);
}

async function fetchWikiHistory(country) {
    const summaryBox = document.getElementById('wikiSummary');
    try {
        summaryBox.innerText = "Retrieving classified briefing...";
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${country}`);
        const data = await res.json();
        summaryBox.innerText = data.extract || "No briefing available.";
    } catch {
        summaryBox.innerText = "Intelligence database unreachable.";
    }
}

function calculateLiveTime(timezoneText) {
    const offsetNumber = parseInt(timezoneText.replace("UTC", "").split(":")[0]) || 0;
    const targetTime = new Date(new Date().getTime() + (new Date().getTimezoneOffset() * 60000) + (3600000 * offsetNumber));
    document.getElementById('localTime').innerText = targetTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

async function fetchWeather(lat, lng) {
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
        const data = await res.json();
        weatherInfo.innerHTML = `<strong>Temp:</strong> ${data.current_weather.temperature}°C <br> <strong>Wind:</strong> ${data.current_weather.windspeed} km/h`;
    } catch {
        weatherInfo.innerHTML = "Offline.";
    }
}