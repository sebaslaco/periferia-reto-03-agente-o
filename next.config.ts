import type { NextConfig } from "next";

// El backend lee estos archivos en tiempo de ejecución; hay que incluirlos en el despliegue.
const archivosEnEjecucion = ["./agent/**/*", "./fixtures/**/*", "./src/knowledge/**/*"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/chat": archivosEnEjecucion,
  },
};

export default nextConfig;
