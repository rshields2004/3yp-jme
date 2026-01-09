import { LaneEndPoint } from "./carRouting";
import * as THREE from "three";

export enum VehicleState {
    DRIVING = "DRIVING",
    APPROACHING_JUNCTION = "APPROACHING_JUNCTION",
    WAITING_AT_JUNCTION = "WAITING_AT_JUNCTION",
    CROSSING_JUNCTION = "CROSSING_JUNCTION",
    EXITING_JUNCTION = "EXITING_JUNCTION"
}

export type VehicleRoute = {
    nodes: string[];
    points: [number, number, number][];
}


export class Vehicle {

    
    model: THREE.Group;

    route: VehicleRoute;
    routeIndex: number = 0;
    position: THREE.Vector3;
    direction: THREE.Vector3;

    speed: number = 0;
    maxSpeed: number = 13;
    acceleration: number = 5;
    braking: number = 5;
    comfortBraking = 2.5;

    state: VehicleState = VehicleState.DRIVING;

    currentJunctionID: string | null = null;
    nextJunctionID: string | null = null;
    distanceToNextJunction: number = Infinity;

    length: number = 4.5;
    width: number = 2;

    minFollowDistance: number = 2.0;
    timeHeadway: number = 1.5;

    vehicleAhead: Vehicle | null = null;

    constructor(route: VehicleRoute, modelTemplates: THREE.Group[], startPosition?: THREE.Vector3) {

        const randomIndex = Math.floor(Math.random() * modelTemplates.length);
        const selectedTemplate = modelTemplates[randomIndex];


        this.model = selectedTemplate.clone();


        this.model.traverse( (child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        })

        this.route = route;

        if (startPosition) {
            this.position = startPosition.clone();
        }
        else if (route.points.length > 0) {
            const [x, y, z] = route.points[0];
            this.position = new THREE.Vector3(x, y, z);
        }
        else {
            this.position = new THREE.Vector3();
        }


        this.direction = new THREE.Vector3(0, 0, 1);
        if (route.points.length > 1) {
            const [x1, y1, z1] = route.points[0];
            const [x2, y2, z2] = route.points[1];
            this.direction.set(x2 - x1, 0, z2 - z1).normalize();
        }

        this.updateMeshTransform();

    }


    update(timeDelta: number): void {

        const targetSpeed = this.calculateTargetSpeed();

        this.adjustSpeed(targetSpeed, timeDelta);

        this.followRoute(timeDelta);

        this.updateMeshTransform();
    }


    private calculateTargetSpeed(): number {

        let desiredSpeed = this.maxSpeed;


        switch (this.state) {
            case VehicleState.WAITING_AT_JUNCTION:
                const approachDistance = 10;
                if (this.distanceToNextJunction < approachDistance) {
                    const slowdownFactor = this.distanceToNextJunction / approachDistance;
                    desiredSpeed = Math.min(desiredSpeed, this.maxSpeed * slowdownFactor);
                }
                break;

            case VehicleState.CROSSING_JUNCTION:
                desiredSpeed = Math.min(desiredSpeed, this.maxSpeed * 0.6);
                break;
        }

        if (this.vehicleAhead) {
            const gap = this.getDistanceToVehicle(this.vehicleAhead);

            const desiredGap = this.minFollowDistance + (this.speed * this.timeHeadway);

            if (gap < desiredGap) {

                const speedDiff = this.speed - this.vehicleAhead.speed;
                desiredSpeed = Math.min(desiredSpeed, this.vehicleAhead.speed);


                if (gap < this.minFollowDistance) {
                    desiredSpeed = Math.max(0, this.vehicleAhead.speed - 2);
                }
            }
        }


        return Math.max(0, desiredSpeed);
    }



    private adjustSpeed(targetSpeed: number, timeDelta: number): void {

        const speedDiff = targetSpeed - this.speed;

        if (speedDiff > 0) {
            this.speed = Math.min(targetSpeed, this.speed + (this.acceleration * timeDelta));
        }
        else if (speedDiff < 0) {

            const breakingRate = Math.abs(speedDiff) > 5 ? this.braking : this.comfortBraking;
            this.speed = Math.max(targetSpeed, this.speed - (breakingRate * timeDelta));
        }

        this.speed = Math.max(0, this.speed);
    }



    private followRoute(timeDelta: number): void {

        if (this.route.points.length === 0) {
            return;
        }

        const distanceToMove = this.speed * timeDelta;
        let remainingDistance = distanceToMove;


        while (remainingDistance > 0.01 && this.routeIndex < this.route.points.length - 1) {

            const currentPoint = new THREE.Vector3(...this.route.points[this.routeIndex]);
            const nextPoint = new THREE.Vector3(...this.route.points[this.routeIndex + 1]);

            const segmentVector = nextPoint.clone().sub(currentPoint);
            const segmentLength = segmentVector.length();

            if (segmentLength < 0.001) {
                this.routeIndex++;
                continue;
            }

            const distanceToNext = this.position.distanceTo(nextPoint);

            if (remainingDistance >= distanceToNext) {

                this.position.copy(nextPoint);
                this.routeIndex++;
                remainingDistance -= distanceToNext;

                if (this.routeIndex < this.route.points.length - 1) {

                    const futurePoint = new THREE.Vector3(...this.route.points[this.routeIndex + 1]);
                    this.direction.copy(futurePoint).sub(this.position).normalize();
                }
            }
            else {
                
                const direction = nextPoint.clone().sub(this.position).normalize();
                this.position.add(direction.multiplyScalar(remainingDistance));
                this.direction.copy(direction);
                remainingDistance = 0;
            }
        }
    }


    private updateMeshTransform(): void {

        this.model.position.copy(this.position);

        const angle = Math.atan2(this.direction.x, this.direction.z);
        this.model.rotation.y = -angle * Math.PI;
    }

    private getDistanceToVehicle(other: Vehicle): number {

        const centreDistance = this.position.distanceTo(other.position);
        
        return centreDistance - (this.length / 2) - (other.length / 2);

    }

    isRouteComplete(): boolean {

        return this.routeIndex >= this.route.points.length - 1 && this.position.distanceTo(new THREE.Vector3(...this.route.points[this.route.points.length - 1])) < 0.5;

    }

    setVehicleAhead(vehicle: Vehicle | null): void {
        this.vehicleAhead = vehicle;
    }

    getRouteProgress(): number {
        if (this.route.points.length - 1) {
            return 1;
        }
        else {
            return this.routeIndex / (this.route.points.length - 1);
        }
    }

    dispose(): void {
        this.model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                }
                else {
                    child.material.dispose();
                }
            }
        });
    }
}