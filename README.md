# Apex Lap Lab

A local-first Formula 1 lap replay website using FastF1 session data.

## Run locally

1. Install Python 3.12.
2. Install dependencies with `python -m pip install -r requirements.txt`.
3. Start the app with `python api_server.py`.
4. Open `http://127.0.0.1:8765/`.

The first FastF1 data request needs internet access. Data is cached in `fastf1_cache`.

## Deploy as an always-on website with Render

The repository includes `render.yaml`, which configures the Python web service,
a health check, the FastF1 cache disk, and the paid Starter plan so the service
does not sleep like a free instance. Hosting and persistent storage may incur
charges; review Render's current pricing before deploying.

1. Upload **the contents** of this project to the root of a GitHub repository.
   The repository root should contain `render.yaml`, `api_server.py`,
   `requirements.txt`, `index.html`, `style.css`, and `script.js`.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the GitHub repository and select the branch containing these files.
4. Review the `apex-lap-lab` web service and its Starter plan and persistent
   disk, then approve deployment.
5. When deployment finishes, open the `onrender.com` URL shown by Render.

After deployment, commits pushed to the selected branch are deployed
automatically. The computer running the browser can be off; the Render service
stays online independently. Visitors still need internet access, and the
FastF1 API fetches data from upstream sources when it is not already cached.

The landing-page AMG driving video is embedded from YouTube and requires
YouTube access. If autoplay is blocked, use the video player's play control.
