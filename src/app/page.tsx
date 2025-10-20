import ControlPanel from "./components/ControlPanel";
import Scene from "./components/Scene";
import { JunctionProvider } from "./context/JunctionContext";

export default function Page() {

    return (
        <JunctionProvider>
            <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
                <Scene />
                <ControlPanel />
            </div>
        </JunctionProvider>
    );
};
