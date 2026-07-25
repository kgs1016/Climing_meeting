/* ══════════════════════════════════════════════════════════
   Supabase 연결 설정
   Supabase 대시보드 > Project Settings > API 에서 복사해 채우세요.

   · url     : Project URL          (예: https://abcdefgh.supabase.co)
   · anonKey : Project API keys > anon / public

   ⚠️ anon 키는 공개돼도 괜찮습니다.
      모든 테이블에 RLS가 켜져 있고 정책이 없어서 직접 접근이 막혀 있으며,
      데이터는 schema.sql의 SECURITY DEFINER 함수로만 오갑니다.
      단, app_config의 admin_key는 절대 코드에 넣지 마세요 (콘솔에서 직접 입력).
   ══════════════════════════════════════════════════════════ */
window.HOBIDAY_CONFIG = {
  url:     'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_ANON_KEY'
};
