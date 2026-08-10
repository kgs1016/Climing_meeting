import type { MetadataRoute } from "next";

/* 홈 화면에 추가하면 주소창 없는 전체화면으로 뜨게 하는 설정.
   앱스토어 배포 없이 아이폰·안드로이드에서 앱처럼 쓰기 위한 최소 구성. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "호비데이 HOBIDAY",
    short_name: "호비데이",
    description: "취미로 시작해서, 사람으로 끝나는 하루 — 볼더링 모임 매칭",
    start_url: "/",
    display: "standalone", // 주소창·탭 숨김
    background_color: "#0f0e0d",
    theme_color: "#0f0e0d",
    lang: "ko",
    icons: [
      // apple-icon.tsx / icon.tsx 가 빌드 때 PNG 로 생성된다
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
