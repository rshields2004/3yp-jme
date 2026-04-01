/**
 * PeerContext.tsx
 *
 * Provides peer-to-peer networking via PeerJS. Manages host creation,
 * client joining, connection lifecycle, heartbeat pings, and message
 * broadcasting to all connected peers.
 */

import Peer, { DataConnection } from "peerjs";
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { NetMessage, PeerContextType } from "../includes/types/peer";
import { PEER_CONNECTION_TIMEOUT, PEER_PING_INTERVAL, PEER_DISCONNECT_THRESHOLD } from "../includes/constants";


/**
 * Internal React context for peer-to-peer session state.
 */
const PeerContext = createContext<PeerContextType>(null!);

/**
 * Context provider managing PeerJS connections, heartbeat, and data broadcast.
 *
 * @param children - child elements to render
 * @returns the rendered provider wrapping its children
 */
export const PeerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {

    const peerRef = useRef<Peer>(undefined);
    const lastPingRef = useRef<Map<string, number>>(new Map());
    const [connections, setConnections] = useState<DataConnection[]>([]);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectedPeerIds, setConnectedPeerIds] = useState<string[]>([]);
    const [isHost, setIsHost] = useState(false);
    const [hostId, setHostId] = useState<string>();

    const removePeer = (peerId: string) => {
        setConnections(prev => prev.filter(c => c.peer !== peerId));
        setConnectedPeerIds(prev => prev.filter(id => id !== peerId));
        lastPingRef.current.delete(peerId);
    };


    const createHost = () => {
        setConnectionError(null);
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const peer = new Peer(code, {
            host: "rshields.xyz",
            port: 443,
            path: "/peerjs",
            secure: true,
            debug: 3,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    {
                        urls: "turn:rshields.xyz:3478",
                        username: "peeruser",
                        credential: "strongpassword123"
                    }
                ]
            }
        });
        peerRef.current = peer;
        setIsHost(true);

        peer.on('open', id => {
            setHostId(id);
        });

        peer.on('connection', conn => {
            conn.on('open', () => {
                setConnections(prev => [...prev, conn]);
                setConnectedPeerIds(prev => [...prev, conn.peer]);
                lastPingRef.current.set(conn.peer, Date.now());
            });

            conn.on("data", (data) => {
                const msg = data as NetMessage;
                if (msg.type === "PING") {
                    lastPingRef.current.set(conn.peer, Date.now());
                    return;
                }
            });

            conn.on('close', () => {
               removePeer(conn.peer)
            });

            conn.on('error', () => {
                removePeer(conn.peer)
            });
        });
    };

    const joinHost = (id: string) => {
        if (!id.trim()) {
            return;
        }
        setConnectionError(null);
        setIsConnecting(true);
        
        const peer = new Peer({
            host: "rshields.xyz",
            port: 443,
            path: "/peerjs",
            secure: true,
            debug: 3,
            config: {
                iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                    {
                        urls: "turn:rshields.xyz:3478",
                        username: "peeruser",
                        credential: "strongpassword123"
                    }
                ]
            }
        });
        peerRef.current = peer;

        peer.on('open', () => {
            const conn = peer.connect(id.trim());

            const timeout = setTimeout(() => {
                if (!conn.open) {
                    setConnectionError("Timed out. Check code and try again");
                    setIsConnecting(false);
                    conn.close();
                }
            }, PEER_CONNECTION_TIMEOUT);

            conn.on("open", () => {
                clearTimeout(timeout);
                setIsConnecting(false);
                setConnections([conn]);
            });

            conn.on("close", () => {
                setConnections([]);
                setConnectionError("Host Disconnected.");
            })

            conn.on("error", (error) => {
                clearTimeout(timeout);
                setIsConnecting(false);
                setConnectionError(`Connection failed: ${error}`);
            });
        });

        peer.on("disconnected", () => {
            setConnections([]);
            setConnectionError("Lost connection to host.");
        });

        peer.on("error", (error) => {
            setIsConnecting(false);
            setConnectionError(`Could not connect: ${error.message ?? error}`);
        });
    };

    const disconnect = () => {
        connections.forEach(conn => conn.close());
        peerRef.current?.destroy();
        peerRef.current = undefined;
        setConnections([]);
        setConnectedPeerIds([]);
        setIsHost(false);
        setHostId(undefined);
        setConnectionError(null);
        lastPingRef.current.clear();
    };

    const send = (msg: NetMessage) => {
        connections.forEach(conn => {
            if (conn.open) {
                conn.send(msg);
            }
        });
    };

    // Periodically check for disconnected peers by comparing last-seen timestamps (host only)
    useEffect(() => {
        if (!isHost) return;

        const interval = setInterval(() => {
            const now = Date.now();
            lastPingRef.current.forEach((lastSeen, peerId) => {
                if (now - lastSeen > PEER_DISCONNECT_THRESHOLD) {  // missed 2 pings
                    removePeer(peerId);
                    lastPingRef.current.delete(peerId);
                }
            });
        }, PEER_PING_INTERVAL);

        return () => clearInterval(interval);
    }, [isHost]);

    return (
        <PeerContext.Provider
            value={{ 
                isHost,
                hostId,
                connections,
                createHost,
                joinHost,
                send,
                disconnect,
                connectionError,
                isConnecting,
                connectedPeerIds,
            }}
        >
            { children }
        </PeerContext.Provider>
    )
};

/**
 * Convenience hook to access the PeerContext.
 * @returns the peer context
 */
export const usePeer = () => useContext(PeerContext);