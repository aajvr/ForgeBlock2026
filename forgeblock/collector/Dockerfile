# ForgeBlock data collection tool for online hosting (Render free + Supabase Storage, or any Docker host).
# Signature data lives in /data. On hosts without a lasting disk (Render free) set
# SUPABASE_URL + SUPABASE_SECRET_KEY so it is mirrored to a private Storage bucket;
# otherwise mount a persistent volume at /data.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 COLLECTOR_DATA=/data
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py sheets.py cloud_sync.py ./
COPY static ./static
RUN mkdir -p /data
EXPOSE 8100
# --proxy-headers so the wrong-key lockout sees the real client address behind the host's proxy.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8100} --proxy-headers --forwarded-allow-ips='*'"]
