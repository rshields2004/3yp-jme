import Peer, { DataConnection } from "peerjs";
import { createContext, useContext, useRef, useState } from 'react';
import { JunctionConfig } from "../includes/types/types";
import { SimConfig } from "../includes/types/simulation";
import { NetMessage, PeerContextType } from "../includes/types/peer";


const PeerContext = createContext<PeerContextType>(null!);

export const PeerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {

    const peerRef = useRef<Peer>(undefined);
    const [connections, setConnections] = useState<DataConnection[]>([]);
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
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', () => {
            const conn = peer.connect(id);
            setConnections([conn]);
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
            }}
        >
            { children }
        </PeerContext.Provider>
    )
};

export const usePeer = () => useContext(PeerContext);