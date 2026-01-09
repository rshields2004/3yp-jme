import * as THREE from "three";
import { Vehicle, VehicleState } from "./vehicle";
import { JunctionConfig } from "../types/types";



export abstract class JunctionController {

    junctionID: string;
    junctionType: "intersection" | "roundabout";
    position: THREE.Vector3;


    protected vehiclesApproaching: Set<Vehicle> = new Set();
    protected vehiclesWaiting: Set<Vehicle> = new Set();
    protected vehiclesCrossing: Set<Vehicle> = new Set();

    constructor(junctionID: string, junctionType: "intersection" | "roundabout", position: THREE.Vector3) {
        this.junctionID = junctionID;
        this.junctionType = junctionType;
        this.position = position;
    }

    abstract canVehicleEnter(vehicle: Vehicle, entryExitIndex: number, entryLaneIndex: number): boolean;

    abstract update(timeDelta: number): void;

    onVehicleApproaching(vehicle: Vehicle): void {
        this.vehiclesApproaching.add(vehicle);
    }

    onVehicleWaiting(vehicle: Vehicle): void {
        this.vehiclesApproaching.delete(vehicle);
        this.vehiclesWaiting.add(vehicle);
    }

    onVehicleCrossing(vehicle: Vehicle): void {
        this.vehiclesWaiting.delete(vehicle);
        this.vehiclesCrossing.add(vehicle);
    }

    onVehicleExited(vehicle: Vehicle): void {
        this.vehiclesApproaching.delete(vehicle);
        this.vehiclesWaiting.delete(vehicle);
        this.vehiclesCrossing.delete(vehicle);
    }

    getAllVehicles(): Vehicle[] {
        return [
            ...this.vehiclesApproaching,
            ...this.vehiclesWaiting,
            ...this.vehiclesCrossing
        ];
    }
}


export class IntersectionController extends JunctionController {
    constructor(junctionID: string, position: THREE.Vector3) {
        super(junctionID, "intersection", position);
    }

    canVehicleEnter(vehicle: Vehicle, entryExitIndex: number, entryLaneIndex: number): boolean {
        
        // TODO
        return this.vehiclesCrossing.size === 0;
    }

    update(timeDelta: number): void {
        // TODO
    }
}


export class RoundaboutController extends JunctionController {
    constructor(junctionID: string, position: THREE.Vector3) {
        super(junctionID, "roundabout", position);
    }

    canVehicleEnter(vehicle: Vehicle, entryExitIndex: number, entryLaneIndex: number): boolean {
        
        // TODO
        return this.vehiclesCrossing.size === 0;
    }

    update(timeDelta: number): void {
        // TODO
    }
}








export class JunctionManager {

    private controllers: Map<string, JunctionController> = new Map();
    private junctionObjects: Map<string, THREE.Group> = new Map();


    private approachDistance: number = 30;
    private waitDistance: number = 5;
    private exitDistance: number = 15;


    constructor(junctionConfig: JunctionConfig, junctionObjectRefs: THREE.Group[]) {
        this.initialiseControllers(junctionConfig, junctionObjectRefs);
    }


    private initialiseControllers(junctionConfig: JunctionConfig, junctionObjectRefs: THREE.Group[]): void {

        for (const junctionObj of junctionConfig.junctionObjects) {

            const group = junctionObjectRefs.find(g => g.userData?.id === junctionObj.id);

            if (!group) {
                console.warn("Could not find junction object for ID: " + `${junctionObj.id}`);
                continue;
            }

            const position = new THREE.Vector3();
            group.getWorldPosition(position);

            let controller: JunctionController;
            if (junctionObj.type === "intersection") {
                controller = new IntersectionController(junctionObj.id, position);
            }
            else {
                controller = new RoundaboutController(junctionObj.id, position);
            }

            this.controllers.set(junctionObj.id, controller);
            this.junctionObjects.set(junctionObj.id, group);

            console.log(`Initialised ${junctionObj.type} controller: ${junctionObj.id}`);

        }

    }


    update(vehicles: Vehicle[], timeDelta: number): void {

        for (const controller of this.controllers.values()) {
            controller.update(timeDelta);
        }

        for (const vehicle of vehicles) {
            this.updateVehicleJunctionState(vehicle);
        }
    }

