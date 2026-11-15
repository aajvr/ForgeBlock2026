# ForgeBlock backend (FastAPI + static/dynamic models) as a container (Azure Web App, or any Docker host).
# Build context = forgeblock/backend. Secrets come from the host's settings, never from this file.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    TF_CPP_MIN_LOG_LEVEL=2 PORT=7860

# Runs as a non-root user
RUN useradd -m -u 1000 app
WORKDIR /home/app/backend

# CPU-only PyTorch first (much smaller than the default CUDA build), then the rest
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=app:app . .
# Images are cached here; the shared copy lives in Supabase Storage (SUPABASE_URL + SUPABASE_SERVICE_KEY)
ENV STORAGE_DIR=/home/app/storage
RUN mkdir -p /home/app/storage && chown -R app:app /home/app
USER app

EXPOSE 7860
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips="*"
