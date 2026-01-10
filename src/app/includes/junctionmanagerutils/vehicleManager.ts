import * as THREE from "three";
import { Vehicle, VehicleRoute } from "./vehicle";

export type SpawnConfig = {
    mode: "continuous" | "fixedcount" | "surge";
    spawnInterval?: number;
    maxVehicles?: number;
    targetVehicleCount?: number;
    minSpawnGap?: number;
};

export class VehicleManager {

    private vehicles: Vehicle[] = [];
    private routes: VehicleRoute[];
    private carModels: THREE.Group[];
    private scene: THREE.Scene;

    private config: SpawnConfig;
    private timeSinceLastSpawn: number = 0;

    private totalSpawned: number = 0;
    private totalCompleted: number = 0;

    constructor(scene: THREE.Scene, routes: VehicleRoute[], carModels: THREE.Group[], config?: Partial<SpawnConfig>) {

        this.scene = scene;
        this.routes = routes;
        this.carModels = carModels;

        this.config = {

            mode: config?.mode ?? "continuous",
            spawnInterval: config?.spawnInterval ?? 3,
            maxVehicles: config?.maxVehicles ?? 50,
            targetVehicleCount: config?.targetVehicleCount ?? 30,
            minSpawnGap: config?.minSpawnGap ?? 15
        };

        if (this.routes.length === 0) {
            console.warn("VehicleManager: No routes provided");
        }

        if (this.carModels.length === 0) {
            console.warn("VehicleManager: No car models provided");
        }
    }


    update(timeDelta: number): void {
        this.updateVehicleRelationships();

        this.updateSpawning(timeDelta);


        for (const vehicle of this.vehicles) {
            vehicle.update(timeDelta);
        }

        this.removeCompletedVehicles();
    }


    private updateSpawning(timeDelta: number): void {

        this.timeSinceLastSpawn += timeDelta;

        let shouldSpawn = false;

        switch(this.config.mode) {
            case "continuous":
                shouldSpawn = this.timeSinceLastSpawn>= (this.config.spawnInterval ?? 3) && this.vehicles.length < (this.config.maxVehicles ?? 50);
                break;
            case "fixedcount":
                shouldSpawn = this.timeSinceLastSpawn >= (this.config.spawnInterval ?? 3) && this.vehicles.length < (this.config.maxVehicles ?? 50);
                break;
        }

        if (shouldSpawn) {
            this.spawnVehicle();
            this.timeSinceLastSpawn = 0;
        }
    }

    private spawnVehicle(): void {

        if (this.routes.length === 0 || this.carModels.length === 0) {
            return;
        }


        const maxAttempts = 10;
        let attempts = 0;

        while (attempts < maxAttempts) {

            const randomRoute = this.routes[Math.floor(Math.random() * this.routes.length)];

            if (this.hasSpaceAtRouteStart(randomRoute)) {

                const vehicle = new Vehicle(randomRoute, this.carModels);
                this.vehicles.push(vehicle);
                this.scene.add(vehicle.model);
                this.totalSpawned++;

                console.log(`Spawned Vehicle ${this.totalSpawned} (active: ${this.vehicles.length})`);
                return;
            }
            attempts++;
        }
    }

    private hasSpaceAtRouteStart(route: VehicleRoute): boolean {
        if (route.points.length === 0) {
            return false;
        }

        const startPoint = new THREE.Vector3(...route.points[0]);
        const minGap = this.config.minSpawnGap ?? 15;

        console.log(`Checking spawn at (${startPoint.x.toFixed(1)}, ${startPoint.z.toFixed(1)}), minGap=${minGap}`);
        
        // Check ALL vehicles, regardless of route
        for (const vehicle of this.vehicles) {
            const distance = vehicle.position.distanceTo(startPoint);
            
            console.log(`  - Vehicle at (${vehicle.position.x.toFixed(1)}, ${vehicle.position.z.toFixed(1)}), distance=${distance.toFixed(1)}m`);
            
            if (distance < minGap) {
            console.log(`  → TOO CLOSE! Blocking spawn.`);
            return false;
            }
        }
        
        console.log(`  → OK to spawn!`);
        return true;
    }

