import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "PARTY.exe | Team Party", description: "The official party scoreboard and live challenges." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
