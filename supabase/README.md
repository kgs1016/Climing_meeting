# 마이그레이션 규칙

## 파일명은 시각 형식

```
YYYYMMDDHHMMSS_설명.sql        예: 20260815193457_capacity_max_two.sql
```

`001_`, `002_` 같은 순번은 **쓰지 않는다.** 두 사람이 각자 브랜치에서 작업하면
같은 번호를 만들게 되고, CLI 는 번호로만 적용 여부를 판단하기 때문에
나중에 병합된 쪽이 **에러 없이 조용히 건너뛰어진다.**

새 파일을 만들 때:

```bash
npx supabase migration new 설명
```

이렇게 하면 현재 시각으로 파일이 생성된다.

## 적용

```bash
npx supabase db push
```

로컬에 있고 원격에 없는 것만 순서대로 적용된다.
적용 전에 확인하려면 `--dry-run` 을 붙인다.

상태 확인:

```bash
npx supabase migration list      # 로컬 ↔ 원격 대조
```

## 처음 쓰는 사람

```bash
npx supabase login
npx supabase link --project-ref loigwslmwvltdurjttpe
```

`link` 는 DB 비밀번호를 묻는다 (대시보드 > Project Settings > Database).

## 이미 손으로 적용한 마이그레이션이 있다면

대시보드에서 직접 실행한 SQL 은 CLI 가 모른다. 그대로 `db push` 하면
다시 실행되므로, 먼저 "적용됨" 으로 표시한다:

```bash
npx supabase migration repair --status applied <버전>
```

## 주의

- 마이그레이션은 **몇 번 실행해도 안전하게** 쓴다
  (`create or replace`, `if not exists`, 제약은 `drop ... if exists` 후 재생성)
- 금액·정원 같은 값이 앱 코드에도 있으면 **양쪽을 함께 바꾼다.**
  한쪽만 바꾸면 화면 문구와 실제 동작이 어긋난다
  (예: `credit_rule()` ↔ `web/src/lib/supabase.ts` 의 `REQUEST_COST`)
