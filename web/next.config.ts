import type { NextConfig } from "next";
import path from "path";

/* 네이티브 앱(Capacitor)은 서버 없이 파일만 들고 돌기 때문에 정적 파일로
   내보내야 한다. 그런데 Vercel 은 정적 내보내기 프로젝트에서 .html 확장자
   주소를 404 로 돌린다 — 홍보에 쓰는 /intro.html 이 죽는다.

   그래서 export 는 네이티브 빌드에서만 켠다.

     웹 배포 (Vercel)   next build                    ← 평소대로
     네이티브 빌드      BUILD_TARGET=native npm run sync

   ⚠️ export 모드에서는 /room/[id] 같은 동적 경로를 만들 수 없다 (빌드 때
      id 를 모른다). 그래서 경로 구조는 양쪽 공통으로 ?id= 를 쓴다 —
      src/lib/queryId.ts 참고. 새 화면에 [id] 를 추가하면 네이티브 빌드가
      깨진다 (AGENTS.md).

   trailingSlash 는 켜지 않는다. 켜면 Vercel 이 슬래시 붙은 주소로만
   서빙해서 주소 형태가 또 한 번 바뀐다. */
const native = process.env.BUILD_TARGET === "native";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },

  ...(native ? { output: "export" as const } : {}),
};

export default nextConfig;
