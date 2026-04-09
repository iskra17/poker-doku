import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poker Doku - ポーカー道場",
  description: "Anime-style online poker room with visual novel aesthetics",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Poker Doku",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-dvh bg-grid overflow-hidden touch-manipulation">{children}</body>
    </html>
  );
}
