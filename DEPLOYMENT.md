# YouType - Deployment Guide

## 🎉 Phase 1 Complete!

Your app is now ready for MVP deployment. Here's what was implemented:

### ✅ Completed Fixes

1. **Environment Variables (Backend)**
   - Created `.env.example` with all required variables
   - CORS origins now configurable via `ALLOWED_ORIGINS`
   - Supports multiple production domains

2. **Environment Variables (Frontend)**
   - Created `.env.local.example`
   - API URL now configurable via `NEXT_PUBLIC_API_BASE`
   - Donate URL configurable via `NEXT_PUBLIC_DONATE_URL`

3. **Updated Metadata**
   - App title: "YouType - Discover Similar Voices"
   - SEO-friendly description
   - No more "Create Next App" placeholder

4. **Smart Donate Link**
   - Uses environment variable
   - Shows helpful message if not configured
   - Easy to enable when ready

5. **Rate Limiting**
   - `/submit`: 10 requests/minute per IP (protects OpenAI costs)
   - `/post`: 20 requests/minute per IP
   - Automatic 429 responses when exceeded

---

## 🚀 Quick Deployment Steps

### Backend Setup (Railway/Render)

1. **Create `.env` file** (copy from `.env.example`):
   ```bash
   OPENAI_API_KEY=sk-your-actual-key-here
   ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
   ENVIRONMENT=production
   ```

2. **Deploy command**:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```

3. **Railway/Render will**:
   - Auto-install from `requirements.txt`
   - Set PORT environment variable
   - Provide a public URL

### Frontend Setup (Vercel)

1. **Create `.env.local`** (copy from `.env.local.example`):
   ```bash
   NEXT_PUBLIC_API_BASE=https://your-backend.railway.app
   NEXT_PUBLIC_DONATE_URL=https://ko-fi.com/yourname
   ```

2. **Deploy to Vercel**:
   ```bash
   # Option 1: Deploy from GitHub (recommended)
   - Connect your repo in Vercel dashboard
   - Add environment variables in Vercel settings
   - Auto-deploy on push

   # Option 2: Manual deploy
   npm install -g vercel
   cd Src/Frontend
   vercel
   ```

3. **Update backend CORS**:
   - After deploy, add your Vercel URL to `ALLOWED_ORIGINS`
   - Example: `https://youtype.vercel.app`

---

## 📋 Pre-Deployment Checklist

### Required
- [ ] Set `OPENAI_API_KEY` in backend environment
- [ ] Update `ALLOWED_ORIGINS` with production frontend URL
- [ ] Set `NEXT_PUBLIC_API_BASE` to production backend URL
- [ ] Test the app locally with env variables

### Optional (but recommended)
- [ ] Set `NEXT_PUBLIC_DONATE_URL` when ready
- [ ] Set up database backups (SQLite dumps)
- [ ] Add monitoring (Sentry, LogRocket, etc.)
- [ ] Set up custom domain

---

## 🎯 Recommended Hosting

### Free/Low-Cost Options:

**Frontend:**
- ✅ **Vercel** (Best for Next.js, 100GB bandwidth free)
- Netlify (Alternative, similar features)

**Backend:**
- ✅ **Railway** ($5/mo, includes DB, auto-sleep on free tier)
- Render (Free tier available, auto-sleep after inactivity)
- Fly.io (Free tier, better for scaling)

**Database:**
- SQLite is fine for MVP (included)
- Later: Migrate to PostgreSQL when you have 1000+ users

---

## 💰 Expected Costs

- **Hosting**: $0-10/month (Railway or Render)
- **OpenAI API**: ~$0.02 per 1000 embeddings (text-embedding-3-small)
- **Domain** (optional): ~$12/year

**Total monthly**: ~$5-15 for MVP with moderate traffic

---

## 🔧 Testing Locally with Env Vars

1. **Backend**:
   ```bash
   cd Src/Backend
   cp .env.example .env
   # Edit .env with your OPENAI_API_KEY
   .venv/bin/uvicorn app.main:app --reload
   ```

2. **Frontend**:
   ```bash
   cd Src/Frontend
   cp .env.local.example .env.local
   # Edit .env.local if needed (defaults should work)
   npm run dev
   ```

---

## 📊 Next Steps (Phase 2 - Optional)

After successful MVP launch:
- Add error logging (Sentry)
- Set up database backups
- Add analytics (Vercel Analytics, Plausible)
- Monitor OpenAI costs
- Add health check endpoint

---

## 🆘 Troubleshooting

**CORS errors after deploy?**
- Check `ALLOWED_ORIGINS` includes your frontend URL
- Include both http/https versions if testing

**Rate limit too strict?**
- Adjust limits in `app/main.py` (lines with `@limiter.limit()`)
- Consider user accounts for higher limits

**OpenAI errors?**
- Verify API key is set correctly
- Check billing in OpenAI dashboard

---

## 🎊 You're Ready!

Your app now has:
✅ Configurable environments
✅ Production-ready CORS
✅ Rate limiting protection
✅ SEO-friendly metadata
✅ Smart donate link

Deploy with confidence! 🚀
