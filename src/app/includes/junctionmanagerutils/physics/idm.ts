import { SimConfig } from "../../types/simulation";
import { Vehicle } from "../vehicle";

/**
 * Uses suvat equation to calculate the correct accelleration based on vehicle speed and gap
 * @param v Current vehicle
 * @param desiredSpeed The speed the car wants to travel at
 * @param leaderSpeed The speed of the car in front
 * @param gap How big the gap between the cars are
 * @returns The new acceleration the car should apply
 */
export function computeIdmAccel(
    v: Vehicle,
    desiredSpeed: number,
    leaderSpeed: number | null,
    gap: number | null,
    cfg: SimConfig
): number {

    const v0 = Math.max(0.1, desiredSpeed);
    const a = Math.max(0.1, v.maxAccel);
    const b = Math.max(0.1, cfg.motion.comfortDecel);
    const delta = 4;
    const s0 = Math.max(0.5, cfg.spacing.minBumperGap);
    const T = Math.max(0.5, v.timeHeadway);

    // Calculate acceleration when road is empty (+ve acelleration part)
    const freeRoadTerm = 1 - Math.pow(v.speed / v0, delta);

    if (gap === null || !Number.isFinite(gap) || gap <= 0 || leaderSpeed === null) {
        return Math.max(-v.maxDecel, Math.min(a * freeRoadTerm, a));
    }

    // Brake part
    const dv = v.speed - leaderSpeed;
    const sStar = s0 + Math.max(0, v.speed * T + (v.speed * dv) / (2 * Math.sqrt(a * b)));
    const interaction = Math.pow(sStar / Math.max(0.1, gap), 2);

    // Finds sum of +ve and -ve acceleration
    const accel = a * (freeRoadTerm - interaction);

    // Real life constraint, max decel isnt possible so we cap it at that
    return Math.max(-v.maxDecel, Math.min(accel, a));
}

/**
 * Calculates the stopping distance of a vehicle
 * @param speed Current speed of the vehicle
 * @param vehicle Current vehicle (needed for accel values)
 * @returns Stopping distance
 */
export function stoppingDistance(
    speed: number, 
    cfg: SimConfig,
    vehicle?: Vehicle,
): number {
    const decel = vehicle ? vehicle.maxDecel : cfg.motion.maxDecel;
    return (speed * speed) / (2 * decel);
}