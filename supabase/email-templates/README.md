# 인증 메일 (커스텀 SMTP)

Supabase 기본 메일은 발신자가 Supabase 로 뜨고 **템플릿을 저장할 수도 없다.**
커스텀 SMTP 를 붙여야 둘 다 풀린다.

## 순서

### 1. 도메인
`hobiday.kr` 등을 산다. 메일 발송에도 쓰고, Vercel 커스텀 도메인으로도 쓴다
(`hobiday-eight.vercel.app` 보다 가입 이탈이 적다).

### 2. Resend
가입 → **Domains > Add Domain** → 표시되는 DNS 레코드를 도메인 관리 화면에 등록한다.

| 레코드 | 용도 | 없으면 |
|---|---|---|
| **SPF** (TXT) | 이 서버가 우리 도메인으로 보낼 수 있다는 선언 | 스팸함 직행 |
| **DKIM** (TXT/CNAME) | 위조되지 않았다는 서명 | 스팸함 직행 |
| **DMARC** (TXT) | 위 둘이 실패했을 때의 처리 방침 | 지메일·네이버가 거부할 수 있음 |

검증(Verified)까지 보통 몇 분 ~ 몇 시간. **셋 다 초록불이 된 뒤에** 다음으로 간다.

### 3. Supabase 연결
Dashboard > **Project Settings > Authentication > SMTP Settings**

```
Host          smtp.resend.com
Port          465
Username      resend
Password      Resend API 키
Sender email  no-reply@hobiday.kr
Sender name   하비데이
```

Password 는 대시보드에 직접 입력한다. **레포에 넣지 않는다.**

### 4. 템플릿 교체
Dashboard > **Authentication > Emails** 에서 이 폴더의 파일을 붙여넣는다.

| 파일 | 붙여넣을 곳 |
|---|---|
| `confirm-signup.html` | Confirm signup |
| `reset-password.html` | Reset Password |
| `change-email.html` | Change Email Address |

Magic Link · Invite 는 쓰지 않아 그대로 둔다.

### 5. 확인
새 메일 주소로 가입해보고 —

- 발신자가 **하비데이 &lt;no-reply@hobiday.kr&gt;** 로 뜨는지
- **스팸함이 아니라 받은편지함**에 오는지 (지메일·네이버 각각)
- 링크를 눌러 실제로 인증이 되는지

## 알아둘 것

- **한도**: Resend 무료는 월 3,000통 / 일 100통. 사전 모집 60명 규모엔 충분하다.
- **Supabase 발송 제한**: 기본 SMTP 는 시간당 몇 통으로 묶여 있다. 커스텀 SMTP 를
  붙이면 Authentication > Rate Limits 에서 올릴 수 있다. 홍보 직후 가입이 몰릴 때
  막히지 않게 미리 올려둔다.
- **템플릿 문법**: `{{ .ConfirmationURL }}` 처럼 점(.)이 붙는다. Go 템플릿이라
  `{{ ConfirmationURL }}` 로 쓰면 빈칸으로 나간다.
- 메일 클라이언트는 `<style>` 을 버리는 경우가 많아 **CSS 를 전부 인라인**으로 넣었다.
  다크모드 대응도 제각각이라 밝은 배경으로 고정했다.
