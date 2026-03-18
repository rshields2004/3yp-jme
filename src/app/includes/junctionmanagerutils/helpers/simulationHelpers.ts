import * as THREE from "three";
import { VehicleManager } from "../vehicleManager";
import { ThickLineHandle } from "@/app/components/ThickLine";

// Handles changing stopline colours from intersection controller


/**
 * Function that handles changing the lights of the stop lines (traffic lights) on screen
 * @param junctionGroups All junction objects
 * @param vehicleManager Current vehicle manager
 */
export function applyIntersectionStopLineColours(
    junctionGroups: THREE.Group[],
    vehicleManager: VehicleManager
) {
    
    // First we iterate through all possible intersections
    for (const group of junctionGroups) {
        if (!group?.userData) {
            continue;
        }

        // Ensure only intersections are targeted
        if (!group.userData.intersectionStructure) {
            continue;
        }

        const junctionId = group.userData.id as string | undefined;
        if (!junctionId) {
            continue;
        }

        // Find the controller associated with the intersection
        const controller = vehicleManager.getController?.(junctionId);
        if (!controller) {
            continue;
        }

        // Extract the stop line refs from the group metadata
        const stopLineRefsByEntryKey = group.userData.stopLineRefsByEntryKey as Record<string, React.RefObject<ThickLineHandle>> | undefined;

        if (!stopLineRefsByEntryKey) {
            continue;
        }


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
}



