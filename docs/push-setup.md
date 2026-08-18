# 푸시 알림 — 남은 설정 (계정 주인만 할 수 있는 것)

코드·DB·발송 서버는 다 되어 있다. 아래 설정이 끝나야 실제 기기로 알림이 간다.
**설정 전에도 앱은 정상 동작한다** — 발송 서버가 미설정이면 조용히 건너뛴다.

## 어떻게 도는지 (그림)

```
[상대 앱]  관심·수락·메시지  →  Edge Function(push)
                                   ├─ can_notify() 관계 검사 (차단이면 거부)
                                   ├─ push_tokens 에서 기기 토큰 조회
                                   ├─ android → FCM (Firebase)
                                   └─ ios     → APNs 직접 (Firebase 안 거침)
```

iOS 는 Firebase 를 거치지 않는다 — 거치려면 iOS 앱에 Firebase SDK 와
네이티브 초기화 코드를 심어야 해서, 서버가 애플(APNs)에 직접 보낸다.
그래서 **Firebase 는 안드로이드용으로만** 쓴다.

## 1. Firebase — 안드로이드만 (5분)

[console.firebase.google.com](https://console.firebase.google.com) → 프로젝트 (hobiday)
→ ⚙️ 프로젝트 설정 → 일반 탭 → 내 앱 → 앱 추가 → **Android**

- 패키지 이름: `kr.hobiday.app`
- `google-services.json` 다운로드 → **`web/android/app/` 에 넣는다** (커밋해도 됨)
- 이후 SDK 안내는 전부 건너뛴다 (gradle 은 이미 준비돼 있다)

**iOS 앱은 Firebase 에 등록하지 않는다.** 이미 등록했어도 해는 없다 — 안 쓸 뿐.

## 2. 애플 APNs 키 (5분)

[developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles

먼저 App ID:
1. **Identifiers** → `kr.hobiday.app` 없으면 생성 (App IDs → App → Explicit)
2. 열어서 **Push Notifications** capability 켜기 → Save

그다음 키:
3. **Keys** → + → 이름 `hobiday-push` → **APNs** 체크 → 등록
4. `.p8` 파일 다운로드 — **한 번만 받을 수 있다. 잘 보관할 것**
5. **Key ID** (10자리) 와 **Team ID** (Membership 페이지) 를 적어둔다

## 3. 비밀키를 Supabase 에 등록 (3분)

터미널에서 (경로·값만 실제 것으로):

```bash
# 안드로이드 발송용 — Firebase > 프로젝트 설정 > 서비스 계정 > 새 비공개 키
npx supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat 서비스계정.json)"

# iOS 발송용
npx supabase secrets set APNS_KEY="$(cat AuthKey_XXXXXXXXXX.p8)"
npx supabase secrets set APNS_KEY_ID=XXXXXXXXXX
npx supabase secrets set APPLE_TEAM_ID=XXXXXXXXXX
```

⚠️ 서비스 계정 JSON 과 .p8 은 **레포에 넣지 않는다.** 발송 권한 그 자체다.
등록 후 다운로드 폴더에서 지운다. (google-services.json 은 공개 설정이라 커밋 OK)

## 키 보관 현황 (2026-08-18 등록 완료)

- 네 개 모두 Supabase secrets 에 들어가 있다 — **파일 원본이 없어도 발송은 돈다**
- `.p8` 원본 + Key ID + Team ID: 비밀번호 관리자에 보관 (다른 서비스에 등록할 때만 필요)
- 서비스 계정 JSON: 보관 안 함 — 필요하면 Firebase 에서 새로 발급
- 잃어버렸을 때: .p8 은 애플에서 새 키 발급 → `supabase secrets set` 으로 교체.
  JSON 도 마찬가지. 둘 다 10분 작업이라 애태울 일이 아니다

## 4. 확인

앱을 빌드해 두 대(또는 계정 2개)로:
1. both 로그인 → 권한 허용 팝업에서 허용
2. A 가 B 에게 관심 → B 폰에 "💌 새 관심이 도착했어요"
3. 알림 탭 → 신청함으로 이동

대시보드 확인: `select * from push_tokens;` 에 기기가 쌓였는지.

## 지금 알림이 가는 순간들

| 언제 | 받는 사람 | 탭하면 |
|---|---|---|
| 관심 도착 | 상대 | 신청함 |
| 관심 수락 | 보낸 사람 | 채팅 |
| 1:1 새 메시지 | 상대 | 채팅 |
| 모임 신청 수락 | 신청자 | 모임 상세 |

모임 단체채팅 알림은 다음 단계 (멤버 목록 조회가 필요해서 서버 쪽 작업).
