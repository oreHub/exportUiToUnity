@echo off
rem UI export tool setup (Python 3.10)
cd /d "%~dp0"
py -3.10 --version || (echo Python 3.10 not found. Install it from python.org first. & pause & exit /b 1)
if not exist .venv py -3.10 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
echo.
echo Done. Run:  .venv\Scripts\python.exe export_ui.py ^<PSD^> ^<UIExport^> --screen Home
pause
