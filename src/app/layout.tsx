import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Screeps Dashboard",
  description: "Screeps game data dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
