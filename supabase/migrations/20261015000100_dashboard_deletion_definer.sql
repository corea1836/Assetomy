-- Auth가 사용자를 지울 때 cascade로 uploads가 지워지면 이 트리거는 Auth 역할로 실행되는데,
-- 그 역할에는 upload_attempts 권한이 없어 사용자 삭제 전체가 실패한다. 이 함수만 소유자 권한으로 돌린다.
alter function private.record_upload_deletion() security definer;
