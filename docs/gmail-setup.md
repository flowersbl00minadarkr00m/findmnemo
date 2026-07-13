# FindMnemo Gmail Setup

FindMnemo uses a Google OAuth 2.0 **Desktop app** client and requests only `https://www.googleapis.com/auth/gmail.metadata`.

1. Create or select a Google Cloud project.
2. Configure the OAuth consent screen and add the Gmail account as a test user while the app remains in testing.
3. Create an OAuth client with application type **Desktop app**.
4. Set `FINDMNEMO_GOOGLE_CLIENT_ID` in the local companion environment. Set `FINDMNEMO_GOOGLE_CLIENT_SECRET` only when the downloaded Desktop client configuration includes one.
5. Build and start the companion, pair the browser, then use the Gmail connect action.

The companion opens Google's consent page in the system browser and receives the callback on a temporary random loopback port. The refresh credential is protected with Windows DPAPI `CurrentUser`; access credentials stay in process memory. Neither value belongs in `.env.example`, source control, browser storage, Supabase, logs, or exports.

Existing `gmcli` files are not imported. Re-authenticate through FindMnemo and revoke the old integration separately when appropriate.
