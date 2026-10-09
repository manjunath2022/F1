# Apex Lap Lab

A local-first Formula 1 lap replay website using FastF1 session data.

## VS Code extension: GPT One

The VS Code chat extension is in the `gpt-one-vscode/` folder. Install Ollama
and a model (`ollama pull qwen2.5-coder:3b`), open that folder in VS Code, and
press **F5**. In the Extension Development Host window, open Chat with
**Ctrl+Alt+I** and use `@gptone` in a message.

To open the Extensions view in VS Code, click the four-square Extensions icon
in the left Activity Bar or press **Ctrl+Shift+X**. GPT One runs the model
locally through Ollama; no hosted AI API key is needed.

## Run locally

1. Install Python 3.12.
2. Install dependencies with `python -m pip install -r requirements.txt`.
3. Start the app with `python api_server.py`.
4. Open `http://127.0.0.1:8765/`.

The first FastF1 data request needs internet access. Loading a session's
telemetry can take a minute or two; the simulator starts with one fastest lap
to reduce the initial response size. Data is cached in `fastf1_cache`.

## Vehicle physics estimates

After replaying a lap, the analysis includes editable driver/equipment mass,
car mass, and drag-area (CdA) inputs. It uses FastF1 speed samples to estimate
kinetic energy, aerodynamic drag, drag power, sampled longitudinal
acceleration, and a mass-times-acceleration force estimate. Driver mass and
car setup are not included in FastF1 telemetry;
the displayed default values are illustrative model inputs, not official
specifications. The model assumes standard air density and does not account
for wind, track gradient, or detailed aero and tire behavior.

For a small standalone version of the same calculations, run
`python vehicle_physics.py` and enter comma-separated speed samples and the
model inputs when prompted. No extra packages are needed for that script.

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

The landing-page Formula 1 footage is embedded from the official Formula 1
YouTube channel, showing the requested section from 0:08 to 0:23. Autoplay may
be blocked by some browsers.
