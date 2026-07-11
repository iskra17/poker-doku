import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev 모드에서 localhost 외 오리진(모바일/Tailscale) 접근 허용
  allowedDevOrigins: ["100.86.4.110", "desktop-94onog5", "*.ts.net"],
};

export default nextConfig;
