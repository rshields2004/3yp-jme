import Peer, { DataConnection } from "peerjs";
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { NetMessage, PeerContextType } from "../includes/types/peer";


const PeerContext = createContext<PeerContextType>(null!);

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
            }, 8000);

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

    useEffect(() => {
        if (!isHost) return;

        const interval = setInterval(() => {
            const now = Date.now();
            lastPingRef.current.forEach((lastSeen, peerId) => {
                if (now - lastSeen > 8000) {  // missed 2 pings
                    removePeer(peerId);
                    lastPingRef.current.delete(peerId);
                }
            });
        }, 5000);

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

export const usePeer = () => useContext(PeerContext);