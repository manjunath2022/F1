"""Calculate per-sample F1 telemetry and simple vehicle-aerodynamics estimates."""

from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path


GRAVITY_M_S2 = 9.80665


def sample_time(sample: dict[str, str], fallback: float) -> float:
    value = sample.get("time_s", "").strip()
    return float(value) if value else fallback


def calculate_sample_rows(
    samples: list[dict[str, str]],
    driver_mass_kg: float,
    car_mass_kg: float,
    drag_area_m2: float,
    downforce_area_m2: float,
    air_density_kg_m3: float,
) -> list[dict[str, float | str]]:
    if not samples:
        raise ValueError("No telemetry samples were provided.")
    bounds = (
        ("driver + equipment mass", driver_mass_kg, 35, 120),
        ("car mass", car_mass_kg, 500, 1000),
        ("drag area CdA", drag_area_m2, 0.3, 2.5),
        ("downforce area ClA", downforce_area_m2, 0, 8),
        ("air density", air_density_kg_m3, 0.5, 2),
    )
    for label, value, minimum, maximum in bounds:
        if not math.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError(f"{label} must be between {minimum} and {maximum}.")

    total_mass_kg = driver_mass_kg + car_mass_kg
    times = [sample_time(sample, float(index)) for index, sample in enumerate(samples)]
    speeds = []
    for sample in samples:
        try:
            speed = float(sample["speed_kmh"])
        except (KeyError, ValueError) as error:
            raise ValueError("Every sample must include a numeric speed_kmh.") from error
        if not math.isfinite(speed) or speed < 0:
            raise ValueError("Speed samples must be finite and non-negative.")
        speeds.append(speed / 3.6)

    rows: list[dict[str, float | str]] = []
    for index, (sample, time_s, speed_m_s) in enumerate(zip(samples, times, speeds)):
        left = max(0, index - 1)
        right = min(len(samples) - 1, index + 1)
        elapsed = times[right] - times[left]
        acceleration = (
            (speeds[right] - speeds[left]) / elapsed
            if elapsed > 0 and right != left
            else math.nan
        )
        drag_n = 0.5 * air_density_kg_m3 * drag_area_m2 * speed_m_s**2
        downforce_n = 0.5 * air_density_kg_m3 * downforce_area_m2 * speed_m_s**2
        rows.append({
            "lap": sample.get("lap", ""),
            "sample": sample.get("sample", str(index + 1)),
            "time_s": time_s,
            "speed_kmh": speed_m_s * 3.6,
            "throttle_pct": sample.get("throttle_pct", ""),
            "brake": sample.get("brake", ""),
            "gear": sample.get("gear", ""),
            "drs": sample.get("drs", ""),
            "acceleration_m_s2": acceleration,
            "acceleration_g": acceleration / GRAVITY_M_S2,
            "drag_n": drag_n,
            "downforce_n": downforce_n,
            "drag_power_kw": drag_n * speed_m_s / 1000,
            "kinetic_energy_kj": 0.5 * total_mass_kg * speed_m_s**2 / 1000,
            "driver_kinetic_energy_kj": 0.5 * driver_mass_kg * speed_m_s**2 / 1000,
            "mass_acceleration_force_n": total_mass_kg * acceleration,
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calculate physics for every telemetry sample in a Lap Lab CSV export."
    )
    parser.add_argument("telemetry_csv", type=Path, help="CSV exported from the website")
    parser.add_argument("--driver-mass", type=float, default=80, help="driver + equipment kg")
    parser.add_argument("--car-mass", type=float, default=700, help="car mass without driver kg")
    parser.add_argument("--cda", type=float, default=1.0, help="assumed drag area in m^2")
    parser.add_argument("--cla", type=float, default=3.0, help="assumed downforce area in m^2")
    parser.add_argument("--air-density", type=float, default=1.225, help="air density in kg/m^3")
    parser.add_argument("--output", type=Path, help="output CSV path (default: stdout)")
    args = parser.parse_args()

    try:
        with args.telemetry_csv.open(newline="", encoding="utf-8-sig") as source:
            samples = list(csv.DictReader(source))
        rows = calculate_sample_rows(
            samples,
            args.driver_mass,
            args.car_mass,
            args.cda,
            args.cla,
            args.air_density,
        )
    except (OSError, csv.Error, ValueError) as error:
        raise SystemExit(f"Could not calculate telemetry: {error}") from error

    columns = list(rows[0])
    if args.output:
        destination = args.output.open("w", newline="", encoding="utf-8")
    else:
        destination = sys.stdout
    try:
        writer = csv.DictWriter(destination, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    finally:
        if args.output:
            destination.close()

    print(f"Calculated {len(rows)} telemetry samples.", file=sys.stderr)
    print(
        f"Inputs: driver={args.driver_mass:g} kg, car={args.car_mass:g} kg, "
        f"CdA={args.cda:g} m^2, ClA={args.cla:g} m^2, "
        f"air density={args.air_density:g} kg/m^3.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
