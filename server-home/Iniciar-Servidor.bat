@echo off
title YTGrab Servidor de Casa
echo.
echo   Deixa esta janela ABERTA enquanto quiser que o site use seu PC.
echo   Pra desligar: fecha a janela (ou Ctrl+C).
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0ytgrab-servidor.ps1"
pause
