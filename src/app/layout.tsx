import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR, Jua } from "next/font/google";
import ProgressionLifecycle from '@/components/progression/ProgressionLifecycle';
import ArenaLifecycle from '@/components/arena/ArenaLifecycle';
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-kr",
  display: "swap",
});

const jua = Jua({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-jua",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Poker Doku",
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
    <html lang="ko" className={`${notoSansKr.variable} ${jua.variable} h-full antialiased`}>
      <body className="h-dvh bg-grid overflow-hidden touch-manipulation">
        <ProgressionLifecycle />
        <ArenaLifecycle />
        {children}
      </body>
    </html>
  );
}
