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

# Build extension zip so NicheLens can serve it directly (GitHub is blocked in China)
COPY extension/ ./extension_src/
RUN cd extension_src && zip -r ../nichelens-extension.zip . -x '*.DS_Store' && cd .. \
    && ln -sf nichelens-extension.zip redlens-extension.zip \
    && ls -la nichelens-extension.zip

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PORT=8080
EXPOSE 8080

# Run alembic only if DATABASE_URL is configured; otherwise start cleanly so
# extension downloads + frontend keep working during partial setup.
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then alembic upgrade head || echo 'alembic upgrade failed, continuing'; else echo 'DATABASE_URL not set, skipping migrations'; fi; exec python main.py"]
