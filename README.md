# JobAssist AI - Chrome Extension

Smart Chrome Extension for job seekers and HR professionals. Uses AI to extract job details, match CVs, and auto-fill application forms.

## Features

- **Extract Job Details** - Reads any job page (LinkedIn, Indeed, Rozee.pk, Glassdoor)
- **AI CV Parser** - Upload PDF CVs, AI extracts details automatically
- **Smart Auto-Fill** - Fills entire application forms using your CV + AI intelligence
- **CV Matching** - Finds the best CV for each job with a match score
- **Learning System** - Saves your answers for future use

## Tech Stack

- Vanilla JavaScript (no framework)
- Chrome Extension Manifest V3
- Groq AI (Llama 3.3 70B)
- PDF.js for resume parsing
- Chrome Storage API

## Setup

1. Clone this repo
2. Get a free Groq API key from https://console.groq.com/keys
3. Replace `YOUR_GROQ_API_KEY_HERE` in these 3 files with your key:
   - `config.js`
   - `popup/popup.js`
   - `background/service-worker.js`
4. Open `chrome://extensions` in Chrome
5. Enable "Developer mode"
6. Click "Load unpacked" and select the project folder
7. Pin the extension to your toolbar

## Usage

1. **Upload your CVs** (PDF) in the "My CVs" tab
2. **Open any job page** and click "Extract Job from Page"
3. **Open an application form** and click "Auto-Fill This Page"
4. AI fills everything automatically!

## Project Structure

```
extensi/
├── manifest.json           # Extension config
├── popup/                  # Popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/                # Content script (DOM access)
│   ├── detector.js
│   └── overlay.css
├── background/             # Service worker
│   └── service-worker.js
├── lib/                    # PDF.js library
└── icons/                  # Extension icons
```

## Author

Built by Areesha as a first Chrome Extension project.
