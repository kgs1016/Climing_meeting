import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },

  // 네이티브 앱(Capacitor)은 서버 없이 파일만 들고 돈다. 그래서 서버가
  // 필요한 기능을 쓰지 않고 out/ 에 정적 파일로 내보낸다.
  // 이 앱은 원래 전부 클라이언트 렌더라 잃는 게 없다 — 데이터는 브라우저에서
  // Supabase 를 직접 부른다.
  //
  // ⚠️ 이 모드에서는 /room/[id] 같은 동적 경로를 만들 수 없다 (빌드 때 id 를
  //    모른다). id 는 ?id= 로 받는다 — src/lib/queryId.ts 참고.
  output: "export",

  // /session -> /session/index.html 로 떨어뜨린다. 네이티브 웹뷰의 파일
  // 서버는 확장자 없는 경로를 index.html 로 찾아야 안정적으로 열린다.
  trailingSlash: true,
};

export default nextConfig;
