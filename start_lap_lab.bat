@echo off
cd /d "%~dp0"
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo FastF1 setup failed. Check the error above and try again.
    pause
    exit /b 1
)
python api_server.py
pause
