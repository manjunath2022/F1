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

During replay, the sidebar shows the current speed, throttle, brake, gear, DRS,
time, acceleration, drag, downforce, drag power, kinetic energy, and inertial
force estimates. A complete per-sample table is available for each loaded lap,
and **Export CSV** saves the selected telemetry and calculated values for all
loaded laps. FastF1 data is sampled (up to 1,200 points per lap here), not a
private raw ECU feed.

The live model has editable driver/equipment mass, car mass, drag area (CdA),
downforce area (ClA), and air density. It calculates drag = ½ρ(CdA)v²,
downforce = ½ρ(ClA)v², drag power = drag × speed, kinetic energy = ½mv²,
acceleration = Δv/Δt, and inertial force = mass × acceleration. The default
inputs are illustrative, not actual driver weights or team car setup. Wind,
DRS aero maps, ride height, road grade, fuel load, and tire behavior are not
available, so aerodynamic values are estimates, not official figures.

To recalculate the exported samples with the standalone Python program, use:

```powershell
python vehicle_physics.py 2024-NOR-telemetry-physics.csv --driver-mass 80 --car-mass 700 --cda 1.0 --cla 3.0 --air-density 1.225 --output calculated.csv
```

The script uses only the Python standard library.

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

The landing-page hero uses a still image of the Mercedes-AMG ONE from the
credited AutoMotoTV YouTube video. The image is served locally from
`amg-one-hero.jpg`; the credit links to the original video.
