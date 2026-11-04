# SRK Meet

Video meetings for Android, in the SRK app family. Built on LiveKit, so it scales like Zoom/Teams (50+ people per meeting).

## Features

- **Meetings:** start instantly, join by code or invite link, schedule ahead (adds to your calendar, shares an invite)
- **In a call:** mute, camera on/off, switch front/back camera, speaker grid with active-speaker highlight, call timer
- **Together:** in-meeting chat, emoji reactions, raise hand, participant list
- **Screen sharing:** share your phone screen; others see it full size with everyone in a strip below
- **Host controls:** waiting room (admit / deny / admit all), mute one or everyone, remove someone, end meeting for all
- Keeps running in the background with a "You're in a meeting" notification

## How it fits together

```
SRK Meet app ──(meeting code, name)──▶ SRK Meet server ──(signs a pass)──▶ app
SRK Meet app ◀════════ live audio / video / chat ════════▶ LiveKit Cloud
```

The **server** (`server/worker.js`) is tiny and stateless. It holds your LiveKit secret, hands each person a pass for the meeting, decides who is host, and runs the waiting room and host controls. No database.

## Setup (one time, ~15 minutes, all free)

### 1. LiveKit Cloud (the video engine)
1. Sign up at **cloud.livekit.io** and create a project.
2. Open **Settings → API Keys**, create a key. Copy three things:
   - **WebSocket URL** (looks like `wss://srk-meet-xxxx.livekit.cloud`)
   - **API Key**
   - **API Secret**

### 2. The SRK Meet server (Cloudflare Workers, free)
1. Sign up at **dash.cloudflare.com** → **Workers & Pages → Create → Create Worker**. Name it `srk-meet` → **Deploy**.
2. Click **Edit code**, delete everything, paste the whole of `server/worker.js`, click **Deploy**.
3. Go to the worker's **Settings → Variables and Secrets** and add:
   - `LIVEKIT_URL` = your WebSocket URL
   - `LIVEKIT_API_KEY` = your API key
   - `LIVEKIT_API_SECRET` = your API secret (choose type **Secret**)
4. Your server address is shown on the worker page, e.g. `https://srk-meet.yourname.workers.dev`.
   Open it in a browser — you should see `"configured": true`.

*Alternative:* any Node 18+ host (Render, Railway, a VPS): `cd server && LIVEKIT_URL=… LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… npm start`.

### 3. Build the APK (GitHub Actions)
1. Create a new GitHub repo named **SRK-Meet** and upload this whole folder (keep the `.github` folder).
2. *(Optional)* Repo **Settings → Secrets and variables → Actions → Variables** → add `SRK_MEET_SERVER_URL` = your server address, so the app comes pre-filled.
3. The **Build APK** workflow runs on every push (or run it from the **Actions** tab).
4. Download **SRK-Meet.apk** from the repo's **Releases** and install it on your phone.

### 4. First launch
Enter your name, then tap the yellow **meeting server** card (or ⚙️ Settings) and paste your server address if you didn't pre-fill it.

## Using it

- **New meeting** → optional title, waiting room on/off → Start. Share the invite from the top bar.
- **Join** → type the code (`abc-defg-hij`) or paste the invite link.
- **Schedule** → title, date, time, duration → creates the meeting and opens the share sheet. Upcoming meetings stay on the home screen with Start / Share / Add to calendar.
- **Host:** the meeting's creator is host on that phone. Waiting people show as a red badge on **More** and the people count; open **Participants** to admit them.

## Notes

- Meeting codes starting with **n–z** have a waiting room; **a–m** are open. This is decided when the meeting is created and can't be changed.
- The host key is stored only on the phone that created the meeting. Reinstalling the app loses host rights for existing meetings (just create a new one).
- LiveKit Cloud's free tier has a monthly limit on participant minutes; check your usage in their dashboard.
- Package: `com.srk.meet` · minimum Android 8.0 · built with Kotlin + Jetpack Compose + LiveKit Android SDK.
