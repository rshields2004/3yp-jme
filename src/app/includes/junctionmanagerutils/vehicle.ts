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

    static nextID: number = 0;
    readonly ID: number;
    
    model: THREE.Group;

    route: VehicleRoute;
    routeIndex: number = 0;
    position: THREE.Vector3;
    direction: THREE.Vector3;

    speed: number = 13;
    maxSpeed: number = 13;
    acceleration: number = 5;
    braking: number = 5;
    comfortBraking: number = 2.5;
    slowDownFactor: number = 0.1;

    state: VehicleState = VehicleState.DRIVING;

    currentJunctionID: string | null = null;
    nextJunctionID: string | null = null;
    distanceToNextJunction: number = Infinity;

    length: number = 4.5;
    width: number = 2;

    minFollowDistance: number = 2.0;
    timeHeadway: number = 1.5;
    
    distanceTravelled: number = 0;

    vehicleAhead: Vehicle | null = null;

    constructor(route: VehicleRoute, modelTemplates: THREE.Group[], startPosition?: THREE.Vector3) {

        const randomIndex = Math.floor(Math.random() * modelTemplates.length);
        const selectedTemplate = modelTemplates[randomIndex];

        this.ID = Vehicle.nextID++;
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

        // FIRST: Check car following (this takes priority over everything)
        if (this.vehicleAhead) {
            const gap = this.getDistanceToVehicle(this.vehicleAhead);
            const desiredGap = this.minFollowDistance + (this.speed * this.timeHeadway);

            // Emergency stop if gap is very small or negative (overlapping)
            if (gap < 1.0) {
                return 0;
            }
            
            // If vehicle ahead is stopped, we need to stop too with safe gap
            if (this.vehicleAhead.speed < 0.1) {
                if (gap < this.minFollowDistance + 2) {
                    return 0;
                }
                // Slow down proportionally as we approach
                const approachFactor = Math.max(0.1, (gap - this.minFollowDistance) / 20);
                desiredSpeed = Math.min(desiredSpeed, this.maxSpeed * approachFactor);
            }
            else if (gap < desiredGap) {
                desiredSpeed = Math.min(desiredSpeed, this.vehicleAhead.speed);

                if (gap < this.minFollowDistance) {
                    desiredSpeed = Math.max(0, this.vehicleAhead.speed - 2);
                }
            }
        }

        // THEN: Check junction state
        switch (this.state) {
            case VehicleState.WAITING_AT_JUNCTION:
                // When told to wait, stop immediately
                // The junction manager already determines WHEN to set this state
                // based on distance thresholds, so we just need to obey
                return 0;
            
            case VehicleState.APPROACHING_JUNCTION:
                const approachDistance = 30;
                if (this.distanceToNextJunction < approachDistance) {
                    const slowdownFactor = Math.max(0.3, this.distanceToNextJunction / approachDistance);
                    desiredSpeed = Math.min(desiredSpeed, this.maxSpeed * slowdownFactor);
                }
                break;

            case VehicleState.CROSSING_JUNCTION:
                desiredSpeed = Math.min(desiredSpeed, this.maxSpeed * 0.6);
                break;
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
        this.distanceTravelled += distanceToMove
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
                this.direction.copy(direction);  // Copy normalized direction FIRST
                this.position.add(direction.clone().multiplyScalar(remainingDistance));  // Clone before scaling
                remainingDistance = 0;
            }
        }
    }


    private updateMeshTransform(): void {

        this.model.position.copy(this.position);

        const angle = Math.atan2(this.direction.x, this.direction.z);
        this.model.rotation.y = angle;
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
        return this.routeIndex / (this.route.points.length - 1);
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