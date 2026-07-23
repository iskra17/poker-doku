import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev 모드에서 localhost 외 오리진(모바일/Tailscale/브라우저 QA용 127.0.0.x 신규 유저 격리) 접근 허용
  allowedDevOrigins: ["100.86.4.110", "desktop-94onog5", "*.ts.net", "127.0.0.*"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
