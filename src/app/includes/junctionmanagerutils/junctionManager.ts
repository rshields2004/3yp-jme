import * as THREE from "three";
import { Vehicle, VehicleState } from "./vehicle";
import { JunctionConfig } from "../types/types";

/**
 * Base class for junction-specific controllers
 */
export abstract class JunctionController {
    junctionID: string;
    junctionType: "intersection" | "roundabout";
    position: THREE.Vector3;

    // Vehicles currently in/near this junction
    protected vehiclesApproaching: Set<Vehicle> = new Set();
    protected vehiclesWaiting: Set<Vehicle> = new Set();
    protected vehiclesCrossing: Set<Vehicle> = new Set();

    constructor(junctionID: string, junctionType: "intersection" | "roundabout", position: THREE.Vector3) {
        this.junctionID = junctionID;
        this.junctionType = junctionType;
        this.position = position;
    }

    /**
     * Check if a vehicle can enter this junction
     * This is overridden by specific controller types
     */
    abstract canVehicleEnter(vehicle: Vehicle, entryExitIndex: number, entryLaneIndex: number): boolean;

    /**
     * Update junction state (e.g., traffic light timing)
     */
    abstract update(deltaTime: number): void;

    /**
     * Notify the controller that a vehicle is approaching
     */
    onVehicleApproaching(vehicle: Vehicle): void {
        this.vehiclesApproaching.add(vehicle);
    }

    /**
     * Notify the controller that a vehicle is waiting
     */
    onVehicleWaiting(vehicle: Vehicle): void {
        this.vehiclesApproaching.delete(vehicle);
        this.vehiclesWaiting.add(vehicle);
    }

    /**
     * Notify the controller that a vehicle is crossing
     */
    onVehicleCrossing(vehicle: Vehicle): void {
        this.vehiclesWaiting.delete(vehicle);
        this.vehiclesCrossing.add(vehicle);
    }

    /**
     * Notify the controller that a vehicle has exited
     */
    onVehicleExited(vehicle: Vehicle): void {
        this.vehiclesApproaching.delete(vehicle);
        this.vehiclesWaiting.delete(vehicle);
        this.vehiclesCrossing.delete(vehicle);
    }

    /**
     * Get all vehicles currently managed by this junction
     */
    getAllVehicles(): Vehicle[] {
        return [
            ...this.vehiclesApproaching,
            ...this.vehiclesWaiting,
            ...this.vehiclesCrossing
        ];
    }
}

/**
 * Temporary placeholder for intersection controller
 */
export class IntersectionController extends JunctionController {
    constructor(junctionID: string, position: THREE.Vector3) {
        super(junctionID, "intersection", position);
    }

    canVehicleEnter(vehicle: Vehicle, entryExitIndex: number, entryLaneIndex: number): boolean {
        // Placeholder - will implement traffic lights later
        // For now, just check if junction is clear
        return false;
    }

    update(deltaTime: number): void {
        // Placeholder - will implement traffic light timing later
    }
}

/**
 * Temporary placeholder for roundabout controller
 */
export class RoundaboutController extends JunctionController {
    constructor(junctionID: string, position: THREE.Vector3) {
        super(junctionID, "roundabout", position);
    }

    canVehicleEnter(vehicle: Vehicle, entryExitIndex: number, entryLaneIndex: number): boolean {
        // Placeholder - will implement priority rules later
        // For now, just check if junction is clear
        return this.vehiclesCrossing.size === 0;
    }

    update(deltaTime: number): void {
        // Placeholder - will implement priority detection later
    }
}

/**
 * Manages all junctions and coordinates vehicle state transitions
 */
export class JunctionManager {
    private controllers: Map<string, JunctionController> = new Map();
    private junctionObjects: Map<string, THREE.Group> = new Map();

    // Detection distances
    private approachDistance: number = 30; // meters before junction
    private waitDistance: number = 5;      // meters - transition to waiting
    private exitDistance: number = 15;     // meters after crossing to consider exited

