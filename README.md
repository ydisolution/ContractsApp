# Contracts App

Local, single-user contract generator. Upload a Word/HTML/TXT template, fill in fields through a form with live preview, sign on a canvas, export a PDF.

## Features

- **Template parser** — detects `{{field}}`, `[field]`, and underscored blanks; auto-classifies by label (`amount`, `date`, `email`, `phone`, `amount_words`).
- **Number → English words** — type `125000` in an `amount_words` field, see `One hundred twenty-five thousand`.
- **Draft persistence** — saves both to a local SQLite and as `.contract.json` in your chosen folder.
- **Signature canvas** — draw with the mouse or touch, embedded in the exported PDF.
- **PDF export** — A4 via Puppeteer (Chromium bundled with the install).
- **Re-open drafts** — drag onto the Drafts tab, file picker, or double-click a `.contract.json` in Windows Explorer after running `register-contract-opener.bat`.

Up to 150 fields per template.

## Run

```
npm install
npm start
```

Open http://localhost:3100.

Port can be overridden: `PORT=4000 npm start`.

## First-time setup

1. Open the app, click **⚙️ הגדרות**, set your **save folder** (e.g. `C:\Users\You\Documents\Contracts`).
2. (Optional) Double-click `register-contract-opener.bat` once — after that, double-clicking any `.contract.json` in Windows reopens the editor on that draft.

## Placeholder syntax in templates

| Syntax | Detected as | Example |
| --- | --- | --- |
| `{{name}}` | field "name", kind guessed from name | `{{client_name}}` |
| `{{name:Label}}` | field "name" with display label "Label" | `{{amount:Sum in Dollars}}` |
| `[name]` | same as `{{name}}` | `[date]` |
| `_______` (4+) | auto-named `field_1`, `field_2`, … | Signature line |
| `{{signature}}` | replaced by the drawn signature image at export | — |

Field kind is inferred from the label (`amount`, `sum`, `price` → amount; `date` → date; `words` → amount_words; etc.).

## License

Private. ClubRRRR internal tool.
