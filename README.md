# RedLens

**XHS Content Intelligence** — Analyze top-performing Xiaohongshu posts for any keyword and get AI-powered content strategy.

## What it does

1. Enter a keyword (e.g. 减肥, 护肤, 穿搭)
2. RedLens crawls the top posts on 小红书 for that keyword
3. AI analyzes patterns across posts, comments, and engagement
4. You get a full report: top patterns, title formulas, comment insights, suggested angles, and hook examples

## Stack

- **Backend**: FastAPI (Python 3.12) with SSE streaming
- **Frontend**: React + TypeScript (Vite)
- **AI**: [mimo-v2.5](https://platform.xiaomimimo.com) via OpenAI-compatible API
- **Signing**: [xhshow](https://github.com/Cloxl/xhshow) — pure-Python XHS request signing

## Setup

### Prerequisites
- Python 3.12+
- Node.js 20+
- A [MiMo API key](https://platform.xiaomimimo.com)
- Your `xiaohongshu.com` cookie string (from browser devtools)

### Local dev

```bash
# Backend
cd api
cp .env.example .env
# Edit .env with your MIMO_API_KEY
pip install -r requirements.txt
python main.py

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Frontend dev server runs on `http://localhost:5173` and proxies `/api` to `localhost:8080`.

### Docker

```bash
docker build -t redlens .
docker run -p 8080:8080 \
  -e MIMO_API_KEY=your_key \
  redlens
```

## Railway deployment

1. Fork this repo
2. Create a new Railway project → Deploy from GitHub
3. Add environment variables:
   - `MIMO_API_KEY` — your MiMo API key
   - `MIMO_BASE_URL` — `https://token-plan-sgp.xiaomimimo.com/v1`
   - `MIMO_MODEL` — `mimo-v2.5`

## Getting your XHS cookie

1. Open `xiaohongshu.com` and log in
2. Press `F12` → Application → Cookies → `xiaohongshu.com`
3. Or: Network tab → any request → copy the `Cookie` request header value
4. Paste the full string into the RedLens cookie field

## Disclaimer

For research and learning purposes only. Respect xiaohongshu.com's terms of service. Do not use for mass scraping or commercial data collection.