    constructor(
        junctionConfig: JunctionConfig,
        junctionObjectRefs: THREE.Group[]
    ) {
        this.initializeControllers(junctionConfig, junctionObjectRefs);
    }

    /**
     * Create controllers for each junction
     */
    private initializeControllers(
        junctionConfig: JunctionConfig,
        junctionObjectRefs: THREE.Group[]
    ): void {
        for (const junctionObj of junctionConfig.junctionObjects) {
            // Find the corresponding THREE.Group
            const group = junctionObjectRefs.find(g => g.userData?.id === junctionObj.id);
            if (!group) {
                console.warn(`Could not find junction object for ID: ${junctionObj.id}`);
                continue;
            }

            // Get world position of junction
            const position = new THREE.Vector3();
            group.getWorldPosition(position);

            // Create appropriate controller
            let controller: JunctionController;
            if (junctionObj.type === "intersection") {
                controller = new IntersectionController(junctionObj.id, position);
            } else {
                controller = new RoundaboutController(junctionObj.id, position);
            }

            this.controllers.set(junctionObj.id, controller);
            this.junctionObjects.set(junctionObj.id, group);

            console.log(`Initialized ${junctionObj.type} controller: ${junctionObj.id}`);
        }
    }

    /**
     * Main update - manages vehicle states relative to junctions
     */
    update(vehicles: Vehicle[], deltaTime: number): void {
        // Update all junction controllers
        for (const controller of this.controllers.values()) {
            controller.update(deltaTime);
        }

        // Update each vehicle's junction state
        for (const vehicle of vehicles) {
            this.updateVehicleJunctionState(vehicle);
        }
    }

