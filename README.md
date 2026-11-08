# Query Assistant | Frontend

Supabase-backed deployments support resumable PDF processing. Set the backend
origin in Connection settings. Uploads are limited to 4 MB per PDF; use **Resume
saved documents** after interrupted processing. Deploy this frontend together
with the updated backend; credentials remain on the backend.

A responsive document intelligence workspace for uploading PDFs, searching passages, and asking questions with source citations.

Built with HTML, CSS, and native JavaScript modules. A lightweight Node.js server supports local development; no frontend dependencies or build step are required.

## Features

- Animated hero, custom light-streak logo, and blue-and-gold visual theme.
- Glass buttons, responsive layouts, keyboard interactions, and reduced-motion support.
- Customer Support and Legal Assistant workspaces.
- Custom knowledge bases with user-defined names and rename support.
- PDF upload with drag and drop and live processing logs.
- Document counts, page totals, and indexed-passage status.
- Document chat with follow-up context and expandable page citations.
- Passage search without generating an AI answer.
- English interface; answers follow English or Roman Urdu questions.

## Requirements

- Node.js 20 or later.
- A running Query Assistant backend using `api_server.py`.
- A modern browser with JavaScript enabled.

## Quick start

From this project's directory:

```powershell
npm.cmd run dev
```

Open **http://localhost:3000**. On macOS or Linux, use `npm run dev`. Windows commands use `npm.cmd` to avoid PowerShell script-policy errors.

No `npm install` is needed. Keep the terminal running while using the local website.

Start the backend in a separate terminal, following its [setup guide](../ocr-backend/README.md). The default API address is **http://localhost:8000**.

## Using the workspace

1. Select an assistant from the dropdown.
2. Click **Use bundled documents**, or choose a PDF and click **Upload & process**.
3. Wait until processing completes and searchable passages appear.
4. Ask a question, or switch to **Search passages**.
5. Expand supporting sources to inspect document names, page numbers, and excerpts.

For a new topic, click **+ New knowledge base**, enter a name, and upload related PDFs. Multiple PDFs can belong to the same knowledge base. Search and answers use only the selected knowledge base.

Custom names remain saved on the backend across reloads and restarts. **Rename** changes the display name without changing documents or indexed content. **Process saved documents** processes previously uploaded PDFs again, subject to the backend's duplicate checks.

**Reset this knowledge base** clears its indexed content and processing registry while keeping uploaded PDFs and the dropdown entry. **Clear conversation** clears the active chat or search view only.

## Configuration

Open **Processing settings > Connection settings** to change the backend URL. Enter the server origin, such as `https://api.example.com`, without `/api`. The browser remembers this setting locally.

| Setting | Behavior |
| --- | --- |
| API URL | Defaults to `http://localhost:8000` |
| Use LLM normalization | Requests model-assisted PDF cleanup |
| Reprocess existing PDF | Requests forced ingestion |
| Retrieved passages | Selects 1-20 passages for chat or search |
| Local server port | Set `PORT` before running the development server |

Chat history is stored in browser memory and is cleared on page reload. Documents, vectors, and knowledge-base names are stored by the backend. Keep provider API keys on the backend; this static frontend does not read `.env` files.

## Project structure

```text
ocr-frontend/
|-- assets/
|   |-- background-ocr.png
|   `-- Query-Assistant-logo.png
|-- tests/api.test.mjs
|-- index.html             # Page structure and dialogs
|-- styles.css             # Layout, typography, and animations
|-- app.js                 # Workspace state and interactions
|-- api.js                 # HTTP requests and ingestion stream parsing
|-- server.mjs             # Local static server
|-- package.json           # Development and verification commands
`-- .gitignore
```

## Backend integration

The frontend targets **`api_server.py`**. The older backend `api.py` uses a different contract.

All routes are prefixed with `/api`. Ingestion returns newline-delimited JSON with `log`, `done`, or `error` events. Chat and search return structured sources, rendered as text rather than inserted as HTML.

See the [backend API reference](../ocr-backend/README.md#api-reference) for endpoint details.

## Verification

```powershell
npm.cmd run check
npm.cmd test
```

Syntax checks cover the JavaScript modules and local server. Tests cover ingestion-stream boundaries, backend errors, incomplete streams, and HTTP error handling. They do not exercise a live embedding model or browser layout.

## Deployment

This is a static website. For Vercel, import the GitHub repository and configure:

| Setting | Value |
| --- | --- |
| Root directory | `ocr-frontend` for a combined repository; repository root for a frontend-only repository |
| Framework preset | Other |
| Build command | Empty |
| Output directory | `.` |

Vercel can serve HTML, CSS, and JavaScript without a build step. See [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build).

Deploy the Python backend separately with persistent storage. Set its public HTTPS URL in connection settings and add the frontend's exact origin to the backend CORS allowlist. For a shared default, update the fallback URL in `app.js` before deploying. The local Node server is not the production runtime on Vercel.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Backend unavailable | Start `api_server.py`, check its URL, and verify `/api/health`. |
| Browser blocks requests | Add the frontend origin to backend CORS settings; use HTTPS for a hosted backend. |
| Question box is disabled | Process a PDF and wait for searchable passages to appear. |
| Processing appears slow | Check the live logs and backend terminal; the first ingestion may download the embedding model. |
| Answers fail but search works | Configure `DEEPSEEK_API_KEY` on the backend. |
| Styling looks outdated | Refresh with Ctrl + F5. |

Google Fonts are optional; the interface falls back to system fonts. Public backend access control is handled outside this frontend.
