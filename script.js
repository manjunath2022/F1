(() => {
      const svgNs = "http://www.w3.org/2000/svg";
      const els = Object.fromEntries([
        "yearSelect", "eventSelect", "sessionSelect", "driverSelect", "lapCount", "loadButton",
        "pauseButton", "startButton", "statusLine", "trackTitle", "trackSubtitle", "lapStatus",
        "referenceLabel", "referenceTime",
        "trackMap", "trackEmpty", "trackOutline", "trackCore", "trackBlue", "trackCenter", "trackHighlight",
        "trackOverview", "overviewMap", "overviewTrack",
        "corners", "marker", "markerGlow", "lapTimeValue", "clockMeta", "speedValue", "throttleValue",
        "brakeValue", "gearValue", "progressMeter", "progressBar", "resultsPanel",
        "resultsSubheading", "lapBars", "lapGradesBody", "analysisText", "averageLap", "fastestLap",
        "averageSpeed", "peakSpeed", "averageThrottle", "fullThrottle", "brakingShare", "drsShare",
        "upshifts", "downshifts", "sectorAnalysisBody", "controlsHint", "welcomeScreen", "lapLabApp",
        "driverMassInput", "carMassInput", "dragAreaInput", "physicsStatus", "modeledMass",
        "systemKineticEnergy", "driverKineticEnergy", "averageDrag", "peakDrag", "peakDragPower",
        "sampledAcceleration", "sampledInertialForce",
        "enterLabButton", "showIntroButton",
        "navHome", "navCars",
        "navTracks", "navSimulator", "startRacingButton", "landingFeatures"
      ].map(id => [id, document.getElementById(id)]));
      const paceButtons = [...document.querySelectorAll(".pace-option")];
      let selectedRate = 4;
      let selectedData = null;
      let lapIndex = 0;
      let progress = 0;
      let running = false;
      let previousFrame = 0;
      let animationFrame = 0;
      let trackPoints = [];
      const airDensity = 1.225;

      function setStatus(message, error = false) {
        els.statusLine.textContent = message;
        els.statusLine.classList.toggle("error", error);
      }

      function setSvgVisible(element, visible) {
        element.toggleAttribute("hidden", !visible);
      }

      async function getJson(url) {
        let response;
        try {
          response = await fetch(url);
        } catch (error) {
          if (error instanceof TypeError) {
            throw new Error("Could not connect to the FastF1 server. The free Render service may be waking up, or the connection was interrupted. Check your internet, wait a minute, and try again.");
          }
          throw error;
        }
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error("The local server returned a web page instead of API data. Restart the app with start_lap_lab.bat and try again.");
        }
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
        return payload;
      }

      function updateLoadButton() {
        els.loadButton.disabled = !els.driverSelect.value || !els.sessionSelect.value;
      }

      function selectedSessionParams() {
        const params = new URLSearchParams({
          year: els.yearSelect.value,
          event: els.eventSelect.value,
          session: els.sessionSelect.value
        });
        return params;
      }

      async function loadEvents() {
        els.eventSelect.disabled = true;
        els.sessionSelect.disabled = true;
        els.driverSelect.disabled = true;
        els.eventSelect.replaceChildren(new Option("Loading events…", ""));
        try {
          const data = await getJson(`/api/events?year=${encodeURIComponent(els.yearSelect.value)}`);
          els.eventSelect.replaceChildren(...data.events.map(event => new Option(event.name, event.name)));
          els.eventSelect.disabled = data.events.length === 0;
          const hungary = data.events.findIndex(event => /hungar/i.test(event.name));
          if (hungary >= 0) els.eventSelect.selectedIndex = hungary;
          await loadSessions();
          setStatus(`Loaded ${data.events.length} event weekends for ${data.year}. Choose session details and load real telemetry.`);
        } catch (error) {
          els.eventSelect.replaceChildren(new Option("Could not load events", ""));
          setStatus(error.message, true);
        }
      }

      async function loadSessions() {
        const eventName = els.eventSelect.value;
        const year = els.yearSelect.value;
        const eventData = await getJson(`/api/events?year=${encodeURIComponent(year)}`);
        const event = eventData.events.find(item => item.name === eventName);
        const sessions = event ? event.sessions : [];
        els.sessionSelect.replaceChildren(...sessions.map(name => new Option(name, name)));
        els.sessionSelect.disabled = sessions.length === 0;
        const qualifying = sessions.findIndex(name => /qualifying/i.test(name));
        if (qualifying >= 0) els.sessionSelect.selectedIndex = qualifying;
        else if (sessions.length) els.sessionSelect.selectedIndex = sessions.length - 1;
        await loadDrivers();
      }

      async function loadDrivers() {
        els.driverSelect.disabled = true;
        els.driverSelect.replaceChildren(new Option("Loading drivers…", ""));
        if (!els.eventSelect.value || !els.sessionSelect.value) {
          els.driverSelect.replaceChildren(new Option("Select session first", ""));
          updateLoadButton();
          return;
        }
        try {
          const params = selectedSessionParams();
          const data = await getJson(`/api/drivers?${params}`);
          els.driverSelect.replaceChildren(...data.drivers.map(driver => new Option(
            `${driver.code} · ${driver.name}${driver.team ? ` — ${driver.team}` : ""}`,
            driver.code
          )));
          els.driverSelect.disabled = data.drivers.length === 0;
          if (data.drivers.length) {
            const norris = data.drivers.findIndex(driver => driver.code === "NOR");
            els.driverSelect.selectedIndex = norris >= 0 ? norris : 0;
          }
          updateLoadButton();
          setStatus(`${data.drivers.length} drivers found. Loading driver results may take a little while on the first request.`);
        } catch (error) {
          els.driverSelect.replaceChildren(new Option("Could not load drivers", ""));
          setStatus(error.message, true);
          updateLoadButton();
        }
      }

      function formatTime(milliseconds) {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor(milliseconds / 1000) % 60;
        const millis = Math.floor(milliseconds % 1000);
        return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
      }

      function svgPoint(point) {
        return { x: Number(point.x), y: -Number(point.y) };
      }

      function markerAt(position) {
        const lap = selectedData.laps[lapIndex];
        const points = lap.points;
        const scaledPosition = Math.min(1, Math.max(0, position));
        let low = 0;
        let high = points.length - 1;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (points[middle].t < scaledPosition) low = middle + 1;
          else high = middle;
        }
        const next = points[low];
        const previous = points[Math.max(0, low - 1)];
        const tangentNext = points[Math.min(points.length - 1, low + 1)];
        const span = next.t - previous.t;
        const fraction = span > 0 ? (scaledPosition - previous.t) / span : 0;
        return {
          x: previous.x + (next.x - previous.x) * fraction,
          y: -previous.y - (next.y - previous.y) * fraction,
          angle: Math.atan2(-(tangentNext.y - previous.y), tangentNext.x - previous.x) * 180 / Math.PI
        };
      }

      function updateMarker() {
        if (!selectedData) return;
        const lap = selectedData.laps[lapIndex];
        const point = markerAt(progress);
        const hue = Math.floor(progress * lap.timeMs / 1000 * 55) % 360;
        els.trackMap.style.setProperty("--marker-color", `hsl(${hue} 100% 62%)`);
        els.marker.setAttribute("cx", point.x);
        els.marker.setAttribute("cy", point.y);
        els.markerGlow.setAttribute("cx", point.x);
        els.markerGlow.setAttribute("cy", point.y);
        const sample = lap.points.reduce((best, item) => Math.abs(item.t - progress) < Math.abs(best.t - progress) ? item : best, lap.points[0]);
        els.lapTimeValue.textContent = formatTime(progress * lap.timeMs);
        els.speedValue.textContent = Math.round(sample.speed ?? 0);
        els.throttleValue.textContent = Math.round(sample.throttle ?? 0);
        els.brakeValue.textContent = sample.brake == null ? "—" : (sample.brake ? "ON" : "OFF");
        els.gearValue.textContent = sample.gear == null ? "—" : String(sample.gear);
        const percent = Math.floor(progress * 100);
        els.progressBar.style.width = `${percent}%`;
        els.progressMeter.setAttribute("aria-valuenow", String(percent));
        els.lapStatus.textContent = running ? `Lap ${lapIndex + 1} / ${selectedData.laps.length}` : `Lap ${lapIndex + 1} / ${selectedData.laps.length}`;
        const activePoints = lap.points.filter(point => point.t < progress);
        activePoints.push(markerAt(progress));
        els.trackHighlight.setAttribute("points", activePoints.map(point => `${point.x},${-point.y}`).join(" "));
      }

      function showIntro() {
        els.lapLabApp.hidden = true;
        els.welcomeScreen.hidden = false;
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      function enterLapLab() {
        els.welcomeScreen.hidden = true;
        els.lapLabApp.hidden = false;
        window.scrollTo({ top: 0, behavior: "instant" });
      }

      function openTracks() {
        enterLapLab();
        document.querySelector(".track-card").scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function drawTrack(data) {
        trackPoints = data.laps[0].points.map(point => ({ x: Number(point.x), y: -Number(point.y) }));
        const xs = trackPoints.map(point => point.x);
        const ys = trackPoints.map(point => point.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const extent = Math.max(maxX - minX, maxY - minY);
        const padding = extent * .008;
        const viewX = minX - padding, viewY = minY - padding;
        const viewWidth = maxX - minX + padding * 2, viewHeight = maxY - minY + padding * 2;
        els.trackMap.setAttribute("viewBox", `${viewX} ${viewY} ${viewWidth} ${viewHeight}`);
        els.overviewMap.setAttribute("viewBox", `${viewX} ${viewY} ${viewWidth} ${viewHeight}`);
        els.overviewTrack.setAttribute("points", trackPoints.map(point => `${point.x},${point.y}`).join(" "));
        els.overviewTrack.style.strokeWidth = String(extent * .006);
        els.overviewTrack.style.strokeDasharray = `${extent * .025} ${extent * .018}`;
        els.trackOverview.hidden = false;
        els.trackOutline.style.strokeWidth = String(extent * .032);
        els.trackCore.style.strokeWidth = String(extent * .024);
        els.trackCenter.style.strokeWidth = String(extent * .0012);
        els.trackCenter.style.strokeDasharray = `${extent * .003} ${extent * .008}`;
        els.trackHighlight.style.strokeWidth = String(extent * .0035);
        els.trackHighlight.style.strokeDasharray = `${extent * .003} ${extent * .006}`;
        els.trackBlue.style.strokeWidth = String(extent * .009);
        els.marker.setAttribute("r", String(extent * .009));
        els.markerGlow.setAttribute("r", String(extent * .024));
        const points = trackPoints.map(point => `${point.x},${point.y}`).join(" ");
        for (const id of ["trackOutline", "trackCore", "trackBlue", "trackCenter"]) {
          els[id].setAttribute("points", points);
          setSvgVisible(els[id], true);
        }
        els.trackHighlight.setAttribute("points", "");
        setSvgVisible(els.trackHighlight, true);
        els.corners.replaceChildren();
        for (const corner of data.corners) {
          const pos = svgPoint(corner);
          const group = document.createElementNS(svgNs, "g");
          group.setAttribute("transform", `translate(${pos.x} ${pos.y})`);
          group.setAttribute("pointer-events", "none");
          const circle = document.createElementNS(svgNs, "circle");
          circle.setAttribute("class", "corner-halo");
          circle.setAttribute("r", String(extent * .012));
          const text = document.createElementNS(svgNs, "text");
          text.setAttribute("class", "corner-label");
          text.style.fontSize = `${extent * .018}px`;
          text.textContent = `${corner.number}${corner.letter || ""}`;
          group.append(circle, text);
          els.corners.append(group);
        }
        setSvgVisible(els.trackEmpty, false);
        setSvgVisible(els.marker, true);
        setSvgVisible(els.markerGlow, true);
      }

      function renderBars(data) {
        const fastest = Math.min(...data.laps.map(lap => lap.timeMs));
        const slowest = Math.max(...data.laps.map(lap => lap.timeMs));
        const range = slowest - fastest;
        els.lapBars.replaceChildren();
        data.laps.forEach((lap, index) => {
          const row = document.createElement("div");
          row.className = "lap-row";
          const label = document.createElement("span");
          label.className = "lap-label";
          label.textContent = `Lap ${lap.lapNumber ?? index + 1}`;
          const track = document.createElement("div");
          track.className = "bar-track";
          const fill = document.createElement("div");
          fill.className = `bar-fill${lap.timeMs === fastest ? " best" : ""}`;
          fill.style.width = `${range ? 46 + (slowest - lap.timeMs) / range * 54 : 100}%`;
          track.append(fill);
          const timeBox = document.createElement("div");
          timeBox.className = "lap-result";
          timeBox.append(document.createTextNode(formatTime(lap.timeMs)));
          const delta = document.createElement("div");
          delta.className = "lap-delta";
          delta.textContent = lap.timeMs === fastest ? "BEST" : `+${((lap.timeMs - fastest) / 1000).toFixed(3)}s`;
          timeBox.append(delta);
          row.append(label, track, timeBox);
          els.lapBars.append(row);
        });
      }

      function gradeLevel(value, highLimit, goodLimit) {
        if (value <= highLimit) return "High";
        if (value <= goodLimit) return "Good";
        return "Normal";
      }

      function gradeBadge(level) {
        const badge = document.createElement("span");
        badge.className = `grade-level grade-${level.toLowerCase()}`;
        badge.textContent = level;
        return badge;
      }

      function renderLapGrades(data) {
        const fastest = Math.min(...data.laps.map(lap => lap.timeMs));
        const speeds = data.laps.map(lap => {
          const values = lap.points.map(point => point.speed).filter(Number.isFinite);
          return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        });
        const topSpeed = Math.max(...speeds);
        const bestSectors = [0, 1, 2].map(index => Math.min(
          ...data.laps.map(lap => lap.sectorTimesMs?.[index]).filter(Number.isFinite)
        ));

        els.lapGradesBody.replaceChildren();
        data.laps.forEach((lap, index) => {
          const row = document.createElement("tr");
          const lapCell = document.createElement("td");
          lapCell.textContent = `Lap ${lap.lapNumber ?? index + 1}`;
          row.append(lapCell);

          const sectorLosses = (lap.sectorTimesMs || []).map((time, sector) =>
            Number.isFinite(time) && Number.isFinite(bestSectors[sector]) ? time - bestSectors[sector] : null
          ).filter(Number.isFinite);
          const sectorSpread = sectorLosses.length > 1
            ? Math.max(...sectorLosses) - Math.min(...sectorLosses)
            : Infinity;
          const speedLossPercent = topSpeed > 0 ? (topSpeed - speeds[index]) / topSpeed * 100 : Infinity;
          const levels = data.laps.length < 2
            ? ["Normal", "Normal", "Normal"]
            : [
                gradeLevel((lap.timeMs - fastest) / 1000, 0.4, 1.5),
                gradeLevel(speedLossPercent, 2, 5),
                gradeLevel(sectorSpread / 1000, 0.25, 0.75)
              ];

          levels.forEach(level => {
            const cell = document.createElement("td");
            cell.append(gradeBadge(level));
            row.append(cell);
          });
          els.lapGradesBody.append(row);
        });
      }

      function renderAnalysis(data) {
        const times = data.laps.map(lap => lap.timeMs);
        const fastest = Math.min(...times);
        const slowest = Math.max(...times);
        const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
        const points = data.laps.flatMap(lap => lap.points);
        const speeds = points.map(point => point.speed).filter(Number.isFinite);
        const throttle = points.map(point => point.throttle).filter(Number.isFinite);
        const brakes = points.map(point => point.brake).filter(value => value !== null && value !== undefined);
        const drs = points.map(point => point.drs).filter(Number.isFinite);
        const gears = points.map(point => point.gear).filter(Number.isFinite);
        const peak = speeds.length ? Math.max(...speeds) : 0;
        const average = speeds.length ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length : 0;
        const averageThrottleValue = throttle.length
          ? throttle.reduce((sum, value) => sum + value, 0) / throttle.length
          : null;
        const fullThrottlePercent = throttle.length
          ? throttle.filter(value => value >= 95).length / throttle.length * 100
          : null;
        const brakingPercent = brakes.length
          ? brakes.filter(value => value === true || (Number.isFinite(Number(value)) && Number(value) > 0)).length / brakes.length * 100
          : null;
        const drsPercent = drs.length ? drs.filter(value => value >= 10).length / drs.length * 100 : null;
        let upshiftCount = 0;
        let downshiftCount = 0;
        for (const lap of data.laps) {
          let previousGear = null;
          for (const point of lap.points) {
            if (!Number.isFinite(point.gear)) continue;
            if (previousGear !== null && point.gear !== previousGear) {
              if (point.gear > previousGear) upshiftCount++;
              else downshiftCount++;
            }
            previousGear = point.gear;
          }
        }
        const fastestLap = data.laps.find(lap => lap.timeMs === fastest);
        const spread = (slowest - fastest) / 1000;
        const sessionDetails = [data.team, data.location, data.event, data.year, data.session]
          .filter(Boolean).join(" · ");
        els.resultsSubheading.textContent = `${data.driverName} · ${sessionDetails} · ${data.laps.length} fastest accurate laps`;
        els.averageLap.textContent = formatTime(mean);
        els.fastestLap.textContent = formatTime(fastest);
        els.averageSpeed.textContent = speeds.length ? `${Math.round(average)} km/h` : "Unavailable";
        els.peakSpeed.textContent = speeds.length ? `${Math.round(peak)} km/h` : "Unavailable";
        els.averageThrottle.textContent = averageThrottleValue === null ? "Unavailable" : `${Math.round(averageThrottleValue)}%`;
        els.fullThrottle.textContent = fullThrottlePercent === null ? "Unavailable" : `${Math.round(fullThrottlePercent)}%`;
        els.brakingShare.textContent = brakingPercent === null ? "Unavailable" : `${Math.round(brakingPercent)}%`;
        els.drsShare.textContent = drsPercent === null ? "Unavailable" : `${Math.round(drsPercent)}%`;
        els.upshifts.textContent = gears.length ? String(upshiftCount) : "Unavailable";
        els.downshifts.textContent = gears.length ? String(downshiftCount) : "Unavailable";
        const channelSummary = [
          `mean throttle ${averageThrottleValue === null ? "unavailable" : `${Math.round(averageThrottleValue)}%`}`,
          `full throttle ${fullThrottlePercent === null ? "unavailable" : `${Math.round(fullThrottlePercent)}%`}`,
          `braking ${brakingPercent === null ? "unavailable" : `${Math.round(brakingPercent)}%`}`,
          `DRS active ${drsPercent === null ? "unavailable" : `${Math.round(drsPercent)}%`}`
        ].join(", ");
        els.analysisText.textContent = `${data.driverName}'s fastest selected lap was lap ${fastestLap.lapNumber ?? "—"} at ${formatTime(fastest)}; the selected-lap average was ${formatTime(mean)} (spread ${spread.toFixed(3)} s). Across the sampled laps, peak/mean speed was ${Math.round(peak)}/${Math.round(average)} km/h; ${channelSummary}. Sampled gear changes: ${upshiftCount} upshifts and ${downshiftCount} downshifts.`;
        renderSectorAnalysis(data);
        renderPhysicsAnalysis(data);
        renderLapGrades(data);
        renderBars(data);
        els.resultsPanel.hidden = false;
      }

      function renderPhysicsAnalysis(data) {
        const modelInputs = [
          { element: els.driverMassInput, label: "Driver + equipment mass", min: 35, max: 120 },
          { element: els.carMassInput, label: "Car mass", min: 500, max: 1000 },
          { element: els.dragAreaInput, label: "Drag area", min: 0.3, max: 2.5 }
        ];
        const invalid = modelInputs.filter(({ element, min, max }) => {
          const value = Number(element.value);
          return !Number.isFinite(value) || value < min || value > max;
        });
        modelInputs.forEach(({ element, min, max }) => {
          const value = Number(element.value);
          element.setAttribute("aria-invalid", String(!Number.isFinite(value) || value < min || value > max));
        });
        if (invalid.length) {
          els.physicsStatus.textContent = `Enter valid values for ${invalid.map(input => input.label).join(", ")}.`;
          for (const id of [
            "modeledMass", "systemKineticEnergy", "driverKineticEnergy", "averageDrag",
            "peakDrag", "peakDragPower", "sampledAcceleration", "sampledInertialForce"
          ]) els[id].textContent = "—";
          return;
        }

        els.physicsStatus.textContent = "Using editable model inputs and standard air density (1.225 kg/m³).";
        const driverMass = Number(els.driverMassInput.value);
        const totalMass = driverMass + Number(els.carMassInput.value);
        const dragArea = Number(els.dragAreaInput.value);
        const lapSamples = data.laps.flatMap(lap =>
          (lap.points || []).map(point => ({ point, lapTimeMs: lap.timeMs }))
        );
        const speedSamples = lapSamples
          .map(({ point }) => point.speed)
          .filter(speed => Number.isFinite(speed) && speed >= 0)
          .map(speed => speed / 3.6);

        if (!speedSamples.length) {
          els.physicsStatus.textContent = "No valid speed samples are available to calculate the physics estimates.";
          for (const id of [
            "modeledMass", "systemKineticEnergy", "driverKineticEnergy", "averageDrag",
            "peakDrag", "peakDragPower", "sampledAcceleration", "sampledInertialForce"
          ]) els[id].textContent = "Unavailable";
          return;
        }

        const peakSpeed = Math.max(...speedSamples);
        const dragForces = speedSamples.map(speed => 0.5 * airDensity * dragArea * speed ** 2);
        const averageForce = dragForces.reduce((sum, force) => sum + force, 0) / dragForces.length;
        const peakForce = Math.max(...dragForces);
        const peakPower = Math.max(...dragForces.map((force, index) => force * speedSamples[index]));
        let peakAcceleration = 0;
        let peakDeceleration = 0;
        let hasAcceleration = false;
        for (const lap of data.laps) {
          const points = lap.points || [];
          for (let index = 1; index < points.length; index++) {
            const previous = points[index - 1];
            const current = points[index];
            const elapsed = (current.t - previous.t) * lap.timeMs / 1000;
            if (!Number.isFinite(previous.speed) || !Number.isFinite(current.speed) ||
                !Number.isFinite(elapsed) || elapsed <= 0) continue;
            const acceleration = (current.speed - previous.speed) / 3.6 / elapsed;
            peakAcceleration = Math.max(peakAcceleration, acceleration);
            peakDeceleration = Math.min(peakDeceleration, acceleration);
            hasAcceleration = true;
          }
        }

        els.modeledMass.textContent = `${totalMass.toFixed(1)} kg`;
        els.systemKineticEnergy.textContent = `${(0.5 * totalMass * peakSpeed ** 2 / 1000).toFixed(1)} kJ`;
        els.driverKineticEnergy.textContent = `${(0.5 * driverMass * peakSpeed ** 2 / 1000).toFixed(1)} kJ`;
        els.averageDrag.textContent = `${Math.round(averageForce)} N`;
        els.peakDrag.textContent = `${Math.round(peakForce)} N`;
        els.peakDragPower.textContent = `${(peakPower / 1000).toFixed(1)} kW`;
        els.sampledAcceleration.textContent = hasAcceleration
          ? `+${(peakAcceleration / 9.80665).toFixed(2)} / ${(peakDeceleration / 9.80665).toFixed(2)} g`
          : "Unavailable";
        els.sampledInertialForce.textContent = hasAcceleration
          ? `${Math.round(totalMass * Math.max(peakAcceleration, Math.abs(peakDeceleration)))} N`
          : "Unavailable";
      }

      function renderSectorAnalysis(data) {
        els.sectorAnalysisBody.replaceChildren();
        for (let sectorIndex = 0; sectorIndex < 3; sectorIndex++) {
          const sectorTimes = data.laps.map(lap => lap.sectorTimesMs?.[sectorIndex]).filter(Number.isFinite);
          const bestSector = sectorTimes.length ? Math.min(...sectorTimes) : null;
          const sectorPoints = [];

          for (const lap of data.laps) {
            const lapTime = lap.timeMs;
            const sectorTime = lap.sectorTimesMs?.[sectorIndex];
            const points = lap.points || [];
            if (!Number.isFinite(lapTime) || !Number.isFinite(sectorTime) || !points.length) continue;
            const start = lap.sectorTimesMs.slice(0, sectorIndex).reduce((sum, value) =>
              sum + (Number.isFinite(value) ? value : 0), 0) / lapTime;
            const end = start + sectorTime / lapTime;
            sectorPoints.push(...points.filter(point =>
              Number.isFinite(point.t) && point.t >= start && (sectorIndex === 2 ? point.t <= end + 0.02 : point.t < end)
            ));
          }

          const sectorSpeeds = sectorPoints.map(point => point.speed).filter(Number.isFinite);
          const sectorThrottles = sectorPoints.map(point => point.throttle).filter(Number.isFinite);
          const sectorBrakes = sectorPoints.map(point => point.brake).filter(value => value !== null && value !== undefined);
          const brakePercent = sectorBrakes.length
            ? sectorBrakes.filter(value => value === true || (Number.isFinite(Number(value)) && Number(value) > 0)).length / sectorBrakes.length * 100
            : null;
          const values = [
            `S${sectorIndex + 1}`,
            bestSector === null ? "Unavailable" : formatTime(bestSector),
            sectorSpeeds.length ? `${Math.round(sectorSpeeds.reduce((sum, value) => sum + value, 0) / sectorSpeeds.length)} km/h` : "Unavailable",
            sectorSpeeds.length ? `${Math.round(Math.max(...sectorSpeeds))} km/h` : "Unavailable",
            sectorThrottles.length ? `${Math.round(sectorThrottles.reduce((sum, value) => sum + value, 0) / sectorThrottles.length)}%` : "Unavailable",
            brakePercent === null ? "Unavailable" : `${Math.round(brakePercent)}%`
          ];
          const row = document.createElement("tr");
          values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.append(cell);
          });
          els.sectorAnalysisBody.append(row);
        }
      }

      function finishLap() {
        running = false;
        progress = 1;
        updateMarker();
        if (lapIndex + 1 < selectedData.laps.length) {
          lapIndex += 1;
          progress = 0;
          updateMarker();
          running = true;
          previousFrame = 0;
          animationFrame = requestAnimationFrame(frame);
          return;
        }
        els.startButton.disabled = false;
        els.startButton.textContent = "Replay again";
        els.pauseButton.disabled = true;
        els.controlsHint.textContent = "All selected real laps have been replayed.";
        els.lapStatus.textContent = "Replay complete";
        renderAnalysis(selectedData);
        els.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function frame(now) {
        if (!running) return;
        if (!previousFrame) previousFrame = now;
        const elapsed = Math.max(0, now - previousFrame);
        previousFrame = now;
        const duration = selectedData.laps[lapIndex].timeMs / selectedRate;
        progress = Math.min(1, progress + elapsed / duration);
        updateMarker();
        if (progress >= 1) {
          finishLap();
          return;
        }
        animationFrame = requestAnimationFrame(frame);
      }

      async function loadLapData() {
        const params = selectedSessionParams();
        params.set("driver", els.driverSelect.value);
        params.set("count", els.lapCount.value);
        els.loadButton.disabled = true;
        els.loadButton.textContent = "Loading telemetry…";
        setStatus("Downloading real FastF1 telemetry. The first request can take 1–2 minutes on the free server; keep this page open.");
        els.resultsPanel.hidden = true;
        try {
          const data = await getJson(`/api/laps?${params}`);
          selectedData = data;
          lapIndex = 0;
          progress = 0;
          drawTrack(data);
          els.trackTitle.textContent = data.event;
          els.trackSubtitle.textContent = `${data.location} · ${data.year} · ${data.session} · ${data.driverName} (${data.driver}) · Fastest recorded lap ${formatTime(data.laps[0].timeMs)}`;
          els.referenceTime.textContent = formatTime(Math.min(...data.laps.map(lap => lap.timeMs)));
          els.referenceLabel.textContent = `${data.driver} fastest`;
          els.clockMeta.textContent = `Lap ${data.laps[0].lapNumber} · ${data.session} · ${data.year}`;
          els.controlsHint.textContent = `${data.laps.length} real fastest accurate laps ready. Replay speed only changes animation playback.`;
          els.startButton.disabled = false;
          els.startButton.textContent = "Start replay";
          els.pauseButton.disabled = true;
          updateMarker();
          setStatus(`${data.laps.length} real lap${data.laps.length === 1 ? "" : "s"} loaded from FastF1 (${data.session}). Press Start replay to view them.`);
        } catch (error) {
          selectedData = null;
          setStatus(error.message, true);
        } finally {
          els.loadButton.textContent = "Load real lap data";
          updateLoadButton();
        }
      }

      function beginReplay() {
        if (!selectedData || running) return;
        if (progress >= 1 || els.resultsPanel.hidden === false) {
          lapIndex = 0;
          progress = 0;
          els.resultsPanel.hidden = true;
        }
        running = true;
        previousFrame = 0;
        els.startButton.disabled = true;
        els.pauseButton.disabled = false;
        els.startButton.textContent = "Replay running…";
        els.controlsHint.textContent = "Live values are read from the current real telemetry sample.";
        updateMarker();
        animationFrame = requestAnimationFrame(frame);
      }

      async function handleSelectionChange() {
        running = false;
        cancelAnimationFrame(animationFrame);
        selectedData = null;
        els.startButton.disabled = true;
        els.pauseButton.disabled = true;
        els.resultsPanel.hidden = true;
        setSvgVisible(els.trackEmpty, true);
        els.trackOverview.hidden = true;
        for (const id of ["trackOutline", "trackCore", "trackBlue", "trackCenter", "trackHighlight", "marker", "markerGlow"]) {
          setSvgVisible(els[id], false);
        }
        els.corners.replaceChildren();
        els.trackTitle.textContent = "Hungaroring";
        els.trackSubtitle.textContent = "Choose a session to load its circuit map.";
        els.referenceTime.textContent = "—";
        els.lapTimeValue.textContent = "—";
        els.speedValue.textContent = "—";
        els.throttleValue.textContent = "—";
        els.brakeValue.textContent = "—";
        els.gearValue.textContent = "—";
        els.progressBar.style.width = "0%";
        els.progressMeter.setAttribute("aria-valuenow", "0");
        await loadDrivers();
      }

      els.yearSelect.addEventListener("change", loadEvents);
      els.eventSelect.addEventListener("change", async () => {
        try { await loadSessions(); }
        catch (error) { setStatus(error.message, true); }
        updateLoadButton();
      });
      els.sessionSelect.addEventListener("change", handleSelectionChange);
      els.driverSelect.addEventListener("change", () => {
        selectedData = null;
        els.startButton.disabled = true;
        els.pauseButton.disabled = true;
        els.resultsPanel.hidden = true;
        els.loadButton.disabled = false;
      });
      els.loadButton.addEventListener("click", loadLapData);
      [els.driverMassInput, els.carMassInput, els.dragAreaInput].forEach(input =>
        input.addEventListener("input", () => {
          if (selectedData && !els.resultsPanel.hidden) renderPhysicsAnalysis(selectedData);
        })
      );
      els.enterLabButton.addEventListener("click", enterLapLab);
      els.showIntroButton.addEventListener("click", showIntro);
      els.startRacingButton.addEventListener("click", enterLapLab);
      els.navSimulator.addEventListener("click", enterLapLab);
      els.navTracks.addEventListener("click", openTracks);
      els.navCars.addEventListener("click", () => {
        els.landingFeatures.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      els.navHome.addEventListener("click", showIntro);
      els.startButton.addEventListener("click", beginReplay);
      els.pauseButton.addEventListener("click", () => {
        if (!running) return;
        running = false;
        cancelAnimationFrame(animationFrame);
        els.startButton.disabled = false;
        els.startButton.textContent = "Resume replay";
        els.pauseButton.disabled = true;
        els.controlsHint.textContent = "Replay paused at the current telemetry sample.";
        els.lapStatus.textContent = `Paused · lap ${lapIndex + 1} / ${selectedData.laps.length}`;
      });
      paceButtons.forEach(button => button.addEventListener("click", () => {
        selectedRate = Number(button.dataset.rate);
        paceButtons.forEach(option => option.setAttribute("aria-pressed", String(option === button)));
      }));

      (async () => {
        for (let year = new Date().getFullYear(); year >= 2018; year -= 1) {
          els.yearSelect.add(new Option(String(year), String(year)));
        }
        els.yearSelect.value = "2024";
        try {
          await getJson("/api/status");
          setStatus("FastF1 service connected. Loading the 2024 event schedule…");
          await loadEvents();
        } catch (error) {
          setStatus(`${error.message} Start the app with start_lap_lab.bat.`, true);
        }
      })();
    })();
