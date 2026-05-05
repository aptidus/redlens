FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

# Python deps first (cached layer)
COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Playwright + Chromium (separate layer — only re-runs when playwright version changes)
RUN playwright install chromium --with-deps

# Copy backend
COPY api/ ./

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PORT=8080
EXPOSE 8080

CMD ["python", "main.py"]
