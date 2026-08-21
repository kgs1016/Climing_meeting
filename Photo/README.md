# 스토어 등록 자산

앱스토어·플레이스토어에 올리는 이미지 모음. 규격이 스토어마다 달라서
같은 화면을 크기별로 만들어 둔다.

| 폴더 | 규격 | 쓰는 곳 |
| --- | --- | --- |
| `source/` | 1179×2556 | 아이폰 원본 캡처 (여기서 아래 것들을 만든다) |
| `appstore-6.5/` | 1284×2778 | App Store — iPhone 6.5" 슬롯 |
| `appstore/` | 1290×2796 | App Store — iPhone 6.7"/6.9" 슬롯 |
| `playstore/screenshots/` | 1080×1920 (9:16) | Play Store — 휴대전화 스크린샷 |
| `playstore/icon-512.png` | 512×512 | Play Store 앱 아이콘 |
| `playstore/feature-1024x500.png` | 1024×500 | Play Store 피처 그래픽 |

## 새로 만들 때

원본을 `source/` 에 넣고 Pillow 로 변환한다. 스토어별 비율이 달라서
앱스토어는 늘리고(비율 동일), 플레이스토어는 좌우에 앱 배경색(#0f0e0d)을
덧대 9:16 을 맞춘다.

## 주의

- 지금 스크린샷의 프로필 사진은 테스트 계정의 AI 이미지다.
  정식 오픈 뒤에는 실제 사용자 사진으로 교체하는 게 좋다 (스토어 자산은 언제든 수정 가능).
- 앱 아이콘 원본은 `web/ios/App/App/Assets.xcassets/AppIcon.appiconset/` 에 있다.
