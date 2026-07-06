import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google.adk.cli.fast_api import get_fast_api_app

# Resolve absolute path to the google-app directory
BASE_DIR = "/Users/katherine/Desktop/压力分解器/google-app"

# 1. Build the ADK FastAPI server
app = get_fast_api_app(
    agents_dir=BASE_DIR,
    web=True,
    trigger_sources=["pubsub"]
)

# 2. Add CORS Middleware to support development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi import Request
@app.middleware("http")
async def add_api_key(request: Request, call_next):
    api_key = request.headers.get("X-API-Key")
    if api_key:
        os.environ["GEMINI_API_KEY"] = api_key
    response = await call_next(request)
    return response

# 3. Serve Custom Frontend
# We define a custom route for "/" that serves our premium index.html.
# To override the default redirect, we place this route at the beginning.
@app.get("/", include_in_schema=False)
async def read_index():
    response = FileResponse(os.path.join(BASE_DIR, "index.html"))
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Force our route to take precedence over ADK's default redirect
app.router.routes.insert(0, app.router.routes.pop())

# Mount the static directory to serve index.css and app.js
app.mount("/static", StaticFiles(directory=BASE_DIR), name="static_frontend")