    /**
     * Determine and update a vehicle's state relative to junctions
     */
    private updateVehicleJunctionState(vehicle: Vehicle): void {
        const currentState = vehicle.state;

        // Find the closest junction ahead on the vehicle's route
        const junctionInfo = this.findNextJunctionOnRoute(vehicle);

        if (!junctionInfo) {
            // No junction found ahead in route
            
            // BUT if we're already waiting at a junction, don't reset!
            // The car may have passed the entry node in the route but hasn't physically
            // reached the junction yet. Use the stored junction position to calculate distance.
            if (currentState === VehicleState.WAITING_AT_JUNCTION && vehicle.nextJunctionID) {
                const controller = this.controllers.get(vehicle.nextJunctionID);
                const junctionObj = this.junctionObjects.get(vehicle.nextJunctionID);
                
                if (controller && junctionObj) {
                    const junctionPos = new THREE.Vector3();
                    junctionObj.getWorldPosition(junctionPos);
                    
                    // Calculate direct distance to junction center
                    const directDistance = vehicle.position.distanceTo(junctionPos);
                    vehicle.distanceToNextJunction = directDistance;
                    
                    // Check if we can now enter
                    if (!vehicle.vehicleAhead || vehicle.vehicleAhead.state !== VehicleState.WAITING_AT_JUNCTION) {
                        const canEnter = controller.canVehicleEnter(vehicle, 0, 0);
                        if (canEnter) {
                            vehicle.state = VehicleState.CROSSING_JUNCTION;
                            vehicle.currentJunctionID = vehicle.nextJunctionID;
                            controller.onVehicleCrossing(vehicle);
                        }
                    }
                    return;
                }
            }
            
            // No junction ahead - ensure we're in driving state
            if (currentState !== VehicleState.DRIVING) {
                // Vehicle has exited junction
                if (vehicle.currentJunctionID) {
                    const controller = this.controllers.get(vehicle.currentJunctionID);
                    controller?.onVehicleExited(vehicle);
                }

                vehicle.state = VehicleState.DRIVING;
                vehicle.currentJunctionID = null;
                vehicle.nextJunctionID = null;
                vehicle.distanceToNextJunction = Infinity;
            }
            return;
        }

        const { junctionID, distance, entryExitIndex, entryLaneIndex } = junctionInfo;
        const controller = this.controllers.get(junctionID);
        if (!controller) return;

        vehicle.nextJunctionID = junctionID;
        vehicle.distanceToNextJunction = distance;


        // State machine transitions based on distance
        if (distance > this.approachDistance) {
            // Far from junction - normal driving
            if (currentState !== VehicleState.DRIVING) {
                vehicle.state = VehicleState.DRIVING;
            }
        }
        else if (distance > this.waitDistance) {
            // Approaching junction
            if (currentState === VehicleState.DRIVING) {
                vehicle.state = VehicleState.APPROACHING_JUNCTION;
                controller.onVehicleApproaching(vehicle);
                // Don't immediately set to WAITING - let the car approach first
                // WAITING will be set when distance < waitDistance * 2 (in APPROACHING state check below)
            }
            else if (currentState === VehicleState.APPROACHING_JUNCTION) {
                // Only check junction rules if at the front of the queue
                if (!vehicle.vehicleAhead || vehicle.vehicleAhead.state !== VehicleState.WAITING_AT_JUNCTION) {
                    const canEnter = controller.canVehicleEnter(vehicle, entryExitIndex, entryLaneIndex);

                    if (!canEnter && distance < this.waitDistance * 2) {
                        vehicle.state = VehicleState.WAITING_AT_JUNCTION;
                        controller.onVehicleWaiting(vehicle);
                    }
                }
            }
            else if (currentState === VehicleState.WAITING_AT_JUNCTION) {
                // Waiting - check if we can now enter (only if still at front)
                if (!vehicle.vehicleAhead || vehicle.vehicleAhead.state !== VehicleState.WAITING_AT_JUNCTION) {
                    const canEnter = controller.canVehicleEnter(vehicle, entryExitIndex, entryLaneIndex);
                    if (canEnter) {
                        vehicle.state = VehicleState.CROSSING_JUNCTION;
                        vehicle.currentJunctionID = junctionID;
                        controller.onVehicleCrossing(vehicle);
                    }
                }
            }
        }
        else if (distance > 0) {
            // At junction entrance (within waitDistance)
            if (currentState === VehicleState.APPROACHING_JUNCTION) {
                // Only check if at front of queue
                if (!vehicle.vehicleAhead || vehicle.vehicleAhead.state !== VehicleState.WAITING_AT_JUNCTION) {
                    const canEnter = controller.canVehicleEnter(vehicle, entryExitIndex, entryLaneIndex);

                    if (canEnter) {
                        vehicle.state = VehicleState.CROSSING_JUNCTION;
                        vehicle.currentJunctionID = junctionID;
                        controller.onVehicleCrossing(vehicle);
                    } else {
                        vehicle.state = VehicleState.WAITING_AT_JUNCTION;
                        controller.onVehicleWaiting(vehicle);
                    }
                }
            }
            else if (currentState === VehicleState.WAITING_AT_JUNCTION) {
                // Only check if at front of queue
                if (!vehicle.vehicleAhead || vehicle.vehicleAhead.state !== VehicleState.WAITING_AT_JUNCTION) {
                    const canEnter = controller.canVehicleEnter(vehicle, entryExitIndex, entryLaneIndex);

                    if (canEnter) {
                        vehicle.state = VehicleState.CROSSING_JUNCTION;
                        vehicle.currentJunctionID = junctionID;
                        controller.onVehicleCrossing(vehicle);
                    }
                }
                // else stay waiting behind vehicle ahead
            }
            else if (currentState === VehicleState.DRIVING) {
                // Emergency transition - only if at front
                if (!vehicle.vehicleAhead || vehicle.vehicleAhead.state !== VehicleState.WAITING_AT_JUNCTION) {
                    const canEnter = controller.canVehicleEnter(vehicle, entryExitIndex, entryLaneIndex);
                    if (canEnter) {
                        vehicle.state = VehicleState.CROSSING_JUNCTION;
                        vehicle.currentJunctionID = junctionID;
                        controller.onVehicleCrossing(vehicle);
                    } else {
                        vehicle.state = VehicleState.WAITING_AT_JUNCTION;
                        controller.onVehicleWaiting(vehicle);
                    }
                }
            }
        }
        else {
            // Inside/past junction entrance
            if (currentState === VehicleState.CROSSING_JUNCTION) {
                // Check if we've exited the junction
                if (this.hasExitedJunction(vehicle, junctionID)) {
                    vehicle.state = VehicleState.EXITING_JUNCTION;
                    controller.onVehicleExited(vehicle);
                    vehicle.currentJunctionID = null;
                }
            }
            else if (currentState === VehicleState.EXITING_JUNCTION) {
                // Transition back to driving after some distance
                if (distance < -this.exitDistance) {
                    vehicle.state = VehicleState.DRIVING;
                }
            }
        }
    }

