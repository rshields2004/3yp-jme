/**
 * idm.ts
 * Intelligent Driver Model (IDM) implementation.
 * Computes longitudinal acceleration for a vehicle based on its current
 * speed, desired speed, and the gap to the vehicle ahead.
 *
 * Reference: Treiber, Hennecke & Helbing (2000) - "Congested Traffic States
 * in Empirical Observations and Microscopic Simulations".
 */

import { SimConfig } from "../../types/simulation";
import { Vehicle } from "../vehicle";

/**
 * Acceleration exponent used in the IDM free-road term
 */
const IDM_DELTA = 4;

/**
 * Compute the longitudinal acceleration a vehicle should apply using the
 * Intelligent Driver Model (IDM).
 *
 * The model balances a free-road acceleration term (desire to reach the
 * preferred speed) against an interaction term (desire to maintain a safe
 * following distance from the leader).
 *
 * @param vehicle - The vehicle whose acceleration is being calculated
 * @param desiredSpeed - The speed the vehicle wants to travel at (m/s)
 * @param leaderSpeed - Speed of the vehicle ahead, or null if no leader
 * @param gap - Bumper-to-bumper gap to the leader (m), or null
 * @param cfg - Current simulation configuration
 * @returns The acceleration to apply (m/s²), clamped to [-maxDecel, maxAccel]
 */
export const computeIdmAccel = (
    vehicle: Vehicle,
    desiredSpeed: number,
    leaderSpeed: number | null,
    gap: number | null,
    cfg: SimConfig
): number => {

    // Clamp parameters to safe minimums to prevent division by zero
    const targetSpeed = Math.max(0.1, desiredSpeed);
    const maxAcceleration = Math.max(0.1, vehicle.maxAccel);
    const comfortDeceleration = Math.max(0.1, cfg.motion.comfortDecel);
    const minimumGap = Math.max(0.5, cfg.spacing.minBumperGap);
    const safeTimeHeadway = Math.max(0.5, vehicle.timeHeadway);

    // Free-road term: positive acceleration towards the desired speed
    const freeRoadTerm = 1 - Math.pow(vehicle.speed / targetSpeed, IDM_DELTA);

    // If there is no leader or the gap is invalid, use free-road acceleration only
    if (gap === null || !Number.isFinite(gap) || gap <= 0 || leaderSpeed === null) {
        return Math.max(-vehicle.maxDecel, Math.min(maxAcceleration * freeRoadTerm, maxAcceleration));
    }

    // Interaction term: braking influence from the vehicle ahead
    const approachSpeed = vehicle.speed - leaderSpeed;
    const desiredGap = minimumGap + Math.max(
        0,
        vehicle.speed * safeTimeHeadway +
        (vehicle.speed * approachSpeed) / (2 * Math.sqrt(maxAcceleration * comfortDeceleration))
    );
    const interactionTerm = Math.pow(desiredGap / Math.max(0.1, gap), 2);

    // Net acceleration is the sum of the free-road and interaction terms
    const netAcceleration = maxAcceleration * (freeRoadTerm - interactionTerm);

    // Clamp to physical limits
    return Math.max(-vehicle.maxDecel, Math.min(netAcceleration, maxAcceleration));
};

/**
 * Calculate the stopping distance of a vehicle using kinematic equations.
 *
 * @param speed - Current speed of the vehicle (m/s)
 * @param cfg - Current simulation configuration
 * @param vehicle - Optional vehicle (uses its maxDecel; falls back to config default)
 * @returns Stopping distance in world units (metres)
 */
export const stoppingDistance = (
    speed: number, 
    cfg: SimConfig,
    vehicle?: Vehicle,
): number => {
    const deceleration = vehicle ? vehicle.maxDecel : cfg.motion.maxDecel;
    return (speed * speed) / (2 * deceleration);
};