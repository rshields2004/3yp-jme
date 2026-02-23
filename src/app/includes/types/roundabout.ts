import * as THREE from "three";
import { ExitConfig, LaneLineProperties, LaneStructure, ObjectTransform } from "./types";
import { Tuple3 } from "./simulation";


export type RoundaboutExitStructure = {
    angle: number;            
    laneLines: LaneStructure[];    
    stopLine: RingLaneStructure;       
};

export type RingLaneStructure = {
    radius: number;
    points: Tuple3[];
    properties: LaneLineProperties;
};

export type RoundaboutStructure = {
    id: string;
    islandGeometry: THREE.CircleGeometry;
    floorCircle: THREE.RingGeometry;
    ringLines: RingLaneStructure[];
    roundaboutFloor: THREE.ShapeGeometry;
    exitStructures: RoundaboutExitStructure[];
    edgeTubes: THREE.TubeGeometry[];
    maxDistanceToStopLine: number;     
    islandRadius: number;
    outerRadius: number;       
    avgRadius: number;         
    laneMidRadii: number[];       
};

export type RoundaboutConfig = {
    numExits: number;
    exitConfig: ExitConfig[];
};

export type RoundaboutObject = {
    id: string;
    name: string;
    type: "roundabout";
    config: RoundaboutConfig;
    /** World transform set by the host and consumed by the client on mount. */
    transform?: ObjectTransform;
};