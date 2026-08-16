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

  // trailingSlash 는 켜지 않는다.
  // 켜면 Vercel 이 .html 을 떼고 슬래시 붙은 주소로만 서빙해서
  // /intro.html (홍보에 쓰는 랜딩 주소) 이 404 가 된다.
  // 네이티브 웹뷰는 index.html 을 열고 이후 이동이 전부 클라이언트 라우팅이라
  // 이 설정이 없어도 된다.
};

export default nextConfig;
