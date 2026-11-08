@echo off
rem ------------------------------------------------------------
rem Run script for the Teacher project
rem ------------------------------------------------------------

rem Use the same AI model and endpoint as the "Study helper" project
rem (DeepSeek model accessed via an OpenAI‑compatible endpoint).
set "AI_PROVIDER=openai-compatible"
set "DEEPSEEK_BASE_URL=http://127.0.0.1:9655/v1"
set "DEEPSEEK_MODEL=deepseek-reasoner"
set "DEEPSEEK_API_KEY="
set "AI_KEY="

rem Keep the legacy OpenAI-compatible variables in sync as well
set "OPENAI_MODEL=deepseek-reasoner"
set "OPENAI_BASE_URL=http://127.0.0.1:9655/v1"

rem Optional: set the server port (default is 3001 in the code)
set "PORT=3001"

rem Install npm dependencies if they are missing
if not exist node_modules (
    echo Installing npm dependencies... && npm install
)

rem Start the backend (Express) server in a separate window
start "Teacher Backend" cmd /c "node server.js"

rem Give the backend a moment to start (optional)
timeout /t 2 > nul

rem Start the Vite development server (frontend)
npm run dev
