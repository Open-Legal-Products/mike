# Mike

Open-source release containing the Mike frontend and backend.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and migrations
- `backend/migrations/000_one_shot_schema.sql` - one-shot Supabase schema for fresh databases

## Setup

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run `backend/migrations/000_one_shot_schema.sql` in the Supabase SQL editor for a fresh database.

Start the backend:

```bash
npm run dev --prefix backend
```

Start the frontend:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## Required Services

- Supabase Auth and Postgres
- S3-compatible object storage, such as Cloudflare R2
- At least one supported model provider key, depending on which models you enable
- LibreOffice for DOC/DOCX to PDF conversion

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## AWS Lightsail Deployment

This repo now includes deploy-ready Docker and Nginx files:

- `backend/Dockerfile`
- `frontend/Dockerfile`
- `docker-compose.yml`
- `backend/.env.production.example`
- `frontend/.env.production.example`
- `deploy/nginx/legal.playersfund.vc.conf`

### 1. Clone on server and prepare env files

```bash
git clone <your-fork-url> scout-ai-legal
cd scout-ai-legal
cp backend/.env.production.example backend/.env.production
cp frontend/.env.production.example frontend/.env.production
```

Fill in real values in both `.env.production` files.

### 2. Start app containers

```bash
docker compose up -d --build
docker compose ps
```

This starts:
- frontend on `127.0.0.1:3002`
- backend on `127.0.0.1:3001`

### 3. Install and configure Nginx

```bash
sudo apt update
sudo apt install -y nginx
sudo cp deploy/nginx/legal.playersfund.vc.conf /etc/nginx/sites-available/legal.playersfund.vc.conf
sudo ln -s /etc/nginx/sites-available/legal.playersfund.vc.conf /etc/nginx/sites-enabled/legal.playersfund.vc.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Enable HTTPS

After DNS for `legal.playersfund.vc` and `legal-backend.playersfund.vc` points to the server:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d legal.playersfund.vc -d legal-backend.playersfund.vc
```

## License

AGPL-3.0-only. See `LICENSE`.
