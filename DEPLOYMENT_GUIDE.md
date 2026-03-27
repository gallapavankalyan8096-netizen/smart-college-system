# Deployment Guide for College Monitoring System

## Backend Deployment (Render)

1. **Go to Render.com** and sign up/login
2. **Create a new Web Service**
3. **Connect your GitHub repository** (make sure this repo is pushed to GitHub)
4. **Configure the service:**
   - **Name:** college-backend
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. **Add Environment Variables:**
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: `smart-college-secret-key-2024`
   - `PORT`: `10000`
6. **Deploy**

Your backend will be available at: `https://your-app-name.onrender.com`

## Frontend Deployment (Netlify)

1. **Go to Netlify.com** and sign up/login
2. **Create a new site from Git**
3. **Connect your GitHub repository**
4. **Configure build settings:**
   - **Base directory:** `frontend`
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
5. **Add Environment Variables:**
   - `VITE_API_BASE`: `https://your-backend-url.onrender.com/api`
   - `VITE_SOCKET_URL`: `https://your-backend-url.onrender.com`
6. **Deploy**

## Important Notes

- Update the backend URL in the frontend's `_redirects` file and `netlify.toml` with your actual Render URL
- The frontend is already configured to proxy API calls to the backend
- Make sure both deployments are complete before testing
- The backend includes default admin credentials: `admin/admin123` and `principal/principal123`

## Testing

After both are deployed:
1. Frontend: Visit your Netlify URL
2. Backend: Visit `https://your-backend-url.onrender.com` (should show API info)
3. Test login and functionality