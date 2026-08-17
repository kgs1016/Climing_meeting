/* 네이티브(Capacitor) 빌드.
 *
 *  BUILD_TARGET=native 를 붙여야 next.config 가 output: 'export' 를 켠다.
 *  웹 배포(Vercel)는 이 값 없이 평소대로 돌아서 /intro.html 같은 주소가 살아 있다.
 *
 *  스크립트로 감싼 이유: 윈도우 cmd·PowerShell 에는 "VAR=값 명령" 문법이 없어
 *  package.json 에 그대로 적으면 윈도우에서만 실패한다.
 *
 *  쓰는 법:  npm run sync
 */
import { spawnSync } from "node:child_process";

const env = { ...process.env, BUILD_TARGET: "native" };

// 인자를 배열로 넘기면서 shell: true 를 쓰면 Node 가 경고한다 (이스케이프가
// 안 된 채 이어붙는다). 고정 문자열이라 통째로 넘긴다.
for (const cmd of ["next build", "cap sync"]) {
  const r = spawnSync(cmd, { stdio: "inherit", env, shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
