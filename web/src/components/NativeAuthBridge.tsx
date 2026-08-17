"use client";

/* 앱에서 소셜 로그인을 마치고 돌아왔을 때를 받아주는 자리.
   화면을 그리지 않고 듣기만 한다. 로그인 화면이 아니라 레이아웃에 두는 이유는,
   로그인 창이 떠 있는 동안 앱이 뒤로 밀렸다가 돌아오면서 로그인 화면이
   사라져 있을 수 있기 때문이다. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onNativeAuthReturn } from "@/lib/nativeAuth";
import { fetchMyProfileDb } from "@/lib/supabase";

export default function NativeAuthBridge() {
  const router = useRouter();

  useEffect(
    () =>
      onNativeAuthReturn(async (ok) => {
        if (!ok) {
          alert("로그인을 완료하지 못했어요. 다시 시도해주세요.");
          router.replace("/login");
          return;
        }
        // 주소를 직접 바꾸지 않고 라우터로 옮긴다 — 앱에는 서버가 없어서
        // 주소로 이동하면 파일을 찾는 단계를 다시 타게 된다.
        const profile = await fetchMyProfileDb();
        router.replace(profile ? "/me" : "/profile/new");
      }),
    [router]
  );

  return null;
}
