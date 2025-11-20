# walking-journal-parser
fills my walking journal automatically (so I don’t have to)

## to use (if you are lazy like me)
**Create a `.env` file** in the same folder as `server.js` with:
```
OPENAI_API_KEY=sk-what-it-is
SPREADSHEET_ID=google-sheet-id
```

**set up Google Cloud:**
   - Create a project
   - Enable the **Google Sheets API**
   - Create a **service account** → download JSON key as `service-account.json`
   - Share your Google Sheet with the **service account email** and give **Editor** access

**install the dependencies**
```
npm install express cors openai googleapis dotenv
```
**run the server**:
```
node server.js
```
**run the client**
just paste in the client script into dev tools

**profit**
you can go into the sheet and see everything (also figure out formatting yourself, im too lazy for that shit)
