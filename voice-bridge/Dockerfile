FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py healthcheck.py ./
COPY src/ ./src/

RUN useradd --system --uid 10001 bridge
USER bridge

EXPOSE 10700

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "healthcheck.py"]

CMD ["python", "main.py"]