    private areRoutesEqual(route1: VehicleRoute, route2: VehicleRoute): boolean {

        if (route1.nodes.length !== route2.nodes.length) {
            return false;
        }
        else {
            return route1.nodes.every((node, i) => node === route2.nodes[i]);
        }

    }


    private updateVehicleRelationships(): void {
        for (const vehicle of this.vehicles) {
            vehicle.setVehicleAhead(this.findVehicleAhead(vehicle));
        }
    }

    private findVehicleAhead(vehicle: Vehicle): Vehicle | null {
        let closestVehicle: Vehicle | null = null;
        let minForwardDistance = Infinity;
        const searchRadius = 50;
        const laneWidth = 3.0;
        
        for (const other of this.vehicles) {
            if (other === vehicle) continue;
            
            const distance = vehicle.position.distanceTo(other.position);
            
            if (distance > searchRadius) {
                continue;
            }
            
            // Vector from this vehicle to the other
            const toOther = other.position.clone().sub(vehicle.position);
            
            // How far ahead is the other vehicle? (dot product with our direction)
            const forwardDistance = toOther.dot(vehicle.direction);
            
            // If forward distance is negative or zero, other vehicle is behind us
            if (forwardDistance <= 0.1) {
                continue;
            }
            
            // How far to the side is the other vehicle?
            const perpendicular = new THREE.Vector3(-vehicle.direction.z, 0, vehicle.direction.x);
            const lateralDistance = Math.abs(toOther.dot(perpendicular));
            
            // If too far to the side, they're in a different lane
            if (lateralDistance > laneWidth) {
                continue;
            }
            
            // This vehicle is ahead of us and in our lane - is it the closest?
            if (forwardDistance < minForwardDistance) {
                closestVehicle = other;
                minForwardDistance = forwardDistance;
            }
        }
        
        return closestVehicle;
    }

    
    private removeCompletedVehicles(): void {

        const initialCount = this.vehicles.length;
        
        this.vehicles = this.vehicles.filter(vehicle => {
            if (vehicle.isRouteComplete()) {

                this.scene.remove(vehicle.model);
                vehicle.dispose();
                this.totalCompleted++;
                return false;
            }
            return true;
        });

        const removed = initialCount - this.vehicles.length;
        if (removed > 0) {
            console.log(`Removed ${removed} completed vehicle(s) (active: ${this.vehicles.length})`);
        }

    }

    spawnVehicleOnRoute(routeIndex: number): Vehicle | null{

        if (routeIndex < 0 || routeIndex >= this.routes.length) {
            console.warn(`Invalid route index ${routeIndex}`);
            return null;
        }

        const route = this.routes[routeIndex];
        const vehicle = new Vehicle(route, this.carModels);
        this.vehicles.push(vehicle);
        this.scene.add(vehicle.model);
        this.totalSpawned++;

        return vehicle;
    }

    getVehicles(): Vehicle[] {
        return [...this.vehicles];
    }

    getVehiclesAtJunction(junctionID: string): Vehicle[] {
        return this.vehicles.filter(vehicle => vehicle.currentJunctionID === junctionID || vehicle.nextJunctionID === junctionID);
    }

    getStats() {
        return {
            active: this.vehicles.length,
            totalSpawned: this.totalSpawned,
            totalCompleted: this.totalCompleted,
            availableRoutes: this.routes.length
        };
    }

    setSpawnConfig(config: Partial<SpawnConfig>): void {
        this.config = { ...this.config, ...config };
    }

    clearAll(): void {
        for (const vehicle of this.vehicles) {
            this.scene.remove(vehicle.model);
            vehicle.dispose();
        }
        this.vehicles = [];
    }

    dispose(): void {
        this.clearAll();
    }
}