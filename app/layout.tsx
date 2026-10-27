import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agente de órdenes de compra",
  description: "Asistente de compras con SAP simulado – Reto 3 Periferia IT Group",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
