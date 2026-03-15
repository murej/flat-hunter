import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flat Hunter",
  description: "Property search automation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
