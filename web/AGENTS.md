<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 새 화면은 `[id]` 동적 경로를 쓰지 않는다

이 앱은 `output: 'export'` 로 정적 파일만 내보낸다. 네이티브 앱(Capacitor)은
서버 없이 폰에 설치된 파일을 웹뷰가 직접 열기 때문이다. 그래서 주소의
**경로 부분은 빌드 시점에 파일이 존재해야** 한다.

모임 id 는 출시 뒤에 유저가 만드는 값이라 파일을 미리 만들 수 없다.

```
✗  app/session/[id]/page.tsx      →  /session/abc-123   빌드 불가
✓  app/session/page.tsx           →  /session?id=abc-123
```

id 는 `useQueryId()` (`src/lib/queryId.ts`) 로 읽는다. `useSearchParams` 는
페이지 전체를 Suspense 로 감싸게 만들어서 쓰지 않는다.

`[id]` 를 추가하면 `next build` 가 실패한다 — 배포와 앱 빌드가 함께 막힌다.

## 확인

```bash
npm run sync      # next build && cap sync — 빌드 + 네이티브 반영
```
