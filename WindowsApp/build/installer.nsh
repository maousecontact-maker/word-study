; electron-builder가 설치 프로그램에 자동으로 넣는 파일입니다.
;
; 기본 설치 프로그램은 열려 있는 단어장을 "부드럽게" 끄려다 실패하면
; "단어장 cannot be closed" 창을 띄우고 멈춥니다.
; 그래서 설치/제거 전에 이 사용자의 단어장(WordStudy.exe)과 딸린 프로세스를 전부 강제로 끕니다.
; (데이터는 앱이 바뀔 때마다 바로 저장하므로 강제로 꺼도 기록이 사라지지 않습니다.)
!macro customCheckAppRunning
  DetailPrint "열려 있는 단어장을 닫는 중..."
  nsExec::Exec `"$CmdPath" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  Pop $0
  ; 파일 잠금이 풀릴 때까지 잠깐 기다림
  Sleep 1500
!macroend
