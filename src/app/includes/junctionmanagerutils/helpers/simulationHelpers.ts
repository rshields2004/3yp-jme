/**
 * simulationHelpers.ts
 *
 * Visual side-effect helpers that synchronise the Three.js scene with the
 * simulation state - e.g. updating stop-line colours to reflect traffic
 * signal phases at intersections.
 */

import * as THREE from "three";
import { VehicleManager } from "../vehicleManager";
import { ThickLineHandle } from "@/app/components/ThickLine";

// STOP-LINE COLOUR SYNC

/**
 * Iterates over all intersection groups and updates their stop-line colours
 * to match the current traffic-signal phase reported by the intersection
 * controller.
 *
 * Colour values are cached on `group.userData._stopLineLastColours` so that
 * the underlying {@link ThickLineHandle} is only updated when the phase
 * actually changes, avoiding unnecessary GPU work.
 *
 * @param junctionGroups - All registered junction Three.js groups.
 * @param vehicleManager - The active vehicle manager (provides controller access).
 */
export const applyIntersectionStopLineColours = (
    junctionGroups: THREE.Group[],
    vehicleManager: VehicleManager,
): void => {
    for (const group of junctionGroups) {
        if (!group?.userData) continue;

        // Only process intersection groups
        if (!group.userData.intersectionStructure) continue;

        const junctionId = group.userData.id as string | undefined;
        if (!junctionId) continue;

        // Retrieve the controller for this intersection
        const controller = vehicleManager.getController?.(junctionId);
        if (!controller) continue;

        // Extract the stop-line refs stored on the group
        const stopLineRefsByEntryKey = group.userData.stopLineRefsByEntryKey as
            | Record<string, React.RefObject<ThickLineHandle>>
            | undefined;
        if (!stopLineRefsByEntryKey) continue;

        // Cache last colours so we only update when a light actually changes
        const lastColours = (group.userData._stopLineLastColours ??= {}) as Record<string, string>;

        for (const [entryKey, refObj] of Object.entries(stopLineRefsByEntryKey)) {
            const handle = refObj?.current;
            if (!handle) continue;

            const colour = controller.getLightColour(entryKey);
            if (lastColours[entryKey] === colour) continue;
            lastColours[entryKey] = colour;

            switch (colour) {
                case "GREEN":
                    handle.setGreen();
                    break;
                case "AMBER":
                    handle.setAmber();
                    break;
                case "RED_AMBER":
                    handle.setRedAmber();
                    break;
                case "RED":
                default:
                    handle.setRed();
                    break;
            }
        }
    }
};



