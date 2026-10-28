import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El backend lee estos archivos en tiempo de ejecución; hay que incluirlos en el despliegue.
  outputFileTracingIncludes: {
    "/api/chat": ["./agent/**/*", "./fixtures/**/*", "./src/knowledge/**/*"],
  },
};

export default nextConfig;
