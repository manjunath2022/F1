"""Local FastF1 API and static server for the lap replay."""

from __future__ import annotations

import json
import logging
import math
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import fastf1
import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("FASTF1_CACHE_DIR", ROOT / "fastf1_cache"))
CACHE.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("lap-lab")
SESSION_CACHE: dict[tuple[int, str, str], object] = {}


def session_for(year: int, event: str, session_name: str):
    key = (year, event, session_name)
    if key not in SESSION_CACHE:
        session = fastf1.get_session(year, event, session_name)
        session.load(laps=True, telemetry=False, weather=False, messages=False)
        SESSION_CACHE[key] = session
    return SESSION_CACHE[key]


def json_value(value):
    if pd.isna(value):
        return None
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return str(value)


class LapLabHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status: int, data: dict):
        body = json.dumps(data, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def query(self) -> dict[str, str]:
        parsed = parse_qs(urlparse(self.path).query)
        return {key: values[0] for key, values in parsed.items() if values}

    def do_GET(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            if parsed.path == "/":
                self.path = "/index.html"
            return super().do_GET()

        try:
            params = self.query()
            if parsed.path == "/api/events":
                self.events(params)
            elif parsed.path == "/api/drivers":
                self.drivers(params)
            elif parsed.path == "/api/laps":
                self.laps(params)
            elif parsed.path == "/api/status":
                self.send_json(200, {"provider": "FastF1", "ready": True})
            else:
                self.send_json(404, {"error": "Unknown API endpoint."})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            LOGGER.exception("FastF1 request failed for %s", self.path)
            self.send_json(502, {"error": f"FastF1 could not load this data: {error}"})

    def requested_year(self, params: dict[str, str]) -> int:
        try:
            year = int(params.get("year", ""))
        except ValueError as error:
            raise ValueError("Choose a valid season year.") from error
        if year < 2018 or year > pd.Timestamp.now().year:
            raise ValueError("Choose a season from 2018 through the current year.")
        return year

    def requested_session(self, params: dict[str, str]):
        year = self.requested_year(params)
        event = params.get("event", "").strip()
        session_name = params.get("session", "").strip()
        if not event or len(event) > 100 or not session_name or len(session_name) > 40:
            raise ValueError("Choose a Grand Prix and session.")
        return year, event, session_name, session_for(year, event, session_name)

    def events(self, params: dict[str, str]):
        year = self.requested_year(params)
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        events = []
        for _, event in schedule.iterrows():
            if "F1ApiSupport" in schedule.columns and not bool(event["F1ApiSupport"]):
                continue
            sessions = []
            for index in range(1, 6):
                name = event.get(f"Session{index}")
                if name is not None and not pd.isna(name):
                    sessions.append(str(name))
            events.append({
                "name": str(event["EventName"]),
                "round": json_value(event.get("RoundNumber")),
                "location": str(event.get("Location", "")),
                "sessions": sessions,
            })
        self.send_json(200, {"year": year, "events": events})

    def drivers(self, params: dict[str, str]):
        year, event, session_name, session = self.requested_session(params)
        codes = session.laps["Driver"].dropna().astype(str).unique().tolist()
        drivers = []
        for code in sorted(codes):
            info = session.get_driver(code)
            drivers.append({
                "code": code,
                "name": str(info.get("FullName", code)),
                "team": str(info.get("TeamName", "")),
            })
        self.send_json(200, {
            "year": year,
            "event": event,
            "session": session_name,
            "drivers": drivers,
        })

    def laps(self, params: dict[str, str]):
        year, event, session_name, session = self.requested_session(params)
        driver = params.get("driver", "").strip().upper()
        try:
            count = int(params.get("count", "5"))
        except ValueError as error:
            raise ValueError("Choose a lap count of 1, 3, 5, or 10.") from error
        if count not in (1, 3, 5, 10):
            raise ValueError("Choose a lap count of 1, 3, 5, or 10.")
        if driver not in session.laps["Driver"].dropna().astype(str).unique():
            raise ValueError("That driver did not take part in the selected session.")

        candidates = session.laps.pick_driver(driver).pick_accurate()
        if "Deleted" in candidates.columns:
            candidates = candidates[candidates["Deleted"] != True]  # noqa: E712
        candidates = candidates.dropna(subset=["LapTime"]).sort_values("LapTime").head(count)
        if candidates.empty:
            raise ValueError("FastF1 has no accurate timed laps for this driver in that session.")

        session.load(laps=False, telemetry=True, weather=False, messages=False)

        telemetry_laps = []
        for _, lap in candidates.iterrows():
            telemetry = lap.get_telemetry()
            required = {"X", "Y", "Speed", "Throttle", "Time"}
            if not required.issubset(telemetry.columns):
                missing = ", ".join(sorted(required - set(telemetry.columns)))
                raise ValueError(f"FastF1 telemetry is missing required channels: {missing}.")
            telemetry = telemetry.dropna(subset=["X", "Y", "Speed", "Time"])
            if len(telemetry) < 2:
                continue

            indexes = np.unique(np.linspace(0, len(telemetry) - 1, min(1200, len(telemetry)), dtype=int))
            samples = telemetry.iloc[indexes]
            seconds = samples["Time"].dt.total_seconds().to_numpy(dtype=float)
            duration = float(lap["LapTime"].total_seconds())
            elapsed = np.maximum.accumulate(seconds - seconds[0])
            elapsed_span = elapsed[-1]
            if not math.isfinite(duration) or duration <= 0 or elapsed_span <= 0:
                continue

            points = []
            for row_index, (_, sample) in enumerate(samples.iterrows()):
                point = {
                    "x": json_value(sample["X"]),
                    "y": json_value(sample["Y"]),
                    "t": round(float(elapsed[row_index] / elapsed_span), 6),
                    "speed": json_value(sample["Speed"]),
                    "throttle": json_value(sample["Throttle"]),
                    "brake": json_value(sample.get("Brake")),
                    "gear": json_value(sample.get("nGear")),
                    "drs": json_value(sample.get("DRS")),
                }
                points.append(point)

            telemetry_laps.append({
                "lapNumber": json_value(lap.get("LapNumber")),
                "timeMs": round(duration * 1000),
                "sectorTimesMs": [
                    round(float(lap[name].total_seconds()) * 1000) if pd.notna(lap.get(name)) else None
                    for name in ("Sector1Time", "Sector2Time", "Sector3Time")
                ],
                "compound": json_value(lap.get("Compound")),
                "points": points,
            })

        if not telemetry_laps:
            raise ValueError("FastF1 returned no complete position telemetry for the selected laps.")

        info = session.get_driver(driver)
        corners = []
        try:
            circuit = session.get_circuit_info()
            for _, corner in circuit.corners.iterrows():
                x, y = json_value(corner.get("X")), json_value(corner.get("Y"))
                number = json_value(corner.get("Number"))
                if x is not None and y is not None and number is not None:
                    corners.append({
                        "x": x,
                        "y": y,
                        "number": number,
                        "letter": json_value(corner.get("Letter")),
                    })
        except (AttributeError, KeyError, ValueError):
            LOGGER.info("Corner labels unavailable for %s %s", event, session_name)

        self.send_json(200, {
            "year": year,
            "event": event,
            "location": str(session.event.get("Location", "")),
            "session": session_name,
            "driver": driver,
            "driverName": str(info.get("FullName", driver)),
            "team": str(info.get("TeamName", "")),
            "laps": telemetry_laps,
            "corners": corners,
            "source": "FastF1 timing and telemetry",
        })


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", os.environ.get("LAP_LAB_PORT", "8765")))
    server = ThreadingHTTPServer((host, port), LapLabHandler)
    LOGGER.info("Lap Lab is listening on %s:%s", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Shutting down Lap Lab.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
