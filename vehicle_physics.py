"""Simple speed, mass, acceleration, and aerodynamic-drag estimates."""

from __future__ import annotations

import math


AIR_DENSITY_KG_M3 = 1.225
GRAVITY_M_S2 = 9.80665


def calculate_estimates(
    speeds_kmh: list[float],
    driver_mass_kg: float,
    car_mass_kg: float,
    drag_area_m2: float,
    sample_interval_s: float,
) -> dict[str, float]:
    if not speeds_kmh or any(not math.isfinite(speed) or speed < 0 for speed in speeds_kmh):
        raise ValueError("Provide one or more finite, non-negative speed samples.")
    if not 35 <= driver_mass_kg <= 120:
        raise ValueError("Driver + equipment mass must be between 35 and 120 kg.")
    if not 500 <= car_mass_kg <= 1000:
        raise ValueError("Car mass must be between 500 and 1000 kg.")
    if not 0.3 <= drag_area_m2 <= 2.5:
        raise ValueError("Drag area must be between 0.3 and 2.5 m^2.")
    if not math.isfinite(sample_interval_s) or sample_interval_s <= 0:
        raise ValueError("Sample interval must be a positive number of seconds.")

    speeds_m_s = [speed / 3.6 for speed in speeds_kmh]
    total_mass_kg = driver_mass_kg + car_mass_kg
    drag_forces_n = [
        0.5 * AIR_DENSITY_KG_M3 * drag_area_m2 * speed**2
        for speed in speeds_m_s
    ]
    accelerations_g = [
        (current - previous) / sample_interval_s / GRAVITY_M_S2
        for previous, current in zip(speeds_m_s, speeds_m_s[1:])
    ]
    peak_speed_m_s = max(speeds_m_s)

    return {
        "total_mass_kg": total_mass_kg,
        "peak_speed_kmh": max(speeds_kmh),
        "system_energy_kj": 0.5 * total_mass_kg * peak_speed_m_s**2 / 1000,
        "driver_energy_kj": 0.5 * driver_mass_kg * peak_speed_m_s**2 / 1000,
        "average_drag_n": sum(drag_forces_n) / len(drag_forces_n),
        "peak_drag_n": max(drag_forces_n),
        "peak_drag_power_kw": max(
            force * speed for force, speed in zip(drag_forces_n, speeds_m_s)
        )
        / 1000,
        "peak_acceleration_g": max((value for value in accelerations_g if value > 0), default=0),
        "peak_deceleration_g": min((value for value in accelerations_g if value < 0), default=0),
        "peak_sampled_inertial_force_n": total_mass_kg
        * max((abs(value) for value in accelerations_g), default=0)
        * GRAVITY_M_S2,
    }


def main() -> None:
    try:
        speed_text = input("Speed samples in km/h (comma-separated): ")
        speeds = [float(value.strip()) for value in speed_text.split(",") if value.strip()]
        driver_mass = float(input("Driver + equipment mass in kg [35-120]: "))
        car_mass = float(input("Car mass excluding driver in kg [500-1000]: "))
        drag_area = float(input("Drag area CdA in m^2 [0.3-2.5]: "))
        interval = float(input("Seconds between speed samples: "))
        result = calculate_estimates(speeds, driver_mass, car_mass, drag_area, interval)
    except ValueError as error:
        raise SystemExit(f"Input error: {error}") from error

    print(f"\nModeled total mass: {result['total_mass_kg']:.1f} kg")
    print(f"Peak speed: {result['peak_speed_kmh']:.1f} km/h")
    print(f"System kinetic energy at peak speed: {result['system_energy_kj']:.1f} kJ")
    print(f"Driver-mass energy at peak speed: {result['driver_energy_kj']:.1f} kJ")
    print(f"Average estimated aero drag: {result['average_drag_n']:.1f} N")
    print(f"Peak estimated aero drag: {result['peak_drag_n']:.1f} N")
    print(f"Peak estimated drag power: {result['peak_drag_power_kw']:.1f} kW")
    print(
        "Peak sampled acceleration / deceleration: "
        f"+{result['peak_acceleration_g']:.2f} / {result['peak_deceleration_g']:.2f} g"
    )
    print(f"Peak mass x sampled acceleration: {result['peak_sampled_inertial_force_n']:.1f} N")
    print("\nEstimates only: actual car setup, wind, track gradient, and driver mass are unknown.")


if __name__ == "__main__":
    main()
