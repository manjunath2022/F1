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
        "averageSpeed", "peakSpeed", "controlsHint", "welcomeScreen", "lapLabApp",
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

      function setStatus(message, error = false) {
        els.statusLine.textContent = message;
        els.statusLine.classList.toggle("error", error);
      }

      function setSvgVisible(element, visible) {
        element.toggleAttribute("hidden", !visible);
      }

      async function getJson(url) {
        const response = await fetch(url);
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
        const peak = Math.max(...data.laps.flatMap(lap => lap.points.map(point => point.speed ?? 0)));
        const average = data.laps.reduce((sum, lap) => {
          const speeds = lap.points.map(point => point.speed ?? 0);
          return sum + speeds.reduce((total, speed) => total + speed, 0) / speeds.length;
        }, 0) / data.laps.length;
        const fastestLap = data.laps.find(lap => lap.timeMs === fastest);
        const spread = (slowest - fastest) / 1000;
        els.resultsSubheading.textContent = `${data.driverName} · ${data.event} · ${data.session} · ${data.laps.length} fastest accurate laps`;
        els.averageLap.textContent = formatTime(mean);
        els.fastestLap.textContent = formatTime(fastest);
        els.averageSpeed.textContent = `${Math.round(average)} km/h`;
        els.peakSpeed.textContent = `${Math.round(peak)} km/h`;
        els.analysisText.textContent = `${data.driverName}'s fastest selected lap was lap ${fastestLap.lapNumber ?? "—"} at ${formatTime(fastest)}. The selected-lap average was ${formatTime(mean)}. Peak recorded speed was ${Math.round(peak)} km/h and mean sampled speed was ${Math.round(average)} km/h. The fastest-to-slowest spread was ${spread.toFixed(3)} seconds. This comparison uses the actual selected session's accurate laps; it is not a prediction of race pace.`;
        renderLapGrades(data);
        renderBars(data);
        els.resultsPanel.hidden = false;
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
        setStatus("Downloading and processing real FastF1 telemetry. The first load can take a few minutes.");
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