    private updateVehicleJunctionState(vehicle: Vehicle): void {

        const currentState = vehicle.state;


        const junctionInfo = this.findNextJunctionOnRoute(vehicle);

        if (!junctionInfo) {

            if (currentState !== VehicleState.DRIVING) {
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
        


        const { junctionID, distance, entryExitIndex, entryLaneIndex } = junctionInfo
        const controller = this.controllers.get(junctionID);
        if (!controller) {
            return;
        }

        vehicle.nextJunctionID = junctionID;
        vehicle.distanceToNextJunction = distance;

        // State machine based on distance
        if (distance > this.approachDistance) {
            
            // Far from junction
            if (currentState !== VehicleState.DRIVING) {
                vehicle.state = VehicleState.DRIVING;
            }
        }
        else if (distance > this.waitDistance) {
            
            // Approaching junction
            if (currentState === VehicleState.DRIVING) {
                vehicle.state = VehicleState.APPROACHING_JUNCTION;
                controller.onVehicleApproaching(vehicle);
            }
            else if (currentState == VehicleState.APPROACHING_JUNCTION) {
                
                // Check if vehicle can enter
                const canEnter = controller.canVehicleEnter(vehicle, entryExitIndex, entryLaneIndex);

                if (!canEnter && distance < this.waitDistance * 2) {
                    
                    // Need to stop so make car wait
                    vehicle.state = VehicleState.WAITING_AT_JUNCTION;
                    controller.onVehicleWaiting(vehicle);
                }
            }
        }
        else if (distance > 0) {
            // At junction entrance
            if (currentState === VehicleState.APPROACHING_JUNCTION || currentState === VehicleState.WAITING_AT_JUNCTION) {

                const canEnter = controller.canVehicleEnter(vehicle, entryExitIndex, entryLaneIndex);

                if (canEnter) {
                    vehicle.state = VehicleState.CROSSING_JUNCTION;
                    vehicle.currentJunctionID = junctionID;
                    controller.onVehicleCrossing(vehicle);
                }
                else {
                    vehicle.state = VehicleState.WAITING_AT_JUNCTION
                }
            }
        }
        else {
            // Inside/past junction entrance

            if (currentState === VehicleState.CROSSING_JUNCTION) {
                // Check if junction has been left
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

    private findNextJunctionOnRoute(vehicle: Vehicle): {
        junctionID: string;
        distance: number;
        entryExitIndex: number;
        entryLaneIndex: number;
    } | null {

        const currentRouteIndex = vehicle.routeIndex;
        const nodes = vehicle.route.nodes;


        for (let i = Math.floor(currentRouteIndex); i < nodes.length; i++) {

            const nodekey = nodes[i];
            const parts = nodekey.split("-");

            if (parts.length < 4) {
                continue;
            }

            const direction = parts[parts.length - 2];
            const laneIndex = parseInt(parts[parts.length - 1]);
            const exitIndex = parseInt(parts[parts.length - 3]);
            const structureID = parts.slice(0, -3).join("-");


            if (direction === "in") {
                const controller = this.controllers.get(structureID);
                if (controller) {

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


    private calculateDistanceToNode(vehicle: Vehicle, nodeIndex: number): number {

        const points = vehicle.route.points;
        let distance = 0;

        if (vehicle.routeIndex < points.length - 1) {
            const nextPoint = new THREE.Vector3(...points[Math.ceil(vehicle.routeIndex)]);
            distance += vehicle.position.distanceTo(nextPoint);
        }

        for (let i = Math.ceil(vehicle.routeIndex); i < nodeIndex && i < points.length - 1; i++) {
            const p1 = new THREE.Vector3(...points[i]);
            const p2 = new THREE.Vector3(...points[i + 1]);
            distance += p1.distanceTo(p2);
        }
        return distance;
    }


    private hasExitedJunction(vehicle: Vehicle, junctionID: string): boolean {

        const junctionObj = this.junctionObjects.get(junctionID);
        if (!junctionObj) {
            return true;
        }

        const junctionPos = new THREE.Vector3();
        junctionObj.getWorldPosition(junctionPos);

        const distance = vehicle.position.distanceTo(junctionPos);

        return distance > this.exitDistance;
    }

    getController(junctionID: string): JunctionController | undefined {
        return this.controllers.get(junctionID);
    }

    getAllControllers(): JunctionController[] {
        return Array.from(this.controllers.values());
    }


    setDetectionDistances(approach: number, wait: number, exit: number): void {
        this.approachDistance = approach;
        this.waitDistance = wait;
        this.exitDistance = exit;
    }

}
