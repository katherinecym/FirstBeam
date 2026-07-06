import requests
import time
import json

session_id = "sess_" + str(int(time.time() * 1000))
requests.post(f"http://localhost:7040/apps/app/users/firstbeam_user/sessions/{session_id}")

res = requests.post("http://localhost:7040/run", json={
    "app_name": "app",
    "user_id": "firstbeam_user",
    "session_id": session_id,
    "message": "shrink_task:Study for exams"
})
print(res.status_code)
print(json.dumps(res.json(), indent=2))
