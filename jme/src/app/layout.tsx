import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "JME - An Online Traffic Simulator",
    description: "Junction Modeller Expanded: 3D Traffic Simulation with Multi-Client Viewing and Crash Dynamics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </head>
            <body>
                {children}
            </body>
        </html>
    );
}