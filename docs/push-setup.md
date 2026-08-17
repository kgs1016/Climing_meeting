# 푸시 알림 — 남은 설정 (계정 주인만 할 수 있는 것)

코드·DB·발송 서버는 다 되어 있다. 아래 설정이 끝나야 실제 기기로 알림이 간다.
**설정 전에도 앱은 정상 동작한다** — 발송 서버가 미설정이면 조용히 건너뛴다.

## 어떻게 도는지 (그림)

```
[상대 앱]  관심·수락·메시지  →  Edge Function(push)
                                   ├─ can_notify() 관계 검사 (차단이면 거부)
                                   ├─ push_tokens 에서 기기 토큰 조회
                                   └─ FCM → 아이폰(APNs 경유)·안드로이드
```

iOS 도 FCM 하나로 보낸다 — Firebase 가 APNs 로 넘겨준다.
그래서 Firebase 프로젝트가 하나 필요하다.

## 1. Firebase 프로젝트 만들기

[console.firebase.google.com](https://console.firebase.google.com) → 프로젝트 추가
(이름: hobiday). Google 애널리틱스는 꺼도 된다.

## 2. 안드로이드 앱 등록

프로젝트 설정 → 앱 추가 → Android
- 패키지 이름: `kr.hobiday.app`
- `google-services.json` 다운로드 → **`web/android/app/` 에 넣는다**
- gradle 은 이미 준비돼 있다 (파일이 있으면 자동 적용)

## 3. iOS 앱 등록 + APNs 키 연결

프로젝트 설정 → 앱 추가 → iOS
- 번들 ID: `kr.hobiday.app`
- `GoogleService-Info.plist` 다운로드 → **`web/ios/App/App/` 에 넣는다**

APNs 키 (애플 계정에서):
1. [developer.apple.com](https://developer.apple.com) → Certificates, IDs & Profiles
   → **Keys** → + → 이름 `hobiday-push` → **Apple Push Notifications service (APNs)** 체크 → 등록
2. `.p8` 파일 다운로드 — **한 번만 받을 수 있다. 잘 보관할 것.**
   Key ID 도 적어둔다
3. Identifiers → `kr.hobiday.app` (없으면 생성) → **Push Notifications** capability 켜기
4. Firebase → 프로젝트 설정 → **클라우드 메시징** → Apple 앱 구성
   → APNs 인증 키 업로드 (.p8 + Key ID + Team ID)

## 4. 서비스 계정 키를 Supabase 에 등록

발송 서버(Edge Function)가 FCM 을 부를 때 쓰는 비밀키다.

1. Firebase → 프로젝트 설정 → **서비스 계정** → **새 비공개 키 생성** → JSON 다운로드
2. 터미널에서 (JSON 경로만 바꿔서):

```bash
npx supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat 다운받은키.json)"
```

⚠️ 이 JSON 은 **레포에 넣지 않는다.** google-services.json (안드로이드) 과
GoogleService-Info.plist (iOS) 는 앱에 들어가는 공개 설정이라 커밋해도 되지만,
서비스 계정 키는 발송 권한 그 자체다.

## 5. 확인

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
