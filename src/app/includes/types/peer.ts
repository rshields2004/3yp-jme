import { DataConnection } from "peerjs";
import { IntersectionObject, IntersectionStructure } from "./intersection";
import { RoundaboutStructure } from "./roundabout";
import { SimConfig } from "./simulation";
import { JunctionConfig, JunctionObject } from "./types"
import * as THREE from "three";

export type ExportedObject = IntersectionStructure | RoundaboutStructure;

export type NetMessage = { type: "INIT_CONFIG"; appdata: SharedState } 
    | { type: "START" } 
    | { type: "PAUSE" }
    | { type: "RESUME" }
    | { type: "HALT" };

export type PeerContextType = {
    isHost: boolean;
    hostId?: string;
    connections: DataConnection[];
    createHost: () => void;
    joinHost: (id: string) => void;
    send: (msg: NetMessage) => void;
};

export type SharedState = {
    exportedObjects: THREE.Group[];
    junctionConfig: JunctionConfig;
    simulationConfig: SimConfig;
};