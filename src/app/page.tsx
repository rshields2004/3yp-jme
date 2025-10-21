import DebugPanel from "./components/DebugPanel";
import Scene from "./components/Scene";
import { JModellerProvider } from "./context/JModellerContext";

export default function Page() {

    return (
        <JModellerProvider>
            <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
                <Scene />
                <DebugPanel />
            </div>
        </JModellerProvider>
    );
};
