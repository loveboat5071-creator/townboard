import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TOWNBOARD",
  description: "견적 및 기획 도구를 제공하는 TOWNBOARD",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <body className="h-full min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
