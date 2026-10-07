# Apex Lap Lab

A local-first Formula 1 lap replay website using FastF1 session data.

## Run locally

1. Install Python 3.12.
2. Install dependencies with `python -m pip install -r requirements.txt`.
3. Start the app with `python api_server.py`.
4. Open `http://127.0.0.1:8765/`.

The first FastF1 data request needs internet access. Data is cached in `fastf1_cache`.

## Deploy on Render's free plan

The repository includes `render.yaml`, which configures a Python web service
on Render's free plan with a health check. The free plan has no monthly service
charge but may spin down after inactivity, so the first visit after a quiet
period can take a while to load. Its filesystem is temporary; cached FastF1
data can be lost on a restart or redeploy and may need to be downloaded again.

1. Upload **the contents** of this project to the root of a GitHub repository.
   The repository root should contain `render.yaml`, `api_server.py`,
   `requirements.txt`, `index.html`, `style.css`, and `script.js`.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the GitHub repository and select the branch containing these files.
4. Confirm `apex-lap-lab` is using the Free plan, then deploy it. Do not add a
   paid persistent disk if you want to keep the service free.
5. When deployment finishes, open the `onrender.com` URL shown by Render.

After deployment, commits pushed to the selected branch are deployed
automatically. The computer running the browser can be off; Render hosts the
site independently, but free-plan spin-down means it is not guaranteed to stay
awake continuously. Visitors need internet access, and the FastF1 API fetches
data from upstream sources when it is not already cached.

The landing-page AMG driving video is embedded from YouTube and requires
YouTube access. If autoplay is blocked, use the video player's play control.
