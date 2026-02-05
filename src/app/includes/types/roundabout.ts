import * as THREE from "three";
import { ExitConfig, LaneLineProperties, LaneStructure } from "./types";
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
};

export type RoundaboutConfig = {
    numExits: number;
    exitConfig: ExitConfig[];
};

export type RoundaboutObject = {
    id: string;
    type: "roundabout";
    config: RoundaboutConfig;
};