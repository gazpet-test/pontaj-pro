@echo off
rem Lansator unic Paw (v2-server, 09.10.2026). Apel: run_paw.cmd <cine> <brief.md> <iesire.log> [model] [imagini.txt]
rem gem: model=argon sau argon:eticheta. Inchidere: run_paw.cmd gem-inchide eticheta log
rem cine = cdx (arg4=slug) | jak | cop | ollie | gem (v4.4: gem = Gemini 4 Argon, consultant suplimentar). Codul sta in ProgramData\Gazpet\Paw\bin (ACL), datele in C:\Users\Public\paw-data.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_paw.ps1" -Cine "%~1" -Brief "%~2" -Out "%~3" -Model "%~4" -Imagini "%~5"
exit /b %ERRORLEVEL%
