import { DataConnection } from "peerjs";
import { IntersectionObject, IntersectionStructure } from "./intersection";
import { RoundaboutStructure } from "./roundabout";
import { SimConfig } from "./simulation";
import { JunctionConfig, JunctionObject } from "./types"

export type ExportedObject = IntersectionStructure | RoundaboutStructure;

/**
 * Plain-serializable representation of a THREE.Group's world transform.
 * Used in NetMessages instead of the raw THREE.Group to avoid circular
 * reference errors when PeerJS JSON-serialises the payload.
 */
export type SerializedGroupTransform = {
    id: string;
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
};

export type NetMessage = { type: "INIT_CONFIG"; appdata: SharedState } 
    | { type: "REQUEST_CONFIG" }
    | { type: "START" } 
    | { type: "PAUSE" }
    | { type: "RESUME" }
    | { type: "HALT" }
    | { type: "PING" };

export type PeerContextType = {
    isHost: boolean;
    hostId?: string;
    connections: DataConnection[];
    createHost: () => void;
    joinHost: (id: string) => void;
    send: (msg: NetMessage) => void;
    disconnect: () => void;
    connectionError: string | null;
    isConnecting: boolean;
    connectedPeerIds: string[];
};

export type SharedState = {
    junctionConfig: JunctionConfig;
    simulationConfig: SimConfig;
    isConfigConfirmed: boolean;
};