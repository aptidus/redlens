FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY api/ ./

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PORT=8080
EXPOSE 8080

CMD ["python", "main.py"]
