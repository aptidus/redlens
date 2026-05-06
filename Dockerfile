FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends zip \
    && rm -rf /var/lib/apt/lists/*

# Python deps first (cached layer)
COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install playwright && playwright install chromium --with-deps

# Copy backend
COPY api/ ./

# Build extension zip so RedLens can serve it directly (GitHub is blocked in China)
COPY extension/ ./extension_src/
RUN cd extension_src && zip -r ../redlens-extension.zip . -x '*.DS_Store' && cd .. \
    && ls -la redlens-extension.zip

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PORT=8080
EXPOSE 8080

CMD ["python", "main.py"]
