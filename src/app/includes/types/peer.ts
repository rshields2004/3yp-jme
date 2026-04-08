/**
 * peer.ts
 * Type definitions for peer-to-peer networking, including message
 * types, connection context, and shared state synchronisation.
 */

import { DataConnection } from "peerjs";
import { IntersectionStructure } from "./intersection";
import { RoundaboutStructure } from "./roundabout";
import { SimConfig } from "./simulation";
import { JunctionConfig } from "./types"

// EXPORTED STRUCTURES

/**
 * Union of structure types that can be serialised for peer transfer
 */
export type ExportedObject = IntersectionStructure | RoundaboutStructure;

// NETWORKING

/**
 * Plain-serialisable representation of a THREE.Group's world transform.
 * Used in NetMessages instead of the raw THREE.Group to avoid circular
 * reference errors when PeerJS JSON-serialises the payload.
 */
export type SerializedGroupTransform = {
    id: string;
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
};

/**
 * All possible messages sent between peers
 */
export type NetMessage = { type: "INIT_CONFIG"; appdata: SharedState } 
    | { type: "REQUEST_CONFIG" }
    | { type: "START" } 
    | { type: "PAUSE" }
    | { type: "RESUME" }
    | { type: "HALT" }
    | { type: "PING" };

// CONTEXT

/**
 * Shape of the peer networking context provided to React components
 */
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

// SHARED STATE

/**
 * The subset of application state that is synchronised between peers
 */
export type SharedState = {
    junctionConfig: JunctionConfig;
    simulationConfig: SimConfig;
    isConfigConfirmed: boolean;
};