    /**
     * Find the next junction on the vehicle's route
     */
    private findNextJunctionOnRoute(vehicle: Vehicle): {
        junctionID: string;
        distance: number;
        entryExitIndex: number;
        entryLaneIndex: number;
    } | null {
        // Parse the route nodes to find junctions
        // NodeKey format: "structureID-exitIndex-direction-laneIndex"

        const currentRouteIndex = vehicle.routeIndex;
        const nodes = vehicle.route.nodes;

        // Look ahead in the route for the next "in" direction node (entry point)
        for (let i = Math.floor(currentRouteIndex); i < nodes.length; i++) {
            const nodeKey = nodes[i];
            const parts = nodeKey.split("-");

            if (parts.length < 4) continue;

            const direction = parts[parts.length - 2];
            const laneIndex = parseInt(parts[parts.length - 1]);
            const exitIndex = parseInt(parts[parts.length - 3]);
            const structureID = parts.slice(0, -3).join("-");

            // Found an entry point (direction = "in")
            if (direction === "in") {
                const controller = this.controllers.get(structureID);
                if (controller) {
                    // Calculate distance to this junction
                    const distance = this.calculateDistanceToNode(vehicle, i);

                    return {
                        junctionID: structureID,
                        distance,
                        entryExitIndex: exitIndex,
                        entryLaneIndex: laneIndex
                    };
                }
            }
        }

        return null;
    }

    /**
     * Calculate distance from vehicle to a specific node in its route
     */
    private calculateDistanceToNode(vehicle: Vehicle, nodeIndex: number): number {
        const points = vehicle.route.points;
        let distance = 0;

        // Add distance from current position to next point
        if (vehicle.routeIndex < points.length - 1) {
            const nextPoint = new THREE.Vector3(...points[Math.ceil(vehicle.routeIndex)]);
            distance += vehicle.position.distanceTo(nextPoint);
        }

        // Add distances between intermediate points
        for (let i = Math.ceil(vehicle.routeIndex); i < nodeIndex && i < points.length - 1; i++) {
            const p1 = new THREE.Vector3(...points[i]);
            const p2 = new THREE.Vector3(...points[i + 1]);
            distance += p1.distanceTo(p2);
        }

        return distance;
    }

    /**
     * Check if vehicle has fully exited a junction
     */
    private hasExitedJunction(vehicle: Vehicle, junctionID: string): boolean {
        const junctionObj = this.junctionObjects.get(junctionID);
        if (!junctionObj) return true;

        const junctionPos = new THREE.Vector3();
        junctionObj.getWorldPosition(junctionPos);

        const distance = vehicle.position.distanceTo(junctionPos);

        // Consider exited if beyond junction radius + exit distance
        // Rough estimate - could be improved with actual junction bounds
        return distance > this.exitDistance;
    }

    /**
     * Get a specific junction controller
     */
    getController(junctionID: string): JunctionController | undefined {
        return this.controllers.get(junctionID);
    }

    /**
     * Get all controllers
     */
    getAllControllers(): JunctionController[] {
        return Array.from(this.controllers.values());
    }

    /**
     * Update detection distances
     */
    setDetectionDistances(approach: number, wait: number, exit: number): void {
        this.approachDistance = approach;
        this.waitDistance = wait;
        this.exitDistance = exit;
    }
}