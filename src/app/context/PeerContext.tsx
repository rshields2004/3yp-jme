import Peer, { DataConnection } from "peerjs";
import { createContext, useContext, useRef, useState } from 'react';
import { JunctionConfig } from "../includes/types/types";
import { SimConfig } from "../includes/types/simulation";
import { NetMessage, PeerContextType } from "../includes/types/peer";


const PeerContext = createContext<PeerContextType>(null!);

export const PeerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {

    const peerRef = useRef<Peer>(undefined);
    const [connections, setConnections] = useState<DataConnection[]>([]);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [hostId, setHostId] = useState<string>();

    const createHost = () => {
        const peer = new Peer();
        peerRef.current = peer;
        setIsHost(true);

        peer.on('open', id => {
            setHostId(id);
            console.log('Host ID:', id);
        });

        peer.on('connection', conn => {
            setConnections(prev => [...prev, conn]);
        });
    };

    const joinHost = (id: string) => {
        if (!id.trim()) {
            return;
        }
        setConnectionError(null);
        setIsConnecting(true);
        
        const peer = new Peer();
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

            conn.on("error", (error) => {
                clearTimeout(timeout);
                setIsConnecting(false);
                setConnectionError(`Connection failed: ${error}`);
            });
        });

        peer.on("error", (error) => {
            setIsConnecting(false);
            setConnectionError(`Could not connect: ${error.message ?? error}`);
        });
    };

    const send = (msg: NetMessage) => {
        connections.forEach(conn => {
            if (conn.open) {
                conn.send(msg);
            }
        });
    };

    return (
        <PeerContext.Provider
            value={{ 
                isHost,
                hostId,
                connections,
                createHost,
                joinHost,
                send,
                connectionError,
                isConnecting
            }}
        >
            { children }
        </PeerContext.Provider>
    )
};

export const usePeer = () => useContext(PeerContext);